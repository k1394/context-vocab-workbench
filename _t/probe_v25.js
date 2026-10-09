// 浏览器端验证：自由笔迹 + 触控笔（真实 canvas、真实 PointerEvent）
// 全程 offline，不碰真实云端
const { chromium } = require('playwright');
const BASE = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

const P1 = 'Alpha one sentence. Beta two sentence. Gamma three sentence.';
const P2 = 'Delta four sentence. Epsilon five sentence.';

// 造一个 pen 类型的 PointerEvent
async function penEvent(f, type, x, y, pressure, extra) {
  return f.evaluate(([type, x, y, pressure, extra]) => {
    const area = document.getElementById('readingArea');
    const target = document.elementFromPoint(x, y) || area;
    const ev = new PointerEvent(type, Object.assign({
      clientX: x, clientY: y, pressure: pressure,
      tiltX: extra.tiltX, tiltY: extra.tiltY,
      pointerId: extra.pid || 7, pointerType: 'pen',
      isPrimary: extra.isPrimary !== false, button: type === 'pointerup' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true, cancelable: true
    }, {}));
    target.dispatchEvent(ev);
    return { dispatched: true, target: target.tagName + '.' + (target.className || '') };
  }, [type, x, y, pressure, extra]);
}
async function touchEvent(f, type, x, y, pid) {
  return f.evaluate(([type, x, y, pid]) => {
    const area = document.getElementById('readingArea');
    const target = document.elementFromPoint(x, y) || area;
    const ev = new PointerEvent(type, {
      clientX: x, clientY: y, pressure: type === 'pointerup' ? 0 : 0.5,
      pointerId: pid || 99, pointerType: 'touch',
      isPrimary: false, button: type === 'pointerup' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true, cancelable: true
    });
    target.dispatchEvent(ev);
    return { dispatched: true, target: target.tagName + '.' + (target.className || '') };
  }, [type, x, y, pid]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  const f = page.frames().find(fr => /index\.html/.test(fr.url()));
  if (!f) { console.log('no frame'); await browser.close(); return; }
  console.log('    帧 URL: ' + f.url());
  await f.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });
  await f.evaluate(([p1, p2]) => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false;
    STATE.profileId = 'verify_draw';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{ id: 'c_t', title: '测试', content: [p1, p2].join('\n\n'), targetWords: 10 }] };
    STATE.matches = { m_t: { c_t: [] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'original' } } };
    STATE.notes = {};
    localStorage.removeItem('strokes_v1_verify_draw');
    refreshLearn(true);
  }, [P1, P2]);
  await page.waitForTimeout(700);

  // ---------- 一、UI 就位 ----------
  group('一、界面与模块就位');
  const ui = await f.evaluate(() => {
    const layer = document.getElementById('noteDrawLayer');
    const cs = layer ? getComputedStyle(layer) : null;
    return {
      layerExists: !!layer,
      pe: cs ? cs.pointerEvents : null,
      z: cs ? cs.zIndex : null,
      canvasW: layer ? layer.width : 0,
      toggle: !!document.getElementById('btnDrawToggle'),
      undo: !!document.getElementById('btnDrawUndo'),
      redo: !!document.getElementById('btnDrawRedo'),
      swatches: document.querySelectorAll('.note-swatch').length,
      widthSlider: !!document.getElementById('drawWidth'),
      // 关键：覆盖层不能吃掉事件
      elFromPointInside: (function () {
        const b = document.querySelector('#readingArea .sent');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el ? (el.tagName + '.' + (el.className || '')) : null;
      })()
    };
  });
  ok('★ canvas 覆盖层已插入页面', ui.layerExists === true);
  ok('★ ★ pointer-events:none（不吃事件，否则划线全废）', ui.pe === 'none', ui.pe);
  ok('★ z-index 在正文之上', ui.z && Number(ui.z) >= 1, ui.z);
  ok('★ canvas 实际有像素尺寸（按 dpr 放大）', ui.canvasW > 0, ui.canvasW);
  ok('★ ★ 覆盖层没挡住正文：elementFromPoint 拿到的仍是句子', /sent/.test(ui.elFromPointInside || ''), ui.elFromPointInside);
  ok('工具栏三个按钮都在', ui.toggle && ui.undo && ui.redo);
  ok('抽屉里有 4 个颜色 + 粗细滑块', ui.swatches === 4 && ui.widthSlider === true);

// ---------- 二、鼠标画自由笔迹 ----------
group('二、鼠标自由绘制（折线/曲线）');
// 注意：鼠标在「未开划线模式」时是拖选文字（老行为，不能破坏），
// 所以画笔迹要先开划线模式 —— 笔才是免开的那一个。
await f.evaluate(() => setNoteMode(true));
await page.waitForTimeout(200);
const box = await f.locator('#readingArea p[data-pi="0"]').boundingBox();
  if (box) {
    const y = box.y + box.height / 2;
    // 画一条 Z 字形：6 个点
    const pts = [
      [box.x + 20, y], [box.x + 60, y - 25], [box.x + 100, y + 25],
      [box.x + 140, y - 25], [box.x + 180, y + 25], [box.x + 220, y]
    ];
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i][0], pts[i][1], { steps: 3 });
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  const afterMouse = await f.evaluate(() => {
    const st = drawLoad();
    return {
      strokes: st.strokes.length,
      pts: st.strokes.length ? st.strokes[0].pts.length : 0,
      type: st.strokes.length ? st.strokes[0].pointerType : null,
      notes: chapterNotes('m_t', 'c_t').length,
      // 轨迹真的起伏了吗
      ys: st.strokes.length ? st.strokes[0].pts.map(p => Math.round(p.y * 1000) / 1000) : []
    };
  });
  ok('★ ★ 画出 1 条笔迹', afterMouse.strokes === 1, afterMouse.strokes);
  ok('★ ★ 保存了 6+ 个点（不是首尾两个 = 不再是单段直线）', afterMouse.pts >= 6, afterMouse.pts);
  ok('★ y 坐标真的上下起伏（Z 字形而非直线）', new Set(afterMouse.ys).size > 3, afterMouse.ys.slice(0, 8));
  ok('记为鼠标绘制', afterMouse.type === 'mouse', afterMouse.type);
  ok('★ 同时也记了句子（笔迹+句子两条需求都满足）', afterMouse.notes >= 1, afterMouse.notes);

  // 画布真的被画上了东西
  const painted = await f.evaluate(() => {
    const el = document.getElementById('noteDrawLayer');
    const c = el.getContext('2d');
    const d = c.getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return { nonTransparent: n, total: d.length / 4 };
  });
  ok('★ ★ canvas 上真有像素（肉眼能看到笔迹）', painted.nonTransparent > 100, painted);

  // ---------- 三、触控笔 ----------
  group('三、触控笔绘制（压感/笔尖预测/倾斜角）');
  await f.evaluate(() => { STATE.notes = {}; renderNoteHighlights(); drawClearAll(); });
  await page.waitForTimeout(200);
  const box2 = await f.locator('#readingArea p[data-pi="1"]').boundingBox();
  if (box2) {
    const y2 = box2.y + box2.height / 2;
    // 笔尖预测：伪造 getCoalescedEvents 返回 6 个点
    await f.evaluate(([x0, yy]) => {
      window.__COALESCED = [];
      const area = document.getElementById('readingArea');
      const orig = PointerEvent.prototype.getCoalescedEvents;
      PointerEvent.prototype.getCoalescedEvents = function () {
        return (this.pointerType === 'pen' && window.__COALESCED.length)
          ? window.__COALESCED : (orig ? orig.call(this) : []);
      };
      window.__restoreCoalesced = () => { PointerEvent.prototype.getCoalescedEvents = orig; };
    }, [box2.x + 20, y2]);

    await penEvent(f, 'pointerdown', box2.x + 20, y2, 0.7, { tiltX: 6, tiltY: 4 });
    // 一次 move 里塞 6 个 coalesced 点，压感从 0.2 渐增到 1.0
    const w1 = box2.x + 20, w2 = box2.x + 200;
    await f.evaluate(([x0, yy]) => {
      window.__COALESCED = [];
      for (let i = 0; i < 6; i++) {
        window.__COALESCED.push({
          clientX: x0 + (i + 1) * 30, clientY: yy - 20 + i * 8,
          pressure: 0.2 + i * 0.16, tiltX: 6, tiltY: 4
        });
      }
    }, [w1, y2]);
    await penEvent(f, 'pointermove', w2, y2 - 20, 1.0, { tiltX: 30, tiltY: 20 });
    await penEvent(f, 'pointerup', w2, y2 - 20, 0, { tiltX: 30, tiltY: 20 });
  }
  await page.waitForTimeout(400);
  const afterPen = await f.evaluate(() => {
    const st = drawLoad();
    const s = st.strokes[0];
    return {
      strokes: st.strokes.length,
      pts: s ? s.pts.length : 0,
      type: s ? s.pointerType : null,
      pressures: s ? s.pts.map(p => p.p) : [],
      width: s ? s.width : 0,
      ratio: s ? s.ratio : null,
      notes: chapterNotes('m_t', 'c_t').length
    };
  });
  ok('★ 笔能直接画（不用开「✏️划线」开关）', afterPen.strokes === 1, afterPen);
  ok('★ ★ 记为 pen 设备', afterPen.type === 'pen', afterPen.type);
  ok('★ ★ 笔尖预测生效：一次 move 取到全部 6 个 coalesced 点（不止 1 个）', afterPen.pts >= 7, afterPen.pts);
  ok('★ ★ 每个点保留各自压感（不是都取最后一个）',
    new Set(afterPen.pressures).size > 2, afterPen.pressures.slice(0, 8));
  ok('★ 也记了句子', afterPen.notes >= 1, afterPen.notes);

  // ---------- 四、防手掌误触 ----------
  group('四、手掌遮挡防误触');
  await f.evaluate(() => { STATE.notes = {}; renderNoteHighlights(); drawClearAll(); });
  await page.waitForTimeout(150);
  const box3 = await f.locator('#readingArea p[data-pi="0"]').boundingBox();
  if (box3) {
    const y3 = box3.y + box3.height / 2;
    // 笔按住
    await penEvent(f, 'pointerdown', box3.x + 30, y3, 0.6, { pid: 7 });
    // 手掌（touch）在别处按下并移动
    const t1 = await touchEvent(f, 'pointerdown', box3.x + 250, y3 + 30, 99);
    await page.waitForTimeout(80);
    const blocked = await f.evaluate(() => ({
      penActive: typeof penIsActive === 'function' ? penIsActive() : null,
      blocks: typeof penBlocksTouch === 'function' ? penBlocksTouch() : null,
      down: _ND.down,
      pointerType: _ND.pointerType
    }));
    ok('★ 记录为笔活动', blocked.penActive === true, blocked);
    ok('★ ★ 笔活动时 touch 被判定为要屏蔽', blocked.blocks === true, blocked);
    ok('★ ★ 手掌的 touch 没进入划线状态（没抢走这一笔）',
      blocked.down === true && blocked.pointerType === 'pen', blocked);

    await touchEvent(f, 'pointermove', box3.x + 300, y3 + 60, 99);
    await page.waitForTimeout(80);
    const strokesMid = await f.evaluate(() => drawLoad().strokes.length);
    ok('★ ★ 手掌乱蹭没有产生第二条笔迹', strokesMid === 0, strokesMid);

    await penEvent(f, 'pointerup', box3.x + 30, y3, 0, { pid: 7 });
    await touchEvent(f, 'pointerup', box3.x + 300, y3 + 60, 99);
  }
  await page.waitForTimeout(300);
  const afterPalm = await f.evaluate(() => ({
    strokes: drawLoad().strokes.length,
    notes: chapterNotes('m_t', 'c_t').length
  }));
  ok('★ 笔那一笔正常入库', afterPalm.strokes === 1, afterPalm.strokes);
  ok('★ 笔迹挂到了笔记上', afterPalm.notes >= 1, afterPalm.notes);

  // ---------- 五、手指绘制仍然正常 ----------
  group('五、手指绘制（不能被笔支持搞坏）');
  await f.evaluate(() => { STATE.notes = {}; renderNoteHighlights(); drawClearAll(); });
  await page.waitForTimeout(1000);   // 等防误触缓冲期过
  const box4 = await f.locator('#readingArea p[data-pi="1"]').boundingBox();
  if (box4) {
    const y4 = box4.y + box4.height / 2;
    // 先开划线模式（手指需要）
    await f.evaluate(() => setNoteMode(true));
    await page.waitForTimeout(200);
    await touchEvent(f, 'pointerdown', box4.x + 20, y4, 100);
    for (let i = 1; i <= 4; i++) await touchEvent(f, 'pointermove', box4.x + 20 + i * 30, y4 - i * 5, 100);
    await touchEvent(f, 'pointerup', box4.x + 140, y4 - 20, 100);
  }
  await page.waitForTimeout(400);
  const afterTouch = await f.evaluate(() => ({
    strokes: drawLoad().strokes.length,
    notes: chapterNotes('m_t', 'c_t').length
  }));
  ok('★ 手指能画（没被笔支持挡掉）', afterTouch.strokes === 1, afterTouch.strokes);
  ok('★ 手指画线也记句子', afterTouch.notes >= 1, afterTouch.notes);
  await f.evaluate(() => setNoteMode(false));

  // ---------- 六、撤销 / 重做 ----------
  group('六、撤销 / 重做');
  const undoRedo = await f.evaluate(() => {
    const before = drawLoad().strokes.length;
    const u1 = drawUndo();
    const afterUndo = drawLoad().strokes.length;
    const r1 = drawRedo();
    const afterRedo = drawLoad().strokes.length;
    return { before, u1, afterUndo, r1, afterRedo };
  });
  ok('★ 撤销生效', undoRedo.u1 === true && undoRedo.afterUndo === undoRedo.before - 1, undoRedo);
  ok('★ 重做生效', undoRedo.r1 === true && undoRedo.afterRedo === undoRedo.before, undoRedo);

  // 快捷键
  await f.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
  await page.waitForTimeout(250);
  const afterKey = await f.evaluate(() => drawLoad().strokes.length);
  ok('★ Ctrl+Z 快捷键生效', afterKey === undoRedo.before - 1, afterKey);
  await f.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })));
  await page.waitForTimeout(250);
  const afterKey2 = await f.evaluate(() => drawLoad().strokes.length);
  ok('★ Ctrl+Y 快捷键生效', afterKey2 === undoRedo.before, afterKey2);

  // ---------- 七、刷新后笔迹还在 ----------
  group('七、刷新后笔迹还原');
  const beforeReload = await f.evaluate(() => ({
    strokes: drawLoad().strokes.length,
    pts: drawLoad().strokes.map(s => s.pts.length)
  }));
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  // 刷新后 iframe 会换新，旧的 f 引用全部失效，必须重新取一次
  const f2 = page.frames().find(fr => /index\.html/.test(fr.url()));
  if (!f2) { console.log('刷新后没找到帧'); await browser.close(); return; }
  await f2.waitForFunction(() => typeof STATE !== 'undefined' && typeof drawLoad === 'function', { timeout: 40000 });
  await f2.evaluate(([p1, p2]) => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.profileId = 'verify_draw';
    STATE.cloudReady = false;
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{ id: 'c_t', title: '测试', content: [p1, p2].join('\n\n'), targetWords: 10 }] };
    refreshLearn(true);
  }, [P1, P2]);
  await page.waitForTimeout(700);
  const afterReload = await f2.evaluate(() => {
    drawRepaint();
    const el = document.getElementById('noteDrawLayer');
    const c = el.getContext('2d');
    const d = c.getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return { strokes: drawLoad().strokes.length, painted: n };
  });
  ok('★ 刷新后笔迹还在', afterReload.strokes === beforeReload.strokes, [beforeReload.strokes, afterReload.strokes]);
  ok('★ 刷新后重绘到 canvas 上', afterReload.painted > 100, afterReload.painted);

  group('八、运行期异常');
  ok('★ 无未捕获异常', errors.length === 0, errors);

  const pass = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log('笔迹/触控笔浏览器验证：' + pass + '/' + results.length + ' 通过');
  const failed = results.filter(r => !r.pass);
  if (failed.length) { console.log('失败项：'); failed.forEach(r => console.log('  ✗ ' + r.name)); }
  await browser.close();
})();