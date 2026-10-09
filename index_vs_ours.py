# -*- coding: utf-8 -*-
"""把书末「词汇索引」页里的全部单词抽出来，跟我们的词表对比。"""
import json, glob, os, re, csv

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')

ours = set()
with open(os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv'), encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f); next(r)
    for a, b in r:
        ours.add(a.strip().lower())

# 索引条目形如 "alert /13" / "accountancy-/146" / "adjective /286"
PAIR = re.compile(r"([A-Za-z][A-Za-z'\-]{1,24})\s*[-–—*+]{0,2}\s*/\s*(\d{1,3})\b")
idx = {}
pages = []
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    txt = ' '.join(i.get('text', '') for i in json.load(open(fp, encoding='utf-8')))
    hits = PAIR.findall(txt)
    if len(hits) >= 8:
        pages.append((os.path.basename(fp), len(hits)))
        for w, p in hits:
            w = w.strip("'-.").lower()
            if len(w) >= 2:
                idx.setdefault(w, p)

print('索引页:', pages)
print('索引共抽出不同单词:', len(idx))
miss = sorted(k for k in idx if k not in ours)
print('索引有、我们没有:', len(miss))
print(miss[:120])
extra = len(ours - set(idx))
print('我们有、索引没有:', extra, '（多为 OCR 变体或书中正文词）')
