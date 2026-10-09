// 验证「数据自检与抢救」+「删除待办补删」新功能
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8933;
const BASE = 'http://127.0.0.1:' + PORT;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());   // doRescue / doRescueLocal 的 confirm 一律确认

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ nick: 'RESCUE', profileId: 'p_me' }));
    localStorage.setItem('ctx_vocab_users', JSON.stringify([{ nick: 'RESCUE', profileId: 'p_me' }]));
    // 伪造一份「旧账号 ID 下的本地残留」
    localStorage.setItem('ctx_vocab_wordbooks_p_old', JSON.stringify([
      { id: 'wb_lost', name: '我在旧ID下加的书', source: 'lost.csv', total: 3, importedAt: '2026-01-01T00:00:00Z' }
    ]));
    localStorage.setItem('ctx_vocab_words_p_old', JSON.stringify([
      { lemma: 'alpha', wordbookId: 'wb_lost', meaning: '阿尔法' },
      { lemma: 'beta', wordbookId: 'wb_lost', meaning: '贝塔' },
      { lemma: 'gamma', wordbookId: 'wb_lost', meaning: '伽马' }
    ]));
    localStorage.setItem('ctx_vocab_materials_p_old', JSON.stringify([
      { id: 'mat_lost', title: '旧ID下的资料', sourceType: 's_txt', rawContent: 'hello world', chapters: [], chapterCount: 0 }
    ]));
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && typeof STATE.words !== 'undefined', { timeout: 90000 });
  // 离线模式下要等 CLOUD.waitReady 超时后才装内置词书，这里等它就位再断言
  await page.waitForFunction(() => STATE.wordbooks && STATE.wordbooks.length > 0, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log('\n[1] 新函数是否就位');
  const boot = await page.evaluate(() => ({ wbs: STATE.wordbooks.length, words: STATE.words.length, pid: STATE.profileId }));
  ok('应用已进入且内置词书就位（后续断言的前提）', boot.wbs > 0 && boot.words > 7000, boot);
  const fns = await page.evaluate(() => ({
    openRescuePanel: typeof openRescuePanel,
    scanAllSources: typeof scanAllSources,
    rescueFromPid: typeof rescueFromPid,
    doRescueLocal: typeof doRescueLocal,
    queuePendingDel: typeof queuePendingDel,
    flushPendingDels: typeof flushPendingDels,
    pendingDelCount: typeof pendingDelCount,
    btn: !!Array.prototype.slice.call(document.querySelectorAll('button')).find(b => b.textContent.trim() === '数据自检')
  }));
  ok('有 openRescuePanel', fns.openRescuePanel === 'function');
  ok('有 scanAllSources', fns.scanAllSources === 'function');
  ok('有 rescueFromPid', fns.rescueFromPid === 'function');
  ok('有 doRescueLocal', fns.doRescueLocal === 'function');
  ok('有 queuePendingDel / flushPendingDels', fns.queuePendingDel === 'function' && fns.flushPendingDels === 'function');
  ok('单词书区域有「数据自检」按钮', fns.btn);

  console.log('\n[2] 面板能打开并列出其他账号 ID 的数据');
  const panel = await page.evaluate(() => {
    navTo('materials');
    openRescuePanel();
    return { visible: document.getElementById('rescuePanel').style.display === 'flex' };
  });
  ok('面板已打开', panel.visible);
  await page.waitForFunction(() => {
    const b = document.getElementById('rescueBody');
    return b && b.innerHTML.indexOf('正在扫描') === -1;
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);

  const scan = await page.evaluate(() => {
    const b = document.getElementById('rescueBody');
    const txt = b.innerText.replace(/\s+/g, ' ');
    return {
      txt,
      hasOld: txt.indexOf('p_old') !== -1,
      hasMe: txt.indexOf('p_me') !== -1,
      markedMe: txt.indexOf('← 当前账号') !== -1,
      rescueBtns: Array.prototype.slice.call(b.querySelectorAll('button')).filter(x => x.textContent.indexOf('并入当前账号') !== -1).length,
      pendingShown: /删除待办：\d+ 项/.test(txt),
      localCounts: txt.indexOf('资料 1') !== -1 && txt.indexOf('单词书 1') !== -1
    };
  });
  ok('列出身兼的另一个账号 ID p_old', scan.hasOld, scan.txt.slice(0, 160));
  ok('标出当前账号', scan.markedMe && scan.hasMe, scan.txt.slice(0, 120));
  ok('有「并入当前账号」按钮（云端段为空时至少本地段 1 个）', scan.rescueBtns >= 1, scan.rescueBtns);
  ok('显示删除待办条数', scan.pendingShown);
  ok('本地残留数量正确（资料 1 / 单词书 1）', scan.localCounts, scan.txt.slice(0, 200));

  console.log('\n[3] 从本地残留并入当前账号');
  const before = await page.evaluate(() => ({
    wbs: STATE.wordbooks.map(w => w.name),
    words: STATE.words.filter(w => w.wordbookId === 'wb_lost').length,
    mats: STATE.materials.map(m => m.title)
  }));
  ok('并入前没有「我在旧ID下加的书」', before.wbs.indexOf('我在旧ID下加的书') === -1, before.wbs);

  const after = await page.evaluate(async () => {
    doRescueLocal('p_old');
    await new Promise(r => setTimeout(r, 800));
    return {
      wbs: STATE.wordbooks.map(w => w.name),
      words: STATE.words.filter(w => w.wordbookId === 'wb_lost').map(w => w.lemma),
      mats: STATE.materials.map(m => m.title),
      rendered: document.getElementById('wordbookList').innerText.replace(/\s+/g, ' '),
      backup: Object.keys(localStorage).filter(k => k.indexOf('ctx_vocab_rescueBackup_') === 0).length
    };
  });
  ok('并入后出现「我在旧ID下加的书」', after.wbs.indexOf('我在旧ID下加的书') !== -1, after.wbs);
  ok('3 个单词一并恢复', after.words.length === 3, after.words);
  ok('旧 ID 下的资料也恢复', after.mats.indexOf('旧ID下的资料') !== -1, after.mats);
  ok('界面单词书列表能看到它', after.rendered.indexOf('我在旧ID下加的书') !== -1, after.rendered.slice(0, 120));
  ok('并入前自动生成了本地备份', after.backup >= 1, after.backup);

  console.log('\n[4] 重复并入不会产生重复数据（幂等）');
  const twice = await page.evaluate(async () => {
    doRescueLocal('p_old');
    await new Promise(r => setTimeout(r, 600));
    return {
      wbs: STATE.wordbooks.filter(w => w.name === '我在旧ID下加的书').length,
      words: STATE.words.filter(w => w.wordbookId === 'wb_lost').length
    };
  });
  ok('再并一次书还是 1 本', twice.wbs === 1, twice.wbs);
  ok('再并一次词还是 3 个', twice.words === 3, twice.words);

  console.log('\n[5] 离线删除要记成待办');
  const off = await page.evaluate(async () => {
    STATE.cloudReady = false;
    STATE.wordbooks.push({ id: 'wb_tmp', name: '待删测试书', source: 'x.csv', total: 1, _cloudId: 'cloud_wb_tmp' });
    STATE.words.push({ lemma: 'zzz', wordbookId: 'wb_tmp', _cloudId: 'cloud_w_z' });
    removeWordbook('wb_tmp');
    return { list: pendingDelList(), count: pendingDelCount(), stillThere: STATE.wordbooks.some(w => w.id === 'wb_tmp') };
  });
  ok('离线删除后本地已移除', off.stillThere === false);
  ok('云端两条记录都进了待办', off.count === 2, off.list);

  console.log('\n[6] 云端恢复后自动补删并清空待办');
  const flush = await page.evaluate(async () => {
    const deleted = [];
    window.__fakeDb = {
      query: () => Promise.resolve({ results: [], hasMore: false }),
      addRecord: () => Promise.resolve({ id: 'x' }),
      updateRecord: () => Promise.resolve({ id: 'x' }),
      deleteRecord: (p) => { deleted.push(p.recordId); return Promise.resolve({ ok: true }); }
    };
    CLOUD.db = window.__fakeDb;
    STATE.cloudReady = true;
    const n = await flushPendingDels();
    return { n, deleted, left: pendingDelCount() };
  });
  ok('补删了 2 条', flush.n === 2, flush);
  ok('确实调到了云端删除', flush.deleted.length === 2, flush.deleted);
  ok('待办已清空', flush.left === 0, flush.left);

  console.log('\n[7] 补删失败会留在待办里（不会静默丢弃）');
  const fail = await page.evaluate(async () => {
    queuePendingDel('db_x', 'rec_1');
    CLOUD.db = {
      query: () => Promise.resolve({ results: [], hasMore: false }),
      addRecord: () => Promise.resolve(null),
      updateRecord: () => Promise.resolve(null),
      deleteRecord: () => Promise.resolve(null)   // 模拟删除一直失败
    };
    const n = await flushPendingDels();
    return { n, left: pendingDelCount() };
  });
  ok('失败时补删数为 0', fail.n === 0, fail.n);
  ok('失败的记录仍留在待办里', fail.left === 1, fail.left);

  if (errors.length) { console.log('\n页面错误：'); errors.slice(0, 6).forEach(e => console.log('  ' + e)); }

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(52));
  console.log('测试结果：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(52));

  await browser.close();
  process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
})();
