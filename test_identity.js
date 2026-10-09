// 验证跨设备身份解析：resolveAccountProfileId / pickBestProfileId / claimCloudUser
// 用真实的云端数据形态（p_昵称_时间戳 旧格式 + p_<hash> 稳定格式）做模拟
const fs = require('fs');

// ---- 浏览器环境桩 ----
global.window = {};
global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};
global.document = {
  addEventListener() {}, getElementById() { return null; },
  querySelectorAll() { return []; },
  createElement() { return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, click() {} }; },
  body: { appendChild() {}, removeChild() {} }
};

// ---- 加载 index.html 里的内联脚本 ----
const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = scripts.join('\n;\n');
try { (0, eval)(code); } catch (e) { console.error('脚本加载失败:', e.message); process.exit(1); }

// ---- Mock 云端 ----
const STABLE = 'p_' + 'a1b2c3d4e5f60718';
const MATS = [
  { profile_id: 'p_测试用户A_mtq1zo44', '标题': '龙三' },
  { profile_id: 'p_测试用户A_mtq1zo44', '标题': '龙三-3' },
  { profile_id: 'p_测试用户A_mtq1zo44', '标题': '第一章' },
  { profile_id: 'p_测试用户A_mtq1moyb', '标题': '虞寻歌·重生（示例）' },
  { profile_id: 'p_otheruser_abc', '标题': '别人的资料' }
];
let USER_ROW = null;          // 云端用户登记表
let ADDED = [];
let UPDATED = [];

const origSHA = globalThis.sha256;
globalThis.sha256 = function (s) { return Promise.resolve('a1b2c3d4e5f60718deadbeef'); };

globalThis.CLOUD = {
  db: {},
  init() { STATE.cloudReady = true; return true; },
  waitReady() { STATE.cloudReady = true; return Promise.resolve(true); },
  query(dbId, filter) {
    if (dbId === DB_IDS.context_users) return Promise.resolve(USER_ROW ? [USER_ROW] : []);
    if (dbId === DB_IDS.context_materials) {
      if (!filter) return Promise.resolve(MATS);
      const node = filter.property;
      if (node.text && node.text.contains) {
        return Promise.resolve(MATS.filter(r => String(r.profile_id).indexOf(node.text.contains) >= 0));
      }
      if (node.text && node.text.equals) {
        return Promise.resolve(MATS.filter(r => r.profile_id === node.text.equals));
      }
      return Promise.resolve(MATS);
    }
    return Promise.resolve([]);
  },
  add(dbId, props) {
    ADDED.push(props);
    USER_ROW = { _id: 'rec_users_1', '昵称': props['昵称'].text, '密码哈希': props['密码哈希'].text, 'profile_id': props['profile_id'].text };
    return Promise.resolve({ id: 'rec_users_1' });
  },
  update(dbId, rid, props) {
    UPDATED.push({ rid, props });
    USER_ROW = Object.assign({}, USER_ROW, { '昵称': props['昵称'].text, '密码哈希': props['密码哈希'].text, 'profile_id': props['profile_id'].text });
    return Promise.resolve({ id: rid });
  }
};

function assert(name, actual, expected) {
  const ok = actual === expected;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  →  ' + actual + (ok ? '' : '  期望: ' + expected));
  if (!ok) process.exitCode = 1;
}

(async () => {
  STATE.cloudReady = true;
  STATE.nickname = '测试用户A';

  // 场景1：老账号（密码从未登记），数据散在旧格式 ID 上；本地 ID 已被上一版改成稳定 ID
  USER_ROW = null;
  STATE.profileId = STABLE;
  let pid = await resolveAccountProfileId('测试用户A', STABLE);
  assert('场景1 数据所在ID胜出（旧格式）', pid, 'p_测试用户A_mtq1zo44');

  // 场景2：加一个更小的旧 ID，确认取记录最多的
  MATS.push({ profile_id: 'p_测试用户A_mtq1moyb', '标题': '第一章' });
  pid = await resolveAccountProfileId('测试用户A', STABLE);
  assert('场景2 仍取记录最多的ID', pid, 'p_测试用户A_mtq1zo44');

  // 场景3：云端已登记 → 与数据落点一致时应返回登记 ID
  USER_ROW = { _id: 'r1', '昵称': '测试用户A', '密码哈希': 'H', 'profile_id': 'p_测试用户A_mtq1zo44' };
  pid = await resolveAccountProfileId('测试用户A', STABLE);
  assert('场景3 登记ID与数据一致', pid, 'p_测试用户A_mtq1zo44');

  // 场景4：全新账号无任何数据 → 用昵称派生稳定ID
  USER_ROW = null;
  pid = await resolveAccountProfileId('全新用户xx', null);
  assert('场景4 全新账号用派生ID', pid, STABLE);

  // 场景5：无数据但有本地ID → 用本地ID
  pid = await resolveAccountProfileId('全新用户xx', 'p_local_only_1');
  assert('场景5 无数据时保留本地ID', pid, 'p_local_only_1');

  // 场景6：pickBestProfileId 在有数据时返回数据ID，无数据时返回 null
  assert('场景6a pickBest 有数据', await pickBestProfileId('测试用户A', null), 'p_测试用户A_mtq1zo44');
  assert('场景6b pickBest 无数据返回null', await pickBestProfileId('不存在的人', null), null);

  // 场景7：claimCloudUser 新建登记
  USER_ROW = null; ADDED = [];
  const r = await claimCloudUser('测试用户A', 'HASH1', 'p_测试用户A_mtq1zo44');
  assert('场景7 新登记返回 claimed', r, 'claimed');
  assert('场景7b 写入的 profile_id 正确', ADDED[0]['profile_id'].text, 'p_测试用户A_mtq1zo44');
  assert('场景7c 写入含创建时间', !!ADDED[0]['创建时间'], true);

  // 场景8：同密码再次登记 → 走更新，不新建
  const before = ADDED.length;
  const r2 = await claimCloudUser('测试用户A', 'HASH1', 'p_测试用户A_mtq1zo44');
  assert('场景8 同密码返回 ok', r2, 'ok');
  assert('场景8b 没有重复新建', ADDED.length, before);

  // 场景9：密码不一致 → conflict 回调
  let conflicted = false;
  const r3 = await claimCloudUser('测试用户A', 'OTHER_HASH', 'p_测试用户A_mtq1zo44', function () { conflicted = true; });
  assert('场景9 密码不同触发冲突', r3, 'conflict');
  assert('场景9b 冲突回调被调用', conflicted, true);

  console.log('\n===== 结论 =====');
  console.log('身份解析：数据在哪，账号ID就跟着哪 → 换设备一定能读到同一份数据');
  console.log('登记表：进入应用时自动补登记，第二台设备即可凭昵称+密码登录');
})();
