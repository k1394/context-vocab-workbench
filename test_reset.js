// 忘记密码（重设密码）逻辑测试
// 只测纯逻辑，绝不碰真实云端
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

// ---------- 一、源码痕迹 ----------
group('一、源码里该有的都在');
function has(s) { return HTML.indexOf(s) >= 0; }
ok('有「忘记密码」入口文案', has('忘记密码？点这里重设'));
ok('有「返回登录」入口', has('← 返回登录'));
ok('有 resetForm 容器', has('id="resetForm"'));
ok('有昵称输入框', has('id="resetNick"'));
ok('有两次密码输入框', has('id="resetPass1"') && has('id="resetPass2"'));
ok('有重设按钮', has('id="resetBtn"'));
ok('有错误提示区', has('id="resetErr"'));
ok('按钮调 doResetPassword()', has('onclick="doResetPassword()"'));
ok('入口调 toggleResetForm()', has('onclick="toggleResetForm();return false"'));

// 关键：不能假装能找回原密码
ok('★ 明确写了「原密码找不回来」', has('原密码找不回来'));
ok('★ 明确警告别用他人昵称', has('请不要用昵称相同的他人账号'));

// ---------- 二、把模块抽出来跑 ----------
group('二、逻辑跑起来');

const modStart = HTML.indexOf('var RESET_FIELDS_ON = false;');
const modEnd = HTML.indexOf('/* ===== 内置词书《六级词书》 ===== */');
ok('能定位到 reset 模块', modStart >= 0 && modEnd > modStart, [modStart, modEnd]);
const moduleCode = HTML.slice(modStart, modEnd);

const CALLS = { update: 0, add: 0, login: 0 };
let LSSTORE = {};
let CLOUD_ROWS = [];
let WAIT_OK = true;
let UPDATE_FAIL = false;

const DOM = {
  loginForm: { style: {} },
  resetForm: { style: { display: 'none' } },
  resetNick: { value: '' },
  resetPass1: { value: '' },
  resetPass2: { value: '' },
  resetErr: { textContent: '' },
  resetBtn: { disabled: false },
  loginNick: { value: '' }
};

const sandbox = {
  document: { getElementById: id => DOM[id] || null },
  LS: { get: (k, d) => (LSSTORE[k] !== undefined ? LSSTORE[k] : d), set: (k, v) => { LSSTORE[k] = v; } },
  DB_IDS: { context_users: 'DB_USERS' },
  CLOUD: {
    waitReady: () => Promise.resolve(WAIT_OK),
    update: (dbId, rowId, props) => {
      CALLS.update++;
      if (UPDATE_FAIL) return Promise.reject(new Error('boom'));
      // 模拟云端真的改掉了
      for (let i = 0; i < CLOUD_ROWS.length; i++) {
        if (CLOUD_ROWS[i]._id === rowId) {
          CLOUD_ROWS[i]['密码哈希'] = props['密码哈希'].text;
        }
      }
      return Promise.resolve({ ok: true });
    }
  },
  queryCloudUserByNick: nick => {
    const hit = CLOUD_ROWS.filter(r => r['昵称'] === nick);
    return Promise.resolve(hit.length ? hit[0] : null);
  },
  finalizeLogin: (nick, hash, pid) => { CALLS.login++; DOM.__loggedIn = { nick, hash, pid }; },
  STATE: { cloudUserId: null, profileId: null, nickname: null },
  nowISO: () => '2026-10-02T00:00:00Z',
  console: console
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const names = Object.keys(sandbox);
const vals = names.map(n => sandbox[n]);
const vm = require('vm');
const ctx = vm.createContext(sandbox);
try {
  vm.runInContext('sha256 = function(s){ return Promise.resolve("H_" + s); }', ctx);
  vm.runInContext(moduleCode, ctx);
} catch (e) {
  ok('模块能加载', false, String(e));
}

const F = ctx;
ok('模块能加载', typeof F.doResetPassword === 'function');
ok('toggleResetForm 是函数', typeof F.toggleResetForm === 'function');
ok('updateLocalPassHash 是函数', typeof F.updateLocalPassHash === 'function');

// ---------- 三、表单切换 ----------
group('三、点「忘记密码」能切到重设表单');
DOM.loginForm.style.display = '';
F.toggleResetForm();
ok('★ 重设表单显示出来', DOM.resetForm.style.display === '', DOM.resetForm.style.display);
ok('★ 登录表单隐藏了', DOM.loginForm.style.display === 'none', DOM.loginForm.style.display);
ok('昵称自动带过来了', DOM.resetNick.value === DOM.loginNick.value || DOM.resetNick.value === '', DOM.resetNick.value);
F.toggleResetForm();
ok('再点一次切回登录', DOM.resetForm.style.display === 'none' && DOM.loginForm.style.display === '', {
  reset: DOM.resetForm.style.display, login: DOM.loginForm.style.display
});

// ---------- 四、校验 ----------
group('四、输入校验');
function resetWith(nick, p1, p2, keepFailFlag) {
  DOM.resetNick.value = nick;
  DOM.resetPass1.value = p1;
  DOM.resetPass2.value = p2;
  DOM.resetErr.textContent = '';
  CALLS.update = 0; CALLS.login = 0;
  if (!keepFailFlag) UPDATE_FAIL = false;
  DOM.__loggedIn = null;
  return F.doResetPassword();
}

(async () => {
  await resetWith('', 'abc123', 'abc123');
  await new Promise(r => setTimeout(r, 20));
  ok('昵称为空 → 报错且不改云端', DOM.resetErr.textContent === '请输入昵称' && CALLS.update === 0, DOM.resetErr.textContent);

  await resetWith('测试用户A', '123', '123');
  await new Promise(r => setTimeout(r, 20));
  ok('密码不足 6 位 → 报错', DOM.resetErr.textContent === '新密码至少 6 位' && CALLS.update === 0, DOM.resetErr.textContent);

  await resetWith('测试用户A', 'abc123', 'abc999');
  await new Promise(r => setTimeout(r, 20));
  ok('两次不一致 → 报错', DOM.resetErr.textContent === '两次输入的密码不一致' && CALLS.update === 0, DOM.resetErr.textContent);

  // ---------- 五、正常路径 ----------
  group('五、昵称对 → 真的改掉云端哈希并自动登录');
  LSSTORE = { users: [{ nick: '测试用户A', passHash: 'H_old_old', profileId: 'p_xiangzhi_123' }] };
  CLOUD_ROWS = [{ _id: 'row_1', '昵称': '测试用户A', '密码哈希': 'H_old_old', profile_id: 'p_xiangzhi_123' }];
  await resetWith('测试用户A', 'newpass123', 'newpass123');
  await new Promise(r => setTimeout(r, 60));
  ok('★ 调了 CLOUD.update 一次', CALLS.update === 1, CALLS);
  ok('★ 云端那条的密码哈希真的被改掉了',
    CLOUD_ROWS[0]['密码哈希'] === 'H_newpass123', CLOUD_ROWS[0]['密码哈希']);
  ok('★ 本机 users 也同步改了', LSSTORE.users[0].passHash === 'H_newpass123', LSSTORE.users[0].passHash);
  ok('★ profile_id 没被改坏', LSSTORE.users[0].profileId === 'p_xiangzhi_123', LSSTORE.users[0].profileId);
  ok('★ 重设完自动登录，不用再手输一遍', CALLS.login === 1 && !!DOM.__loggedIn, DOM.__loggedIn);
  ok('★ 登录用的是新密码哈希', DOM.__loggedIn && DOM.__loggedIn.hash === 'H_newpass123');

  // ---------- 六、昵称不存在 ----------
  group('六、昵称写错 → 明确提示，不乱改');
  CALLS.update = 0; CALLS.login = 0;
  await resetWith('不存在的人', 'abc123', 'abc123');
  await new Promise(r => setTimeout(r, 60));
  ok('★ 提示云端没这个账号', /云端没有/.test(DOM.resetErr.textContent), DOM.resetErr.textContent);
  ok('★ 没有调用 update', CALLS.update === 0, CALLS.update);
  ok('★ 没有登录进去', CALLS.login === 0, CALLS.login);

  // ---------- 七、云端不可达 ----------
  group('七、云端连不上 → 说清原因，不改本地');
  WAIT_OK = false;
  CALLS.update = 0;
  await resetWith('测试用户A', 'abc123', 'abc123');
  await new Promise(r => setTimeout(r, 40));
  ok('★ 提示连不上云端', /连不上云端/.test(DOM.resetErr.textContent), DOM.resetErr.textContent);
  ok('★ 没动云端', CALLS.update === 0);
  WAIT_OK = true;

  // ---------- 八、云端更新失败 ----------
  group('八、云端返回失败 → 提示重试，不把用户丢在半路');
  UPDATE_FAIL = true;
  CALLS.update = 0; CALLS.login = 0;
  DOM.__loggedIn = null;
  await resetWith('测试用户A', 'abc123', 'abc123', true);
  await new Promise(r => setTimeout(r, 120));
  ok('★ 提示重设失败', /重设失败/.test(DOM.resetErr.textContent), DOM.resetErr.textContent);
  ok('★ 没登录进去（避免用错密码）', CALLS.login === 0 && !DOM.__loggedIn, { login: CALLS.login, at: DOM.__loggedIn });
  UPDATE_FAIL = false;

  // ---------- 九、本机没有该账号时也能建 ----------
  group('九、本机没有该账号记录 → 也照样建一条（换设备场景）');
  LSSTORE = { users: [] };
  CLOUD_ROWS = [{ _id: 'row_9', '昵称': '测试用户A', '密码哈希': 'H_x', profile_id: 'p_xz_9' }];
  await resetWith('测试用户A', 'brandnew1', 'brandnew1');
  await new Promise(r => setTimeout(r, 60));
  ok('★ 本机补建了一条记录', LSSTORE.users.length === 1 && LSSTORE.users[0].nick === '测试用户A', LSSTORE.users);
  ok('★ 用的是新密码哈希', LSSTORE.users[0].passHash === 'H_brandnew1');

  const pass = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log('忘记密码回归：' + pass + '/' + results.length + ' 通过');
  const failed = results.filter(r => !r.pass);
  if (failed.length) {
    console.log('失败项：');
    failed.forEach(r => console.log('  ✗ ' + r.name));
    process.exit(1);
  }
})();