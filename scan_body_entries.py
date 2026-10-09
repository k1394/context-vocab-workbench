# -*- coding: utf-8 -*-
"""直接量：从全部 OCR 行里用「word /音标/ 词性.释义」的通用模式扫一遍，
   看正文里到底有多少个词条，以及有多少是我们的词表没有的。"""
import json, glob, os, re, csv, collections

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
CJK = re.compile(r'[\u4e00-\u9fff]')
INDEX_PAGES = set('p%04d.json' % p for p in range(315, 339))

ENTRY = re.compile(
    r'(?:口|扩)?\s*'                                  # 复选框 / 扩展词标记
    r'([A-Za-z][A-Za-z\'\-]{1,24})'                    # 单词
    r'\s*[-–—*+]{0,3}\s*/\s*([^/\n]{1,45}?)\s*/\s*'    # /音标/
    r'((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr)\b[\s\S]{0,90})',
    re.I)

ours = set()
with open(os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv'), encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f); next(r)
    for a, b in r:
        ours.add(a.strip().lower())

found = collections.OrderedDict()
pages_hit = collections.Counter()
total_hits = 0
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    name = os.path.basename(fp)
    if name in INDEX_PAGES:
        continue
    for it in json.load(open(fp, encoding='utf-8')):
        t = it.get('text', '')
        for m in ENTRY.finditer(t):
            w = m.group(1).strip("'-.").lower()
            if len(w) < 2:
                continue
            total_hits += 1
            pages_hit[name] += 1
            if w not in found:
                found[w] = m.group(3)[:80]

print('正文命中词条总数(含重复):', total_hits)
print('不同单词数:', len(found))
print('我们的词表:', len(ours))
miss = sorted(k for k in found if k not in ours)
print('正文有、我们词表没有:', len(miss))
print()
print('--- 缺失样本 60 ---')
for w in miss[:60]:
    print('  %-22s %s' % (w, found[w].replace('\n', ' ')[:60]))
print()
print('--- 命中行数最少的 10 页（可能整页漏抽） ---')
low = [(v, k) for k, v in pages_hit.items()]
low.sort()
print(low[:10])

with open(os.path.join(BASE, 'output', 'body_scan.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    wr = csv.writer(f); wr.writerow(['lemma', 'raw_meaning'])
    for w, m in found.items():
        wr.writerow([w, m])
