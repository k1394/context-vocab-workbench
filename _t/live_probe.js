const { chromium } = require('playwright');
const URL = process.env.URL || 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 40; i++) {
    for (const f of page.frames()) {
      try {
        const r = await f.evaluate(() => ({
          hasState: !!(window.STATE && typeof STATE.words !== 'undefined'),
          hasNewFn: typeof pickMatchesByStrategy,
          hasPicker: !!document.getElementById('wbPickerBtn'),
          url: location.href.slice(0, 90)
        }));
        if (r.hasState) { console.log(JSON.stringify(r, null, 2)); await browser.close(); return; }
      } catch (e) {}
    }
    await page.waitForTimeout(800);
  }
  console.log('未找到应用帧');
  await browser.close();
})();
