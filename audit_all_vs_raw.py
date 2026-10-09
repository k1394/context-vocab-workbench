# -*- coding: utf-8 -*-
"""全表 vs 原书：逐条比对，系统性找出「截断」和「串台」。

做法：把每一页按左/右栏各自拼成文本流，用同一个词条正则抽出原书条目，
      清洗后得到 lemma -> 原书释义；再拿词表里的释义去比：
        · 表里释义是原书释义的前缀、且短了一截   → 截断
        · 表里释义比原书释义还长                 → 串台（混进了邻栏 / 页脚 / 例句）
      两栏分别处理，所以能避开当初两栏 overlap 造成的粘连。
"""
import json, glob, os, re, csv, collections

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
CSV = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
CJK = re.compile(r'[\u4e00-\u9fff]')
POS = r'(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr|det|exclam|modal)'
ENTRY = re.compile(
    r'(?:口|扩|O|D)?\s*'
    r'([A-Za-z][A-Za-z\'\-]{1,24})'
    r'\s*[-–—*+]{0,3}\s*/\s*([^/\n]{1,45}?)\s*/\s*'
    r'((?:%s)\s*\.[\s\S]{2,120}?)(?=(?:口|扩)?\s*[A-Za-z][A-Za-z\'\-]{1,24}\s*[-–—*+]{0,3}\s*/|\Z)' % POS,
    re.I)


def clean_meaning(raw):
    m = raw
    m = re.sub(r'^(?:%s)\s*\.\s*' % POS, '', m, flags=re.I)
    m = re.sub(r'\b(?:pl|sing)\b', '', m, flags=re.I)
    m = re.sub(r'[A-Za-z]{3,}', ' ', m)
    m = re.sub(r'\b(?:%s)\s*\.' % POS, '；', m, flags=re.I)
    hit = CJK.search(m)
    if hit and hit.start() > 0:
        m = m[hit.start():]
    m = re.split(r'【|构词|谐音|联想|对照|例\s|例句|配套|学丞|联系微信|公众号|按考频|划线', m)[0]
    m = re.sub(r'\s+', '', m)
    m = m.strip(' ；;,，、·.]-*&～')
    m = re.sub(r'[：:]+', '；', m)
    m = re.sub(r'；{2,}', '；', m)
    m = m.rstrip('；')
    return m.strip()


def col_streams(items):
    out = []
    for lo, hi in ((0, 500), (500, 2000)):
        col = [it for it in items if lo <= it['box'][0][0] < hi]
        col.sort(key=lambda it: (it['box'][0][1], it['box'][0][0]))
        out.append('\n'.join(it.get('text', '') for it in col))
    return out


# ---- 1. 从原书建立 lemma -> 原书释义 ----
raw_map = {}
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    pno = int(re.search(r'p(\d+)', os.path.basename(fp)).group(1))
    if pno <= 9 or pno >= 315:      # 封面/目录/索引页
        continue
    for stream in col_streams(json.load(open(fp, encoding='utf-8'))):
        for m in ENTRY.finditer(stream):
            w = m.group(1).strip("'-.").lower()
            mean = clean_meaning(m.group(3))
            if len(w) < 2 or not mean or not CJK.search(mean):
                continue
            if w not in raw_map or len(mean) > len(raw_map[w][0]):
                raw_map[w] = (mean, pno)
print('原书可重建词条:', len(raw_map))

# ---- 2. 对比词表 ----
rows = list(csv.reader(open(CSV, encoding='utf-8-sig', newline='')))[1:]
data = [(a.strip(), b.strip()) for a, b in rows if a.strip()]

norm = lambda s: re.sub(r'[^\u4e00-\u9fffA-Za-z0-9]', '', s)
trunc, overflow, nohit = [], [], []
for w, m in data:
    k = w.lower()
    if k not in raw_map:
        nohit.append((w, m))
        continue
    rm, pno = raw_map[k]
    a, b = norm(m), norm(rm)
    if len(a) + 2 <= len(b) and b.startswith(a):
        trunc.append((w, m, rm, pno))
    elif len(a) > len(b) + 2:
        overflow.append((w, m, rm, pno))

print('词表 %d 条' % len(data))
print('原书没对上（词头 OCR 不同/查不到）: %d' % len(nohit))
print()
print('=== A. 疑似截断 %d 条 ===' % len(trunc))
for w, m, rm, pno in trunc[:60]:
    print('  p%-4d %-16s 表:%s' % (pno, w, m[:40]))
    print('        %-16s 书:%s' % ('', rm[:46]))
print()
print('=== B. 疑似串台（表比原书长）%d 条 ===' % len(overflow))
for w, m, rm, pno in overflow[:60]:
    print('  p%-4d %-16s 表(%d):%s' % (pno, w, len(m), m[:52]))
    print('        %-16s 书(%d):%s' % ('', len(rm), rm[:46]))

# ---- C. 真截断：表释义的最后一段在原书里后面直接跟着汉字（被切断，不是义项边界）----
# 书里释义后面常粘着「构词 / 谐音 / 联想 / 例句 / 页脚励志句」，这些用噪音词表排掉。
NOISE = ['套程', '公众', '研大', '联系微信', '公众号', '学丞', '晓艳', '单词发音', '谐音',
         '构词', '联想', '对照', '配套', '按考频', '划线', '词汇索引', '唯有拼搏', '心中有光',
         '最快的脚步', '道固远', '没有伞', '去想', '眼下即是', '方得辉煌', '相信自己', '加油',
         '不积跬步', '行而不辍', '星光', '世上无难事', '例', 'He', 'The', 'Unit', 'Lesson', 'PART']
print()
print('=== C. 末尾被切断（最该修） ===')
cut, cut_raw = [], []
for w, m, rm, pno in trunc:
    segs = [x for x in re.split(r'[；;，,、]', m) if x.strip()]
    if not segs:
        continue
    last = segs[-1]
    pos = rm.find(last)
    if pos < 0:
        continue
    rest = rm[pos + len(last):pos + len(last) + 20]
    nxt = rest[:1]
    if not (nxt and CJK.match(nxt)):
        continue
    if any(x in rest for x in NOISE):
        continue                      # 后面跟的是页脚/谐音句，不是被切断的释义
    cut.append((w, m, rm, pno))
    cut_raw.append((w, m, last, rest, pno))
print('共 %d 条' % len(cut))
for w, m, rm, pno in cut:
    print('  p%-4d %-16s 表:%s' % (pno, w, m[:40]))
    print('        %-16s 书:%s' % ('', rm[:46]))

import json as _json
_json.dump({'cut': [{'w': w, 'm': m, 'rm': rm, 'pno': pno} for w, m, rm, pno in cut],
            'overflow': [{'w': w, 'm': m, 'rm': rm, 'pno': pno} for w, m, rm, pno in overflow]},
           open(os.path.join(BASE, 'output', '_audit_candidates.json'), 'w', encoding='utf-8'),
           ensure_ascii=False, indent=1)
print('候选清单已写出 output/_audit_candidates.json')
