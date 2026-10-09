// 字符级划线 + 荧光笔风格 + 滚动跟随 逻辑测试
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

// ---------- 一、源码痕迹 ----------
group('一、源码里该有的都在');
function has(s) { return HTML.indexOf(s) >= 0; }
ok('★ canvas 用 absolute（不是 fixed，fixed 会让笔迹钉在视口）',
  /\.note-draw-layer\{position:absolute/.test(HTML) && !/\.note-draw-layer\{position:fixed/.test(HTML));
ok('★ 笔迹存文档坐标（drawToNorm 加上 scrollY）',
  /function drawToNorm[\s\S]{0,300}drawScrollY\(\)/.test(HTML));
ok('★ 绘制用文档像素坐标（drawToDocPx，不减滚动）', /function drawToDocPx/.test(HTML));
ok('★ 画布高度取整个文档高度', /function drawDocHeight/.test(HTML));
ok('★ 荧光笔：半透明', /STROKE_ALPHA = 0\.42/.test(HTML));
ok('★ 荧光笔：琥珀色', /STROKE_COLOR = '#F5C76A'/.test(HTML));
ok('★ 荧光笔：方头（端点用 rect 不是 arc）',
  /小方块/.test(HTML) && !/c\.arc\(pb\.x/.test(HTML));
ok('★ 压感对线宽影响弱（荧光笔不是毛笔）', /0\.78 \+ 0\.42 \* pr/.test(HTML));
ok('★ 字符级定位 pointAtXYChar 在', /function pointAtXYChar/.test(HTML));
ok('★ 字符级范围 buildRangesChar 在', /function buildRangesChar/.test(HTML));
ok('★ commitSelection 走字符级', /buildRangesChar\(from, to\)/.test(HTML));
ok('★ 字符级渲染 renderNoteHighlightsByChar 在', /function renderNoteHighlightsByChar/.test(HTML));
ok('★ 清除高亮会拆掉 <mark>（否则永久残留）',
  /mark\.note-hl-inline/.test(HTML) && /removeChild\(m\)/.test(HTML));
ok('★ 抽屉里有「浓淡」滑块', /id="drawAlpha"/.test(HTML));
ok('★ 颜色是荧光笔色系（不是深蓝）', /#F5C76A/.test(HTML) && !/#1f3f6e/.test(HTML));

// ---------- 二、抽出模块跑 ----------
group('二、逻辑跑起来');

const crStart = HTML.indexOf('var CHAR_EPS = 1;');
const hlStart = HTML.indexOf('// 拖动过程中的字符级预览');
const penStart = HTML.indexOf("var PEN_POINTER_TYPE = 'pen';");
const drawStart = HTML.indexOf("var STROKE_KEY = 'strokes_v1_';");
const modEnd = HTML.indexOf('/* ===== 内置词书《六级词书》 ===== */');
ok('四个模块都能定位', crStart >= 0 && hlStart > crStart && penStart > hlStart && drawStart > penStart && modEnd > drawStart,
  [crStart, hlStart, penStart, drawStart, modEnd]);

const CHARRANGE = HTML.slice(crStart, hlStart);
const HLCHAR = HTML.slice(hlStart, penStart);
const PEN = HTML.slice(penStart, drawStart);
const DRAW = HTML.slice(drawStart, modEnd);

// 测试用的一段话（中文，3 句）
const PARA1 = '夜幕低垂，鬼火狐鸣，凉飕飕的冷风一直往山洞里灌。';
const PARA2 = '山洞入口处有一浅绿色锦衣青年盘膝而坐，外面阴风阵阵，宽大的袖子都被吹得发出了声音。';

let LSSTORE = {};
const FAKE_ELS = {};
const marks = [];
const sandbox = {
  console: console,
  Math: Math, Date: Date, JSON: JSON, parseFloat: parseFloat, parseInt: parseInt, isNaN: isNaN,
  setTimeout: setTimeout, clearTimeout: clearTimeout, String: String, Array: Array, Object: Object,
  LS: { get: (k, d) => (LSSTORE[k] !== undefined ? LSSTORE[k] : d), set: (k, v) => { LSSTORE[k] = v; } },
  STATE: { profileId: 'p1', learnMaterialId: 'm1', learnChapterId: 'c1' },
  escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  document: {
    documentElement: { clientWidth: 800, clientHeight: 600, scrollTop: 0 },
    getElementById: (id) => {
      if (FAKE_ELS[id]) return FAKE_ELS[id];
      if (id === 'noteDrawerBody') return { innerHTML: '' };
      return null;
    },
    addEventListener: () => { },
    createElement: () => ({
      id: '', getContext: () => makeCtx(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setAttribute: () => { }, style: {}, classList: { add: () => { } }, width: 0, height: 0
    }),
    body: {
      classList: { add: () => { }, remove: () => { } },
      appendChild: (el) => { FAKE_ELS[el.id] = el; },
      scrollHeight: 3000
    }
  },
  window: {
    devicePixelRatio: 1, addEventListener: () => { },
    innerWidth: 800, innerHeight: 600, scrollY: 0, scrollX: 0
  },
  devicePixelRatio: 1,
  scrollY: 0, scrollX: 0,
  renderNotePanel: () => { }, toast: () => { }
};
sandbox.globalThis = sandbox;
sandbox.window.scrollY = 0;

function makeCtx() {
  return {
    save() { }, restore() { }, beginPath() { }, moveTo() { }, lineTo() { },
    closePath() { }, fill() { }, clearRect() { }, setTransform() { }, rect() { },
    set fillStyle(v) { }, get fillStyle() { return ''; },
    set globalAlpha(v) { ALPHAS.push(v); }, get globalAlpha() { return 1; }
  };
}
const ALPHAS = [];

const ctx = vm.createContext(sandbox);
for (const [name, code] of [['CHARRANGE', CHARRANGE], ['HLCHAR', HLCHAR], ['PEN', PEN], ['DRAW', DRAW]]) {
  try { vm.runInContext(code, ctx); } catch (e) { ok(name + ' 模块能加载', false, String(e).slice(0, 120)); }
}
const F = ctx;
ok('四个模块都加载成功',
  typeof F.buildRangesChar === 'function' && typeof F.renderNoteHighlightsByChar === 'function'
  && typeof F.penBlocksTouch === 'function' && typeof F.drawStrokeStart === 'function');

// 提供 currentParagraphs / splitSentenceRanges 的最小实现
vm.runInContext(`
  var _PARAS = ${JSON.stringify([PARA1, PARA2])};
  function currentParagraphs() { return _PARAS; }
  var _SC = {};
  function splitSentenceRanges(para) {
    if (typeof para !== 'string' || !para) return [];
    if (_SC[para]) return _SC[para];
    // 按中文句末标点切，扫描式实现（不用正则，避免空匹配死循环）
    var ENDERS = '。！？';
    var out = [], start = 0;
    for (var i = 0; i < para.length; i++) {
      if (ENDERS.indexOf(para.charAt(i)) >= 0) {
        var seg = para.slice(start, i + 1);
        if (seg.trim()) out.push({ start: start, end: i + 1, text: seg });
        start = i + 1;
      }
    }
    if (start < para.length) {
      var tail = para.slice(start);
      if (tail.trim()) out.push({ start: start, end: para.length, text: tail });
    }
    if (!out.length) out.push({ start: 0, end: para.length, text: para });
    _SC[para] = out;
    return out;
  }
  function lastSiOf(p) { var r = splitSentenceRanges(_PARAS[p]); return r.length - 1; }
`, ctx);

const s1 = F.splitSentenceRanges(PARA1)[0];
ok('第1句是「夜幕低垂…里灌。」', s1.text.indexOf('夜幕低垂') === 0, s1.text);
// 造一个确定有 2 句的段落，专供跨段用例
const PARA_SPLIT = '第一句话在这里。第二句话也在这里。';
vm.runInContext('_PARAS[1] = ' + JSON.stringify(PARA_SPLIT) + ';', ctx);
const s2a = F.splitSentenceRanges(PARA_SPLIT)[0];
ok('跨段用例段分成 2 句', F.splitSentenceRanges(PARA_SPLIT).length === 2,
  F.splitSentenceRanges(PARA_SPLIT).map(x => x.text));

// ---------- 三、字符级范围：只划前 8 个字 ----------
group('三、只划前 8 个字 → 只记那8 个字');
// 第1句共 20 个字符；划 [0, 8)
const a = { p: 0, si: 0, off: s1.start + 0 };
const b = { p: 0, si: 0, off: s1.start + 8 };
const r = F.buildRangesChar(a, b);
ok('★ 生成了 1 个范围', r.length === 1, r);
ok('★ cs = 0（从句首开始）', r[0].cs === 0, r[0].cs);
ok('★ ★ ce = 8（只到第 8 个字，不是整句 20）', r[0].ce === 8, r[0].ce);
ok('★ 不是整句（ce 明显小于句长）', r[0].ce < (s1.end - s1.start), { ce: r[0].ce, sentLen: s1.end - s1.start });

// 划句中 [4, 12)
const r2 = F.buildRangesChar({ p: 0, si: 0, off: s1.start + 4 }, { p: 0, si: 0, off: s1.start + 12 });
ok('★ 句中区间 cs/ce 正确', r2[0].cs === 4 && r2[0].ce === 12, { cs: r2[0].cs, ce: r2[0].ce });

// 反向划（从后往前）
const r3 = F.buildRangesChar({ p: 0, si: 0, off: s1.start + 12 }, { p: 0, si: 0, off: s1.start + 4 });
ok('★ 反向划也对（自动纠正方向）', r3[0].cs === 4 && r3[0].ce === 12, { cs: r3[0].cs, ce: r3[0].ce });

// ---------- 四、拿不到字符偏移时退回整句 ----------
group('四、拿不到字符偏移 → 退回整句（不能什么都不记）');
const rNo = F.buildRangesChar({ p: 0, si: 0, off: null }, { p: 0, si: 0, off: null });
ok('★ off 为 null → cs/ce 为 null（整句）', rNo[0].cs === null && rNo[0].ce === null, rNo[0]);
ok('★ 仍记了句子序号', rNo[0].si === 0 && rNo[0].ei === 0, rNo[0]);

// ---------- 五、跨段 ----------
group('五、跨段：两端半截 + 中间整句');
// 跨段：从第 1 段第 1 句的中间，划回第 0 段的第 10 字
const rCross = F.buildRangesChar(
  { p: 1, si: 0, off: s2a.start + 4 },
  { p: 0, si: 0, off: s1.start + 10 }
);
ok('★ 跨段生成 2 个范围', rCross.length === 2, rCross.length);
const first = rCross[0], second = rCross[1];
// 起点段（第 0 段）：从第 10 字到句末
ok('★ 起点段（第0段）只取半截：cs=10 → 句末', first.cs === 10 && first.ce === 24, first);
// 终点段（第 1 段）：从句首到第 4 字
ok('★ 终点段（第1段）只取前半截：cs=0 → ce=4', second.cs === 0 && second.ce === 4, second);

// ---------- 五之二、同段跨句：cs 属于首句、ce 属于末句（不能混着算）----------
group('五之二、同段跨句：首句的 cs 和末句的 ce 分开算');
const sA = F.splitSentenceRanges(PARA_SPLIT)[0];
const sB = F.splitSentenceRanges(PARA_SPLIT)[1];
const rSame = F.buildRangesChar(
  { p: 1, si: 0, off: sA.start + 4 },
  { p: 1, si: 1, off: sB.start + 3 }
);
ok('★ 同段跨句仍是 1 个范围', rSame.length === 1, rSame);
ok('★ ★ cs 相对首句 = 4', rSame[0].cs === 4, rSame[0]);
ok('★ ★ ce 相对末句 = 3（不是拿首句的 cs 去比大小）', rSame[0].ce === 3, rSame[0]);
const slA = F.rangeSliceInSent(rSame[0], 0, sA);
const slB = F.rangeSliceInSent(rSame[0], 1, sB);
ok('★ ★ 首句裁到句末（4 → 句长）', slA.s === 4 && slA.e === (sA.end - sA.start), slA);
ok('★ ★ 末句裁到第 3 个字（0 → 3）', slB.s === 0 && slB.e === 3, slB);
// 整句笔记（cs 为 null）两条句子都得整句
const slWhole = F.rangeSliceInSent({ si: 0, ei: 1, cs: null, ce: null }, 1, sB);
ok('★ 整句笔记的中间句仍是整句', slWhole.s === 0 && slWhole.e === (sB.end - sB.start), slWhole);

// ---------- 五之三、原文坐标系：释义插入物不算偏移 ----------
group('五之三、data-gloss 插入物不进原文偏移');
ok('★ 换算函数在（rawOffsetOfPoint / buildRawTextMap）',
  typeof F.rawOffsetOfPoint === 'function' && typeof F.buildRawTextMap === 'function');
// 造一个迷你 DOM 桩：正文「他们」（原文 2 字）+ 插入物「（them）」（6 字，data-gloss）
function fakeEl(cls, kids, attrs) {
  const el = {
    nodeType: 1, className: cls || '', childNodes: kids || [],
    _attrs: attrs || {}, textContent: (kids || []).map(k => k.textContent).join(''),
    hasAttribute: function (n) { return !!this._attrs[n]; },
    getAttribute: function (n) { return this._attrs[n] === undefined ? null : this._attrs[n]; },
    contains: function (n) { let hit = false; (function w(x) { if (hit) return; if (x === n) { hit = true; return; } (x.childNodes || []).forEach(w); })(this); return hit; }
  };
  (kids || []).forEach(k => { k.parentNode = el; });
  return el;
}
function fakeText(s) { return { nodeType: 3, nodeValue: s, textContent: s }; }
const tA = fakeText('他们');
const glossT = fakeText('（them）');
const tB = fakeText('尚武');
const glossEl = fakeEl('', [glossT], { 'data-gloss': '1' });
const zebox = fakeEl('', [], { 'data-gloss': '1', 'data-raw-len': '2' });   // 挖空：原文有 2 字，DOM 看不见
const pel = fakeEl('', [tA, glossEl, tB, zebox]);
ok('★ 插入物长度不计入（点在 tA 末尾 = 2）', F.rawOffsetOfPoint(pel, tA, 2) === 2, F.rawOffsetOfPoint(pel, tA, 2));
ok('★ ★ 插入物之后的文本仍按原文算（tB 起点 = 2，不是 8）', F.rawOffsetOfPoint(pel, tB, 0) === 2, F.rawOffsetOfPoint(pel, tB, 0));
ok('★ 挖空框把隐藏的原文补回来（末尾 = 4）', F.rawOffsetOfPoint(pel, tB, 2) === 4, F.rawOffsetOfPoint(pel, tB, 2));
const rmap = F.buildRawTextMap(pel);
ok('★ ★ map 只收原文节点（不含插入物）', rmap.length === 2, rmap.map(x => x.node.nodeValue));
ok('★ ★ map 的原文总长 = 4（2 + 挖空 2）', rmap[rmap.length - 1].end === 4, rmap[rmap.length - 1].end);

// ---------- 六、字符区间切片 ----------
group('六、rangeCharSlice 把偏移夹到句长内');
const slice = F.rangeCharSlice({ cs: 2, ce: 8 }, s1);
ok('★ 正常区间原样返回', slice.s === 2 && slice.e === 8, slice);
const overSlice = F.rangeCharSlice({ cs: 0, ce: 999 }, s1);
ok('★ ce 超界被夹到句长（不越界）', overSlice.e === (s1.end - s1.start), overSlice);
const nullSlice = F.rangeCharSlice({ cs: null, ce: null }, s1);
ok('★ cs 为 null → 整句', nullSlice.s === 0 && nullSlice.e === (s1.end - s1.start), nullSlice);
const invSlice = F.rangeCharSlice({ cs: 8, ce: 3 }, s1);
ok('★ 起点晚于终点也能夹住（不返回负长度）', invSlice.e >= invSlice.s, invSlice);

// ---------- 七、区间合并 ----------
group('七、mergeCharSlices 合并重叠区间');
const merged = F.mergeCharSlices([
  { s: 0, e: 5 }, { s: 3, e: 8 }, { s: 20, e: 25 }, { s: 0, e: 2 }
]);
// {0,5}+{3,8}+{0,2} 三段互相重叠 → 合成 {0,8}；{20,25} 独立 → 共 2 段
ok('★ 重叠的合成一段', merged.length === 2, merged);
ok('★ 合并后是 [0,8]', merged[0].s === 0 && merged[0].e === 8, merged[0]);
ok('★ 独立的段保留', merged[1].s === 20 && merged[1].e === 25, merged[1]);

// ---------- 八、荧光笔风格 ----------
group('八、荧光笔风格（不要黑线）');
ok('★ 默认色是琥珀', F.drawGetStyle().color === '#F5C76A', F.drawGetStyle());
ok('★ ★ 半透明度 0.42（不是实心）', Math.abs(F.drawGetStyle().alpha - 0.42) < 0.001, F.drawGetStyle().alpha);
ok('★ 默认宽度是荧光笔级的 6.5', Math.abs(F.drawGetStyle().width - 6.5) < 0.001, F.drawGetStyle().width);
F.drawSetAlpha(0.2);
ok('★ 浓淡可调', Math.abs(F.drawGetStyle().alpha - 0.2) < 0.001, F.drawGetStyle().alpha);
F.drawSetAlpha(0.42);

// ---------- 九、滚动跟随（核心：黑线钉住的问题）----------
group('九、滚动跟随：笔迹不能钉在屏幕上');
// 记录时把 scrollY 算进去
sandbox.scrollY = 500;
sandbox.window.scrollY = 500;
vm.runInContext('drawScrollY = function(){ return (typeof window !== "undefined" && window.scrollY) || 0; };', ctx);
const at500 = F.drawToNorm(100, 600);
sandbox.scrollY = 0;
sandbox.window.scrollY = 0;
vm.runInContext('drawScrollY = function(){ return (typeof window !== "undefined" && window.scrollY) || 0; };', ctx);
const at0 = F.drawToNorm(100, 600);
ok('★ ★ 滚动 500 后同一屏幕位置的文档坐标更大（笔迹跟着内容走）',
  at500.y > at0.y, { scroll0: at0.y.toFixed(4), scroll500: at500.y.toFixed(4) });
ok('★ 文档高度参与归一化（y 可以 > 1）', at500.y > 1, +at500.y.toFixed(4));

// ---------- 十、清除高亮会拆 mark ----------
group('十、清除高亮会把 <mark> 拆回文本（不能永久残留）');
ok('★ clearNoteHighlights 里有 removeChild 拆 mark',
  /removeChild\(m\)/.test(HTML));

// ---------- 十一、源码结构：旧逻辑未被破坏 ----------
group('十一、旧的整句逻辑仍保留（旧笔记不受影响）');
ok('★ mergeSiRanges 还在（旧笔记走它）', /function mergeSiRanges/.test(HTML));
ok('★ buildRanges 还在（兜底）', /function buildRanges\(/.test(HTML));
ok('★ 整句高亮 class note-hl 还在', /note-hl\b/.test(HTML));

const pass = results.filter(r => r.pass).length;
console.log('\n' + '='.repeat(56));
console.log('字符级划线 / 荧光笔 / 滚动跟随：' + pass + '/' + results.length + ' 通过');
const failed = results.filter(r => !r.pass);
if (failed.length) { console.log('失败项：'); failed.forEach(r => console.log('  ✗ ' + r.name)); process.exit(1); }