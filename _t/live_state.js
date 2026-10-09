// 诊断线上页面到底停在哪一步
const { chromium } = require('playwright');
const URL = process.env.URL || 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 200)));

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(10000);

  await page.screenshot({ path: 'G:/英语学习工作台/_shot_live_now.png' });

  const frames = page.frames();
  console.log('帧数：', frames.length);
  for (const f of frames) {
    try {
      const r = await f.evaluate(() => {
        const vis = el => { if (!el) return false; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
        return {
          url: location.href.slice(0, 110),
          hasState: !!window.STATE,
          hasSmartPage: !!(window.__SMART_PAGE__ && window.__SMART_PAGE__.database),
          cloudReady: window.STATE ? STATE.cloudReady : null,
          profileId: window.STATE ? STATE.profileId : null,
          nickname: window.STATE ? STATE.nickname : null,
          words: window.STATE ? STATE.words.length : null,
          wbs: window.STATE ? STATE.wordbooks.length : null,
          mats: window.STATE ? STATE.materials.length : null,
          curUser: (function(){ try { return localStorage.getItem('current_user'); } catch(e){ return 'blocked'; } })(),
          loginVisible: vis(document.getElementById('loginScreen')),
          appVisible: vis(document.getElementById('appScreen')),
          title: document.title,
          bodyLen: document.body ? document.body.innerText.length : -1
        };
      });
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.log('  跨域帧跳过：' + location);
    }
  }
  if (errs.length) { console.log('\n错误：'); errs.slice(0, 10).forEach(e => console.log('  ' + e)); }
  await browser.close();
})();
