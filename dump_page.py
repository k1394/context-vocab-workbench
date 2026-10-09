# -*- coding: utf-8 -*-
"""按页打印某页某栏的全部 OCR 行：python dump_page.py 321 L"""
import json, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
pno = int(sys.argv[1])
side = (sys.argv[2] if len(sys.argv) > 2 else 'LR').upper()
fp = os.path.join(CACHE, 'p%04d.json' % pno)
if not os.path.exists(fp):
    fp = os.path.join(CACHE, 'p%03d.json' % pno)
items = json.load(open(fp, encoding='utf-8'))
for lo, hi, tag in ((0, 500, 'L'), (500, 2000, 'R')):
    if tag not in side:
        continue
    col = sorted([it for it in items if lo <= it['box'][0][0] < hi],
                 key=lambda it: (it['box'][0][1], it['box'][0][0]))
    print('=========== p%d [%s] %d 行 ===========' % (pno, tag, len(col)))
    for i, it in enumerate(col):
        print('%3d y=%4.0f %s' % (i, it['box'][0][1], it.get('text', '')[:150]))
