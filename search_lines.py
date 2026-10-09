# -*- coding: utf-8 -*-
"""在 OCR 原始行里直接搜词，输出该行及其上下 3 行（按栏内顺序）。"""
import json, glob, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
words = [w.lower() for w in sys.argv[1:]]
cache = {}
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    pno = int(re.search(r'p(\d+)', os.path.basename(fp)).group(1))
    cache[pno] = json.load(open(fp, encoding='utf-8'))

for w in words:
    print('=' * 72)
    print('### 搜索:', w)
    found = 0
    for pno in sorted(cache):
        if pno >= 315:          # 315 之后是书末索引页，跳过
            continue
        items = cache[pno]
        for lo, hi in ((0, 500), (500, 2000)):
            col = sorted([it for it in items if lo <= it['box'][0][0] < hi],
                         key=lambda it: (it['box'][0][1], it['box'][0][0]))
            for i, it in enumerate(col):
                t = it.get('text', '')
                if re.search(r'\b' + re.escape(w) + r'\b', t, re.I) and re.search(r'[/／]', t):
                    found += 1
                    if found > 4:
                        break
                    print('--- p%03d[%s] ---' % (pno, 'L' if lo == 0 else 'R'))
                    for j in range(max(0, i - 2), min(len(col), i + 5)):
                        print('   %s %s' % ('>>' if j == i else '  ', col[j].get('text', '')[:160]))
            if found > 4:
                break
        if found > 4:
            break
    if not found:
        print('   (没有任何带音标的行命中)')
