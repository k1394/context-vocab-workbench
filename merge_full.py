# -*- coding: utf-8 -*-
"""合并 part1-4 → 最终两列词表，并做一轮轻量清洗 + 质量统计。"""
import csv, os, re, glob, json, collections

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'output')

CJK = re.compile(r'[\u4e00-\u9fff]')
LEMMA_OK = re.compile(r"^[A-Za-z][A-Za-z'\-\. ]{0,26}$")
# 页脚/栏目说明，命中即截断
FOOTER_CUT = ('按考频划分', '按词频划分', '划线释义', '为重点释义', '重点释义',
              '真题例句', '经典例句', '题例句', '单词的释义', '释义及用法',
              '词群导图', '使用说明', '词以群记', '本单元已学习', 'Congratulations',
              '公众号', '微信', '扫码', '过目不忘', '一图揭示')

rows = []
for p in ['part1.csv', 'part2.csv', 'part3.csv', 'part4.csv']:
    fp = os.path.join(OUT, p)
    with open(fp, encoding='utf-8-sig', newline='') as f:
        r = csv.reader(f)
        header = next(r)
        n = 0
        for row in r:
            if len(row) < 2:
                continue
            rows.append((row[0].strip(), row[1].strip(), p))
            n += 1
        print(f'{p}: {n} 行 (表头 {header})')

print('合并总计:', len(rows))

def clean_meaning(lemma, meaning):
    m = meaning
    # 截断页脚
    for cut in FOOTER_CUT:
        i = m.find(cut)
        if i > 0:
            m = m[:i]
    m = m.strip(' ·•.\t')
    # 去掉开头的「本词重复」噪声：hail；... / hail, ...
    lm = re.escape(lemma)
    m = re.sub(r'^(?:%s)\s*[；;,，/]\s*' % lm, '', m, flags=re.I)
    m = re.sub(r'^(?:%s)\s*[&＆]\s*[；;,，/]?\s*' % lm, '', m, flags=re.I)
    m = re.sub(r'^[&＆]\s*[；;,，/]\s*', '', m)
    m = re.sub(r'\s+', ' ', m).strip(' ·•.\t')
    return m

seen = {}
order = []
stats = collections.Counter()
susp = []
for lemma, meaning, src in rows:
    if not lemma or not LEMMA_OK.match(lemma):
        stats['lemma 形状不合格'] += 1
        susp.append((lemma, meaning, 'lemma形状'))
        continue
    if re.search(r'\d', lemma):
        stats['lemma 含数字'] += 1
        continue
    m = clean_meaning(lemma, meaning)
    if not m:
        stats['释义为空'] += 1
        continue
    if not CJK.search(m):
        stats['释义无中文'] += 1
        susp.append((lemma, m, '无中文'))
        continue
    key = lemma.lower()
    if key in seen:
        stats['重复词'] += 1
        if len(m) > len(seen[key]):
            seen[key] = m
        continue
    seen[key] = m
    order.append(key)

print('清洗统计:', dict(stats))
print('最终词数:', len(order))

final = os.path.join(OUT, '六级单词书_刘晓燕.csv')
with open(final, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['lemma', 'meaning'])
    for k in order:
        w.writerow([k, seen[k]])
print('写出:', final)

print('--- 可疑样本(前25) ---')
for s in susp[:25]:
    print(s)
print('--- 随机中段样本 ---')
for k in order[1200:1215]:
    print(k, '|', seen[k])
with open(os.path.join(OUT, 'merge_report.json'), 'w', encoding='utf-8') as f:
    json.dump({'rows': len(rows), 'final': len(order), 'stats': dict(stats),
               'susp': susp[:200]}, f, ensure_ascii=False, indent=1)
