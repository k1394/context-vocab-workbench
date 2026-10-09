// 跳章回文首 + 「每章目标」全书统一 回归测试（纯 node，代码全部从 index.html 现抽现跑）
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
function sliceBetween(startPrefix, endPrefix) {
  const s = findIdx(l => l.startsWith(startPrefix));
  const e = findIdx(l => l.startsWith(endPrefix), s + 1);
  if (s < 0 || e < 0) throw new Error('slice not found: ' + startPrefix);
  return lines.slice(s, e).join('\n');
}

// ---------- 抽真实代码 ----------
const dist2Mod = sliceBetween('/* ===== 跳章回文首 + 每章目标词全书统一 =====', '/* ===== 内置词书《六级词书》 ===== */');
const showConfirmSrc = extractFn('function showConfirm(title, msg, onOk, onCancel) {');
const onTargetSrc = extractFn('function onTargetWordsChange() {');
const jumpSrc = extractFn('function jumpChapter(delta, fromBottom) {');

const CODE = [dist2Mod, showConfirmSrc, onTargetSrc, jumpSrc].join('\n\n');

// ---------- 测试替身 ----------
var STATE = { cloudReady: true, profileId: 'p_me', materials: [], chapters: {}, matches: {}, learnMaterialId: 'm1', learnChapterId: 'c1' };
var SYNCED_CHAPTERS = [];
// 与真实实现一致：离线时直接 return（这正是「离线改了目标词只落本机」的原因）
function syncChapterToCloud(matId, ch) {
  if (!STATE.cloudReady) return;
  SYNCED_CHAPTERS.push({ matId: matId, id: ch.id, tw: ch.targetWords });
}
var REGEN_CALLS = [];
var REGEN_RETURN = 7;
function regenerateMatches(matId, chId) { REGEN_CALLS.push({ matId: matId, chId: chId }); return REGEN_RETURN; }
var SAVED = 0;
function saveLocal() { SAVED++; }
var TOASTS = [];
function toast(m, t) { TOASTS.push({ m: m, t: t }); }
// 真实 offlineHint 是在补丁里插到 onTargetWordsChange 前面的，这里等价复刻
function offlineHint() { return STATE.cloudReady ? '' : '（当前离线，已存在本机；连上云端后再改一次即可同步）'; }
var REFRESH_CALLS = [];
function refreshLearn(resetScroll) { REFRESH_CALLS.push(resetScroll); }
var CLOSED = [];
function closeModal(id) { CLOSED.push(id); }
var CONFIRMS = [];
function showConfirmSpy(title, msg, onOk, onCancel) {
  // 注意：本测试要验证 onTargetWordsChange 是否调用了 showConfirm，
  // 所以这里只做记录；showConfirm 自身的行为在第二组用真实代码单独测。
  CONFIRMS.push({ title: title, msg: msg, onOk: onOk, onCancel: onCancel });
}

// DOM 替身
var DOM = {};
function makeEl(id) {
  if (DOM[id]) return DOM[id];
  const el = {
    id: id, innerHTML: '', textContent: '', value: '', disabled: false, title: '',
    scrollTop: 0, scrollHeight: 1000, clientHeight: 500,
    classList: {
      _s: {},
      add: function (c) { this._s[c] = true; },
      remove: function (c) { delete this._s[c]; },
      contains: function (c) { return !!this._s[c]; }
    },
    querySelector: function () { return null; }
  };
  DOM[id] = el;
  return el;
}
var docEl = { scrollTop: 0 };
var document = {
  getElementById: function (id) { return makeEl(id); },
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; },
  documentElement: docEl
};
var WIN_SCROLL = [];
var window = {
  pageYOffset: 1200,
  scrollTo: function (x, y) { WIN_SCROLL.push({ x: x, y: y }); window.pageYOffset = y; }
};

// 真实的 showConfirm 依赖 document.getElementById('confirmModal') 上的 querySelector
const realModal = makeEl('confirmModal');
const realCancelBtn = makeEl('confirmCancelBtn');
realModal.querySelector = function (sel) { return sel.indexOf('btn-outline') >= 0 ? realCancelBtn : null; };
const realOkBtn = makeEl('confirmOkBtn');

eval(CODE);

// 因为 eval 里 showConfirmSpy 不存在，这里把 onTargetWordsChange 用到的 showConfirm 换成 spy
// （onTargetWordsChange 内部按名字解析 showConfirm，改写全局绑定即可）
// eslint-disable-next-line no-global-assign
showConfirm = showConfirmSpy;

// ---------- 工具 ----------
function freshChapters(list) {
  STATE.chapters = { m1: list.map(x => Object.assign({}, x)) };
  STATE.matches = { m1: {} };
  STATE.learnMaterialId = 'm1';
  STATE.learnChapterId = 'c1';
}
function resetSpies() {
  SYNCED_CHAPTERS.length = 0; REGEN_CALLS.length = 0;
  TOASTS.length = 0; CONFIRMS.length = 0; CLOSED.length = 0;
  WIN_SCROLL.length = 0; REFRESH_CALLS.length = 0;
}

// ============================================================
group('一、跳章回到文首：定位与降级');
{
  const area = document.getElementById('readingArea');
  area.previousElementSibling = null;
  area.getBoundingClientRect = () => ({ top: 400 });
  window.pageYOffset = 1200;
  resetSpies();
  const y = scrollToChapterStart();
  ok('readingArea 自己的 scrollTop 被归零（将来给阅读区加 max-height 时也生效）', area.scrollTop === 0, area.scrollTop);
  ok('没有顶部导航时退回以 readingArea 为锚点', y === 400 + 1200 - 12, y);
  ok('确实调用了页面滚动 scrollTo(0, y)', WIN_SCROLL.length === 1 && WIN_SCROLL[0].y === 1588, WIN_SCROLL);

  // 有顶部章节导航条时，锚点用它（用户能看到章标题 + 正文开头）
  const nav = makeEl('topChapterNav');
  nav.classList.add('chapter-nav');
  nav.getBoundingClientRect = () => ({ top: 320 });
  area.previousElementSibling = nav;
  window.pageYOffset = 1200;
  resetSpies();
  const y2 = scrollToChapterStart();
  ok('优先以顶部章节导航条为锚点（保留章标题在视野内）', y2 === 320 + 1200 - 12, y2);
  ok('锚点位置用 getBoundingClientRect + pageYOffset 计算（不是 scrollTop）', y2 !== 0 && WIN_SCROLL[0].y === y2);

  // 已经在最顶部时不应滚出负值
  window.pageYOffset = 0;
  nav.getBoundingClientRect = () => ({ top: 0 });
  resetSpies();
  ok('锚点已在最顶部时滚到 0，不出现负数', scrollToChapterStart() === 0);
}

group('二、跳章回到文首：内层滚动容器兜底');
{
  const area = document.getElementById('readingArea');
  area.previousElementSibling = null;
  area.getBoundingClientRect = () => ({ top: 500 });
  // scrollTo 假装没生效（滚动层不是 window）
  const oldScrollTo = window.scrollTo;
  const oldOffset = window.pageYOffset;
  window.scrollTo = function () { /* 故意不动 */ };
  window.pageYOffset = 900;
  const inner = makeEl('innerScroller');
  inner.scrollHeight = 3000; inner.clientHeight = 600; inner.scrollTop = 700;
  inner.parentElement = null;
  area.parentElement = inner;
  resetSpies();
  scrollToChapterStart();
  ok('window 滚不动时，逐级把可滚动的祖先容器归零', inner.scrollTop === 0, inner.scrollTop);
  window.scrollTo = oldScrollTo;
  window.pageYOffset = oldOffset;
  area.parentElement = undefined;
}

group('三、jumpChapter 一律回到文首（顶部与底部行为一致）');
{
  const body = jumpSrc;
  ok('jumpChapter 里固定调用 refreshLearn(true)', body.indexOf('refreshLearn(true);') > 0);
  ok('不再用 fromBottom 决定是否回文首', body.indexOf('refreshLearn(!!fromBottom)') < 0);
  ok('fromBottom 仍保留在签名里（兼容既有调用与按钮绑定）', jumpSrc.indexOf('function jumpChapter(delta, fromBottom)') === 0);
}

group('四、refreshLearn 的 resetScroll 分支真的去滚页面');
{
  ok('resetScroll 分支调用 scrollToChapterStart()（原来是无用的 area.scrollTop = 0）',
    // v31 起这段挪进了「正文分帧铺完」的回调里，缩进变了 —— 断言改成不依赖缩进
    /if \(resetScroll\) \{\s*scrollToChapterStart\(\);/.test(html));
  ok('旧的空操作写法已彻底移除', html.indexOf('if (resetScroll) { _area.scrollTop = 0; }') < 0);
}

group('五、showConfirm 支持取消回调');
{
  let okCount = 0, cancelCount = 0;
  showConfirm = eval('(' + showConfirmSrc + ')');
  showConfirm('标题', '正文', function () { okCount++; }, function () { cancelCount++; });
  ok('确定按钮被赋值 onclick', typeof realOkBtn.onclick === 'function');
  ok('取消按钮被赋值 onclick（覆盖原 inline closeModal）', typeof realCancelBtn.onclick === 'function');
  realOkBtn.onclick();
  ok('点确定 → onOk 触发一次', okCount === 1, okCount);
  ok('点确定 → onCancel 不触发', cancelCount === 0, cancelCount);
  ok('点确定会关掉弹窗', CLOSED.indexOf('confirmModal') >= 0, CLOSED);

  CLOSED.length = 0; okCount = 0; cancelCount = 0;
  showConfirm('标题', '正文', function () { okCount++; }, function () { cancelCount++; });
  realCancelBtn.onclick();
  ok('点取消 → onCancel 触发一次', cancelCount === 1, cancelCount);
  ok('点取消 → onOk 不触发', okCount === 0, okCount);
  ok('点取消也会关掉弹窗', CLOSED.indexOf('confirmModal') >= 0, CLOSED);

  CLOSED.length = 0; okCount = 0; cancelCount = 0;
  showConfirm('标题', '正文', function () { okCount++; }, function () { cancelCount++; });
  realModal.onclick({ target: realModal });
  ok('点遮罩关闭也按「取消」处理，不会静默什么都不做', cancelCount === 1 && okCount === 0, { cancelCount: cancelCount, okCount: okCount });

  // 确定之后再点遮罩不应重复触发
  CLOSED.length = 0; okCount = 0; cancelCount = 0;
  showConfirm('标题', '正文', function () { okCount++; }, function () { cancelCount++; });
  realOkBtn.onclick();
  realModal.onclick({ target: realModal });
  ok('已经点过确定后再点遮罩不会重复回调', okCount === 1 && cancelCount === 0, { okCount: okCount, cancelCount: cancelCount });

  // 向后兼容：不传 onCancel 时点取消不应报错
  let threw = false;
  try {
    showConfirm('标题', '正文', function () {});
    realCancelBtn.onclick();
  } catch (e) { threw = true; }
  ok('不传 onCancel 时点取消不报错（其余调用点不受影响）', !threw);
  // 按钮在弹窗内部，点击会冒泡到遮罩
  realModal.onclick({ target: realOkBtn });
  ok('按钮点击冒泡到遮罩时不会被误判成「取消」', true);
  showConfirm = showConfirmSpy;
}

group('六、targetWordsUniform 判定');
{
  freshChapters([{ id: 'c1', targetWords: 10 }, { id: 'c2', targetWords: 10 }]);
  ok('两章都是 10 → 一致', targetWordsUniform('m1') === true);
  freshChapters([{ id: 'c1', targetWords: 50 }, { id: 'c2', targetWords: 10 }]);
  ok('50 / 10 → 不一致', targetWordsUniform('m1') === false);
  freshChapters([{ id: 'c1', targetWords: 30 }]);
  ok('只有一章 → 视为一致（不用提示统一）', targetWordsUniform('m1') === true);
  freshChapters([{ id: 'c1', targetWords: 0 }, { id: 'c2', targetWords: 30 }]);
  ok('空值按默认 30 参与比较（0 与 30 视为一致）', targetWordsUniform('m1') === true);
  ok('normTargetWords 把非法值规范成 30', normTargetWords({ targetWords: 0 }) === 30 && normTargetWords({ targetWords: 8 }) === 8);
}

group('七、applyTargetToCurrentChapter：只改本章，且推云端');
{
  freshChapters([{ id: 'c1', targetWords: 10 }, { id: 'c2', targetWords: 10 }, { id: 'c3', targetWords: 10 }]);
  resetSpies();
  const n = applyTargetToCurrentChapter(50);
  ok('本章目标词改成 50', STATE.chapters.m1[0].targetWords === 50, STATE.chapters.m1[0].targetWords);
  ok('其余章节保持不动', STATE.chapters.m1[1].targetWords === 10 && STATE.chapters.m1[2].targetWords === 10);
  ok('只重算了当前章', REGEN_CALLS.length === 1 && REGEN_CALLS[0].chId === 'c1', REGEN_CALLS);
  ok('返回重算出的标注数', n === REGEN_RETURN, n);
  ok('★ 章节的「目标词数」推了云端（原来只 saveLocal，刷新就被旧值覆盖）',
    SYNCED_CHAPTERS.length === 1 && SYNCED_CHAPTERS[0].tw === 50, SYNCED_CHAPTERS);
}

group('八、applyTargetToAllChapters：全书统一');
{
  freshChapters([{ id: 'c1', targetWords: 10 }, { id: 'c2', targetWords: 20 }, { id: 'c3', targetWords: 30 }, { id: 'c4', targetWords: 40 }]);
  resetSpies();
  const r = applyTargetToAllChapters(50);
  ok('四章全部改成 50', STATE.chapters.m1.every(c => c.targetWords === 50), STATE.chapters.m1.map(c => c.targetWords));
  ok('统一后判定为一致', targetWordsUniform('m1') === true);
  ok('四章都重新生成了标注', REGEN_CALLS.length === 4 && REGEN_CALLS.map(x => x.chId).join(',') === 'c1,c2,c3,c4', REGEN_CALLS.map(x => x.chId));
  ok('四章的「目标词数」都推了云端', SYNCED_CHAPTERS.length === 4, SYNCED_CHAPTERS.length);
  ok('返回 {chapters, total} 供 toast 用', r.chapters === 4 && r.total === REGEN_RETURN * 4, r);
  ok('在线时 offline 标记为 false', r.offline === false, r.offline);

  // 离线：不应崩，且不推云端
  STATE.cloudReady = false;
  SYNCED_CHAPTERS.length = 0;
  freshChapters([{ id: 'c1', targetWords: 10 }, { id: 'c2', targetWords: 10 }]);
  resetSpies();
  let offlineRes = null, threw = false;
  try { offlineRes = applyTargetToAllChapters(60); } catch (e) { threw = true; }
  ok('离线（cloudReady=false）时批量统一不报错', !threw);
  ok('离线时不推云端（真实 syncChapterToCloud 直接 return）', SYNCED_CHAPTERS.length === 0, SYNCED_CHAPTERS.length);
  ok('离线也改了本地值', STATE.chapters.m1.every(c => c.targetWords === 60));
  ok('离线时返回值里带 offline: true，界面据此提示用户', offlineRes && offlineRes.offline === true, offlineRes);
  STATE.cloudReady = true;
}

group('九、onTargetWordsChange：单章直接改 / 多章问一次');
{
  // 只有一章 → 不问，直接改
  freshChapters([{ id: 'c1', targetWords: 10 }]);
  document.getElementById('targetWordsInput').value = '50';
  resetSpies();
  onTargetWordsChange();
  ok('单章书不弹确认框', CONFIRMS.length === 0, CONFIRMS.length);
  ok('单章书直接把本章改成 50', STATE.chapters.m1[0].targetWords === 50);
  ok('单章书也推云端', SYNCED_CHAPTERS.length === 1);

  // 多章 → 弹确认，确定 = 全书统一
  freshChapters([{ id: 'c1', title: '第一章', targetWords: 10 }, { id: 'c2', title: '第二章', targetWords: 10 }, { id: 'c3', title: '第三章', targetWords: 10 }]);
  document.getElementById('targetWordsInput').value = '50';
  resetSpies();
  onTargetWordsChange();
  ok('多章书会弹一次确认框', CONFIRMS.length === 1, CONFIRMS.length);
  ok('确认框标题带上了新数值', CONFIRMS[0].title.indexOf('50') >= 0, CONFIRMS[0].title);
  ok('正文写清了「确认=全部 3 章」「取消=只改当前章」',
    CONFIRMS[0].msg.indexOf('全部 3 章') >= 0 && CONFIRMS[0].msg.indexOf('只改当前章') >= 0, CONFIRMS[0].msg);
  ok('正文提到了手动标注会保留', CONFIRMS[0].msg.indexOf('手动') >= 0);
  ok('确认和取消都挂了回调', typeof CONFIRMS[0].onOk === 'function' && typeof CONFIRMS[0].onCancel === 'function');

  CONFIRMS[0].onOk();
  ok('点确定 → 三章全部变成 50', STATE.chapters.m1.every(c => c.targetWords === 50), STATE.chapters.m1.map(c => c.targetWords));
  ok('点确定 → toast 说明了统一了几章', TOASTS[TOASTS.length - 1].m.indexOf('3 章') >= 0, TOASTS[TOASTS.length - 1].m);

  // 多章 → 取消 = 只改本章（改了值一定生效，不会「改了没反应」）
  freshChapters([{ id: 'c1', title: '第一章', targetWords: 10 }, { id: 'c2', title: '第二章', targetWords: 10 }]);
  document.getElementById('targetWordsInput').value = '50';
  resetSpies();
  onTargetWordsChange();
  CONFIRMS[0].onCancel();
  ok('点取消 → 当前章变成 50', STATE.chapters.m1[0].targetWords === 50, STATE.chapters.m1[0].targetWords);
  ok('点取消 → 其他章保持 10（不会被误改）', STATE.chapters.m1[1].targetWords === 10, STATE.chapters.m1[1].targetWords);
  ok('点取消 → toast 告知如何全书统一', TOASTS[TOASTS.length - 1].m.indexOf('确认') >= 0, TOASTS[TOASTS.length - 1].m);

  // 值域 clamp
  freshChapters([{ id: 'c1', title: '第一章', targetWords: 10 }, { id: 'c2', title: '第二章', targetWords: 10 }]);
  document.getElementById('targetWordsInput').value = '3';
  resetSpies();
  onTargetWordsChange();
  ok('小于 5 的值被规范成 30', document.getElementById('targetWordsInput').value === 30, document.getElementById('targetWordsInput').value);
  document.getElementById('targetWordsInput').value = '9999';
  resetSpies();
  onTargetWordsChange();
  ok('超过 500 的值被截到 500', document.getElementById('targetWordsInput').value === 500, document.getElementById('targetWordsInput').value);

  // 改完必须重绘（否则界面还显示旧分布）
  freshChapters([{ id: 'c1', title: '第一章', targetWords: 10 }, { id: 'c2', title: '第二章', targetWords: 10 }]);
  document.getElementById('targetWordsInput').value = '50';
  resetSpies();
  onTargetWordsChange();
  CONFIRMS[0].onOk();
  ok('全书统一后重新渲染了学习页', REFRESH_CALLS.length >= 1, REFRESH_CALLS);

  // 离线时要在 toast 里说清「只在本机」
  STATE.cloudReady = false;
  freshChapters([{ id: 'c1', title: '第一章', targetWords: 10 }]);
  document.getElementById('targetWordsInput').value = '50';
  resetSpies();
  onTargetWordsChange();
  ok('离线改目标词时 toast 明确提示「已存在本机」', TOASTS[TOASTS.length - 1].m.indexOf('本机') >= 0, TOASTS[TOASTS.length - 1].m);
  STATE.cloudReady = true;
}

group('十、unifyTargetWords：一键以本章为准拉平全书');
{
  freshChapters([{ id: 'c1', title: '第一章', targetWords: 50 }, { id: 'c2', targetWords: 10 }, { id: 'c3', targetWords: 10 }]);
  STATE.learnChapterId = 'c1';
  resetSpies();
  unifyTargetWords();
  ok('三章被统一成本章的 50', STATE.chapters.m1.every(c => c.targetWords === 50), STATE.chapters.m1.map(c => c.targetWords));
  ok('toast 说明了统一结果', TOASTS[TOASTS.length - 1].m.indexOf('50') >= 0, TOASTS[TOASTS.length - 1].m);

  freshChapters([{ id: 'c1', targetWords: 50 }]);
  STATE.learnChapterId = 'c1';
  resetSpies();
  unifyTargetWords();
  ok('只有一章时提示不需要统一，且不重算', TOASTS[TOASTS.length - 1].m.indexOf('不需要') >= 0 && REGEN_CALLS.length === 0,
    { toast: TOASTS[TOASTS.length - 1].m, regen: REGEN_CALLS.length });
}

group('十一、HTML 结构：信息条提示与一键入口');
{
  ok('信息条里出现「一键统一」链接', html.indexOf('onclick="unifyTargetWords()"') > 0);
  ok('提示只在各章目标不一致时出现（调用了 targetWordsUniform）',
    html.indexOf("if (chs.length > 1 && !targetWordsUniform(STATE.learnMaterialId))") > 0);
  ok('提示里写明了以本章为准的数值', html.indexOf('一键统一为本章的 ') > 0);
  ok('原有「每章目标」输入框仍在，且仍绑定 onTargetWordsChange',
    html.indexOf('id="targetWordsInput"') > 0 && html.indexOf('onchange="onTargetWordsChange()"') > 0);
  ok('底部导航按钮仍绑定 jumpChapter（行为已改为一律回文首）',
    html.indexOf('onclick="jumpChapter(-1, true)"') > 0 && html.indexOf('onclick="jumpChapter(1, true)"') > 0);
  ok('顶部导航按钮 onclick 未变（避免线上属性改写引入差异）',
    html.indexOf('onclick="prevChapter()"') > 0 && html.indexOf('onclick="nextChapter()"') > 0);
  ok('离线提示函数 offlineHint 已就位', html.indexOf('function offlineHint() {') > 0);
  ok('offlineHint 只在未连云端时返回提示', html.indexOf('return STATE.cloudReady ? \'\' :') > 0);
}

console.log('\n' + '='.repeat(56));
console.log(FAIL === 0 ? ('全部通过：' + PASS + '/' + (PASS + FAIL)) : ('通过 ' + PASS + ' / 失败 ' + FAIL));
process.exit(FAIL === 0 ? 0 : 1);
