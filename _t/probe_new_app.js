const { chromium } = require('playwright');
const URL = process.argv[2] || 'https://context-vocab-workbench.app.workbuddy.host/';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 150)));
  await p.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(9000);
  const frames = p.frames();
  console.log('帧数:', frames.length);
  for (const f of frames) {
    try {
      const r = await f.evaluate(() => ({
        url: location.href.slice(0, 90),
        hasState: !!window.STATE,
        hasSmartPage: !!(window.__SMART_PAGE__ && window.__SMART_PAGE__.database),
        hasRescue: typeof openRescuePanel,
        hasPicker: typeof pickMatchesByStrategy,
        authVisible: (function(){ var e=document.getElementById('authScreen'); return e ? getComputedStyle(e).display !== 'none' : null; })(),
        loginBtn: !!document.querySelector('#authScreen button')
      }));
      console.log(JSON.stringify(r));
    } catch (e) { console.log('  跨域帧跳过'); }
  }
  if (errs.length) { console.log('页面错误:'); errs.slice(0,5).forEach(e => console.log('  ' + e)); }
  await p.screenshot({ path: 'G:/英语学习工作台/_shot_newapp.png' });
  await b.close();
})();
