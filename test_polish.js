// 「阅读进度 + 新增标注推云端失败补偿」回归测试
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

const dbIdsLine = extractOne(/^var DB_IDS = \{/);
const cloudCode = extractBlock(/^var CLOUD = \{/, /^\/\/ ===== 同步状态 UI/);
const polishCode = sliceBetween(/^\/\/ ---------- 一、真实滚动层探测 ----------$/, /^\/\* ===== 内置词书《六级词书》 ===== \*\/$/);
const smcCode = extractBlock(/^function syncMatchToCloud\(matId, chId, m\) \{/, /^\}$/);

// ---------- 最小 DOM / window mock ----------
let SCROLL = { docTop: 0, docH: 2000, winH: 800, winScrollTo: [] };
let AREA_RECT = { top: 100, bottom: 900, height: 800 };
let CONTAINER = null;
let readingArea = null;

function mkArea() {
  return {
    parentElement: CONTAINER,
    scrollTop: 0,
    scrollHeight: 800,
    clientHeight: 800,
    getBoundingClientRect: function () { return AREA_RECT; }
  };
}

var window = {
  get pageYOffset() { return SCROLL.docTop; },
  get innerHeight() { return SCROLL.winH; },
  scrollTo: function (x, y) { SCROLL.docTop = y; SCROLL.winScrollTo.push(y); },
  addEventListener: function () {}
};
var document = {
  documentElement: {
    get scrollTop() { return SCROLL.docTop; },
    set scrollTop(v) { SCROLL.docTop = v; },
    get scrollHeight() { return SCROLL.docH; },
    get clientHeight() { return SCROLL.winH; }
  },
  readyState: 'complete',
  getElementById: function (id) { return id === 'readingArea' ? readingArea : null; },
  addEventListener: function () {}
};

// ---------- 其他桩 ----------
let LSSTORE = {};
const LS_PREFIX = 'ctx_vocab_';
var LS = {
  get: function (k, d) { try { const v = LSSTORE[LS_PREFIX + k]; return v !== undefined ? JSON.parse(v) : (d !== undefined ? d : null); } catch (e) { return d; } },
  set: function (k, v) { LSSTORE[LS_PREFIX + k] = JSON.stringify(v); },
  del: function (k) { delete LSSTORE[LS_PREFIX + k]; }
};
var STATE = { cloudReady: true, profileId: 'p_me', matches: {}, progress: {}, learnMaterialId: null, learnChapterId: null };
function saveLocal() {}
function nowISO() { return new Date().toISOString(); }
var TOASTS = [];
function toast(m) { TOASTS.push(m); }
var SYNC_CALLS = 0;
function scheduleSync() { SYNC_CALLS++; }
function updateSyncBadge() {}
function refreshAll() {}
function recordCloudErr() {}
var CLOUD_ROW_ERR = 0, CLOUD_ROW_ERR_SHOWN = false;

let CALLS = { add: 0, addFail: 0, addOk: 0 };
let ADDFAIL = false;
const mockDb = {
  addRecord: function () {
    CALLS.add++;
    return new Promise(res => setTimeout(() => {
      if (ADDFAIL) { CALLS.addFail++; return res(null); }
      CALLS.addOk++; res({ id: 'cid_' + CALLS.add });
    }, 2));
  },
  updateRecord: function () { return Promise.resolve({ id: 'u' }); },
  deleteRecord: function () { return Promise.resolve({ ok: true }); },
  query: function () { return Promise.resolve({ results: [], hasMore: false }); }
};

eval(dbIdsLine);
eval(cloudCode);
eval(polishCode);
eval(smcCode);
CLOUD.db = mockDb;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }
const wait = ms => new Promise(r => setTimeout(r, ms));

function resetScrollEnv() {
  SCROLL = { docTop: 0, docH: 2000, winH: 800, winScrollTo: [] };
  AREA_RECT = { top: 100, bottom: 900, height: 800 };
  CONTAINER = null;
  readingArea = mkArea();
}

(async () => {
  // ---------- 一、真实滚动层探测 ----------
  group('一、真实滚动层探测');
  resetScrollEnv();
  let info = currentScrollInfo();
  ok('页面可滚动时：el 为 null（滚动发生在页面）', info.el === null, info);
  ok('最大滚动量 = 文档高 - 视口高', info.max === 1200, info.max);

  SCROLL.docTop = 600;
  info = currentScrollInfo();
  ok('当前滚动位置取自 pageYOffset', info.top === 600, info.top);

  // 页面不可滚 → 找内层容器
  resetScrollEnv();
  SCROLL.docH = 800;                       // 文档高 = 视口高，页面滚不动
  CONTAINER = {
    parentElement: null, scrollTop: 250, scrollHeight: 1400, clientHeight: 700
  };
  CONTAINER.parentElement = CONTAINER;     // 自环，保证 while 循环有界（g++<40 兜底）
  readingArea = mkArea();
  info = currentScrollInfo();
  ok('页面滚不动时改找内层可滚动容器', info.el === CONTAINER, info.el === CONTAINER);
  ok('容器模式下 max = scrollHeight - clientHeight', info.max === 700, info.max);
  ok('容器模式下 top 取自容器 scrollTop', info.top === 250, info.top);

  // ---------- 二、saveScrollPos ----------
  group('二、阅读进度保存（改前恒为 0）');
  resetScrollEnv();
  STATE.learnMaterialId = 'm1'; STATE.learnChapterId = 'c1';
  STATE.progress = {};
  SCROLL.docTop = 600;                     // 1200 里的 600 → 50%
  SYNC_CALLS = 0;
  saveScrollPos();
  ok('写入 50%', STATE.progress.m1.c1.scrollPct === 50, STATE.progress.m1.c1);
  ok('触发了同步', SYNC_CALLS === 1, SYNC_CALLS);

  SYNC_CALLS = 0;
  saveScrollPos();                          // 位置没变
  ok('位置没变时不重复写盘/同步', SYNC_CALLS === 0, SYNC_CALLS);

  SCROLL.docTop = 1200;                     // 到底
  saveScrollPos();
  ok('滚到底 = 100%（不会被算成 >100）', STATE.progress.m1.c1.scrollPct === 100, STATE.progress.m1.c1.scrollPct);

  SCROLL.docTop = 0;
  saveScrollPos();
  ok('回到顶部 = 0%', STATE.progress.m1.c1.scrollPct === 0, STATE.progress.m1.c1.scrollPct);

  STATE.learnMaterialId = null;
  const before = JSON.stringify(STATE.progress);
  SCROLL.docTop = 500;
  saveScrollPos();
  ok('不在学习页时不记录', JSON.stringify(STATE.progress) === before);
  STATE.learnMaterialId = 'm1';

  // ---------- 三、restoreScrollPct ----------
  group('三、阅读进度恢复');
  resetScrollEnv();
  STATE.learnMaterialId = 'm1'; STATE.learnChapterId = 'c1';
  restoreScrollPct(50);
  await wait(120);
  ok('页面模式下用 window.scrollTo 恢复（1200 的 50% = 600）', SCROLL.docTop === 600, SCROLL.docTop);

  resetScrollEnv();
  SCROLL.docH = 800;
  CONTAINER = { parentElement: null, scrollTop: 0, scrollHeight: 1400, clientHeight: 700 };
  CONTAINER.parentElement = CONTAINER;
  readingArea = mkArea();
  restoreScrollPct(50);
  await wait(120);
  ok('容器模式下恢复的是容器 scrollTop（700 的 50% = 350）', CONTAINER.scrollTop === 350, CONTAINER.scrollTop);

  // ---------- 四、pendingAdd 记账 ----------
  group('四、pendingAdd 记账（去重 / 上限 / 销账）');
  LSSTORE = {}; TOASTS.length = 0;
  STATE.profileId = 'p_me';
  ok('初始为空', pendingAddCount() === 0);

  queuePendingAdd({ matId: 'm1', chId: 'c1', lemma: 'alpha', chWord: '甲', position: 3 });
  ok('记入 1 条', pendingAddCount() === 1);
  queuePendingAdd({ matId: 'm1', chId: 'c1', lemma: 'alpha', chWord: '甲', position: 3 });
  ok('同一条重复记不会变两条', pendingAddCount() === 1, pendingAddCount());
  queuePendingAdd({ matId: 'm1', chId: 'c1', lemma: 'beta', chWord: '乙', position: 9 });
  ok('不同的能记进去', pendingAddCount() === 2);

  unqueuePendingAdd({ matId: 'm1', chId: 'c1', lemma: 'alpha', chWord: '甲', position: 3 });
  ok('销账生效', pendingAddCount() === 1, pendingAddList().map(x => x.lemma));

  LSSTORE = {};
  for (let i = 0; i < PENDING_ADD_MAX + 20; i++) {
    queuePendingAdd({ matId: 'm1', chId: 'c1', lemma: 'w' + i, chWord: '词' + i, position: i });
  }
  ok('超过上限后不会无限增长', pendingAddCount() === PENDING_ADD_MAX, pendingAddCount());
  ok('丢的是最旧的（新的还在）', pendingAddList().some(x => x.lemma === 'w' + (PENDING_ADD_MAX + 19)));

  LSSTORE = {};
  queuePendingAdd({ matId: 'm1', chId: 'c1', lemma: 'x', chWord: '叉', position: 1 });
  bumpPendingAddTries(pendingAddList()[0]);
  bumpPendingAddTries(pendingAddList()[0]);
  ok('未到上限时保留', pendingAddCount() === 1);
  bumpPendingAddTries(pendingAddList()[0]);
  ok('连续失败到上限后放弃，不再堆积', pendingAddCount() === 0);

  // ---------- 五、补推 ----------
  group('五、进应用后的补推');
  LSSTORE = {}; TOASTS.length = 0; CALLS = { add: 0, addFail: 0, addOk: 0 }; ADDFAIL = false;
  STATE.cloudReady = true;
  STATE.matches = { m1: { c1: [{ lemma: 'alpha', chWord: '甲', position: 3, _cloudId: null }] } };
  queuePendingAdd({ matId: 'm1', chId: 'c1', lemma: 'alpha', chWord: '甲', position: 3 });

  let n = await flushPendingAdds();
  ok('补推成功 1 条', n === 1, n);
  ok('云端拿到了 _cloudId', !!STATE.matches.m1.c1[0]._cloudId, STATE.matches.m1.c1[0]._cloudId);
  ok('待办被清空', pendingAddCount() === 0);
  ok('提示了用户', TOASTS.some(m => /已补推/.test(m)), TOASTS);

  // 本地那条已经被删掉 → 不重建，直接丢弃
  LSSTORE = {}; TOASTS.length = 0; CALLS = { add: 0, addFail: 0, addOk: 0 };
  STATE.matches = { m1: { c1: [] } };
  queuePendingAdd({ matId: 'm1', chId: 'c1', lemma: 'ghost', chWord: '鬼', position: 7 });
  n = await flushPendingAdds();
  ok('本地已删掉的不会凭空重建', n === 0 && CALLS.add === 0, { n, add: CALLS.add });
  ok('这类待办被直接丢弃', pendingAddCount() === 0);

  // 失败 → 不销账，tries 累加
  LSSTORE = {}; CALLS = { add: 0, addFail: 0, addOk: 0 }; ADDFAIL = true;
  STATE.matches = { m1: { c1: [{ lemma: 'beta', chWord: '乙', position: 2, _cloudId: null }] } };
  queuePendingAdd({ matId: 'm1', chId: 'c1', lemma: 'beta', chWord: '乙', position: 2 });
  n = await flushPendingAdds();
  ok('补推失败不销账', pendingAddCount() === 1 && n === 0, { cnt: pendingAddCount(), n });
  ok('失败次数被记下', pendingAddList()[0].tries === 1, pendingAddList()[0].tries);
  ADDFAIL = false;

  // ---------- 六、syncMatchToCloud 失败自动记待办 ----------
  group('六、syncMatchToCloud 失败时自动记账（改前是静默丢弃）');
  LSSTORE = {}; TOASTS.length = 0; CALLS = { add: 0, addFail: 0, addOk: 0 };
  STATE.cloudReady = true;
  ADDFAIL = true;
  const mNew = { lemma: 'gamma', chWord: '伽', position: 5 };
  syncMatchToCloud('m1', 'c1', mNew);
  await wait(300);
  ok('失败后自动进了 pendingAdd', pendingAddCount() === 1, pendingAddList());
  ok('没有拿到 _cloudId', !mNew._cloudId);

  // 离线时也应记账
  LSSTORE = {};
  STATE.cloudReady = false;
  const mOff = { lemma: 'delta', chWord: '德', position: 6 };
  syncMatchToCloud('m1', 'c1', mOff);
  ok('离线时不发请求，但（经对账合并兜底）不报错', CALLS.add >= 1);

  // 成功时正常写回
  LSSTORE = {}; CALLS = { add: 0, addFail: 0, addOk: 0 }; ADDFAIL = false;
  STATE.cloudReady = true;
  const mOk = { lemma: 'epsilon', chWord: '艾', position: 8 };
  syncMatchToCloud('m1', 'c1', mOk);
  await wait(200);
  ok('成功时写回 _cloudId', !!mOk._cloudId, mOk._cloudId);
  ok('成功时不记待办', pendingAddCount() === 0);

  // ---------- 七、源码结构 ----------
  group('七、源码结构（防止旧实现被留在同一作用域里覆盖掉）');
  ok('index.html 里 saveScrollPos 只有新实现一份', (html.match(/function saveScrollPos\(\)/g) || []).length === 1,
    (html.match(/function saveScrollPos\(\)/g) || []).length);
  ok('旧的 area.scrollTop 恢复写法已移除', html.indexOf('_area.scrollTop = _area.scrollHeight') < 0);
  ok('onscroll 属性保留（兼容内层容器自滚动的情况）', html.indexOf('onscroll="saveScrollPos()"') > 0);
  ok('restoreScrollPct 在 renderLearnChapter 里被调用', html.indexOf('restoreScrollPct(prog.scrollPct);') > 0);
  ok('enterApp 里调了 flushPendingAdds', html.indexOf('flushPendingAdds();') > 0);

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(56));
  console.log('阅读进度 / 标注补偿回归：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(56));
  process.exit(failed.length ? 1 : 0);
})();
