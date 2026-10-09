// 线上 v24 探针：忘记密码入口
// ⚠️ 全程不碰真实云端：只验 UI 存在、表单能切换、校验会拦。
//    真正改密码的那一步交给你自己做（这里跑会动你的真实账号）。
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  const f = page.frames().find(fr => /index\.html/.test(fr.url()));
  ok('找到页面帧', !!f, f && f.url());
  console.log('    帧 URL: ' + (f ? f.url() : ''));
  await f.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });

  // ---------- 一、版本与模块 ----------
  group('一、版本与函数');
  const v = await f.evaluate(() => ({
    url: location.href,
    doReset: typeof window.doResetPassword,
    toggle: typeof window.toggleResetForm,
    upd: typeof window.updateLocalPassHash
  }));
  ok('★ 帧是 v24', /\/24\//.test(v.url), v.url);
  ok('★ doResetPassword 是函数', v.doReset === 'function', v.doReset);
  ok('toggleResetForm 是函数', v.toggle === 'function', v.toggle);
  ok('updateLocalPassHash 是函数', v.upd === 'function', v.upd);

  // ---------- 二、UI 在页面上 ----------
  group('二、登录页上的元素');
  const ui = await f.evaluate(() => {
    const login = document.getElementById('loginForm');
    const reset = document.getElementById('resetForm');
    const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent.indexOf('忘记密码') >= 0);
    return {
      loginShown: login ? getComputedStyle(login).display !== 'none' : null,
      resetExists: !!reset,
      resetHidden: reset ? getComputedStyle(reset).display === 'none' : null,
      hasNick: !!document.getElementById('resetNick'),
      hasP1: !!document.getElementById('resetPass1'),
      hasP2: !!document.getElementById('resetPass2'),
      hasBtn: !!document.getElementById('resetBtn'),
      hasErr: !!document.getElementById('resetErr'),
      linkText: link ? link.textContent.trim() : null,
      bodyHasWarn: document.body.innerHTML.indexOf('原密码找不回来') >= 0,
      bodyHasNickWarn: document.body.innerHTML.indexOf('请不要用昵称相同的他人账号') >= 0
    };
  });
  ok('★ 登录表单默认显示', ui.loginShown === true, ui.loginShown);
  ok('★ 重设表单默认隐藏但存在', ui.resetExists && ui.resetHidden === true, { e: ui.resetExists, h: ui.resetHidden });
  ok('★ 有「忘记密码？点这里重设」入口', !!ui.linkText, ui.linkText);
  ok('昵称 / 两次密码 / 按钮 / 错误区都在', ui.hasNick && ui.hasP1 && ui.hasP2 && ui.hasBtn && ui.hasErr);
  ok('★ 界面明说「原密码找不回来」', ui.bodyHasWarn === true);
  ok('★ 界面警告别用他人昵称', ui.bodyHasNickWarn === true);

  // ---------- 三、点入口能切过去 ----------
  group('三、点入口切到重设表单');
  await f.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find(x => x.textContent.indexOf('忘记密码') >= 0);
    if (a) a.click();
  });
  await f.waitForTimeout(250);
  const after = await f.evaluate(() => ({
    resetShown: getComputedStyle(document.getElementById('resetForm')).display !== 'none',
    loginHidden: getComputedStyle(document.getElementById('loginForm')).display === 'none',
    btnText: document.getElementById('resetBtn').textContent
  }));
  ok('★ 重设表单显示出来', after.resetShown === true, after);
  ok('★ 登录表单隐藏了', after.loginHidden === true, after);
  ok('按钮文案正确', /重设/.test(after.btnText), after.btnText);

  // ---------- 四、校验（不会碰云端，因为在连云端前就拦住了）----------
  group('四、输入校验');
  const checks = await f.evaluate(async () => {
    const out = {};
    const nick = document.getElementById('resetNick');
    const p1 = document.getElementById('resetPass1');
    const p2 = document.getElementById('resetPass2');
    const err = document.getElementById('resetErr');
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    nick.value = ''; p1.value = 'abc123'; p2.value = 'abc123';
    err.textContent = ''; doResetPassword(); await sleep(120);
    out.emptyNick = err.textContent;

    nick.value = '测试用户A'; p1.value = '123'; p2.value = '123';
    err.textContent = ''; doResetPassword(); await sleep(120);
    out.shortPass = err.textContent;

    nick.value = '测试用户A'; p1.value = 'abc123'; p2.value = 'abc999';
    err.textContent = ''; doResetPassword(); await sleep(120);
    out.mismatch = err.textContent;

    return out;
  });
  ok('★ 昵称为空被拦下', checks.emptyNick === '请输入昵称', checks.emptyNick);
  ok('★ 密码不足 6 位被拦下', /至少 6 位/.test(checks.shortPass), checks.shortPass);
  ok('★ 两次不一致被拦下', /不一致/.test(checks.mismatch), checks.mismatch);

  // ---------- 五、能切回登录 ----------
  group('五、返回登录');
  await f.evaluate(() => { toggleResetForm(); });
  await f.waitForTimeout(200);
  const back = await f.evaluate(() => ({
    loginShown: getComputedStyle(document.getElementById('loginForm')).display !== 'none',
    resetHidden: getComputedStyle(document.getElementById('resetForm')).display === 'none'
  }));
  ok('★ 切回登录表单', back.loginShown === true && back.resetHidden === true, back);

  group('六、运行期异常');
  ok('★ 无未捕获异常', errors.length === 0, errors);

  const pass = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log('线上 v24 探针：' + pass + '/' + results.length + ' 通过');
  const failed = results.filter(r => !r.pass);
  if (failed.length) { console.log('失败项：'); failed.forEach(r => console.log('  ✗ ' + r.name)); }
  await browser.close();
})();