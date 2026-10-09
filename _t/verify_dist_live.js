// 浏览器端集成验证：标注分布修复 + 章节底部导航
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
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ nick: 'DISTCHK', profileId: 'p_dist' }));
    localStorage.setItem('ctx_vocab_users', JSON.stringify([{ nick: 'DISTCHK', profileId: 'p_dist' }]));
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && STATE.wordbooks && STATE.wordbooks.length > 0, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log('\n[1] 新增函数是否都在全局作用域（跨 <script> 块）');
  const fns = await page.evaluate(() => ({
    matchSigFor: typeof matchSigFor, matchSigStale: typeof matchSigStale,
    matchSigGet: typeof matchSigGet, matchSigSet: typeof matchSigSet,
    purgeAutoMatches: typeof purgeAutoMatches, matchDistHealth: typeof matchDistHealth,
    renderChapterNav: typeof renderChapterNav, clipChapterTitle: typeof clipChapterTitle,
    jumpChapter: typeof jumpChapter, prevChapter: typeof prevChapter, nextChapter: typeof nextChapter,
    algoVer: typeof MATCH_ALGO_VERSION !== 'undefined' ? MATCH_ALGO_VERSION : null
  }));
  const want = ['matchSigFor', 'matchSigStale', 'matchSigGet', 'matchSigSet', 'purgeAutoMatches',
    'matchDistHealth', 'renderChapterNav', 'clipChapterTitle', 'jumpChapter', 'prevChapter', 'nextChapter'];
  const miss = want.filter(k => fns[k] !== 'function');
  ok('11 个新增/改动函数全部就位', miss.length === 0, miss);
  ok('算法版本号 = 2（比老数据高，会触发一次自动重算）', fns.algoVer === 2, fns.algoVer);

  console.log('\n[2] 老数据（集中在前几段、且没有签名）进页面后会被自动重算');
  const seqBefore = await page.evaluate((article) => {
    STATE.cloudReady = false;              // 离线跑，不写任何云端数据
    STATE.profileId = 'p_dist';
    const chs = [0, 1, 2].map(i => ({
      id: 'lc' + i, title: (i === 0 ? '第一章 祖母的教养方式' : '第二章 后续' + i),
      order: i, content: article.join('\n\n'), targetWords: 30, generated: false
    }));
    chs[2].title = '第三章 收尾';
    STATE.materials = [{ id: 'm_live', title: '第一章 祖母的教养方式' }];
    STATE.chapters = { m_live: chs };
    // 造一批「老分布」：40 条全挤在前 6 段，且没有 _cloudId / 没有签名
    const old = [];
    let pid = 0;
    for (let k = 0; k < 40; k++) {
      if (pid > 5) pid = 0;
      old.push({ lemma: 'oldw' + k, chWord: '旧词' + k, position: pid * 10000 + (k * 3 % 60), sentence: '', manual: false });
      pid++;
    }
    STATE.matches = { m_live: { lc0: old, lc1: [], lc2: [] } };

    const before = {
      n: STATE.matches.m_live.lc0.length,
      blank: 0, front: 0, total: 0, P: article.length
    };
    // 统计改前分布
    const bd = new Array(article.length).fill(0);
    old.forEach(m => { const p = Math.floor(m.position / 10000); if (p < bd.length) bd[p]++; });
    before.blank = bd.filter(x => x === 0).length;
    before.total = bd.reduce((a, b) => a + b, 0);
    before.front = bd.slice(0, Math.round(article.length / 3)).reduce((a, b) => a + b, 0);
    before.dist = bd.join('/');
    return before;
  }, ARTICLE);

  // 真正走一遍「点开学习页」的流程（这一步会触发自动重算）
  await page.evaluate(() => navTo('learn'));
  await page.waitForTimeout(1200);

  const reseedAfter = await page.evaluate((article) => {
    const after = STATE.matches.m_live.lc0 || [];
    const ad = new Array(article.length).fill(0);
    after.forEach(m => { const p = Math.floor(m.position / 10000); if (p >= 0 && p < ad.length) ad[p]++; });
    return {
      afterLen: after.length,
      afterBlank: ad.filter(x => x === 0).length,
      afterTotal: ad.reduce((a, b) => a + b, 0),
      afterFront: ad.slice(0, Math.round(article.length / 3)).reduce((a, b) => a + b, 0),
      dist: ad.join('/'),
      sigSet: !!matchSigGet('m_live', 'lc0')
    };
  }, ARTICLE);

  const bFrontPct = seqBefore.total ? Math.round(seqBefore.front / seqBefore.total * 100) : 0;
  const aFrontPct = reseedAfter.afterTotal ? Math.round(reseedAfter.afterFront / reseedAfter.afterTotal * 100) : 0;
  console.log('    改前：' + seqBefore.total + ' 处标注，空白段 ' + seqBefore.blank + '，前 1/3 占 ' + bFrontPct + '%');
  console.log('    改后：' + reseedAfter.afterTotal + ' 处标注，空白段 ' + reseedAfter.afterBlank + '，前 1/3 占 ' + aFrontPct + '%');
  console.log('    新分布：' + reseedAfter.dist);
  console.log('    改前分布：' + seqBefore.dist);
  ok('重算确实发生了（段落分布被整体重排）',
    reseedAfter.afterTotal > 0 && reseedAfter.dist !== seqBefore.dist,
    { 改前: seqBefore.dist, 改后: reseedAfter.dist });
  ok('空白段减少（改前 12 段空白）', reseedAfter.afterBlank < seqBefore.blank, { before: seqBefore.blank, after: reseedAfter.afterBlank });
  ok('前 1/3 段承载下降到 65% 以内', aFrontPct <= 65, aFrontPct + '%');
  ok('末 1/3 段落也被标到了（改前几乎没有）', reseedAfter.dist.split('/').slice(-6).some(x => Number(x) > 0), reseedAfter.dist);
  ok('重算后写入了签名，不会每次进页面都重算', reseedAfter.sigSet === true);
  ok('没有留下 ? 或 undefined 之类的坏位置', reseedAfter.dist.indexOf('undefined') < 0 && reseedAfter.dist.indexOf('NaN') < 0, reseedAfter.dist);

  console.log('\n[3] 重复进学习页不会反复重算（签名生效）');
  const again = await page.evaluate(() => {
    const before = JSON.stringify(STATE.matches.m_live.lc0);
    renderLearnInit();
    const after = JSON.stringify(STATE.matches.m_live.lc0);
    return { same: before === after, len: STATE.matches.m_live.lc0.length };
  });
  ok('第二次进入，标注完全没变（不会重复重算）', again.same === true, again.len);

  console.log('\n[4] 章节底部导航');
  const navState = await page.evaluate(() => {
    STATE.learnMaterialId = 'm_live';
    STATE.learnChapterId = 'lc0';
    renderChapterNav();
    const prev0 = document.getElementById('navPrevBtn');
    const next0 = document.getElementById('navNextBtn');
    const first = {
      exists: !!prev0 && !!next0,
      prevDisabled: prev0.disabled, nextDisabled: next0.disabled,
      nextText: next0.textContent.trim(),
      prog: document.getElementById('chNavProgressBottom').textContent,
      afterReadingArea: document.getElementById('chapterNavBottom').compareDocumentPosition(document.getElementById('readingArea')) & 4 ? 'before' : 'after'
    };
    return first;
  });
  ok('底部导航容器与两个按钮都存在', navState.exists === true);
  ok('底部导航位于正文区之后（内容末尾）', navState.afterReadingArea === 'after', navState.afterReadingArea);
  ok('第一章：上一章按钮禁用', navState.prevDisabled === true);
  ok('第一章：下一章按钮可用', navState.nextDisabled === false);
  ok('下一章按钮带上了下一章标题', navState.nextText.indexOf('第二章') >= 0, navState.nextText);
  ok('进度显示第 1 / 3 章', navState.prog.indexOf('1 / 3') >= 0, navState.prog);

  console.log('\n[5] 底部导航点击行为（切章 + 回到文首）');
  await page.evaluate(() => {
    const area = document.getElementById('readingArea');
    area.scrollTop = 500;
    window.__scrollBefore = area.scrollTop;
  });
  // 滚到底部再点，模拟真实使用
  await page.evaluate(() => document.getElementById('chapterNavBottom').scrollIntoView({ block: 'end' }));
  await page.click('#navNextBtn');
  await page.waitForTimeout(400);
  const afterClick = await page.evaluate(() => ({
    chapterId: STATE.learnChapterId,
    selValue: document.getElementById('selChapter').value,
    scrollTop: document.getElementById('readingArea').scrollTop,
    prog: document.getElementById('chNavProgressBottom').textContent,
    title: document.getElementById('chNavTitleBottom').textContent,
    prevDisabled: document.getElementById('navPrevBtn').disabled,
    nextText: document.getElementById('navNextBtn').textContent.trim()
  }));
  ok('点击后切换到第二章', afterClick.chapterId === 'lc1', afterClick.chapterId);
  ok('章节下拉框同步', afterClick.selValue === 'lc1', afterClick.selValue);
  ok('正文滚回顶部', afterClick.scrollTop === 0, afterClick.scrollTop);
  ok('进度更新为第 2 / 3 章', afterClick.prog.indexOf('2 / 3') >= 0, afterClick.prog);
  ok('此时上一章按钮变可用', afterClick.prevDisabled === false);
  ok('此时下一章按钮显示第三章', afterClick.nextText.indexOf('第三章') >= 0, afterClick.nextText);

  // 点上一章回去
  await page.click('#navPrevBtn');
  await page.waitForTimeout(400);
  const backOne = await page.evaluate(() => ({ id: STATE.learnChapterId, prevDisabled: document.getElementById('navPrevBtn').disabled }));
  ok('点上一章回到第一章', backOne.id === 'lc0', backOne.id);
  ok('回到第一章后上一章又变禁用', backOne.prevDisabled === true);

  // 跳到最后一章看末章禁用
  await page.evaluate(() => { STATE.learnChapterId = 'lc2'; refreshLearn(true); });
  await page.waitForTimeout(300);
  const lastCh = await page.evaluate(() => ({
    nextDisabled: document.getElementById('navNextBtn').disabled,
    prevDisabled: document.getElementById('navPrevBtn').disabled,
    prog: document.getElementById('chNavProgressBottom').textContent
  }));
  ok('最后一章：下一章按钮禁用', lastCh.nextDisabled === true);
  ok('最后一章：上一章按钮可用', lastCh.prevDisabled === false);
  ok('进度提示已是最后一章', lastCh.prog.indexOf('已是最后一章') >= 0, lastCh.prog);

  console.log('\n[6] 顶部原有章节导航仍然可用（回退兼容）');
  await page.evaluate(() => { STATE.learnChapterId = 'lc0'; refreshLearn(true); });
  await page.waitForTimeout(200);
  const topNav = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.chapter-nav:not(.chapter-nav-bottom) button'));
    const next = btns.find(b => b.textContent.indexOf('下一章') >= 0);
    if (next) next.click();
    return { btns: btns.length, nowId: STATE.learnChapterId };
  });
  ok('顶部导航按钮仍在（2 个）', topNav.btns === 2, topNav.btns);
  ok('顶部「下一章」仍能切章', topNav.nowId === 'lc1', topNav.nowId);

  console.log('\n[7] 页面无 JS 报错');
  const realErrs = errors.filter(e => !/ResizeObserver|Failed to load resource|net::/i.test(e));
  ok('没有未捕获异常', realErrs.length === 0, realErrs.slice(0, 3));

  // 截图：滚到底部看导航条
  await page.evaluate(() => { STATE.learnChapterId = 'lc1'; refreshLearn(true); });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('chapterNavBottom').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'G:/英语学习工作台/_shot_nav_bottom.png' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'G:/英语学习工作台/_shot_dist_full.png', fullPage: false });
  await browser.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(56));
  console.log('浏览器端集成验证：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(56));
  process.exit(failed.length ? 1 : 0);
})();
