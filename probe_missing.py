# -*- coding: utf-8 -*-
"""抽查：索引里的 abandon / ability 指向哪一页，那页的 OCR 里有没有释义。"""
import json, glob, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
PAIR = re.compile(r"([A-Za-z][A-Za-z'\-]{1,24})\s*[-–—*+]{0,2}\s*/\s*(\d{1,3})\b")

targets = {'abandon', 'ability', 'able', 'adult', 'zinc'}
found = {}
p001idx = {}
for fp in sorted(glob.glob(os.path.join(CACHE, 'p03*.json'))):
    items = json.load(open(fp, encoding='utf-8'))
    for i, it in enumerate(items):
        for m in PAIR.finditer(it.get('text', '')):
            w = m.group(1).strip("'-.").lower()
            if w in targets and w not in found:
                found[w] = (m.group(2), os.path.basename(fp), i, it.get('text', ''))
for w, v in found.items():
    print(w, '→ 书页', v[0], ' 出现在', v[1], '第', v[2], '行: ', v[3][:120])

print('\n--- 翻到被指向的书页，看 OCR 原样 ---')
# 书页号 → PDF 页号：先看几个已知锚点。取索引指向的页号，在 p0001~p0338 里找
for w, v in found.items():
    page = int(v[0])
    for delta in range(-40, 60):
        pdfp = page + delta
        fp = os.path.join(CACHE, 'p%04d.json' % pdfp)
        if not os.path.exists(fp):
            continue
        items = json.load(open(fp, encoding='utf-8'))
        txt = '\n'.join(i.get('text', '') for i in items)
        if re.search(r'\b%s\b\s*/\s*[a-z\'\u02c8\u02cc]' % w, txt, re.I):
            print('\n[%s] 书页%s → PDF p%04d' % (w, page, pdfp))
            for line in txt.split('\n'):
                if re.search(r'\b%s\b' % w, line, re.I):
                    print('   ', line[:160])
            break
