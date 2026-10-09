// 自由笔迹 + 触控笔支持 逻辑测试
// 只测纯逻辑，不碰真实云端
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
ok('canvas 覆盖层 CSS 有 pointer-events:none（否则会吃掉所有事件）',
  /\.note-draw-layer\{[^}]*pointer-events:none/.test(HTML));
ok('笔迹层 z-index 在正文之上', /\.note-draw-layer\{[^}]*z-index/.test(HTML));
ok('防手掌误触：pen 会阻塞 touch',
  /penBlocksTouch[\s\S]{0,400}pointerType === 'touch'/.test(HTML));
ok('笔尖预测：调了 getCoalescedEvents', /getCoalescedEvents/.test(HTML));
ok('压感：读的是 e.pressure', /penWidthFor[\s\S]{0,200}pressure/.test(HTML));
ok('倾斜角：读了 tiltX/tiltY', /tiltX/.test(HTML) && /tiltY/.test(HTML));
ok('笔免开模式：笔直接 self=true（用 penLooksLikeStylus 判定，不只看 pointerType）',
  /isStylus[\s\S]{0,160}NOTE_MODE \|\| isStylus/.test(HTML));
ok('★ 笔特征识别 penLooksLikeStylus 在（平板把笔报成 touch 也能认出）',
  /function penLooksLikeStylus/.test(HTML) && /azimuthAngle/.test(HTML));
ok('★ penUpdateOnDown/Move 用 penLooksLikeStylus（不再只认 pointerType==pen）',
  /function penUpdateOnDown\(e\)[\s\S]{0,120}penLooksLikeStylus\(e\)/.test(HTML)
  && /function penUpdateOnMove\(e\)[\s\S]{0,120}penLooksLikeStylus\(e\)/.test(HTML));
ok('★ penRelease 会重置压感轨迹（下一笔重新判断）',
  /function penRelease\(\)[\s\S]{0,200}penResetPressureTrack\(\)/.test(HTML));
ok('★ body 显式 position:relative（absolute 画布才有文档级定位基准）',
  /body\{position:relative\}/.test(HTML));
ok('撤销/重做函数在', /function drawUndo\(\)/.test(HTML) && /function drawRedo\(\)/.test(HTML));
ok('快捷键 Ctrl+Z / Ctrl+Y 在', /drawUndo\(\)/.test(HTML) && /'z'/.test(HTML));
ok('笔迹用归一化坐标存（换设备不失真）', /drawToNorm/.test(HTML) && /drawToDocPx/.test(HTML));
ok('★ 笔迹存的是文档坐标（fixed 会让笔迹钉在视口）',
  /function drawToNorm[\s\S]{0,300}drawScrollY\(\)/.test(HTML)
  && /\.note-draw-layer\{position:absolute/.test(HTML));
ok('笔迹挂到笔记上', /function attachStrokeToNote/.test(HTML));
ok('删笔记连带删笔迹', /drawDropStroke/.test(HTML));
ok('工具栏有笔迹/撤销/重做按钮',
  /id="btnDrawToggle"/.test(HTML) && /id="btnDrawUndo"/.test(HTML) && /id="btnDrawRedo"/.test(HTML));

// ---------- 二、抽出模块跑 ----------
group('二、逻辑跑起来');

const penStart = HTML.indexOf('var PEN_POINTER_TYPE = \'pen\';');
const drawStart = HTML.indexOf('var STROKE_KEY = \'strokes_v1_\';');
const modEnd = HTML.indexOf('/* ===== 内置词书《六级词书》 ===== */');
ok('能定位 pen 模块', penStart >= 0, penStart);
ok('能定位 draw 模块', drawStart > penStart, drawStart);
const PEN_CODE = HTML.slice(penStart, drawStart);
const DRAW_CODE = HTML.slice(drawStart, modEnd);

let LSSTORE = {};
const TOASTS = [];
const CTX_OPS = [];          // 记录画布操作，验证可变宽
const FAKE_ELS = {};         // id → 元素，供 getElementById 取
const sandbox = {
  console: console,
  LS: { get: (k, d) => (LSSTORE[k] !== undefined ? LSSTORE[k] : d), set: (k, v) => { LSSTORE[k] = v; } },
  STATE: { profileId: 'p1', learnMaterialId: 'm1', learnChapterId: 'c1' },
  document: {
    documentElement: { clientWidth: 800, clientHeight: 600, scrollTop: 0 },
    getElementById: (id) => {
      if (FAKE_ELS[id]) return FAKE_ELS[id];
      if (id === 'readingArea') {
        return { parentElement: { insertBefore: (el) => { FAKE_ELS[el.id] = el; } } };
      }
      return null;
    },
    addEventListener: () => { },
    body: { classList: { add: () => { }, remove: () => { } }, appendChild: (el) => { FAKE_ELS[el.id] = el; } },
    createElement: () => {
      const el = {
        id: '', getContext: () => makeCtx(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        setAttribute: () => { }, style: {}, classList: { add: () => { } }, width: 0, height: 0
      };
      return el;
    }
  },
  window: { devicePixelRatio: 1, addEventListener: () => { }, innerWidth: 800, innerHeight: 600 },
  devicePixelRatio: 1,
  Math: Math, Date: Date, JSON: JSON, parseFloat: parseFloat, parseInt: parseInt, isNaN: isNaN,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  renderNotePanel: () => { },
  toast: (m) => { TOASTS.push(m); }
};
sandbox.globalThis = sandbox;
sandbox.window.__probeRect = { left: 0, top: 0, width: 800, height: 600 };

function makeCtx() {
  const rec = {
    save() { }, restore() { }, beginPath() { }, moveTo() { }, lineTo() { },
    closePath() { }, fill() { }, arc() { }, clearRect() { }, setTransform() { },
    set fillStyle(v) { }, get fillStyle() { return ''; },
    set globalAlpha(v) { }, get globalAlpha() { return 1; }
  };
  return new Proxy(rec, {
    get(t, k) {
      if (k === 'moveTo') return (x, y) => CTX_OPS.push(['moveTo', x, y]);
      if (k === 'lineTo') return (x, y) => CTX_OPS.push(['lineTo', x, y]);
      if (k === 'arc') return (x, y, r) => CTX_OPS.push(['arc', x, y, r]);
      if (k === 'fill') return () => CTX_OPS.push(['fill']);
      if (k in t) return t[k];
      return () => { };
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

const ctx = vm.createContext(sandbox);
try {
  vm.runInContext(PEN_CODE, ctx);
  vm.runInContext(DRAW_CODE, ctx);
} catch (e) {
  ok('模块能加载', false, String(e));
}

const F = ctx;
ok('pen 模块加载', typeof F.penBlocksTouch === 'function' && typeof F.penWidthFor === 'function');
ok('draw 模块加载', typeof F.drawStrokeStart === 'function' && typeof F.drawStrokeEnd === 'function');

// ---------- 三、防手掌误触 ----------
group('三、防手掌误触');
vm.runInContext('_PEN.active = false; _PEN.lastSeenAt = 0;', ctx);
ok('没笔时手指不被拦（正常触摸可用）', F.penBlocksTouch() === false);

vm.runInContext('_PEN.active = true;', ctx);
ok('★ 笔按下时手指被拦住', F.penBlocksTouch() === true);

vm.runInContext('_PEN.active = false; _PEN.lastSeenAt = Date.now();', ctx);
ok('★ 笔刚抬起，手指仍被拦（900ms 缓冲）', F.penBlocksTouch() === true);

vm.runInContext('_PEN.lastSeenAt = Date.now() - 2000;', ctx);
ok('缓冲期过了，手指恢复可用', F.penBlocksTouch() === false);

// 真实事件序列：笔按住 → 手指按下 → 应该不触发划线
const downRes = await_test_pen_then_touch();
function await_test_pen_then_touch() {
  vm.runInContext('_PEN.active=false; _PEN.lastSeenAt=0;', ctx);
  const penEvt = { pointerType: 'pen', pointerId: 7, pressure: 0.6, tiltX: 10, tiltY: 5, button: 0, clientX: 100, clientY: 100 };
  F.penUpdateOnDown(penEvt);
  ok('★ 记录为笔活动', F.penIsActive() === true);
  ok('★ 认出了压感', F._PEN.hasPressure === true, F._PEN.pressure);
  ok('★ 算出倾斜角', F._PEN.tiltMag > 0, Math.round(F._PEN.tiltMag));
  const blocked = F.penBlocksTouch();
  ok('★ 此时若来一个 touch，会被 onNotePointerDown 拦掉', blocked === true);
  F.penRelease();
  ok('抬笔后不再活动（但仍有缓冲）', F.penIsActive() === false);
}

// ---------- 四、压感 → 线宽 ----------
group('四、压感映射');
vm.runInContext('_PEN.hasPressure = true;', ctx);
const wLight = F.penWidthFor(0.1, 2.5);
const wMid = F.penWidthFor(0.5, 2.5);
const wHeavy = F.penWidthFor(1.0, 2.5);
ok('★ 轻触细', wLight < wMid, { light: +wLight.toFixed(2), mid: +wMid.toFixed(2) });
ok('★ 重按粗', wHeavy > wMid, { heavy: +wHeavy.toFixed(2), mid: +wMid.toFixed(2) });
ok('线宽有上限（防止重按变巨块）', wHeavy <= 9.1, wHeavy);

vm.runInContext('_PEN.hasPressure = false;', ctx);
ok('无压感设备用固定宽度（不忽粗忽细）',
  F.penWidthFor(0.1, 2.5) === 2.5 && F.penWidthFor(1.0, 2.5) === 2.5, [F.penWidthFor(0.1, 2.5), F.penWidthFor(1.0, 2.5)]);

// ---------- 五、倾斜角 ----------
group('五、倾斜角 → 笔尖形状');
vm.runInContext('_PEN.tiltMag = 0;', ctx);
ok('垂直时笔尖是圆的', Math.abs(F.penTiltRatio() - 1) < 0.001, F.penTiltRatio());
vm.runInContext('_PEN.tiltMag = 60;', ctx);
ok('★ 侧锋时笔尖变扁', F.penTiltRatio() < 0.45, +F.penTiltRatio().toFixed(3));
vm.runInContext('_PEN.tiltMag = 400;', ctx);
ok('倾斜角再大也不会变成 0（有下限）', F.penTiltRatio() >= 0.25, F.penTiltRatio());

// ---------- 六、笔尖预测 ----------
group('六、笔尖预测（getCoalescedEvents）');
const coalesced = [
  { clientX: 10, clientY: 10, pressure: 0.4, tiltX: 5, tiltY: 0 },
  { clientX: 12, clientY: 11, pressure: 0.5, tiltX: 5, tiltY: 0 },
  { clientX: 14, clientY: 13, pressure: 0.6, tiltX: 5, tiltY: 0 },
  { clientX: 17, clientY: 15, pressure: 0.7, tiltX: 5, tiltY: 0 },
  { clientX: 20, clientY: 18, pressure: 0.8, tiltX: 5, tiltY: 0 }
];
const evt = { clientX: 20, clientY: 18, pressure: 0.8, tiltX: 5, tiltY: 0, getCoalescedEvents: () => coalesced };
const pts = F.penSamplePoints(evt);
ok('★ ★ 一次 move 取出全部 5 个真实采样点', pts.length === 5, pts.length);
ok('每个点都带自己的压感（不是都取最后一个）',
  pts[0].pressure === 0.4 && pts[4].pressure === 0.8, [pts[0].pressure, pts[4].pressure]);
ok('坐标逐点递增（形状不丢）', pts[0].x === 10 && pts[4].x === 20, [pts[0].x, pts[4].x]);

const noCoalesced = F.penSamplePoints({ clientX: 5, clientY: 6, pressure: 0.3, getCoalescedEvents: undefined });
ok('浏览器不支持时退回 1 点（不崩）', noCoalesced.length === 1 && noCoalesced[0].x === 5, noCoalesced);

const badCoalesced = F.penSamplePoints({ clientX: 1, clientY: 2, pressure: 0.2, getCoalescedEvents: () => { throw new Error('nope'); } });
ok('★ getCoalescedEvents 抛异常也不崩', badCoalesced.length === 1, badCoalesced);

const emptyCoalesced = F.penSamplePoints({ clientX: 3, clientY: 4, pressure: 0.2, getCoalescedEvents: () => [] });
ok('★ 返回空数组时退回当前点', emptyCoalesced.length === 1 && emptyCoalesced[0].x === 3, emptyCoalesced);

// ---------- 七、自由笔迹 ----------
group('七、自由笔迹：不再限制为单段直线');
LSSTORE = {};
vm.runInContext('_STROKES = null;', ctx);
const sid = F.drawStrokeStart({ clientX: 100, clientY: 100, pressure: 0.5, pointerType: 'pen' }, 'pen');
ok('★ 起笔返回 strokeId', !!sid, sid);

// 一条 S 形曲线：6 个点，如果只取首尾就画不出来
// 注意 drawStrokeExtend 收的点是 {x, y, pressure} 的像素坐标
//（penSamplePoints 产出的就是这种格式，highlight.js 传进来的也是它）
const curve = [
  { x: 100, y: 100, pressure: 0.3 },
  { x: 130, y: 130, pressure: 0.4 },
  { x: 160, y: 105, pressure: 0.5 },
  { x: 190, y: 135, pressure: 0.6 },
  { x: 220, y: 100, pressure: 0.7 },
  { x: 250, y: 120, pressure: 0.5 }
];
F.drawStrokeExtend(sid, curve, 250, 120);
const rec = F.drawStrokeEnd(sid, {});
ok('★ ★ 收笔成功（这次真的画成了）', !!rec, rec && rec.id);
// 起笔已落 1 点，再喂 6 点 = 7 点（关键是远多于 2：只取首尾就画不出曲线）
ok('★ ★ 保存了全部 7 个点（起笔 1 + 轨迹 6，不是只有首尾两个）', rec && rec.pts.length === 7, rec && rec.pts.length);
const ys = rec ? rec.pts.map(p => p.y) : [];
ok('★ y 坐标有起伏（说明是曲线不是直线）', Math.max(...ys) - Math.min(...ys) > 0.01,
  ys.length ? [Math.min(...ys).toFixed(3), Math.max(...ys).toFixed(3)] : null);
ok('每个点都记了压感', rec && rec.pts.every(p => typeof p.p === 'number'));
ok('记了绘制设备类型', rec && rec.pointerType === 'pen', rec && rec.pointerType);
ok('★ 坐标是归一化的（0~1）', rec && rec.pts.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));

// 单击不入库
LSSTORE = {};
vm.runInContext('_STROKES = null;', ctx);
const sid2 = F.drawStrokeStart({ clientX: 10, clientY: 10, pressure: 0.5 }, 'touch');
const rec2 = F.drawStrokeEnd(sid2, {});
ok('★ 误触单击不入库（少于 2 点）', rec2 === null, rec2);

// ---------- 八、撤销 / 重做 ----------
group('八、撤销 / 重做');
LSSTORE = {};
vm.runInContext('_STROKES = null;', ctx);
const s1 = F.drawStrokeStart({ clientX: 50, clientY: 50, pressure: 0.5 }, 'pen');
F.drawStrokeExtend(s1, [{ x: 60, y: 60, pressure: 0.5 }, { x: 70, y: 70, pressure: 0.5 }], 70, 70);
F.drawStrokeEnd(s1, {});
const s2 = F.drawStrokeStart({ clientX: 90, clientY: 90, pressure: 0.5 }, 'pen');
F.drawStrokeExtend(s2, [{ x: 100, y: 100, pressure: 0.5 }, { x: 110, y: 110, pressure: 0.5 }], 110, 110);
F.drawStrokeEnd(s2, {});
ok('画了两笔', F.drawLoad().strokes.length === 2, F.drawLoad().strokes.length);

ok('★ 撤销成功', F.drawUndo() === true);
ok('★ 剩一笔', F.drawLoad().strokes.length === 1, F.drawLoad().strokes.length);
ok('★ 重做栈里有一个', F.drawLoad().redo.length === 1, F.drawLoad().redo.length);
ok('★ 重做成功', F.drawRedo() === true);
ok('★ 又变回两笔', F.drawLoad().strokes.length === 2, F.drawLoad().strokes.length);
ok('★ 新画一笔会清空重做栈（标准行为）', (function () {
  const s3 = F.drawStrokeStart({ clientX: 130, clientY: 130, pressure: 0.5 }, 'pen');
  F.drawStrokeExtend(s3, [{ x: 140, y: 140, pressure: 0.5 }, { x: 150, y: 150, pressure: 0.5 }], 150, 150);
  F.drawStrokeEnd(s3, {});
  return F.drawLoad().redo.length === 0;
})(), F.drawLoad().redo.length);
ok('★ 没东西可撤销时返回 false（不崩）', (function () {
  F.drawLoad().strokes = [];
  return F.drawUndo() === false;
})());

// ---------- 九、挂到笔记 / 删笔记连带删笔迹 ----------
group('九、笔迹与笔记的联动');
LSSTORE = {};
vm.runInContext('_STROKES = null;', ctx);
const s9 = F.drawStrokeStart({ clientX: 200, clientY: 200, pressure: 0.5 }, 'pen');
F.drawStrokeExtend(s9, [{ x: 210, y: 210, pressure: 0.5 }, { x: 220, y: 220, pressure: 0.5 }], 220, 220);
F.drawStrokeEnd(s9, {});
ok('★ 笔迹能挂到笔记上', F.attachStrokeToNote(s9, 'nt_abc') === true);
ok('★ 查得出这条笔记的笔迹', F.drawStrokesOfNote('nt_abc').length === 1, F.drawStrokesOfNote('nt_abc').length);
const dropped = F.drawDropStroke(s9);
ok('★ 删笔记时笔迹被连带删掉', dropped === 1 && F.drawStrokesOfNote('nt_abc').length === 0, dropped);

// ---------- 十、持久化 ----------
group('十、持久化');
ok('★ 笔迹写进了 localStorage', !!LSSTORE.strokes_v1_p1, Object.keys(LSSTORE));
ok('★ 存的是数组', Array.isArray(LSSTORE.strokes_v1_p1.strokes));
ok('★ redo 栈不持久化（刷新后重做无意义）', LSSTORE.strokes_v1_p1.redo === undefined);

// ---------- 十一、颜色/粗细/显示 ----------
group('十一、样式切换');
F.drawSetStyle('#c0392b', 4);
ok('★ 改颜色生效', F.drawGetStyle().color === '#c0392b', F.drawGetStyle());
ok('★ 改粗细生效', F.drawGetStyle().width === 4, F.drawGetStyle().width);
const t1 = F.drawToggleShow(false);
ok('★ 能隐藏笔迹层', t1 === false);
ok('★ 再点能显示回来', F.drawToggleShow(true) === true);

// ---------- 十二、尺寸没变时也要能拿到 ctx（真踩过的坑）----------
group('十二、刷新后 ctx 一定能拿到');
LSSTORE = {};
vm.runInContext('_STROKES = null; _DRAW_CTX = null;', ctx);
// 造一个「width/height 已经是正确值」的 canvas，模拟刷新后第一次进来
const fakeCtx = makeCtx();
FAKE_ELS.noteDrawLayer = {
  id: 'noteDrawLayer', width: 800, height: 600, style: {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  getContext: () => fakeCtx
};
vm.runInContext('drawResizeLayer();', ctx);
ok('★ ★ 尺寸没变时也会补取 ctx（否则刷新后一条笔都画不出）',
  F._DRAW_CTX !== null && F._DRAW_CTX === fakeCtx,
  F._DRAW_CTX === null ? 'null' : 'ok');
// 清掉桩，别影响其它组
delete FAKE_ELS.noteDrawLayer;

group('十四、笔特征识别：不能把手指误判成笔');
ok('★ penLooksLikeStylus 是函数', typeof F.penLooksLikeStylus === 'function');
ok('★ 真 pen 认得出', F.penLooksLikeStylus({ pointerType: 'pen', pressure: 0.5 }) === true);
ok('★ 鼠标不当笔', F.penLooksLikeStylus({ pointerType: 'mouse', pressure: 0.5 }) === false);
ok('★ 有倾斜角的 touch 认得出是笔',
  F.penLooksLikeStylus({ pointerType: 'touch', pressure: 0.5, tiltX: 12, tiltY: 8 }) === true);
// ★ 这条是 v27 的真缺陷：手指压力不一定是 0.5，判「不是 0.5 就是笔」会把每根手指当笔
ok('★ ★ 手指压力 0.5（恒定）不当笔',
  F.penLooksLikeStylus({ pointerType: 'touch', pressure: 0.5, tiltX: 0, tiltY: 0 }) === false);
ok('★ ★ 手指压力 0.62 但没变过 → 不当笔（要跨事件确认）',
  F.penLooksLikeStylus({ pointerType: 'touch', pressure: 0.62, tiltX: 0, tiltY: 0 }) === false);
ok('★ 压感跟踪函数在', typeof F.penTrackPressure === 'function'
  && typeof F.penPressureVaries === 'function');

// 模拟一次真实的笔压感变化序列：跨事件才认得出
F.penResetPressureTrack();
const seq = [0.30, 0.55, 0.80, 0.45, 0.90];
let firstTrue = -1;
for (let i = 0; i < seq.length; i++) {
  const evt = { pointerType: 'touch', pressure: seq[i], tiltX: 0, tiltY: 0, pointerId: 5 };
  F.penTrackPressure(evt);
  if (F.penLooksLikeStylus(evt) && firstTrue < 0) firstTrue = i;
}
ok('★ ★ 压感连续变化的 touch 序列最终被认成笔（第 2 个点起）', firstTrue >= 1 && firstTrue <= 2,
  { firstTrue, seq });

// 手指恒定压力序列：永远不该被认成笔
F.penResetPressureTrack();
let anyTrue = false;
for (let i = 0; i < 6; i++) {
  const evt = { pointerType: 'touch', pressure: 0.5, tiltX: 0, tiltY: 0, pointerId: 6 };
  F.penTrackPressure(evt);
  if (F.penLooksLikeStylus(evt)) anyTrue = true;
}
ok('★ ★ 手指恒定 0.5 的序列全程不会被认成笔', anyTrue === false);
F.penResetPressureTrack();

const pass = results.filter(r => r.pass).length;
console.log('\n' + '='.repeat(56));
console.log('自由笔迹 / 触控笔回归：' + pass + '/' + results.length + ' 通过');
const failed = results.filter(r => !r.pass);
if (failed.length) {
  console.log('失败项：');
  failed.forEach(r => console.log('  ✗ ' + r.name));
  process.exit(1);
}