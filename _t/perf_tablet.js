// 平板性能实测：加载成本 / DOM 规模 / 画布内存 / 滚动卡顿来源
// 用 iPad 尺寸 + deviceScaleFactor=2 模拟平板
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8955/index.html';

function line(k, v) { console.log('  ' + k.padEnd(34, ' ') + ' ' + v); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  // ---------- 一、加载成本 ----------
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  await page.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 60000 });
  const readyMs = Date.now() - t0;

  console.log('一、加载成本（平板尺寸 + 2x 像素密度）');
  line('页面文件大小', '2.4 MB（单文件）');
  line('load 事件耗时(本地)', loadMs + ' ms');
  line('脚本可用(STATE 就绪)', readyMs + ' ms');

  const res = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const sc = Array.from(document.querySelectorAll('script'));
    let inline = 0, srcCount = 0;
    sc.forEach(s => { if (!s.src) inline += (s.textContent || '').length; else srcCount++; });
    const st = Array.from(document.querySelectorAll('style'));
    let css = 0;
    st.forEach(s => css += (s.textContent || '').length);
    return {
      domInteractive: nav.domInteractive, domComplete: nav.domComplete,
      dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd,
      transfer: nav.transferSize, encoded: nav.encodedBodySize,
      inlineScriptChars: inline, srcScripts: srcCount, cssChars: css,
      heap: performance.memory ? performance.memory.usedJSHeapSize : null,
      total: performance.memory ? performance.memory.totalJSHeapSize : null,
    };
  });
  line('navigation transferSize', res.transfer + ' B (本地无压缩口径)');
  line('内联 script 总量', (res.inlineScriptChars / 1024).toFixed(0) + ' KB，外链 script ' + res.srcScripts + ' 个');
  line('内联 CSS 总量', (res.cssChars / 1024).toFixed(0) + ' KB');
  line('JS 堆占用(初始)', res.heap ? (res.heap / 1048576).toFixed(1) + ' MB' : 'n/a');

  // ---------- 二、渲染一个真实长度章节 ----------
  // 造 60 段、每段约 90 字的章节（接近真实章节量级），并在其中嵌 60 个词标注
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false;
    STATE.profileId = 'perf_probe';
  });

  const renderTiming = await page.evaluate(() => {
    const base = '夜幕低垂，鬼火狐鸣，凉飕飕的冷风一直往山洞里灌。他缓缓站起身来，望向洞外那片被月色泡得发白的大漠，风沙一层叠一层地铺开，像是谁把整条黄河都倒在了这荒原上。';
    const paras = [];
    for (let i = 0; i < 60; i++) paras.push(base);
    const content = paras.join('\n\n');
    // 造词匹配：每段 1 个词，共 60 个 → 走完整标注渲染路径
    const matches = [];
    for (let i = 0; i < 60; i++) {
      matches.push({ pi: i, lemma: 'ambition', chWord: '野心', position: i % 3, sense: 'n. 野心，抱负' });
    }
    STATE.learnMaterialId = 'm_perf';
    STATE.learnChapterId = 'c_perf';
    STATE.learnMode = 'both';
    STATE.chapters = { m_perf: [{ id: 'c_perf', title: '性能测试章', content: content, targetWords: 60 }] };
    STATE.matches = { m_perf: { c_perf: matches } };
    STATE.progress = { m_perf: { c_perf: { scrollPct: 0, mode: 'both' } } };
    STATE.notes = {};
    const t = performance.now();
    refreshLearn(true);
    const t1 = performance.now();
    return { renderMs: Math.round(t1 - t) };
  });

  await page.waitForTimeout(1200);

  const domInfo = await page.evaluate(() => {
    const area = document.getElementById('readingArea');
    const all = document.getElementsByTagName('*').length;
    const inArea = area ? area.getElementsByTagName('*').length : 0;
    const canvas = document.getElementById('drawLayer') || document.querySelector('canvas[id*="draw"],canvas');
    const cInfo = canvas ? {
      id: canvas.id, w: canvas.width, h: canvas.height,
      cssW: canvas.style.width, cssH: canvas.style.height,
      memMB: +(canvas.width * canvas.height * 4 / 1048576).toFixed(1),
    } : null;
    const de = document.documentElement;
    return {
      all, inArea,
      sentSpans: area ? area.querySelectorAll('.sent').length : 0,
      wordSpans: area ? area.querySelectorAll('.word-zh').length : 0,
      insSpans: area ? area.querySelectorAll('.word-ins').length : 0,
      glossSpans: area ? area.querySelectorAll('[data-gloss]').length : 0,
      docHeight: de.scrollHeight,
      canvas: cInfo,
      heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  });

  console.log('\n二、一个 60 段章节渲染后的规模');
  line('渲染耗时', renderTiming.renderMs + ' ms');
  line('整页 DOM 节点数', domInfo.all.toLocaleString() + ' 个');
  line('正文区节点数', domInfo.inArea.toLocaleString() + ' 个');
  line('  · 句子 span (.sent)', domInfo.sentSpans.toLocaleString());
  line('  · 中文词 span (.word-zh)', domInfo.wordSpans.toLocaleString());
  line('  · 释义 span (.word-ins)', domInfo.insSpans.toLocaleString());
  line('  · 插入物 span (data-gloss)', domInfo.glossSpans.toLocaleString());
  line('文档总高度', domInfo.docHeight + ' px');
  if (domInfo.canvas) {
    line('笔迹画布 canvas', domInfo.canvas.w + '×' + domInfo.canvas.h + ' px  (CSS ' + domInfo.canvas.cssW + '×' + domInfo.canvas.cssH + ')');
    line('  画布位图内存', domInfo.canvas.memMB + ' MB');
  } else {
    line('笔迹画布 canvas', '未挂载（需先画一笔/开笔迹层）');
  }
  line('JS 堆占用(渲染后)', domInfo.heap + ' MB');

  // ---------- 三、滚动卡顿来源 ----------
  // 装 longtask 观察器，然后真实滚 3 屏
  const scrollPerf = await page.evaluate(async () => {
    const tasks = [];
    let obs = null;
    try {
      obs = new PerformanceObserver(l => { l.getEntries().forEach(e => tasks.push(e.duration)); });
      obs.observe({ entryTypes: ['longtask'] });
    } catch (e) { }

    // 统计滚动监听里的强制布局次数
    let layoutCount = 0;
    const origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { layoutCount++; return origRect.apply(this, arguments); };

    const frames = [];
    let last = performance.now();
    let raf = 0;
    function tick(t) { frames.push(t - last); last = t; raf = requestAnimationFrame(tick); }
    raf = requestAnimationFrame(tick);

    const scroller = document.scrollingElement || document.documentElement;
    await new Promise(res => {
      let i = 0;
      const step = () => {
        scroller.scrollTop += 260;
        i++;
        if (i < 40) setTimeout(step, 16); else res();
      };
      step();
    });
    await new Promise(r => setTimeout(r, 600));
    cancelAnimationFrame(raf);
    Element.prototype.getBoundingClientRect = origRect;

    frames.sort((a, b) => a - b);
    const p = q => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] || 0;
    return {
      frameCount: frames.length,
      p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), max: +Math.max(...frames).toFixed(1),
      longTasks: tasks.length,
      longTaskTotal: +tasks.reduce((a, b) => a + b, 0).toFixed(0),
      layoutCount,
      scrollTop: scroller.scrollTop,
    };
  });

  console.log('\n三、滚动 40 帧期间的实测（关键）');
  line('帧间隔 中位数', scrollPerf.p50 + ' ms  (60fps 应为 16.7)');
  line('帧间隔 95 分位', scrollPerf.p95 + ' ms');
  line('最长一帧', scrollPerf.max + ' ms');
  line('长任务(>50ms) 次数', scrollPerf.longTasks + ' 次，合计 ' + scrollPerf.longTaskTotal + ' ms');
  line('滚动中 getBoundingClientRect', scrollPerf.layoutCount + ' 次 ← 每次都会强制同步布局');
  line('实际滚动距离', scrollPerf.scrollTop + ' px');

  // ---------- 四、画布代价：画一笔后再滚 ----------
  const afterInk = await page.evaluate(() => {
    try {
      if (typeof drawEnsureLayer === 'function') drawEnsureLayer();
      if (typeof drawResizeLayer === 'function') drawResizeLayer();
    } catch (e) { return { err: String(e) }; }
    const c = document.getElementById('drawLayer') || document.querySelector('canvas');
    if (!c) return { err: 'no canvas' };
    return { w: c.width, h: c.height, memMB: +(c.width * c.height * 4 / 1048576).toFixed(1) };
  });
  console.log('\n四、笔迹层开启后');
  if (afterInk.err) line('画布', afterInk.err);
  else {
    line('画布尺寸', afterInk.w + '×' + afterInk.h);
    line('位图内存', afterInk.memMB + ' MB  ← 平板显存/内存实打实占用');
  }

  console.log('\n五、页面报错');
  line('运行时报错', errors.length ? errors.slice(0, 3).join(' | ') : '无');

  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
