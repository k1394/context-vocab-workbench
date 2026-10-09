// 从业务表的 profile_id 里反查昵称（只读）
// profile_id 格式：p_<昵称>_<时间戳>
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  const f = page.frames().find(fr => /index\.html/.test(fr.url()));
  await f.waitForFunction(() => typeof CLOUD !== 'undefined' && typeof DB_IDS !== 'undefined', { timeout: 40000 });

  const out = await f.evaluate(async () => {
    const res = { ready: false, err: null, pids: {}, tables: {} };
    res.ready = !!(STATE && STATE.cloudReady);
    try {
      res.users = (await CLOUD.query(DB_IDS.context_users, {})) || [];
      // 只留昵称
      res.users = res.users.map(x => ({ nick: x['昵称'], pid: x['profile_id'] }));
      const mats = (await CLOUD.query(DB_IDS.context_materials, {})) || [];
      res.tables['资料'] = mats.length;
      mats.forEach(m => { if (m['profile_id']) res.pids[m['profile_id']] = (res.pids[m['profile_id']] || 0) + 1; });
      const wbs = (await CLOUD.query(DB_IDS.context_wordbooks, {})) || [];
      res.tables['单词书'] = wbs.length;
      wbs.forEach(m => { if (m['profile_id']) res.pids[m['profile_id']] = (res.pids[m['profile_id']] || 0) + 1; });
      const ws = (await CLOUD.query(DB_IDS.context_words, {})) || [];
      res.tables['词'] = ws.length;
      ws.forEach(m => { if (m['profile_id']) res.pids[m['profile_id']] = (res.pids[m['profile_id']] || 0) + 1; });
    } catch (e) { res.err = String(e); }
    return res;
  });

  console.log('云端就绪:', out.ready, out.err ? ('错误: ' + out.err) : '');
  console.log('各表记录数:', JSON.stringify(out.tables));
  console.log('账号表条数:', (out.users || []).length);
  (out.users || []).forEach(u => console.log('  账号表 →', u.nick, u.pid));
  console.log('出现过的 profile_id:');
  Object.keys(out.pids).sort().forEach(p => console.log('  ' + p + '   （记录数 ' + out.pids[p] + '）'));
  await browser.close();
})();