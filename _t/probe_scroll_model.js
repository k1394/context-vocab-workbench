// 线上滚动模型探测：确认线上页面里「谁在滚动」
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';
const ARTICLE = JSON.parse(require('fs').readFileSync('G:/英语学习工作台/_t/_article.json', 'utf-8'));

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(URL, { waitUntil: 'load', timeout: 90000 });
  let f = null;
  for (let i = 0; i < 60 && !f; i++) {
    for (const x of p.frames()) {
      try { if (await x.evaluate(() => !!(window.STATE && typeof scrollToChapterStart === 'function'))) { f = x; break; } } catch (e) { }
    }
    if (!f) await p.waitForTimeout(800);
  }
  if (!f) { console.log('未找到应用帧'); await b.close(); process.exit(1); }

  console.log('=== 外层页面（www.workbuddy.link）===');
  const outer = await p.evaluate(() => ({
    href: location.href,
    docH: document.documentElement.scrollHeight,
    winH: window.innerHeight,
    scrollable: document.documentElement.scrollHeight > window.innerHeight + 2,
    y: window.pageYOffset,
    iframes: Array.from(document.querySelectorAll('iframe')).map(x => ({
      id: x.id, cls: x.className, h: x.getBoundingClientRect().height,
      scroll: x.getAttribute('scrolling'), style: (x.getAttribute('style') || '').slice(0, 160)
    }))
  }));
  console.log(JSON.stringify(outer, null, 2));

  console.log('\n=== 帧内 ===');
  const inner0 = await f.evaluate(() => ({
    href: location.href,
    docH: document.documentElement.scrollHeight,
    bodyH: document.body ? document.body.scrollHeight : null,
    winH: window.innerHeight,
    y: window.pageYOffset,
    scrollable: document.documentElement.scrollHeight > window.innerHeight + 2
  }));
  console.log(JSON.stringify(inner0, null, 2));

  console.log('\n=== 帧内试滚 window.scrollTo(0, 800) ===');
  await f.evaluate(() => window.scrollTo(0, 800));
  await p.waitForTimeout(200);
  const innerAfterScroll = await f.evaluate(() => window.pageYOffset);
  const outerAfterInnerScroll = await p.evaluate(() => window.pageYOffset);
  console.log('帧内 pageYOffset =', innerAfterScroll, ' 外层 pageYOffset =', outerAfterInnerScroll);

  console.log('\n=== 进学习页后，用 scrollIntoView 测能否带动外层 ===');
  const setup = await f.evaluate((article) => {
    const keep = { c: STATE.cloudReady, p: STATE.profileId };
    STATE.cloudReady = false;
    STATE.profileId = 'probe_scroll';
    STATE.materials = [{ id: 'sm', title: '第一章 祖母的教养方式' }];
    STATE.chapters = { sm: [
      { id: 'sc0', title: '第一章 祖母的教养方式', order: 0, content: article.join('\n\n'), targetWords: 30 },
      { id: 'sc1', title: '第二章 少年时代', order: 1, content: article.join('\n\n'), targetWords: 30 }
    ] };
    STATE.matches = { sm: { sc0: [], sc1: [] } };
    STATE.learnMaterialId = 'sm';
    STATE.learnChapterId = 'sc0';
    try { installBuiltinWordbook(); } catch (e) {}
    navTo('learn');
    STATE.cloudReady = keep.c; STATE.profileId = keep.p;
    return {
      docH: document.documentElement.scrollHeight,
      winH: window.innerHeight,
      scrollable: document.documentElement.scrollHeight > window.innerHeight + 2,
      areaH: document.getElementById('readingArea').getBoundingClientRect().height
    };
  }, ARTICLE);
  console.log(JSON.stringify(setup, null, 2));

  // 外层先滚到很下面（模拟用户看完一章）
  await p.evaluate(() => window.scrollTo(0, 2000));
  await p.waitForTimeout(200);
  const before = { outer: await p.evaluate(() => window.pageYOffset), inner: await f.evaluate(() => window.pageYOffset) };
  console.log('\n滚之前：外层 y=', before.outer, ' 帧内 y=', before.inner);

  const afterIntoView = await f.evaluate(() => {
    const nav = document.querySelector('.chapter-nav:not(.chapter-nav--bottom)');
    const anchor = document.getElementById('readingArea');
    try { anchor.scrollIntoView({ block: 'start', inline: 'nearest' }); } catch (e) { return { err: String(e) }; }
    return { innerY: window.pageYOffset, areaRectTop: Math.round(anchor.getBoundingClientRect().top) };
  });
  await p.waitForTimeout(400);
  const afterOuter = await p.evaluate(() => window.pageYOffset);
  console.log('scrollIntoView 之后：帧内 y=', afterIntoView.innerY, ' 外层 y=', afterOuter,
    ' 正文区在帧内视口 y=', afterIntoView.areaRectTop);
  console.log(afterOuter < before.outer - 200 ? '→ scrollIntoView 带动了外层滚动 ✓' : '→ scrollIntoView 没能带动外层 ✗');

  // 再看真实按钮点击的效果
  await p.evaluate(() => window.scrollTo(0, 2000));
  await p.waitForTimeout(200);
  const beforeClick = await p.evaluate(() => window.pageYOffset);
  await f.evaluate(() => { document.getElementById('navNextBtn').click(); });
  await p.waitForTimeout(600);
  const afterClick = {
    outer: await p.evaluate(() => window.pageYOffset),
    inner: await f.evaluate(() => window.pageYOffset),
    ch: await f.evaluate(() => STATE.learnChapterId),
    navTopInner: await f.evaluate(() => Math.round(document.querySelector('.chapter-nav:not(.chapter-nav-bottom)').getBoundingClientRect().top))
  };
  console.log('\n点「下一章」：外层 y ' + beforeClick + ' → ' + afterClick.outer
    + '，帧内 y=' + afterClick.inner + '，章节导航条在帧内视口 y=' + afterClick.navTopInner
    + '，当前章=' + afterClick.ch);
  await b.close();
})();
