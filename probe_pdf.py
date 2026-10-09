# -*- coding: utf-8 -*-
"""侦察这个 PDF：页数、加密、是否扫描件、图片占比、文字层样本"""
import sys, io, os, time
from pypdf import PdfReader

path = sys.argv[1]
size = os.path.getsize(path)
t0 = time.time()
r = PdfReader(path, strict=False)
print('文件大小: %.1f MB' % (size / 1024.0 / 1024.0))
print('页数: %d' % len(r.pages))
print('加密: %s' % r.is_encrypted)
try:
    md = r.metadata or {}
    print('元信息:', dict((k, str(v)[:60]) for k, v in md.items()))
except Exception as e:
    print('元信息读取失败:', e)
print('读取耗时: %.1fs' % (time.time() - t0))
print()

# 逐页看文字量 / 图片数（只探前若干页 + 抽样）
n = len(r.pages)
idxs = list(range(min(6, n)))
if n > 12:
    idxs += [n // 4, n // 2, int(n * 0.75), n - 1]
idxs = sorted(set(i for i in idxs if 0 <= i < n))

print('=== 抽样页诊断 ===')
for i in idxs:
    p = r.pages[i]
    try:
        txt = p.extract_text() or ''
    except Exception as e:
        txt = ''
        print('  第%d页 提取异常: %s' % (i + 1, str(e)[:80]))
    try:
        xo = p.get('/Resources', {}).get('/XObject')
        nimg = 0
        if xo:
            xo = xo.get_object()
            for k in xo:
                try:
                    if xo[k].get_object().get('/Subtype') == '/Image':
                        nimg += 1
                except Exception:
                    pass
    except Exception:
        nimg = -1
    print('  第%-5d页 文字 %7d 字符  图片 %3s 个  %s' % (
        i + 1, len(txt), nimg, repr(txt[:70])))

print()
print('=== 结论提示 ===')
