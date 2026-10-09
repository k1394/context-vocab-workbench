// 平板性能实测 3：找出滚动卡顿的真正来源（A/B 对照）+ 量化滚动时的存盘成本
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8955/index.html';
function line(k, v) { console.log('  ' + k.padEnd(38, ' ') + ' ' + v); }

async function scrollBench(page, label) {
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
    return { n: frames.length, p50: q(0.5), p95: q(0.95), max: +Math.max(...frames).toFixed(1), ltCount: lt.length, ltSum: lt.reduce((a, b) => a + b, 0) };
  });
  console.log('\n【' + label + '】');
  line('帧间隔 中位 / 95分位 / 最长', r.p50 + ' / ' + r.p95 + ' / ' + r.max + ' ms');
  line('长任务(>50ms) 次数 / 总计', r.ltCount + ' 次 / ' + r.ltSum + ' ms');
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

  // 造一份「接近真实体量」的数据：3 本资料 × 30 章 × 40 段 × 80 字 ≈ 28.8 万字
  const scale = await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false; STATE.profileId = 'perf3';

    const para = '夜幕低垂，鬼火狐鸣，凉飕飕的冷风一直往山洞里灌。他缓缓站起身来，望向洞外那片被月色泡得发白的大漠，风沙一层叠一层地铺开，像是谁把整条黄河都倒在了这荒原上，远处的山脊黑沉沉地压着天边。';
    const mkCh = (i) => {
      const ps = []; for (let k = 0; k < 40; k++) ps.push(para);
      return { id: 'c' + i, title: '第' + (i + 1) + '章', content: ps.join('\n\n'), targetWords: 60 };
    };
    const chapters = {}, matches = {}, materials = [];
    for (let m = 0; m < 3; m++) {
      const mid = 'm' + m;
      materials.push({ id: mid, title: '资料' + m, kind: 'novel', createdAt: '2026-01-01T00:00:00Z' });
      chapters[mid] = []; matches[mid] = {};
      for (let c = 0; c < 30; c++) {
        chapters[mid].push(mkCh(c));
        const arr = [];
        for (let p = 0; p < 40; p++) for (let k = 0; k < 3; k++) {
          arr.push({ lemma: 'ambition', chWord: '冷风', position: p * 10000 + k * 6, sense: 'n. 野心，抱负；雄心' });
        }
        matches[mid]['c' + c] = arr;
      }
    }
    const words = []; for (let i = 0; i < 7000; i++) words.push({ id: 'w' + i, wordbookId: 'wb1', lemma: 'word' + i, meaning: '释义' + i });
    STATE.materials = materials; STATE.chapters = chapters; STATE.matches = matches; STATE.words = words;
    STATE.learnMaterialId = 'm0'; STATE.learnChapterId = 'c0'; STATE.learnMode = 'meaning';
    STATE.learnOpts = { showWord: true, showIpa: true, showMeaning: true };
    STATE.progress = {}; STATE.sessions = []; STATE.mastery = {}; STATE.vocab = {}; STATE.synonyms = {};
    STATE.answers = {}; STATE.reviewQueue = []; STATE.notes = {}; STATE.wordbooks = [];

    // 各 key 的 JSON 体积
    const keys = { materials: STATE.materials, wordbooks: [], words: STATE.words, chapters: STATE.chapters, matches: STATE.matches, progress: STATE.progress, notes: STATE.notes, answers: STATE.answers };
    const sizes = {};
    let total = 0;
    Object.keys(keys).forEach(k => { const s = JSON.stringify(keys[k]); const b = new Blob([s]).size; sizes[k] = +(b / 1048576).toFixed(2); total += b; });
    sizes.__totalMB = +(total / 1048576).toFixed(2);

    // saveLocal 真实耗时
    const t = performance.now();
    saveLocal();
    const saveMs = +(performance.now() - t).toFixed(1);

    // 真实 localStorage 占用
    let used = 0;
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += (k.length + (localStorage.getItem(k) || '').length) * 2; }

    return { sizes, saveMs, lsUsedMB: +(used / 1048576).toFixed(2), lsKeys: localStorage.length, saveFailed: !!window.LS && !!LS.saveFailed };
  });

  console.log('一、滚动时被反复写盘的数据有多大（3 本资料 / 90 章 / 约 29 万字 / 7000 词）');
  Object.keys(scale.sizes).forEach(k => { if (k !== '__totalMB') line('  ' + k + '.json', scale.sizes[k] + ' MB'); });
  line('合计（一次 saveLocal 要序列化）', scale.sizes.__totalMB + ' MB');
  line('saveLocal() 单次耗时', scale.saveMs + ' ms  ← 滚动停顿 400ms 就调一次');
  line('localStorage 实际占用', scale.lsUsedMB + ' MB（共 ' + scale.lsKeys + ' 个 key）');
  line('是否已触发配额失败', scale.saveFailed ? '★ 是（LS.saveFailed）' : '否');
  line('浏览器 localStorage 上限', '约 5 MB —— ' + (scale.lsUsedMB > 4 ? '★ 逼近上限' : '未逼近'));

  // 渲染这一章后再滚
  await page.evaluate(() => { refreshLearn(true); });
  await page.waitForTimeout(1500);

  // A/B 对照：谁在制造卡顿
  const canvas0 = await page.evaluate(() => { const c = document.querySelector('canvas'); return c ? { w: c.width, h: c.height, memMB: +(c.width * c.height * 4 / 1048576).toFixed(1) } : null; });
  console.log('\n二、滚动卡顿 A/B 对照（画布现状 ' + (canvas0 ? canvas0.w + '×' + canvas0.h + '，' + canvas0.memMB + ' MB' : '无') + '）');

  const r1 = await scrollBench(page, 'A 现状：画布在 + 每帧 getBoundingClientRect');

  // B：摘掉画布层
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (c) { c.width = 1; c.height = 1; c.style.display = 'none'; }
  });
  const r2 = await scrollBench(page, 'B 摘掉笔迹画布层（其他不变）');

  // C：再把每帧的强制布局掐掉（isReadingVisible 直接返回 true）
  await page.evaluate(() => { window.__origIRV = window.isReadingVisible; window.isReadingVisible = function () { return true; }; });
  const r3 = await scrollBench(page, 'C 画布摘掉 + 不再每帧量布局');

  // D：恢复画布，但掐掉布局读数
  await page.evaluate(() => { const c = document.querySelector('canvas'); if (c) c.style.display = ''; window.isReadingVisible = function () { return true; }; });
  const r4 = await scrollBench(page, 'D 画布恢复 + 不量布局（看是不是画布本身）');

  console.log('\n三、结论指向');
  const better = (x, y) => ((y.ltSum < x.ltSum * 0.6 && x.ltSum > 0) ? '★ 明显改善' : (y.ltSum <= x.ltSum ? '略好' : '无改善'));
  line('摘画布 vs 现状', better(r1, r2) + '（卡顿总量 ' + r1.ltSum + ' → ' + r2.ltSum + ' ms）');
  line('掐布局 vs 现状', better(r1, r3) + '（卡顿总量 ' + r1.ltSum + ' → ' + r3.ltSum + ' ms）');
  line('只掐布局(留画布) vs 现状', better(r1, r4) + '（' + r1.ltSum + ' → ' + r4.ltSum + ' ms）');

  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
