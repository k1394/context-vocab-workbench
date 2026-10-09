// 列出云端账号表里所有昵称（只读，不改任何数据）
// 绝对不输出 passHash
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  const f = page.frames().find(fr => /index\.html/.test(fr.url()));
  if (!f) { console.log('no frame'); await browser.close(); return; }
  await f.waitForFunction(() => typeof CLOUD !== 'undefined' && typeof DB_IDS !== 'undefined', { timeout: 40000 });

  const rows = await f.evaluate(async () => {
    try {
      const r = await CLOUD.query(DB_IDS.context_users, {});
      return (r || []).map(x => ({
        nick: x['昵称'],
        pid: x['profile_id'],
        created: x['创建时间'],
        // 只标记哈希是否存在，不取值
        hasHash: !!x['密码哈希']
      }));
    } catch (e) {
      return { err: String(e) };
    }
  });

  if (rows.err) { console.log('查询失败:', rows.err); await browser.close(); return; }
  console.log('=== 云端账号表里的账号 ===');
  if (!rows.length) console.log('（空）');
  rows.forEach(r => {
    console.log(`  昵称: ${r.nick}    profile_id: ${r.pid}    登记时间: ${r.created || '(无)'}    密码哈希: ${r.hasHash ? '已存' : '未存'}`);
  });
  await browser.close();
})();