# -*- coding: utf-8 -*-
"""把 6 列全量 CSV 清洗成「单词 + 释义」两列。

清洗的三类问题（都是从真实页面里逼出来的）：
  1. 单元导图页：左半是词云散词、右半是「使用说明」文字，被误当词条页 →
     整页丢弃（正文页会重新讲这些词）。
  2. 词汇索引页：一页全是「单词 + 页码」，产出的是数字串 → 整页丢弃。
  3. 单条噪声：音标残留（offence → "a'fens/；犯罪"）、书里的「对照/派生」栏目、
     页脚说明（"按考频划分为三个等级"）→ 逐条清洗。

用法：
    python clean_wordbook.py --input output/all_full.csv --out output/最终词表.csv
"""
import argparse, csv, glob, io, json, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')

CIRCLED = re.compile(r'[\u2460-\u2473\u24ea\u3251-\u32bf]')

# 整页丢弃的特征（导图页 / 说明页）。
# 注意：不能用「词群导图」「使用说明」——书每页页眉都印着小节名，会误杀正文页。
# 只认导图页/说明页独有的长句。
PAGE_DROP = ('一图揭示', '按词群排', '避免了按字母顺序', '过目不忘', '趣味记忆')

# 页脚 / 栏目说明，命中即从该处截断
FOOTER_CUT = ('按考频划分', '划线释义', '为重点释义', '重点释义',
              '真题例句', '经典例句', '题例句', '单词的释义', '释义及用法',
              '词群导图', '使用说明', '词以群记', '本单元已学习',
              'Congratulations', '公众号', '微信', '扫码')

# 命中即整条丢弃：这些是「词汇索引页 / 使用说明区」的文字，混进释义说明解析走偏了
DROP_ROW = ('词汇索引', '自测单词掌握', '词群导图', '使用说明', '一图揭示', '过目不忘')


def load_page_flags():
    """扫描 OCR 缓存，标出「导图页」的页号。

    索引页不整页丢弃：索引页产生的词条，其释义全是「英文+页码」，
    逐条清洗时英文和数字会被剥掉、释义变空而自动淘汰（见 clean_meaning）。
    整页判定容易误杀正文页，所以不做。
    """
    map_pages, all_pages = set(), set()
    for fn in glob.glob(os.path.join(CACHE, 'p*.json')):
        m = re.search(r'p(\d+)\.json$', fn)
        if not m:
            continue
        pno = int(m.group(1))
        all_pages.add(pno)
        try:
            data = json.load(io.open(fn, encoding='utf-8'))
        except Exception:
            continue
        txt = ' '.join((it.get('text', '') if isinstance(it, dict) else '') for it in data)
        if any(w in txt for w in PAGE_DROP):
            map_pages.add(pno)
    return map_pages, all_pages


def clean_lemma(l):
    l = (l or '').strip().lower()
    l = l.strip('.,;:!?\'"()[]{}*')
    if not re.fullmatch(r"[a-z][a-z'\-]*[a-z]", l):
        return None
    if not (2 <= len(l) <= 24):
        return None
    # 撇号只允许出现在词尾缩写（don't / it's）；中间带撇号的是音标碎片（iap'greid）
    if "'" in l and not re.search(r"(?:n't|'s|'re|'ve|'ll|'d|'m)$", l):
        return None
    return l


def clean_meaning(m):
    if not m:
        return ''
    s = m.strip()
    s = CIRCLED.sub(' ', s)
    # 1) 剥掉开头的音标 / 字母残留（反复剥，直到露出中文）
    for _ in range(4):
        s2 = re.sub(r'^[^\u4e00-\u9fa5]{0,60}[/／][；;]?\s*', '', s)
        if s2 == s:
            break
        s = s2
    # 2) 截断书里的「对照/派生」栏目
    s = re.split(r'对\s*照', s, maxsplit=1)[0]
    # 3) 截断页脚 / 栏目说明
    for w in FOOTER_CUT:
        i = s.find(w)
        if i >= 0:
            s = s[:i]
    # 4) 去掉混进来的英文（例句原文、栏目里的英文单词）
    s = re.sub(r"[A-Za-z][A-Za-z'\-.·]{2,}", ' ', s)
    s = re.sub(r'(?<![A-Za-z])[A-Za-z](?![A-Za-z])', ' ', s)
    # 5) 去掉页码数字
    s = re.sub(r'\d{1,}', ' ', s)
    # 6) 分隔符与空白规范化
    s = re.sub(r'[；;]+', '；', s)
    s = re.sub(r'[，,]+', '，', s)
    s = re.sub(r'\s+', ' ', s)
    s = s.replace('·', '')
    s = s.strip(' ；;，,、.—－-+*@#?？!！/／|"\'()（）【】[]:：')
    # 7) 去掉空义项
    parts = [p.strip() for p in re.split(r'[；;]', s)]
    parts = [p for p in parts if p and re.search(r'[\u4e00-\u9fa5]', p)]
    seen_p, out_p = set(), []
    for p in parts:
        if p not in seen_p:
            seen_p.add(p)
            out_p.append(p)
    return '；'.join(out_p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True, help='6 列全量 CSV（含 unit 页号列）')
    ap.add_argument('--out', default='output/最终词表.csv')
    ap.add_argument('--report', default='', help='把清洗明细写到这个文件')
    args = ap.parse_args()

    map_pages, all_pages = load_page_flags()
    print('[*] 缓存页数 %d；识别出导图页 %d 个 %s'
          % (len(all_pages), len(map_pages), sorted(map_pages)[:15]), flush=True)

    rows = list(csv.DictReader(io.open(args.input, encoding='utf-8-sig')))
    print('[*] 读入 %d 条' % len(rows), flush=True)

    kept, seen = [], {}
    dropped = {'导图页': 0, '栏目页': 0, '非单词': 0, '释义清空': 0}

    for r in rows:
        lemma_raw = r.get('lemma', '')
        raw_m = r.get('meaning', '') or ''
        pno = None
        m = re.search(r'(\d+)', r.get('unit', '') or '')
        if m:
            pno = int(m.group(1))
        if pno in map_pages:
            dropped['导图页'] += 1
            continue
        # 索引/说明栏目的文字混进来的，整条丢弃
        if any(w in raw_m for w in DROP_ROW):
            dropped['栏目页'] += 1
            continue
        lemma = clean_lemma(lemma_raw)
        if not lemma:
            dropped['非单词'] += 1
            continue
        meaning = clean_meaning(r.get('meaning', ''))
        if not meaning:
            dropped['释义清空'] += 1
            continue
        if lemma in seen:
            if meaning not in seen[lemma]:
                seen[lemma] = seen[lemma] + '；' + meaning
            continue
        seen[lemma] = meaning
        kept.append(lemma)

    with io.open(args.out, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['lemma', 'meaning'])
        for l in kept:
            w.writerow([l, seen[l]])

    print()
    print('=== 清洗完成 ===')
    print('输出: %s' % args.out)
    print('保留 %d 词' % len(kept))
    for k, v in dropped.items():
        if v:
            print('  丢弃·%-8s %d' % (k, v))
    multi = sum(1 for l in kept if '；' in seen[l])
    print('多义项 %d (%.0f%%)' % (multi, 100.0 * multi / max(1, len(kept))))

    if args.report:
        with io.open(args.report, 'w', encoding='utf-8') as f:
            for l in kept:
                f.write('%s\t%s\n' % (l, seen[l]))
        print('明细: %s' % args.report)


if __name__ == '__main__':
    main()
