// 线上 v21 探针：跳章回到新章开头 + 「每章目标」全书统一
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
      try { if (await x.evaluate(() => !!(window.STATE && typeof scrollToChapterStart === 'function'))) { f = x; break; } } catch (e) { }
    }
    if (!f) await p.waitForTimeout(800);
  }
  if (!f) { console.log('未找到应用帧'); await b.close(); process.exit(1); }

  console.log('[1] 版本与函数就位');
  const ver = await f.evaluate(() => ({
    frameUrl: location.href,
    hasSmartPage: !!(window.__SMART_PAGE__ && window.__SMART_PAGE__.database),
    scrollToChapterStart: typeof scrollToChapterStart,
    learnScrollAnchor: typeof learnScrollAnchor,
    normTargetWords: typeof normTargetWords,
    targetWordsUniform: typeof targetWordsUniform,
    applyTargetToCurrentChapter: typeof applyTargetToCurrentChapter,
    applyTargetToAllChapters: typeof applyTargetToAllChapters,
    unifyTargetWords: typeof unifyTargetWords,
    offlineHint: typeof offlineHint,
    showConfirm: typeof showConfirm,
    // 上一轮功能回归
    openRescuePanel: typeof openRescuePanel,
    jumpChapter: typeof jumpChapter,
    renderChapterNav: typeof renderChapterNav,
    matchSigFor: typeof matchSigFor,
    builtinTotal: typeof BUILTIN_WB_TOTAL !== 'undefined' ? BUILTIN_WB_TOTAL : null,
    showConfirmArity: showConfirm.length,
    // 源码痕迹
    traceResetScroll: /if \(resetScroll\) \{\s*scrollToChapterStart\(\);/.test(String(refreshLearn)),
    traceJumpTrue: /refreshLearn\(true\);/.test(String(jumpChapter)),
    traceConfirmCancel: /cancelBtn\.onclick/.test(String(showConfirm)),
    traceTwUnify: /applyTargetToAllChapters\(v\)/.test(String(onTargetWordsChange)),
    traceUniform: /targetWordsUniform\(STATE\.learnMaterialId\)/.test(String(refreshLearn)),
    traceSyncChapter: /syncChapterToCloud\(matId, ch\)/.test(String(applyTargetToCurrentChapter))
  }));
  console.log(JSON.stringify(ver, null, 2));

  console.log('\n[2] 注入 3 章长文并进学习页');
  const prep = await f.evaluate((article) => {
    const keep = { c: STATE.cloudReady, p: STATE.profileId };
    STATE.cloudReady = false;
    STATE.profileId = 'probe_v21';
    const wb = (typeof installBuiltinWordbook === 'function') ? installBuiltinWordbook() : null;
    const mk = (i, tw) => ({
      id: 'vc' + i, title: ['第一章 祖母的教养方式', '第二章 少年时代', '第三章 离家'][i],
      order: i, content: article.join('\n\n'), targetWords: tw, generated: false
    });
    STATE.materials = [{ id: 'vm', title: '第一章 祖母的教养方式' }];
    STATE.chapters = { vm: [mk(0, 30), mk(1, 10), mk(2, 10)] };
    STATE.matches = { vm: { vc0: [], vc1: [], vc2: [] } };
    STATE.learnMaterialId = 'vm';
    STATE.learnChapterId = 'vc0';
    // 线上未登录时显示的是登录页，主应用被隐藏 —— 探针里手动激活，
    // 否则 section 不可见、readingArea 高度为 0，量不到真实滚动
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.display = 'block';
    const auth = document.getElementById('authScreen');
    if (auth) auth.style.display = 'none';
    navTo('learn');
    return { wbAdded: wb, pool: buildLearnWordPool().length, words: STATE.words.length };
  }, ARTICLE);
  await p.waitForTimeout(1500);
  console.log(JSON.stringify(prep, null, 2));

  const rendered = await f.evaluate(() => {
    const area = document.getElementById('readingArea');
    return {
      areaH: Math.round(area.getBoundingClientRect().height),
      paragraphs: area.querySelectorAll('p').length,
      matches: (STATE.matches.vm && STATE.matches.vm.vc0 || []).length,
      docH: document.documentElement.scrollHeight,
      winH: window.innerHeight,
      frameScrollable: document.documentElement.scrollHeight > window.innerHeight + 2
    };
  });
  console.log('    正文渲染：' + JSON.stringify(rendered));

  console.log('\n[3] 滚到帧内底部，点底部「下一章」');
  const beforeJump = await f.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return { y: window.pageYOffset, max: document.documentElement.scrollHeight - window.innerHeight };
  });
  console.log('    跳转前帧内 pageYOffset = ' + beforeJump.y + '（可滚上限 ' + beforeJump.max + '）');
  await f.evaluate(() => document.getElementById('navNextBtn').click());
  await p.waitForTimeout(600);
  const afterJump = await f.evaluate(() => {
    const nav = document.querySelector('.chapter-nav:not(.chapter-nav-bottom)');
    const firstP = document.getElementById('readingArea').querySelector('p');
    return {
      ch: STATE.learnChapterId,
      y: window.pageYOffset,
      navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
      firstPTop: firstP ? Math.round(firstP.getBoundingClientRect().top) : null,
      title: document.getElementById('chNavTitleBottom').textContent
    };
  });
  console.log('    跳转后：' + JSON.stringify(afterJump));
  console.log('    ' + (afterJump.ch === 'vc1' ? '✓' : '✗') + ' 切到第二章');
  console.log('    ' + (afterJump.y < beforeJump.y ? '✓' : '✗') + ' 帧内滚动位置回到上方（' + beforeJump.y + ' → ' + afterJump.y + '）');
  console.log('    ' + (Math.abs(afterJump.navTop) <= 60 ? '✓' : '✗') + ' 章节导航条被顶到视口顶部附近（' + afterJump.navTop + '）');
  console.log('    ' + (afterJump.firstPTop > 0 && afterJump.firstPTop < 900 ? '✓' : '✗') + ' 新章正文首段在视口内（' + afterJump.firstPTop + '）');

  console.log('\n[4] 顶部「下一章」同样回文首');
  await f.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(200);
  const b4 = await f.evaluate(() => window.pageYOffset);
  await f.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.chapter-nav:not(.chapter-nav-bottom) button'));
    const n = btns.find(x => x.textContent.indexOf('下一章') >= 0);
    if (n) n.click();
  });
  await p.waitForTimeout(600);
  const a4 = await f.evaluate(() => ({
    ch: STATE.learnChapterId, y: window.pageYOffset,
    navTop: Math.round(document.querySelector('.chapter-nav:not(.chapter-nav-bottom)').getBoundingClientRect().top)
  }));
  console.log('    ' + (a4.ch === 'vc2' ? '✓' : '✗') + ' 切到第三章；滚动 ' + b4 + ' → ' + a4.y
    + '；导航条在视口 y=' + a4.navTop + ' ' + (a4.y < b4 && Math.abs(a4.navTop) <= 60 ? '✓' : '✗'));

  console.log('\n[5] 信息条「一键统一」入口');
  await f.evaluate(() => { STATE.learnChapterId = 'vc0'; refreshLearn(true); });
  await p.waitForTimeout(400);
  const hint = await f.evaluate(() => {
    const el = document.getElementById('matchInfo');
    const a = el.querySelector('a');
    return { text: el.textContent.slice(-90), hasLink: !!a, link: a ? a.textContent : '' };
  });
  console.log('    ' + (hint.hasLink ? '✓' : '✗') + ' 出现一键统一链接：「' + hint.link + '」');
  await f.evaluate(() => document.querySelector('#matchInfo a').click());
  await p.waitForTimeout(600);
  const uni = await f.evaluate(() => STATE.chapters.vm.map(c => c.targetWords));
  console.log('    ' + (uni.join(',') === '30,30,30' ? '✓' : '✗') + ' 一键统一后三章目标词 = ' + uni.join(','));

  console.log('\n[6] 改「每章目标」→ 确认框 → 确定 = 全书统一');
  await f.evaluate(() => {
    const el = document.getElementById('targetWordsInput');
    el.value = '50';
    el.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(400);
  const cs = await f.evaluate(() => ({
    shown: document.getElementById('confirmModal').classList.contains('show'),
    title: document.getElementById('confirmTitle').textContent,
    msg: document.getElementById('confirmMsg').textContent
  }));
  console.log('    ' + (cs.shown ? '✓' : '✗') + ' 确认框弹出：' + cs.title);
  console.log('      正文：' + cs.msg.slice(0, 110));
  await f.evaluate(() => document.getElementById('confirmOkBtn').click());
  await p.waitForTimeout(800);
  const okRes = await f.evaluate(() => STATE.chapters.vm.map(c => c.targetWords));
  console.log('    ' + (okRes.join(',') === '50,50,50' ? '✓' : '✗') + ' 点确定后 = ' + okRes.join(','));

  console.log('\n[7] 改「每章目标」→ 取消 = 只改当前章');
  await f.evaluate(() => {
    const el = document.getElementById('targetWordsInput');
    el.value = '20';
    el.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(400);
  await f.evaluate(() => document.querySelector('#confirmModal .modal-actions .btn-outline').click());
  await p.waitForTimeout(800);
  const cancelRes = await f.evaluate(() => STATE.chapters.vm.map(c => c.targetWords));
  console.log('    ' + (cancelRes.join(',') === '20,50,50' ? '✓' : '✗') + ' 点取消后 = ' + cancelRes.join(',')
    + '（只有第一章变 20）');

  console.log('\n[8] 页面无 JS 报错');
  const real = errs.filter(e => !/ResizeObserver|Failed to load resource|net::/i.test(e));
  console.log('    ' + (real.length === 0 ? '✓ 没有未捕获异常' : '✗ ' + JSON.stringify(real.slice(0, 3))));

  await f.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(200);
  await f.evaluate(() => document.getElementById('navNextBtn').click());
  await p.waitForTimeout(700);
  await p.screenshot({ path: 'G:/英语学习工作台/_shot_online_jump.png' });
  await b.close();
})();
