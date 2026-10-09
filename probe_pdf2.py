# -*- coding: utf-8 -*-
"""确认是否为整页扫描图：看图片尺寸是否≈整页、内容流里有没有文字绘制指令"""
import sys
from pypdf import PdfReader
from pypdf.generic import IndirectObject

path = sys.argv[1]
r = PdfReader(path, strict=False)
n = len(r.pages)

def imgs_of(page):
    out = []
    try:
        xo = page.get('/Resources', {}).get('/XObject')
        if not xo:
            return out
        for k in xo.get_object():
            o = xo[k].get_object()
            if o.get('/Subtype') == '/Image':
                out.append(o)
            elif o.get('/Subtype') == '/Form':
                # 表单里可能还嵌图
                inner = o.get('/Resources', {}).get('/XObject')
                if inner:
                    for k2 in inner.get_object():
                        o2 = inner[k2].get_object()
                        if o2.get('/Subtype') == '/Image':
                            out.append(o2)
    except Exception as e:
        pass
    return out

print('=== 抽样页的图片尺寸与页面尺寸 ===')
for i in [0, 1, 100, 200, n - 1]:
    if i >= n: continue
    p = r.pages[i]
    mb = p.mediabox
    pw = float(mb.width); ph = float(mb.height)
    ims = imgs_of(p)
    print('第 %-4d 页  页面 %.0f×%.0f pt' % (i + 1, pw, ph))
    for o in ims[:3]:
        w = o.get('/Width'); h = o.get('/Height')
        cs = o.get('/ColorSpace'); flt = o.get('/Filter')
        print('        图片 %s×%s  cs=%s  filter=%s' % (w, h, cs, flt))

print()
print('=== 内容流里有没有文字绘制指令 ===')
ops = [b'Tj', b'TJ', b"'", b'"']
for i in [0, 1, n // 2, n - 1]:
    if i >= n: continue
    try:
        data = r.pages[i].get_contents()
        if data is None:
            print('第 %d 页 内容流为空' % (i + 1)); continue
        raw = data.get_data() if hasattr(data, 'get_data') else b''
    except Exception as e:
        print('第 %d 页 内容流读取失败: %s' % (i + 1, str(e)[:60])); continue
    found = [o.decode() for o in ops if o in raw]
    # 统计 Do（画图）次数
    n_do = raw.count(b' Do')
    print('第 %-4d 页 内容流 %7d 字节  文字指令=%s  画图指令Do=%d 次'
          % (i + 1, len(raw), found if found else '无', n_do))

print()
print('=== 全部页面的文字量统计（只看有没有字，不提取全文）===')
tot = 0
empty = 0
step = max(1, n // 20)
for i in range(0, n, step):
    t = r.pages[i].extract_text() or ''
    tot += len(t)
    if len(t) == 0:
        empty += 1
sampled = len(range(0, n, step))
print('抽样 %d 页，其中 %d 页文字为空，合计 %d 字符' % (sampled, empty, tot))
