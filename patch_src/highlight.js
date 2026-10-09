/* ===== 划线记笔记（参考微信读书的划线交互）=====

   目标
     用鼠标 / 触控笔 / 手指在正文上滑动划线，划线处即时出标记，
     内容按「完整句子」自动归类进笔记；一次划到两段时，
     两段的句子合并成**一条**笔记并标序号。

   核心设计（为什么这么做）

   1) 定位不用字符偏移，用「句子序号」
      阅读区每次刷新都是整段重建 innerHTML，而且释义/挖空模式下
      原句里被标注的中文词会被替换成「中文（英文 音标 释义）」，
      DOM 文本长度 ≠ 原文长度 —— 用字符偏移记录划线会在下次
      刷新时整体错位。
      解决：渲染时先把每段切成句子，包成 <span class="sent" data-si="i">，
      旁边再给 <p data-pi="i">。于是划线只需要记 {段号, 起句, 止句}，
      还原就是给对应的 .sent 加一个 class，精确且稳定。

   2) 跨段 = 同一个笔记对象里的多个 range
      ranges = [{p:3, si:2, ei:4}, {p:4, si:0, ei:1}]
      存云端时序列化成「范围JSON」。一条笔记就是一个对象、
      一次划线的产物，内部句子按 1. 2. 3. 编号。

   3) 三端输入的分工
      - 鼠标 / 触控笔：不抢占原生选择，拖选时靠浏览器自带的选区反馈，
        松手后把选区吸附成完整句子入笔记（也能开划线模式，走自绘路径）。
      - 手指：网页里滑动天然等于滚动，没法既滚动又划线，
        所以必须显式开「✏️ 划线」模式（此时阅读区 touch-action:none）。
        这是唯一可靠的方案，不是偷懒。

   4) 触屏长按不作数
      touch-action 是在手势**开始**时读取的，长按中途改 class 影响不了
      当前手势，所以「长按进入划线」在网页里压不住滚动。
      要划线就点按钮，要阅读就退出划线模式。

   5) 失败补偿
      新增推云端失败 → 记 pendingNoteAdd 待办，进应用后集中补推；
      删除失败 → 复用 cleanup.js 的墓碑机制（用户看不到即可，不等云端删干净）。
   ============================================================ */

var NOTES_ADD_PREFIX = 'pendingNoteAdd_v1_';
var NOTES_MAX_PER_CHAPTER = 500;      // 单章笔记上限，防撑爆 localStorage
var NOTES_FLUSH_MAX_TRIES = 3;

// ---------- 一、句子切分 ----------

var _SENT_SEG = null, _SENT_SEG_TRIED = false;
var _SENT_CACHE = {}, _SENT_CACHE_N = 0;

function getSentenceSegmenter() {
  if (_SENT_SEG_TRIED) return _SENT_SEG;
  _SENT_SEG_TRIED = true;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      _SENT_SEG = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    }
  } catch (e) { _SENT_SEG = null; }
  return _SENT_SEG;
}

// 退化切句：中英文句末标点 + 收尾引号
var _SENT_RE = /[^.!?。！？…\n]+[.!?。！？…]+[”"』」）)]*|[^.!?。！？…\n]+/g;

function _computeSentRanges(para) {
  var out = [];
  var seg = getSentenceSegmenter();
  if (seg) {
    try {
      var it = seg.segment(para);
      var arr = it && typeof it[Symbol.iterator] === 'function' ? Array.from(it) : [];
      for (var i = 0; i < arr.length; i++) {
        var s = arr[i];
        var t = s && s.segment;
        if (!t) continue;
        out.push({ start: s.index, end: s.index + t.length, text: t });
      }
    } catch (e) { out = []; }
  }
  if (!out.length) {
    _SENT_RE.lastIndex = 0;
    var m;
    while ((m = _SENT_RE.exec(para)) !== null) {
      if (!m[0]) { _SENT_RE.lastIndex++; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  if (!out.length) out.push({ start: 0, end: para.length, text: para });
  // 只保留有内容的句子：空白片段不参与编号，也不包 span
  return out.filter(function (r) { return r.text && r.text.trim(); });
}

// 段落 → 句子区间数组（带缓存，refreshLearn 每次重渲染都会问同一批段落）
function splitSentenceRanges(para) {
  if (typeof para !== 'string' || !para) return [];
  var hit = _SENT_CACHE[para];
  if (hit) return hit;
  var out = _computeSentRanges(para);
  if (_SENT_CACHE_N > 500) { _SENT_CACHE = {}; _SENT_CACHE_N = 0; }
  _SENT_CACHE[para] = out;
  _SENT_CACHE_N++;
  return out;
}

// ---------- 二、STATE / 本地读写 ----------

function ensureNotesState() {
  if (!STATE.notes || typeof STATE.notes !== 'object') STATE.notes = {};
  return STATE.notes;
}

function notesLocalKey() { return 'notes_v1_' + (STATE.profileId || 'anon'); }
function loadNotesLocal() {
  var raw = LS.get(notesLocalKey(), null);
  STATE.notes = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return STATE.notes;
}
function saveNotesLocal() { LS.set(notesLocalKey(), ensureNotesState()); }

function chapterNotes(matId, chId) {
  var all = ensureNotesState();
  if (!all[matId]) all[matId] = {};
  if (!all[matId][chId]) all[matId][chId] = [];
  return all[matId][chId];
}

// 当前章节的所有段落（必须与 refreshLearn 里同一套 split，段落号才对得上）
function currentParagraphs() {
  if (!STATE.learnMaterialId || !STATE.learnChapterId) return null;
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var ch = null;
  for (var i = 0; i < chs.length; i++) {
    if (chs[i].id === STATE.learnChapterId) { ch = chs[i]; break; }
  }
  if (!ch || typeof ch.content !== 'string') return null;
  return ch.content.split(/\n\n+/);
}

function lastSiOf(p) {
  var paras = currentParagraphs();
  if (!paras || paras[p] === undefined) return 0;
  var rs = splitSentenceRanges(paras[p]);
  return Math.max(0, rs.length - 1);
}

function noteCountOfChapter(matId, chId) {
  var all = ensureNotesState();
  var m = all[matId];
  if (!m || !m[chId]) return 0;
  return m[chId].length;
}

function allNotesOfMaterial(matId) {
  var all = ensureNotesState();
  var m = all[matId];
  if (!m) return [];
  var out = [];
  Object.keys(m).forEach(function (cid) {
    (m[cid] || []).forEach(function (n) { out.push({ note: n, chId: cid }); });
  });
  out.sort(function (a, b) { return String(a.note.createdAt || '').localeCompare(String(b.note.createdAt || '')); });
  return out;
}

// ---------- 三、range / 云端行 互转 ----------

function parseNoteRanges(s) {
  if (!s) return [];
  try {
    var a = JSON.parse(s);
    if (!Array.isArray(a)) return [];
    return a.filter(function (r) {
      return r && typeof r.p === 'number' && typeof r.si === 'number' && typeof r.ei === 'number';
    }).map(function (r) { return { p: r.p, si: r.si, ei: r.ei }; });
  } catch (e) { return []; }
}

// 云端行 → 本地笔记对象
function noteFromRow(r) {
  var text = r['划线内容'] || '';
  var sentences = text.split('\n').filter(function (x) { return String(x).trim(); })
    .map(function (x) { return String(x).replace(/^\s*\d+[.、]\s*/, ''); });
  return {
    id: r['笔记ID'] || r._id,
    ranges: parseNoteRanges(r['范围JSON']),
    text: text,
    sentences: sentences,
    crossPara: !!r['跨段'],
    createdAt: r['创建时间'] || nowISO(),
    _cloudId: r._id
  };
}

function noteCloudProps(matId, chId, note) {
  return {
    'profile_id': { text: STATE.profileId },
    '资料ID': { text: matId },
    '章节ID': { text: chId },
    '笔记ID': { text: note.id },
    '范围JSON': { text: JSON.stringify(note.ranges || []) },
    '划线内容': { text: note.text || '' },
    '句子数': { number: (note.sentences || []).length },
    '跨段': { checkbox: !!note.crossPara },
    '创建时间': { date: note.createdAt || nowISO() }
  };
}

// ---------- 四、高亮渲染 ----------

function clearNoteHighlights(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  // ★ 字符级高亮是 <mark class="note-hl-inline">，清除时必须拆回纯文本，
  //   否则重渲染/重划一次就永久残留（mark 会一层套一层，越滚越脏）。
  var marks = root.querySelectorAll('mark.note-hl-inline');
  for (var i = 0; i < marks.length; i++) {
    var m = marks[i];
    var parent = m.parentNode;
    if (!parent) continue;
    // ★ 直接拆，不用「父节点有交互元素就跳过」。
    //   mark 是用 Range 精确包裹的纯文本，里面绝不含 input/button，
    //   它自己的子节点原样搬回父节点即可 —— 父句里的 .word-ins / 挖空框
    //   是兄弟节点，拆 mark 动不到它们。
    //   （之前那句「跳过」会让 mark 拆不掉、每刷新一次套一层，永久残留。）
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    if (parent.normalize) parent.normalize();
  }
  var els = root.querySelectorAll('.sent.note-hl, .sent.preview-hl, .sent.note-hl-partial');
  for (var j = 0; j < els.length; j++) {
    els[j].classList.remove('note-hl');
    els[j].classList.remove('preview-hl');
    els[j].classList.remove('note-hl-partial');
  }
}

// 把同段的重叠/相邻句子区间并起来，避免一条句子被两个笔记重复加 class
function mergeSiRanges(list) {
  var byP = {};
  (list || []).forEach(function (rg) {
    if (!rg) return;
    if (!byP[rg.p]) byP[rg.p] = [];
    byP[rg.p].push({ p: rg.p, si: rg.si, ei: rg.ei });
  });
  var out = [];
  Object.keys(byP).forEach(function (p) {
    var arr = byP[p].sort(function (a, b) { return a.si - b.si; });
    var cur = null;
    arr.forEach(function (rg) {
      if (!cur) { cur = { p: rg.p, si: rg.si, ei: rg.ei }; return; }
      if (rg.si <= cur.ei + 1) { if (rg.ei > cur.ei) cur.ei = rg.ei; }
      else { out.push(cur); cur = { p: rg.p, si: rg.si, ei: rg.ei }; }
    });
    if (cur) out.push(cur);
  });
  return out;
}

// 按当前章节的笔记，把对应句子标出来
function renderNoteHighlights() {
  var area = document.getElementById('readingArea');
  if (!area || typeof area.querySelector !== 'function') return;
  clearNoteHighlights(area);
  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;
  var notes = chapterNotes(STATE.learnMaterialId, STATE.learnChapterId);
  if (!notes.length) return;

  var byPara = {};
  notes.forEach(function (nt) {
    (nt.ranges || []).forEach(function (rg) {
      if (!byPara[rg.p]) byPara[rg.p] = [];
      byPara[rg.p].push(rg);
    });
  });

  Object.keys(byPara).forEach(function (p) {
    var pel = area.querySelector('p[data-pi="' + p + '"]');
    if (!pel) return;
    mergeSiRanges(byPara[p]).forEach(function (rg) {
      for (var si = rg.si; si <= rg.ei; si++) {
        var sel = pel.querySelector('.sent[data-si="' + si + '"]');
        if (sel) sel.classList.add('note-hl');
      }
    });
  });
}

// 拖动过程中的即时预览（只走自绘路径）
var _PREVIEW_PAIRS = [];
function showPreview(from, to) {
  clearPreview();
  if (!from || !to) return;
  // ★ 有字符偏移时先算字符级范围，预览只覆盖真正划到的那几个字
  if ((from.off !== null && from.off !== undefined) || (to.off !== null && to.off !== undefined)) {
    if (typeof buildRangesChar === 'function') {
      var cr = buildRangesChar(from, to);
      if (cr && cr.length && typeof previewRangesByChar === 'function') {
        previewRangesByChar(cr);
        return;
      }
    }
  }
  var lo = from, hi = to;
  if (lo.p > hi.p || (lo.p === hi.p && lo.si > hi.si)) { lo = to; hi = from; }
  var area = document.getElementById('readingArea');
  if (!area || typeof area.querySelector !== 'function') return;
  for (var p = lo.p; p <= hi.p; p++) {
    var pel = area.querySelector('p[data-pi="' + p + '"]');
    if (!pel) continue;
    var si0 = (p === lo.p) ? lo.si : 0;
    var si1 = (p === hi.p) ? hi.si : lastSiOf(p);
    for (var si = si0; si <= si1; si++) {
      var sel = pel.querySelector('.sent[data-si="' + si + '"]');
      if (sel) sel.classList.add('preview-hl');
    }
  }
}
function clearPreview() {
  var area = document.getElementById('readingArea');
  if (!area || typeof area.querySelectorAll !== 'function') return;
  if (typeof clearPreviewChar === 'function') clearPreviewChar();
  var els = area.querySelectorAll('.sent.preview-hl');
  for (var i = 0; i < els.length; i++) els[i].classList.remove('preview-hl');
}

// ---------- 五、像素 → (段号, 句号) ----------

function sentOfNode(node) {
  var el = node;
  if (el && el.nodeType === 3) el = el.parentNode;
  while (el && el.nodeType === 1) {
    if (el.classList && el.classList.contains('sent')) {
      var pel = el.parentNode;
      while (pel && pel.nodeType === 1 && !(pel.tagName === 'P' && pel.hasAttribute('data-pi'))) {
        pel = pel.parentNode;
      }
      if (!pel || pel.nodeType !== 1 || !pel.getAttribute) return null;
      var p = parseInt(pel.getAttribute('data-pi'), 10);
      var si = parseInt(el.getAttribute('data-si'), 10);
      if (isNaN(p) || isNaN(si)) return null;
      return { p: p, si: si };
    }
    el = el.parentNode;
  }
  return null;
}

function pointAtXY(x, y) {
  var r = null;
  try {
    if (document.caretRangeFromPoint) {
      r = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        r = document.createRange();
        r.setStart(pos.offsetNode, pos.offset);
        r.collapse(true);
      }
    }
  } catch (e) { r = null; }
  if (!r || !r.startContainer) return null;
  return sentOfNode(r.startContainer);
}

// 从原生选区取起止点（鼠标 / 触控笔拖选用）
function pointsFromSelection() {
  if (typeof window === 'undefined' || !window.getSelection) return null;
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  var rg = sel.getRangeAt(0);
  var area = document.getElementById('readingArea');
  if (!area) return null;
  try {
    if (!area.contains(rg.startContainer) || !area.contains(rg.endContainer)) return null;
  } catch (e) { return null; }
  var a = sentOfNode(rg.startContainer);
  var b = sentOfNode(rg.endContainer);
  if (!a || !b) return null;
  return { from: a, to: b };
}

// ---------- 六、入笔记 ----------

function collectSentenceTexts(ranges) {
  var paras = currentParagraphs();
  if (!paras) return [];
  var out = [];
  (ranges || []).forEach(function (rg) {
    var para = paras[rg.p];
    if (para === undefined || para === null) return;
    var rs = splitSentenceRanges(para);
    for (var si = rg.si; si <= rg.ei; si++) {
      if (rs[si] && rs[si].text && rs[si].text.trim()) out.push(rs[si].text.trim());
    }
  });
  return out;
}

function sameRanges(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i].p !== b[i].p || a[i].si !== b[i].si || a[i].ei !== b[i].ei) return false;
  }
  return true;
}

// points → ranges（跨段时每段一条，中间段落整段收进来）
function buildRanges(from, to) {
  var lo = from, hi = to;
  if (!lo || !hi) return [];
  if (lo.p > hi.p || (lo.p === hi.p && lo.si > hi.si)) { lo = to; hi = from; }
  var ranges = [];
  if (lo.p === hi.p) {
    ranges.push({ p: lo.p, si: Math.min(lo.si, hi.si), ei: Math.max(lo.si, hi.si) });
  } else {
    ranges.push({ p: lo.p, si: lo.si, ei: lastSiOf(lo.p) });
    for (var p = lo.p + 1; p < hi.p; p++) ranges.push({ p: p, si: 0, ei: lastSiOf(p) });
    ranges.push({ p: hi.p, si: 0, ei: hi.si });
  }
  return ranges;
}

// opts 用来带附加信息：
//   opts.strokeId   —— 这一笔的笔迹 id，挂到笔记上
//   opts.strokeOnly —— 纯笔迹笔记（没覆盖到任何完整句子）
function addNote(ranges, sentTexts, opts) {
  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  if (!mid || !cid) return null;
  var o = opts || {};
  var rgs = ranges || [], txt = sentTexts || [];
  // 纯笔迹笔记允许 ranges 为空；普通笔记两者都得有
  if (!o.strokeOnly && (!rgs.length || !txt.length)) return null;
  var list = chapterNotes(mid, cid);

  // 纯笔迹笔记没有句子范围，去重改用笔迹 id
  for (var i = 0; i < list.length; i++) {
    if (o.strokeOnly && list[i].strokeId && list[i].strokeId === o.strokeId) return list[i];
    if (!o.strokeOnly && sameRanges(list[i].ranges, rgs)) {
      toast('这段已经划过了', 'ok', 2200);
      return list[i];
    }
  }

  var note = {
    id: uid('nt'),
    ranges: rgs,
    sentences: txt,
    // 序号写在内容里：一条笔记里可以有多句（尤其跨两段时），编号后云端数据也自解释
    text: txt.map(function (s, k) { return (k + 1) + '. ' + s; }).join('\n'),
    crossPara: rgs.length > 1,
    createdAt: nowISO()
  };
  if (o.strokeId) { note.strokeId = o.strokeId; note.strokeOnly = !!o.strokeOnly; }
  list.push(note);
  while (list.length > NOTES_MAX_PER_CHAPTER) list.shift();
  saveNotesLocal();
  renderNoteHighlights();
  renderNotePanel();
  pushNoteToCloud(mid, cid, note);
  toast(o.strokeOnly ? '已记下笔迹'
    : (note.crossPara ? ('已记下 ' + rgs.length + ' 段 · ' + txt.length + ' 句') : ('已记下 ' + txt.length + ' 句')),
    'ok', 1800);
  return note;
}

function commitSelection(from, to) {
  var ranges = buildRanges(from, to);
  if (!ranges.length) return null;
  var texts = collectSentenceTexts(ranges);
  if (!texts.length) return null;
  var note = addNote(ranges, texts);
  if (note) {
    suppressNextClick();      // 划线刚落地，紧跟着的那个 click 不能当删除
    // ★ 顺手收掉浏览器那片蓝色原生选区。
    //   留着它会盖在真正的高亮上，用户会以为「还是标的整句」（真实误会过）。
    if (typeof clearNativeSelection === 'function') clearNativeSelection();
  }
  return note;
}

function deleteNote(noteId) {
  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  if (!mid || !cid || !noteId) return false;
  var list = chapterNotes(mid, cid);
  var idx = -1;
  for (var i = 0; i < list.length; i++) { if (list[i].id === noteId) { idx = i; break; } }
  if (idx < 0) return false;
  var note = list[idx];
  list.splice(idx, 1);
  saveNotesLocal();
  unqueuePendingNoteAdd(note.id);
  // 已推过云端的：删除失败会自动留墓碑（见 cleanup.js 的 softDeleteCloud），
  // 用户要的是「看不见」，不必等云端真删干净
  if (note._cloudId && typeof softDeleteCloud === 'function') {
    softDeleteCloud(DB_IDS.context_notes, note._cloudId);
  }
  // 笔记删了，挂在它上面的笔迹也一起清（否则笔迹会变成孤儿留在页面上）
  if (note.strokeId && typeof drawDropStroke === 'function') drawDropStroke(note.strokeId);
  renderNoteHighlights();
  renderNotePanel();
  return true;
}

// ---------- 七、云端同步 ----------
function pushNoteToCloud(matId, chId, note) {
  if (!STATE.cloudReady || !CLOUD.db || !STATE.profileId) {
    queuePendingNoteAdd({ matId: matId, chId: chId, noteId: note.id });
    return;
  }
  CLOUD.add(DB_IDS.context_notes, noteCloudProps(matId, chId, note)).then(function (r) {
    if (r && r.id) {
      note._cloudId = r.id;
      saveNotesLocal();
      unqueuePendingNoteAdd(note.id);
    } else {
      queuePendingNoteAdd({ matId: matId, chId: chId, noteId: note.id });
    }
  }).catch(function () {
    queuePendingNoteAdd({ matId: matId, chId: chId, noteId: note.id });
  });
}

function pendingNoteKey() { return NOTES_ADD_PREFIX + (STATE.profileId || 'anon'); }
function pendingNoteList() {
  var list = LS.get(pendingNoteKey(), []);
  return Array.isArray(list) ? list : [];
}
function savePendingNoteList(list) { LS.set(pendingNoteKey(), list); }

function queuePendingNoteAdd(t) {
  if (!t || !t.matId || !t.chId || !t.noteId || !STATE.profileId) return;
  var list = pendingNoteList();
  for (var i = 0; i < list.length; i++) { if (list[i].noteId === t.noteId) return; }
  list.push({ matId: t.matId, chId: t.chId, noteId: t.noteId, tries: 0 });
  while (list.length > 300) list.shift();
  savePendingNoteList(list);
}

function unqueuePendingNoteAdd(noteId) {
  if (!noteId) return;
  savePendingNoteList(pendingNoteList().filter(function (x) { return x.noteId !== noteId; }));
}

function bumpPendingNoteTries(noteId) {
  var list = pendingNoteList();
  for (var i = 0; i < list.length; i++) {
    if (list[i].noteId === noteId) {
      list[i].tries = (list[i].tries || 0) + 1;
      if (list[i].tries >= NOTES_FLUSH_MAX_TRIES) list.splice(i, 1);
      break;
    }
  }
  savePendingNoteList(list);
}

function findNoteById(matId, chId, noteId) {
  var all = ensureNotesState();
  var arr = ((all[matId] || {})[chId]) || [];
  for (var i = 0; i < arr.length; i++) { if (arr[i].id === noteId) return arr[i]; }
  return null;
}

// 补推：本地已经被删掉的直接销账，绝不凭空重建
function flushPendingNoteAdds() {
  if (!STATE.cloudReady || !CLOUD.db || !STATE.profileId) return Promise.resolve(0);
  var list = pendingNoteList();
  if (!list.length) return Promise.resolve(0);
  var done = 0, dropped = 0;
  var jobs = list.map(function (t) {
    var note = findNoteById(t.matId, t.chId, t.noteId);
    if (!note) { unqueuePendingNoteAdd(t.noteId); dropped++; return Promise.resolve(); }
    if (note._cloudId) { unqueuePendingNoteAdd(t.noteId); done++; return Promise.resolve(); }
    return CLOUD.add(DB_IDS.context_notes, noteCloudProps(t.matId, t.chId, note)).then(function (r) {
      if (r && r.id) {
        note._cloudId = r.id;
        unqueuePendingNoteAdd(t.noteId);
        done++;
      } else { bumpPendingNoteTries(t.noteId); }
    }).catch(function () { bumpPendingNoteTries(t.noteId); });
  });
  return Promise.all(jobs).then(function () {
    if (done > 0) { saveNotesLocal(); toast('已补推 ' + done + ' 条笔记到云端', 'ok', 6000); }
    if (dropped > 0) console.log('[笔记补偿] ' + dropped + ' 条已在本地删除，不再补推');
    return done;
  });
}

// ---------- 八、拖动交互 ----------

var NOTE_MODE = false;            // 是否处于「划线模式」（手指必须靠它）
var _ND = { down: false, self: false, moved: false, x0: 0, y0: 0, from: null, to: null };
var NOTE_MOVE_THRESHOLD = 6;      // 小于这个位移算点击，不划伤「点词看释义」

function isNoteModeOn() { return NOTE_MODE === true; }

function setNoteMode(on) {
  NOTE_MODE = !!on;
  var area = document.getElementById('readingArea');
  if (area && area.classList && typeof area.classList.toggle === 'function') {
    area.classList.toggle('marking-mode', NOTE_MODE);
  }
  var btn = document.getElementById('btnNoteMode');
  if (btn) {
    btn.classList.toggle('btn-primary', NOTE_MODE);
    btn.classList.toggle('btn-outline', !NOTE_MODE);
    btn.textContent = NOTE_MODE ? '✏️ 划线中（点此退出）' : '✏️ 划线';
  }
  clearPreview();
  if (NOTE_MODE) toast(penActiveHintText(), 'ok', 3600);
}
function toggleNoteMode() { setNoteMode(!NOTE_MODE); }

// 提示文案要说清「笔不需要开、也可以直接划」，否则用笔的人会以为必须开模式
function penActiveHintText() {
  if (NOTE_MODE) {
    return '划线模式已开：手指滑动即为划线（页面不滚动）。' +
      '用触控笔可以直接画，不必开这个开关 —— 笔会自动接管并屏蔽手掌误触。';
  }
  return '鼠标 / 触控笔可直接在正文上划线；手指滑动请先点「✏️ 划线」。';
}

function noteEventTargetBlocked(t) {
  if (!t || t.nodeType !== 1) return true;
  var tag = (t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'button' || tag === 'a' || tag === 'select'
      || tag === 'textarea' || tag === 'label') return true;
  return false;
}

function onNotePointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  var area = document.getElementById('readingArea');
  if (!area) return;
  if (noteEventTargetBlocked(e.target)) return;

  // ★ 防手掌误触：有笔在用（或刚抬起不到 PEN_TOUCH_BLOCK_MS）时，
  //   手指 touch 一律不参与划线。没有这条，平板上笔和手掌同时贴屏时
  //   手掌一移动就会拖出一条多余的笔迹。
  if (e.pointerType === 'touch' && typeof penBlocksTouch === 'function' && penBlocksTouch()) return;

  if (typeof penUpdateOnDown === 'function') penUpdateOnDown(e);

  _ND.down = true;
  _ND.moved = false;
  _ND.x0 = e.clientX;
  _ND.y0 = e.clientY;
  _ND.from = null;
  _ND.to = null;
  _ND.strokeId = null;                    // 笔迹笔画的 id（见 draw 模块）
  _ND.pointerType = e.pointerType || 'mouse';
  _ND.penTouchBlocked = (_ND.pointerType === 'touch'
    && typeof penBlocksTouch === 'function' && penBlocksTouch());
  var pt = pointAtXY(e.clientX, e.clientY);
  _ND.from = pt;

  // 手指：必须开着「划线模式」才接管（否则滑动应该是滚动页面）
  // 笔 / 鼠标：直接接管，不用开开关 —— 用笔的人不该被这个开关拦住
  var isPen = (_ND.pointerType === 'pen');
  _ND.self = NOTE_MODE || isPen;
  if (_ND.self) {
    try { e.preventDefault(); } catch (err) { }
  }
  // 笔迹起笔（自由笔迹模式才画，见 drawStrokeStart）
  if (_ND.self && typeof drawStrokeStart === 'function') {
    _ND.strokeId = drawStrokeStart(e, _ND.pointerType);
  }
}

function onNotePointerMove(e) {
  if (!_ND.down || !_ND.self) return;
  if (typeof penUpdateOnMove === 'function') penUpdateOnMove(e);
  var dx = Math.abs(e.clientX - _ND.x0);
  var dy = Math.abs(e.clientY - _ND.y0);
  if (!_ND.moved && dx < NOTE_MOVE_THRESHOLD && dy < NOTE_MOVE_THRESHOLD) return;
  _ND.moved = true;

  // ★ 笔尖预测：一次 pointermove 里其实含 4~10 个真实采样点，
  //   不取出来就丢了 → 手写笔会明显滞后发毛。所以逐点喂给笔迹层，
  //   最后再用当前点做句子命中判定。
  var pts = (typeof penSamplePoints === 'function')
    ? penSamplePoints(e)
    : [{ x: e.clientX, y: e.clientY, pressure: e.pressure, tiltMag: 0 }];
  if (typeof drawStrokeExtend === 'function' && _ND.strokeId) {
    drawStrokeExtend(_ND.strokeId, pts, e.clientX, e.clientY);
  }

  try { e.preventDefault(); } catch (err) { }
  _ND.to = pointAtXY(e.clientX, e.clientY);
  if (_ND.from && _ND.to) showPreview(_ND.from, _ND.to);
}

function onNotePointerUp(e) {
  if (!_ND.down) return;
  var wasSelf = _ND.self, moved = _ND.moved, from = _ND.from, to = _ND.to;
  var strokeId = _ND.strokeId;
  _ND.down = false; _ND.self = false; _ND.moved = false; _ND.from = null; _ND.to = null;
  _ND.strokeId = null;
  clearPreview();

  // 收笔：把这一笔的笔迹定稿（即使最后没生成句子笔记，笔迹本身也要留下）
  if (strokeId && typeof drawStrokeEnd === 'function') {
    drawStrokeEnd(strokeId, e);
  }
  if (typeof penRelease === 'function') penRelease();

  if (wasSelf) {
    if (!moved) return;                       // 单击：留给原本的业务（点词看释义）
    var a = from, b = to || pointAtXY(e.clientX, e.clientY);
    if (!a || !b) {
      // 只有笔迹、没命中任何句子 → 也要把它存成一条笔记，
      // 否则用户在空白处画的东西会凭空消失（笔画太少也一并忽略）
      if (strokeId && typeof commitStrokeOnlyNote === 'function') commitStrokeOnlyNote(strokeId);
      return;
    }
    var note = commitSelection(a, b);
    // 句子和笔迹都留下了，把笔迹挂到这条笔记上（一条笔记一份笔迹组）
    if (note && strokeId && typeof attachStrokeToNote === 'function') {
      attachStrokeToNote(strokeId, note.id);
    }
    return;
  }
  // 原生选区路径（鼠标 / 触控笔）
  var pts = pointsFromSelection();
  if (pts) commitSelection(pts.from, pts.to);
}

// 刚刚划完线的时间戳。
// 浏览器在 pointerup 之后必定还会派发一次 click，落点正是刚新建的高亮，
// 如果不拦，用户每次划完线都会立刻被弹「删除这条划线笔记？」—— 划线成了「划一下就问要不要删」。
// 所以结算后的 CLICK_SUPPRESS_MS 内忽略一切 click。
var CLICK_SUPPRESS_MS = 500;
var _ND_LAST_COMMIT = 0;
function suppressNextClick() { _ND_LAST_COMMIT = Date.now(); }
function clickSuppressed() { return (Date.now() - _ND_LAST_COMMIT) < CLICK_SUPPRESS_MS; }

function onNotePointerCancel() {
  _ND.down = false; _ND.self = false; _ND.moved = false; _ND.from = null; _ND.to = null;
  clearPreview();
}

// 点已划线的句子 → 问一句再删
function onNoteClick(e) {
  if (clickSuppressed()) { try { e.stopPropagation(); } catch (err) { } return; }
  var t = e.target;
  if (!t || t.nodeType !== 1) return;
  if (t.classList && t.classList.contains('word-ins')) return;   // 让「点词看释义」正常工作
  // ★ 高亮有两种形态：整句 .sent.note-hl（class）、句内切片 <mark class="note-hl-inline">。
  //   只认前者的话，点句内切片就删不掉了（实际踩过）。
  //   这里从两种形态都往上找句子 span。
  var sentEl = null;
  if (t.closest) {
    sentEl = t.closest('.sent.note-hl');
    if (!sentEl) sentEl = t.closest('.sent.note-hl-partial');
    if (!sentEl && t.closest('mark.note-hl-inline')) sentEl = t.closest('.sent');
  }
  if (!sentEl) return;
  var pel = sentEl.closest ? sentEl.closest('p[data-pi]') : null;
  if (!pel) return;
  var pi = parseInt(pel.getAttribute('data-pi'), 10);
  var si = parseInt(sentEl.getAttribute('data-si'), 10);
  if (isNaN(pi) || isNaN(si)) return;
  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  var list = chapterNotes(mid, cid);
  var target = null;
  for (var i = 0; i < list.length; i++) {
    var hit = (list[i].ranges || []).some(function (rg) {
      return rg.p === pi && si >= rg.si && si <= rg.ei;
    });
    if (hit) { target = list[i]; break; }
  }
  if (!target) return;
  try { e.stopPropagation(); } catch (err) { }
  var preview = String(target.text || '').replace(/\n/g, ' ');
  if (preview.length > 60) preview = preview.slice(0, 60) + '…';
  showConfirm('删除这条划线笔记？', preview, function () {
    deleteNote(target.id);
    toast('已删除划线', 'ok', 1800);
  });
}

function bindNoteEvents() {
  var area = document.getElementById('readingArea');
  if (!area || area.__noteBound) return;
  // DOM 桩（node 测试）里可能没有 addEventListener，这种情况直接跳过，别把整页初始化带崩
  if (typeof area.addEventListener !== 'function') return;
  area.__noteBound = true;
  area.addEventListener('pointerdown', onNotePointerDown, true);
  area.addEventListener('pointermove', onNotePointerMove, true);
  area.addEventListener('pointerup', onNotePointerUp, true);
  area.addEventListener('pointercancel', onNotePointerCancel, true);
  area.addEventListener('click', onNoteClick, true);
}

// ---------- 九、笔记抽屉 ----------

var NOTE_SCOPE = 'chapter';   // 'chapter' | 'book'

function toggleNoteDrawer(force) {
  var d = document.getElementById('noteDrawer');
  if (!d) return;
  var open = (typeof force === 'boolean') ? force : !d.classList.contains('open');
  d.classList.toggle('open', open);
  if (open) renderNotePanel();
}

function setNoteScope(s) {
  NOTE_SCOPE = s === 'book' ? 'book' : 'chapter';
  renderNotePanel();
}

function renderNotePanel() {
  var body = document.getElementById('noteDrawerBody');
  var badge = document.getElementById('noteCountBadge');
  var titleEl = document.getElementById('noteDrawerTitle');
  if (!body) return;

  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  if (!mid || !cid) {
    body.innerHTML = '<div class="note-empty">还没有打开任何章节</div>';
    if (badge) badge.textContent = '0';
    return;
  }

  var items;
  if (NOTE_SCOPE === 'book') {
    items = allNotesOfMaterial(mid).map(function (x) { return x.note; });
  } else {
    items = chapterNotes(mid, cid).slice();
  }
  if (badge) badge.textContent = String(items.length);

  var chs = STATE.chapters[mid] || [];
  var chTitle = '';
  for (var i = 0; i < chs.length; i++) { if (chs[i].id === cid) { chTitle = chs[i].title || ('第 ' + (i + 1) + ' 章'); break; } }
  if (titleEl) titleEl.textContent = (NOTE_SCOPE === 'book' ? '本书笔记' : chTitle) + '（' + items.length + '）';

  // 作用域切换按钮的选中态
  var tc = document.getElementById('noteScopeChapter');
  var tb = document.getElementById('noteScopeBook');
  if (tc) tc.classList.toggle('active', NOTE_SCOPE === 'chapter');
  if (tb) tb.classList.toggle('active', NOTE_SCOPE === 'book');

  if (!items.length) {
    body.innerHTML = '<div class="note-empty">还没有划线笔记。<br>用鼠标 / 触控笔直接拖选正文，'
      + '或点上方「✏️ 划线」后用鼠标、笔或手指滑动，<br>松手就会按整句收进这里。</div>';
    return;
  }

  var html = '';
  var oldCount = 0, shiftCount = 0;
  items.forEach(function (nt, idx) {
    var when = '';
    try { when = String(nt.createdAt || '').replace('T', ' ').slice(0, 16); } catch (e) { }
    var flags = [];
    // ★ 区分「整句笔记」和「精确到字的笔记」：
    //   整句笔记（所有 range 的 cs 都是 null）是在字符级功能之前划的，
    //   用户看到它们会以为「怎么还是整句」—— 必须显式标出来。
    var isWholeOnly = isWholeSentenceNote(nt);
    if (isWholeOnly) {
      oldCount++;
      flags.push('<span class="nt-badge nt-badge-whole" title="这条是在精确划线功能之前划的，一直都是整句；删掉重划即可精确到字">整句</span>');
    }
    // 旧的错位划线（偏移算错，标记落在句尾）：也要显式标出来 + 给修复入口
    var shifted = !isWholeOnly && isShiftedNote(nt);
    if (shifted) shiftCount++;
    if (nt.crossPara) flags.push('<span class="nt-badge nt-badge-cross">跨段 ' + (nt.ranges || []).length + ' 段</span>');

    // ★ 卡片主行：直接显示「你划到的那几个字」（从章节原文里切出来），
    //   这样「精确 11 字」就不再只是一句口号 —— 用户一眼能看到是哪 11 个字。
    //   整句仍然留在下面当上下文（一条笔记仍然属于那一句，方便定位）。
    var quoteHTML = '';
    if (!isWholeOnly) {
      var ex = noteExactSlice(nt);
      if (ex.text) {
        quoteHTML = '<div class="nt-quote" title="这就是你划到的那几个字">'
          + (shifted ? '<span class="nt-quote-warn">位置可能不对：</span>' : '')
          + escapeHTML(ex.text) + '</div>';
      }
      if (ex.count) flags.push('<span class="nt-badge nt-badge-exact" title="你划到的字数">精确 ' + ex.count + ' 字</span>');
    }
    if (shifted) {
      flags.push('<span class="nt-badge nt-badge-shift" title="旧版把偏移量算错，标记落在句尾了；用上面的「修复错位划线」可以挪回你划的位置">位置错位</span>');
    }
    flags.push('<span class="nt-badge">' + ((nt.sentences || []).length) + ' 句</span>');
    html += '<div class="note-item' + (isWholeOnly ? ' note-item-whole' : '') + (shifted ? ' note-item-shift' : '')
      + '" data-nid="' + escapeHTML(nt.id) + '">'
      + quoteHTML
      + '<div class="nt-text">' + escapeHTML(nt.text || '') + '</div>'
      + '<div class="nt-meta"><span>' + escapeHTML(when) + '</span>'
      + '<span style="display:flex;gap:6px;align-items:center">' + flags.join('')
      + '<button class="btn btn-sm btn-outline" onclick="onNoteItemLocate(\'' + escapeHTML(nt.id) + '\')">定位</button>'
      + '<button class="btn btn-sm btn-danger" onclick="onNoteItemDelete(\'' + escapeHTML(nt.id) + '\')">删除</button>'
      + '</span></div></div>';
  });
  // 顶部清理入口：整句笔记一键清、旧版错位笔记一键修
  var bars = '';
  if (oldCount > 0) {
    bars += '<div class="note-oldbar">'
      + '<span>有 <b>' + oldCount + '</b> 条是「整句笔记」（精确划线功能之前划的）。</span>'
      + '<button class="btn btn-sm btn-danger" onclick="clearWholeSentenceNotes()">清空这些整句笔记</button>'
      + '</div>';
  }
  if (shiftCount > 0) {
    bars += '<div class="note-oldbar note-shiftbar">'
      + '<span>有 <b>' + shiftCount + '</b> 条是<b>旧版位置错位</b>的划线：'
      + '偏移量被段落里的英文释义顶歪了，标记落在句尾 —— 不是你想划的地方。</span>'
      + '<span style="display:flex;gap:6px;flex-wrap:wrap">'
      + '<button class="btn btn-sm btn-primary" onclick="repairShiftedNotes()">修复错位划线</button>'
      + '<button class="btn btn-sm btn-outline" onclick="clearChapterNotes()">清空本章重划</button>'
      + '</span></div>';
  }
  if (bars) html = bars + html;
  body.innerHTML = html;
}

// 这条笔记是不是「纯整句」（没有任何字符级范围）
function isWholeSentenceNote(nt) {
  var rs = (nt && nt.ranges) || [];
  if (!rs.length) return true;                // 纯笔迹笔记，不算
  for (var i = 0; i < rs.length; i++) {
    if (rs[i] && rs[i].cs !== null && rs[i].cs !== undefined) return false;
  }
  return true;
}

// 精确标到的那几个字，从「章节原文」里切出来（唯一真相来源）
// 返回 {text, count}；text 是划到的那串字，count 是字数
// ★ 为什么从原文切片、而不是直接 ce-cs：
//   跨句/跨段的 range 里 cs 属于首句、ce 属于末句，直接相减没有意义。
function rangesExactSlice(ranges) {
  var paras = (typeof currentParagraphs === 'function') ? currentParagraphs() : null;
  var parts = [], n = 0;
  if (paras) {
    (ranges || []).forEach(function (rg) {
      if (!rg) return;
      var para = paras[rg.p];
      if (typeof para !== 'string') return;
      var rs = splitSentenceRanges(para);
      for (var si = rg.si; si <= rg.ei; si++) {
        var sent = rs[si];
        if (!sent) continue;
        if (rg.cs === null || rg.cs === undefined) continue;   // 整句不算「精确片段」
        var sl = (typeof rangeSliceInSent === 'function')
          ? rangeSliceInSent(rg, si, sent) : rangeCharSlice(rg, sent);
        if (!sl) continue;
        var piece = para.slice(sent.start + sl.s, sent.start + sl.e);
        if (!piece) continue;
        parts.push(piece);
        n += piece.length;
      }
    });
  }
  if (!n) {
    // 章节正文不在手上（整本视图）→ 退回按存储偏移估个数，至少徽章不出错
    var fb = 0;
    (ranges || []).forEach(function (rg) {
      if (rg && rg.cs !== null && rg.cs !== undefined && rg.ce !== null && rg.ce !== undefined) {
        fb += Math.max(0, rg.ce - rg.cs);
      }
    });
    return { text: '', count: fb };
  }
  return { text: parts.join(' '), count: n };
}

function noteExactSlice(nt) { return rangesExactSlice((nt && nt.ranges) || []); }

// 精确标了多少字（用于面板显示）
function noteCharCount(nt) { return noteExactSlice(nt).count; }

// ===== 旧版错位笔记：辨认 + 修复 =====
//
// v30 之前偏移量算错了（DOM 偏移当成原文偏移用，被段落里的英文释义顶歪），
// 这批笔记的 cs/ce 是错的，标记会落在句尾。它们没法自动分辨「本来就想划到句尾」
// 还是「被顶歪了」，唯一可靠的指纹是：起点 > 0 且终点被夹在句尾。
// 有指纹就给它一个修复入口（错位量 = 该句之前插入物的长度，从当前页面直接量）。
function isShiftedNote(nt) {
  var paras = (typeof currentParagraphs === 'function') ? currentParagraphs() : null;
  if (!paras) return false;
  var rs = (nt && nt.ranges) || [];
  for (var i = 0; i < rs.length; i++) {
    var rg = rs[i];
    if (!rg || rg.cs === null || rg.cs === undefined || rg.cs <= 0) continue;
    var para = paras[rg.p];
    if (typeof para !== 'string') continue;
    var sents = splitSentenceRanges(para);
    var sent = sents[rg.ei];
    if (!sent) continue;
    var total = sent.end - sent.start;
    var ce = (rg.ce === null || rg.ce === undefined) ? total : rg.ce;
    if (ce >= total) return true;      // 终点顶在句尾 → 错位的典型形状
  }
  return false;
}

// 按「当前渲染出来的页面」量出每句之前的插入物长度，把偏移挪回去
function shiftFixRanges(ranges, area) {
  if (!area || typeof area.querySelector !== 'function') return null;
  var out = [], changed = false;
  (ranges || []).forEach(function (rg) {
    if (!rg || rg.cs === null || rg.cs === undefined) { out.push(rg); return; }
    var pel = area.querySelector('p[data-pi="' + rg.p + '"]');
    if (!pel) { out.push(rg); return; }
    var shFirst = (typeof rawShiftBeforeSent === 'function') ? rawShiftBeforeSent(pel, rg.p, rg.si) : 0;
    var shLast = (typeof rawShiftBeforeSent === 'function') ? rawShiftBeforeSent(pel, rg.p, rg.ei) : 0;
    if (!shFirst && !shLast) { out.push(rg); return; }
    var ncs = Math.max(0, rg.cs - shFirst);
    var nce = (rg.ce === null || rg.ce === undefined) ? null : Math.max(ncs + 1, rg.ce - shLast);
    if (ncs === rg.cs && nce === rg.ce) { out.push(rg); return; }
    changed = true;
    out.push({ p: rg.p, si: rg.si, ei: rg.ei, cs: ncs, ce: nce });
  });
  return changed ? out : null;
}

function repairShiftedNotes() {
  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  if (!mid || !cid) return;
  var area = document.getElementById('readingArea');
  var list = chapterNotes(mid, cid);
  var hit = [];
  for (var i = 0; i < list.length; i++) {
    if (!isShiftedNote(list[i])) continue;
    var fixed = shiftFixRanges(list[i].ranges, area);
    if (fixed) hit.push({ note: list[i], fixed: fixed });
  }
  if (!hit.length) { toast('没有发现错位的划线', 'ok', 2200); return; }
  var before = rangesExactSlice(hit[0].note.ranges).text || '（读不到原文）';
  var after = rangesExactSlice(hit[0].fixed).text || '（读不到原文）';
  showConfirm('修复 ' + hit.length + ' 条错位划线？',
    '这些是旧版偏移算错留下的（被段落里的英文释义顶歪）。\n'
    + '现在标在：' + before + '\n'
    + '修复成：' + after,
    function () {
      var n = 0;
      for (var k = 0; k < hit.length; k++) {
        var nt = hit[k].note;
        nt.ranges = hit[k].fixed;
        n++;
        // 顺手把云端那份也改掉，否则下次从云端拉回来又变回旧的
        if (nt._cloudId && STATE.cloudReady && CLOUD.db && typeof noteCloudProps === 'function') {
          try { CLOUD.update(DB_IDS.context_notes, nt._cloudId, noteCloudProps(mid, cid, nt)); } catch (e) { }
        }
      }
      saveNotesLocal();
      renderNoteHighlights();
      renderNotePanel();
      toast('已修复 ' + n + ' 条划线，标记挪回你划的位置了', 'ok', 4200);
    });
}

// 划完把浏览器那片蓝色原生选区收掉。
// 不收的话它会盖在真正的高亮上，看着像「还是标的整句」（用户实际误会过）。
function clearNativeSelection() {
  try {
    if (typeof window === 'undefined' || !window.getSelection) return;
    var s = window.getSelection();
    if (s && typeof s.removeAllRanges === 'function') s.removeAllRanges();
  } catch (e) { }
}

// 一键清掉本章所有划线笔记（旧版错位又修不动的，重划最快）
function clearChapterNotes() {
  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  if (!mid || !cid) return;
  var list = chapterNotes(mid, cid).slice();
  if (!list.length) { toast('本章还没有划线笔记', 'ok', 2000); return; }
  showConfirm('清空本章 ' + list.length + ' 条划线？',
    '清掉之后在正文上重新划一次即可，这次是精确到你划的那几个字的。',
    function () {
      var n = 0;
      for (var i = 0; i < list.length; i++) { if (deleteNote(list[i].id)) n++; }
      renderNoteHighlights();
      renderNotePanel();
      toast('已清空 ' + n + ' 条划线，可以重新划了', 'ok', 3200);
    });
}

// 一键清掉所有「整句笔记」（逐条走 deleteNote，云端墓碑照常处理）
function clearWholeSentenceNotes() {
  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  if (!mid || !cid) return;
  var doomed = chapterNotes(mid, cid).filter(isWholeSentenceNote);
  if (!doomed.length) { toast('没有整句笔记需要清理', 'ok', 1800); return; }
  showConfirm('清空 ' + doomed.length + ' 条整句笔记？',
    '这些是精确划线功能之前划的（只能整句）。清空后你可以重新划一次，就只标划到的那几个字了。',
    function () {
      var n = 0;
      for (var i = 0; i < doomed.length; i++) {
        if (deleteNote(doomed[i].id)) n++;
      }
      renderNoteHighlights();
      renderNotePanel();
      toast('已清空 ' + n + ' 条整句笔记，可以重新划了', 'ok', 3200);
    });
}

function onNoteItemDelete(noteId) {
  showConfirm('删除这条划线笔记？', '删除后这条划线标记也会一起消失。', function () {
    if (deleteNote(noteId)) toast('已删除划线', 'ok', 1800);
  });
}

// 面板里点「定位」→ 关掉抽屉、滚到那一段
function onNoteItemLocate(noteId) {
  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  if (!mid || !cid) return;
  var nt = findNoteById(mid, cid, noteId);
  var target = nt;
  if (!target) {
    // 整本视图下可能属于别的章节 → 切过去
    var all = allNotesOfMaterial(mid);
    for (var i = 0; i < all.length; i++) { if (all[i].note.id === noteId) { target = all[i].note; cid = all[i].chId; break; } }
    if (!target) return;
    if (cid !== STATE.learnChapterId) {
      STATE.learnChapterId = cid;
      if (typeof refreshLearn === 'function') refreshLearn(true);
    }
  }
  toggleNoteDrawer(false);
  setTimeout(function () {
    var area = document.getElementById('readingArea');
    if (!area || typeof area.querySelector !== 'function') return;
    var p0 = (target.ranges && target.ranges[0]) ? target.ranges[0].p : null;
    if (p0 === null) return;
    var pel = area.querySelector('p[data-pi="' + p0 + '"]');
    if (pel && pel.scrollIntoView) pel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 220);
}

// ---------- 十、初始化 ----------

function initNotesModule() {
  ensureNotesState();
  bindNoteEvents();
  var area = document.getElementById('readingArea');
  if (area && area.classList && typeof area.classList.toggle === 'function') {
    area.classList.toggle('marking-mode', NOTE_MODE);
  }
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNotesModule);
  else initNotesModule();
}
