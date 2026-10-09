# -*- coding: utf-8 -*-
"""主表(5201) + 补抽(1946) → 最终《六级词书》词表，并生成供内嵌用的 TSV。"""
import csv, os, collections

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'output')

def load(path):
    d = collections.OrderedDict()
    with open(os.path.join(OUT, path), encoding='utf-8-sig', newline='') as f:
        r = csv.reader(f); next(r)
        for a, b in r:
            a = a.strip(); b = b.strip()
            if a and b and a.lower() not in d:
                d[a.lower()] = b
    return d

main = load('六级单词书_刘晓燕.csv')
ext = load('missing_clean.csv')
print('主表:', len(main), '补抽:', len(ext))

final = collections.OrderedDict(main)
added = 0
for k, v in ext.items():
    if k in final:
        continue
    final[k] = v
    added += 1
print('新增:', added, '合计:', len(final))

csv_path = os.path.join(OUT, '六级单词书_刘晓燕.csv')
with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['lemma', 'meaning'])
    for k, v in final.items():
        w.writerow([k, v])
print('写出:', csv_path)

tsv_path = os.path.join(OUT, 'builtin_cet6.tsv')
with open(tsv_path, 'w', encoding='utf-8', newline='') as f:
    for k, v in final.items():
        f.write('%s\t%s\n' % (k, v.replace('\t', ' ').replace('\n', ' ')))
print('写出:', tsv_path, '%.1f KB' % (os.path.getsize(tsv_path) / 1024))
