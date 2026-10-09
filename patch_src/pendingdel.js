// ===== 删除待办：云端没删成功的，下次进应用自动补删 =====
// 背景：删除只在本地立刻生效，云端那份如果当时删不掉（离线 / 请求失败 / 记录没有云端编号），
// 页面下次用云端覆盖本地时，删掉的书就会复活。这里把「还没删干净」的云端记录记下来，
// 下次进应用先补删，再加载数据。

var PENDING_DEL_PREFIX = 'pendingDel_v1_';
var PENDING_DEL_MAX_TRIES = 5;

function pendingDelKey() { return PENDING_DEL_PREFIX + (STATE.profileId || 'anon'); }

function pendingDelList() {
  var list = LS.get(pendingDelKey(), []);
  return Array.isArray(list) ? list : [];
}

function savePendingDelList(list) { LS.set(pendingDelKey(), list); }

// 记下一条「还没删干净」的云端记录
function queuePendingDel(dbId, recordId) {
  if (!dbId || !recordId || !STATE.profileId) return;
  var list = pendingDelList();
  for (var i = 0; i < list.length; i++) {
    if (list[i].db === dbId && list[i].id === recordId) return;   // 已在待办里
  }
  list.push({ db: dbId, id: recordId, at: nowISO(), tries: 0 });
  savePendingDelList(list);
  console.log('[删除待办] 记下云端残留，稍后补删', dbId, recordId);
}

function unqueuePendingDel(dbId, recordId) {
  var list = pendingDelList().filter(function (t) { return !(t.db === dbId && t.id === recordId); });
  savePendingDelList(list);
}

// 进应用后执行待办补删；返回补删成功的条数
function flushPendingDels() {
  if (!STATE.cloudReady || !CLOUD.db || !STATE.profileId) return Promise.resolve(0);
  var list = pendingDelList();
  if (!list.length) return Promise.resolve(0);
  var done = 0, giveUp = 0;
  var jobs = list.map(function (t) {
    // _rawDel 失败时返回 null；成功时返回 SDK 结果
    return CLOUD.del(t.db, t.id).then(function (r) {
      if (r !== null) { unqueuePendingDel(t.db, t.id); done++; return; }
      var rest = pendingDelList();
      for (var i = 0; i < rest.length; i++) {
        if (rest[i].db === t.db && rest[i].id === t.id) {
          rest[i].tries = (rest[i].tries || 0) + 1;
          if (rest[i].tries >= PENDING_DEL_MAX_TRIES) { rest.splice(i, 1); giveUp++; }
          break;
        }
      }
      savePendingDelList(rest);
    }).catch(function () { return null; });
  });
  return Promise.all(jobs).then(function () {
    if (done > 0) toast('已补删 ' + done + ' 项云端残留（此前删除没传到云端）', 'ok', 8000);
    if (giveUp > 0) console.warn('[删除待办] ' + giveUp + ' 项连续失败已放弃，请检查网络后手动再删一次');
    return done;
  });
}

// 待办条数（供自检面板展示）
function pendingDelCount() { return pendingDelList().length; }
