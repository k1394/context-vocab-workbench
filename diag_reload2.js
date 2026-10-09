// 定位「刷新后资料为 0」的根因：走错分支 / 被覆盖 / 根本没调用
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8899);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [pageerror] ' + e.message.slice(0, 120)));

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ profileId: 'p_diag2', nick: 'DIAG2' }));
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  await page.setInputFiles('#matFileInput', path.resolve(__dirname, 'testdata/test_material.pdf'));
  await page.waitForTimeout(6000);
  console.log('导入后 materials =', await page.evaluate(() => STATE.materials.length));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(9000);

  const info = await page.evaluate(() => ({
    cloudReady: STATE.cloudReady,
    hasSmartPage: !!window.__SMART_PAGE__,
    appVisible: document.getElementById('app').style.display,
    authVisible: document.getElementById('authScreen').style.display,
    profileId: STATE.profileId,
    nick: STATE.nickname,
    materialsInState: STATE.materials.length,
    materialsInLS: (LS.get('materials_' + STATE.profileId, []) || []).length,
    chaptersInLS: Object.keys(LS.get('chapters_' + STATE.profileId, {}) || {}).length
  }));
  console.log('\n刷新后：', JSON.stringify(info, null, 1));

  // 手动再跑一次加载，看数据是否还在
  const manual = await page.evaluate(async () => {
    await loadDataForProfile(STATE.profileId);
    return { materials: STATE.materials.length, titles: STATE.materials.map(m => m.title) };
  });
  console.log('\n手动调用 loadDataForProfile 后：', JSON.stringify(manual));

  // 看 DOMContentLoaded 时到底发生了什么
  const boot = await page.evaluate(() => {
    const cur = LS.get('current_user');
    return { currentUser: cur, seenFlag: LS.get('seen_' + (cur && cur.profileId), null), users: LS.get('users', []) };
  });
  console.log('\n启动相关状态：', JSON.stringify(boot).slice(0, 400));

  await browser.close();
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
