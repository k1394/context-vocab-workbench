# -*- coding: utf-8 -*-
"""自由笔迹 + 触控笔（pen）支持

背景：划线笔记原来只取「按下点」和「松手点」两个句号，中间轨迹全部丢弃，
所以画不出折线/曲线/手写，只能表达「从哪句到哪句」。
同时 pointerType / pressure / tilt 一直在事件对象里（已经用了 Pointer Events），
但代码从没读过 e.pressure —— 不是「认不出笔」，是「数据拿到了没用」。

改动清单
  1.  CSS        ：笔迹 canvas 覆盖层样式（盖在正文上、不吃事件、随滚动移动）
  2.  工具栏     ：笔迹开关 + 撤销/重做 + 颜色粗细
  3.  插 pen.js  ：防手掌误触 / 压感映射 / 笔尖预测（getCoalescedEvents）/ 倾斜角
  4.  插 draw.js ：自由笔迹层（归一化坐标、可变宽多边形、平滑、撤销重做）
  5.  highlight  ：手势接入（笔优先、笔迹起收笔、纯笔迹笔记、删笔记连带删笔迹）
  6.  键盘       ：Ctrl+Z 撤销 / Ctrl+Y 重做

依赖：必须在 patch_reset.py 之后执行（模块插在同一锚点前，跑得越后插得越靠后）。
"""
import argparse
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load_module(name):
    with io.open(os.path.join(HERE, 'patch_src', name), encoding='utf-8') as f:
        return f.read()


ANCHOR = '/* ===== 内置词书《六级词书》 ===== */'

PEN_JS = load_module('pen.js')
DRAW_JS = load_module('draw.js')
CHARRANGE_JS = load_module('charrange.js')
HLCHAR_JS = load_module('hlchar.js')

CSS = """
/* ===== 自由笔迹 / 触控笔 ===== */
/* ★ 三次定位坑，每个都踩过：
 *
 * 1) position:fixed（v25）—— 画布钉在视口，页面一滚动笔迹就留在原屏幕位置。
 *    用户平板上看到「黑线一直在那个地方」。
 *
 * 2) position:absolute 但 body 是 position:static（v26）—— absolute 会退回
 *    **初始包含块**（视口），不是文档！实测 canvas.getBoundingClientRect().top
 *    = -346（跟着视口跑），笔迹画在文档 y=779、视口却显示在 433，一滚就错位，
 *    表现是「看不见 / 一动就飘」。
 *    → 所以 body 必须显式 position:relative，给 absolute 一个文档级定位基准。
 *
 * 3) pointer-events:none 必须保留：否则画布把 pointerdown 全吃掉，
 *    划线和点词看释义都失效。
 *
 * 4) 尺寸（v31）—— 画布**只盖一屏**，不再铺满整个文档。
 *    原来高度取 drawDocHeight()：一章 10166px × dpr2 = 2048×20332
 *    ≈ 4160 万像素 / 160MB 位图，两个后果：
 *      a) 每次滚动 clearRect 整块 → 平板直接卡成幻灯片（实测累计卡 7382ms）
 *      b) **超过 iPad Safari 单画布上限 16,777,216 px（4096×4096）2.5 倍**
 *         → 画布根本分配不出来，这正是「平板用笔划不出痕迹」的真因
 *    现在尺寸 = 视口，位置由 drawPlaceLayer() 写 inline top = scrollY
 *    （贴着当前这一屏，随文档滚动天然对齐）。
 */
body{position:relative}
.note-draw-layer{position:absolute;left:0;top:0;pointer-events:none;z-index:6}
body.no-draw .note-draw-layer{display:none}
body.cursor-pen #readingArea{cursor:crosshair}
.note-style-row{display:flex;align-items:center;gap:6px;margin:8px 0 6px;flex-wrap:wrap}
.note-swatch{width:18px;height:18px;border-radius:50%;border:2px solid var(--border);cursor:pointer;padding:0}
.note-swatch.on{border-color:var(--text-primary);box-shadow:0 0 0 2px rgba(0,0,0,.08)}
.note-stroke-item{font-size:11px;color:var(--text-tertiary);margin-top:3px}
/* 句内字符级高亮：只标真正划到的那几个字，不是整句 */
.reading-area .note-hl-inline{background:rgba(245,199,106,.45);color:inherit;border-radius:2px;box-shadow:none;padding:0}
.reading-area .sent.note-hl-partial{background:none;box-shadow:none}
.reading-area .sent.note-hl-partial:hover{background:none;box-shadow:none}
/* 「整句笔记」标识：这些是精确划线功能之前划的，用户看到整句高亮会以为没生效 */
.note-item .nt-badge-whole{background:#FDEBD0;color:#854F0B}
.note-item .nt-badge-exact{background:#E1F5EE;color:#0F6E56}
.note-item.note-item-whole .nt-text{color:var(--text-secondary)}
.note-oldbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;
  background:#FAEEDA;color:#633806;border:1px solid #EF9F27;border-radius:8px;
  padding:8px 10px;font-size:12px;line-height:1.6;margin-bottom:10px}
.note-oldbar b{font-weight:500}
/* 卡片主行：直接显示「你划到的那几个字」（精确片段），整句降为上下文 */
.note-item .nt-quote{background:rgba(245,199,106,.42);border-radius:3px;padding:3px 6px;margin-bottom:5px;
  font-size:14px;line-height:1.6;color:var(--text-primary);word-break:break-all}
.note-item .nt-quote-warn{color:#A32D2D;font-weight:600}
.note-item.note-item-whole .nt-quote{background:transparent;padding:0}
/* 旧版错位划线：整条卡片给一条醒目的左边框，别让用户以为是新功能坏了 */
.note-item.note-item-shift{border-left:3px solid #EF9F27;padding-left:8px}
.note-item .nt-badge-shift{background:#FDEBD0;color:#854F0B}
.note-shiftbar{background:#FDF3E3;border-color:#EF9F27;color:#633806}
"""

# ---------- 1. CSS ----------
CSS_OLD = '/* ===== 划线记笔记 ===== */'
CSS_NEW = CSS + '\n/* ===== 划线记笔记 ===== */'

# ---------- 2. 工具栏：笔迹开关 + 撤销重做 + 颜色 ----------
TOOLBAR_OLD = """          <button class="btn btn-sm btn-outline" id="btnNoteDrawer" onclick="toggleNoteDrawer()" title="查看划线笔记">📝 笔记 <span id="noteCountBadge">0</span></button>"""

TOOLBAR_NEW = TOOLBAR_OLD + """
          <button class="btn btn-sm btn-outline" id="btnDrawToggle" onclick="toggleDrawLayer()" title="显示/隐藏笔迹层（快捷键 D）">🖊 笔迹</button>
          <button class="btn btn-sm btn-outline" id="btnDrawUndo" onclick="drawUndo()" title="撤销最后一笔（Ctrl+Z）">↶ 撤销</button>
          <button class="btn btn-sm btn-outline" id="btnDrawRedo" onclick="drawRedo()" title="重做（Ctrl+Y）">↷ 重做</button>"""

# ---------- 3. 抽屉里加笔迹说明 ----------
DRAWER_OLD = """      <div class="note-drawer-body" id="noteDrawerBody"></div>
    </aside>"""
DRAWER_NEW = """      <div class="note-style-row" id="noteStyleRow">
        <span style="font-size:12px;color:var(--text-secondary)">荧光笔颜色</span>
        <button class="note-swatch on" data-c="#F5C76A" style="background:#F5C76A" onclick="setDrawColor(this)" title="琥珀（默认）"></button>
        <button class="note-swatch" data-c="#A8E6A3" style="background:#A8E6A3" onclick="setDrawColor(this)" title="浅绿"></button>
        <button class="note-swatch" data-c="#9BD5F5" style="background:#9BD5F5" onclick="setDrawColor(this)" title="天蓝"></button>
        <button class="note-swatch" data-c="#F5A9C9" style="background:#F5A9C9" onclick="setDrawColor(this)" title="粉"></button>
        <button class="note-swatch" data-c="#D5C2F0" style="background:#D5C2F0" onclick="setDrawColor(this)" title="淡紫"></button>
      </div>
      <div class="note-style-row" id="noteStyleRow2">
        <span style="font-size:12px;color:var(--text-secondary)">粗细</span>
        <input type="range" id="drawWidth" min="3" max="14" step="0.5" value="6.5" style="width:90px" oninput="setDrawWidth(this.value)" title="荧光笔宽度">
        <span style="font-size:12px;color:var(--text-secondary)">浓淡</span>
        <input type="range" id="drawAlpha" min="0.15" max="0.85" step="0.05" value="0.42" style="width:76px" oninput="setDrawAlpha(this.value)" title="半透明程度，越小越淡">
        <span id="drawOnOff" style="font-size:12px;color:var(--text-secondary)"></span>
      </div>
      <div class="note-drawer-body" id="noteDrawerBody"></div>
    </aside>"""

# ---------- 4. 插模块 ----------
INSERT_OLD = ANCHOR
INSERT_NEW = CHARRANGE_JS + '\n\n' + HLCHAR_JS + '\n\n' + PEN_JS + '\n\n' + DRAW_JS + '\n' + ANCHOR

# ---------- 5. 快捷键 ----------
KEY_OLD = """function bindNoteEvents() {"""
KEY_NEW = """// Ctrl+Z 撤销 / Ctrl+Y 重做 / D 切换笔迹层显示
function bindDrawKeys() {
  if (typeof document === 'undefined' || !document.addEventListener || document.__drawKeyBound) return;
  document.__drawKeyBound = true;
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') return;      // 打字时别抢快捷键
    var mod = e.ctrlKey || e.metaKey;
    if (mod && String(e.key || '').toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) { drawRedo(); } else { drawUndo(); }
      return;
    }
    if (mod && String(e.key || '').toLowerCase() === 'y') { e.preventDefault(); drawRedo(); return; }
    if (!mod && String(e.key || '').toLowerCase() === 'd') { drawToggleShow(); }
  }, true);
}
function bindNoteEvents() {"""

# ---------- 6. 每次正文渲染完就建好笔迹层并重绘 ----------
# 原来只在起笔时 drawEnsureLayer，导致「刷新后笔迹层还没建、看不到已有笔迹」。
# 笔迹层要跟着正文一起就位。
RESIZE_OLD = """function renderNotePanel() {"""
RESIZE_NEW = """// 页面尺寸/滚动变化时笔迹要重绘（笔迹存的是文档归一化坐标，所以重绘即可对上）
// ★ 滚动必须节流到「一帧一次」：原来每来一个 scroll 事件就整块重绘一次，
//   这是平板变成幻灯片最直接的原因（实测：同一段滚动 44 次长任务 / 累计卡 7382ms；
//   把重绘去掉就是 0 次 / 0ms）。
//   画布本身也跟着滚动量走（absolute + top=scrollY），所以即使偶尔漏一帧，
//   也只是最边缘一条少画一瞬，不会整体错位。
function bindDrawResize() {
  if (typeof window === 'undefined' || !window.addEventListener || window.__drawResizeBound) return;
  window.__drawResizeBound = true;
  var raf = (typeof window.requestAnimationFrame === 'function')
    ? function (fn) { return window.requestAnimationFrame(fn); }
    : function (fn) { return setTimeout(fn, 16); };
  var pending = null;
  function onResize() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () { pending = null; drawRepaint(); }, 120);
  }
  var queued = false;
  function onScrollRepaint() {
    if (queued) return;
    queued = true;
    raf(function () {
      queued = false;
      if (typeof _DRAW_STYLE !== 'undefined' && _DRAW_STYLE && _DRAW_STYLE.show === false) return;
      drawRepaint();
    });
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScrollRepaint, { passive: true });
  // 捕获阶段再挂一份：万一页面是被某个内层容器滚动的，也能收到并重新贴合
  if (typeof document !== 'undefined' && document.addEventListener) {
    try { document.addEventListener('scroll', onScrollRepaint, true); } catch (e) { }
  }
}
// 笔迹层随正文一起就位：刷新后不必先画一笔才能看到已有笔迹
function ensureDrawLayerReady() {
  if (typeof drawEnsureLayer !== 'function') return;
  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;
  if (drawEnsureLayer()) drawRepaint();
}
function renderNotePanel() {"""


def patch(html):
    n = 0

    old = CSS_OLD
    assert html.count(old) == 1, '划线 CSS 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, CSS_NEW, 1)
    n += 1

    old = TOOLBAR_OLD
    assert html.count(old) == 1, '笔记抽屉按钮锚点不唯一：%d' % html.count(old)
    html = html.replace(old, TOOLBAR_NEW, 1)
    n += 1

    old = DRAWER_OLD
    assert html.count(old) == 1, '抽屉 body 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, DRAWER_NEW, 1)
    n += 1

    old = KEY_OLD
    assert html.count(old) == 1, 'bindNoteEvents 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, KEY_NEW, 1)
    n += 1

    old = RESIZE_OLD
    assert html.count(old) == 1, 'renderNotePanel 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, RESIZE_NEW, 1)
    n += 1

    # 快捷键与 resize 在 initNotesModule 里一并启动
    old = "  bindNoteEvents();\n"
    assert html.count(old) == 1, 'initNotesModule 调 bindNoteEvents 处不唯一：%d' % html.count(old)
    html = html.replace(old, "  bindNoteEvents();\n  if (typeof bindDrawKeys === 'function') bindDrawKeys();\n"
                             "  if (typeof bindDrawResize === 'function') bindDrawResize();\n", 1)
    n += 1

    # 笔迹层随正文一起就位（注意要放在 notes.length 判断之前，
    # 否则「一条笔记都没有」的用户刷新后笔迹层建不出来）
    old = """function renderNoteHighlights() {
  var area = document.getElementById('readingArea');
  if (!area || typeof area.querySelector !== 'function') return;
  clearNoteHighlights(area);"""
    new = """function renderNoteHighlights() {
  var area = document.getElementById('readingArea');
  if (!area || typeof area.querySelector !== 'function') return;
  if (typeof ensureDrawLayerReady === 'function') ensureDrawLayerReady();
  clearNoteHighlights(area);"""
    assert html.count(old) == 1, 'renderNoteHighlights 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ★ 字符级渲染分支：有 cs/ce 的范围时走精细高亮（只标划到的那几个字）
    old = """  var notes = chapterNotes(STATE.learnMaterialId, STATE.learnChapterId);
  if (!notes.length) return;

  var byPara = {};
  notes.forEach(function (nt) {
    (nt.ranges || []).forEach(function (rg) {
      if (!byPara[rg.p]) byPara[rg.p] = [];
      byPara[rg.p].push(rg);
    });
  });

  Object.keys(byPara).forEach(function (p) {"""
    new = """  var notes = chapterNotes(STATE.learnMaterialId, STATE.learnChapterId);
  if (!notes.length) return;

  var byPara = {};
  var hasCharRange = false;
  notes.forEach(function (nt) {
    (nt.ranges || []).forEach(function (rg) {
      if (!byPara[rg.p]) byPara[rg.p] = [];
      byPara[rg.p].push(rg);
      if (rg.cs !== null && rg.cs !== undefined) hasCharRange = true;
    });
  });

  // ★ 只要有任意一条带字符偏移的范围，就走字符级渲染 ——
  //   否则「只划了前 8 个字」必然被标成整句（这是用户最 complained 的点）。
  if (hasCharRange && typeof renderNoteHighlightsByChar === 'function') {
    renderNoteHighlightsByChar(area, byPara);
    return;
  }

  Object.keys(byPara).forEach(function (p) {"""
    assert html.count(old) == 1, '字符级渲染分支锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ★ commitSelection 优先用字符级范围
    old = """function commitSelection(from, to) {
  var ranges = buildRanges(from, to);"""
    new = """function commitSelection(from, to) {
  // ★ 优先字符级范围：能算出句内起止字符偏移时，「只划前 8 个字」就只记 8 个字。
  //   算不出（浏览器不支持 caretRangeFromPoint / 落在挖空框里）才退回整句。
  var ranges = (typeof buildRangesChar === 'function') ? buildRangesChar(from, to) : [];
  if (!ranges || !ranges.length) ranges = buildRanges(from, to);"""
    assert html.count(old) == 1, 'commitSelection 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ★ 笔免开模式：不再只看 pointerType==='pen'，
    #   因为不少平板会把笔报成 touch（iPad「仅 Apple Pencil」模式等），
    #   只看 pointerType 就会退化成手指逻辑 → 用户必须先开「✏️划线」才划得动
    #   → 表现为「平板用不了笔，只能用手指」（用户实际反馈）。
    old = """  // 手指：必须开着「划线模式」才接管（否则滑动应该是滚动页面）
  // 笔 / 鼠标：直接接管，不用开开关 —— 用笔的人不该被这个开关拦住
  var isPen = (_ND.pointerType === 'pen');
  _ND.self = NOTE_MODE || isPen;"""
    new = """  // 手指：必须开着「划线模式」才接管（否则滑动应该是滚动页面）
  // 笔 / 鼠标：直接接管，不用开开关 —— 用笔的人不该被这个开关拦住
  // ★ isStylus 用 penLooksLikeStylus()：不只看 pointerType，
  //   还看倾斜角/压感特征（很多平板把笔报成 touch）
  var isStylus = (typeof penLooksLikeStylus === 'function') ? penLooksLikeStylus(e) : (_ND.pointerType === 'pen');
  _ND.isStylus = isStylus;
  _ND.self = NOTE_MODE || isStylus;"""
    assert html.count(old) == 1, 'isStylus 判定锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ★ 命中定位改用带字符偏移的版本
    old = """  var pt = pointAtXY(e.clientX, e.clientY);
  _ND.from = pt;"""
    new = """  // ★ 用带字符偏移的定位：这样松手时能算出「划到这句的第几个字」
  var pt = (typeof pointAtXYChar === 'function') ? pointAtXYChar(e.clientX, e.clientY) : pointAtXY(e.clientX, e.clientY);
  _ND.from = pt;"""
    assert html.count(old) == 1, 'onNotePointerDown 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    old = """  _ND.to = pointAtXY(e.clientX, e.clientY);
  if (_ND.from && _ND.to) showPreview(_ND.from, _ND.to);"""
    new = """  _ND.to = (typeof pointAtXYChar === 'function') ? pointAtXYChar(e.clientX, e.clientY) : pointAtXY(e.clientX, e.clientY);
  if (_ND.from && _ND.to) showPreview(_ND.from, _ND.to);"""
    assert html.count(old) == 1, 'onNotePointerMove 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    old = """    var a = from, b = to || pointAtXY(e.clientX, e.clientY);"""
    new = """    var a = from, b = to || ((typeof pointAtXYChar === 'function') ? pointAtXYChar(e.clientX, e.clientY) : pointAtXY(e.clientX, e.clientY));"""
    assert html.count(old) == 1, 'onNotePointerUp 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # 原生选区路径也带上字符偏移
    old = """  var a = sentOfNode(rg.startContainer);
  var b = sentOfNode(rg.endContainer);
  if (!a || !b) return null;
  return { from: a, to: b };"""
    new = """  var a = sentOfNode(rg.startContainer);
  var b = sentOfNode(rg.endContainer);
  if (!a || !b) return null;
  // 能算出字符偏移就带上（「只划前 8 个字」要精确到字）
  if (typeof pointAtXYChar === 'function') {
    try {
      var ra = rangeAbsOffset(rg.startContainer, rg.startOffset);
      var rb = rangeAbsOffset(rg.endContainer, rg.endOffset);
      if (ra !== null && rb !== null) {
        a = { p: a.p, si: a.si, off: ra };
        b = { p: b.p, si: b.si, off: rb };
      }
    } catch (e) { }
  }
  return { from: a, to: b };"""
    assert html.count(old) == 1, 'pointsFromSelection 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    old = INSERT_OLD
    assert html.count(old) == 1, '内置词书锚点不唯一：%d' % html.count(old)
    html = html.replace(old, INSERT_NEW, 1)
    n += 1

    return html, n


TOOLBAR_FUNCS = """
// ---------- 工具栏按钮的全局入口 ----------
function toggleDrawLayer() {
  var on = drawToggleShow();
  var btn = document.getElementById('btnDrawToggle');
  if (btn) {
    btn.classList.toggle('btn-primary', on);
    btn.classList.toggle('btn-outline', !on);
  }
  toast(on ? '笔迹已显示' : '笔迹已隐藏（笔迹仍在，刷新会回来）', 'ok', 1800);
}
function setDrawColor(el) {
  if (!el) return;
  var c = el.getAttribute('data-c');
  if (c) drawSetStyle(c, 0);
  var all = document.querySelectorAll('.note-swatch');
  for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
  el.classList.add('on');
}
function setDrawWidth(v) {
  var w = parseFloat(v);
  if (!isNaN(w) && w > 0) drawSetStyle('', w);
}
function setDrawAlpha(v) {
  var a = parseFloat(v);
  if (isNaN(a)) return;
  if (a < 0.08) a = 0.08;
  if (a > 0.95) a = 0.95;
  drawSetAlpha(a);
}
"""


def patch2(html):
    """工具栏按钮的 onclick 直接写在 HTML 里了，这里补上对应函数（插在模块之后）。"""
    n = 0
    old = INSERT_NEW
    assert html.count(old) == 1, '模块插入锚点不唯一：%d' % html.count(old)
    html = html.replace(old, INSERT_NEW + '\n' + TOOLBAR_FUNCS, 1)
    n += 1
    return html, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    args = ap.parse_args()

    with io.open(args.input, encoding='utf-8') as f:
        html = f.read()
    html, n = patch(html)
    html, n2 = patch2(html)
    with io.open(args.output, 'w', encoding='utf-8', newline='') as f:
        f.write(html)
    print('patch_draw: %d 处改动' % (n + n2))


if __name__ == '__main__':
    main()