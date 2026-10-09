// 线上 v22 探针：函数就位 + 源码痕迹 + 真实行为（示例清理 / 删除墓碑 / 滚动进度 / 标注补偿）
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);

  const frames = page.frames();
  const f = frames.find(fr => /index\.html/.test(fr.url()));
  ok('找到页面帧', !!f, frames.map(x => x.url()).slice(0, 3));
  if (!f) { await browser.close(); process.exit(1); }
  console.log('    帧 URL: ' + f.url());

  await f.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });

  // ---------- 一、版本与 SDK ----------
  group('一、版本与运行环境');
  ok('线上已是 v22', /\/22\/index\.html/.test(f.url()), f.url());
  ok('云端 SDK 已注入（数据库能力在线）', await f.evaluate(() => !!(window.__SMART_PAGE__ && window.__SMART_PAGE__.database)));

  // ---------- 二、新函数就位 ----------
  group('二、本轮新函数在线上就位');
  const fns = await f.evaluate(() => {
    const names = ['softDeleteCloud', 'filterCloudRows', 'tombBuild', 'isTombstoned',
      'purgeLegacySampleLeftovers', 'purgeLegacySamplesInMemory', 'clearLegacySampleMarks',
      'currentScrollInfo', 'restoreScrollPct', 'bindScrollTracking', 'saveScrollPos',
      'queuePendingAdd', 'flushPendingAdds', 'pushOneMatch',
      'scrollToChapterStart', 'renderChapterNav', 'showConfirm'];
    const out = {};
    names.forEach(n => { out[n] = typeof window[n]; });
    return out;
  });
  Object.keys(fns).forEach(n => ok(n + ' 是函数', fns[n] === 'function', fns[n]));
  ok('showConfirm 支持 4 参（含取消回调）', await f.evaluate(() => window.showConfirm.length === 4));
  ok('示例注入判定函数已彻底不存在', await f.evaluate(() => typeof window.sampleInjectAllowed) === 'undefined');
  ok('旧的 injectSampleData 也已不存在', await f.evaluate(() => typeof window.injectSampleData) === 'undefined');

  // ---------- 三、源码痕迹 ----------
  group('三、线上源码痕迹');
  const marks = await f.evaluate(async () => {
    const html = await (await fetch(location.href)).text();
    const test = (s) => html.indexOf(s) >= 0;
    return {
      rowsFilter: (html.match(/rows = filterCloudRows\(DB_IDS\./g) || []).length,
      tombBuild: test('  tombBuild();'),
      purgeInLoad: test('    purgeLegacySampleLeftovers();'),
      flushAddInEnter: test('        flushPendingAdds();'),
      restoreScroll: test('    restoreScrollPct(prog.scrollPct);'),
      removedWbs: test('var removedWbs = [];'),
      sampleGone: html.indexOf('示例单词书') < 0 && html.indexOf('sample.csv') < 0 && html.indexOf('injectSampleData') < 0
    };
  });
  ok('行过滤插入了 13 处', marks.rowsFilter === 13, marks.rowsFilter);
  ok('loadDataForProfile 里准备了墓碑索引', marks.tombBuild);
  ok('加载收尾调了示例残留清理', marks.purgeInLoad);
  ok('enterApp 里调了标注补推', marks.flushAddInEnter);
  ok('恢复滚动改走 restoreScrollPct', marks.restoreScroll);
  ok('removeWordbook 收集了全部副本', marks.removedWbs);
  ok('★ 源码里已找不到任何示例数据痕迹', marks.sampleGone);

  // 激活主应用（未登录时 #app 是隐藏的）
  await f.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
  });

  // ---------- 四、行为：示例清理 ----------
  group('四、线上真实行为：历史示例数据被清掉');
  const cln = await f.evaluate(() => {
    const keep = { cr: STATE.cloudReady, pid: STATE.profileId };
    STATE.cloudReady = false; STATE.profileId = 'probe_v22';
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
    legacyPurgeReset();
    const kept = filterCloudRows(DB_IDS.context_wordbooks, [
      { _id: 'cw_s', '书名': '示例单词书', '单词书ID': 'wb_s' },
      { _id: 'cw_n', '书名': '六级词书', '单词书ID': 'wb_n' }
    ]);
    const n = purgeLegacySampleLeftovers();
    const r = {
      kept: kept.map(x => x._id), purged: n,
      wbGone: !STATE.wordbooks.some(w => w.id === 'wb_s'),
      wordGone: !STATE.words.some(w => w.wordbookId === 'wb_s'),
      matGone: !STATE.materials.some(m => m.id === 'm_s'),
      chGone: !STATE.chapters.m_s && !STATE.matches.m_s && !STATE.progress.m_s,
      keptOk: STATE.wordbooks.some(w => w.id === 'wb_n') && STATE.progress.m_n && STATE.progress.m_n.c2.scrollPct === 66
    };
    // 清掉测试写入的待办，避免留在用户账号里
    LS.set('pendingDel_v1_probe_v22', []); LS.set('pendingAdd_v1_probe_v22', []);
    STATE.cloudReady = keep.cr; STATE.profileId = keep.pid;
    return r;
  });
  ok('加载期剔掉示例词书，正常书保留', cln.kept.length === 1 && cln.kept[0] === 'cw_n', cln.kept);
  ok('示例书从列表消失', cln.wbGone);
  ok('示例书的词一起消失', cln.wordGone);
  ok('示例资料消失', cln.matGone);
  ok('示例的章节/匹配/进度一起消失', cln.chGone);
  ok('正常数据毫发无损', cln.keptOk);

  // ---------- 五、行为：删除墓碑 ----------
  group('五、线上真实行为：删掉的东西刷新后不再出现');
  const tomb = await f.evaluate(() => {
    const keep = { cr: STATE.cloudReady, pid: STATE.profileId };
    STATE.cloudReady = false; STATE.profileId = 'probe_v22';
    LS.set('pendingDel_v1_probe_v22', []);
    queuePendingDel(DB_IDS.context_wordbooks, 'tombX');
    tombBuild();
    const rows = filterCloudRows(DB_IDS.context_wordbooks, [
      { _id: 'tombX', '书名': '已经删掉的书' },
      { _id: 'okY', '书名': '正常的书' }
    ]);
    LS.set('pendingDel_v1_probe_v22', []);
    STATE.cloudReady = keep.cr; STATE.profileId = keep.pid;
    return rows.map(r => r._id);
  });
  ok('★ 即使云端还没删掉，墓碑行也不会再显示', tomb.length === 1 && tomb[0] === 'okY', tomb);

  // ---------- 六、行为：阅读进度 ----------
  group('六、线上真实行为：阅读进度能记录也能还原');
  const sc = await f.evaluate(async () => {
    const article = [];
    for (let i = 0; i < 24; i++) article.push('第' + (i + 1) + '段 Reading progress probe, paragraph ' + (i + 1) + '. 这里是一段用于测量线上滚动位置的中文内容，写到足够长以便页面可以滚动。');
    const keep = { cr: STATE.cloudReady, pid: STATE.profileId };
    STATE.cloudReady = false; STATE.profileId = 'probe_v22';
    STATE.materials = [{ id: 'vm', title: '滚动测试' }];
    STATE.chapters = { vm: [{ id: 'vc0', title: '第一章 滚动测试', order: 0, content: article.join('\n\n'), targetWords: 10, generated: false }] };
    STATE.matches = { vm: { vc0: [] } };
    STATE.progress = {};
    STATE.learnMaterialId = 'vm'; STATE.learnChapterId = 'vc0';
    navTo('learn');
    refreshLearn(true);
    await new Promise(r => setTimeout(r, 300));
    const info0 = currentScrollInfo();
    const target = Math.round(info0.max * 0.5);
    if (info0.el) info0.el.scrollTop = target; else window.scrollTo(0, target);
    await new Promise(r => setTimeout(r, 150));
    saveScrollPos();
    const saved = STATE.progress.vm && STATE.progress.vm.vc0 && STATE.progress.vm.vc0.scrollPct;
    if (info0.el) info0.el.scrollTop = 0; else window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 60));
    restoreScrollPct(saved);
    await new Promise(r => setTimeout(r, 250));
    const info1 = currentScrollInfo();
    const r = {
      max: info0.max, saved: saved, restored: info1.top,
      expect: Math.round(info1.max * saved / 100),
      areaScrollable: document.getElementById('readingArea').scrollHeight > document.getElementById('readingArea').clientHeight + 2
    };
    STATE.cloudReady = keep.cr; STATE.profileId = keep.pid;
    return r;
  });
  console.log('    max=' + sc.max + ' saved=' + sc.saved + '% restored=' + sc.restored + '（期望≈' + sc.expect + '）');
  ok('线上页面确实可滚动', sc.max > 100, sc.max);
  ok('阅读区自身仍不是滚动容器', sc.areaScrollable === false);
  ok('★ 线上滚动后存下了进度（改前恒为 0）', sc.saved > 30, sc.saved);
  ok('★ 线上还原回到大致相同位置（误差 < 40px）', Math.abs(sc.restored - sc.expect) < 40, { restored: sc.restored, expect: sc.expect });

  // ---------- 七、行为：标注补偿 ----------
  group('七、线上真实行为：标注补偿记账');
  const pa = await f.evaluate(async () => {
    const keep = { cr: STATE.cloudReady, pid: STATE.profileId };
    STATE.cloudReady = false; STATE.profileId = 'probe_v22';
    LS.set('pendingAdd_v1_probe_v22', []);
    queuePendingAdd({ matId: 'vm', chId: 'vc0', lemma: 'alpha', chWord: '甲', position: 1 });
    queuePendingAdd({ matId: 'vm', chId: 'vc0', lemma: 'alpha', chWord: '甲', position: 1 });
    const c1 = pendingAddCount();
    const n = await flushPendingAdds();
    const c2 = pendingAddCount();
    unqueuePendingAdd({ matId: 'vm', chId: 'vc0', lemma: 'alpha', chWord: '甲', position: 1 });
    const c3 = pendingAddCount();
    LS.set('pendingAdd_v1_probe_v22', []);
    STATE.cloudReady = keep.cr; STATE.profileId = keep.pid;
    return { c1: c1, n: n, c2: c2, c3: c3 };
  });
  ok('同一条重复记只算一条', pa.c1 === 1, pa.c1);
  ok('离线时不会误清待办', pa.n === 0 && pa.c2 === 1, pa);
  ok('销账生效', pa.c3 === 0);

  // 收尾：把探针写入的本地键清掉，别留在用户浏览器里
  await f.evaluate(() => {
    ['pendingDel_v1_probe_v22', 'pendingAdd_v1_probe_v22'].forEach(k => { try { LS.del(k); } catch (e) { } });
  });

  group('八、页面健康度');
  ok('线上页面零未捕获异常', errors.length === 0, errors.slice(0, 2));

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(56));
  console.log('线上 v22 探针：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(x => console.log('  ✗ ' + x.name));
  console.log('='.repeat(56));
  process.exit(failed.length ? 1 : 0);
})();
