// ===== 字符级高亮渲染 =====
// 原来 renderNoteHighlights 是「按句号加 .note-hl class」，
// 所以哪怕只划了前 8 个字，整句都会被标上。
// 现在：句内区间（cs/ce 有值）的句子要进到span 内部再切一刀，
// 用 <mark class="note-hl-inline"> 包住真正划到的那几个字；
// 整句都要的（cs 为 null）保持原来的 .note-hl class 不变 —— 这样
// 旧笔记的显示效果完全不变，只有新划的才会细到字。

// 在一个句子 span 内部，按字符区间插入 <mark>。
//
// ★★ 关键：绝不能改innerHTML。
//   第一版用 innerHTML 重建，结果整句都被标成整句 —— 因为句子里有
//   .word-ins / .word-zh / .zh-blank-box（点词看释义和挖空框），
//   为了保护它们就「退回整句」，结果用户划 7 个字却看到整句高亮。
//   正确做法：用 DOM Range 精确包裹那几个字，一个字节都不动其它元素 ——
//   这样点词看释义、挖空框全部照常工作。
//
// slices: [{s, e}] 已排序、已去重（相对句子全文的字符偏移）
function applyInlineCharHl(sentEl, slices) {
  if (!sentEl || !slices || !slices.length) return false;
  var text = sentEl.textContent || '';
  if (!text) return false;
  // 先切掉两端没意义的区间
  var valid = [];
  for (var i = 0; i < slices.length; i++) {
    var sl = slices[i];
    var s = Math.max(0, Math.min(sl.s, text.length));
    var e = Math.max(s, Math.min(sl.e, text.length));
    if (e > s) valid.push({ s: s, e: e });
  }
  if (!valid.length) return false;

  // 把「句子全文的字符偏移」映射到「DOM 里的节点与偏移」
  var map = mapTextOffsets(sentEl);
  if (!map.length) return false;

  // 从后往前插：前面的插入不会影响后面已算好的位置
  for (var k = valid.length - 1; k >= 0; k--) {
    var v = valid[k];
    var from = locateInMap(map, v.s);
    var to = locateInMap(map, v.e);
    if (!from || !to) continue;
    try {
      var r = document.createRange();
      r.setStart(from.node, from.offset);
      r.setEnd(to.node, to.offset);
      var mk = document.createElement('mark');
      mk.className = 'note-hl-inline';
      // ★★ 不能用 surroundContents：它在 Range 只「部分包含」一个非文本节点时
      //   会抛 "partially selected a non-Text node"。
      //   而正文里几乎每句都有 .word-ins / .word-zh（点词看释义），
      //   划线只要跨进这些 span 一点点就必然触发 → mark 完全包不上
      //   → 退回整句（v26 的 bug：划 7 个字看到整句高亮）。
      //
      //   正确做法：extractContents 把区间内容取出来塞进 mark，再插回原位。
      //   这样既能跨节点，又完全不碰原有元素（word-ins 本身被完整搬进 mark，
      //   点词看释义照常工作）。
      var frag = r.extractContents();
      mk.appendChild(frag);
      r.insertNode(mk);
    } catch (e) {
      // 极端情况（区间为空 / 节点已被移走）才退化
      try { wrapPartial(sentEl, map, v.s, v.e); } catch (e2) { }
    }
  }
  return sentEl.querySelector ? sentEl.querySelector('mark.note-hl-inline') !== null : true;
}

// 退化方案：Range 只能包连续的兄弟节点集合时，
// 把区间按文本节点切开逐段包（视觉上仍然连续）。
// 同样用 extractContents，不用 surroundContents（原因见上）。
function wrapPartial(sentEl, map, s, e) {
  var from = locateInMap(map, s);
  var to = locateInMap(map, e);
  if (!from || !to) return false;
  var nodes = [];
  var started = false;
  for (var i = 0; i < map.length; i++) {
    var m = map[i];
    if (m === from) started = true;
    if (started) nodes.push(m);
    if (m === to) break;
  }
  for (var j = 0; j < nodes.length; j++) {
    var mm = nodes[j];
    var st = (mm === from) ? from.offset : 0;
    var en = (mm === to) ? to.offset : mm.node.nodeValue.length;
    if (en <= st) continue;
    try {
      var r = document.createRange();
      r.setStart(mm.node, st);
      r.setEnd(mm.node, en);
      var mk = document.createElement('mark');
      mk.className = 'note-hl-inline';
      mk.appendChild(r.extractContents());
      r.insertNode(mk);
    } catch (err) { }
  }
  return true;
}

// 收集句子内所有文本节点，并记录每个节点在「句子原文」里的起始偏移
// ★ 必须走原文坐标系：渲染时打了 data-gloss 的插入物
//   （（single）/（folk）这类英文释义、括号、音标、释义、挖空框）
//   不是原文的一部分，它们的长度绝不能算进偏移里 ——
//   算进去就会把该句后面的字整体顶歪（真实事故：11 个字的高亮跑到句尾）。
//   实现在 charrange.js 的 buildRawTextMap（按 data-gloss / data-raw-len 判定）。
function mapTextOffsets(root) {
  if (typeof buildRawTextMap === 'function') return buildRawTextMap(root);
  return [];
}

// 找到字符偏移 off 落在哪个文本节点的哪个位置
function locateInMap(map, off) {
  if (!map || !map.length) return null;
  if (off <= map[0].start) return { node: map[0].node, offset: 0 };
  for (var i = 0; i < map.length; i++) {
    var m = map[i];
    if (off >= m.start && off <= m.end) {
      return { node: m.node, offset: off - m.start };
    }
  }
  var last = map[map.length - 1];
  return { node: last.node, offset: last.node.nodeValue.length };
}

// 合并同一句内多个字符区间（可能有多条笔记都落在同一句）
function mergeCharSlices(list) {
  var arr = (list || []).filter(function (x) { return x && x.e > x.s; })
    .map(function (x) { return { s: x.s, e: x.e }; })
    .sort(function (a, b) { return a.s - b.s; });
  var out = [];
  arr.forEach(function (x) {
    var last = out[out.length - 1];
    if (last && x.s <= last.e) { if (x.e > last.e) last.e = x.e; }
    else out.push(x);
  });
  return out;
}

// 拖动过程中的字符级预览：只给真正划到的那几个字加 preview 样式
function previewRangesByChar(ranges) {
  var area = document.getElementById('readingArea');
  if (!area) return;
  var paras = currentParagraphs();
  if (!paras) return;
  (ranges || []).forEach(function (rg) {
    var pel = area.querySelector('p[data-pi="' + rg.p + '"]');
    if (!pel) return;
    var sent = (paras[rg.p] && splitSentenceRanges(paras[rg.p]))[rg.si];
    for (var si = rg.si; si <= rg.ei; si++) {
      var el = pel.querySelector('.sent[data-si="' + si + '"]');
      if (!el) continue;
      if (rg.cs === null || rg.cs === undefined) { el.classList.add('preview-hl'); continue; }
      var s2 = (paras[rg.p] && splitSentenceRanges(paras[rg.p]))[si];
      var sl = s2 ? ((typeof rangeSliceInSent === 'function') ? rangeSliceInSent(rg, si, s2) : rangeCharSlice(rg, s2)) : null;
      if (!sl) { el.classList.add('preview-hl'); continue; }
      // 预览阶段不改innerHTML（太贵），改用一个 CSS 变量控制高亮宽度比例
      // （按原文偏移算比例；句子里有英文释义时会有几个像素的偏差，
      //   松手后的正式高亮走 DOM Range，是精确的）
      var total = s2 ? (s2.end - s2.start) : (el.textContent || '').length;
      if (!total) continue;
      var sPct = Math.max(0, Math.min(100, (sl.s / total) * 100));
      var ePct = Math.max(0, Math.min(100, (sl.e / total) * 100));
      el.style.background = 'linear-gradient(90deg, transparent ' + sPct + '%, rgba(58,110,165,.18) ' + sPct + '%, rgba(58,110,165,.18) ' + ePct + '%, transparent ' + ePct + '%)';
      el.dataset.previewSlice = '1';
    }
  });
}

// 清除字符级预览
function clearPreviewChar() {
  var area = document.getElementById('readingArea');
  if (!area || typeof area.querySelectorAll !== 'function') return;
  var els = area.querySelectorAll('[data-preview-slice]');
  for (var i = 0; i < els.length; i++) {
    els[i].style.background = '';
    delete els[i].dataset.previewSlice;
  }
}

// 按字符区间重绘全部高亮（替代原renderNoteHighlights 的核心部分）
function renderNoteHighlightsByChar(area, byPara) {
  var paras = currentParagraphs();
  Object.keys(byPara).forEach(function (p) {
    var pel = area.querySelector('p[data-pi="' + p + '"]');
    if (!pel) return;
    var para = paras ? paras[p] : null;
    var sentRs = para ? splitSentenceRanges(para) : null;

    // 1) 整句要标的全句（cs 为 null）
    var wholeFrom = {}, wholeTo = {};
    var charJobs = {};          // si -> [{s,e}]
    byPara[p].forEach(function (rg) {
      for (var si = rg.si; si <= rg.ei; si++) {
        if (rg.cs === null || rg.cs === undefined) {
          if (wholeFrom[si] === undefined) wholeFrom[si] = si;
          wholeTo[si] = Math.max(wholeTo[si] === undefined ? si : wholeTo[si], si);
        } else {
          if (!sentRs || !sentRs[si]) continue;
          // ★ cs 只作用在首句、ce 只作用在末句（中间句子是整句）
          var sl = (typeof rangeSliceInSent === 'function')
            ? rangeSliceInSent(rg, si, sentRs[si])
            : rangeCharSlice(rg, sentRs[si]);
          if (!sl) continue;
          if (!charJobs[si]) charJobs[si] = [];
          charJobs[si].push(sl);
        }
      }
    });

    // 2) 整句 class
    Object.keys(wholeFrom).forEach(function (si) {
      var el = pel.querySelector('.sent[data-si="' + si + '"]');
      if (el) el.classList.add('note-hl');
    });

    // 3) 句内字符切片
    Object.keys(charJobs).forEach(function (si) {
      var el = pel.querySelector('.sent[data-si="' + si + '"]');
      if (!el) return;
      // 已经被整句标了就不用再切
      if (el.classList.contains('note-hl')) return;
      var merged = mergeCharSlices(charJobs[si]);
      if (!merged.length) return;
      // 覆盖整句 → 直接整句标
      // ★ 句长取「原文句长」（sentRs 是原文切句的结果）：
      //   cs/ce 是原文偏移，拿 DOM textContent 长度比会永远比不中
      //   （DOM 里多了英文释义那些字），于是明明整句被划也走不到这条捷径。
      var total = (sentRs && sentRs[si])
        ? (sentRs[si].end - sentRs[si].start)
        : (el.textContent || '').length;
      var covers = merged.length === 1 && merged[0].s <= 0 && merged[0].e >= total;
      if (covers) { el.classList.add('note-hl'); return; }
      // ★ 不再「句内有交互元素就退回整句」——
      //   applyInlineCharHl 改成用 DOM Range 精确包裹，不动其它元素，
      //   所以 .word-ins / .word-zh / 挖空框全部照常工作。
      //   （退回整句是 v26 的 bug：正文里几乎每句都有词，
      //     结果用户划 7 个字却看到整句高亮。）
      var done = applyInlineCharHl(el, merged);
      if (done) el.classList.add('note-hl-partial');
      else el.classList.add('note-hl');   // 真的包不住（比如整句都在隐藏输入框里）才退回
    });
  });
}