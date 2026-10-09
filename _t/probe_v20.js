// 线上 v20 探针：确认新版本已生效、分布修复与底部导航都在线上产物里
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';
const ARTICLE = JSON.parse(require('fs').readFileSync('G:/英语学习工作台/_t/_article.json', 'utf-8'));

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load', timeout: 90000 });
  let f = null;
  for (let i = 0; i < 60 && !f; i++) {
    for (const x of p.frames()) {
      try { if (await x.evaluate(() => !!(window.STATE && typeof pickMatchesByStrategy === 'function'))) { f = x; break; } } catch (e) {}
    }
    if (!f) await p.waitForTimeout(800);
  }
  if (!f) { console.log('未找到应用帧'); await b.close(); process.exit(1); }

  const r = await f.evaluate(() => ({
    frameUrl: location.href,
    hasSmartPage: !!(window.__SMART_PAGE__ && window.__SMART_PAGE__.database),
    // 本轮新增函数
    algoVersion: typeof MATCH_ALGO_VERSION !== 'undefined' ? MATCH_ALGO_VERSION : null,
    matchSigFor: typeof matchSigFor,
    matchSigStale: typeof matchSigStale,
    matchSigGet: typeof matchSigGet,
    matchSigSet: typeof matchSigSet,
    purgeAutoMatches: typeof purgeAutoMatches,
    pushMatchesThrottled: typeof pushMatchesThrottled,
    runInBatches: typeof runInBatches,
    cloudBatch: typeof CLOUD_BATCH !== 'undefined' ? CLOUD_BATCH : null,
    matchDistHealth: typeof matchDistHealth,
    renderChapterNav: typeof renderChapterNav,
    clipChapterTitle: typeof clipChapterTitle,
    jumpChapter: typeof jumpChapter,
    // 上一轮的功能仍在（回归）
    openRescuePanel: typeof openRescuePanel,
    flushPendingDels: typeof flushPendingDels,
    restoreFailedLoads: typeof restoreFailedLoads,
    strategyName: typeof strategyName,
    builtinTotal: typeof BUILTIN_WB_TOTAL !== 'undefined' ? BUILTIN_WB_TOTAL : null,
    // 底部导航 DOM
    navBottom: !!document.getElementById('chapterNavBottom'),
    navPrevBtn: !!document.getElementById('navPrevBtn'),
    navNextBtn: !!document.getElementById('navNextBtn'),
    // 源码痕迹（防止「函数存在但没真的接上」）
    hasBaseOrder: /var baseOrder = \(function \(\) \{/.test(String(pickMatchesByStrategy)),
    hasStalePurge: /purgeAutoMatches/.test(String(regenerateMatches)),
    hasSigSet: /matchSigSet\(matId, chId/.test(String(regenerateMatches)),
    hasThrottlePush: /pushMatchesThrottled/.test(String(regenerateMatches)),
    hasSigGuard: /matchSigStale\(matId, ch, optsNow, poolLen\)/.test(String(renderLearnInit)),
    hasNavRender: /renderChapterNav\(\)/.test(String(refreshLearn)),
    hasResetScroll: /function refreshLearn\(resetScroll\)/.test(String(refreshLearn)),
    hasSkewTip: /标注偏集中/.test(String(refreshLearn)),
    navIsDisabledAtFirst: null
  }));
  r.pageErrors = errs.filter(e => !/ResizeObserver|net::/i.test(e));

  // 行为验证：离线注入一篇 18 段文章 + 老分布，看是否被自动重排（全程不写云端）
  const behavior = await f.evaluate((article) => {
    const keepCloud = STATE.cloudReady, keepPid = STATE.profileId;
    STATE.cloudReady = false;
    STATE.profileId = 'probe_v20';
    const chs = [
      { id: 'pc0', title: '第一章 祖母的教养方式', order: 0, content: article.join('\n\n'), targetWords: 30 },
      { id: 'pc1', title: '第二章 后半段', order: 1, content: article.join('\n\n'), targetWords: 30 }
    ];
    STATE.materials = [{ id: 'pm', title: '第一章 祖母的教养方式' }];
    STATE.chapters = { pm: chs };
    const old = [];
    let pid = 0;
    for (let k = 0; k < 40; k++) { if (pid > 5) pid = 0; old.push({ lemma: 'oldw' + k, chWord: '旧' + k, position: pid * 10000 + (k * 3 % 60), sentence: '', manual: false }); pid++; }
    STATE.matches = { pm: { pc0: old, pc1: [] } };
    // 线上未登录时 STATE.words 是空的（登录后才从云端拉），先把内置词书装上再验重算
    const wbAdded = installBuiltinWordbook();
    const poolSize = buildLearnWordPool().length;
    const bd = new Array(article.length).fill(0);
    old.forEach(m => { const q = Math.floor(m.position / 10000); if (q < bd.length) bd[q]++; });

    navTo('learn');
    const sigNow = !!matchSigGet('pm', 'pc0');     // 必须在恢复 profileId 之前读

    const after = STATE.matches.pm.pc0 || [];
    const ad = new Array(article.length).fill(0);
    after.forEach(m => { const q = Math.floor(m.position / 10000); if (q >= 0 && q < ad.length) ad[q]++; });

    // 底部导航行为
    STATE.learnMaterialId = 'pm'; STATE.learnChapterId = 'pc0';
    renderChapterNav();
    const firstPrevDisabled = document.getElementById('navPrevBtn').disabled;
    const firstNextText = document.getElementById('navNextBtn').textContent.trim();
    jumpChapter(1, true);
    const afterJump = { id: STATE.learnChapterId, scrollTop: document.getElementById('readingArea').scrollTop };
    const secondPrevDisabled = document.getElementById('navPrevBtn').disabled;
    const lastProg = document.getElementById('chNavProgressBottom').textContent;

    STATE.cloudReady = keepCloud; STATE.profileId = keepPid;
    return {
      wbAdded: wbAdded,
      poolSize: poolSize,
      beforeDist: bd.join('/'),
      beforeBlank: bd.filter(x => x === 0).length,
      afterDist: ad.join('/'),
      afterBlank: ad.filter(x => x === 0).length,
      afterTotal: ad.reduce((a, b) => a + b, 0),
      sigWritten: sigNow,
      firstPrevDisabled: firstPrevDisabled,
      firstNextText: firstNextText,
      afterJump: afterJump,
      secondPrevDisabled: secondPrevDisabled,
      lastProg: lastProg
    };
  }, ARTICLE);

  // 页面没有报错的兜底：检查底部导航在真实 DOM 中位置正确
  const domChk = await f.evaluate(() => {
    const nav = document.getElementById('chapterNavBottom');
    const area = document.getElementById('readingArea');
    if (!nav || !area) return { ok: false };
    const cmp = area.compareDocumentPosition(nav);
    return { ok: true, after: !!(cmp & Node.DOCUMENT_POSITION_FOLLOWING) };
  });

  console.log(JSON.stringify(r, null, 2));
  console.log('--- 行为验证 ---');
  console.log(JSON.stringify(behavior, null, 2));
  console.log('--- DOM 位置 ---');
  console.log(JSON.stringify(domChk));
  await b.close();
})();
