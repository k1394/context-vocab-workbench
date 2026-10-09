# -*- coding: utf-8 -*-
"""生成「抽样校验」HTML：左边原书页面，右边从这页提取出的词条，方便肉眼核对"""
import base64, csv, io, os, re, sys

csv_path = sys.argv[1]
imgdir = sys.argv[2]
out_path = sys.argv[3]
pages = [int(x) for x in sys.argv[4].split(',')] if len(sys.argv) > 4 else None

rows = []
with io.open(csv_path, 'r', encoding='utf-8-sig') as f:
    for r in csv.DictReader(f):
        rows.append(r)

by_page = {}
for r in rows:
    m = re.match(r'p(\d+)', r.get('unit', '') or '')
    if m:
        by_page.setdefault(int(m.group(1)), []).append(r)

if pages is None:
    pages = sorted(by_page.keys())

parts = []
parts.append("""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>抽样校验</title><style>
body{margin:0;padding:20px;background:#f5f6f7;color:#1f2328;
 font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
h1{font-size:19px;margin:0 0 6px}
.sub{color:#5b6470;font-size:13px;margin-bottom:18px}
.page{display:flex;gap:18px;background:#fff;border:1px solid #e3e6ea;border-radius:10px;
 padding:14px;margin-bottom:18px;align-items:flex-start}
.page img{width:430px;border:1px solid #e3e6ea;border-radius:6px;display:block}
.list{flex:1;min-width:0}
.ttl{font-weight:600;margin-bottom:10px;font-size:15px}
.ttl span{font-weight:400;color:#5b6470;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border:1px solid #e3e6ea;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f0f2f4;font-weight:600;white-space:nowrap}
.w{font-weight:600;color:#1a7f37;white-space:nowrap}
.m{color:#24292f}
.empty{color:#8b949e}
</style></head><body>
<h1>抽样校验 · 原书页面 vs 提取结果</h1>
<div class="sub">左边是原书扫描页，右边是从这一页识别出的词条。若某条明显不对，说明该处 OCR 有偏差。</div>
""")

for p in pages:
    imgname = None
    for cand in ('p%04d_0.png' % p, 'p%d_0.png' % p):
        if os.path.exists(os.path.join(imgdir, cand)):
            imgname = cand
            break
    b64 = ''
    if imgname:
        with open(os.path.join(imgdir, imgname), 'rb') as f:
            b64 = base64.b64encode(f.read()).decode('ascii')
    items = by_page.get(p, [])
    parts.append('<div class="page">')
    if b64:
        parts.append('<img src="data:image/png;base64,%s" alt="第%d页">' % (b64, p))
    parts.append('<div class="list"><div class="ttl">第 %d 页 <span>· 提取出 %d 个词条</span></div>' % (p, len(items)))
    if items:
        parts.append('<table><tr><th>单词</th><th>词性</th><th>中文释义</th><th>例句</th></tr>')
        for it in items:
            ex = it.get('example', '') or ''
            parts.append('<tr><td class="w">%s</td><td>%s</td><td class="m">%s</td><td class="m">%s</td></tr>'
                         % (it.get('lemma', ''), it.get('pos', ''), it.get('meaning', ''),
                            ex if ex else '<span class="empty">—</span>'))
        parts.append('</table>')
    else:
        parts.append('<div class="empty">这一页没有提取到词条</div>')
    parts.append('</div></div>')

parts.append('</body></html>')

with io.open(out_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(parts))

print('输出: %s  (%.1f MB, %d 页)' % (out_path, os.path.getsize(out_path) / 1024.0 / 1024.0, len(pages)))
