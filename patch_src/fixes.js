/* ===== 数据安全修复包（第 3~7 条）=====
 * 对账合并 / 账号ID迁移真合并 / 孤立单词保护 / 示例注入幂等 / 导入配额预检
 *
 * 统一原则：云端是唯一真相源，但本地改动**不保证**到达云端。
 * 历史上因此丢过数据（删掉的书复活、自己加的书消失），所以这里所有改动都朝「更保守」的方向走：
 * 宁可多留一份数据、多留一个待办，也绝不静默丢弃。
 */

// 本次加载中，云端「单词书」是否**成功**返回过（查询失败不算成功）。
// 孤立单词判定必须依赖它 —— 否则一次网络抖动就会把「书上云失败、词上云成功」的单词全判成孤儿。
var CLOUD_WB_LOADED = false;

// 与 profileId 绑定的本地键（账号迁移时要整体处理，缺一个就会丢一类数据）
var PROFILE_KEYS = ['materials', 'wordbooks', 'words', 'chapters', 'matches', 'progress',
                    'sessions', 'mastery', 'vocab', 'synonyms', 'answers', 'review', 'learnOpts'];

// 数据库 ID → 业务类型名（云端查询失败时按类型回填本地数据用）
var _CLOUD_TYPE_BY_DB = null;
function cloudTypeOf(dbId) {
  if (!_CLOUD_TYPE_BY_DB) {
    _CLOUD_TYPE_BY_DB = {};
    var m = {
      context_users: 'users', context_materials: 'materials', context_chapters: 'chapters',
      context_wordbooks: 'wordbooks', context_words: 'words', context_matches: 'matches',
      context_progress: 'progress', context_sessions: 'sessions', context_answers: 'answers',
      context_mastery: 'mastery', context_review: 'reviewQueue', context_vocab: 'vocab',
      context_synonyms: 'synonyms'
    };
    Object.keys(m).forEach(function(k) { _CLOUD_TYPE_BY_DB[DB_IDS[k]] = m[k]; });
  }
  return _CLOUD_TYPE_BY_DB[dbId] || dbId;
}

// ---------- 云端「查询失败」≠「云端没有数据」（第 3 条）----------
// loadDataForProfile 是覆盖式加载：某个查询 reject 时 STATE 会被写成空数组，
// 界面表现就是「数据突然全没了」，接着 mergeLocalSnapshot 又会把本地数据当新数据补推一遍。
// 正确做法：查询失败的类别，直接把本地快照整类回填。
function restoreFailedLoads(snap, fail) {
  if (!snap || !fail) return;
  var typeToStateKey = {
    materials: 'materials', wordbooks: 'wordbooks', words: 'words', chapters: 'chapters',
    matches: 'matches', progress: 'progress', mastery: 'mastery', vocab: 'vocab',
    reviewQueue: 'reviewQueue', sessions: 'sessions', answers: 'answers', synonyms: 'synonyms'
  };
  Object.keys(typeToStateKey).forEach(function(t) {
    if (!fail[t]) return;
    var local = snap[t];
    if (local === undefined || local === null) return;
    var n = Array.isArray(local) ? local.length : Object.keys(local).length;
    if (n === 0) return;
    STATE[typeToStateKey[t]] = local;
    console.log('云端「' + t + '」加载失败，已用本地数据回填 ' + n + ' 项');
  });
  if (fail.wordbooks) CLOUD_WB_LOADED = false;   // 单词书没读到 → 不允许做孤立单词判定
}

// ---------- 并集合并工具（第 4 条）----------
// 数组类：按业务主键去重后并集；已存在的条目只补 _cloudId，不覆盖既有内容
function mergeArrayKey(oldKey, newKey, keyFn) {
  var oldArr = LS.get(oldKey, null);
  if (!Array.isArray(oldArr) || oldArr.length === 0) return 0;
  var newArr = LS.get(newKey, null);
  if (!Array.isArray(newArr)) newArr = [];
  var idx = {};
  newArr.forEach(function(x, i) { var k = keyFn(x); if (k) idx[k] = i; });
  var moved = 0, changed = false;
  oldArr.forEach(function(x) {
    var k = keyFn(x);
    if (!k) return;
    if (Object.prototype.hasOwnProperty.call(idx, k)) {
      var cur = newArr[idx[k]];
      // 同一条数据：优先保留带 _cloudId 的那份，否则云端会重复建档
      if (x && x._cloudId && cur && !cur._cloudId) { cur._cloudId = x._cloudId; changed = true; }
      return;
    }
    idx[k] = newArr.length;
    newArr.push(x);
    moved++;
    changed = true;
  });
  if (changed) LS.set(newKey, newArr);
  return moved;
}

// 对象套数组（chapters / matches / synonyms）：外层 key 分组，内层按主键去重并集
function mergeObjOfArrays(oldKey, newKey, keyFn) {
  var oldObj = LS.get(oldKey, null);
  if (!oldObj || typeof oldObj !== 'object') return 0;
  var newObj = LS.get(newKey, null);
  if (!newObj || typeof newObj !== 'object') newObj = {};
  var moved = 0, changed = false;
  Object.keys(oldObj).forEach(function(g) {
    var src = oldObj[g];
    if (!Array.isArray(src)) return;
    if (!Array.isArray(newObj[g])) {
      if (src.length) { newObj[g] = src; moved += src.length; changed = true; }
      return;
    }
    var seen = {};
    newObj[g].forEach(function(x) { var k = keyFn(x); if (k) seen[k] = true; });
    src.forEach(function(x) {
      var k = keyFn(x);
      if (!k || seen[k]) return;
      seen[k] = true;
      newObj[g].push(x);
      moved++;
      changed = true;
    });
  });
  if (changed) LS.set(newKey, newObj);
  return moved;
}

// 对象套对象（progress / mastery）：按「外层 key + 内层 key」去重并集，已存在的不覆盖
function mergeObjOfObjects(oldKey, newKey) {
  var oldObj = LS.get(oldKey, null);
  if (!oldObj || typeof oldObj !== 'object') return 0;
  var newObj = LS.get(newKey, null);
  if (!newObj || typeof newObj !== 'object') newObj = {};
  var moved = 0, changed = false;
  Object.keys(oldObj).forEach(function(g) {
    var src = oldObj[g];
    if (!src || typeof src !== 'object') return;
    if (!newObj[g] || typeof newObj[g] !== 'object') {
      newObj[g] = src;
      moved++;
      changed = true;
      return;
    }
    Object.keys(src).forEach(function(k) {
      if (Object.prototype.hasOwnProperty.call(newObj[g], k)) return;
      newObj[g][k] = src[k];
      moved++;
      changed = true;
    });
  });
  if (changed) LS.set(newKey, newObj);
  return moved;
}

// ---------- 示例数据注入的幂等判定（第 6 条）----------
// 旧逻辑用 seen_<profileId> 作标记，而 enterApp 每次都会跑 resolveAccountProfileId
// （规则「哪边 materials 多，身份就在哪边」）→ ID 漂移就换一把新 key → 示例数据被反复注入并推到云端。
// 表现正是用户看到的「我删掉的示例书刷新后又回来了」。现在标记绑定**昵称**，与 ID 漂移解耦。
function sampleInjectedKey() { return 'sampleInjected_v1_' + (STATE.nickname || ''); }
function hadCloudDataKey() { return 'hadCloudData_v1_' + (STATE.nickname || ''); }

function sampleInjectAllowed() {
  if (STATE.materials.length > 0 || STATE.wordbooks.length > 0) return false;  // 已经有数据，不注入
  if (LS.get(sampleInjectedKey(), false)) return false;   // 本账号在本机注入过 → 永不再注入
  if (LS.get(hadCloudDataKey(), false)) return false;     // 本账号曾有过云端数据 → 永不再注入
  return true;
}
function markCloudDataSeen() {
  if (STATE.materials.length > 0 || STATE.wordbooks.length > 0) LS.set(hadCloudDataKey(), true);
}
function markSampleInjected() { LS.set(sampleInjectedKey(), true); }

// ---------- 本机存储配额预检（第 7 条）----------
// localStorage 写满时 setItem 抛 QuotaExceededError，而 LS.set 只是静默 catch。
// 直接拿真实 payload 试写一次：写进去就说明放得下，放不下当场就能知道。
function probeLocalQuota(jsonText) {
  if (!STATE.profileId) return true;
  var probeKey = LS_PREFIX + '__quota_probe__';
  try {
    localStorage.setItem(probeKey, jsonText);
    localStorage.removeItem(probeKey);
    return true;
  } catch (e) {
    try { localStorage.removeItem(probeKey); } catch (e2) {}
    return false;
  }
}
