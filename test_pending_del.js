// 「删除待办 + 删除重试」回归测试——从 index.html 抽取真实代码块跑，不依赖浏览器
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);

function extractBlock(startRe, endRe) {
  let s = -1, e = -1;
  for (let i = 0; i < lines.length; i++) {
    if (s === -1 && startRe.test(lines[i])) s = i;
    else if (s !== -1 && endRe.test(lines[i])) { e = i; break; }
  }
  if (s === -1 || e === -1) throw new Error('block not found: ' + startRe);
  return lines.slice(s, e + 1).join('\n');
}
function extractOne(re) {
  const l = lines.find(x => re.test(x));
  if (!l) throw new Error('line not found: ' + re);
  return l;
}

const cloudCode = extractBlock(/^var CLOUD = \{/, /^\/\/ ===== 同步状态 UI/);
const removeWbCode = extractBlock(/^function removeWordbook\(wbId\) \{/, /^\}$/);
const migrateCode = extractBlock(/^function migrateProfileId\(oldId, newId, silent\) \{/, /^\}$/);
const pendingCode = extractBlock(/^var PENDING_DEL_PREFIX = /, /^function pendingDelCount\(\)/);
const pendingTail = extractOne(/^function pendingDelCount\(\)/);
const dbIdsLine = extractOne(/^var DB_IDS = \{/);
// removeWordbook 现在统一走 softDeleteCloud（示例清理/删除墓碑模块）
const cleanupCode = extractBlock(/^\/\/ ---------- 一、示例数据的识别 ----------$/, /^\/\* ===== 内置词书《六级词书》 ===== \*\/$/);

let LSSTORE = {};
const LS_PREFIX = 'ctx_vocab_';
var LS = {
  get: function (k, d) { try { const v = LSSTORE[LS_PREFIX + k]; return v !== undefined ? JSON.parse(v) : (d !== undefined ? d : null); } catch (e) { return d; } },
  set: function (k, v) { LSSTORE[LS_PREFIX + k] = JSON.stringify(v); },
  del: function (k) { delete LSSTORE[LS_PREFIX + k]; }
};

var STATE = { cloudReady: true, profileId: 'p_me', wordbooks: [], words: [], materials: [], chapters: {}, matches: {} };
function updateSyncBadge() {}
function saveLocal() {}
var toastMsgs = [];
function toast(m) { toastMsgs.push(m); }
function refreshAll() {}
function nowISO() { return new Date().toISOString(); }
function uid(p) { return p + '_x'; }
var CLOUD_ROW_ERR = 0, CLOUD_ROW_ERR_SHOWN = false;
function recordCloudErr() {}
function escapeHTML(s) { return String(s); }

let CALLS = { del: 0, delFail: 0, delOk: 0 };
let FAILDEL = false;
const mockDb = {
  addRecord: () => Promise.resolve({ id: 'x' }),
  updateRecord: () => Promise.resolve({ id: 'x' }),
  deleteRecord: function (p) {
    CALLS.del++;
    return new Promise(res => setTimeout(() => {
      if (FAILDEL) { CALLS.delFail++; return res(null); }
      CALLS.delOk++;
      res({ ok: true });
    }, 3));
  },
  query: () => Promise.resolve({ results: [], hasMore: false })
};

eval(dbIdsLine);
eval(cloudCode);
eval(pendingCode);
eval(cleanupCode);
eval(removeWbCode);
eval(migrateCode);
eval(pendingTail);
CLOUD.db = mockDb;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n[1] 删除失败时：重试一次 + 记成待办（不再静默丢弃）');
  FAILDEL = true;
  LSSTORE = {};
  STATE.wordbooks = [{ id: 'wb_a', name: '单词书A', _cloudId: 'cA' }];
  STATE.words = [{ lemma: 'alpha', wordbookId: 'wb_a', _cloudId: 'wA1' }, { lemma: 'beta', wordbookId: 'wb_a', _cloudId: 'wA2' }];
  removeWordbook('wb_a');
  await wait(400);
  ok('本地已删除', STATE.wordbooks.length === 0 && STATE.words.length === 0);
  ok('每条都重试了一次（1 书 + 2 词 × 2 次 = 6）', CALLS.del === 6, CALLS);
  ok('待办里记下 3 条云端残留', pendingDelCount() === 3, pendingDelList().map(t => t.id));
  ok('没有误报成功提示', toastMsgs.filter(m => /已补删/.test(m)).length === 0);

  console.log('\n[2] 网络恢复后补删：全部删掉并清空待办');
  FAILDEL = false;
  const n = await flushPendingDels();
  ok('补删了 3 条', n === 3, n);
  ok('待办已清空', pendingDelCount() === 0);
  ok('给用户提示了「已补删」', toastMsgs.some(m => /已补删 3 项/.test(m)), toastMsgs);

  console.log('\n[3] 反复失败不会无限累积（连续 5 次后放弃）');
  lsreset();
  FAILDEL = true;
  queuePendingDel('db_x', 'rec_1');
  for (let i = 0; i < 6; i++) await flushPendingDels();
  ok('失败 5 次后从待办里移除，不会永久堆积', pendingDelCount() === 0, pendingDelCount());

  console.log('\n[4] 删除成功时会把待办销掉');
  lsreset();
  FAILDEL = false;
  queuePendingDel('db_y', 'rec_9');
  ok('先有 1 条待办', pendingDelCount() === 1);
  await flushPendingDels();
  ok('成功后待办清零', pendingDelCount() === 0);

  console.log('\n[5] 离线删除：完全不碰云端，但要记待办');
  LSSTORE = {};
  STATE.cloudReady = false;
  STATE.wordbooks = [{ id: 'wb_b', name: '离线删的书', _cloudId: 'cB' }];
  STATE.words = [{ lemma: 'zzz', wordbookId: 'wb_b', _cloudId: 'wB1' }];
  CALLS = { del: 0, delFail: 0, delOk: 0 };
  removeWordbook('wb_b');
  await wait(200);
  ok('离线时一次云端请求都没发', CALLS.del === 0, CALLS.del);
  ok('但两条记录都进了待办', pendingDelCount() === 2, pendingDelList().map(t => t.id));

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(52));
  console.log('删除待办回归：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(52));
  process.exit(failed.length ? 1 : 0);

  function lsreset() { LSSTORE = {}; }
})();
