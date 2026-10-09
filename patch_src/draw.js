// ===== 自由笔迹层（canvas 矢量笔迹） =====
// 要解决的问题：原来划线只取「按下点」和「松手点」两个句号，中间轨迹全部丢弃，
// 所以画不出折线/曲线/手写，只能表达「从哪句到哪句」。
// 现在把整条轨迹记录下来画到 canvas 上，同时句子照旧命中 ——
// 笔迹和句子都保留，各管各的：笔迹负责「长什么样」，句子负责「搜得到什么」。
//
// 关键设计：
//   1. 笔迹按「阅读区内的归一化坐标」存（0~1），不存屏幕绝对坐标。
//      理由：屏幕坐标换个设备、窗口一缩放就全废了。
//   2. 笔迹渲染到独立 canvas 覆盖层，正文重排时整体重绘，不进 innerHTML。
//   3. 每个点带压感（没有压感的设备退化成固定宽度），用相邻两点做可变宽多边形。
//   4. 撤销/重做按「笔画」为粒度，不按点。
//
// 为什么不用 getPredictedEvents：那是拿还没发生的点做预测，
// 手写会「跑在前面」画错。getCoalescedEvents 拿的是已经发生的真实中间点，
// 是业界公认的正确做法。笔尖预测的收益来自 coalesced，不是 predicted。

var STROKE_KEY = 'strokes_v1_';
var DRAW_LAYER_ID = 'noteDrawLayer';
var DRAW_MIN_POINTS = 2;           // 少于这么多点不入库（点击误触）
var STROKE_MAX_POINTS = 4000;      // 单笔上限，超了抽稀，防手机内存爆
// ★ 荧光笔风格：半透明、低不透明度、细一点。
//   用户明确要求「不要黑线，只要荧光笔痕迹」——
//   纯黑实心线条在正文上太重，像批改。所以默认给半透明琥珀色，
//   并且绘制时整体降alpha，让底下文字仍然清晰可读。
var STROKE_WIDTH_BASE = 6.5;
var STROKE_SMOOTH = 0.35;          // 指数平滑系数，越大越「跟随」原始轨迹，越小越「圆润」
var STROKE_MIN_DIST = 1.1;         // 小于这个像素位移的采样点直接丢（高频采样去抖）
var STROKE_ALPHA = 0.42;           // 荧光笔的半透明感
var STROKE_COLOR = '#F5C76A';      // 琥珀荧光笔

var _STROKES = null;               // 内存缓存：{ strokes: [ {id, noteId, color, width, pts:[{x,y,p}]} ], redo: [] }
var _DRAW_CTX = null;
var _LIVE = null;                  // 正在画的那一笔：{id, raw:[], pts:[], canvas, ctx, ... }
var _DRAW_STYLE = { color: STROKE_COLOR, width: STROKE_WIDTH_BASE, show: true, alpha: STROKE_ALPHA };
var _OFFSCREEN = null;             // 离屏层：整条笔画完再一次性合成（荧光笔不叠加加深）
var _IN_OFFSCREEN = false;         // 在离屏层里画时 alpha 必须是 1（否则和合成 alpha 叠乘）
// ★ v31 性能改造：画布不再铺满整章，只盖「当前一屏」
//   起因：平板特别卡。实测 A/B（同一段滚动只改一个变量）：
//     整页大画布 + 每次滚动 clearRect 整块 → 44 次长任务 / 累计卡 7382ms
//     整页大画布 + 滚动不重绘          → 0 次 / 0ms
//     画布缩成 2×2 + 滚动重绘          → 0 次 / 0ms
//   也就是说卡的不是「画布这层」，而是**每次滚动对那块巨型画布 clearRect**。
//   一章 10166px × dpr2 = 2048×20332 ≈ 4160 万像素 ≈ 160MB 位图，
//   而且**超过 iPad Safari 单画布上限 16,777,216 px（4096×4096）2.5 倍**——
//   这也解释了「平板用笔划不出痕迹」：画布压根没分配成功。
//   现在：画布尺寸 = 视口大小；absolute + top=scrollY 贴在当前这一屏上，
//   滚动时只挪位置（天然跟着文档走）+ 只重绘视口内可见的笔迹。
var _BASE_CANVAS = null;           // 画一笔时把「已有笔迹」冻结成底图，每帧只贴底图 + 当前这
var _DRAW_TF_DPR = 0;              // 当前 ctx 上已施加的 dpr 变换（改过画布尺寸后必须重施）
var _DRAW_CLEARED_EMPTY = false;   // 一条笔迹都没有时，已经清过一次就不必再清
var DRAW_CULL_PAD = 64;            // 可视区上下各留一点余量，避免滚动边缘闪一下

// ---------- 归一化坐标：文档 ↔ 0~1 ----------
// ★ 用 window.innerWidth/Height 而不是 canvas 自己的 rect：
//   canvas 是 fixed 层，尺寸由我们写入；拿它自己的 rect 会和写入互相依赖，
//   而且 fixed 元素的 rect 依赖视口，一旦为 null 就整条链断掉（实测 canvas 塌成 300x150）。
//   阅读区不是滚动容器（滚的是文档），所以笔迹就该跟视口走。
// ---------- 归一化坐标：文档 ↔ 0~1 ----------
// ★ 必须是**文档坐标**，不能是视口坐标。
//   踩过的坑：v25 用 position:fixed + 视口坐标，页面一滚动 canvas 钉在视口上不动，
//   笔迹就永远停在原来那个屏幕位置（用户平板上看到「黑线一直在那个地方」）。
//   fixed 的画布要跟着内容走，只有两种办法：
//     a) 每次滚动重绘（要减去 scrollY，滚动时会有延迟/抖动）
//     b) 记文档坐标 + 用 absolute 挂在正文容器上（推荐，滚动天然跟随）
//   这里用 b：坐标里含 scrollY，画布 absolute 定位在文档流里，滚动自动对齐。
function drawScale() {
  var w = (typeof window !== 'undefined' && window.innerWidth) || 0;
  var h = (typeof window !== 'undefined' && window.innerHeight) || 0;
  if (!w || !h) {
    var de = (typeof document !== 'undefined') ? document.documentElement : null;
    w = (de && de.clientWidth) || 1;
    h = (de && de.clientHeight) || 1;
  }
  return { r: { left: 0, top: 0 }, w: w, h: h };
}
function drawScrollY() {
  if (typeof window !== 'undefined') {
    if (typeof window.scrollY === 'number') return window.scrollY;
    if (typeof window.pageYOffset === 'number') return window.pageYOffset;
  }
  var de = (typeof document !== 'undefined') ? document.documentElement : null;
  return de ? (de.scrollTop || 0) : 0;
}
function drawScrollX() {
  if (typeof window !== 'undefined') {
    if (typeof window.scrollX === 'number') return window.scrollX;
    if (typeof window.pageXOffset === 'number') return window.pageXOffset;
  }
  var de = (typeof document !== 'undefined') ? document.documentElement : null;
  return de ? (de.scrollLeft || 0) : 0;
}
// 视口坐标 → 文档归一化坐标（把滚动量加回去）
function drawToNorm(x, y) {
  var s = drawScale();
  var w = s.w || 1, h = s.h || 1;
  return {
    x: (x - (s.r.left || 0) + drawScrollX()) / w,
    y: (y - (s.r.top || 0) + drawScrollY()) / h
  };
}
// 文档归一化坐标 → 画布内像素坐标（CSS px）
// ★ 画布只盖一屏、贴在「当前这一屏」上（absolute + top=scrollY），
//   所以画布内的 y = 文档 y - 当前滚动量。
//   注意：仍然是**文档坐标**存储（drawToNorm 里加了 scrollY），
//   滚动时画布跟着文档走，笔迹不会像 v25 那样钉在屏幕上。
function drawToDocPx(pt) {
  var s = drawScale();
  return { x: pt.x * (s.w || 1), y: pt.y * (s.h || 1) - drawScrollY() };
}

function drawViewH() {
  return drawScale().h || 1;
}

// 把画布贴到当前这一屏：absolute + top=scrollY
function drawPlaceLayer() {
  var el = document.getElementById(DRAW_LAYER_ID);
  if (!el || !el.style) return;
  var y = Math.round(drawScrollY());
  var t = y + 'px';
  if (el.style.top !== t) el.style.top = t;
}

// 重施 dpr 变换。★ 必须的：给 canvas 的 width/height 赋值会**重置上下文状态**
// （变换回到单位矩阵），只设一次的话在 2x 屏上重绘一次就变成 1:1 → 笔迹只有一半大。
function drawApplyTf(c) {
  if (!c || typeof c.setTransform !== 'function') return;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  _DRAW_TF_DPR = dpr;
}

// 笔迹在文档里的纵向范围（像素）
function drawStrokeBBox(st) {
  var pts = (st && st.pts) || [];
  if (!pts.length) return null;
  var min = Infinity, max = -Infinity;
  for (var i = 0; i < pts.length; i++) {
    var y = pts[i].y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  var vh = drawViewH();
  return { minY: min * vh, maxY: max * vh };
}

// 这一笔是否落在当前可见的范围内 —— 视口外的整笔直接跳过不画
// （这就是把「每次滚动重画全部笔迹」压成 O(可见笔迹) 的关键）
function drawStrokeVisible(st) {
  var bb = drawStrokeBBox(st);
  if (!bb) return false;
  var top = drawScrollY() - DRAW_CULL_PAD;
  var bot = drawScrollY() + drawViewH() + DRAW_CULL_PAD;
  return bb.maxY >= top && bb.minY <= bot;
}

// 起笔前把「已有笔迹」拷成一张底图：画的过程中每帧只要
// 贴底图 + 合成当前这一笔，不必把所有笔迹重画一遍
function drawCaptureBase() {
  var el = document.getElementById(DRAW_LAYER_ID);
  if (!el || !el.width || typeof document === 'undefined' || !document.createElement) return false;
  if (!_BASE_CANVAS) _BASE_CANVAS = document.createElement('canvas');
  var b = _BASE_CANVAS;
  if (b.width !== el.width || b.height !== el.height) { b.width = el.width; b.height = el.height; }
  var bc = b.getContext ? b.getContext('2d') : null;
  if (!bc || typeof bc.drawImage !== 'function' || typeof bc.clearRect !== 'function') { _BASE_CANVAS = null; return false; }
  bc.setTransform(1, 0, 0, 1, 0, 0);
  bc.clearRect(0, 0, b.width, b.height);
  bc.drawImage(el, 0, 0);
  return true;
}

function drawBlitBase(c) {
  if (!c || !_BASE_CANVAS || typeof c.drawImage !== 'function') return false;
  c.save();
  if (typeof c.setTransform === 'function') c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(_BASE_CANVAS, 0, 0);
  c.restore();
  drawApplyTf(c);
  return true;
}

// ---------- 存储 ----------
function drawStoreKey() {
  return STROKE_KEY + (typeof STATE !== 'undefined' ? (STATE.profileId || 'anon') : 'anon');
}
function drawLoad() {
  if (_STROKES) return _STROKES;
  var raw = null;
  try { raw = LS.get(drawStoreKey(), null); } catch (e) { raw = null; }
  _STROKES = (raw && typeof raw === 'object')
    ? { strokes: Array.isArray(raw.strokes) ? raw.strokes : [], redo: [] }
    : { strokes: [], redo: [] };
  return _STROKES;
}
function drawSave() {
  var st = drawLoad();
  // redo 栈不持久化：刷新后重做历史就没意义了
  try { LS.set(drawStoreKey(), { strokes: st.strokes }); } catch (e) { }
}

// ---------- canvas 覆盖层 ----------
function drawEnsureLayer() {
  var el = document.getElementById(DRAW_LAYER_ID);
  if (!el) {
    el = document.createElement('canvas');
    el.id = DRAW_LAYER_ID;
    el.className = 'note-draw-layer';
    el.setAttribute('aria-hidden', 'true');
    // ★ 挂到 body 下：position:fixed 只有挂在 body 才能相对视口定位。
    //   挂到阅读区里会因为祖先的定位上下文变化而错位。
    var host = document.body || document.documentElement;
    if (!host) return null;
    host.appendChild(el);
  }
  drawResizeLayer();
  if (!_DRAW_CTX) {
    _DRAW_CTX = el.getContext ? el.getContext('2d') : null;
  }
  return el;
}

function drawDocHeight() {
  var de = (typeof document !== 'undefined') ? document.documentElement : null;
  var b = (typeof document !== 'undefined') ? document.body : null;
  var h = 0;
  if (de) h = Math.max(h, de.scrollHeight || 0, de.clientHeight || 0);
  if (b) h = Math.max(h, b.scrollHeight || 0, b.offsetHeight || 0);
  return Math.max(h, 1);
}

function drawResizeLayer() {
  var el = document.getElementById(DRAW_LAYER_ID);
  if (!el) return;
  var s = drawScale();
  var dpr = window.devicePixelRatio || 1;
  // ★ 只盖「一屏」而不是整个文档：
  //   1024×768 的平板上，原来 2048×20332（4160 万像素、160MB 位图）→ 现在 2048×1536（310 万像素）。
  //   面积降到约 1/13，也落回 iPad Safari 单画布上限（16777216 px）以内 ——
  //   之前「平板用笔划不出痕迹」就是画布超出了上限、根本没分配成功。
  var w = Math.max(1, Math.round(s.w * dpr));
  var h = Math.max(1, Math.round(s.h * dpr));
  // ★ 注意：不能因为「尺寸没变」就整体 return。
  //   刷新后第一次进来时 canvas 元素可能已经带着正确的 width/height，
  //   那样直接 return 会让 _DRAW_CTX 永远是 null → 笔迹一条也画不出来
  //   （实际踩过：鼠标和笔都画不出东西，canvas 全空）。
  //   所以 ctx 缺失时要单独补取。
  var resized = (el.width !== w || el.height !== h);
  if (resized) {
    el.width = w;                  // 赋值会清空画布，正好等于 clearRect
    el.height = h;
  }
  el.style.width = s.w + 'px';
  el.style.height = s.h + 'px';
  drawPlaceLayer();                // 贴到当前这一屏
  if (!_BASE_CANVAS) _DRAW_CLEARED_EMPTY = false;
  _BASE_CANVAS = null;             // 尺寸变了，旧底图作废
  if (!_DRAW_CTX && el.getContext) _DRAW_CTX = el.getContext('2d');
  if (_DRAW_CTX && (resized || _DRAW_TF_DPR !== dpr)) drawApplyTf(_DRAW_CTX);
  drawRepaint();
}

// ---------- 画一笔 ----------
function drawStrokeStart(e, pointerType) {
  var el = drawEnsureLayer();
  if (!el || !_DRAW_CTX) return null;
  var id = 'st_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  var p0 = drawToNorm(e.clientX, e.clientY);
  var pressure = (typeof e.pressure === 'number' && e.pressure > 0.01) ? e.pressure : 0.5;
  var width = (typeof penWidthFor === 'function')
    ? penWidthFor(pressure, _DRAW_STYLE.width)
    : _DRAW_STYLE.width;
  _LIVE = {
    id: id,
    raw: [{ x: p0.x, y: p0.y, p: pressure }],
    pts: [{ x: p0.x, y: p0.y, p: pressure }],
    pointerType: pointerType || 'mouse',
    color: _DRAW_STYLE.color,
    width: width,
    ratio: (typeof penTiltRatio === 'function') ? penTiltRatio() : 1
  };
  _DRAW_CLEARED_EMPTY = false;
  drawCaptureBase();       // 把已有笔迹冻结成底图，画的过程中不会被自己的重绘盖掉
  drawLiveDot(_LIVE);
  return id;
}

function drawStrokeExtend(strokeId, pts, lastX, lastY) {
  if (!_LIVE || _LIVE.id !== strokeId) return;
  var added = 0;
  for (var i = 0; i < pts.length; i++) {
    var pt = pts[i];
    var n = drawToNorm(pt.x, pt.y);
    var pr = (typeof pt.pressure === 'number' && pt.pressure > 0.01) ? pt.pressure : 0.5;
    _LIVE.raw.push({ x: n.x, y: n.y, p: pr });
    added++;
  }
  var smoothed = drawSmoothPath(_LIVE.raw);
  _LIVE.pts = smoothed;
  if (typeof penWidthFor === 'function') {
    _LIVE.width = penWidthFor(_LIVE.raw[_LIVE.raw.length - 1].p, _DRAW_STYLE.width);
  }
  if (typeof penTiltRatio === 'function') _LIVE.ratio = penTiltRatio();
  drawLiveStroke(_LIVE);
}

// 指数平滑：保留形状但去掉高频抖动。取窗口内相邻点的加权平均
function drawSmoothPath(raw) {
  var out = [];
  var n = raw.length;
  for (var i = 0; i < n; i++) {
    var prev = raw[i - 1], cur = raw[i], next = raw[i + 1];
    if (!prev && !next) { out.push({ x: cur.x, y: cur.y, p: cur.p }); continue; }
    var a = prev || cur, b = next || cur;
    out.push({
      x: cur.x + (b.x - a.x) * STROKE_SMOOTH * 0.5,
      y: cur.y + (b.y - a.y) * STROKE_SMOOTH * 0.5,
      p: cur.p
    });
  }
  return out;
}

// 单点也要看得见（点一下就是一个点）
function drawLiveDot(st) {
  var c = _DRAW_CTX;
  if (!c) return;
  var p = drawToDocPx(st.pts[0]);
  c.save();
  c.globalAlpha = _IN_OFFSCREEN ? 1 : _DRAW_STYLE.alpha;
  c.fillStyle = st.color;
  c.beginPath();
  // 单点也画成方块，和线段端点一致（荧光笔是方头）
  var _td = Math.max(0.5, st.width * 0.5);
  c.rect(p.x - _td, p.y - _td, _td * 2, _td * 2);
  c.fill();
  c.restore();
}

function drawLiveStroke(st) {
  var c = _DRAW_CTX;
  if (!c) return;
  var s = drawScale();
  drawPlaceLayer();
  c.clearRect(0, 0, s.w, s.h);
  // ★ 先把「画这一笔之前就有的笔迹」贴回来。
  //   原来这里只画当前这一笔，于是画新笔的时候旧笔迹会整片消失（看起来像被吃掉了），
  //   等收笔 drawRepaint 才回来 —— 现在是贴底图，旧笔迹一直在。
  drawBlitBase(c);
  drawPaintStroke(c, st, 0);
  c.save();
  c.globalAlpha = Math.min(1, _DRAW_STYLE.alpha + 0.18);
  var n = st.pts.length;
  if (n >= 2) {
    drawPaintSegment(c, st, st.pts[n - 2], st.pts[n - 1], true);
  }
  c.restore();
}

// 画一条可变宽笔迹：相邻两点做梯形，宽度取两点压力的均值
function drawPaintSegment(c, st, a, b, hot) {
  var pa = drawToDocPx(a), pb = drawToDocPx(b);
  var dx = pb.x - pa.x, dy = pb.y - pa.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  var pr = (a.p + b.p) / 2;
  // ★ 荧光笔的压感变化要「弱」：真实荧光笔按下去粗一点但很有限，
  //   变化太大就变成毛笔/记号笔了。所以压感只贡献一小段。
  var w = st.width * (0.78 + 0.42 * pr);
  if (w < 0.5) w = 0.5;
  if (hot) w *= 1.06;
  var nx = (len > 0.01) ? (-dy / len) : 0;
  var ny = (len > 0.01) ? (dx / len) : 0;
  // 倾斜角让笔尖变扁：沿运动方向压扁、垂直方向保持
  var r = st.ratio || 1;
  var ox = nx * w * r, oy = ny * w * r;

  c.save();
  // ★ alpha 恒定、不分hot/冷：真实荧光笔涂过两遍不会更黑，
  //   如果这里给「正在画的那一段」加深，落笔处会出现一段更浓的痕。
  c.globalAlpha = _IN_OFFSCREEN ? 1 : _DRAW_STYLE.alpha;
  c.fillStyle = st.color;
  c.beginPath();
  c.moveTo(pa.x + ox, pa.y + oy);
  c.lineTo(pb.x + ox, pb.y + oy);
  c.lineTo(pb.x - ox, pb.y - oy);
  c.lineTo(pa.x - ox, pa.y - oy);
  c.closePath();
  c.fill();
  // 端点补一个**小方块**而不是圆：
  //   圆头会在起笔收笔处留下「珠点」，荧光笔是扁平方头，更自然
  if (len > 0.01) {
    var t = w * r * 0.42;
    c.beginPath();
    c.rect(pb.x - t, pb.y - t, t * 2, t * 2);
    c.fill();
  }
  c.restore();
}

// 把一条笔迹画到离屏层，再整体合成到目标画布。
// ★ 为什么必须这样：荧光笔涂两遍不会更黑（同一层内是同一种墨）。
//   如果直接往主画布上一段段填，笔内相邻梯形重叠处会反复叠加 alpha，
//   越涂越浓 —— 画出来是「毛笔/记号笔」而不是荧光笔。
function drawStrokeFlat(c, st, fromIdx) {
  var el = c && c.canvas ? c.canvas : null;
  if (!el || typeof document === 'undefined' || !document.createElement) {
    // 没有 canvas 元素就退化成直接画（功能不受影响，只是浓淡会叠加）
    drawPaintStrokeDirect(c, st, fromIdx);
    return;
  }
  if (!_OFFSCREEN) {
    _OFFSCREEN = document.createElement('canvas');
  }
  var o = _OFFSCREEN;
  if (o.width !== el.width || o.height !== el.height) {
    o.width = el.width;
    o.height = el.height;
  }
  var oc = o.getContext ? o.getContext('2d') : null;
  if (!oc) { drawPaintStrokeDirect(c, st, fromIdx); return; }
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  // 1) 这一笔在离屏层里画满（alpha=1，笔内重叠不加深）
  // ★ 离屏层也必须按 dpr 放大：它和主画布的位图一样大，
  //   如果按 1:1 画，2x 屏上合成出来只有一半大（主画布是按 dpr 缩放的）。
  if (typeof oc.setTransform === 'function') oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.clearRect(0, 0, o.width, o.height);
  if (typeof oc.setTransform === 'function') oc.setTransform(dpr, 0, 0, dpr, 0, 0);
  _IN_OFFSCREEN = true;
  try { drawPaintStrokeDirect(oc, st, fromIdx); }
  finally { _IN_OFFSCREEN = false; }
  // 2) 一次性合成到主画布：全局 alpha 只作用一次 → 整条笔颜色均匀
  //    （离屏已是 dpr 缩放，合成时按设备像素 1:1 贴回即可）
  c.save();
  c.globalAlpha = _DRAW_STYLE.alpha;
  if (typeof c.setTransform === 'function') c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(o, 0, 0);
  c.restore();
  drawApplyTf(c);
}

function drawPaintStroke(c, st, fromIdx) {
  drawStrokeFlat(c, st, fromIdx);
}

function drawPaintStrokeDirect(c, st, fromIdx) {
  if (!st.pts.length) return;
  if (st.pts.length === 1) {
    var p = drawToDocPx(st.pts[0]);
    c.save();
    c.globalAlpha = _DRAW_STYLE.alpha;
    c.fillStyle = st.color;
    c.beginPath();
    var _ts = Math.max(0.5, st.width * 0.5);
    c.rect(p.x - _ts, p.y - _ts, _ts * 2, _ts * 2);
    c.fill();
    c.restore();
    return;
  }
  var start = fromIdx || 0;
  for (var i = start; i < st.pts.length - 1; i++) {
    drawPaintSegment(c, st, st.pts[i], st.pts[i + 1], false);
  }
}

// 收笔：定稿入库
function drawStrokeEnd(strokeId) {
  if (!_LIVE || _LIVE.id !== strokeId) return null;
  var st = _LIVE;
  _LIVE = null;
  var s = drawScale();
  if (_DRAW_CTX) _DRAW_CTX.clearRect(0, 0, s.w, s.h);
  _BASE_CANVAS = null;             // 底图用完即弃（收笔后走 drawRepaint 全量重绘）

  if (!st.raw || st.raw.length < DRAW_MIN_POINTS) { drawRepaint(); return null; }
  // 超长笔画抽稀，保留形状
  var raw = st.raw;
  if (raw.length > STROKE_MAX_POINTS) {
    var step = raw.length / STROKE_MAX_POINTS;
    var thinned = [];
    for (var i = 0; i < STROKE_MAX_POINTS; i++) thinned.push(raw[Math.floor(i * step)]);
    raw = thinned;
    st.pts = drawSmoothPath(raw);
  }

  var st0 = drawLoad();
  var record = {
    id: st.id,
    noteId: null,                 // 挂到哪条笔记上，由 attachStrokeToNote 填
    color: st.color,
    width: st.width,
    ratio: st.ratio,
    pointerType: st.pointerType,
    pts: st.pts.map(function(p) { return { x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4, p: Math.round(p.p * 100) / 100 }; })
  };
  st0.strokes.push(record);
  st0.redo = [];
  drawSave();
  drawRepaint();
  return record;
}

// ---------- 把笔迹挂到笔记上 ----------
function attachStrokeToNote(strokeId, noteId) {
  var st = drawLoad();
  var hit = null;
  for (var i = st.strokes.length - 1; i >= 0; i--) {
    if (st.strokes[i].id === strokeId) { hit = st.strokes[i]; break; }
  }
  if (!hit) return false;
  hit.noteId = noteId;
  drawSave();
  renderNotePanel();
  return true;
}

// 一笔都没命中句子（画在空白处）→ 也存成一条笔记，别让用户白画
function commitStrokeOnlyNote(strokeId) {
  var st = drawLoad();
  var rec = null;
  for (var i = st.strokes.length - 1; i >= 0; i--) {
    if (st.strokes[i].id === strokeId) { rec = st.strokes[i]; break; }
  }
  if (!rec || !rec.pts.length) return null;
  var mid = STATE.learnMaterialId, cid = STATE.learnChapterId;
  if (!mid || !cid) return null;
  var note = addNote([], ['（只有笔迹，没有覆盖到完整句子）'], { strokeId: strokeId, strokeOnly: true });
  if (!note) return null;
  rec.noteId = note.id;
  drawSave();
  renderNotePanel();
  return note;
}

// ---------- 整层重绘（只画当前一屏里的笔迹）----------
function drawRepaint() {
  var el = document.getElementById(DRAW_LAYER_ID);
  if (!el || !_DRAW_CTX || !_DRAW_STYLE.show) return;
  var s = drawScale();
  var c = _DRAW_CTX;
  drawPlaceLayer();
  var st = drawLoad();
  // ★ 一条笔迹都没有时不碰画布：清一次就够了。
  //   滚动时反复清一块空画布纯属浪费（平板上一帧也是钱）。
  if (!st.strokes.length) {
    if (!_DRAW_CLEARED_EMPTY) { c.clearRect(0, 0, s.w, s.h); _DRAW_CLEARED_EMPTY = true; }
    return 0;
  }
  _DRAW_CLEARED_EMPTY = false;
  c.clearRect(0, 0, s.w, s.h);
  var painted = 0;
  for (var i = 0; i < st.strokes.length; i++) {
    if (!drawStrokeVisible(st.strokes[i])) continue;   // ★ 视口外的整笔直接跳过
    drawPaintStroke(c, st.strokes[i], 0);
    painted++;
  }
  return painted;
}

// ---------- 撤销 / 重做 ----------
function drawUndo() {
  var st = drawLoad();
  if (!st.strokes.length) { toast('没有可撤销的笔迹', 'err', 1600); return false; }
  var last = st.strokes.pop();
  st.redo.push(last);
  drawSave();
  drawRepaint();
  renderNotePanel();
  toast('已撤销最后一笔（Ctrl+Z）', 'ok', 1600);
  return true;
}
function drawRedo() {
  var st = drawLoad();
  if (!st.redo.length) { toast('没有可重做的笔迹', 'err', 1600); return false; }
  var back = st.redo.pop();
  st.strokes.push(back);
  drawSave();
  drawRepaint();
  renderNotePanel();
  toast('已重做（Ctrl+Y）', 'ok', 1600);
  return true;
}

// 笔迹跟着笔记一起删：删掉笔记时把挂在它上面的笔迹也清掉
function drawDropStrokesOfNote(noteId) {
  var st = drawLoad();
  var before = st.strokes.length;
  st.strokes = st.strokes.filter(function(s) { return s.noteId !== noteId; });
  if (st.strokes.length !== before) { drawSave(); drawRepaint(); }
  return before - st.strokes.length;
}

// 按笔迹 id 删（笔记上记了 strokeId 时走这条）
function drawDropStroke(strokeId) {
  if (!strokeId) return 0;
  var st = drawLoad();
  var before = st.strokes.length;
  st.strokes = st.strokes.filter(function(s) { return s.id !== strokeId; });
  if (st.strokes.length !== before) { drawSave(); drawRepaint(); return before - st.strokes.length; }
  return 0;
}

function drawClearAll() {
  var st = drawLoad();
  st.strokes = [];
  st.redo = [];
  drawSave();
  drawRepaint();
}

function drawSetStyle(color, width) {
  if (color) _DRAW_STYLE.color = color;
  if (width && width > 0) _DRAW_STYLE.width = width;
  drawRepaint();
}
function drawSetAlpha(a) {
  if (typeof a !== 'number' || a <= 0) return;
  _DRAW_STYLE.alpha = a;
  drawRepaint();
}
function drawGetStyle() {
  return { color: _DRAW_STYLE.color, width: _DRAW_STYLE.width, show: _DRAW_STYLE.show, alpha: _DRAW_STYLE.alpha };
}
function drawToggleShow(on) {
  _DRAW_STYLE.show = (typeof on === 'boolean') ? on : !_DRAW_STYLE.show;
  var el = document.getElementById(DRAW_LAYER_ID);
  if (el) el.style.display = _DRAW_STYLE.show ? '' : 'none';
  if (_DRAW_STYLE.show) drawRepaint();
  return _DRAW_STYLE.show;
}

// 序列化：写进云表用
function drawStrokesOfNote(noteId) {
  var st = drawLoad();
  return st.strokes.filter(function(s) { return s.noteId === noteId; });
}