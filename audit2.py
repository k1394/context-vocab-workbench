# -*- coding: utf-8 -*-
import csv, os, re
BASE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
CJK = re.compile(r'[\u4e00-\u9fff]')
rows = []
with open(p, encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f); next(r)
    rows = [(a.strip(), b.strip()) for a, b in r if b.strip()]

print('==== 释义含空格的 %d 行 ====' % sum(1 for _, m in rows if ' ' in m))
for a, m in rows:
    if ' ' in m:
        print(repr(a), '|', m)

print()
print('==== 释义 >40 字 ====')
for a, m in rows:
    if len(m) > 40:
        print(repr(a), '|', m)

print()
print('==== 以音标碎片开头的行（首段含 / 且中文在其后） ====')
n = 0
for a, m in rows:
    hit = CJK.search(m)
    lead = m[:hit.start()] if hit else m
    if '/' in lead or '／' in lead:
        n += 1
        if n <= 25:
            print(repr(a), '|', m)
print('小计', n)
