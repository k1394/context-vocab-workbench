const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('http://127.0.0.1:8933/index.html', { waitUntil: 'load' });
  await p.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });
  const r = await p.evaluate(() => {
    const el = document.getElementById('noteDrawLayer');
    const cs = getComputedStyle(el);
    const host = el.parentElement;
    const hcs = getComputedStyle(host);
    return {
      elPos: cs.position, elClass: el.className, elId: el.id,
      hostTag: host.tagName, hostClass: (host.className||'').toString().slice(0,40),
      hostPos: hcs.position, hostId: host.id,
      // 有没有别处的样式覆盖了
      matched: Array.from(document.styleSheets).flatMap(ss => {
        try { return Array.from(ss.cssRules); } catch(e) { return []; }
      }).filter(r2 => (r2.selectorText||'').indexOf('note-draw-layer')>=0).map(r2=>r2.cssText)
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
