# -*- coding: utf-8 -*-
"""最小探针：OCR 单页，输出带坐标的文字行，用来评估识别质量与版面结构"""
import sys, io, time

from rapidocr_onnxruntime import RapidOCR

img = sys.argv[1]
engine = RapidOCR()

t0 = time.time()
res, elapse = engine(img)
print('OCR 耗时 %.2fs，检出 %d 个文本框' % (time.time() - t0, len(res or [])))
print('elapse:', elapse)
print()

if not res:
    print('!!! 没有识别到任何文字')
    sys.exit(0)

items = []
for box, text, score in res:
    pts = [(float(p[0]), float(p[1])) for p in box]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    items.append({
        'x0': min(xs), 'x1': max(xs), 'y0': min(ys), 'y1': max(ys),
        'xc': (min(xs) + max(xs)) / 2.0, 'yc': (min(ys) + max(ys)) / 2.0,
        'h': max(ys) - min(ys), 'text': text, 'score': float(score)
    })

items.sort(key=lambda a: (a['yc'], a['xc']))
print('=== 按纵坐标排序的识别结果（坐标 = 左上角像素，h = 字高）===')
for it in items:
    print('y=%6.1f x=%6.1f h=%5.1f s=%.2f │ %s' % (it['y0'], it['x0'], it['h'], it['score'], it['text']))

hs = sorted(it['h'] for it in items)
print()
print('字高分布: 最小 %.1f  中位 %.1f  最大 %.1f' % (hs[0], hs[len(hs)//2], hs[-1]))
