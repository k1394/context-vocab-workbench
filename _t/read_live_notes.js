// 读线上 context_notes 表，拿用户那条笔记的真实 ranges
const { chromium } = require('playwright');
const NOTES_DB = 'm2kUmiSs4lBDMG20E37OnX';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('https://www.workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(9000);
  const out = await page.evaluate(async (dbId) => {
    const sp = window.__SMART_PAGE__;
    if (!sp || !sp.database) return { err: '没有注入数据库 SDK', keys: Object.keys(window).filter(k => /SMART|PAGE/i.test(k)) };
    try {
      const r = await sp.database.query({ databaseId: dbId, pageSize: 200 });
      const rows = (r && r.results) || [];
      return {
        n: rows.length,
        rows: rows.map(x => ({
          id: x.id,
          props: Object.keys(x.properties || {}).reduce((a, k) => {
            const v = x.properties[k];
            a[k] = v && (v.text !== undefined ? v.text : (v.number !== undefined ? v.number : v));
            return a;
          }, {})
        }))
      };
    } catch (e) { return { err: String(e) }; }
  }, NOTES_DB);
  console.log(JSON.stringify(out, null, 1).slice(0, 4000));
  await browser.close();
})();
