# -*- coding: utf-8 -*-
"""对比：旧的全量缓存 CSV（6列，带 unit 页号）里的词，是否都还在新的 5206 词表里。"""
import csv, os, re, collections

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'output')

def load(path):
    d = {}
    with open(path, encoding='utf-8-sig', newline='') as f:
        r = csv.reader(f)
        next(r, None)
        for row in r:
            if len(row) >= 2 and row[0].strip():
                d[row[0].strip().lower()] = row[1].strip()
    return d

old = load(os.path.join(OUT, 'all_cache_full.csv'))
new = load(os.path.join(OUT, '六级单词书_刘晓燕.csv'))
print('旧表 all_cache_full.csv:', len(old), '新表:', len(new))
missing = [k for k in old if k not in new]
print('旧有新无（可能丢失）:', len(missing))
for k in missing[:40]:
    print('  ', k, '|', old[k][:60])
extra = [k for k in new if k not in old]
print('新有旧无:', len(extra))

# 页号分布
units = collections.Counter()
with open(os.path.join(OUT, 'all_cache_full.csv'), encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f)
    h = next(r)
    print('旧表表头', h)
    for row in r:
        if len(row) >= 6:
            units[row[5]] += 1
def key(u):
    m = re.search(r'(\d+)', u or '')
    return int(m.group(1)) if m else 9999
ks = sorted(units, key=key)
print('旧表覆盖页范围:', ks[0] if ks else None, '→', ks[-1] if ks else None, '共', len(ks), '页')
print('每页词条数样例:', [(k, units[k]) for k in ks[:5]], '...', [(k, units[k]) for k in ks[-5:]])
