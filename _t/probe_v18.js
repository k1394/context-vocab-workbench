const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(URL, { waitUntil: 'load', timeout: 60000 });
  let f = null;
  for (let i = 0; i < 60 && !f; i++) {
    for (const x of p.frames()) {
      try { if (await x.evaluate(() => !!(window.STATE && typeof pickMatchesByStrategy === 'function'))) { f = x; break; } } catch (e) {}
    }
    if (!f) await p.waitForTimeout(800);
  }
  if (!f) { console.log('❌ 未找到应用帧'); await b.close(); process.exit(1); }
  const r = await f.evaluate(() => ({
    url: location.href.slice(0, 100),
    hasSmartPage: !!(window.__SMART_PAGE__ && window.__SMART_PAGE__.database),
    openRescuePanel: typeof openRescuePanel,
    scanAllSources: typeof scanAllSources,
    rescueFromPid: typeof rescueFromPid,
    flushPendingDels: typeof flushPendingDels,
    queuePendingDel: typeof queuePendingDel,
    strategyName: typeof strategyName,
    pickMatchesByStrategy: typeof pickMatchesByStrategy,
    builtinTotal: typeof BUILTIN_WB_TOTAL !== 'undefined' ? BUILTIN_WB_TOTAL : null,
    rescueBtn: !!Array.prototype.slice.call(document.querySelectorAll('button')).find(b => b.textContent.trim() === '数据自检')
  }));
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
