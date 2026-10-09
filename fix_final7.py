# -*- coding: utf-8 -*-
"""第五批：清掉尾部粘上页脚励志句的 11 条，并删掉 1 条词头认错的垃圾条目。

rite 这条的释义其实是 favourite 的——旧解析把「favo(u)rite」词尾的 rite 当成了词头，
书上并没有 rite 这个独立词条，所以整条删掉。
"""
import csv, os, io

BASE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
TSV = os.path.join(BASE, 'output', 'builtin_cet6.tsv')

FIX = {
    'occupational': '职业的',
    'retrospective': '回顾的；有追溯效力的',
    'warrant': '授权令；许可；正当理由；需要；值得；保证（某物是真的）',
    'accent': '口音；重音；强调；特点；重读',
    'expenditure': '花费；开支；耗费',
    'granted': '的确；诚然',
    'bout': '一场，一次；比赛；（疾病的）发作',
    'exciting': '令人激动的；使人兴奋的',
    'flow': '流动；不断供应',
    'land': '陆地；土地；着陆；靠岸；降临；跌落',
    'stout': '肥胖的；粗壮结实的；顽强的',
}
DELETE = {'rite'}

rows = list(csv.reader(open(CSV, encoding='utf-8-sig', newline='')))
head, body = rows[0], rows[1:]
out, hits, dropped = [], [], []
for lemma, meaning in body:
    k = lemma.strip().lower()
    if k in DELETE:
        dropped.append((lemma, meaning)); continue
    if k in FIX:
        if meaning != FIX[k]:
            hits.append((lemma, meaning, FIX[k]))
        out.append([lemma, FIX[k]])
    else:
        out.append([lemma, meaning])

print('改写 %d 条，删除 %d 条，剩余 %d 词' % (len(hits), len(dropped), len(out)))
for w, old, new in hits:
    print('  %-16s %s' % (w, old[:50]))
    print('  %-16s → %s' % ('', new))
for w, m in dropped:
    print('  删除 %-13s %s' % (w, m[:46]))

seen, dup = set(), []
for l, _ in out:
    if l.lower() in seen:
        dup.append(l)
    seen.add(l.lower())
assert not dup, dup

with open(CSV, 'w', encoding='utf-8-sig', newline='') as f:
    wr = csv.writer(f); wr.writerow(head); wr.writerows(out)
with io.open(TSV, 'w', encoding='utf-8', newline='\n') as f:
    for l, m in out:
        f.write('%s\t%s\n' % (l, m))
print('已写回 CSV 共 %d 词，重建 TSV %.0f KB' % (len(out), os.path.getsize(TSV) / 1024))
