# -*- coding: utf-8 -*-
"""给语境背单词工作台注入 PDF 导入能力（内联 pdf.js + 中文 CMap，无外部依赖）

用法：
  python patch_pdf.py                       # 默认 index.html.bak -> index.html（本地版）
  python patch_pdf.py --input X --output Y  # 对任意版本打补丁（例如线上托管版本）
"""
import argparse
import io, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))

_p = argparse.ArgumentParser()
_p.add_argument('--input', default=os.path.join(BASE, 'index.html.bak'))
_p.add_argument('--output', default=os.path.join(BASE, 'index.html'))
ARGS = _p.parse_args()
HTML = ARGS.input
OUTPATH = ARGS.output

def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)

html = read(HTML)
orig_len = len(html)
reps = []

def rep(old, new, tag):
    global html
    if old not in html:
        print('[FAIL] 未找到锚点: ' + tag)
        sys.exit(1)
    n = html.count(old)
    if n != 1:
        print('[FAIL] 锚点不唯一(%d): %s' % (n, tag))
        sys.exit(1)
    html = html.replace(old, new)
    reps.append(tag)

# ---- T1 学习资料上传区文案（锚点不含缩进，兼容平台重排后的属性顺序）----
rep(u'拖拽 TXT 文件到此处，或点击选择',
    u'拖拽 TXT / PDF 文件到此处，或点击选择',
    'T1 material zone text')

# ---- T2 单词书上传区文案 ----
rep(u'拖拽 CSV/TXT 单词书文件到此处，或点击选择',
    u'拖拽 CSV / TXT / PDF 单词书到此处，或点击选择',
    'T2 wordbook zone text')

# ---- T3 单词书 file input 接受 pdf ----
rep(u'accept=".csv,.txt,.xlsx"',
    u'accept=".csv,.txt,.xlsx,.pdf"',
    'T3 wordbook accept')

# ---- T4 toast 支持自定义时长（PDF 解析耗时较长） ----
rep(u"""function toast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type||'');
  setTimeout(function() { t.className = 'toast'; }, 2500);
}""",
    u"""function toast(msg, type, duration) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type||'');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { t.className = 'toast'; }, duration || 2500);
}""",
    'T4 toast duration')

# ---- T5 上传资料弹窗说明 ----
rep(u'<p style="font-size:12px;color:var(--text3)">支持 TXT 直接上传。PDF/DOCX 请先转为纯文本后粘贴。</p>',
    u'<p style="font-size:12px;color:var(--text3)">支持 TXT / PDF 直接上传（PDF 自动提取文字并按页分章）。DOCX 请先转为纯文本后粘贴。</p>',
    'T5 material modal hint')

# ---- T6 导入单词书弹窗说明 ----
rep(u'<p style="font-size:12px;color:var(--text3)">支持 CSV/TXT。XLSX 请先转为 CSV。</p>',
    u'<p style="font-size:12px;color:var(--text3)">支持 CSV / TXT / PDF（PDF 自动提取词表行，可在下一步核对字段）。XLSX 请先转为 CSV。</p>',
    'T6 wordbook modal hint')

# ---- T7 handleFileUpload 增加 PDF 分支 ----
rep(u"""  var file = files[0];
  if (file.size > 10 * 1024 * 1024) { toast('文件过大（超过 10MB）', 'err'); return; }
  var reader = new FileReader();""",
    u"""  var file = files[0];
  if (isPdfFile(file)) { handlePdfUpload(file, type); return; }
  if (file.size > 10 * 1024 * 1024) { toast('文件过大（超过 10MB）', 'err'); return; }
  var reader = new FileReader();""",
    'T7 upload pdf branch')

# ---- T8 handleFileText 去掉 PDF 拒绝分支 ----
rep(u"""    if (type === 'material') {
      if (file.name.match(/\\.pdf$/i)) {
        toast('PDF 文件请先转为纯文本后粘贴', 'err');
        showUploadModal('material');
        return;
      }
      if (file.name.match(/\\.docx$/i)) {""",
    u"""    if (type === 'material') {
      if (file.name.match(/\\.docx$/i)) {""",
    'T8 drop pdf reject')

# ---- T9 parseCSV：支持 Tab 分列 + 更准的表头/数据判定 ----
rep(u"""  var lines = text.split(/\\r?\\n/).filter(function(l) { return l.trim(); });
  if (lines.length < 2) return { headers: [], rows: [] };
  // 简易 CSV 解析（支持逗号分隔，不处理引号内逗号）
  function parseLine(line) {
    var result = [];
    var cur = '';
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { inQuote = !inQuote; }
      else if (c === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    result.push(cur.trim());
    return result;
  }
  var headers = parseLine(lines[0]);
  var rows = [];
  // 无表头检测：首行所有单元格都像词条（含音标[..]或编号前缀）→ 首行其实是数据
  var looksLikeEntry = headers.length > 0 && headers.every(function(c) { return /\\[[^\\]]*\\]|^\\d+\\s*[\\.、]/.test(c); });
  var startIdx = 1;
  if (looksLikeEntry) {
    headers = headers.map(function(_, i) { return '列' + (i + 1); });
    startIdx = 0;
  }""",
    u"""  var lines = text.split(/\\r?\\n/).filter(function(l) { return l.trim(); });
  if (lines.length < 1) return { headers: [], rows: [] };
  // 简易 CSV 解析（支持逗号 / Tab 分隔，不处理引号内逗号）
  function parseLine(line) {
    var result = [];
    var cur = '';
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { inQuote = !inQuote; }
      else if ((c === ',' || c === '\\t') && !inQuote) { result.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    result.push(cur.trim());
    return result;
  }
  var headers = parseLine(lines[0]);
  var rows = [];
  // 无表头检测：首行单元格若不像「字段名」，说明首行其实是数据行（PDF / 纯文本词表常见）
  var headerWords = ['lemma','word','单词','英文','词汇','英语','词条','词','pos','词性','属性','ipa','phonetic','音标','发音','meaning','释义','中文','意思','翻译','汉语','解释','词义','example','例句','示例','句子','unit','单元','标签','分类','chapter','课'];
  var looksLikeHeader = headers.length > 0 && headers.every(function(c) {
    var t = String(c || '').toLowerCase().replace(/^\\d+[\\.、\\s]*/, '').trim();
    if (!t) return true;
    if (/^列\\d+$/.test(t)) return true;
    for (var w = 0; w < headerWords.length; w++) { if (t === headerWords[w] || t.indexOf(headerWords[w]) !== -1) return true; }
    return false;
  });
  var startIdx = 1;
  if (!looksLikeHeader) {
    headers = headers.map(function(_, i) { return '列' + (i + 1); });
    startIdx = 0;
  }""",
    'T9 parseCSV')

# ---- T10 showFieldMap：猜不出时默认第一列作单词列 ----
rep(u"    if (!guessed && parsed.headers.length === 1 && f === 'lemma') guessed = parsed.headers[0]; // 单列文件自动归为单词列",
    u"    if (!guessed && f === 'lemma' && parsed.headers.length > 0) guessed = parsed.headers[0]; // 猜不出时默认第一列为单词列（PDF 提取的文本常无表头）",
    'T10 fieldmap default lemma')

# ---- T11 资料列表来源标签 ----
rep(u"""<div class="meta">' + (m.sourceType||'TXT') + ' · ' + chs.length + ' 章 · ' + (m.rawContent||'').length + ' 字</div>""",
    u"""<div class="meta">' + (m.importedFrom === 'pdf' ? 'PDF导入' : (m.sourceType === 's_manual' ? '手动输入' : 'TXT导入')) + (m.pageCount ? '（' + m.pageCount + ' 页）' : '') + ' · ' + chs.length + ' 章 · ' + (m.rawContent||'').length + ' 字</div>""",
    'T11 material source label')

# ---- T12 注入 PDF 内核 ----
pdfjs = read(os.path.join(BASE, 'vendor', 'pdf.min.js'))
worker = read(os.path.join(BASE, 'vendor', 'pdf.worker.min.js'))
cmaps = read(os.path.join(BASE, 'cmaps_inline.js'))
support = read(os.path.join(BASE, 'pdf_support.js'))
support = support.replace(u"""function fileToText(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('文件读取失败')); };
    reader.onload = function (e) { resolve(e.target.result); };
    reader.readAsText(file, 'UTF-8');
  });
}
""", u'')

worker_blob = worker

for name, code in (('pdf.min.js', pdfjs), ('pdf.worker.min.js', worker_blob),
                   ('cmaps_inline.js', cmaps), ('pdf_support.js', support)):
    if '</script' in code.lower():
        print('[FAIL] 内联代码含 </script，不安全: ' + name)
        sys.exit(1)

inject = (
    u'\n<!-- ===== PDF 导入支持：内联 pdf.js 内核 + 中文 CMap 映射表（Apache-2.0, Mozilla / Adobe），无任何外部依赖 ===== -->\n'
    u'<script id="pdfjsWorkerCode" type="text/plain">\n' + worker_blob + u'\n</script>\n'
    u'<script>\n' + pdfjs + u'\n</script>\n'
    u'<script>\n' + cmaps + u'\n</script>\n'
    u'<script>\n' + support + u'\n'
    u"if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initPdfSupport); } else { initPdfSupport(); }\n"
    u'</script>\n'
)

rep(u'</body>\n</html>', inject + u'</body>\n</html>', 'T12 inject pdf core')

write(OUTPATH, html)
print('OK  共完成 %d 处修改  [%s -> %s]' % (len(reps), os.path.basename(HTML), os.path.basename(OUTPATH)))
print('体积: %d -> %d 字节 (%.2f MB)' % (orig_len, len(html), len(html) / 1024.0 / 1024.0))
