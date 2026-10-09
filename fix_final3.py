# -*- coding: utf-8 -*-
"""第三批修正：第二轮抽查时发现的 3 条（ambition / congressional / contemptible）。

原书：
  p10  ambition /æmˈbɪʃn/     n.野心；雄心，抱负
  p10  congressional /kənˈɡreʃənl/ adj.国会的；代表大会的
  p271 contemptible /kənˈtemptəbl/ adj.可鄙的；卑劣的   （OCR 把「鄙」读丢了）
"""
import csv, os, io

BASE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
TSV = os.path.join(BASE, 'output', 'builtin_cet6.tsv')

FIX = {
    'ambition': ('ambition', '野心；雄心，抱负'),
    'congressional': ('congressional', '国会的；代表大会的'),
    'contemptible': ('contemptible', '可鄙的；卑劣的'),
}

rows = list(csv.reader(open(CSV, encoding='utf-8-sig', newline='')))
head, body = rows[0], rows[1:]
hits, out = [], []
for lemma, meaning in body:
    k = lemma.strip().lower()
    if k in FIX:
        nl, nm = FIX[k]
        if nl == lemma and nm == meaning:
            raise AssertionError('%s 没变化' % k)
        hits.append((lemma, meaning, nm))
        out.append([nl, nm])
    else:
        out.append([lemma, meaning])

print('命中待修 %d 条 / 期望 %d 条' % (len(hits), len(FIX)))
missing = set(FIX) - set(h.strip().lower() for h, _ in body)
if missing:
    print('!! 没找到:', missing)
seen, dup = set(), []
for l, _ in out:
    if l.lower() in seen:
        dup.append(l)
    seen.add(l.lower())
assert not dup, dup
for old_w, old_m, new_m in hits:
    print('  %-14s %s  ->  %s' % (old_w, old_m[:34], new_m))

with open(CSV, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f); w.writerow(head); w.writerows(out)
with io.open(TSV, 'w', encoding='utf-8', newline='\n') as f:
    for l, m in out:
        f.write('%s\t%s\n' % (l, m))
print('已写回 CSV 共 %d 词，重建 TSV %.0f KB' % (len(out), os.path.getsize(TSV) / 1024))
