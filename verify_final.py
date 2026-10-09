# -*- coding: utf-8 -*-
"""交付前终检：重新解析最终 CSV，逐项体检。"""
import csv, os, re, collections

BASE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
CJK = re.compile(r'[\u4e00-\u9fff]')

with open(p, 'rb') as f:
    raw = f.read()
print('文件大小: %.1f KB' % (len(raw) / 1024))
print('BOM:', raw[:3] == b'\xef\xbb\xbf')

with open(p, encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f)
    head = next(r)
    rows = [(a.strip(), b.strip()) for a, b in r]

print('表头:', head)
print('词条数:', len(rows))
dups = [k for k, v in collections.Counter(a.lower() for a, _ in rows).items() if v > 1]
print('重复词:', len(dups), dups[:5])
print('空释义:', sum(1 for _, b in rows if not b))
print('释义==单词:', sum(1 for a, b in rows if a.lower() == b.lower()))
print('释义无中文:', sum(1 for _, b in rows if not CJK.search(b)))
print('含逗号的释义:', sum(1 for _, b in rows if ',' in b))
print('lemma 全大写:', sum(1 for a, _ in rows if a.isupper()))
print('lemma 含空格/连字符:', sum(1 for a, _ in rows if ' ' in a or '-' in a))
ln = sorted(len(b) for _, b in rows)
print('释义长度 中位/95分位/最长: %d / %d / %d' % (ln[len(ln)//2], ln[int(len(ln)*0.95)], ln[-1]))

print('\n--- 关键修复项复核 ---')
for w in ['hail', 'hono', 'oversight', 'contemptible', 'congressional', 'alert',
          'banquet', 'foul', 'excuse', 'greasy', 'these', 'half', 'fulfil', 'zoology']:
    hit = [b for a, b in rows if a.lower() == w]
    print('  %-14s %s' % (w, hit[0] if hit else '(已丢弃)'))

print('\n--- 被丢弃的行 ---')
import glob
allrows = []
for f2 in ['part1.csv', 'part2.csv', 'part3.csv', 'part4.csv']:
    with open(os.path.join(BASE, 'output', f2), encoding='utf-8-sig', newline='') as fh:
        rd = csv.reader(fh); next(rd)
        for a, b in rd:
            if a.strip() and b.strip():
                allrows.append((a.strip(), b.strip()))
keep = set(a.lower() for a, _ in rows)
gone = [(a, b) for a, b in allrows if a.lower() not in keep]
print('原始 %d → 最终 %d，丢弃/合并 %d' % (len(allrows), len(rows), len(allrows) - len(rows)))
for a, b in gone:
    print('   -', a, '|', b[:60])
