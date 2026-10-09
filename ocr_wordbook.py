# -*- coding: utf-8 -*-
"""
把《晓艳英语 你还在背单词吗》扫描版 PDF 转成工作台可导入的单词书 CSV。

流程：抽页内嵌位图 → OCR（带坐标）→ 按两栏排版还原词条 → 输出 CSV
输出列：lemma,pos,ipa,meaning,example,unit

用法：
  python ocr_wordbook.py --pdf <路径> --out <csv> [--pages 1-5,30] [--limit N] [--dump-lines]
"""
import argparse, csv, io, json, os, re, sys, time

# ---------- 版面参数（页图 1048×1477，两栏）----------
COL_SPLIT_X = 500      # 左右栏分界
LEFT_MIN_X = 15        # 排除左侧竖排的 Unit/Lesson 标签（靠 h>60 判断，不靠 x）
HEADER_Y = 70          # 页眉
FOOTER_Y = 1465        # 只切掉最底部的公众号/二维码（页脚垃圾靠 is_junk 精确过滤，
                       # 不能按固定 y 裁太狠——第 31 页的 system/bark 就在 y≈1270~1300）

# 词性缩写（注意：OCR 常把词性读成大写 V./N.，必须忽略大小写）
POS = r'(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|interj|aux|abbr|pl|vbl|modal)'
POS_FLAG = re.I
POS_RE = re.compile(r'^/?.{0,12}?\b' + POS + r'\.', POS_FLAG)

EN_RE = re.compile(r"^[A-Za-z][A-Za-z\-' .]*$")
IPA_RE = re.compile(r'/[^/]{2,}/')
HEAD_WORD_RE = re.compile(r"^([A-Za-z][A-Za-z\-']*(?:[ ][A-Za-z][A-Za-z\-']*){0,2})")
CN_RE = re.compile(r'[\u4e00-\u9fa5]')

NOTE_PREFIX = ('记', '联想', '构词', '词根', '助记', '扩展', '扩', '派', '同', '近', '反',
               '短语', '搭配', '辨', '对照', '串记', '谐音', '词源', '派生')
EX_PREFIX = ('例', '例句', '真题')

# 派生/扩展词：note 行里形如「扩insightful/in'saitfl/adj.富有洞察力的」
DERIVED_RE = re.compile(
    r'^(?:扩|派|扩展|派生)\s*([A-Za-z][A-Za-z\-\']*)\s*(/[^/]{2,}/)?\s*(.*)$'
)


def norm(s):
    """去掉 OCR 常见的粘连空格问题：中英之间补空格，多余空格压缩"""
    s = s.replace('\u3000', ' ')
    s = re.sub(r'[ \t]+', ' ', s).strip()
    return s


def is_junk(text):
    t = text.strip()
    if not t:
        return True
    # 页码 / 纯数字 / 纯符号
    if re.fullmatch(r'[\d\s.\-—_、，。·]+', t):
        return True
    # 公众号 / 微信 / 二维码那几行
    if '公众号' in t or '微信' in t or 'Congratulations' in t:
        return True
    # 单元统计行
    if re.search(r'\d+\s*个(词群|单词|扩展词|例句)', t) or '本单元已学习' in t:
        return True
    # 词云图的连线标签
    if re.fullmatch(r'(形近|近义|反义|相关|同义|词根|词缀)', t):
        return True
    # 页脚页码，形如「难走的路，才不拥挤。/023」
    if re.search(r'/\s*\d{1,3}\s*$', t):
        return True
    return False


VOWEL_RE = re.compile(r'[aeiouy]', re.I)


def valid_lemma(w):
    """过滤 OCR 噪声：必须全是字母/连字符/撇号、含元音、不含数字"""
    if not w or not re.fullmatch(r"[A-Za-z][A-Za-z\-']*", w):
        return False
    if re.search(r'\d', w):
        return False
    return bool(VOWEL_RE.search(w))


def split_columns(items):
    left, right = [], []
    for it in items:
        (left if it['xc'] < COL_SPLIT_X else right).append(it)
    return left, right


def group_lines(items, tol=13.0):
    """同一条线上的多个框合并（按 y 中心聚类，再按 x 排序拼接）"""
    items = sorted(items, key=lambda a: (a['yc'], a['x0']))
    lines, cur = [], []
    for it in items:
        if cur and abs(it['yc'] - cur[-1]['yc']) > tol:
            lines.append(cur); cur = []
        cur.append(it)
    if cur:
        lines.append(cur)
    out = []
    for g in lines:
        g.sort(key=lambda a: a['x0'])
        out.append({
            'y0': min(a['y0'] for a in g),
            'text': norm(' '.join(a['text'] for a in g)),
            'h': max(a['h'] for a in g),
            'items': g,
        })
    return out


def classify(text):
    t = text.strip()
    if not t:
        return 'junk'
    if is_junk(t):
        return 'junk'
    # 以 例 开头 → 例句
    if t[0] in '例':
        return 'example'
    for p in NOTE_PREFIX:
        if t.startswith(p):
            return 'note'
    # 含 IPA 斜杠 → 极可能是词条首行（强信号）
    if IPA_RE.search(t):
        return 'head'
    # 单个纯英文词 → 弱信号：也可能是页首词云图里的散词，需要后文佐证
    if EN_RE.match(t) and 2 <= len(t) <= 20 and ' ' not in t.strip():
        return 'headw'
    if POS_RE.match(t):
        return 'meaning'
    if CN_RE.search(t):
        return 'meaning'
    if re.search(r'[A-Za-z]{3,}', t):
        return 'example'   # 长英文行，多半是例句
    return 'other'


def parse_lemma(text):
    """从词条首行里取出单词"""
    t = text.strip()
    # 去掉行首的纯符号（如页码块 ".08." 的点）
    t = re.sub(r'^[^0-9A-Za-z\u4e00-\u9fa5]+', '', t)
    # 去掉行首的编号小块：可能是 "36."、"01 "、"R06 "（OCR 把编号认成字母+数字）
    t = re.sub(r'^(?:[A-Za-z]{0,2}\d{1,3})[.、]?\s+', '', t)
    t = re.sub(r'^\d{1,3}\s*[.、]?\s*', '', t)
    m = HEAD_WORD_RE.match(t)
    if not m:
        return None
    return m.group(1).strip().lower()


def parse_ipa(text):
    m = IPA_RE.search(text)
    return m.group(0) if m else ''


def parse_pos_meaning(text):
    """从一行里取出 词性 + 释义（可能多个词性串联）"""
    t = re.sub(r'^[\d]+\s*[.、]?\s*', '', text.strip())
    # 行首若不是词性，先剥掉可能是单词/音标的前缀
    if not POS_RE.match(t):
        t = re.sub(r'^[A-Za-z][A-Za-z\-\' ]{1,24}', ' ', t)
    t = IPA_RE.sub(' ', t)
    t = re.sub(r'^[./\\\-;:、,，\s]+', '', t)      # 清掉残留的 . / 等前导符号
    t = norm(t)
    pos, meaning = [], t
    m = re.match(r'^((?:' + POS + r'\.\s*)+)(.*)$', t, POS_FLAG)
    if m:
        pos = re.findall(POS + r'\.', m.group(1), POS_FLAG)
        meaning = norm(m.group(2))
    # 释义里可能还夹着后续的词性标记（如「视力，视觉；景象v.看到，发现」）。
    # 注意：不能用 \b —— 中文字符在 Python re 里也算 \w，汉字紧跟 v 时没有词边界。
    extra = re.findall(r'(?<![A-Za-z])(' + POS + r')\.(?=\s*[\u4e00-\u9fa5])', meaning, POS_FLAG)
    if extra:
        pos += extra
        meaning = re.sub(r'(?<![A-Za-z])(?:' + POS + r')\.(?=\s*[\u4e00-\u9fa5])', '；', meaning,
                         flags=POS_FLAG)
    meaning = re.sub(r'^[;；,，、.\s]+', '', norm(meaning))
    pos = [p.lower() for p in pos]
    return list(dict.fromkeys(pos)), norm(meaning)


def extract_derived(text):
    """从 note 行中提取派生/扩展词，返回 (lemma, ipa, pos, meaning) 或 None"""
    m = DERIVED_RE.match(text.strip())
    if not m:
        return None
    lemma, ipa, rest = m.group(1), m.group(2) or '', m.group(3) or ''
    p, mean = parse_pos_meaning(rest)
    if not mean or not CN_RE.search(mean):
        return None
    return lemma.strip().lower(), ipa, p, mean


BLK_NONE, BLK_NOTE, BLK_EX = 0, 1, 2


def new_entry(lemma, ipa, y):
    return {'lemma': lemma, 'ipa': ipa, 'pos': [], 'meaning_parts': [],
            'example': [], 'note': [], 'y': y}


def build_entries(lines):
    """把一栏的行序列切成词条。

    关键规则（都是被真实页面的坑逼出来的）：
    - **每栏在遇到第一个带音标的词条首行之前的内容一律丢弃** —— 那是页首「词以群记」
      词云图，里面的散词没有释义，混进来会污染词表。
    - 释义行**必须**以词性缩写开头（n./v./adj. …）；否则视为上一块的换行续行，
      归到 note/example，避免助记译文和例句译文污染释义。
    - 以「/」开头的行（如 /'o:rient/.v.确定方向；适应）是当前词条的续行，不是新词条
      —— OCR 常把「单词」和「音标+释义」拆成两个框。
    - 不带音标的单个英文词（如 "orient"）是**弱信号**：只有紧邻下一行出现「/…/」或词性行
      才认作真词条，否则当作词云里的散词丢掉。
    - note 里的「扩 xxx /.../ adj.…」要拆成独立词条（书的扩展词，占总量不小）。
    """
    # 砍掉词云图：从第一个强词条信号开始
    start = 0
    for i, ln in enumerate(lines):
        if classify(ln['text']) == 'head':
            start = i
            break
    else:
        return []
    lines = lines[start:]

    entries, cur = [], None
    blk = BLK_NONE
    last_y = None

    def push_meaning(text, y):
        nonlocal blk, last_y
        p, m = parse_pos_meaning(text)
        if p:
            cur['pos'] += p
        if m and CN_RE.search(m):
            cur['meaning_parts'].append(m)
        blk, last_y = BLK_NONE, y

    def lookahead_ok(i):
        """弱词条佐证：紧邻 60px 内出现「/…/」行或词性行"""
        y0 = lines[i]['y0']
        for j in range(i + 1, min(i + 3, len(lines))):
            nx = lines[j]
            if nx['y0'] - y0 > 60:
                break
            if nx['text'].startswith('/'):
                return True
            if POS_RE.match(nx['text']) and CN_RE.search(nx['text']):
                return True
        return False

    for i, ln in enumerate(lines):
        text, y = ln['text'], ln['y0']
        kind = classify(text)
        if kind == 'junk':
            continue

        # ---- A. 以 / 开头：当前词条的续行 ----
        if text.startswith('/') and cur is not None:
            if not cur['ipa']:
                cur['ipa'] = parse_ipa(text)
            push_meaning(text, y)
            continue

        # ---- B. 新词条 ----
        if kind in ('head', 'headw'):
            lemma = parse_lemma(text)
            if not lemma or not valid_lemma(lemma):
                continue
            if kind == 'headw' and not lookahead_ok(i):
                continue
            cur = new_entry(lemma, parse_ipa(text), y)
            entries.append(cur)
            blk, last_y = BLK_NONE, y
            p, m = parse_pos_meaning(text)
            if p:
                cur['pos'] += p
            if m and CN_RE.search(m):
                cur['meaning_parts'].append(m)
            continue

        if cur is None:
            continue

        # ---- C. 释义行：必须带词性，且只能出现在「词条刚开头」的位置 ----
        # blk 不为 NONE 说明已经进入助记/例句块；此时再出现词性行，说明它是某个
        # 漏识别的词条的释义（如 p31 的 bark），绝不能挂到当前词条上（会造成释义串台）。
        if (blk == BLK_NONE and POS_RE.match(text) and CN_RE.search(text)
                and (last_y is None or y - last_y < 150)):
            push_meaning(text, y)
            continue

        # 已经进入助记/例句块后又出现的词性行：直接丢弃，别混进例句
        if POS_RE.match(text) and CN_RE.search(text):
            last_y = y
            continue

        # ---- D. 其余按块续行处理（显式类型优先于残留块状态）----
        if kind == 'example':
            cur['example'].append(text)
            blk, last_y = BLK_EX, y
        elif kind == 'note':
            # 先看看这行是不是「扩/派 + 英文词 + 音标 + 释义」→ 拆成独立词条
            d = extract_derived(text)
            if d:
                dl, dipa, dpos, dm = d
                if valid_lemma(dl):
                    de = new_entry(dl, dipa, y)
                    de['pos'] = dpos
                    de['meaning_parts'] = [dm]
                    entries.append(de)
            cur['note'].append(text)
            blk, last_y = BLK_NOTE, y
        elif blk == BLK_EX:
            cur['example'].append(text)
            last_y = y
        elif blk == BLK_NOTE:
            cur['note'].append(text)
            last_y = y
        else:
            # 孤立行：既不是释义也不属于已知块 → 丢弃，宁缺勿滥
            last_y = y

    return entries


def clean_meaning(parts):
    out = []
    for p in parts:
        p = norm(p)
        # 去掉残留的词性标记（如「n.」「v.」）；汉字也算 \w，所以不能用 \b
        p = re.sub(r'(?<![A-Za-z])(?:' + POS + r')\.', '；', p, flags=POS_FLAG)
        # 统一分隔符，清掉 OCR 噪声（前导的 & . , 等）
        p = re.sub(r'[;；,，、]+', '；', p)
        p = re.sub(r'\s*；\s*', '；', p)
        p = re.sub(r'^[；&.、,，\s]+', '', p)
        p = re.sub(r'[；&.、,，\s]+$', '', p)
        p = norm(p)
        if p and p not in out:
            out.append(p)
    # 去掉明显是助记/音似的碎片
    out = [p for p in out if '音似' not in p and '联想' not in p and '构词' not in p]
    res = '；'.join(out)
    return re.sub(r'；{2,}', '；', res).strip('；')


def clean_example(exs):
    """例句行里英文和中文常被拆成两行，尽量只保留英文部分"""
    txt = ' '.join(exs)
    txt = re.sub(r'^(例|例句|真题)\s*', '', txt)
    txt = norm(txt)
    # 只留英文（连续 ASCII 片段拼起来）
    parts = re.findall(r"[A-Za-z][A-Za-z0-9\-\'’,;:.!? ]{10,}", txt)
    best = max(parts, key=len) if parts else ''
    best = norm(best)
    return best[:200]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--out', default='wordbook.csv')
    ap.add_argument('--pages', default='', help='如 1-5,30；留空=全部')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--keep-ipa', action='store_true',
                    help='保留 OCR 出的音标。默认丢弃：IPA 符号 OCR 基本认不准，'
                         '错音标比没有音标更容易误导记忆')
    ap.add_argument('--dump-lines', action='store_true')
    ap.add_argument('--imgdir', default='', help='已有页面图片目录，跳过 PDF 抽图')
    ap.add_argument('--save-imgs', default='', help='把每页位图存到这里（缓存用）')
    ap.add_argument('--ocr-cache', default='', help='OCR 结果缓存目录：命中则跳过 OCR，便于反复调解析规则')
    ap.add_argument('--full', action='store_true',
                    help='输出完整 6 列（lemma,pos,ipa,meaning,example,unit）；默认只输出 2 列（lemma,meaning）')
    args = ap.parse_args()

    from rapidocr_onnxruntime import RapidOCR
    engine = RapidOCR()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)

    # 1) 决定要处理哪些页
    pages = []            # [(页码, 图片路径或 None)]
    reader = None
    if args.imgdir:
        for fn in sorted(os.listdir(args.imgdir)):
            m = re.match(r'p(\d+)', fn)
            if m:
                pages.append((int(m.group(1)), os.path.join(args.imgdir, fn)))
    else:
        from pypdf import PdfReader
        print('[*] 打开 PDF ...', flush=True)
        reader = PdfReader(args.pdf, strict=False)
        total = len(reader.pages)
        sel = list(range(1, total + 1))
        if args.pages:
            sel = []
            for seg in args.pages.split(','):
                seg = seg.strip()
                if '-' in seg:
                    a, b = seg.split('-')
                    sel += list(range(int(a), int(b) + 1))
                elif seg:
                    sel.append(int(seg))
            sel = [p for p in sel if 1 <= p <= total]
        if args.limit:
            sel = sel[:args.limit]
        print('[*] 共 %d 页，本次处理 %d 页' % (total, len(sel)), flush=True)
        pages = [(p, None) for p in sel]

    if args.ocr_cache:
        os.makedirs(args.ocr_cache, exist_ok=True)
    if args.save_imgs:
        os.makedirs(args.save_imgs, exist_ok=True)

    print('[*] 待处理 %d 页' % len(pages), flush=True)

    rows = []
    seen = {}
    t_start = time.time()
    n_cache = 0
    n_ocr = 0

    for idx, (pno, path) in enumerate(pages, 1):
        # --- OCR 结果缓存：命中就跳过 OCR，方便反复调解析规则 ---
        cache_fn = os.path.join(args.ocr_cache, 'p%04d.json' % pno) if args.ocr_cache else None
        res = None
        if cache_fn and os.path.exists(cache_fn):
            try:
                with io.open(cache_fn, 'r', encoding='utf-8') as f:
                    raw = json.load(f)
                res = [(it['box'], it['text'], it['score']) for it in raw]
                n_cache += 1
            except Exception:
                res = None

        if res is None:
            # 需要图片：按需从 PDF 抽（不一次性把所有页载入内存）
            tmp_used = None
            if path is None:
                try:
                    imgs = list(reader.pages[pno - 1].images)
                except Exception as e:
                    print('[!] 第 %d 页取图失败: %s' % (pno, str(e)[:70]), flush=True)
                    continue
                if not imgs:
                    continue
                data = imgs[0].data
                if args.save_imgs:
                    path = os.path.join(args.save_imgs, 'p%04d_0.png' % pno)
                    with open(path, 'wb') as f:
                        f.write(data)
                else:
                    import tempfile
                    tf = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
                    tf.write(data); tf.close()
                    path = tf.name
                    tmp_used = path
            try:
                res, _ = engine(path)
                n_ocr += 1
            except Exception as e:
                print('[!] 第 %d 页 OCR 失败: %s' % (pno, str(e)[:70]), flush=True)
                res = None
            if tmp_used and os.path.exists(tmp_used):
                try:
                    os.unlink(tmp_used)
                except Exception:
                    pass
            if cache_fn and res:
                try:
                    with io.open(cache_fn, 'w', encoding='utf-8') as f:
                        json.dump([{'box': [[float(p[0]), float(p[1])] for p in b],
                                    'text': t, 'score': float(s)} for b, t, s in res],
                                  f, ensure_ascii=False)
                except Exception:
                    pass

        items = []
        for box, text, score in (res or []):
            pts = [(float(p[0]), float(p[1])) for p in box]
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            it = {'x0': min(xs), 'x1': max(xs), 'y0': min(ys), 'y1': max(ys),
                  'xc': (min(xs) + max(xs)) / 2.0, 'yc': (min(ys) + max(ys)) / 2.0,
                  'h': max(ys) - min(ys), 'text': norm(text), 'score': float(score)}
            if it['x0'] < LEFT_MIN_X:
                continue
            if it['y0'] < HEADER_Y or it['y0'] > FOOTER_Y:
                continue
            if it['h'] > 60:      # 竖排标签之类
                continue
            items.append(it)

        left, right = split_columns(items)
        col_entries = []
        for col in (left, right):
            lines = group_lines(col)
            if args.dump_lines and idx <= 1:
                print('--- 第 %d 页 栏内行 ---' % pno)
                for ln in lines:
                    print('   [%s] y=%6.1f  %s' % (classify(ln['text']), ln['y0'], ln['text'][:90]))
            col_entries += build_entries(lines)

        for e in col_entries:
            lemma = e['lemma']
            meaning = clean_meaning(e['meaning_parts'])
            if not lemma or len(lemma) < 2:
                continue
            if not meaning:
                continue
            if not CN_RE.search(meaning):
                continue
            if lemma in seen:
                # 合并释义
                if meaning and meaning not in seen[lemma]['meaning']:
                    seen[lemma]['meaning'] += '；' + meaning
                if e['example']:
                    ex = clean_example(e['example'])
                    if ex and not seen[lemma]['example']:
                        seen[lemma]['example'] = ex
                continue
            row = {
                'lemma': lemma,
                'pos': '/'.join(dict.fromkeys(e['pos'])),
                'ipa': e['ipa'],
                'meaning': meaning,
                'example': clean_example(e['example']),
                'unit': 'p%d' % pno,
            }
            seen[lemma] = row
            rows.append(row)

        if idx % 10 == 0 or idx == len(pages):
            el = time.time() - t_start
            print('[*] %d/%d 页  已得 %d 词  用时 %.0fs  预计剩余 %.0fs   (OCR %d / 缓存 %d)'
                  % (idx, len(pages), len(rows), el, el / idx * (len(pages) - idx), n_ocr, n_cache),
                  flush=True)

    if not args.keep_ipa:
        for r in rows:
            r['ipa'] = ''

    cols = (['lemma', 'pos', 'ipa', 'meaning', 'example', 'unit']
            if args.full else ['lemma', 'meaning'])
    with io.open(args.out, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print()
    print('=== 完成 ===')
    print('输出: %s' % args.out)
    print('列: %s' % ','.join(cols))
    print('词条数: %d' % len(rows))
    multi = sum(1 for r in rows if '；' in r['meaning'])
    print('多义项: %d (%.0f%%)' % (multi, 100.0 * multi / max(1, len(rows))))


if __name__ == '__main__':
    main()
