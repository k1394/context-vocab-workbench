// 平板性能实测 2：按平板级 CPU（降频 6 倍）+ WiFi 网络模拟，量真实的加载与滚动代价
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8955/index.html';
function line(k, v) { console.log('  ' + k.padEnd(36, ' ') + ' ' + v); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 768 },   // iPad 横屏逻辑尺寸
    deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  // 平板级 CPU：约等于 A14/A15 单核面对桌面 i7 的差距
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  // 家用 WiFi：10 Mbps + 40ms 延迟
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 40, downloadThroughput: 10 * 1024 * 1024 / 8, uploadThroughput: 3 * 1024 * 1024 / 8,
  });

  console.log('模拟条件：CPU 降频 6 倍（平板级）+ WiFi 10Mbps / 40ms 延迟 + 1024×768 逻辑分辨率 + 2x 像素密度\n');

  // ---------- 一、加载 ----------
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  await page.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 120000 });
  const readyMs = Date.now() - t0;
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {};
    return { dcl: Math.round(n.domContentLoadedEventEnd || 0), dt: Math.round(n.domInteractive || 0), load: Math.round(n.loadEventEnd || 0) };
  });

  console.log('一、打开页面的耗时（这是用户感受到的"卡"的第一层）');
  line('DOM 可交互 (domInteractive)', nav.dt + ' ms');
  line('DOM 解析完成 (DCL)', nav.dcl + ' ms');
  line('load 事件', nav.load + ' ms');
  line('脚本可用 / 能点', readyMs + ' ms  ← 超过 1 秒就是在等');
  line('其中：下载 2.4MB 单文件', '约 ' + Math.round(2446046 * 8 / (10 * 1024 * 1024) * 1000) + ' ms 起（10Mbps 理想值，实际更久）');

  // ---------- 二、渲染真实章节（带词标注） ----------
  const renderInfo = await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false; STATE.profileId = 'perf2';

    const base = '夜幕低垂，鬼火狐鸣，凉飕飕的冷风一直往山洞里灌。他缓缓站起身来，望向洞外那片被月色泡得发白的大漠，风沙一层叠一层地铺开，像是谁把整条黄河都倒在了这荒原上。';
    const paras = [];
    for (let i = 0; i < 60; i++) paras.push(base);
    // 每段 3 个词标注，共 180 个 —— 和真实章节里目标词的密度相当
    const matches = [];
    for (let i = 0; i < 60; i++) {
      ['冷风', '山洞', '大漠'].forEach((w, k) => {
        matches.push({ lemma: 'ambition', chWord: w, position: i * 10000 + k * 4, sense: 'n. 野心，抱负' });
      });
    }
    STATE.learnMaterialId = 'm_p2'; STATE.learnChapterId = 'c_p2'; STATE.learnMode = 'meaning';
    STATE.chapters = { m_p2: [{ id: 'c_p2', title: '性能测试章', content: paras.join('\n\n'), targetWords: 180 }] };
    STATE.matches = { m_p2: { c_p2: matches } };
    STATE.progress = { m_p2: { c_p2: { scrollPct: 0, mode: 'meaning' } } };
    STATE.notes = {}; STATE.settings = Object.assign({}, STATE.settings || {}, { showWord: true, showIpa: true, showMeaning: true });

    const t = performance.now();
    refreshLearn(true);
    const renderMs = Math.round(performance.now() - t);
    return { renderMs };
  });
  await page.waitForTimeout(1500);

  const dom = await page.evaluate(() => {
    const area = document.getElementById('readingArea');
    const de = document.documentElement;
    const c = document.querySelector('canvas');
    return {
      all: document.getElementsByTagName('*').length,
      inArea: area ? area.getElementsByTagName('*').length : 0,
      sent: area ? area.querySelectorAll('.sent').length : 0,
      wordZh: area ? area.querySelectorAll('.word-zh').length : 0,
      gloss: area ? area.querySelectorAll('[data-gloss]').length : 0,
      marks: area ? area.querySelectorAll('mark').length : 0,
      docH: de.scrollHeight,
      canvas: c ? { w: c.width, h: c.height, memMB: +(c.width * c.height * 4 / 1048576).toFixed(1) } : null,
      heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  });

  console.log('\n二、一个 60 段 / 180 个词标注的章节（降频后）');
  line('渲染一次耗时', renderInfo.renderMs + ' ms');
  line('整页 DOM 节点数', dom.all.toLocaleString());
  line('正文区节点数', dom.inArea.toLocaleString());
  line('  · 句子 span .sent', dom.sent);
  line('  · 中文词 span .word-zh', dom.wordZh);
  line('  · 括号释义 span [data-gloss]', dom.gloss);
  line('文档总高度', dom.docH + ' px');
  if (dom.canvas) {
    const px = dom.canvas.w * dom.canvas.h;
    line('笔迹画布尺寸', dom.canvas.w + ' × ' + dom.canvas.h + ' px');
    line('  画布像素总量', px.toLocaleString() + ' px');
    line('  位图内存', dom.canvas.memMB + ' MB');
    line('  iOS Safari 画布上限', '16,777,216 px → ' + (px > 16777216 ? '★ 已超出！' : '未超'));
  }
  line('JS 堆', dom.heap + ' MB');

  // ---------- 三、滚动时到底干了多少事 ----------
  const scrollCost = await page.evaluate(async () => {
    const de = document.documentElement;
    // 3.1 纯滚动，量帧间隔
    const frames = []; let last = performance.now(); let raf;
    const tick = t => { frames.push(t - last); last = t; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);

    // 3.2 统计滚动事件里触发的强制布局
    let gbcr = 0; const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { gbcr++; return orig.apply(this, arguments); };

    let longTasks = [];
    try {
      const o = new PerformanceObserver(l => l.getEntries().forEach(e => longTasks.push(Math.round(e.duration))));
      o.observe({ entryTypes: ['longtask'] });
    } catch (e) { }

    await new Promise(res => { let i = 0; const step = () => { de.scrollTop += 200; i++; i < 50 ? setTimeout(step, 16) : res(); }; step(); });
    await new Promise(r => setTimeout(r, 500));
    cancelAnimationFrame(raf);
    Element.prototype.getBoundingClientRect = orig;
    frames.sort((a, b) => a - b);
    const q = p => +(frames[Math.min(frames.length - 1, Math.floor(frames.length * p))] || 0).toFixed(1);

    // 3.3 单独量 drawRepaint()（滚动监听里每帧都调它）耗时
    let repaintMs = null;
    try {
      if (typeof drawRepaint === 'function') {
        const t = performance.now();
        for (let i = 0; i < 10; i++) drawRepaint();
        repaintMs = +((performance.now() - t) / 10).toFixed(2);
      }
    } catch (e) { }

    // 3.4 量 saveScrollPos（滚动监听里 debounce 400ms 调一次）
    let saveMs = null;
    try {
      if (typeof saveScrollPos === 'function') {
        const t = performance.now();
        for (let i = 0; i < 5; i++) { STATE.progress['m_p2']['c_p2'].scrollPct = i; saveScrollPos(); }
        saveMs = +((performance.now() - t) / 5).toFixed(2);
      }
    } catch (e) { }

    return { n: frames.length, p50: q(0.5), p95: q(0.95), max: +(Math.max(...frames)).toFixed(1), gbcr, longTasks: longTasks.slice(0, 8), repaintMs, saveMs };
  });

  console.log('\n三、滚动时的实测代价（降频 6 倍后）');
  line('帧间隔 中位数', scrollCost.p50 + ' ms（60fps = 16.7）');
  line('帧间隔 95 分位', scrollCost.p95 + ' ms');
  line('最长一帧', scrollCost.max + ' ms');
  line('长任务 >50ms', scrollCost.longTasks.length ? scrollCost.longTasks.join(', ') + ' ms' : '无');
  line('滚动中强制同步布局次数', scrollCost.gbcr + ' 次（每次都会打断滚动）');
  line('drawRepaint() 单次耗时', scrollCost.repaintMs !== null ? scrollCost.repaintMs + ' ms ← 每个滚动事件都调一次' : '未测到');
  line('saveScrollPos() 单次耗时', scrollCost.saveMs !== null ? scrollCost.saveMs + ' ms' : '未测到');

  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
