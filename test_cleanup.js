// 「示例数据彻底移除 + 删除墓碑 + 多副本删除」回归测试
// 代码从 index.html 现抽现跑，不依赖浏览器
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);

function sliceBetween(startRe, endRe) {
  let s = -1, e = -1;
  for (let i = 0; i < lines.length; i++) {
    if (s === -1 && startRe.test(lines[i])) s = i;
    else if (s !== -1 && endRe.test(lines[i])) { e = i; break; }
  }
  if (s === -1 || e === -1) throw new Error('block not found: ' + startRe);
  return lines.slice(s, e).join('\n');
}
function extractOne(re) {
  const l = lines.find(x => re.test(x));
  if (!l) throw new Error('line not found: ' + re);
  return l;
}
function extractBlock(startRe, endRe) {
  let s = -1, e = -1;
  for (let i = 0; i < lines.length; i++) {
    if (s === -1 && startRe.test(lines[i])) s = i;
    else if (s !== -1 && endRe.test(lines[i])) { e = i; break; }
  }
  if (s === -1 || e === -1) throw new Error('block not found: ' + startRe);
  return lines.slice(s, e + 1).join('\n');
}

const dbIdsLine = extractOne(/^var DB_IDS = \{/);
const cloudCode = extractBlock(/^var CLOUD = \{/, /^\/\/ ===== 同步状态 UI/);
const cleanupCode = sliceBetween(/^\/\/ ---------- 一、示例数据的识别 ----------$/, /^\/\* ===== 内置词书《六级词书》 ===== \*\/$/);
const removeWbCode = extractBlock(/^function removeWordbook\(wbId\) \{/, /^\}$/);
const pendingCode = sliceBetween(/^var PENDING_DEL_PREFIX = /, /^\/\* ===== 数据安全修复包/);

let LSSTORE = {};
const LS_PREFIX = 'ctx_vocab_';
var LS = {
  get: function (k, d) { try { const v = LSSTORE[LS_PREFIX + k]; return v !== undefined ? JSON.parse(v) : (d !== undefined ? d : null); } catch (e) { return d; } },
  set: function (k, v) { LSSTORE[LS_PREFIX + k] = JSON.stringify(v); },
  del: function (k) { delete LSSTORE[LS_PREFIX + k]; }
};
var localStorage = {
  _d: {},
  get length() { return Object.keys(this._d).length; },
  key: function (i) { return Object.keys(this._d)[i]; },
  getItem: function (k) { return this._d[k] === undefined ? null : this._d[k]; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; }
};

var STATE = {
  cloudReady: true, profileId: 'p_me',
  wordbooks: [], words: [], materials: [], chapters: {}, matches: {}, progress: {}
};
function saveLocal() {}
function nowISO() { return new Date().toISOString(); }
function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 8); }
var TOASTS = [];
function toast(m, t) { TOASTS.push(m); }
// 同步队列内部的桩（这些函数定义在 `// ===== 同步状态 UI` 之后，不在抽取范围内）
function updateSyncBadge() {}
function refreshAll() {}
function recordCloudErr() {}
function escapeHTML(s) { return String(s); }
var CLOUD_ROW_ERR = 0, CLOUD_ROW_ERR_SHOWN = false;

let CALLS = { del: 0, delFail: 0, delOk: 0, add: 0 };
let DELFAIL = false;
const mockDb = {
  addRecord: function () { CALLS.add++; return Promise.resolve({ id: 'new' + CALLS.add }); },
  updateRecord: function () { return Promise.resolve({ id: 'u' }); },
  deleteRecord: function () {
    CALLS.del++;
    return new Promise(res => setTimeout(() => {
      if (DELFAIL) { CALLS.delFail++; return res(null); }
      CALLS.delOk++; res({ ok: true });
    }, 2));
  },
  query: function () { return Promise.resolve({ results: [], hasMore: false }); }
};

eval(dbIdsLine);
eval(cloudCode);
eval(pendingCode);
eval(cleanupCode);
eval(removeWbCode);
CLOUD.db = mockDb;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }
const wait = ms => new Promise(r => setTimeout(r, ms));
function reset() {
  LSSTORE = {}; CALLS = { del: 0, delFail: 0, delOk: 0, add: 0 }; TOASTS.length = 0;
  DELFAIL = false; STATE.cloudReady = true; STATE.profileId = 'p_me';
  STATE.wordbooks = []; STATE.words = []; STATE.materials = [];
  STATE.chapters = {}; STATE.matches = {}; STATE.progress = {};
  legacyPurgeReset(); tombBuild();
}

(async () => {
  // ---------- 一、示例识别 ----------
  group('一、示例数据的识别');
  ok('书名带「示例」→ 判定为示例书', isLegacySampleWordbook({ name: '示例单词书·18词' }) === true);
  ok('正常词书 → 不是示例', isLegacySampleWordbook({ name: '六级词书' }) === false);
  ok('空对象 → 不是示例', isLegacySampleWordbook(null) === false && isLegacySampleWordbook({}) === false);
  ok('资料标题带「示例」→ 判定为示例资料', isLegacySampleMaterial({ title: '某某·重生（示例）' }) === true);
  ok('正常资料 → 不是示例', isLegacySampleMaterial({ title: '红楼梦' }) === false);
  ok('云端行识别（词书）', isLegacySampleRow(DB_IDS.context_wordbooks, { '书名': '示例单词书·18词', _id: 'r1' }) === true);
  ok('云端行识别（资料）', isLegacySampleRow(DB_IDS.context_materials, { '标题': '虞寻歌·重生（示例）', _id: 'r2' }) === true);
  ok('云端行识别（无关表不误伤）', isLegacySampleRow(DB_IDS.context_words, { '词元': '示例', _id: 'r3' }) === false);

  // ---------- 二、加载期拦截 ----------
  group('二、加载期拦截（示例行 + 墓碑行）');
  reset();
  STATE.profileId = 'p_me';
  queuePendingDel(DB_IDS.context_wordbooks, 'tomb_1');   // 造一条墓碑
  tombBuild();
  const rowsIn = [
    { _id: 'a', '书名': '六级词书' },
    { _id: 'b', '书名': '示例单词书·18词' },
    { _id: 'tomb_1', '书名': '已经删掉的书' }
  ];
  const kept = filterCloudRows(DB_IDS.context_wordbooks, rowsIn);
  ok('正常行保留', kept.length === 1 && kept[0]._id === 'a', kept.map(x => x._id));
  ok('示例行被剔除', !kept.some(x => x._id === 'b'));
  ok('墓碑行被剔除（云端还没删掉也不再显示）', !kept.some(x => x._id === 'tomb_1'));
  ok('被剔的示例行进了待删云端任务', _LEGACY_PURGE_JOBS.some(j => j.id === 'b' && j.db === DB_IDS.context_wordbooks), _LEGACY_PURGE_JOBS);

  // ---------- 三、历史示例残留清理 ----------
  group('三、历史示例残留清理（书 + 词 + 资料 + 章节 + 匹配）');
  reset();
  const swb = { id: 'wb_s', name: '示例单词书·18词', source: 'sample.csv', _cloudId: 'cw_s' };
  const nmb = { id: 'wb_n', name: '六级词书', _cloudId: 'cw_n' };
  STATE.wordbooks = [swb, nmb];
  STATE.words = [
    { lemma: 'ceiling', wordbookId: 'wb_s', _cloudId: 'wo1' },
    { lemma: 'abandon', wordbookId: 'wb_n', _cloudId: 'wo2' }
  ];
  const smt = { id: 'm_s', title: '虞寻歌·重生（示例）', _cloudId: 'cm_s' };
  const nmt = { id: 'm_n', title: '真实资料', _cloudId: 'cm_n' };
  STATE.materials = [smt, nmt];
  STATE.chapters = { m_s: [{ id: 'c1', _cloudId: 'cc1' }], m_n: [{ id: 'c2', _cloudId: 'cc2' }] };
  STATE.matches = { m_s: { c1: [{ lemma: 'ceiling', chWord: '天花板', _cloudId: 'cma1' }] }, m_n: { c2: [] } };
  STATE.progress = { m_s: { c1: { scrollPct: 5 } }, m_n: { c2: { scrollPct: 50 } } };
  // 模拟加载期已经拦下了云端行
  _LEGACY_PURGE_WB_IDS['wb_s'] = 1;
  _LEGACY_PURGE_MAT_IDS['m_s'] = 1;
  _LEGACY_PURGE_JOBS.push({ db: DB_IDS.context_wordbooks, id: 'cw_s' });
  _LEGACY_PURGE_JOBS.push({ db: DB_IDS.context_materials, id: 'cm_s' });

  const purged = purgeLegacySampleLeftovers();
  await wait(200);
  ok('示例书从本地移除', !STATE.wordbooks.some(w => w.id === 'wb_s'));
  ok('正常书保留', STATE.wordbooks.some(w => w.id === 'wb_n'));
  ok('示例书的词被清掉', !STATE.words.some(w => w.wordbookId === 'wb_s'), STATE.words.map(w => w.lemma));
  ok('正常书的词保留', STATE.words.some(w => w.lemma === 'abandon'));
  ok('示例资料从本地移除', !STATE.materials.some(m => m.id === 'm_s'));
  ok('示例资料的章节被清掉', STATE.chapters.m_s === undefined);
  ok('示例资料的匹配被清掉', STATE.matches.m_s === undefined);
  ok('示例资料的进度被清掉', STATE.progress.m_s === undefined);
  ok('正常资料的进度保留', STATE.progress.m_n && STATE.progress.m_n.c2.scrollPct === 50);
  ok('示例书/资料/词/章节/匹配的云端记录都被删（5 条）', CALLS.delOk === 5, CALLS);
  ok('清完给出提示', TOASTS.some(m => /已清理历史遗留的示例数据/.test(m)), TOASTS);
  ok('返回清掉的云端条数', purged >= 3, purged);

  // ---------- 四、removeWordbook 多副本 ----------
  group('四、删除单词书：云端多条同名副本要全部删掉');
  reset();
  STATE.wordbooks = [
    { id: 'wb_dup', name: '重复推送过的书', _cloudId: 'cd1' },
    { id: 'wb_dup', name: '重复推送过的书', _cloudId: 'cd2' },
    { id: 'wb_dup', name: '重复推送过的书', _cloudId: 'cd3' },
    { id: 'wb_keep', name: '留着', _cloudId: 'ck' }
  ];
  STATE.words = [{ lemma: 'x', wordbookId: 'wb_dup', _cloudId: 'wd1' }, { lemma: 'y', wordbookId: 'wb_keep', _cloudId: 'wd2' }];
  const nWords = removeWordbook('wb_dup');
  await wait(300);
  ok('本地三条副本全部移除', STATE.wordbooks.filter(w => w.id === 'wb_dup').length === 0);
  ok('返回被删词数', nWords === 1, nWords);
  ok('云端删了 3 条副本 + 1 个词 = 4 次', CALLS.del === 4, CALLS);
  ok('每次都真的删成功（没有残留）', CALLS.delOk === 4, CALLS);
  ok('其他书没被误删', STATE.wordbooks.some(w => w.id === 'wb_keep'));

  // ---------- 五、离线删除 → 墓碑 ----------
  group('五、离线删除：不碰云端，但要留墓碑');
  reset();
  STATE.cloudReady = false;
  STATE.wordbooks = [{ id: 'wb_off', name: '离线删的书', _cloudId: 'co1' }];
  STATE.words = [];
  removeWordbook('wb_off');
  await wait(120);
  ok('离线时一次云端请求都没发', CALLS.del === 0, CALLS.del);
  ok('云端记录进了待办（墓碑）', pendingDelList().some(t => t.id === 'co1'), pendingDelList());
  tombBuild();
  ok('墓碑生效：下次加载这行不会再显示', filterCloudRows(DB_IDS.context_wordbooks, [{ _id: 'co1', '书名': '离线删的书' }]).length === 0);

  // ---------- 六、删除失败 → 墓碑挡住「刷新后又出现」 ----------
  group('六、删除失败：刷新后不会再出现（这是用户报的那个现象）');
  reset();
  DELFAIL = true;
  STATE.wordbooks = [{ id: 'wb_f', name: '删不掉的书', _cloudId: 'cf1' }];
  STATE.words = [];
  removeWordbook('wb_f');
  await wait(400);
  ok('云端删除确实失败了', CALLS.delFail > 0, CALLS);
  ok('失败记录进了待办', pendingDelList().some(t => t.id === 'cf1'), pendingDelList());
  // 模拟「刷新页面」：重新加载时云端那行还在，但墓碑把它挡住
  tombBuild();
  const reloaded = filterCloudRows(DB_IDS.context_wordbooks, [{ _id: 'cf1', '书名': '删不掉的书' }]);
  ok('★★ 刷新后这行被墓碑挡住，不再出现在列表里', reloaded.length === 0, reloaded);
  DELFAIL = false;
  await flushPendingDels();
  ok('网络恢复后补删成功', pendingDelList().length === 0);

  // ---------- 七、历史标记键清理 ----------
  group('七、历史示例标记键清理');
  reset();
  localStorage._d[LS_PREFIX + 'sampleInjected_v1_测试用户B'] = 'true';
  localStorage._d[LS_PREFIX + 'hadCloudData_v1_测试用户B'] = 'true';
  localStorage._d[LS_PREFIX + 'seen_p_xxx'] = 'true';
  localStorage._d[LS_PREFIX + 'keep_me'] = '1';
  clearLegacySampleMarks();
  ok('sampleInjected_* 被清掉', localStorage.getItem(LS_PREFIX + 'sampleInjected_v1_测试用户B') === null);
  ok('hadCloudData_* 被清掉', localStorage.getItem(LS_PREFIX + 'hadCloudData_v1_测试用户B') === null);
  ok('seen_* 被清掉', localStorage.getItem(LS_PREFIX + 'seen_p_xxx') === null);
  ok('无关的键不受影响', localStorage.getItem(LS_PREFIX + 'keep_me') === '1');

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(56));
  console.log('示例清理/删除墓碑回归：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(56));
  process.exit(failed.length ? 1 : 0);
})();
