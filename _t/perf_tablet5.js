// 平板性能实测 5：修复后复测（同一台机、同一个浏览器会话里做前后对照）
//   A 新版现状（画布只盖一屏 + 滚动重绘合并到一帧 + 视口外剔除）
//   B 模拟旧版（把画布拉回整章高，且每个 scroll 事件都清整块 —— 旧版那个要命动作）
//   C 新版 + 手动关掉笔迹层（给用户的临时办法，验证它确实等于 0 卡顿）
// 另外顺带量「pdf.js 三件套惰性化」对首屏主线程的收益。
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8931;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
function line(k, v) { console.log('  ' + String(k).padEnd(38, ' ') + ' ' + v); }

async function bench(page, label) {
  const r = await page.evaluate(async () => {
    const de = document.documentElement;
    de.scrollTop = 0;
    await new Promise(r => setTimeout(r, 60));
    const frames = []; let last = performance.now(); let raf;
    const tick = t => { frames.push(t - last); last = t; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    let lt = [];
    try {
      const o = new PerformanceObserver(l => l.getEntries().forEach(e => lt.push(Math.round(e.duration))));
      o.observe({ entryTypes: ['longtask'] });
    } catch (e) { }
    await new Promise(res => { let i = 0; const s = () => { de.scrollTop += 200; i++; i < 60 ? setTimeout(s, 16) : res(); }; s(); });
    await new Promise(r => setTimeout(r, 400));
    cancelAnimationFrame(raf);
    frames.sort((a, b) => a - b);
    const q = p => +(frames[Math.min(frames.length - 1, Math.floor(frames.length * p))] || 0).toFixed(1);
    const c = document.querySelector('canvas');
    return {
      p50: q(0.5), p95: q(0.95), max: +Math.max(...frames).toFixed(1),
      ltCount: lt.length, ltSum: lt.reduce((a, b) => a + b, 0),
      cw: c ? c.width : 0, ch: c ? c.height : 0,
      memMB: c ? +(c.width * c.height * 4 / 1048576).toFixed(1) : 0
    };
  });
  console.log('\n【' + label + '】  画布 ' + r.cw + '×' + r.ch + '（' + r.memMB + ' MB 位图）');
  line('帧间隔 中位 / 95分位 / 最长', r.p50 + ' / ' + r.p95 + ' / ' + r.max + ' ms');
  line('长任务(>50ms) 次数 / 合计', r.ltCount + ' 次 / ' + r.ltSum + ' ms');
  return r;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });   // 降频 6 倍 ≈ 平板

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 120000 });
  const readyMs = Date.now() - t0;

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {};
    const sc = Array.from(document.querySelectorAll('script'));
    let eager = 0, lazy = 0, lazyIds = [];
    sc.forEach(s => {
      if (s.type === 'text/plain') { lazy += (s.textContent || '').length; lazyIds.push(s.id + ':' + Math.round((s.textContent || '').length / 1024) + 'KB'); }
      else eager += (s.textContent || '').length;
    });
    return {
      domInteractive: n.domInteractive, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd,
      eagerKB: Math.round(eager / 1024), lazyKB: Math.round(lazy / 1024), lazyIds: lazyIds,
      libLoaded: typeof pdfjsLib,
      docH: document.documentElement.scrollHeight
    };
  });

  console.log('一、首屏（降频 6 倍 + 平板尺寸 1024×768@2x）');
  line('STATE 就绪耗时', readyMs + ' ms');
  line('domInteractive / DCL / load', nav.domInteractive + ' / ' + nav.dcl + ' / ' + nav.load + ' ms');
  line('首屏要编译的内联 JS', nav.eagerKB + ' KB');
  line('惰性块（不当 JS 编译）', nav.lazyKB + ' KB  ' + JSON.stringify(nav.lazyIds));
  line('首屏 pdfjsLib 是否已加载', nav.libLoaded === 'undefined' ? '否（按需加载生效）' : '是');

  // 造一个 80 段的真实长度章节（和之前那次实测同一份数据，保证可比）
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false; STATE.profileId = 'perf5';
    const para = '夜幕低垂，鬼火狐鸣，凉飕飕的冷风一直往山洞里灌。他缓缓站起身来，望向洞外那片被月色泡得发白的大漠，风沙一层叠一层地铺开，像是谁把整条黄河都倒在了这荒原上，远处的山脊黑沉沉地压着天边。';
    const ps = []; for (let k = 0; k < 80; k++) ps.push(para);
    const ms = []; for (let p = 0; p < 80; p++) ms.push({ lemma: 'ambition', chWord: '冷风', position: p * 10000 + 6, sense: 'n. 野心' });
    STATE.learnMaterialId = 'm5'; STATE.learnChapterId = 'c5'; STATE.learnMode = 'meaning';
    STATE.chapters = { m5: [{ id: 'c5', title: 'x', content: ps.join('\n\n'), targetWords: 80 }] };
    STATE.matches = { m5: { c5: ms } };
    STATE.progress = { m5: { c5: { scrollPct: 0, mode: 'meaning' } } };
    STATE.notes = {}; STATE.settings = Object.assign({}, STATE.settings || {}, { showWord: true, showIpa: true, showMeaning: true });
    STATE.words = []; STATE.materials = [{ id: 'm5', title: 'x', kind: 'novel' }];
    const t = performance.now();
    refreshLearn(true);
    window.__renderMs = Math.round(performance.now() - t);
  });
  await page.waitForTimeout(1800);   // 分帧渲染铺完

  const info = await page.evaluate(() => ({
    renderMs: window.__renderMs,
    docH: document.documentElement.scrollHeight,
    canvas: (function () { const c = document.querySelector('canvas'); return c ? { w: c.width, h: c.height } : null; })(),
    cssH: (function () { const c = document.querySelector('canvas'); return c ? c.style.height : null; })(),
    gloss: document.querySelectorAll('[data-gloss]').length
  }));
  console.log('\n二、一个 80 段章节（文档高 ' + info.docH + ' px）');
  line('refreshLearn 同步耗时', info.renderMs + ' ms  （分帧后同步段，其余帧内铺完）');
  line('笔迹画布（新版）', info.canvas ? info.canvas.w + '×' + info.canvas.h + '  CSS 高 ' + info.cssH : '未挂载');

  const A = await bench(page, 'A 新版现状：画布只盖一屏 + 滚动重绘合并一帧 + 视口外剔除');

  // 模拟旧版：把画布拉回整章高，且每个 scroll 事件都清整块（旧版那个要命动作）
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const dpr = window.devicePixelRatio || 1;
    const de = document.documentElement;
    c.width = Math.round(de.clientWidth * dpr);
    c.height = Math.round(de.scrollHeight * dpr);
    c.style.width = de.clientWidth + 'px';
    c.style.height = de.scrollHeight + 'px';
    const cx = c.getContext('2d');
    window.__oldHandler = function () {
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.clearRect(0, 0, c.width, c.height);      // ← 整块清空巨型画布
    };
    window.addEventListener('scroll', window.__oldHandler, { passive: true });
  });
  const B = await bench(page, 'B 模拟旧版：画布 = 整章高，每个滚动事件清整块');

  await page.evaluate(() => {
    window.removeEventListener('scroll', window.__oldHandler);
    const c = document.querySelector('canvas');
    if (c) { c.width = 2; c.height = 2; }
    if (typeof drawResizeLayer === 'function') drawResizeLayer();   // 回到新版尺寸
    if (typeof drawToggleShow === 'function') drawToggleShow(false);
  });
  const C = await bench(page, 'C 新版 + 关掉笔迹层（用户临时办法）');

  console.log('\n三、结论（同一会话、同一段滚动）');
  line('新版（A）', A.ltCount + ' 次长任务 / 卡 ' + A.ltSum + ' ms');
  line('旧版形态（B）', B.ltCount + ' 次长任务 / 卡 ' + B.ltSum + ' ms');
  line('关掉笔迹层（C）', C.ltCount + ' 次长任务 / 卡 ' + C.ltSum + ' ms');
  line('笔迹画布面积', '旧 ' + (B.cw * B.ch / 1e6).toFixed(1) + ' M px  →  新 ' + (A.cw * A.ch / 1e6).toFixed(1) + ' M px');
  line('iPad 单画布上限 16.77 M px', '旧 ' + (B.cw * B.ch > 16777216 ? '超限 ' + (B.cw * B.ch / 16777216).toFixed(1) + ' 倍' : 'OK') + '  →  新 ' + (A.cw * A.ch > 16777216 ? '超限' : 'OK'));

  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
