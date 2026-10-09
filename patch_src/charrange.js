// ===== 字符级划线定位 =====
// 要解决的问题：原来 buildRanges 只记「第几句到第几句」（{p, si, ei}），
// 不记句内位置，所以用户明明只划了前 8 个字，高亮却必然是整句 ——
// 没有任何信息能知道「只划了前半句」。
// 现在给每个句内位置算出字符偏移 range，把 {p, si, ei, cs, ce} 一起记。
//   si/ei —— 句子序号（决定哪些句子要标）
//   cs/ce —— 句内字符起止（决定每句标哪一段；null 表示整句都要）
//
// 为什么不做成「精确到字」而是「句内区间」：
// 用户要的「只划前 8 个字」本质是句内一个区间，精确到字反而会因为
// 光标落点差一个像素就少标一个字。区间 + 容差更符合人手划的直觉。

var CHAR_EPS = 1;              // 字符偏移容差：往前扩一点，避免少标边缘那个字
var MIN_CHAR_SPAN = 1;         // 句内最短命中长度

// 从段落原文 + 句子区间，算出「这个句子在段落的第几个字符起」
function sentCharStart(para, si) {
  var rs = splitSentenceRanges(para);
  if (!rs[si]) return 0;
  return rs[si].start;
}

// 像素坐标 → (段号, 句号, 句内字符偏移)
// 复用 pointAtXY 拿句号，再用 caretRangeFromPoint 拿段内绝对偏移
function pointAtXYChar(x, y) {
  var base = pointAtXY(x, y);
  if (!base) return null;
  var area = document.getElementById('readingArea');
  if (!area) return null;
  var absOff = -1;
  try {
    var r = null;
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) { r = document.createRange(); r.setStart(pos.offsetNode, pos.offset); r.collapse(true); }
    }
    if (r && r.startContainer) {
      // 找到该文本节点所属的 .sent → 往上取 p[data-pi] → 用 Range 算段内偏移
      var node = r.startContainer;
      var el = node.nodeType === 3 ? node.parentNode : node;
      var sentEl = null, pel = null;
      while (el && el.nodeType === 1) {
        if (!sentEl && el.classList && el.classList.contains('sent')) sentEl = el;
        if (el.tagName === 'P' && el.hasAttribute && el.hasAttribute('data-pi')) { pel = el; break; }
        el = el.parentElement;
      }
      if (pel && sentEl) {
        var pi = parseInt(pel.getAttribute('data-pi'), 10);
        var si = parseInt(sentEl.getAttribute('data-si'), 10);
        if (pi === base.p && si === base.si) {
          // ★ 量出来的必须是「原文偏移」，不能是 DOM 文本偏移。
          //   正文渲染时被标注的中文词后面会插入「（英文 音标 释义）」，
          //   同一段的 DOM 文本比原文长；拿 DOM 长度当原文偏移，
          //   该句之后的所有字都会被这段插入物整体顶歪 → 高亮落到句尾
          //   （真实事故：划「那里的男儿个个都是热血」11 个字，
          //     存成 28..39，页面在句尾亮了一段，用户看到的就是「还是一整句」）。
          absOff = rawOffsetOfPoint(pel, r.startContainer, r.startOffset);
        }
      }
    }
  } catch (e) { absOff = -1; }
  if (absOff < 0) return { p: base.p, si: base.si, off: null };
  return { p: base.p, si: base.si, off: absOff };
}

// 由两个「带字符偏移的点」构造范围
// 规则：
//   1. 起点落在句子 A、终点落在句子 B → 中间句子全部整句要（用户没划过它们）
//   2. 起点句只标起点之后那部分，终点句只标终点之前那部分
//   3. 同一句内 → 只标两句之间的区间（这正是「只划前 8 个字」的诉求）
//   4. 任一端拿不到字符偏移（浏览器不支持 / 落在空白）→ 退化成整句
function buildRangesChar(a, b) {
  if (!a || !b) return [];
  var lo = a, hi = b;
  if (lo.p > hi.p || (lo.p === hi.p && lo.si > hi.si)) { lo = b; hi = a; }
  var paras = currentParagraphs();
  if (!paras) return buildRanges(a, b);

  var s0 = sentCharStart(paras[lo.p], lo.si);
  var s1 = sentCharStart(paras[hi.p], hi.si);

  // 起点句内偏移
  var loCs = (lo.off === null || lo.off === undefined) ? null : (lo.off - s0);
  var hiCe = (hi.off === null || hi.off === undefined) ? null : (hi.off - s1);

  var ranges = [];

  if (lo.p === hi.p) {
    var rs = splitSentenceRanges(paras[lo.p]);
    var sent = rs[lo.si];
    var sentHi = rs[hi.si] || sent;
    if (loCs === null || hiCe === null || !sent) {
      ranges.push({ p: lo.p, si: lo.si, ei: hi.si, cs: null, ce: null });
    } else if (lo.si === hi.si) {
      // ★ 同一句内可能反向划（从后往前拖）。lo/hi 只按句号排过序，
      //   句内偏移可能还是「起 > 终」，这里必须再按数值排一次 ——
      //   否则反向划会算出 cs=4 / ce=4+1=5 这种「1 个字」的假范围
      //   （实际踩过：反向划只高亮 1 个字）。
      var lo2 = Math.min(loCs, hiCe);
      var hi2 = Math.max(loCs, hiCe);
      var total = sent.end - sent.start;
      var cs = Math.max(0, Math.min(lo2, total));
      var ce = Math.min(Math.max(cs + MIN_CHAR_SPAN, hi2), total);
      if (ce <= cs) ce = Math.min(cs + MIN_CHAR_SPAN, total);
      ranges.push({ p: lo.p, si: lo.si, ei: hi.si, cs: cs, ce: ce });
    } else {
      // ★ 同一段里划了多句：cs 是「首句」的起点、ce 是「末句」的终点，
      //   两者属于不同的句子，绝不能放在一起比大小（上一版就是把
      //   首句的 cs 和末句的 ce 混着算，跨句划会整段错位）。
      var totalLo = sent.end - sent.start;
      var totalHi = sentHi.end - sentHi.start;
      var cs3 = Math.max(0, Math.min(loCs, totalLo));
      var ce3 = Math.max(0, Math.min(hiCe, totalHi));
      ranges.push({ p: lo.p, si: lo.si, ei: hi.si, cs: cs3, ce: ce3 });
    }
    return ranges;
  }

  // 跨段：起点句半截 → 中间句整句 → 终点句半截
  if (loCs === null) ranges.push({ p: lo.p, si: lo.si, ei: lastSiOf(lo.p), cs: null, ce: null });
  else {
    var r0 = splitSentenceRanges(paras[lo.p])[lo.si];
    var ce0 = (r0 && r0) ? Math.max(loCs + MIN_CHAR_SPAN, r0.end - r0.start) : null;
    ranges.push({ p: lo.p, si: lo.si, ei: lo.si, cs: loCs, ce: ce0 });
  }
  for (var p = lo.p + 1; p < hi.p; p++) {
    ranges.push({ p: p, si: 0, ei: lastSiOf(p), cs: null, ce: null });
  }
  if (hiCe === null) ranges.push({ p: hi.p, si: 0, ei: hi.si, cs: null, ce: null });
  else ranges.push({ p: hi.p, si: 0, ei: hi.si, cs: 0, ce: hiCe });

  return ranges;
}

// 从原生选区的 (node, offset) 算出段内绝对字符偏移
function rangeAbsOffset(node, offset) {
  try {
    var el = node && node.nodeType === 3 ? node.parentNode : node;
    var pel = null;
    while (el && el.nodeType === 1) {
      if (el.tagName === 'P' && el.hasAttribute && el.hasAttribute('data-pi')) { pel = el; break; }
      el = el.parentElement;
    }
    if (!pel) return null;
    // ★ 同 pointAtXYChar：必须返回「原文偏移」，不能返回 DOM 文本长度
    return rawOffsetOfPoint(pel, node, offset);
  } catch (e) { return null; }
}

// 字符偏移 → 句内相对偏移（渲染时用）
function rangeCharSlice(rg, sent) {
  if (!sent) return null;
  var total = sent.end - sent.start;
  if (rg.cs === null || rg.cs === undefined) return { s: 0, e: total };
  var cs = Math.max(0, Math.min(rg.cs, total));
  var ce = (rg.ce === null || rg.ce === undefined) ? total : Math.max(cs, Math.min(rg.ce, total));
  return { s: cs, e: ce };
}

// range 里的 cs 只作用在「首句」、ce 只作用在「末句」，中间句子是整句。
// 跨句 / 跨段划的时候，句内偏移必须按这个规则逐个句子裁，不能整段套用同一个 cs/ce。
function rangeSliceInSent(rg, si, sent) {
  if (!sent) return null;
  var total = sent.end - sent.start;
  if (rg.cs === null || rg.cs === undefined) return { s: 0, e: total };
  var isFirst = (si === rg.si);
  var isLast = (si === rg.ei);
  var s = isFirst ? Math.max(0, Math.min(rg.cs, total)) : 0;
  var e = isLast
    ? ((rg.ce === null || rg.ce === undefined) ? total : Math.max(0, Math.min(rg.ce, total)))
    : total;
  if (e <= s) return null;
  return { s: s, e: e };
}

// ===== 原文偏移坐标系（DOM ↔ 原文）=====
//
// 背景（真实事故，必读）
//   正文渲染时，被标注的中文词会变成「一个 （single） 游牧民族 （folk）…」，
//   于是同一段里 **DOM 的文本长度 ≠ 原文长度**。
//   划线定位如果「量位置」按 DOM 文本算、「用位置」按原文算，
//   二者相差的正好是这段插入物的长度 —— 该句之后的所有字整体右移。
//   用户划「那里的男儿个个都是热血」(11 个字)，记下来却是 28..39，
//   高亮整段跑到句尾：「，他们的王朝叫做青阳。」
//
// 结论：字符偏移**只有一个坐标系 —— 段落原文**
//   （ch.content 按 \n\n 切出来的那一串，也就是 splitSentenceRanges 的入参）。
//   - 量位置（光标/选区）→ 先翻到原文偏移
//   - 放高亮（<mark>）→ 也先翻到原文偏移
//   中间靠渲染时打的两种标记来识别「插入物」：
//     data-gloss="1"    这一段 DOM 文本不是原文的一部分（英文/括号/音标/释义/挖空框）
//     data-raw-len="N"  这段在 DOM 里看不见，但原文里占 N 个字（填中文模式的挖空框）
//   没有这两个标记的节点一律当原文 —— 原文版（不做标注）就是这样，天然正确。

var RAW_GLOSS_ATTR = 'data-gloss';
var RAW_LEN_ATTR = 'data-raw-len';

function rawHasAttr(el, name) {
  return !!(el && el.nodeType === 1 && typeof el.hasAttribute === 'function' && el.hasAttribute(name));
}

// 插入物 → 它在原文里占几个字（普通释义插入物是 0，挖空框是隐藏的中文词长度）
function rawGlossLen(el) {
  if (!rawHasAttr(el, RAW_GLOSS_ATTR)) return 0;
  var n = parseInt(el.getAttribute(RAW_LEN_ATTR) || '0', 10);
  return (n > 0) ? n : 0;
}

// (文本节点, 偏移) → 该点在「段落原文」里的绝对字符偏移
// root 必须是 <p data-pi>（量段落偏移）或 .sent（量句内偏移）这类容器
function rawOffsetOfPoint(root, node, offset) {
  if (!root) return 0;
  var acc = 0, done = false;
  function walk(n) {
    if (done || !n) return;
    if (n === node) {
      if (n.nodeType === 3) {
        var len = n.nodeValue ? n.nodeValue.length : 0;
        acc += Math.max(0, Math.min(offset, len));
      }
      done = true;
      return;
    }
    if (n.nodeType === 3) { acc += (n.nodeValue || '').length; return; }
    if (n.nodeType !== 1) return;
    var inside = (typeof n.contains === 'function' && node) ? n.contains(node) : false;
    if (rawHasAttr(n, RAW_GLOSS_ATTR)) {
      // 插入物：原文里只占 rawGlossLen() 个字
      acc += rawGlossLen(n);
      if (inside) done = true;      // 光标落在释义文字里 → 停在它前面那个词的边界
      return;
    }
    var kids = n.childNodes || [];
    for (var i = 0; i < kids.length; i++) { walk(kids[i]); if (done) return; }
  }
  var roots = root.childNodes || [];
  for (var j = 0; j < roots.length; j++) { walk(roots[j]); if (done) break; }
  return acc;
}

// 原文偏移 → DOM：返回 [{node, start, end}]，start/end 都是原文偏移，插入物不进表
// （applyInlineCharHl 靠这张表把 cs/ce 落到真正的文本节点上）
function buildRawTextMap(root) {
  var out = [], acc = 0;
  function walk(n) {
    if (!n) return;
    if (n.nodeType === 3) {
      var len = (n.nodeValue || '').length;
      if (len) { out.push({ node: n, start: acc, end: acc + len }); acc += len; }
      return;
    }
    if (n.nodeType !== 1) return;
    if (rawHasAttr(n, RAW_GLOSS_ATTR)) { acc += rawGlossLen(n); return; }
    var kids = n.childNodes || [];
    for (var i = 0; i < kids.length; i++) walk(kids[i]);
  }
  var roots = (root && root.childNodes) || [];
  for (var j = 0; j < roots.length; j++) walk(roots[j]);
  return out;
}

// 某一段、某一句之前，DOM 比原文多出来的字符数（= 插入物总长）
// 用来修复「旧版错位笔记」：错位量就是这个值
function rawShiftBeforeSent(pel, p, si) {
  if (!pel || typeof pel.querySelector !== 'function') return 0;
  var el = pel.querySelector('.sent[data-si="' + si + '"]');
  if (!el || !pel.childNodes) return 0;
  var idx = -1;
  for (var i = 0; i < pel.childNodes.length; i++) { if (pel.childNodes[i] === el) { idx = i; break; } }
  if (idx < 0) return 0;
  var domOff = 0;
  for (var k = 0; k < idx; k++) {
    var n = pel.childNodes[k];
    domOff += (n.nodeType === 3) ? (n.nodeValue || '').length : (n.textContent || '').length;
  }
  var paras = (typeof currentParagraphs === 'function') ? currentParagraphs() : null;
  if (!paras || typeof paras[p] !== 'string') return 0;
  var rs = splitSentenceRanges(paras[p]);
  if (!rs[si]) return 0;
  var shift = domOff - rs[si].start;
  return (shift > 0) ? shift : 0;
}