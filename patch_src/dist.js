/* ===== 语境标注分布修复包 =====
   解决的问题：标注的词集中出现在前几段，重算也不见效。
   三段式根因：
     ① 旧匹配从不重算（只有「空」才生成）→ 用签名机制让参数/算法一变就自动重算；
     ② 重算只增不删，云端老分布下次刷新又被覆盖拉回来 → 重算时一并清除旧记录；
     ③ 目标词数少于段落数时，遍历顺序从头开始 → 按等间隔铺开。
   ============================================================ */

// 算法版本号：改动分布算法时 +1，所有老数据会自动重算一次
var MATCH_ALGO_VERSION = 2;

function matchSigKey() { return 'matchSig_v1_' + (STATE.profileId || 'anon'); }
function matchSigMap() { var m = LS.get(matchSigKey(), {}); return (m && typeof m === 'object') ? m : {}; }

// 生成签名：这些参数任意一个变了，已有标注就不再可信
function matchSigFor(ch, opts, poolSize) {
  var o = opts || {};
  return [
    MATCH_ALGO_VERSION,
    o.strategy || 'balanced',
    o.perParaMax || 4,
    o.maxRepeatPerWord || 2,
    o.strictTrigger === false ? 0 : 1,
    (o.bookIds && o.bookIds.length) ? o.bookIds.join('+') : 'all',
    (ch && ch.targetWords) ? ch.targetWords : 30,
    poolSize || 0
  ].join('|');
}
function matchSigGet(matId, chId) { return matchSigMap()[matId + '|' + chId] || ''; }
function matchSigSet(matId, chId, sig) {
  var m = matchSigMap();
  m[matId + '|' + chId] = sig;
  LS.set(matchSigKey(), m);
}
// 词池规模变了（换了单词书）也算失配
function matchSigStale(matId, ch, opts, poolSize) {
  var ms = (STATE.matches[matId] && STATE.matches[matId][ch.id]) || [];
  if (ms.length === 0) return true;
  return matchSigGet(matId, ch.id) !== matchSigFor(ch, opts, poolSize);
}

// 云端调用节流：一整本书可能有几百条标注，一次性并发会被平台限流
var CLOUD_BATCH = 10;
var CLOUD_BATCH_GAP = 60;
function runInBatches(items, fn, gap) {
  var i = 0;
  function step() {
    if (i >= items.length) return;
    var batch = items.slice(i, i + CLOUD_BATCH);
    i += CLOUD_BATCH;
    for (var k = 0; k < batch.length; k++) {
      try { fn(batch[k], i - CLOUD_BATCH + k); } catch (e) { /* 单条失败不影响其余 */ }
    }
    if (i < items.length) setTimeout(step, gap === undefined ? CLOUD_BATCH_GAP : gap);
  }
  step();
}

// 重算前清掉旧的自动匹配（本地数组会在调用方整体替换，这里只管云端）
function purgeAutoMatches(matId, chId, list) {
  if (!list || !list.length) return 0;
  var canDel = STATE.cloudReady && CLOUD && typeof CLOUD.del === 'function';
  var targets = [];
  for (var j = 0; j < list.length; j++) {
    if (list[j] && list[j]._cloudId) targets.push(list[j]._cloudId);
  }
  if (!targets.length) return 0;
  if (!canDel) {
    // 离线也要记待办，否则下次登录云端老分布又覆盖回来
    for (var k = 0; k < targets.length; k++) {
      if (typeof queuePendingDel === 'function') queuePendingDel(DB_IDS.context_matches, targets[k]);
    }
    return targets.length;
  }
  runInBatches(targets, function (cid) {
    CLOUD.del(DB_IDS.context_matches, cid).then(function (r) {
      if (r === null && typeof queuePendingDel === 'function') queuePendingDel(DB_IDS.context_matches, cid);
    }).catch(function () {
      if (typeof queuePendingDel === 'function') queuePendingDel(DB_IDS.context_matches, cid);
    });
  });
  return targets.length;
}

// 重算产生的新标注同样分批推云端，避免一次性几百个 add
function pushMatchesThrottled(matId, chId, list) {
  if (!list || !list.length) return;
  runInBatches(list, function (m) { syncMatchToCloud(matId, chId, m); });
}

// 分布体检：前 1/3 段承载了超过 70% 的标注就算偏集中
function matchDistHealth(matches, dist) {
  if (!dist || !dist.length) return { frontShare: 0, blank: 0, skewed: false };
  var total = 0, blank = 0, i;
  for (i = 0; i < dist.length; i++) { total += dist[i]; if (dist[i] === 0) blank++; }
  var ft = Math.max(1, Math.round(dist.length / 3));
  var front = 0;
  for (i = 0; i < ft && i < dist.length; i++) front += dist[i];
  var share = total ? (front / total) : 0;
  return {
    frontShare: share, blank: blank, total: total,
    skewed: (dist.length >= 6 && total >= 6 && share >= 0.7)
  };
}

// ---------- 章节底部导航 ----------
function clipChapterTitle(t) {
  t = String(t || '');
  return t.length > 12 ? t.slice(0, 12) + '…' : t;
}

function renderChapterNav() {
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var idx = chs.findIndex(function (c) { return c.id === STATE.learnChapterId; });
  var prevBtn = document.getElementById('navPrevBtn');
  var nextBtn = document.getElementById('navNextBtn');
  var titleEl = document.getElementById('chNavTitleBottom');
  var progEl = document.getElementById('chNavProgressBottom');
  if (!prevBtn || !nextBtn) return;
  var prevCh = (idx > 0) ? chs[idx - 1] : null;
  var nextCh = (idx >= 0 && idx < chs.length - 1) ? chs[idx + 1] : null;

  prevBtn.disabled = !prevCh;
  nextBtn.disabled = !nextCh;
  prevBtn.title = prevCh ? ('上一章：' + prevCh.title) : '已经是第一章';
  nextBtn.title = nextCh ? ('下一章：' + nextCh.title) : '已经是最后一章';
  prevBtn.innerHTML = prevCh ? ('← 上一章 · ' + escapeHTML(clipChapterTitle(prevCh.title))) : '← 上一章';
  nextBtn.innerHTML = nextCh ? (escapeHTML(clipChapterTitle(nextCh.title)) + ' · 下一章 →') : '下一章 →';

  if (titleEl) titleEl.textContent = (idx >= 0 ? chs[idx].title : '');
  if (progEl) {
    progEl.textContent = chs.length
      ? ('全文进度 第 ' + (idx + 1) + ' / ' + chs.length + ' 章' + (idx >= chs.length - 1 ? ' · 已是最后一章' : ''))
      : '';
  }
}

// 跳到相邻章节；fromBottom 为真时滚到文首（底部导航的预期行为）
function jumpChapter(delta, fromBottom) {
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var idx = chs.findIndex(function (c) { return c.id === STATE.learnChapterId; });
  if (idx < 0) return;
  var ni = idx + delta;
  if (ni < 0 || ni >= chs.length) return;
  STATE.learnChapterId = chs[ni].id;
  var sel = document.getElementById('selChapter');
  if (sel) sel.value = STATE.learnChapterId;
  refreshLearn(!!fromBottom);
}
