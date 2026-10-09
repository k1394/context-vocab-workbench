const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  const f = page.frames().find(fr => /index\.html/.test(fr.url()));
  await f.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });
  const r = await f.evaluate(() => {
    const out = {};
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    // 先看学习页相关的所有祖先
    const btn = document.getElementById('btnNoteMode');
    out.found = !!btn;
    if (btn) {
      out.offsetParent = btn.offsetParent ? (btn.offsetParent.id || btn.offsetParent.tagName + '.' + btn.offsetParent.className) : null;
      out.rect = btn.getBoundingClientRect();
      out.display = getComputedStyle(btn).display;
      const chain = [];
      let e = btn;
      while (e && e !== document.documentElement) {
        const cs = getComputedStyle(e);
        chain.push({ tag: e.tagName, id: e.id || '', cls: (e.className || '').toString().slice(0, 40), display: cs.display, visibility: cs.visibility, hidden: e.classList.contains('hidden') });
        e = e.parentElement;
      }
      out.chain = chain;
      // 哪些祖先有 hidden
      out.hiddenAncestors = chain.filter(c => c.hidden).map(c => (c.id ? '#' : '.') + (c.id || c.cls));
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})();