# -*- coding: utf-8 -*-
import json, glob, os, re
BASE = os.path.dirname(os.path.abspath(__file__))
PAIR = re.compile(r"([A-Za-z][A-Za-z'\-]{1,22})\s*[.\-–—*+]*\s*(\d{1,3})\b")
rows = []
for fp in sorted(glob.glob(os.path.join(BASE, '_ocrcache', '*.json'))):
    items = json.load(open(fp, encoding='utf-8'))
    txt = ' '.join(i.get('text', '') for i in items)
    n = len(PAIR.findall(txt))
    rows.append((n, os.path.basename(fp), txt[:150].replace('\n', ' ')))
rows.sort(reverse=True)
print('--- 词+页码 成对最多的 15 页 ---')
for n, name, s in rows[:15]:
    print(n, name, '|', s[:90])
print()
print('--- 含 allegedly 的页 ---')
for fp in sorted(glob.glob(os.path.join(BASE, '_ocrcache', '*.json'))):
    txt = ' '.join(i.get('text', '') for i in json.load(open(fp, encoding='utf-8')))
    if 'allegedly' in txt:
        print(os.path.basename(fp), '|', txt[:200])
