// 只读地列出本机 localStorage 里登记过的账号（昵称 + profile_id）
// 不打印、不使用密码哈希
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  const frames = page.frames();
  const f = frames.find(fr => /index\.html/.test(fr.url()));
  if (!f) { console.log('没找到页面帧'); await browser.close(); return; }
  await f.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 }).catch(() => {});

  const out = await f.evaluate(() => {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const keys = Object.keys(localStorage);
    return {
      users: users.map(u => ({
        nick: u.nick,
        profileId: u.profileId,
        hasPassHash: !!u.passHash,
        passHashLen: (u.passHash || '').length
      })),
      // 其他可能带身份信息的键（只看键名，不读值）
      keysWithUser: keys.filter(k => /user|profile|account|login/i.test(k)),
      currentNickname: (typeof STATE !== 'undefined' && STATE.nickname) || null,
      currentProfileId: (typeof STATE !== 'undefined' && STATE.profileId) || null
    };
  });

  console.log('=== 本机登记过的账号 ===');
  if (!out.users.length) {
    console.log('（localStorage 的 users 是空的 —— 这台机器上没有登��过）');
  } else {
    out.users.forEach(u => {
      console.log(`  昵称: ${u.nick}   profile_id: ${u.profileId}   已存密码哈希: ${u.hasPassHash ? '是' : '否'}（${u.passHashLen} 字符）`);
    });
  }
  console.log('\n=== 当前会话 ===');
  console.log('  昵称:', out.currentNickname);
  console.log('  profile_id:', out.currentProfileId);
  console.log('\n=== 与账号相关的 localStorage 键名 ===');
  console.log(' ', out.keysWithUser.join(', ') || '(无)');

  await browser.close();
})();