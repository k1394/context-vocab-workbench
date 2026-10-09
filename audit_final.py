# -*- coding: utf-8 -*-
"""审计最终词表里剩余的脏数据模式，量化各自占比，再决定清洗力度。"""
import csv, os, re, collections

BASE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
CJK = re.compile(r'[\u4e00-\u9fff]')

rows = []
with open(p, encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f)
    next(r)
    rows = [(a.strip(), b.strip()) for a, b in r if b.strip()]

print('总词数', len(rows))
pats = collections.Counter()
ex = collections.defaultdict(list)
for lemma, m in rows:
    if m.endswith('。'):
        pats['以句号结尾(疑似例句串入)'] += 1
        ex['以句号结尾(疑似例句串入)'].append((lemma, m))
    if '（' in m and re.search(r'（[A-Za-z][A-Za-z\s\'\-\.]{1,20}）', m):
        pats['含英文括注(可能串入)'] += 1
        ex['含英文括注(可能串入)'].append((lemma, m))
    hit = CJK.search(m)
    lead = m[:hit.start()] if hit else m
    if lead and re.search(r'[0-9]|[A-Za-z]{4,}', lead):
        pats['中文前有长英文/数字垃圾'] += 1
        ex['中文前有长英文/数字垃圾'].append((lemma, m))
    if re.match(r'^[\u2460-\u2473]', m):
        pats['以①开头'] += 1
        ex['以①开头'].append((lemma, m))
    if ' ' in m:
        pats['释义含空格(可能两段相撞)'] += 1
        ex['释义含空格(可能两段相撞)'].append((lemma, m))
    if len(m) > 40:
        pats['释义>40字'] += 1
    if re.search(r'[A-Za-z]{3,}', m.replace(lemma, '')):
        pats['释义里还有英文单词'] += 1
        ex['释义里还有英文单词'].append((lemma, m))
    if len(lemma) < 2:
        pats['lemma 只有1个字母'] += 1
        ex['lemma 只有1个字母'].append((lemma, m))

for k, v in pats.most_common():
    print(f'{k}: {v}  ({v/len(rows)*100:.1f}%)')
print()
for k in ['以句号结尾(疑似例句串入)', '以①开头', '中文前有长英文/数字垃圾', 'lemma 只有1个字母']:
    print('---', k, '---')
    for item in ex[k][:15]:
        print('   ', item)
