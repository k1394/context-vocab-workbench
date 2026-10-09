// 语境标注分布修复回归测试（纯 node，代码全部从 index.html 现抽现跑）
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);

let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function group(t) { console.log('\n【' + t + '】'); }

function findIdx(fn, from) { for (let i = from || 0; i < lines.length; i++) if (fn(lines[i])) return i; return -1; }
function extractFn(sig) {
  const s = findIdx(l => l.startsWith(sig));
  if (s < 0) throw new Error('fn not found: ' + sig);
  let depth = 0, started = false;
  for (let i = s; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth === 0) return lines.slice(s, i + 1).join('\n');
  }
  throw new Error('fn end not found: ' + sig);
}
function extractVarObject(name) {
  const s = findIdx(l => l.startsWith('var ' + name + ' = {'));
  if (s < 0) throw new Error('var not found: ' + name);
  let depth = 0, started = false;
  for (let i = s; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth === 0) return lines.slice(s, i + 1).join('\n').replace(/;\s*$/, '');
  }
  throw new Error('var end not found: ' + name);
}
function sliceBetween(startPrefix, endPrefix) {
  const s = findIdx(l => l.startsWith(startPrefix));
  const e = findIdx(l => l.startsWith(endPrefix), s + 1);
  if (s < 0 || e < 0) throw new Error('slice not found');
  return lines.slice(s, e).join('\n');
}

// ---------- 内置词库 ----------
const bs = findIdx(l => l.indexOf('<script id="builtinCet6B64"') >= 0);
const be = findIdx(l => l.trim() === '</script>', bs + 1);
const tsv = Buffer.from(lines.slice(bs + 1, be).join('').replace(/\s+/g, ''), 'base64').toString('utf-8');
const BUILTIN = [];
tsv.split('\n').forEach(l => { if (!l) return; const t = l.indexOf('\t'); if (t > 0) BUILTIN.push({ lemma: l.substring(0, t), meaning: l.substring(t + 1), wordbookId: 'wb_builtin_cet6' }); });

// ---------- 抽真实代码 ----------
const dbIdsLine = lines.find(l => l.startsWith('var DB_IDS = {'));
const optsLine = sliceBetween('var LEARN_OPTS_DEFAULT = {', 'function getLearnOpts');
const distMod = sliceBetween('/* ===== 语境标注分布修复包', '/* ===== 内置词书《六级词书》 ===== */');

const CODE = [
  dbIdsLine,
  optsLine + ';',
  extractVarObject('CONTEXT_DICT'),
  extractFn('function extractTriggersFromMeaning(meaning, strict) {'),
  extractFn('function computeParaDist(matches, paragraphs) {'),
  extractFn('function pickMatchesByStrategy(noOverlap, paragraphs, target, strategy, perParaMax, maxRepeat) {'),
  extractFn('function generateContextMatches(chapter, words, repeatMode, targetWords, opts) {'),
  extractFn('function getLearnOpts() {'),
  extractFn('function regenerateMatches(matId, chId) {'),
  extractFn('function regenerateMatchesForMaterial(matId) {'),
  distMod
].join('\n\n');

// ---------- 测试替身 ----------
let LSSTORE = {};
const LS_PREFIX = 'ctx_vocab_';
var localStorage = {
  setItem: (k, v) => { LSSTORE[k] = String(v); },
  getItem: k => (Object.prototype.hasOwnProperty.call(LSSTORE, k) ? LSSTORE[k] : null),
  removeItem: k => { delete LSSTORE[k]; }
};
var LS = {
  get: (key, def) => { try { const v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : (def !== undefined ? def : null); } catch (e) { return def; } },
  set: (key, val) => { try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch (e) { LS.saveFailed = true; } },
  del: key => localStorage.removeItem(LS_PREFIX + key)
};
var STATE = {
  cloudReady: true, profileId: 'p_me', materials: [], chapters: {}, matches: {},
  words: BUILTIN, learnOpts: null
};
var DELETED = [];
var ADDED = [];
var QUEUED = [];
var CLOUD = {
  del: function (db, id) { DELETED.push({ db: db, id: id }); return Promise.resolve({ ok: true }); }
};
function queuePendingDel(db, id) { QUEUED.push({ db: db, id: id }); }
function syncMatchToCloud(matId, chId, m) { ADDED.push({ matId: matId, chId: chId, lemma: m.lemma }); }
function buildLearnWordPool() { return BUILTIN; }
function saveLocal() {}
function uid(p) { return p + '_1'; }
function nowISO() { return '2026-01-01T00:00:00.000Z'; }
var TOASTS = [];
function toast(m, t) { TOASTS.push(m); }
function escapeHTML(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
// refreshLearn / jumpChapter 依赖的 DOM 替身
var DOM = {};
function makeEl(id) { return DOM[id] || (DOM[id] = { id: id, innerHTML: '', textContent: '', value: '', disabled: false, title: '', scrollTop: 0, scrollHeight: 1000 }); }
var document = {
  getElementById: id => makeEl(id),
  querySelectorAll: () => []
};
var refreshLearnCalls = [];
function refreshLearn(resetScroll) { refreshLearnCalls.push(resetScroll); }

eval(CODE);

const ARTICLE = JSON.parse(fs.readFileSync('G:/英语学习工作台/_t/_article.json', 'utf-8'));
const CH = { id: 'ch1', title: '第一章 祖母的教养方式', content: ARTICLE.join('\n\n'), targetWords: 30 };

function dist(res) { return res.paraDist; }
function blankCount(d) { return d.filter(x => x === 0).length; }
function frontShare(d) {
  const ft = Math.max(1, Math.round(d.length / 3));
  let f = 0, a = 0;
  for (let i = 0; i < d.length; i++) { a += d[i]; if (i < ft) f += d[i]; }
  return a ? f / a : 0;
}

group('一、等间隔铺开：目标词少于段落数时不再堆在前几段');
{
  const P = ARTICLE.length;
  const o = { strategy: 'balanced', perParaMax: 4, maxRepeatPerWord: 2, strictTrigger: true };
  const r10 = generateContextMatches(CH, BUILTIN, 'all', 10, o);
  const d10 = dist(r10);
  ok('18 段文章 / target=10 时，标注覆盖段数 ≥ 11（改前只有 10）', d10.filter(x => x > 0).length >= 11, d10.join('/'));
  ok('前 1/3 段承载 ≤ 65% 的标注（改前 62% 且后 8 段全空）', frontShare(d10) <= 0.65, Math.round(frontShare(d10) * 100) + '%');
  ok('末尾三段至少有一段被标到（改前全空）', d10.slice(-3).some(x => x > 0), d10.slice(-3).join('/'));

  const r30 = generateContextMatches(CH, BUILTIN, 'all', 30, o);
  const d30 = dist(r30);
  ok('target=30 时仍然零空白段（没有为了分散而丢标注）', blankCount(d30) === 0, blankCount(d30));
  ok('target=30 时覆盖全部 18 段', d30.length === P && d30.every(x => x > 0), d30.join('/'));
  ok('没有一段超过每段上限 4', d30.every(x => x <= 4), d30.join('/'));

  // target >= 段数时必须与旧行为完全一致（回归安全）
  const seq = generateContextMatches(CH, BUILTIN, 'all', 30, Object.assign({}, o, { strategy: 'sequential' }));
  ok('sequential 策略不受影响（仍然是顺序取）', dist(seq)[0] >= 4, dist(seq).join('/'));
}

group('二、生成签名：参数一变就判定为失效');
{
  const o = { strategy: 'balanced', perParaMax: 4, maxRepeatPerWord: 2, strictTrigger: true, bookIds: [] };
  const s1 = matchSigFor(CH, o, 7146);
  ok('同参数同词池 → 签名一致', matchSigFor(CH, o, 7146) === s1);
  ok('改每段上限 → 签名变化', matchSigFor(CH, Object.assign({}, o, { perParaMax: 5 }), 7146) !== s1);
  ok('改策略 → 签名变化', matchSigFor(CH, Object.assign({}, o, { strategy: 'length' }), 7146) !== s1);
  ok('改每章目标 → 签名变化', matchSigFor({ targetWords: 20 }, o, 7146) !== s1);
  ok('词池大小变了 → 签名变化', matchSigFor(CH, o, 3000) !== s1);
  ok('签名字符串里带算法版本号', s1.indexOf(String(MATCH_ALGO_VERSION)) === 0, s1);

  // 存量数据（没有签名）必须被判为失效 → 会触发一次自动重算
  STATE.matches = { m1: { ch1: [{ lemma: 'parent', chWord: '父亲', position: 0 }] } };
  STATE.chapters = { m1: [CH] };
  ok('老数据（有标注但没签名）→ 判定失效，会自动重算', matchSigStale('m1', CH, o, 7146) === true);
  STATE.matches.m1.ch1 = [];
  ok('空标注 → 判定失效', matchSigStale('m1', CH, o, 7146) === true);
  STATE.matches.m1.ch1 = [{ lemma: 'parent', chWord: '父亲', position: 0 }];
  matchSigSet('m1', 'ch1', matchSigFor(CH, o, 7146));
  ok('签名写入后 → 不再判定失效', matchSigStale('m1', CH, o, 7146) === false);
  ok('签名字段落到了 localStorage', LS.get(matchSigKey(), null) !== null);
}

group('三、重算时清掉旧的自动匹配（否则云端老分布会被拉回来）');
{
  STATE.matches = {};
  STATE.chapters = { m1: [CH] };
  STATE.words = BUILTIN;
  DELETED.length = 0; QUEUED.length = 0; ADDED.length = 0;
  // 造 5 条老自动匹配（带 _cloudId）+ 1 条手动匹配
  STATE.matches.m1 = { ch1: [] };
  for (let i = 0; i < 5; i++) STATE.matches.m1.ch1.push({ lemma: 'old' + i, chWord: '旧' + i, position: i, _cloudId: 'cid' + i });
  STATE.matches.m1.ch1.push({ lemma: 'manualx', chWord: '手动', position: 99, manual: true, _cloudId: 'cidM' });

  const n = regenerateMatches('m1', 'ch1');
  ok('重算后总数 > 0', n > 0, n);
  ok('旧的 5 条自动匹配都发出了云端删除', DELETED.filter(x => /^cid\d$/.test(x.id)).length === 5, DELETED.map(x => x.id));
  ok('手动匹配没有被删（cidM 不在删除列表里）', DELETED.every(x => x.id !== 'cidM'), DELETED.map(x => x.id));
  ok('删除的是 matches 表', DELETED.every(x => x.db === DB_IDS.context_matches), DELETED[0]);
  ok('手动匹配在新结果里保留了', STATE.matches.m1.ch1.some(m => m.manual && m.lemma === 'manualx'));
  ok('重算产生了新标注', STATE.matches.m1.ch1.filter(m => !m.manual).length > 0, STATE.matches.m1.ch1.length);
  ok('本轮新标注已推云端', ADDED.length > 0, ADDED.length);
  ok('重算后签名已更新（下次不会重复重算）', matchSigStale('m1', CH, getLearnOpts(), BUILTIN.length) === false);
}

group('四、离线时清旧走待办（不然下次登录老数据又回来）');
{
  STATE.cloudReady = false;
  STATE.matches = { m1: { ch1: [] } };
  for (let i = 0; i < 3; i++) STATE.matches.m1.ch1.push({ lemma: 'x' + i, chWord: '旧' + i, position: i, _cloudId: 'off' + i });
  DELETED.length = 0; QUEUED.length = 0;
  regenerateMatches('m1', 'ch1');
  ok('离线时不发云端删除', DELETED.length === 0, DELETED.length);
  ok('离线时 3 条旧记录都记入待办，登录后补删', QUEUED.filter(x => /^off\d$/.test(x.id)).length === 3, QUEUED.map(x => x.id));
  STATE.cloudReady = true;
}

group('五、分布体检：能识别「偏集中」');
{
  const skewed = matchDistHealth([], [9, 8, 7, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  ok('前段吃掉 96% 的分布 → 判为偏集中', skewed.skewed === true, skewed);
  ok('偏集中时给出前 1/3 占比', skewed.frontShare > 0.9, skewed.frontShare);
  const even = matchDistHealth([], [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  ok('均匀分布 → 不告警', even.skewed === false, even);
  const short = matchDistHealth([], [1, 0, 1]);
  ok('段数太少（<6）→ 不告警，避免误报', short.skewed === false, short);
}

group('六、底部章节导航：首末章禁用 + 标题展示');
{
  const chs = [
    { id: 'c1', title: '第一章 祖母的教养方式' },
    { id: 'c2', title: '第二章 艰难的求学路' },
    { id: 'c3', title: '第三章 城里的生活' }
  ];
  STATE.chapters = { m1: chs };
  STATE.learnMaterialId = 'm1';
  STATE.learnChapterId = 'c1';
  DOM = {};
  renderChapterNav();
  ok('首章：上一章按钮被禁用', DOM.navPrevBtn.disabled === true);
  ok('首章：下一章按钮可用', DOM.navNextBtn.disabled === false);
  ok('首章：下一章按钮显示下一章标题', DOM.navNextBtn.innerHTML.indexOf('第二章') === 0, DOM.navNextBtn.innerHTML);
  ok('首章：上一章按钮给出原因提示', DOM.navPrevBtn.title.indexOf('第一章') >= 0, DOM.navPrevBtn.title);
  ok('进度显示 第 1 / 3 章', DOM.chNavProgressBottom.textContent.indexOf('1 / 3') >= 0, DOM.chNavProgressBottom.textContent);

  STATE.learnChapterId = 'c2';
  DOM = {};
  renderChapterNav();
  ok('中间章：两个按钮都可用', DOM.navPrevBtn.disabled === false && DOM.navNextBtn.disabled === false);
  ok('中间章：上一章按钮显示上一章标题', DOM.navPrevBtn.innerHTML.indexOf('第一章') >= 0, DOM.navPrevBtn.innerHTML);
  ok('中间章：下一章按钮显示下一章标题', DOM.navNextBtn.innerHTML.indexOf('第三章') >= 0, DOM.navNextBtn.innerHTML);

  STATE.learnChapterId = 'c3';
  DOM = {};
  renderChapterNav();
  ok('末章：下一章按钮被禁用', DOM.navNextBtn.disabled === true);
  ok('末章：进度条提示已是最后一章', DOM.chNavProgressBottom.textContent.indexOf('已是最后一章') >= 0, DOM.chNavProgressBottom.textContent);

  // 长标题会被裁到 12 字以内
  STATE.chapters = { m1: [{ id: 'a', title: '这是一个非常非常非常非常长的章节标题啊' }, { id: 'b', title: '短' }] };
  STATE.learnChapterId = 'b';
  DOM = {};
  renderChapterNav();
  ok('超长章节标题被裁剪并加省略号', DOM.navPrevBtn.innerHTML.indexOf('…') > 0, DOM.navPrevBtn.innerHTML);
}

group('七、jumpChapter：切章 + 回到文首');
{
  STATE.chapters = { m1: [{ id: 'c1', title: 'A' }, { id: 'c2', title: 'B' }, { id: 'c3', title: 'C' }] };
  STATE.learnMaterialId = 'm1';
  refreshLearnCalls.length = 0;
  STATE.learnChapterId = 'c1';
  jumpChapter(1, true);
  ok('从第 1 章往后跳 → 到第 2 章', STATE.learnChapterId === 'c2', STATE.learnChapterId);
  ok('跳转时要求滚动到文首', refreshLearnCalls[refreshLearnCalls.length - 1] === true, refreshLearnCalls);
  ok('章节下拉框同步更新', DOM.selChapter.value === 'c2', DOM.selChapter.value);
  jumpChapter(-1, true);
  ok('再往前跳 → 回第 1 章', STATE.learnChapterId === 'c1', STATE.learnChapterId);
  STATE.learnChapterId = 'c1';
  jumpChapter(-1, true);
  ok('第 1 章再往前 → 不动（不越界）', STATE.learnChapterId === 'c1', STATE.learnChapterId);
  STATE.learnChapterId = 'c3';
  jumpChapter(1, true);
  ok('末章再往后 → 不动（不越界）', STATE.learnChapterId === 'c3', STATE.learnChapterId);
}

group('八、云端调用分批节流（一整本书几百条时不会被限流）');
{
  ok('每批上限是 10 条', CLOUD_BATCH === 10, CLOUD_BATCH);
  STATE.cloudReady = true;
  STATE.chapters = { m1: [CH] };
  STATE.matches = { m1: { ch1: [] } };
  for (let i = 0; i < 30; i++) STATE.matches.m1.ch1.push({ lemma: 'z' + i, chWord: 'z' + i, position: i, _cloudId: 'b' + i });
  DELETED.length = 0; ADDED.length = 0;
  regenerateMatches('m1', 'ch1');
  const firstBatchDel = DELETED.filter(x => /^b\d+$/.test(x.id)).length;
  ok('30 条旧记录首批只发 10 条（其余排队）', firstBatchDel === 10, firstBatchDel);
  ok('返回的清除条数是 30（不是只算首批）', purgeAutoMatches, typeof purgeAutoMatches === 'function');
  const firstBatchAdd = ADDED.length;
  ok('本轮新标注也是分批推（首批 ≤ 10）', firstBatchAdd > 0 && firstBatchAdd <= 10, firstBatchAdd);
}

group('九、HTML 结构');
{
  ok('页面里有底部导航容器 chapterNavBottom', html.indexOf('id="chapterNavBottom"') > 0);
  ok('底部导航在 readingArea 之后', html.indexOf('id="chapterNavBottom"') > html.indexOf('id="readingArea"'));
  ok('底部导航按钮绑定了 jumpChapter', html.indexOf('onclick="jumpChapter(-1, true)"') > 0 && html.indexOf('onclick="jumpChapter(1, true)"') > 0);
  ok('顶部原有导航按钮仍然存在', html.indexOf('onclick="prevChapter()"') > 0 && html.indexOf('onclick="nextChapter()"') > 0);
}

console.log('\n' + '='.repeat(56));
console.log(FAIL === 0 ? ('全部通过：' + PASS + '/' + (PASS + FAIL)) : ('通过 ' + PASS + ' / 失败 ' + FAIL));
process.exit(FAIL === 0 ? 0 : 1);
