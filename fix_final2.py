# -*- coding: utf-8 -*-
"""第二批修正：第一轮修完后抽检浮出来的 13 条。

同样逐条回原书页核对（p263 author / p264 behave / p265 blur / p282 hail /
p312 twin / p137 absurdity / p154 measure / p262 antenna / p118 dole / p183 wreck），
inclined、social、tourist 是尾部串进了书的页脚励志句。
"""
import csv, os, io

BASE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
TSV = os.path.join(BASE, 'output', 'builtin_cet6.tsv')

FIX = {
    'hail': ('hail', '赞扬；称颂；为…招手；冰雹'),
    'twin': ('twin', '孪生儿之一；孪生之一的'),
    'absurdity': ('absurdity', '荒唐；荒谬'),
    'author': ('author', '作者；发起人；编写'),
    'behave': ('behave', '表现；表现得体'),
    'blur': ('blur', '模糊的形状/记忆；变模糊，难以区分'),
    'inclined': ('inclined', '想（做某事）；有…倾向；很可能；有（某种）天赋的；倾斜的'),
    'social': ('social', '社交的；社会的；群居的；合群的；社交；联谊会；联欢会'),
    'measure': ('measure', '措施，方法；程度；判断；衡量；测量；估量，判定'),
    'tourist': ('tourist', '旅游者；观光者，游客'),
    'antenna': ('antenna', '（复数 antennae）触须，触角；（复数 antennas/antennae）天线'),
    'dole': ('dole', '失业救济金；（dole out）发放，发给；施舍'),
    'wreck': ('wreck', '沉船，失事船；遭严重损毁的车辆（飞机、火车等）；破坏，糟蹋；使毁坏；（船只）失事'),
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
print()
for old_w, old_m, new_m in hits:
    print('  %-12s %s' % (old_w, old_m[:44]))
    print('  %-12s %s' % ('   ->', new_m))

with open(CSV, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f); w.writerow(head); w.writerows(out)
with io.open(TSV, 'w', encoding='utf-8', newline='\n') as f:
    for l, m in out:
        f.write('%s\t%s\n' % (l, m))
print()
print('已写回 CSV 共 %d 词，重建 TSV %.0f KB' % (len(out), os.path.getsize(TSV) / 1024))
