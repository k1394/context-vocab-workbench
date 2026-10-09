// 浏览器端集成验证：跳章回到新章开头 + 「每章目标」全书统一
// 关键：这次真的测 window 滚动位置（旧的 area.scrollTop 断言恒为 0，测不出问题）
const { chromium } = require('playwright');
const fs = require('fs');
const PORT = process.env.PORT || 8933;
const BASE = 'http://127.0.0.1:' + PORT;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
const ARTICLE = JSON.parse(fs.readFileSync('G:/英语学习工作台/_t/_article.json', 'utf-8'));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ nick: 'CHTGT', profileId: 'p_ch' }));
    localStorage.setItem('ctx_vocab_users', JSON.stringify([{ nick: 'CHTGT', profileId: 'p_ch' }]));
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && STATE.wordbooks && STATE.wordbooks.length > 0, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log('\n[1] 新函数是否都在全局作用域（跨 <script> 块）');
  const fns = await page.evaluate(() => ({
    scrollToChapterStart: typeof scrollToChapterStart, learnScrollAnchor: typeof learnScrollAnchor,
    normTargetWords: typeof normTargetWords, targetWordsUniform: typeof targetWordsUniform,
    applyTargetToCurrentChapter: typeof applyTargetToCurrentChapter,
    applyTargetToAllChapters: typeof applyTargetToAllChapters,
    unifyTargetWords: typeof unifyTargetWords, offlineHint: typeof offlineHint,
    showConfirm: typeof showConfirm, onTargetWordsChange: typeof onTargetWordsChange
  }));
  const want = ['scrollToChapterStart', 'learnScrollAnchor', 'normTargetWords', 'targetWordsUniform',
    'applyTargetToCurrentChapter', 'applyTargetToAllChapters', 'unifyTargetWords', 'offlineHint'];
  const miss = want.filter(k => fns[k] !== 'function');
  ok('8 个新增/改动函数全部就位', miss.length === 0, miss);

  console.log('\n[2] 准备：3 章长文（每章 18 段），滚到页面底部');
  await page.evaluate((article) => {
    STATE.cloudReady = false;                 // 离线跑，不写云端
    STATE.profileId = 'p_ch';
    const mk = (i, tw) => ({
      id: 'kc' + i, title: ['第一章 祖母的教养方式', '第二章 少年时代', '第三章 离家'][i],
      order: i, content: article.join('\n\n'), targetWords: tw, generated: false
    });
    STATE.materials = [{ id: 'm_ch', title: '第一章 祖母的教养方式' }];
    STATE.chapters = { m_ch: [mk(0, 30), mk(1, 10), mk(2, 10)] };
    STATE.matches = { m_ch: { kc0: [], kc1: [], kc2: [] } };
    STATE.learnMaterialId = 'm_ch';
    STATE.learnChapterId = 'kc0';
    STATE.learnOpts = STATE.learnOpts || {};
  }, ARTICLE);

  await page.evaluate(() => navTo('learn'));
  await page.waitForTimeout(1200);

  const geom = await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    const area = document.getElementById('readingArea');
    return {
      docH: document.documentElement.scrollHeight,
      winH: window.innerHeight,
      y: window.pageYOffset,
      areaTopDoc: area.getBoundingClientRect().top + window.pageYOffset,
      areaScrollTop: area.scrollTop,
      areaOverflow: getComputedStyle(area).overflowY,
      areaScrollable: area.scrollHeight > area.clientHeight + 2
    };
  });
  console.log('    文档高 ' + geom.docH + ' / 视口 ' + geom.winH + ' / 当前 pageYOffset ' + geom.y);
  ok('正文区本身不可滚动（overflow=' + geom.areaOverflow + '），所以旧代码的 area.scrollTop=0 是空操作',
    geom.areaScrollable === false, geom);
  ok('页面确实能滚动（测试前提成立）', geom.y > 500, geom.y);

  console.log('\n[3] 点底部「下一章」→ 必须滚到第二章开头');
  await page.evaluate(() => document.getElementById('navNextBtn').click());
  await page.waitForTimeout(500);
  const afterNext = await page.evaluate(() => {
    const area = document.getElementById('readingArea');
    const nav = document.querySelector('.chapter-nav:not(.chapter-nav-bottom)');
    const firstP = area.querySelector('p');
    return {
      chapterId: STATE.learnChapterId,
      y: window.pageYOffset,
      areaViewportTop: Math.round(area.getBoundingClientRect().top),
      navViewportTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
      firstPViewportTop: firstP ? Math.round(firstP.getBoundingClientRect().top) : null,
      firstPText: firstP ? firstP.textContent.slice(0, 24) : '',
      titleBottom: document.getElementById('chNavTitleBottom').textContent,
      winH: window.innerHeight
    };
  });
  console.log('    跳转后 pageYOffset=' + afterNext.y + '，章节导航条在视口 y=' + afterNext.navViewportTop
    + '，正文首段在视口 y=' + afterNext.firstPViewportTop);
  ok('确实切到了第二章', afterNext.chapterId === 'kc1', afterNext.chapterId);
  ok('★ 页面从底部滚回来了（pageYOffset 大幅下降，从 ' + geom.y + ' 降到 ' + afterNext.y + '）',
    afterNext.y < geom.y - 500, { before: geom.y, after: afterNext.y });
  ok('★ 顶部章节导航条被滚到视口顶部附近（|top| ≤ 60）',
    Math.abs(afterNext.navViewportTop) <= 60, afterNext.navViewportTop);
  ok('★ 正文首段落在视口内（能看到新章开头，0 < top < 视口高）',
    afterNext.firstPViewportTop > 0 && afterNext.firstPViewportTop < afterNext.winH, afterNext.firstPViewportTop);
  ok('新章标题正确', afterNext.titleBottom.indexOf('第二章') >= 0, afterNext.titleBottom);

  console.log('\n[4] 顶部「下一章」也要回文首（与底部一致）');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(150);
  const beforeTopClick = await page.evaluate(() => window.pageYOffset);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.chapter-nav:not(.chapter-nav-bottom) button'));
    const next = btns.find(b => b.textContent.indexOf('下一章') >= 0);
    next.click();
  });
  await page.waitForTimeout(500);
  const afterTopClick = await page.evaluate(() => ({
    chapterId: STATE.learnChapterId,
    y: window.pageYOffset,
    navTop: Math.round(document.querySelector('.chapter-nav:not(.chapter-nav-bottom)').getBoundingClientRect().top)
  }));
  ok('顶部导航切到第三章', afterTopClick.chapterId === 'kc2', afterTopClick.chapterId);
  ok('★ 顶部导航同样把页面滚回新章开头（' + beforeTopClick + ' → ' + afterTopClick.y + '）',
    afterTopClick.y < beforeTopClick - 500, { before: beforeTopClick, after: afterTopClick.y });
  ok('★ 顶部导航条顶到视口顶部附近', Math.abs(afterTopClick.navTop) <= 60, afterTopClick.navTop);

  console.log('\n[5] 末章禁用 / 首章禁用不受影响');
  const edges = await page.evaluate(() => ({
    nextDisabled: document.getElementById('navNextBtn').disabled,
    prevDisabled: document.getElementById('navPrevBtn').disabled
  }));
  ok('末章：下一章禁用', edges.nextDisabled === true);
  ok('末章：上一章可用', edges.prevDisabled === false);

  console.log('\n[6] 信息条：各章目标词不一致 → 出现「一键统一」入口');
  await page.evaluate(() => { STATE.learnChapterId = 'kc0'; refreshLearn(true); });
  await page.waitForTimeout(400);
  const hint0 = await page.evaluate(() => {
    const el = document.getElementById('matchInfo');
    const a = el.querySelector('a');
    return { text: el.textContent, hasLink: !!a, linkText: a ? a.textContent : '' };
  });
  ok('检测到不一致并给出提示', hint0.text.indexOf('每章目标') >= 0 && hint0.text.indexOf('不一致') >= 0, hint0.text.slice(0, 120));
  ok('提示里有可点击的「一键统一」链接', hint0.hasLink === true, hint0.linkText);

  // 点它 → 以本章（30 词）为准拉平
  await page.evaluate(() => document.querySelector('#matchInfo a').click());
  await page.waitForTimeout(600);
  const unified = await page.evaluate(() => ({
    tws: STATE.chapters.m_ch.map(c => c.targetWords),
    hintText: document.getElementById('matchInfo').textContent,
    toast: (document.querySelector('.toast') || {}).textContent || ''
  }));
  ok('★ 一键统一后三章目标词全变成 30', unified.tws.join(',') === '30,30,30', unified.tws);
  ok('统一后提示消失（不再说不一致）', unified.hintText.indexOf('不一致') < 0, unified.hintText.slice(0, 80));
  ok('统一结果有 toast 反馈', unified.toast.indexOf('统一') >= 0, unified.toast);

  console.log('\n[7] 改「每章目标」→ 弹确认 → 点确定 = 全书统一');
  await page.evaluate(() => { STATE.learnChapterId = 'kc0'; refreshLearn(true); });
  await page.waitForTimeout(300);
  await page.fill('#targetWordsInput', '50');
  await page.evaluate(() => {
    const el = document.getElementById('targetWordsInput');
    el.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  const cs = await page.evaluate(() => ({
    shown: document.getElementById('confirmModal').classList.contains('show'),
    title: document.getElementById('confirmTitle').textContent,
    msg: document.getElementById('confirmMsg').textContent
  }));
  ok('确认框弹了出来', cs.shown === true);
  ok('标题带上了新数值 50', cs.title.indexOf('50') >= 0, cs.title);
  ok('正文说明了「确认=全部 3 章」与「取消=只改当前章」',
    cs.msg.indexOf('全部 3 章') >= 0 && cs.msg.indexOf('只改当前章') >= 0, cs.msg);

  await page.evaluate(() => document.getElementById('confirmOkBtn').click());
  await page.waitForTimeout(700);
  const afterOk = await page.evaluate(() => ({
    tws: STATE.chapters.m_ch.map(c => c.targetWords),
    inputVal: document.getElementById('targetWordsInput').value,
    modalShown: document.getElementById('confirmModal').classList.contains('show')
  }));
  ok('★ 点确定后三章全部变成 50', afterOk.tws.join(',') === '50,50,50', afterOk.tws);
  ok('弹窗已关闭', afterOk.modalShown === false);
  ok('输入框显示 50', afterOk.inputVal === '50', afterOk.inputVal);

  console.log('\n[8] 改「每章目标」→ 点取消 = 只改当前章');
  await page.fill('#targetWordsInput', '20');
  await page.evaluate(() => {
    const el = document.getElementById('targetWordsInput');
    el.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#confirmModal .modal-actions .btn-outline').click());
  await page.waitForTimeout(700);
  const afterCancel = await page.evaluate(() => STATE.chapters.m_ch.map(c => c.targetWords));
  ok('★ 点取消只把当前章（第一章）改成 20', afterCancel[0] === 20, afterCancel);
  ok('★ 其余章保持 50，没有被误改', afterCancel[1] === 50 && afterCancel[2] === 50, afterCancel);

  console.log('\n[9] 改完刷新界面不丢值（关键：值写进了章节对象）');
  const persist = await page.evaluate(() => {
    STATE.learnChapterId = 'kc1';
    refreshLearn(true);
    return { inputValue: document.getElementById('targetWordsInput').value, tw: STATE.chapters.m_ch[1].targetWords };
  });
  ok('切到第二章，输入框显示该章自己的值 50', persist.inputValue === '50', persist);
  await page.evaluate(() => { STATE.learnChapterId = 'kc0'; refreshLearn(true); });
  await page.waitForTimeout(300);
  const back2first = await page.evaluate(() => document.getElementById('targetWordsInput').value);
  ok('切回第一章仍显示 20（各章值互不干扰）', back2first === '20', back2first);

  console.log('\n[10] 页面无 JS 报错');
  const realErrs = errors.filter(e => !/ResizeObserver|Failed to load resource|net::/i.test(e));
  ok('没有未捕获异常', realErrs.length === 0, realErrs.slice(0, 3));

  // 截图：跳章后停在第二章开头
  await page.evaluate(() => { STATE.learnChapterId = 'kc0'; refreshLearn(true); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('navNextBtn').click());
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'G:/英语学习工作台/_shot_jump_top.png' });

  // 截图：确认框
  await page.fill('#targetWordsInput', '50');
  await page.evaluate(() => document.getElementById('targetWordsInput').dispatchEvent(new Event('change')));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'G:/英语学习工作台/_shot_target_confirm.png' });
  await page.evaluate(() => document.querySelector('#confirmModal .modal-actions .btn-outline').click());
  await browser.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(56));
  console.log('浏览器端集成验证：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(56));
  process.exit(failed.length ? 1 : 0);
})();
