// 浏览器端集成验证：示例清理 / 删除墓碑 / 阅读进度 / 标注补偿
// 在真实页面上跑真实代码，不写任何云端数据
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8933/index.html';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined' && typeof STATE.wordbooks !== 'undefined', { timeout: 40000 });
  await page.waitForTimeout(1500);

  // 激活主应用（未登录时 #app 是隐藏的，量不到真实布局）
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
  });

  // ---------- 一、函数就位 ----------
  group('一、新函数在真实页面里就位');
  const fns = await page.evaluate(() => {
    const names = ['softDeleteCloud', 'filterCloudRows', 'tombBuild', 'isTombstoned',
      'purgeLegacySampleLeftovers', 'purgeLegacySamplesInMemory', 'clearLegacySampleMarks',
      'currentScrollInfo', 'restoreScrollPct', 'bindScrollTracking', 'saveScrollPos',
      'queuePendingAdd', 'flushPendingAdds', 'pushOneMatch'];
    const out = {};
    names.forEach(n => { out[n] = typeof window[n]; });
    return out;
  });
  Object.keys(fns).forEach(n => ok(n + ' 是函数', fns[n] === 'function', fns[n]));
  ok('示例注入判定函数已不存在', await page.evaluate(() => typeof window.sampleInjectAllowed) === 'undefined');

  // ---------- 二、示例数据被清掉 ----------
  group('二、历史示例数据在加载期被清掉（本地 + 云端）');
  const cleanRes = await page.evaluate(() => {
    const keep = { cr: STATE.cloudReady, pid: STATE.profileId, toasts: 0 };
    STATE.cloudReady = false;               // 离线跑，绝不碰真实云端
    STATE.profileId = 'verify_cln';

    STATE.wordbooks = [
      { id: 'wb_s', name: '示例单词书', _cloudId: 'cw_s' },
      { id: 'wb_n', name: '六级词书', _cloudId: 'cw_n' }
    ];
    STATE.words = [
      { lemma: 'ceiling', wordbookId: 'wb_s', _cloudId: 'wo1' },
      { lemma: 'abandon', wordbookId: 'wb_n', _cloudId: 'wo2' }
    ];
    STATE.materials = [
      { id: 'm_s', title: '某某·重生（示例）', _cloudId: 'cm_s' },
      { id: 'm_n', title: '真实资料', _cloudId: 'cm_n' }
    ];
    STATE.chapters = { m_s: [{ id: 'c1', _cloudId: 'cc1' }], m_n: [{ id: 'c2' }] };
    STATE.matches = { m_s: { c1: [{ lemma: 'ceiling', chWord: '天花板', _cloudId: 'cma1' }] }, m_n: { c2: [] } };
    STATE.progress = { m_s: { c1: { scrollPct: 3 } }, m_n: { c2: { scrollPct: 66 } } };

    // 模拟「云端返回了这些行」
    legacyPurgeReset();
    const keptRows = filterCloudRows(DB_IDS.context_wordbooks, [
      { _id: 'cw_s', '书名': '示例单词书', '单词书ID': 'wb_s' },
      { _id: 'cw_n', '书名': '六级词书', '单词书ID': 'wb_n' }
    ]);
    const keptMats = filterCloudRows(DB_IDS.context_materials, [
      { _id: 'cm_s', '标题': '某某·重生（示例）', '资料ID': 'm_s' },
      { _id: 'cm_n', '标题': '真实资料', '资料ID': 'm_n' }
    ]);

    const n = purgeLegacySampleLeftovers();

    const r = {
      keptWb: keptRows.map(x => x._id),
      keptMat: keptMats.map(x => x._id),
      purged: n,
      hasSampleWb: STATE.wordbooks.some(w => w.id === 'wb_s'),
      hasSampleWord: STATE.words.some(w => w.wordbookId === 'wb_s'),
      hasSampleMat: STATE.materials.some(m => m.id === 'm_s'),
      cleanChapters: !STATE.chapters.m_s,
      cleanMatches: !STATE.matches.m_s,
      cleanProgress: !STATE.progress.m_s,
      keepProgress: STATE.progress.m_n && STATE.progress.m_n.c2.scrollPct === 66,
      keepWb: STATE.wordbooks.some(w => w.id === 'wb_n')
    };
    STATE.cloudReady = keep.cr; STATE.profileId = keep.pid;
    return r;
  });
  ok('加载期就把示例词书从云端行里剔掉了', cleanRes.keptWb.length === 1 && cleanRes.keptWb[0] === 'cw_n', cleanRes.keptWb);
  ok('加载期就把示例资料从云端行里剔掉了', cleanRes.keptMat.length === 1 && cleanRes.keptMat[0] === 'cm_n', cleanRes.keptMat);
  ok('示例书从本地移除', cleanRes.hasSampleWb === false);
  ok('示例书的词一起清掉', cleanRes.hasSampleWord === false);
  ok('示例资料从本地移除', cleanRes.hasSampleMat === false);
  ok('示例资料的章节/匹配/进度一起清掉', cleanRes.cleanChapters && cleanRes.cleanMatches && cleanRes.cleanProgress);
  ok('正常数据不受影响', cleanRes.keepWb && cleanRes.keepProgress);
  ok('返回了待删云端条数', cleanRes.purged >= 2, cleanRes.purged);

  // ---------- 三、删除墓碑 ----------
  group('三、删除墓碑：云端还没删掉也不会再显示');
  const tombRes = await page.evaluate(() => {
    const keep = { cr: STATE.cloudReady, pid: STATE.profileId };
    STATE.cloudReady = false; STATE.profileId = 'verify_cln';
    LS.set('pendingDel_v1_verify_cln', []);            // 清空旧墓碑
    queuePendingDel(DB_IDS.context_wordbooks, 'tombX');
    tombBuild();
    const rows = filterCloudRows(DB_IDS.context_wordbooks, [
      { _id: 'tombX', '书名': '已经删掉的书' },
      { _id: 'okY', '书名': '正常的书' }
    ]);
    const isTomb = isTombstoned(DB_IDS.context_wordbooks, 'tombX');
    LS.set('pendingDel_v1_verify_cln', []);
    STATE.cloudReady = keep.cr; STATE.profileId = keep.pid;
    return { ids: rows.map(r => r._id), isTomb: isTomb };
  });
  ok('墓碑行被过滤掉', tombRes.ids.length === 1 && tombRes.ids[0] === 'okY', tombRes.ids);
  ok('isTombstoned 判定正确', tombRes.isTomb === true);

  // ---------- 四、阅读进度 ----------
  group('四、阅读进度：真实滚动层能读到、能还原');
  const scrollRes = await page.evaluate(async () => {
    const article = [];
    for (let i = 0; i < 24; i++) article.push('第' + (i + 1) + '段 Some English text for scroll measuring, paragraph number ' + (i + 1) + '. 这里是一段用于测量滚动位置的中文内容，重复写到足够长以便页面可以滚动。');
    const keep = { cr: STATE.cloudReady, pid: STATE.profileId };
    STATE.cloudReady = false; STATE.profileId = 'verify_cln';
    STATE.materials = [{ id: 'vm', title: '滚动测试' }];
    STATE.chapters = { vm: [{ id: 'vc0', title: '第一章 滚动测试', order: 0, content: article.join('\n\n'), targetWords: 10, generated: false }] };
    STATE.matches = { vm: { vc0: [] } };
    STATE.progress = {};
    STATE.learnMaterialId = 'vm'; STATE.learnChapterId = 'vc0';
    navTo('learn');
    refreshLearn(true);
    await new Promise(r => setTimeout(r, 300));

    const before = { docH: document.documentElement.scrollHeight, winH: window.innerHeight };
    const info0 = currentScrollInfo();

    // 滚到中间
    const target = Math.round(info0.max * 0.5);
    if (info0.el) info0.el.scrollTop = target;
    else window.scrollTo(0, target);
    await new Promise(r => setTimeout(r, 120));
    saveScrollPos();
    const saved = STATE.progress.vm && STATE.progress.vm.vc0 && STATE.progress.vm.vc0.scrollPct;

    // 回到顶部再还原
    if (info0.el) info0.el.scrollTop = 0; else window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 60));
    restoreScrollPct(saved);
    await new Promise(r => setTimeout(r, 200));
    const info1 = currentScrollInfo();

    STATE.cloudReady = keep.cr; STATE.profileId = keep.pid;
    return {
      docH: before.docH, winH: before.winH, max: info0.max,
      saved: saved,
      restoredTop: info1.top, restoredMax: info1.max,
      overflow: getComputedStyle(document.getElementById('readingArea')).overflowY,
      areaScrollable: document.getElementById('readingArea').scrollHeight > document.getElementById('readingArea').clientHeight + 2
    };
  });
  console.log('    pageH=' + scrollRes.docH + ' winH=' + scrollRes.winH + ' max=' + scrollRes.max +
    ' overflowY=' + scrollRes.overflow + ' areaScrollable=' + scrollRes.areaScrollable);
  ok('页面确实可滚动（否则测不出东西）', scrollRes.max > 100, scrollRes.max);
  ok('阅读区自身仍不是滚动容器（说明必须走真实滚动层）', scrollRes.areaScrollable === false);
  ok('★ 滚动后存下了非 0 的进度（改前恒为 0）', scrollRes.saved > 30, scrollRes.saved);
  ok('★ 还原回到大致相同位置', Math.abs(scrollRes.restoredTop - scrollRes.restoredMax * scrollRes.saved / 100) < 30,
    { restoredTop: scrollRes.restoredTop, expect: Math.round(scrollRes.restoredMax * scrollRes.saved / 100) });

  // ---------- 五、标注补偿 ----------
  group('五、新增标注推云端失败的补偿路径');
  const addRes = await page.evaluate(async () => {
    const keep = { cr: STATE.cloudReady, pid: STATE.profileId };
    STATE.cloudReady = false; STATE.profileId = 'verify_cln';
    LS.set('pendingAdd_v1_verify_cln', []);
    queuePendingAdd({ matId: 'vm', chId: 'vc0', lemma: 'alpha', chWord: '甲', position: 1 });
    queuePendingAdd({ matId: 'vm', chId: 'vc0', lemma: 'alpha', chWord: '甲', position: 1 });
    const cnt1 = pendingAddCount();
    const n = await flushPendingAdds();          // 离线 → 应当直接返回 0，不动数据
    const cnt2 = pendingAddCount();
    unqueuePendingAdd({ matId: 'vm', chId: 'vc0', lemma: 'alpha', chWord: '甲', position: 1 });
    const cnt3 = pendingAddCount();
    LS.set('pendingAdd_v1_verify_cln', []);
    STATE.cloudReady = keep.cr; STATE.profileId = keep.pid;
    return { cnt1: cnt1, n: n, cnt2: cnt2, cnt3: cnt3 };
  });
  ok('同一条重复记只算一条', addRes.cnt1 === 1, addRes.cnt1);
  ok('离线时 flushPendingAdds 直接返回 0（不误删待办）', addRes.n === 0 && addRes.cnt2 === 1, addRes);
  ok('销账生效', addRes.cnt3 === 0);

  // ---------- 六、零报错 ----------
  group('六、页面健康度');
  ok('页面无未捕获异常', errors.length === 0, errors.slice(0, 2));

  await page.screenshot({ path: 'G:/英语学习工作台/_shot_cleanup_verify.png', fullPage: false });
  await browser.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(56));
  console.log('浏览器端集成验证：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(56));
  process.exit(failed.length ? 1 : 0);
})();
