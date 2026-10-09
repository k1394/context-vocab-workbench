// 平板性能实测 4：细分根因 —— 是「整页大的画布层」还是「每次滚动清整块画布」
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8955/index.html';
function line(k, v) { console.log('  ' + k.padEnd(40, ' ') + ' ' + v); }

async function bench(page, label) {
  const r = await page.evaluate(async () => {
    const de = document.documentElement;
    const frames = []; let last = performance.now(); let raf;
    const tick = t => { frames.push(t - last); last = t; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    let lt = [];
    try { const o = new PerformanceObserver(l => l.getEntries().forEach(e => lt.push(Math.round(e.duration)))); o.observe({ entryTypes: ['longtask'] }); } catch (e) { }
    await new Promise(res => { let i = 0; const s = () => { de.scrollTop += 200; i++; i < 60 ? setTimeout(s, 16) : res(); }; s(); });
    await new Promise(r => setTimeout(r, 400));
    cancelAnimationFrame(raf);
    frames.sort((a, b) => a - b);
    const q = p => +(frames[Math.min(frames.length - 1, Math.floor(frames.length * p))] || 0).toFixed(1);
    const c = document.querySelector('canvas');
    return { p95: q(0.95), max: +Math.max(...frames).toFixed(1), ltCount: lt.length, ltSum: lt.reduce((a, b) => a + b, 0), cw: c ? c.width : 0, ch: c ? c.height : 0 };
  });
  console.log('\n【' + label + '】  画布 ' + r.cw + '×' + r.ch);
  line('帧间隔 95分位 / 最长', r.p95 + ' / ' + r.max + ' ms');
  line('长任务次数 / 总计', r.ltCount + ' 次 / ' + r.ltSum + ' ms');
  return r;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 120000 });

  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false; STATE.profileId = 'perf4';
    const para = '夜幕低垂，鬼火狐鸣，凉飕飕的冷风一直往山洞里灌。他缓缓站起身来，望向洞外那片被月色泡得发白的大漠，风沙一层叠一层地铺开，像是谁把整条黄河都倒在了这荒原上，远处的山脊黑沉沉地压着天边。';
    const ps = []; for (let k = 0; k < 80; k++) ps.push(para);
    const ms = []; for (let p = 0; p < 80; p++) ms.push({ lemma: 'ambition', chWord: '冷风', position: p * 10000 + 6, sense: 'n. 野心' });
    STATE.learnMaterialId = 'm4'; STATE.learnChapterId = 'c4'; STATE.learnMode = 'meaning';
    STATE.chapters = { m4: [{ id: 'c4', title: 'x', content: ps.join('\n\n'), targetWords: 80 }] };
    STATE.matches = { m4: { c4: ms } };
    STATE.progress = { m4: { c4: { scrollPct: 0, mode: 'meaning' } } };
    STATE.notes = {}; STATE.settings = Object.assign({}, STATE.settings || {}, { showWord: true, showIpa: true, showMeaning: true });
    STATE.words = []; STATE.materials = [{ id: 'm4', title: 'x', kind: 'novel' }];
    refreshLearn(true);
  });
  await page.waitForTimeout(1500);

  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log('章节正文长度：80 段 × 约 90 字，文档高度 ' + docH + ' px（逻辑像素）\n');
  console.log('对照组设计：拿同一段滚动，只改「画布大小」和「每次滚动要不要清整块画布」');

  // A 现状：画布铺满整页 + scroll 里 drawRepaint
  await page.evaluate(() => {
    if (typeof drawEnsureLayer === 'function') drawEnsureLayer();
    if (typeof drawResizeLayer === 'function') drawResizeLayer();
  });
  const A = await bench(page, 'A 现状：画布 = 整页高度，每次滚动 clearRect 整块');

  // B 画布仍然铺满整页，但滚动时不再重绘
  await page.evaluate(() => {
    window.__repaint = window.drawRepaint;
    window.drawRepaint = function () { };
  });
  const B = await bench(page, 'B 画布仍铺满整页，但滚动不重绘');

  // C 画布缩成 1×1（不再铺满），恢复滚动重绘
  await page.evaluate(() => {
    window.drawRepaint = window.__repaint;
    const c = document.querySelector('canvas');
    if (c) { c.width = 2; c.height = 2; c.style.width = '2px'; c.style.height = '2px'; }
  });
  const C = await bench(page, 'C 画布缩成 2×2，其余不变（滚动仍重绘）');

  // D 完全移除画布
  await page.evaluate(() => { const c = document.querySelector('canvas'); if (c) c.remove(); });
  const D = await bench(page, 'D 完全移除画布元素');

  // E 恢复「整页大画布」但只滚一半屏幕，看是不是越滚越卡
  await page.evaluate(() => {
    if (typeof drawEnsureLayer === 'function') drawEnsureLayer();
    if (typeof drawResizeLayer === 'function') drawResizeLayer();
  });
  const E = await bench(page, 'E 重新铺满整页的大画布（复现确认）');

  console.log('\n总结');
  line('A 整页大画布 + 每帧重绘', A.ltSum + ' ms 卡顿');
  line('B 整页大画布 + 不重绘', B.ltSum + ' ms 卡顿  ← 说明是否出在 compositing 层');
  line('C 小画布 + 每帧重绘', C.ltSum + ' ms 卡顿');
  line('D 无画布', D.ltSum + ' ms 卡顿');
  line('E 复现 A', E.ltSum + ' ms 卡顿');

  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
