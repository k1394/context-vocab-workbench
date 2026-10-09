# -*- coding: utf-8 -*-
"""对抽检挑出的问题词，回到 OCR 缓存里用「单栏文本流」重新取一遍。

串台的根因是左右两栏在拼接时发生了 overlap 重叠；
单栏流里每个词的释义只会撞到同栏的下一个词条，所以能拿到干净的原文。
"""
import json, glob, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
POS = r'(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr|det|exclam)'
ENTRY = re.compile(
    r'(?:口|扩|O|D)?\s*'
    r'([A-Za-z][A-Za-z\'\-]{1,24})'
    r'\s*[-–—*+]{0,3}\s*/\s*([^/\n]{1,45}?)\s*/\s*'
    r'((?:%s)\s*\.[\s\S]{2,120}?)(?=(?:口|扩)?\s*[A-Za-z][A-Za-z\'\-]{1,24}\s*[-–—*+]{0,3}\s*/|\Z)' % POS,
    re.I)

TARGETS = sys.argv[1:] or [
    'hono', 'di', 'prohibition', 'inject', 'deploy', 'compass', 'predominant',
    'faulty', 'flash', 'over', 'deductible', 'articulate', 'zigzag', 'layout',
    'eliminate', 'call', 'check', 'clockwise', 'fashionable', 'cream',
    'transplantation', 'casino', 'equator', 'breadth',
]


def col_streams(items):
    out = []
    for lo, hi in ((0, 500), (500, 2000)):
        col = [it for it in items if lo <= it['box'][0][0] < hi]
        col.sort(key=lambda it: (it['box'][0][1], it['box'][0][0]))
        out.append(('L' if lo == 0 else 'R', col))
    return out


cache = {}
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    pno = int(re.search(r'p(\d+)', os.path.basename(fp)).group(1))
    cache[pno] = json.load(open(fp, encoding='utf-8'))

for t in TARGETS:
    tl = t.lower()
    print('=' * 70)
    print('### 目标词:', t)
    hits = 0
    for pno in sorted(cache):
        for side, col in col_streams(cache[pno]):
            stream = '\n'.join(it.get('text', '') for it in col)
            for m in ENTRY.finditer(stream):
                w = m.group(1).strip("'-.").lower()
                if not (w == tl or w.startswith(tl) or tl in w):
                    continue
                hits += 1
                if hits > 6:
                    continue
                raw = m.group(0).replace('\n', ' / ')
                print('  p%03d[%s] %s' % (pno, side, raw[:230]))
                # 该条目在原始 items 里的起始行，向前后各取 2 行看上下文
                idx = None
                for i, it in enumerate(col):
                    if it.get('text', '').strip().startswith(m.group(1)[:4]):
                        idx = i
                        break
                if idx is not None:
                    for j in range(max(0, idx - 2), min(len(col), idx + 4)):
                        mark = '<' if j == idx else ' '
                        print('        %s %s' % (mark, col[j].get('text', '')[:150]))
                break
        if hits > 6:
            break
    if not hits:
        print('  (未命中)')
