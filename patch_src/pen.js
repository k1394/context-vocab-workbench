// ===== 触控笔（pointerType=pen）支持 =====
// 现状：事件流已经用 Pointer Events，pointerType / pressure / tiltX / tiltY
// 在事件对象里一直都在，但代码从头到尾没读过 e.pressure —— 所以不是「认不出笔」，
// 是「数据拿到了没用」。这里补上四件事：
//
//   1. 笔优先（防手掌误触）：任一 pen 处于活动状态时，屏蔽所有 touch。
//      平板上笔和手掌同时落在屏幕上很常见，没有这条手掌一移动就会拖出 unwanted 笔迹。
//   2. 压感：映射到线宽 / 笔尖大小。有压感时用压感，没压感（多为手指或廉价笔）退回固定宽度。
//   3. 笔尖预测：笔每秒上报 100~200 点，浏览器每帧只派发一次 pointermove，
//      一次 move 里其实含 4~10 个真实点。getCoalescedEvents() 就是取这些中间点的标准 API，
//      不取就等于丢了 → 手写笔会明显滞后、发毛。
//   4. 倾斜角：tiltX/tiltY 用来算笔杆倾斜，映射成笔尖的椭圆形状（侧锋效果）。

var PEN_POINTER_TYPE = 'pen';
var PEN_TOUCH_BLOCK_MS = 900;   // 笔抬起后再等这么久才放开 touch（笔和手掌切换有延迟）
var PEN_FALLBACK_WIDTH = 2.4;   // 没有压感时的固定线宽
var PEN_MIN_WIDTH = 0.7;
var PEN_MAX_WIDTH = 9;
var PEN_TILT_MAX = 60;          // 倾斜角达到这个度数就算全侧锋

var _PEN = {
  active: false,       // 当前是否有笔处于按下状态
  lastSeenAt: 0,       // 笔最后一次活动的时间
  pointerId: null,     // 活动笔的 pointerId，用来忽略「第二支笔」
  pressure: 0,         // 最近一次压感（0~1）
  tiltX: 0,
  tiltY: 0,
  tiltMag: 0,          // 倾斜角合量（度）
  hasPressure: false,  // 本次绘制是否检测到有效压感
  usingTouch: false    // 本次绘制是不是纯手指（没有笔参与）
};

function penIsActive() { return _PEN.active; }

// 笔一旦抬起不立刻解锁 touch：笔和手掌在平板上是先后接触的，
// 笔抬起瞬间手掌往往还贴着屏幕，立刻放开会出现「笔刚画完，手掌又拖一笔」
function penBlocksTouch() {
  if (_PEN.active) return true;
  return (Date.now() - _PEN.lastSeenAt) < PEN_TOUCH_BLOCK_MS;
}

function penUpdateOnDown(e) {
  if (e) penTrackPressure(e);      // 先记压感，供「压感是否变化过」判定
  if (penLooksLikeStylus(e)) {
    _PEN.active = true;
    _PEN.pointerId = e.pointerId;
    _PEN.lastSeenAt = Date.now();
    _PEN.pressure = (typeof e.pressure === 'number') ? e.pressure : 0;
    _PEN.tiltX = (typeof e.tiltX === 'number') ? e.tiltX : 0;
    _PEN.tiltY = (typeof e.tiltY === 'number') ? e.tiltY : 0;
    _PEN.tiltMag = Math.sqrt(_PEN.tiltX * _PEN.tiltX + _PEN.tiltY * _PEN.tiltY);
    // pressure 为 0 的 pen 事件很常见（部分设备 hover 时也发），
    // 只有明显大于 0 才认为这支笔支持压感
    _PEN.hasPressure = _PEN.pressure > 0.01;
  }
}
function penUpdateOnMove(e) {
  if (e) penTrackPressure(e);
  if (penLooksLikeStylus(e)) {
    _PEN.lastSeenAt = Date.now();
    if (typeof e.pressure === 'number' && e.pressure > 0.01) _PEN.pressure = e.pressure;
    if (typeof e.tiltX === 'number') _PEN.tiltX = e.tiltX;
    if (typeof e.tiltY === 'number') _PEN.tiltY = e.tiltY;
    _PEN.tiltMag = Math.sqrt(_PEN.tiltX * _PEN.tiltX + _PEN.tiltY * _PEN.tiltY);
    if (e.pressure > 0.01) _PEN.hasPressure = true;
  }
}
function penRelease() {
  if (_PEN.active) _PEN.lastSeenAt = Date.now();
  _PEN.active = false;
  _PEN.pointerId = null;
  // 压感轨迹重置：下一笔要重新判断「变没变过」
  penResetPressureTrack();
}

// 压感 → 线宽。压感非线性（人写字轻->重是指数关系），用平方让轻触更细、重按更粗
function penWidthFor(pressure, base) {
  var b = (typeof base === 'number' && base > 0) ? base : PEN_FALLBACK_WIDTH;
  if (!_PEN.hasPressure) return b;
  var p = Math.max(0, Math.min(1, pressure));
  var w = b * (0.35 + 1.65 * Math.pow(p, 0.65));
  return Math.max(PEN_MIN_WIDTH, Math.min(PEN_MAX_WIDTH, w));
}

// 倾斜角 → 笔尖宽高比。侧锋（笔杆躺倒）时画出椭圆笔尖，更像真实笔
function penTiltRatio() {
  if (_PEN.tiltMag <= 1) return 1;                      // 基本垂直，圆形笔尖
  var t = Math.min(1, _PEN.tiltMag / PEN_TILT_MAX);
  return Math.max(0.25, 1 - t * 0.7);                  // 越躺越扁
}

// 取一次 pointermove 里的全部真实采样点（含笔尖预测）。
// 返回 [{x, y, pressure, tiltMag}]，至少含当前点（某些浏览器不实现 coalesced 时退化成 1 点）
function penSamplePoints(e) {
  var out = [];
  var list = null;
  if (typeof e.getCoalescedEvents === 'function') {
    try { list = e.getCoalescedEvents(); } catch (err) { list = null; }
  }
  if (list && list.length) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      out.push({
        x: c.clientX,
        y: c.clientY,
        pressure: (typeof c.pressure === 'number') ? c.pressure : e.pressure,
        tiltMag: (typeof c.tiltX === 'number')
          ? Math.sqrt(c.tiltX * c.tiltX + (c.tiltY || 0) * (c.tiltY || 0))
          : _PEN.tiltMag
      });
    }
  }
  if (!out.length) {
    out.push({
      x: e.clientX,
      y: e.clientY,
      pressure: (typeof e.pressure === 'number') ? e.pressure : 0,
      tiltMag: _PEN.tiltMag
    });
  }
  return out;
}

function penStatusText() {
  if (!_PEN.active) return '无笔活动';
  var kind = _PEN.hasPressure ? '有压感' : '无压感';
  var tilt = _PEN.tiltMag > 1 ? ('倾斜 ' + Math.round(_PEN.tiltMag) + '°') : '垂直';
  return '笔活动 · ' + kind + ' · ' + tilt;
}

// ---------- 笔特征识别（重要） ----------
// ★ 现实问题：不少平板（尤其 iPad 开「仅 Apple Pencil」时、或某些安卓手写笔）
//   会把笔的 pointerType 报成 **touch** 而不是 pen。
//   结果：isPen 判 false → 走手指逻辑 → 必须先开「✏️划线」才划得动，
//   用户就说「平板用不了笔，只能用手指」。
//
// 手指在多数设备上压力恒为 0.5（或 1），笔随力度**连续变化**。
//   单看某一个点区分不了（手指压力也可能不是恰好 0.5），
//   所以要跨事件看「有没有变过」。
var _PRESS_SEEN = {};
var _PRESS_VARIES = {};
function penTrackPressure(e) {
  if (!e) return;
  var key = e.pointerId === undefined ? 'x' : e.pointerId;
  var p = (typeof e.pressure === 'number') ? e.pressure : 0;
  if (_PRESS_SEEN[key] === undefined) { _PRESS_SEEN[key] = p; return; }
  if (Math.abs(p - _PRESS_SEEN[key]) > 0.06) _PRESS_VARIES[key] = true;
  // 滑动平均，避免抖动累积
  _PRESS_SEEN[key] = _PRESS_SEEN[key] * 0.6 + p * 0.4;
}
function penPressureVaries(pointerId) {
  var key = (pointerId === undefined || pointerId === null) ? 'x' : pointerId;
  return _PRESS_VARIES[key] === true;
}
function penResetPressureTrack() { _PRESS_SEEN = {}; _PRESS_VARIES = {}; }

function penLooksLikeStylus(e) {
  if (!e) return false;
  if (e.pointerType === 'pen') return true;
  if (e.pointerType === 'mouse') return false;

  // 1) 倾斜角：手指永远是 0，最可靠
  var tx = typeof e.tiltX === 'number' ? Math.abs(e.tiltX) : 0;
  var ty = typeof e.tiltY === 'number' ? Math.abs(e.tiltY) : 0;
  if (Math.sqrt(tx * tx + ty * ty) > 3) return true;

  // 2) 方位角
  if (typeof e.azimuthAngle === 'number' && e.azimuthAngle !== 0) return true;

  // 3) 接触面积极小 → 笔尖（手指/手掌接触面大得多）
  if (typeof e.width === 'number' && e.width > 0 && e.width < 6) return true;

  // 4) 压感**变化过** → 笔（手指压力恒定）
  //    ★ 不能只看「当前压力不等于 0.5」：手指压力也可能不是 0.5，
  //      那样会把每根手指都当笔 → 手指不经过划线模式、防误触也失效。
  //      必须跨事件确认「变过」。
  if (penPressureVaries(e.pointerId)) return true;

  return false;
}