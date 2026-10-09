// 复现「删除的书复活」「新增的书消失」——全部使用 index.html 里的真实代码
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
const syncWbCode = extractBlock(/^function syncWordbookToCloud\(wb\) \{/, /^\}$/);
const dbIdsLine = extractOne(/^var DB_IDS = \{/);
const builtinIdLine = extractOne(/^var BUILTIN_WB_ID = /);

// ---------- Mock localStorage（真实可读写，供 migrateProfileId 用） ----------
let LSSTORE = {};
let toastMsgs = [];
const LS_PREFIX = 'ctx_vocab_';
var LS = {
  get: function (k, d) { try { const v = LSSTORE[LS_PREFIX + k]; return v !== undefined ? JSON.parse(v) : (d !== undefined ? d : null); } catch (e) { return d; } },
  set: function (k, v) { LSSTORE[LS_PREFIX + k] = JSON.stringify(v); },
  del: function (k) { delete LSSTORE[LS_PREFIX + k]; }
};

var STATE = { cloudReady: true, profileId: 'p_me', wordbooks: [], words: [] };
function updateSyncBadge() {}
function saveLocal() { countSaveLocal++; }
var countSaveLocal = 0;
function toast(m) { toastMsgs.push(m); }
function refreshAll() {}
function nowISO() { return new Date().toISOString(); }
function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 8); }
var CLOUD_ROW_ERR = 0, CLOUD_ROW_ERR_SHOWN = false;
function recordCloudErr() {}

// ---------- Mock 云端后端：可控制每种操作成功/失败 ----------
let BACKEND = { wordbooks: {}, words: {}, seq: 0 };
let CALLS = { add: 0, del: 0, delFail: 0 };
let FAILDEL = false, FAILADD = false;

const mockDb = {
  addRecord: function (p) {
    CALLS.add++;
    const props = p.properties;
    return new Promise(res => setTimeout(() => {
      if (FAILADD) return res(null);
      const id = 'c' + (++BACKEND.seq);
      const bucket = p.databaseId === DB_IDS.context_wordbooks ? BACKEND.wordbooks : BACKEND.words;
      bucket[id] = props;
      res({ id });
    }, 5));
  },
  updateRecord: function () { return Promise.resolve({ id: 'x' }); },
  deleteRecord: function (p) {
    CALLS.del++;
    return new Promise(res => setTimeout(() => {
      if (FAILDEL) { CALLS.delFail++; return res(null); }
      delete BACKEND.wordbooks[p.recordId];
      delete BACKEND.words[p.recordId];
      res({});
    }, 5));
  },
  query: function () { return Promise.resolve({ results: [], hasMore: false }); }
};

eval(dbIdsLine);
eval(builtinIdLine);
eval(cloudCode);
eval(removeWbCode);
eval(migrateCode);
eval(syncWbCode);
CLOUD.db = mockDb;

function line(t) { console.log('\n' + '='.repeat(60) + '\n' + t + '\n' + '='.repeat(60)); }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  // ============ 场景 1：删除单词书时云端删除失败 ============
  line('场景 1：删掉一本书，但云端删除失败（网络抖动 / 限流）');
  FAILDEL = true;
  STATE.wordbooks = [
    { id: 'wb_a', name: '单词书A', source: 'a.csv', total: 3, _cloudId: 'cA' },
    { id: 'wb_b', name: '单词书B', source: 'b.csv', total: 3, _cloudId: 'cB' }
  ];
  BACKEND.wordbooks = { cA: { '书名': { text: '单词书A' } }, cB: { '书名': { text: '单词书B' } } };
  STATE.words = [
    { lemma: 'alpha', wordbookId: 'wb_a', _cloudId: 'wA1' },
    { lemma: 'beta', wordbookId: 'wb_a', _cloudId: 'wA2' },
    { lemma: 'gamma', wordbookId: 'wb_b', _cloudId: 'wB1' }
  ];
  BACKEND.words = { wA1: { '词元': { text: 'alpha' } }, wA2: { '词元': { text: 'beta' } }, wB1: { '词元': { text: 'gamma' } } };

  console.log('删除前：本地 ' + STATE.wordbooks.map(w => w.name).join('、'));
  console.log('删除前：云端 wordbook 记录 ' + Object.keys(BACKEND.wordbooks).length + ' 条 (cA, cB)');

  removeWordbook('wb_a');
  await wait(300);   // 等同步队列跑完

  console.log('删除后：本地 ' + (STATE.wordbooks.map(w => w.name).join('、') || '（空）'));
  console.log('删除后：云端 wordbook 记录 ' + Object.keys(BACKEND.wordbooks).join(', '));
  console.log('  → deleteRecord 被调用 ' + CALLS.del + ' 次，其中失败 ' + CALLS.delFail + ' 次');
  console.log('  → 是否重试：' + (CALLS.del > 3 ? '有' : '没有（del 不重试）'));
  console.log('  → 是否提示用户：' + (toastMsgs.some(m => /失败|未同步|错误/.test(m)) ? '有' : '没有'));

  // 模拟刷新：云端覆盖式加载
  const reloaded = Object.keys(BACKEND.wordbooks).map(id => ({ id: null, name: BACKEND.wordbooks[id]['书名'].text, _cloudId: id }));
  console.log('\n刷新页面后，云端拉回来的单词书：' + reloaded.map(w => w.name).join('、'));
  console.log(((reloaded.some(w => w.name === '单词书A')) ? '✗ 复现成功：删掉的「单词书A」又回来了' : '✓ 未复现'));

  // ============ 场景 2：新增单词书时云端写入失败 ============
  line('场景 2：导入一本新书，但云端写入失败，且本地存储也没存下');
  FAILDEL = false; FAILADD = true;
  CALLS = { add: 0, del: 0, delFail: 0 };
  const before = STATE.wordbooks.length;
  const newWb = { id: 'wb_c', name: '我添加的书', source: 'my.csv', total: 2 };
  STATE.wordbooks.push(newWb);
  syncWordbookToCloud(newWb);
  await wait(400);   // 两次尝试（1 次原始 + 1 次重试）
  console.log('  → addRecord 被调用 ' + CALLS.add + ' 次（原始 1 + 重试 1 = 2 预期）');
  console.log('  → 拿到 _cloudId 了吗：' + (newWb._cloudId ? '是' : '否 → 这条记录云端根本没有'));
  console.log('  → 云端 wordbook 记录：' + (Object.keys(BACKEND.wordbooks).join(', ') || '（空）'));
  console.log('  → 提示用户了吗：' + (toastMsgs.some(m => /超出|失败|上限/.test(m)) ? '有' : '没有'));
  console.log('刷新页面后：本地仅剩 localStorage 副本可救；若 localStorage 也没写成功 → 书彻底消失');

  // ============ 场景 3：账号 ID 变化时的本地迁移 ============
  line('场景 3：账号 ID 自愈迁移时，本地数据被覆盖丢失');
  LSSTORE = {};
  LS.set('wordbooks_p_old', [{ id: 'wb_x', name: '我在旧ID下加的书' }]);
  LS.set('words_p_old', [{ lemma: 'hello', wordbookId: 'wb_x' }]);
  LS.set('wordbooks_p_new', [{ id: 'wb_y', name: '新ID下的书' }]);   // 新 ID 已有数据
  LS.set('words_p_new', [{ lemma: 'world', wordbookId: 'wb_y' }]);

  console.log('迁移前：p_old = ' + JSON.stringify(LS.get('wordbooks_p_old')));
  console.log('迁移前：p_new = ' + JSON.stringify(LS.get('wordbooks_p_new')));
  migrateProfileId('p_old', 'p_new', true);
  console.log('迁移后：p_new = ' + JSON.stringify(LS.get('wordbooks_p_new')));
  console.log('迁移后：p_old = ' + JSON.stringify(LS.get('wordbooks_p_old')));
  const lost = LS.get('wordbooks_p_new').filter(w => w.id === 'wb_x').length === 0;
  console.log(lost ? '✗ 复现成功：旧 ID 下的「我在旧ID下加的书」被直接丢弃了（没有合并、也没推云端）'
                   : '✓ 未复现');
  console.log('  （migrateProfileId 只在「新 ID 为空」时才搬数据，但无论搬没搬都删掉旧 key）');
})();
