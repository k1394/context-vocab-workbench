# -*- coding: utf-8 -*-
"""从扫描 PDF 里导出若干页的原始位图，用来肉眼确认排版"""
import sys, os
from pypdf import PdfReader

path = sys.argv[1]
outdir = sys.argv[2]
pages = [int(x) for x in sys.argv[3].split(',')]
os.makedirs(outdir, exist_ok=True)

r = PdfReader(path, strict=False)
for pno in pages:
    i = pno - 1
    if i < 0 or i >= len(r.pages):
        print('跳过第 %d 页（越界）' % pno); continue
    page = r.pages[i]
    try:
        imgs = list(page.images)
    except Exception as e:
        print('第 %d 页 取图失败: %s' % (pno, str(e)[:80])); continue
    for k, im in enumerate(imgs):
        name = im.name or ('img%d' % k)
        ext = os.path.splitext(name)[1] or '.png'
        fn = os.path.join(outdir, 'p%04d_%d%s' % (pno, k, ext))
        with open(fn, 'wb') as f:
            f.write(im.data)
        print('第 %-4d 页 → %s  (%.0f KB, 原始名 %s)' % (pno, os.path.basename(fn), len(im.data) / 1024.0, name))
