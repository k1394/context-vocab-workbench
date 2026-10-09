/* ===== 阅读进度（saveScrollPos）+ 新增标注推云端失败补偿 =====

   问题一：阅读进度永远是 0，「继续上次位置」是死代码
     根因： .reading-area 的 CSS 里没有 overflow / max-height，它本身不是滚动容器，
            所以挂在它上面的 onscroll="saveScrollPos()" **从来没触发过**；
            就算触发了，它读的 area.scrollTop 也恒为 0。真正滚动的是页面（本地）
            或 iframe 视口（线上）。
     处理：① 换一套「真实滚动层」探测；② 在 window/document 上用捕获阶段监听
            scroll（能收到内层容器的事件），节流后写进度；③ 恢复时按同一个滚动层还原。

   问题二：新增标注推云端失败后没有补偿
     根因： syncMatchToCloud 的 CLOUD.add 失败只是静默丢掉 _cloudId，
            同一次会话内不会重试，只能等下次加载靠对账合并兜（而且合并是全量重推，
            失败会反复发生，用户也没有任何感知）。
     处理：仿 pendingDel 做一份 pendingAdd 墓碑：失败就记下来，
            进应用加载完成后集中补推一次；补推时按业务键找本地那条，
            已经被删掉的直接从待办里清掉，不会凭空造出数据。
   ============================================================ */

// ---------- 一、真实滚动层探测 ----------
// 返回 { el, top, max }：el 为 null 表示滚动发生在页面（window/documentElement）上
function currentScrollInfo() {
  var doc = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement : null;
  var win = (typeof window !== 'undefined') ? window : null;
  var docTop = win ? (win.pageYOffset || (doc ? doc.scrollTop : 0) || 0) : 0;
  var docMax = doc ? Math.max(0, (doc.scrollHeight || 0) - (doc.clientHeight || 0)) : 0;
  if (docMax > 4) return { el: null, top: docTop, max: docMax };

  // 页面本身滚不动 → 逐级向上找可滚动的祖先容器
  var area = document.getElementById('readingArea');
  var p = area ? area.parentElement : null;
  var g = 0;
  while (p && g++ < 40) {
    if (typeof p.scrollHeight === 'number' && typeof p.clientHeight === 'number'
        && p.scrollHeight > p.clientHeight + 4) {
      return { el: p, top: p.scrollTop || 0, max: p.scrollHeight - p.clientHeight };
    }
    p = p.parentElement;
  }
  return { el: null, top: docTop, max: docMax };
}

// 阅读区是否真的在视口里（避免在别的页面滚动时把页面位置当成阅读进度）
function isReadingVisible() {
  var area = document.getElementById('readingArea');
  if (!area || typeof area.getBoundingClientRect !== 'function') return false;
  var r = area.getBoundingClientRect();
  var h = (typeof window !== 'undefined' && window.innerHeight) || 800;
  return r.height > 0 && r.bottom > 0 && r.top < h;
}

function saveScrollPos() {
  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;
  var info = currentScrollInfo();
  var pct = info.max > 0 ? Math.round(info.top / info.max * 100) : 0;
  if (!(pct >= 0)) pct = 0;
  if (pct > 100) pct = 100;

  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  if (!STATE.progress[mid]) STATE.progress[mid] = {};
  var cur = STATE.progress[mid][cid];
  if (!cur) {
    cur = STATE.progress[mid][cid] = { mode: 'meaning', scrollPct: 0, paraIdx: 0 };
  }
  if (cur.scrollPct === pct) return;   // 没变就不写盘、不排同步
  cur.scrollPct = pct;
  cur.updatedAt = nowISO();
  saveLocal();
  scheduleSync();
}

// 把视图还原到指定百分比位置
function restoreScrollPct(pct) {
  if (!(pct > 0)) return;
  setTimeout(function () {
    var info = currentScrollInfo();
    var y = Math.round(info.max * (pct / 100));
    if (!(y > 0)) return;
    if (info.el) { try { info.el.scrollTop = y; } catch (e) { } }
    else if (typeof window !== 'undefined' && window.scrollTo) { try { window.scrollTo(0, y); } catch (e) { } }
  }, 60);
}

// 捕获阶段监听：scroll 事件不冒泡，但用 capture 能收到任意内层滚动容器的事件
function bindScrollTracking() {
  if (typeof window === 'undefined' || window.__scopeScrollBound) return;
  window.__scopeScrollBound = true;
  var timer = null;
  function onScroll() {
    if (!STATE.learnMaterialId || !STATE.learnChapterId) return;
    // ★ 先做便宜的节流判断，再谈贵的测量。
    //   原来 isReadingVisible() 在**每个** scroll 事件里都跑一遍，
    //   而它内部是 getBoundingClientRect() —— 会强制同步布局（forced reflow）。
    //   滚动一秒能来上百个事件，等于上百次强制重排；平板上这笔开销很实在。
    //   把节流判断提到前面：400ms 内最多测一次。
    if (timer) return;
    if (!isReadingVisible()) return;
    timer = setTimeout(function () {
      timer = null;
      try { saveScrollPos(); } catch (e) { }
    }, 400);
  }
  try { window.addEventListener('scroll', onScroll, true); } catch (e) { }
  try { document.addEventListener('scroll', onScroll, true); } catch (e) { }
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindScrollTracking);
  else bindScrollTracking();
}

// ---------- 二、新增标注推云端失败的补偿 ----------
var PENDING_ADD_PREFIX = 'pendingAdd_v1_';
var PENDING_ADD_MAX = 300;          // 单账号最多记这么多（防撑爆 localStorage）
var PENDING_ADD_MAX_TRIES = 3;

function pendingAddKey() { return PENDING_ADD_PREFIX + (STATE.profileId || 'anon'); }
function pendingAddList() {
  var list = LS.get(pendingAddKey(), []);
  return Array.isArray(list) ? list : [];
}
function savePendingAddList(list) { LS.set(pendingAddKey(), list); }
function pendingAddCount() { return pendingAddList().length; }

function matchBizKey(t) { return (t.matId || '') + '|' + (t.chId || '') + '|' + (t.lemma || '') + '|' + (t.chWord || '') + '|' + (t.position || 0); }

// 同一条标注只记一次；超过上限时丢最旧的（新的更重要）
function queuePendingAdd(t) {
  if (!t || !t.matId || !t.chId || !t.lemma || !STATE.profileId) return;
  var list = pendingAddList();
  var k = matchBizKey(t);
  for (var i = 0; i < list.length; i++) {
    if (matchBizKey(list[i]) === k) return;
  }
  list.push({
    matId: t.matId, chId: t.chId, lemma: t.lemma, chWord: t.chWord || '',
    position: t.position || 0, sense: t.sense || '', sentence: t.sentence || '',
    manual: !!t.manual, at: nowISO(), tries: 0
  });
  while (list.length > PENDING_ADD_MAX) list.shift();
  savePendingAddList(list);
}

function unqueuePendingAdd(t) {
  var k = matchBizKey(t);
  savePendingAddList(pendingAddList().filter(function (x) { return matchBizKey(x) !== k; }));
}

function bumpPendingAddTries(t) {
  var k = matchBizKey(t);
  var list = pendingAddList();
  for (var i = 0; i < list.length; i++) {
    if (matchBizKey(list[i]) === k) {
      list[i].tries = (list[i].tries || 0) + 1;
      // 注意：这里不能 return —— 要落下去走到 savePendingAddList，否则「放弃」不会写盘
      if (list[i].tries >= PENDING_ADD_MAX_TRIES) list.splice(i, 1);
      break;
    }
  }
  savePendingAddList(list);
}

// 单条推云端；返回 Promise<boolean>（true = 已拿到 _cloudId）
function pushOneMatch(matId, chId, m) {
  var props = {
    'profile_id': { text: STATE.profileId },
    '资料ID': { text: matId },
    '章节ID': { text: chId },
    '词元': { text: m.lemma },
    '对应中文': { text: m.chWord },
    '使用义项': { text: m.sense || '' },
    '位置': { number: m.position || 0 },
    '所在句子': { text: m.sentence || '' },
    '手动修改': { checkbox: m.manual || false }
  };
  return CLOUD.add(DB_IDS.context_matches, props).then(function (r) {
    if (r && r.id) { m._cloudId = r.id; return true; }
    return false;
  }).catch(function () { return false; });
}

// 逐条补推。已经在本地被删掉的（说明用户不需要它了）直接从待办里清掉，不重建。
function flushPendingAdds() {
  if (!STATE.cloudReady || !CLOUD.db || !STATE.profileId) return Promise.resolve(0);
  var list = pendingAddList();
  if (!list.length) return Promise.resolve(0);
  var done = 0, dropped = 0;
  var jobs = list.map(function (t) {
    var arr = ((STATE.matches || {})[t.matId] || {})[t.chId] || [];
    var found = null;
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (m.lemma === t.lemma && m.chWord === t.chWord && (m.position || 0) === (t.position || 0)) { found = m; break; }
    }
    if (!found) { unqueuePendingAdd(t); dropped++; return Promise.resolve(); }
    if (found._cloudId) { unqueuePendingAdd(t); done++; return Promise.resolve(); }
    return pushOneMatch(t.matId, t.chId, found).then(function (ok) {
      if (ok) { unqueuePendingAdd(t); done++; } else { bumpPendingAddTries(t); }
    });
  });
  return Promise.all(jobs).then(function () {
    if (done > 0) { saveLocal(); toast('已补推 ' + done + ' 条语境标注到云端', 'ok', 7000); }
    if (dropped > 0) console.log('[标注补偿] ' + dropped + ' 条已在本地删除，不再补推');
    return done;
  });
}
