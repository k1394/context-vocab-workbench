# -*- coding: utf-8 -*-
"""摸清这本书到底有多少词：
   书末「词汇索引」页会逐词列出全部词条+页码，把它抽出来跟我们的词表比，
   就能知道是「书里就这么些词」还是「我们漏抽了」。"""
import json, glob, os, re, csv, collections

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')

# 我们现在的词表
ours = set()
with open(os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv'), encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f); next(r)
    for a, b in r:
        ours.add(a.strip().lower())
print('我们的词表:', len(ours), '词')

# 找索引页：含「词汇索引」或「带*的单词」这类字样
index_pages = []
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    items = json.load(open(fp, encoding='utf-8'))
    txt = ' '.join(i.get('text', '') for i in items)
    if '词汇索引' in txt or '字母顺序编排' in txt or '自测单词掌握' in txt:
        index_pages.append((os.path.basename(fp), len(items), txt))
print('疑似索引页:', [p[0] for p in index_pages])

# 索引页格式：单词 + 页码，从左到右、从上到下。用「word 数字」成对匹配
PAIR = re.compile(r"([A-Za-z][A-Za-z'\-]{1,22})\s*[.\-–—*+]*\s*(\d{1,3})\b")
idx_words = set()
for name, n, txt in index_pages:
    for m in PAIR.finditer(txt):
        w = m.group(1).strip("'-.").lower()
        if len(w) >= 2:
            idx_words.add(w)
print('索引页抽出的单词:', len(idx_words))

miss = sorted(idx_words - ours)
print('索引里有、我们词表里没有的:', len(miss))
print('前 80 个:', miss[:80])
