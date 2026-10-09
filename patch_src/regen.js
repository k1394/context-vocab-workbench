// ===== 取词池（单词书选择 + 词池范围过滤）=====
function buildLearnWordPool() {
  var opts = getLearnOpts();
  var ids = opts.bookIds || [];
  var pool = STATE.words;
  if (ids.length) {
    pool = pool.filter(function(w) { return ids.indexOf(w.wordbookId || '') !== -1; });
  }
  var scope = opts.poolScope || 'all';
  if (scope === 'all') return pool;
  var vocabSet = {};
  STATE.vocab.forEach(function(v) { vocabSet[(v.lemma || '').toLowerCase()] = true; });
  return pool.filter(function(w) {
    var lm = (w.lemma || '').toLowerCase();
    var m = STATE.mastery[w.lemma] || STATE.mastery[lm] || {};
    var st = m.status || 'unknown';
    if (scope === 'unknown') return st !== 'known';
    if (scope === 'fuzzy') return st === 'fuzzy';
    if (scope === 'vocab') return !!vocabSet[lm];
    return true;
  });
}

// 当前词池的简短描述，用于按钮文案
function learnPoolSummary() {
  var ids = getLearnOpts().bookIds || [];
  if (!ids.length) return '全部单词书';
  var names = [];
  ids.forEach(function(id) {
    for (var i = 0; i < STATE.wordbooks.length; i++) {
      if (STATE.wordbooks[i].id === id) { names.push(STATE.wordbooks[i].name); return; }
    }
  });
  if (names.length === 0) return '全部单词书';
  if (names.length === 1) return names[0];
  return names[0] + ' +' + (names.length - 1) + ' 本';
}

function saveLearnOpts() {
  if (!STATE.profileId) return;
  LS.set('learnOpts_' + STATE.profileId, getLearnOpts());
}

// ===== 单词书选择器 UI =====
function renderWbPicker() {
  var panel = document.getElementById('wbPanel');
  var opts = getLearnOpts();

  var sel = document.getElementById('selStrategy');
  if (sel) sel.value = opts.strategy;
  var pm = document.getElementById('perParaMaxInput');
  if (pm) pm.value = opts.perParaMax;

  var btn = document.getElementById('wbPickerBtn');
  if (btn) btn.textContent = '单词书：' + learnPoolSummary();
  if (!panel) return;

  var ids = opts.bookIds || [];
  var html = '<div class="wp-sec">参与取词的单词书</div>';
  if (STATE.wordbooks.length === 0) {
    html += '<div class="wp-none">还没有单词书</div>';
  } else {
    STATE.wordbooks.forEach(function(wb) {
      var cnt = STATE.words.filter(function(w) { return w.wordbookId === wb.id; }).length;
      var on = (ids.length === 0) || (ids.indexOf(wb.id) !== -1);
      html += '<label class="wp-row"><input type="checkbox" ' + (on ? 'checked' : '') +
        ' onchange="onWbCheck(\'' + wb.id + '\', this.checked)">' +
        '<span class="wp-name">' + escapeHTML(wb.name) + '</span>' +
        '<span class="wp-cnt">' + cnt + ' 词</span></label>';
    });
  }
  html += '<div class="wp-foot"><button type="button" onclick="onWbAll(\'all\')">全部参与</button>' +
    '<button type="button" onclick="onWbAll(\'builtin\')">仅内置</button></div>';

  html += '<div class="wp-sec">词池范围</div>';
  var scopes = [['all', '全部词'], ['unknown', '还没记住（未掌握）'], ['fuzzy', '标记为模糊的'], ['vocab', '生词本']];
  scopes.forEach(function(s) {
    html += '<label class="wp-row"><input type="radio" name="wpScope" value="' + s[0] + '"' +
      (opts.poolScope === s[0] ? ' checked' : '') +
      ' onchange="onPoolScope(\'' + s[0] + '\')"><span class="wp-name">' + escapeHTML(s[1]) + '</span></label>';
  });

  panel.innerHTML = html;
}

function toggleWbPicker(ev) {
  if (ev) ev.stopPropagation();
  var panel = document.getElementById('wbPanel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    renderWbPicker();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function onWbCheck(id, checked) {
  var opts = getLearnOpts();
  var all = STATE.wordbooks.map(function(w) { return w.id; });
  var ids = (opts.bookIds && opts.bookIds.length) ? opts.bookIds.slice() : all.slice();
  var i = ids.indexOf(id);
  if (checked && i === -1) ids.push(id);
  if (!checked && i !== -1) ids.splice(i, 1);
  if (ids.length >= all.length) ids = [];   // 全选时就记成「空数组 = 全部」
  opts.bookIds = ids;
  saveLearnOpts();
  renderWbPicker();
  applyPoolChange();
}

function onWbAll(kind) {
  var opts = getLearnOpts();
  opts.bookIds = (kind === 'builtin') ? [BUILTIN_WB_ID] : [];
  saveLearnOpts();
  renderWbPicker();
  applyPoolChange();
}

function onPoolScope(v) {
  getLearnOpts().poolScope = v;
  saveLearnOpts();
  applyPoolChange();
}

function onStrategyChange() {
  var sel = document.getElementById('selStrategy');
  getLearnOpts().strategy = sel ? sel.value : 'balanced';
  saveLearnOpts();
  applyPoolChange();
}

function onPerParaMaxChange() {
  var el = document.getElementById('perParaMaxInput');
  var v = parseInt(el ? el.value : '4', 10);
  if (!v || v < 1) v = 1;
  if (v > 30) v = 30;
  if (el) el.value = v;
  getLearnOpts().perParaMax = v;
  saveLearnOpts();
  applyPoolChange();
}

// 词池 / 分布设置变化 → 只重算当前章（其他章保持不动）
function applyPoolChange() {
  if (STATE.learnMaterialId && STATE.learnChapterId) {
    var n = regenerateMatches(STATE.learnMaterialId, STATE.learnChapterId);
    refreshLearn();
    toast('已切换到「' + learnPoolSummary() + '」，本章重算 ' + n + ' 处标注（手动标注已保留）', 'ok');
  }
  renderMaterials();
}

// 全部资料重算（按钮兜底）
function regenerateAllMaterials() {
  if (STATE.materials.length === 0) { toast('还没有学习资料', 'err'); return; }
  if (buildLearnWordPool().length === 0) { toast('当前词池里没有可用的词，请换一本单词书或调整词池范围', 'err'); return; }
  var total = 0;
  STATE.materials.forEach(function(m) { total += regenerateMatchesForMaterial(m.id) || 0; });
  if (STATE.learnMaterialId && STATE.learnChapterId) refreshLearn();
  renderMaterials();
  toast('已按当前词池重算 ' + STATE.materials.length + ' 份资料，共 ' + total + ' 处标注', 'ok');
}

// 点空白处收起单词书面板
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', function(e) {
    var panel = document.getElementById('wbPanel');
    if (!panel || panel.classList.contains('hidden')) return;
    var picker = document.getElementById('wbPicker');
    if (picker && picker.contains(e.target)) return;
    panel.classList.add('hidden');
  });
}

// ===== 重新生成语境材料 =====
function regenerateMatches(matId, chId) {
  var chs = STATE.chapters[matId] || [];
  var ch = chs.find(function(c) { return c.id === chId; });
  if (!ch) return 0;
  var allWords = buildLearnWordPool();
  if (allWords.length === 0) return 0;
  var target = (ch.targetWords && ch.targetWords >= 1) ? ch.targetWords : 30;
  var res = generateContextMatches(ch, allWords, 'all', target, getLearnOpts());
  if (!STATE.matches[matId]) STATE.matches[matId] = {};
  // 保留旧的手动修改（如果有 manual 字段）
  var oldMatches = STATE.matches[matId][chId] || [];
  var manualMatches = oldMatches.filter(function(m) { return m.manual; });
  // 新生成的非 manual 匹配，去重（避免和 manual 重复）
  var usedLemmas = {};
  manualMatches.forEach(function(m) { usedLemmas[m.lemma + '|' + m.chWord] = true; });
  var newNonManual = res.matches.filter(function(m) { return !usedLemmas[m.lemma + '|' + m.chWord]; });
  STATE.matches[matId][chId] = manualMatches.concat(newNonManual);
  ch.unmatchedWords = res.unmatched.slice(0, 200);
  ch.paraDist = res.paraDist;
  ch.poolSize = allWords.length;
  ch.capBlocked = res.capBlocked || 0;
  ch.uniqueCount = res.uniqueCount || 0;
  ch.generated = true;
  saveLocal();
  // 同步到云端（仅同步新增的自动匹配）
  newNonManual.forEach(function(m) { syncMatchToCloud(matId, chId, m); });
  return STATE.matches[matId][chId].length;
}
function regenerateMatchesForMaterial(matId) {
  var chs = STATE.chapters[matId] || [];
  var total = 0;
  chs.forEach(function(ch) { total += regenerateMatches(matId, ch.id) || 0; });
  return total;
}
function regenerateAllMatches() {
  var total = 0;
  STATE.materials.forEach(function(m) { total += regenerateMatchesForMaterial(m.id); });
  return total;
}

