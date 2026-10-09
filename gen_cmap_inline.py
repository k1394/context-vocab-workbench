# -*- coding: utf-8 -*-
"""把 vendor/cmaps/*.bcmap 打包成可内联的 base64 JS（中文 CID 字体提取必需）"""
import base64, io, os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'vendor', 'cmaps')
OUT = os.path.join(BASE, 'cmaps_inline.js')

files = sorted(f for f in os.listdir(SRC) if f.endswith('.bcmap'))
lines = [
    '/* 内置中文字符映射表（CMap Resources，Adobe 开源，随 pdf.js 使用）',
    '   用途：中文 PDF 常用 CID 字体（如 STSong-Light / 宋体子集），',
    '   缺少这些映射表时 pdf.js 只能提取到数字和英文，中文会整段丢失。 */',
    'var CMAP_B64 = {'
]
total = 0
for f in files:
    name = f[:-len('.bcmap')]
    raw = io.open(os.path.join(SRC, f), 'rb').read()
    total += len(raw)
    b64 = base64.b64encode(raw).decode('ascii')
    chunks = [b64[i:i + 900] for i in range(0, len(b64), 900)]
    if len(chunks) == 1:
        lines.append('  "%s": "%s",' % (name, chunks[0]))
    else:
        lines.append('  "%s": "%s"' % (name, chunks[0]))
        lines.extend(['    + "%s"' % c for c in chunks[1:]])
        lines[-1] += ','
lines.append('};')
lines.append('')

io.open(OUT, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
print('%d 个 CMap，原始 %d 字节 → 生成 %s (%d 字节)'
      % (len(files), total, os.path.basename(OUT), os.path.getsize(OUT)))
print('包含: ' + ', '.join(f[:-6] for f in files))
