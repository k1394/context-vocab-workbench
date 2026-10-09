// 数据安全修复（第 3~7 条）回归测试
// 全部代码从 index.html 现抽现跑，不复制粘贴 —— 保证测的是真正会上线的那份
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);

function findIdx(fn, from) {
  for (let i = from || 0; i < lines.length; i++) if (fn(lines[i])) return i;
  return -1;
}
function sliceByPrefix(startPrefix, endPrefix) {
  const s = findIdx(l => l.startsWith(startPrefix));
  const e = findIdx(l => l.startsWith(endPrefix));
  if (s < 0 || e < 0 || e <= s) throw new Error('slice not found: ' + startPrefix + ' → ' + endPrefix);
  return lines.slice(s, e).join('\n');
}
function extractFn(sig) {
  const s = findIdx(l => l.startsWith(sig));
  if (s < 0) throw new Error('fn not found: ' + sig);
  for (let i = s + 1; i < lines.length; i++) if (lines[i] === '}') return lines.slice(s, i + 1).join('\n');
  throw new Error('fn end not found: ' + sig);
}

// ---------- 抽真实代码 ----------
const dbIdsLine = lines.find(l => l.startsWith('var DB_IDS = {'));
if (!dbIdsLine) throw new Error('DB_IDS not found');

// 模块（fixes.js）：从模块注释起，到「内置词书」锚点前
const modCode = sliceByPrefix('/* ===== 数据安全修复包', '/* ===== 内置词书《六级词书》 ===== */');
// 加载/孤儿/对账合并 一整段
const loadCode = sliceByPrefix('function loadDataForProfile(profileId) {', '// ===== 资料体积预算');
const migCode = extractFn('function migrateProfileId(oldId, newId, silent) {');
const importCode = extractFn('function doImportFromFieldMap(mapping, wbName) {');

// ---------- 测试替身 ----------
let LSSTORE = {};
let QUOTA = Infinity;
const LS_PREFIX = 'ctx_vocab_';

var localStorage = {
  _used: function (exceptKey) {
    let n = 0;
    Object.keys(LSSTORE).forEach(k => { if (k !== exceptKey) n += k.length + LSSTORE[k].length; });
    return n;
  },
  setItem: function (k, v) {
    v = String(v);
    if (localStorage._used(k) + k.length + v.length > QUOTA) {
      const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
    }
    LSSTORE[k] = v;
  },
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(LSSTORE, k) ? LSSTORE[k] : null; },
  removeItem: function (k) { delete LSSTORE[k]; },
  key: function (i) { return Object.keys(LSSTORE)[i] || null; }
};
Object.defineProperty(localStorage, 'length', { get: () => Object.keys(LSSTORE).length });

var LS = {
  get: function (key, def) {
    try { const v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : (def !== undefined ? def : null); }
    catch (e) { return def !== undefined ? def : null; }
  },
  set: function (key, val) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); }
    catch (e) { LS.saveFailed = true; LS.lastError = e.name; }
  },
  del: function (key) { localStorage.removeItem(LS_PREFIX + key); }
};

var STATE = {
  cloudReady: true, profileId: 'p_me', nickname: 'n1',
  materials: [], wordbooks: [], words: [], chapters: {}, matches: {}, progress: {},
  sessions: [], mastery: {}, vocab: {}, synonyms: {}, answers: [], reviewQueue: []
};
var LEARN_OPTS_DEFAULT = {};
var BUILTIN_WB_ID = 'wb_builtin_cet6';   // 与 index.html 保持一致
var CLOUD_FAIL = {};
var CLOUD_ROWS = {};
var CLOUD = {
  query: function (dbId) {
    if (CLOUD_FAIL[dbId]) return Promise.reject(new Error('boom'));
    return Promise.resolve((CLOUD_ROWS[dbId] || []).map((r, i) => Object.assign({ _id: 'cid' + i }, r)));
  }
};
var SYNCED = { material: 0, wordbook: 0, word: 0, session: 0, answer: 0 };
function syncMaterialToCloud() { SYNCED.material++; }
function syncWordbookToCloud() { SYNCED.wordbook++; }
function syncWordToCloud() { SYNCED.word++; }
function syncSessionToCloud() { SYNCED.session++; }
function syncAnswerToCloud() { SYNCED.answer++; }
function syncChapterToCloud() {}
function syncMatchToCloud() {}
function syncMasteryToCloud() {}
function syncVocabToCloud() {}
function syncReviewToCloud() {}
function installBuiltinWordbookOnce() {}
function regenerateAllMatches() { return 1; }
function parseEntryText(s) { return { word: s, pos: '', ipa: '', meaning: '' }; }
function cleanMeaningText(s) { return String(s || '').trim(); }
function uid(p) { return p + '_' + (uidN++); }
let uidN = 0;
function nowISO() { return '2026-01-01T00:00:00.000Z'; }
let TOASTS = [];
function toast(m, t) { TOASTS.push({ m: m, t: t }); }
function closeModal() {}
function refreshAll() {}
var pendingFileData = null;

// saveLocal 用真实语义（写 LS，可能因配额失败）
function saveLocal() {
  if (!STATE.profileId) return;
  const pid = STATE.profileId;
  LS.set('materials_' + pid, STATE.materials);
  LS.set('wordbooks_' + pid, STATE.wordbooks);
  LS.set('words_' + pid, STATE.words);
}

eval(dbIdsLine);
eval(modCode);
eval(loadCode);
eval(migCode);
eval(importCode);

const DB = JSON.parse(dbIdsLine.replace(/^var DB_IDS = /, '').replace(/;$/, ''));

// ---------- 断言 ----------
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function reset() {
  LSSTORE = {}; QUOTA = Infinity; CLOUD_FAIL = {}; CLOUD_ROWS = {}; TOASTS = [];
  STATE.cloudReady = true; STATE.profileId = 'p_me'; STATE.nickname = 'n1';
  STATE.materials = []; STATE.wordbooks = []; STATE.words = []; STATE.chapters = {}; STATE.matches = {};
  STATE.progress = {}; STATE.sessions = []; STATE.mastery = {}; STATE.vocab = {}; STATE.synonyms = {};
  STATE.answers = []; STATE.reviewQueue = [];
  SYNCED = { material: 0, wordbook: 0, word: 0, session: 0, answer: 0 };
  LS.saveFailed = false;
  CLOUD_WB_LOADED = false;
}

(async () => {
  console.log('\n[1] 第 3 条：云端「查询失败」不能当成「云端没有数据」');
  reset();
  // 本地有 6 本书、40 个词；云端 materials 有 1 条，wordbooks / words 两个查询直接失败
  LS.set('materials_p_me', [{ id: 'm_local', title: '本地资料' }]);
  LS.set('wordbooks_p_me', [{ id: 'wb1' }, { id: 'wb2' }, { id: 'wb3' }, { id: 'wb4' }, { id: 'wb5' }, { id: 'wb6' }]);
  LS.set('words_p_me', Array.from({ length: 40 }, (_, i) => ({ lemma: 'w' + i, wordbookId: 'wb' + (i % 6 + 1) })));
  CLOUD_ROWS[DB.context_materials] = [{ '资料ID': 'm_cloud', '标题': '云端资料' }];
  CLOUD_FAIL[DB.context_wordbooks] = true;
  CLOUD_FAIL[DB.context_words] = true;
  await loadDataForProfile('p_me');
  ok('materials：云端那条 + 本地独有那条都要在（并集，不是覆盖）', STATE.materials.length === 2
    && STATE.materials.some(m => m.id === 'm_cloud') && STATE.materials.some(m => m.id === 'm_local'),
    STATE.materials.map(m => m.id));
  ok('wordbooks 查询失败 → 本地 6 本整类回填（没有被清空）', STATE.wordbooks.length >= 6, STATE.wordbooks.length);
  ok('words 查询失败 → 本地 40 个词整类回填', STATE.words.length >= 40, STATE.words.length);
  ok('CLOUD_WB_LOADED 保持 false（单词书没读到，不允许做孤儿判定）', CLOUD_WB_LOADED === false);
  ok('回填的类别不会整批重复补推云端（只补本地独有的 1 条资料）', SYNCED.material === 1 && SYNCED.wordbook === 0 && SYNCED.word === 0, SYNCED);

  console.log('\n[2] 第 3 条：对账合并补全 sessions / answers / synonyms');
  reset();
  LS.set('sessions_p_me', [{ id: 's_local', materialId: 'm1' }]);
  LS.set('answers_p_me', [{ sessionId: 's_local', lemma: 'alpha', round: 'r1' }]);
  LS.set('synonyms_p_me', { alpha: [{ answer: '甲', accepted: true }] });
  await loadDataForProfile('p_me');
  ok('本地独有的会话被合并回来并补推云端', STATE.sessions.length === 1 && SYNCED.session === 1, { n: STATE.sessions.length, synced: SYNCED.session });
  ok('本地独有的作答记录被合并回来', STATE.answers.length === 1 && SYNCED.answer === 1, STATE.answers.length);
  ok('本地独有的同义答案被合并回来（本地并集，无云端通道）', (STATE.synonyms.alpha || []).length === 1, STATE.synonyms);

  console.log('\n[3] 第 4 条：账号 ID 漂移时，旧 ID 独有的书不再被丢弃');
  reset();
  LS.set('materials_p_old', [{ id: 'mA', title: '我在旧ID下加的书', _cloudId: 'cA' }]);
  LS.set('materials_p_new', [{ id: 'mB', title: '新ID下已有的书' }]);
  LS.set('words_p_old', [{ lemma: 'Alpha', wordbookId: 'wbX' }, { lemma: 'beta', wordbookId: 'wbX' }]);
  LS.set('words_p_new', [{ lemma: 'alpha', wordbookId: 'wbX', meaning: '保留新的那份' }]);
  LS.set('chapters_p_old', { mA: [{ id: 'c1', title: '旧章节' }] });
  LS.set('progress_p_old', { mA: { c1: { mode: 'meaning' } } });
  LS.set('learnOpts_p_old', { strategy: 'length' });
  const moved = migrateProfileId('p_old', 'p_new', true);
  const mats = LS.get('materials_p_new', []);
  const ws = LS.get('words_p_new', []);
  ok('旧 ID 独有的资料已并入新 ID（不再被丢弃）', mats.some(m => m.id === 'mA') && mats.some(m => m.id === 'mB'), mats.map(m => m.id));
  ok('同一条资料保留带 _cloudId 的那份（避免云端重复建档）', (mats.find(m => m.id === 'mA') || {})._cloudId === 'cA');
  ok('同名单词按 lemma|wordbookId 去重，保留新 ID 那份内容', ws.length === 2 && (ws.find(w => w.lemma === 'alpha') || {}).meaning === '保留新的那份', ws);
  ok('章节 / 进度 / 学习设置一并合并', !!LS.get('chapters_p_new', {})['mA'] && !!LS.get('progress_p_new', {})['mA'] && (LS.get('learnOpts_p_new', {}) || {}).strategy === 'length');
  ok('迁移计数 > 0', moved > 0, moved);
  ok('写成功后才删旧 key', LS.get('materials_p_old', null) === null && LS.get('words_p_old', null) === null);

  console.log('\n[4] 第 4 条：写入失败时保留旧 key（不静默丢数据）');
  reset();
  LS.set('materials_p_a', [{ id: 'mA' }]);
  QUOTA = 0;                       // 之后任何写入都会配额失败
  TOASTS = [];
  migrateProfileId('p_a', 'p_b', true);
  QUOTA = Infinity;
  ok('写入失败 → 旧 ID 数据仍在', LS.get('materials_p_a', null) !== null, LS.get('materials_p_a', null));
  ok('且没有把数据算成"迁移成功"', LS.get('materials_p_b', null) === null, LS.get('materials_p_b', null));

  console.log('\n[5] 第 5 条：孤立单词不再被删（改为补建书的记录）');
  reset();
  STATE.words = [{ lemma: 'x1', wordbookId: 'wb_ghost' }, { lemma: 'x2', wordbookId: 'wb_ghost' }];
  STATE.wordbooks = [];
  CLOUD_WB_LOADED = false;         // 模拟「单词书查询失败」
  cleanupOrphanWords();
  ok('单词书没读到 → 一个字都不动', STATE.words.length === 2 && STATE.wordbooks.length === 0, { w: STATE.words.length, b: STATE.wordbooks.length });
  CLOUD_WB_LOADED = true;          // 云端单词书确实读到了
  SYNCED = { material: 0, wordbook: 0, word: 0, session: 0, answer: 0 };
  cleanupOrphanWords();
  ok('单词全部保留（历史版本这里会永久删掉）', STATE.words.length === 2, STATE.words.length);
  ok('缺失的单词书被补建出来', STATE.wordbooks.length === 1 && STATE.wordbooks[0].id === 'wb_ghost', STATE.wordbooks);
  ok('补建的书会补推云端', SYNCED.wordbook === 1, SYNCED.wordbook);
  ok('书名标注为恢复书', /恢复/.test(STATE.wordbooks[0].name), STATE.wordbooks[0].name);

  reset();
  LS.set('wordbooks_p_me', [{ id: 'wb_known', name: '我导入过的书', total: 9 }]);
  STATE.words = [{ lemma: 'y1', wordbookId: 'wb_known' }];
  STATE.wordbooks = [];
  CLOUD_WB_LOADED = true;
  cleanupOrphanWords();
  ok('本地还留着这本书的定义 → 复用原名而不是建占位书', STATE.wordbooks[0].name === '我导入过的书', STATE.wordbooks[0].name);

  console.log('\n[6] 第 6 条：示例数据已彻底移除，历史残留会被一次清干净');
  reset();
  STATE.materials = [
    { id: 'm_s', title: '某某·重生（示例）', _cloudId: 'cm_s' },
    { id: 'm_n', title: '真实资料', _cloudId: 'cm_n' }
  ];
  STATE.wordbooks = [
    { id: 'wb_s', name: '示例单词书', _cloudId: 'cw_s' },
    { id: 'wb_n', name: '六级词书', _cloudId: 'cw_n' }
  ];
  STATE.words = [
    { lemma: 'ceiling', wordbookId: 'wb_s', _cloudId: 'wo1' },
    { lemma: 'abandon', wordbookId: 'wb_n', _cloudId: 'wo2' }
  ];
  STATE.chapters = { m_s: [{ id: 'c1', _cloudId: 'cc1' }], m_n: [{ id: 'c2', _cloudId: 'cc2' }] };
  STATE.matches = { m_s: { c1: [{ lemma: 'ceiling', chWord: '天花板', _cloudId: 'cma1' }] }, m_n: { c2: [] } };
  STATE.progress = { m_s: { c1: { scrollPct: 3 } }, m_n: { c2: { scrollPct: 66 } } };
  legacyPurgeReset();
  _LEGACY_PURGE_WB_IDS['wb_s'] = 1;
  _LEGACY_PURGE_MAT_IDS['m_s'] = 1;
  const nPurge = purgeLegacySampleLeftovers();
  ok('示例书被清掉', !STATE.wordbooks.some(w => w.id === 'wb_s'), STATE.wordbooks.map(w => w.name));
  ok('正常书保留', STATE.wordbooks.some(w => w.id === 'wb_n'));
  ok('示例书的词一并清掉', !STATE.words.some(w => w.wordbookId === 'wb_s'), STATE.words.map(w => w.lemma));
  ok('正常书的词保留', STATE.words.some(w => w.lemma === 'abandon'));
  ok('示例资料连同章节/匹配/进度一起清掉',
    !STATE.materials.some(m => m.id === 'm_s') && !STATE.chapters.m_s && !STATE.matches.m_s && !STATE.progress.m_s);
  ok('正常资料的进度不受影响', !!(STATE.progress.m_n && STATE.progress.m_n.c2.scrollPct === 66));
  ok('返回待删云端的条数', nPurge >= 2, nPurge);
  ok('旧的示例注入判定函数已从产物中消失', typeof sampleInjectAllowed === 'undefined');

  console.log('\n[7] 第 7 条：导入大单词书前探配额，失败就明确报错');
  reset();
  pendingFileData = { rows: Array.from({ length: 4000 }, (_, i) => ({ lemma: 'longword' + i, meaning: '释义' + i })) };
  TOASTS = [];
  QUOTA = 100 * 1024;              // 放不下 4000 词
  doImportFromFieldMap({ lemma: 'lemma', meaning: 'meaning' }, '超大词书');
  ok('配额不足 → 明确报错而不是假装成功', TOASTS.some(t => t.t === 'err' && /存储空间不足/.test(t.m)), TOASTS.map(t => t.m));
  ok('配额不足 → 一个字都没写进 STATE', STATE.wordbooks.length === 0 && STATE.words.length === 0, { b: STATE.wordbooks.length, w: STATE.words.length });
  ok('配额不足时不会把这本书留在待导入状态', pendingFileData === null);

  reset();
  pendingFileData = { rows: Array.from({ length: 30 }, (_, i) => ({ lemma: 'w' + i, meaning: '义' + i })) };
  TOASTS = [];
  doImportFromFieldMap({ lemma: 'lemma', meaning: 'meaning' }, '正常词书');
  ok('配额充足 → 正常导入', STATE.wordbooks.length === 1 && STATE.words.length === 30, { b: STATE.wordbooks.length, w: STATE.words.length });
  ok('正常导入时没有报错', !TOASTS.some(t => t.t === 'err'), TOASTS.map(t => t.m));

  reset();
  pendingFileData = { rows: Array.from({ length: 30 }, (_, i) => ({ lemma: 'w' + i, meaning: '义' + i })) };
  TOASTS = [];
  const realSet = localStorage.setItem;
  let wrote = 0;
  localStorage.setItem = function (k, v) {          // 探测通过、真正落盘却失败
    if (k.indexOf('__quota_probe__') >= 0) return realSet.call(localStorage, k, v);
    wrote++;
    if (wrote >= 3) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    return realSet.call(localStorage, k, v);
  };
  doImportFromFieldMap({ lemma: 'lemma', meaning: 'meaning' }, '落盘会失败的词书');
  localStorage.setItem = realSet;
  ok('落盘失败 → 回滚，不留半截数据', STATE.wordbooks.length === 0 && STATE.words.length === 0, { b: STATE.wordbooks.length, w: STATE.words.length });
  ok('落盘失败 → 明确告知（含"回滚"）', TOASTS.some(t => t.t === 'err' && /回滚/.test(t.m)), TOASTS.map(t => t.m));

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(56));
  console.log('数据安全修复回归：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(56));
  process.exit(failed.length ? 1 : 0);
})();
