/* ===== PDF 导入支持（内联 pdf.js 3.11.174 内核，零外部依赖） ===== */
var PDF_SUPPORT = { ready: false, reason: '' };

function initPdfSupport() {
  try {
    if (typeof pdfjsLib === 'undefined') { PDF_SUPPORT.reason = '解析内核未加载'; return; }
    var el = document.getElementById('pdfjsWorkerCode');
    if (!el) { PDF_SUPPORT.reason = '缺少解析线程'; return; }
    var src = el.textContent || el.innerText || '';
    if (!src || src.length < 100) { PDF_SUPPORT.reason = '解析线程内容为空'; return; }
    var url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    // worker 源用 blob URL；若浏览器环境禁止 worker，pdf.js 会自动退回主线程解析
    pdfjsLib.GlobalWorkerOptions.workerSrc = url;
    PDF_SUPPORT.ready = true;
  } catch (e) {
    PDF_SUPPORT.reason = (e && e.message) ? e.message : '初始化异常';
  }
}

function isPdfFile(file) {
  if (!file) return false;
  if (/\.pdf$/i.test(file.name || '')) return true;
  return file.type === 'application/pdf';
}

// 中文 CMap（中文字符映射表）：中文 PDF 常用 CID 字体（宋体/黑体子集、STSong-Light 等），
// 字码到汉字的对应关系存在 CMap 表里。缺表时 pdf.js 只能提取出英文和数字，中文整段丢失。
// 这里用一个自定义读取工厂，直接从页面内存里取表 —— 既不发网络请求，也不依赖外部文件。
// 传了自定义工厂后，pdf.js 会把二进制数据的读取交回主线程执行（useWorkerFetch 自动为 false）。
function cmapB64ToBytes(b64) {
  var bin = atob(b64);
  var n = bin.length;
  var bytes = new Uint8Array(n);
  for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function InlineCMapReaderFactory() {}

InlineCMapReaderFactory.prototype.fetch = function (params) {
  var key = String((params && params.name) || '').replace(/\.bcmap$/i, '');
  var table = (typeof CMAP_B64 !== 'undefined') ? CMAP_B64 : null;
  if (!table || !table[key]) return Promise.reject(new Error('未内置字符映射表：' + key));
  var binary = (typeof pdfjsLib !== 'undefined' && pdfjsLib.CMapCompressionType)
    ? pdfjsLib.CMapCompressionType.BINARY : 1;
  return Promise.resolve({
    cMapData: cmapB64ToBytes(table[key]),
    compressionType: binary,
    isCompressed: true
  });
};

// 把 pdf.js 的 textContent items 还原成带换行/分列的纯文本
// 行判定：y 坐标跳变 > 2.5pt 或 item 带 hasEOL，即为换行
// 列判定：同一行内 x 间距 > 1.6 倍字高，视为分列（输出 Tab，便于词表按列解析）
function pdfItemsToText(items) {
  var lines = [], cur = null, i, it, tr, y;
  for (i = 0; i < items.length; i++) {
    it = items[i];
    if (!it || typeof it.str !== 'string') continue;
    tr = it.transform || [1, 0, 0, 1, 0, 0];
    y = tr[5];
    if (!cur || Math.abs(y - cur.y) > 2.5) { cur = { y: y, parts: [] }; lines.push(cur); }
    if (it.str.length) cur.parts.push({ x: tr[4], w: it.width || 0, h: it.height || 10, s: it.str });
    if (it.hasEOL) cur = null;
  }
  var out = [];
  for (i = 0; i < lines.length; i++) {
    var parts = lines[i].parts;
    if (!parts.length) { out.push(''); continue; }
    parts.sort(function (a, b) { return a.x - b.x; });
    var s = '', prevEnd = null;
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];
      if (prevEnd !== null) {
        var gap = p.x - prevEnd;
        var h = p.h || 10;
        if (gap > h * 1.6) s += '\t';
        else if (gap > Math.max(1.2, h * 0.18) && !/\s$/.test(s) && !/^\s/.test(p.s)) s += ' ';
      }
      s += p.s;
      prevEnd = p.x + (p.w || 0);
    }
    out.push(s.replace(/[ \t]+$/, ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// 去掉页首/页尾孤立的页码行
function cleanPdfPageText(t) {
  var lines = (t || '').split('\n');
  while (lines.length && /^\s*\d{1,4}\s*$/.test(lines[lines.length - 1])) lines.pop();
  while (lines.length && /^\s*\d{1,4}\s*$/.test(lines[0])) lines.shift();
  return lines.join('\n').trim();
}

// 读取 PDF → { text, pages, pageTexts, scannedRatio }
function extractPdfText(file) {
  return new Promise(function (resolve, reject) {
    if (!PDF_SUPPORT.ready) {
      reject(new Error('PDF 解析组件未就绪' + (PDF_SUPPORT.reason ? '（' + PDF_SUPPORT.reason + '）' : '')));
      return;
    }
    var fr = new FileReader();
    fr.onerror = function () { reject(new Error('文件读取失败')); };
    fr.onload = function () {
      var data;
      try { data = new Uint8Array(fr.result); } catch (e) { reject(new Error('文件内容无法读取')); return; }
      var opt = {
        data: data,
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
        CMapReaderFactory: InlineCMapReaderFactory
      };
      if (pdfjsLib.VerbosityLevel) opt.verbosity = pdfjsLib.VerbosityLevel.ERRORS;
      pdfjsLib.getDocument(opt).promise.then(function (pdf) {
        var total = pdf.numPages, pageTexts = new Array(total), idx = 0;
        function next() {
          if (idx >= total) {
            var cleaned = [], all = [], empty = 0;
            for (var i = 0; i < total; i++) {
              var t = cleanPdfPageText(pageTexts[i] || '');
              cleaned.push(t);
              if (t.replace(/\s/g, '').length < 20) empty++;
              if (t) all.push(t);
            }
            resolve({
              text: all.join('\n\n'),
              pages: total,
              pageTexts: cleaned,
              scannedRatio: total ? empty / total : 1
            });
            return;
          }
          var n = idx++;
          pdf.getPage(n + 1).then(function (page) {
            return page.getTextContent().then(function (tc) {
              pageTexts[n] = pdfItemsToText(tc.items);
              next();
            });
          }).catch(function () { pageTexts[n] = ''; next(); });
        }
        next();
      }).catch(function (err) { reject(err); });
    };
    fr.readAsArrayBuffer(file);
  });
}

// 把 PDF 失败原因翻译成中文人话
function pdfErrorText(err) {
  var name = (err && err.name) || '';
  var m = (err && err.message) ? err.message : '';
  if (name === 'PasswordException' || /password/i.test(m)) return '该 PDF 有密码保护，请先解除密码后再上传';
  if (name === 'InvalidPDFException') return 'PDF 文件损坏或格式不受支持';
  if (name === 'MissingPDFException') return '无法读取该 PDF 文件';
  return 'PDF 解析失败：' + (m || '未知错误');
}

// 学习资料：按页合并成章，单章目标约 1800 字，总章数上限 30
function splitPagesIntoChapters(pageTexts) {
  var pages = [], i;
  for (i = 0; i < (pageTexts || []).length; i++) {
    var t = (pageTexts[i] || '').trim();
    if (t) pages.push({ idx: i + 1, text: t });
  }
  if (!pages.length) return [];
  if (pages.length === 1) {
    return [{ id: uid('ch'), title: '全文', order: 0, content: pages[0].text, targetWords: 10, generated: false }];
  }
  function build(target) {
    var groups = [], cur = null;
    for (var j = 0; j < pages.length; j++) {
      var len = pages[j].text.length;
      if (!cur || cur.len + len > target) {
        cur = { from: pages[j].idx, to: pages[j].idx, text: pages[j].text, len: len };
        groups.push(cur);
      } else {
        cur.text += '\n\n' + pages[j].text;
        cur.to = pages[j].idx;
        cur.len += len;
      }
    }
    return groups;
  }
  // 目标单章 1800 字；若因此超出 30 章上限，逐步放宽目标直到收敛
  var target = 1800;
  var groups = build(target);
  var guard = 0;
  while (groups.length > 30 && guard++ < 12) {
    target = Math.ceil(target * (groups.length / 30) * 1.05);
    groups = build(target);
  }
  return groups.map(function (g, k) {
    var title = (g.from === g.to) ? ('第 ' + g.from + ' 页') : ('第 ' + g.from + '–' + g.to + ' 页');
    return { id: uid('ch'), title: title, order: k, content: g.text, targetWords: 10, generated: false };
  });
}

function handlePdfUpload(file, type) {
  if (file.size > 40 * 1024 * 1024) { toast('PDF 过大（超过 40MB），建议先拆分或压缩后再上传', 'err'); return; }
  toast('正在解析 PDF：' + file.name + ' …', '', 120000);
  extractPdfText(file).then(function (res) {
    var chars = (res.text || '').replace(/\s/g, '').length;
    if (chars < 20) {
      if (res.scannedRatio > 0.5) {
        toast('这是扫描版 PDF（整页为图片、没有文字层），无法提取文字。请改用文字版 PDF，或先用 OCR 转成文字', 'err', 6000);
      } else {
        toast('未从该 PDF 提取到可用文字，请检查文件内容', 'err', 5000);
      }
      return;
    }
    if (type === 'material') handlePdfMaterial(res, file);
    else handlePdfWordbook(res, file);
  }).catch(function (err) { toast(pdfErrorText(err), 'err', 6000); });
}

function handlePdfMaterial(res, file) {
  var title = (file.name || 'PDF 资料').replace(/\.pdf$/i, '');
  var parsed = parseTXT(res.text);
  var chapters = (parsed.chapters && parsed.chapters.length >= 2) ? parsed.chapters : splitPagesIntoChapters(res.pageTexts);
  if (!chapters.length) { toast('未从 PDF 中解析出可学习的内容', 'err'); return; }
  var matId = uid('mat');
  var material = {
    id: matId, title: title, sourceType: 's_txt', importedFrom: 'pdf',
    rawContent: res.text, chapters: chapters, chapterCount: chapters.length,
    pageCount: res.pages, createdAt: nowISO(), updatedAt: nowISO()
  };
  STATE.materials.push(material);
  STATE.chapters[matId] = chapters;
  saveLocal();
  syncMaterialToCloud(material);
  chapters.forEach(function (ch) { syncChapterToCloud(matId, ch); });
  var matchCount = regenerateMatchesForMaterial(matId);
  toast('PDF 已导入：' + res.pages + ' 页 → ' + chapters.length + ' 章 · 生成 ' + matchCount + ' 个语境匹配', 'ok', 5000);
  refreshAll();
}

// 估算「像标准词条」的行占比：行首是短英文词，且整行不太长
function pdfWordbookQuality(parsed) {
  var rows = (parsed && parsed.rows) || [];
  if (!rows.length) return 0;
  var key = parsed.headers[0];
  var ok = 0;
  for (var i = 0; i < rows.length; i++) {
    var v = String(rows[i][key] || '').trim();
    if (!v) continue;
    if (v.length < 80 && /^[A-Za-z][A-Za-z\-'\. ]{0,24}/.test(v)) ok++;
  }
  return ok / rows.length;
}

function handlePdfWordbook(res, file) {
  var parsed = parseCSV(res.text);
  var fileName = (file.name || 'PDF 单词书').replace(/\.pdf$/i, '.txt');
  if (!parsed.rows.length) {
    toast('未从 PDF 中解析到词条行，请在弹窗中手动核对字段映射', 'err', 5000);
  } else {
    var q = pdfWordbookQuality(parsed);
    if (q < 0.5) {
      toast('注意：仅约 ' + Math.round(q * 100) + '% 的行像标准词条，可能选错了 PDF（例如选成了正文型资料）。已解析 ' + res.pages + ' 页 / ' + parsed.rows.length + ' 行，请对照预览确认', 'err', 9000);
    } else {
      toast('PDF 已解析：' + res.pages + ' 页 · ' + parsed.rows.length + ' 行，请确认字段映射', 'ok', 5000);
    }
  }
  showFieldMap(parsed, fileName);
}

function fileToText(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('文件读取失败')); };
    reader.onload = function (e) { resolve(e.target.result); };
    reader.readAsText(file, 'UTF-8');
  });
}
