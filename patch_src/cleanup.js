/* ===== 示例数据彻底移除 + 删除墓碑 + 多副本删除 =====

   (1) 被注入过的那本示例词书删了又回来
       根因：旧的示例注入逻辑每次都用 uid('wb') 生成**新 ID** 再推到云端，
             于是云端累积了多条同名记录；而 removeWordbook 只把**最后一条**的
             _cloudId 放进删除队列（变量 wb 被后面的循环覆盖）→ 其余副本留在云端，
             刷新后被覆盖式加载拉回来。
       处理：① 不再注入任何示例数据；② 加载时把历史示例残留一次清干净（本地 + 云端）。

   (2) 删掉的东西刷新后又出现（不止示例书）
       根因：只有「云端删成功」才算数。删除失败时靠补删，但补删要等下次进应用，
             中间任何一次加载都还会把旧数据拉回来显示。
       处理：删除时在本地留「墓碑」（复用 pendingDel 列表），加载时直接跳过命中墓碑的
             云端行：即使云端还没删掉，界面上也不会再出现，后台继续补删。

   (3) 同一个业务 ID 在云端有多条记录时只删掉一条
       处理：removeWordbook 收集**所有**同名/同业务 ID 的记录并逐条删云端。
   ============================================================ */

// ---------- 一、示例数据的识别 ----------
// 判定标准只看「书名/标题里带示例二字」这一条特征：
// 历史上被注入的那份示例数据，书名与资料标题里都带「示例」，
// 而用户自己导入的词书/资料不会用这种命名。
function isLegacySampleWordbook(w) {
  if (!w) return false;
  return String(w.name || '').indexOf('示例') >= 0;
}

function isLegacySampleMaterial(m) {
  if (!m) return false;
  return String((m && m.title) || '').indexOf('示例') >= 0;
}

// 云端原始行 → 是否属于历史示例数据
function isLegacySampleRow(dbId, r) {
  if (!r) return false;
  if (dbId === DB_IDS.context_wordbooks) {
    return isLegacySampleWordbook({ name: r['书名'], source: r['源文件'] });
  }
  if (dbId === DB_IDS.context_materials) {
    return isLegacySampleMaterial({ title: r['标题'] });
  }
  return false;
}

// ---------- 二、加载期拦截 ----------
var _LEGACY_PURGE_JOBS = [];      // 待删云端的 {db, id}
var _LEGACY_PURGE_WB_IDS = {};    // 被判定为示例书的业务 ID → 用来连带清掉它的词
var _LEGACY_PURGE_MAT_IDS = {};   // 被判定为示例资料的业务 ID
var _TOMB_BY_DB = null;           // 墓碑索引：dbId → { 云端记录ID: 1 }

function legacyPurgeReset() {
  _LEGACY_PURGE_JOBS = [];
  _LEGACY_PURGE_WB_IDS = {};
  _LEGACY_PURGE_MAT_IDS = {};
}

// 把 pendingDel 列表编译成 dbId → 记录ID 的索引（一次加载只读一次 localStorage）
function tombBuild() {
  _TOMB_BY_DB = {};
  if (typeof pendingDelList !== 'function') return;
  pendingDelList().forEach(function (t) {
    if (!t || !t.db || !t.id) return;
    if (!_TOMB_BY_DB[t.db]) _TOMB_BY_DB[t.db] = {};
    _TOMB_BY_DB[t.db][t.id] = 1;
  });
}

function isTombstoned(dbId, recordId) {
  if (!recordId || !_TOMB_BY_DB) return false;
  var m = _TOMB_BY_DB[dbId];
  return !!(m && m[recordId]);
}

// 云端返回的行 → 剔除「历史示例」与「已删除但云端还没删掉」的记录。
// 被剔除的示例行会进 _LEGACY_PURGE_JOBS，加载收尾时统一删云端。
function filterCloudRows(dbId, rows) {
  if (!rows || !rows.length) return rows;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (isLegacySampleRow(dbId, r)) {
      _LEGACY_PURGE_JOBS.push({ db: dbId, id: r._id });
      if (dbId === DB_IDS.context_wordbooks) _LEGACY_PURGE_WB_IDS[r['单词书ID'] || r._id] = 1;
      if (dbId === DB_IDS.context_materials) _LEGACY_PURGE_MAT_IDS[r['资料ID'] || r._id] = 1;
      continue;
    }
    if (isTombstoned(dbId, r._id)) continue;
    out.push(r);
  }
  return out;
}

// ---------- 三、删云端（失败即记墓碑） ----------
// 所有「删除」都走这里：删不掉就记待办，下次进应用补删；
// 同时因为它进了墓碑列表，本次与以后的加载都不会再把它显示出来。
function softDeleteCloud(dbId, recordId) {
  if (!dbId || !recordId) return;
  if (!STATE.cloudReady || !CLOUD.db) {
    if (typeof queuePendingDel === 'function') queuePendingDel(dbId, recordId);
    return;
  }
  CLOUD.del(dbId, recordId).then(function (r) {
    if (r === null) { if (typeof queuePendingDel === 'function') queuePendingDel(dbId, recordId); }
    else { if (typeof unqueuePendingDel === 'function') unqueuePendingDel(dbId, recordId); }
    if (_TOMB_BY_DB) {  // 同步更新内存里的墓碑索引
      if (r === null) { if (!_TOMB_BY_DB[dbId]) _TOMB_BY_DB[dbId] = {}; _TOMB_BY_DB[dbId][recordId] = 1; }
      else if (_TOMB_BY_DB[dbId]) { delete _TOMB_BY_DB[dbId][recordId]; }
    }
  }).catch(function () {
    if (typeof queuePendingDel === 'function') queuePendingDel(dbId, recordId);
  });
}

// ---------- 四、本地内存里的示例残留 ----------
function purgeLegacySamplesInMemory() {
  STATE.wordbooks = (STATE.wordbooks || []).filter(function (w) {
    if (!isLegacySampleWordbook(w)) return true;
    _LEGACY_PURGE_WB_IDS[w.id] = 1;
    if (w._cloudId) _LEGACY_PURGE_JOBS.push({ db: DB_IDS.context_wordbooks, id: w._cloudId });
    return false;
  });
  STATE.materials = (STATE.materials || []).filter(function (m) {
    if (!isLegacySampleMaterial(m)) return true;
    _LEGACY_PURGE_MAT_IDS[m.id] = 1;
    if (m._cloudId) _LEGACY_PURGE_JOBS.push({ db: DB_IDS.context_materials, id: m._cloudId });
    return false;
  });
}

// ---------- 五、加载收尾：把示例的「词 / 章节 / 匹配 / 进度」一并清掉 ----------
function purgeLegacySampleLeftovers() {
  purgeLegacySamplesInMemory();

  var wbIds = _LEGACY_PURGE_WB_IDS;
  var matIds = _LEGACY_PURGE_MAT_IDS;
  var nCloud = _LEGACY_PURGE_JOBS.length;
  var nLocal = 0;

  // 示例书下的词
  if (Object.keys(wbIds).length) {
    STATE.words = (STATE.words || []).filter(function (w) {
      if (!wbIds[w.wordbookId]) return true;
      if (w._cloudId) _LEGACY_PURGE_JOBS.push({ db: DB_IDS.context_words, id: w._cloudId });
      nLocal++;
      return false;
    });
  }

  // 示例资料的章节 / 匹配 / 进度
  if (Object.keys(matIds).length) {
    Object.keys(matIds).forEach(function (mid) {
      ((STATE.chapters[mid]) || []).forEach(function (ch) {
        if (ch && ch._cloudId) _LEGACY_PURGE_JOBS.push({ db: DB_IDS.context_chapters, id: ch._cloudId });
      });
      var ms = STATE.matches[mid] || {};
      Object.keys(ms).forEach(function (cid) {
        (ms[cid] || []).forEach(function (m) {
          if (m && m._cloudId) _LEGACY_PURGE_JOBS.push({ db: DB_IDS.context_matches, id: m._cloudId });
        });
      });
      if (STATE.chapters[mid]) delete STATE.chapters[mid];
      if (STATE.matches[mid]) delete STATE.matches[mid];
      if (STATE.progress[mid]) delete STATE.progress[mid];
      nLocal++;
    });
  }

  clearLegacySampleMarks();

  if (!nCloud && !nLocal) return 0;
  saveLocal();
  // 去重后逐条删云端（失败自动进墓碑 + 待办）
  var seen = {};
  _LEGACY_PURGE_JOBS.forEach(function (j) {
    var k = j.db + '|' + j.id;
    if (seen[k]) return;
    seen[k] = 1;
    softDeleteCloud(j.db, j.id);
  });
  legacyPurgeReset();
  toast('已清理历史遗留的示例数据（本地 ' + nLocal + ' 项 / 云端 ' + nCloud + ' 条）', 'ok', 7000);
  console.log('[示例清理] 本地 ' + nLocal + ' 项，云端删除 ' + Object.keys(seen).length + ' 条');
  return nCloud;
}

// 顺手清掉历史遗留的示例标记键（已不再使用，留着只是垃圾）
function clearLegacySampleMarks() {
  try {
    var pref = LS_PREFIX;
    var kill = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf(pref) !== 0) continue;
      var short = k.slice(pref.length);
      if (/^sampleInjected_v1_/.test(short) || /^hadCloudData_v1_/.test(short) || /^seen_/.test(short)) kill.push(k);
    }
    for (var j = 0; j < kill.length; j++) { try { localStorage.removeItem(kill[j]); } catch (e) { } }
    if (kill.length) console.log('[示例清理] 清掉历史标记键 ' + kill.length + ' 个');
  } catch (e) { }
}
