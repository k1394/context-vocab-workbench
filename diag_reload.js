// 诊断：导入资料后刷新页面，资料是否还在（对比改动前/后）
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8899);
const FILE = process.env.FILE || 'test_material.pdf';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 120)));

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ profileId: 'p_diag', nick: 'DIAG' }));
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const snap = () => page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.indexOf('ctx_vocab_') === 0);
    const matsKey = 'ctx_vocab_materials_' + STATE.profileId;
    return {
      profileId: STATE.profileId,
      nick: STATE.nickname,
      materials: STATE.materials.length,
      titles: STATE.materials.map(m => m.title),
      lsMatCount: (JSON.parse(localStorage.getItem(matsKey) || '[]') || []).length,
      matKeys: keys.filter(k => k.indexOf('materials_') !== -1).map(k => k + '=' + (JSON.parse(localStorage.getItem(k) || '[]') || []).length),
      curUser: localStorage.getItem('ctx_vocab_current_user')
    };
  });

  console.log('=== 导入前 ===');
  console.log(JSON.stringify(await snap(), null, 1));

  await page.setInputFiles('#matFileInput', path.resolve(__dirname, 'testdata', FILE));
  await page.waitForTimeout(8000);
  console.log('\n=== 导入后 ===');
  console.log(JSON.stringify(await snap(), null, 1));

  await page.reload({ waitUntil: 'load' });
  // 启动要等 CLOUD.waitReady（最长 5s）+ 账号解析，轮询到稳定再判定
  let last = -1, stable = 0;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(700);
    const n = await page.evaluate(() => (window.STATE ? STATE.materials.length : -1));
    if (n === last && n >= 0) { stable++; if (stable >= 3) break; } else { stable = 0; }
    last = n;
  }
  console.log('\n=== 刷新后（等待 ' + (stable >= 3 ? '稳定' : '超时') + '，材料数 ' + last + '）===');
  console.log(JSON.stringify(await snap(), null, 1));
  console.log('\npageerror: ' + (errs.length ? errs.join(' | ') : '无'));

  await browser.close();
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
