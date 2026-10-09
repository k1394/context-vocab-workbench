// 验证同步队列：限流、重试、失败兜底、计数重置
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);

function extractBlock(startRe, endRe) {
  let s = -1, e = -1;
  for (let i = 0; i < lines.length; i++) {
    if (s === -1 && startRe.test(lines[i])) s = i;
    else if (s !== -1 && endRe.test(lines[i])) { e = i; break; }
  }
  if (s === -1 || e === -1) throw new Error('block not found: ' + startRe);
  return lines.slice(s, e + 1).join('\n');
}

// 提取 CLOUD + 同步队列代码（到 updateSyncBadge 之前的注释为止）
const cloudCode = extractBlock(/^var CLOUD = \{/, /^\/\/ ===== 同步状态 UI/);

// Mock 环境
var STATE = { cloudReady: true };
var updateSyncBadgeCalls = 0;
function updateSyncBadge() { updateSyncBadgeCalls++; }
var saveLocalCalls = 0;
function saveLocal() { saveLocalCalls++; }

// Mock 后端：可控成功/失败
var backendCalls = [];
var failSet = new Set(); // 存放应失败的 props.__tag
// ★ 每个 tag 只在「第一次尝试」失败一次，之后一律成功。
//   原来是 setTimeout(25ms) 后清空 failSet —— 那是个竞态：
//   mock 的响应延迟是 Math.random()*10，队列本身还有退避，
//   只要 w5 的首次尝试落到 25ms 之后，它就一次都不失败，
//   重试统计变成 3 而断言要 4 → 同一个测试时好时坏（实测 3 次里挂 2 次）。
//   按「尝试次数」判定，和时序无关，测的才是它声称的那件事。
var attempts = {};
const mockDb = {
  addRecord: function(p) {
    var tag = p.properties.__tag;
    backendCalls.push(tag);
    return new Promise(res => setTimeout(() => {
      if (failSet.has(tag) && !attempts[tag]) { attempts[tag] = 1; res(null); return; } // 只失败第一次
      res({ id: 'cloud_' + tag });
    }, Math.random() * 10));
  },
  updateRecord: function() { return Promise.resolve({ id: 'x' }); },
  deleteRecord: function() { return Promise.resolve({}); }
};

eval(cloudCode);
CLOUD.db = mockDb;

// 测试 1：20 个写入，其中 #5 和 #12 第一次失败（重试后成功）
failSet.add('w5'); failSet.add('w12');
let resolved = 0;
const N = 20;
for (let i = 0; i < N; i++) {
  const tag = 'w' + i;
  // 第一次失败后重试应成功 → 从 failSet 移除
  CLOUD.add('db1', { __tag: tag }).then(r => {
    resolved++;
    if (!r || !r.id) console.error('FAIL: 未获得 id for', tag);
  });
}
// 失败由 mockDb 内部按「第一次尝试」判定，这里不再用定时器清 failSet（那是竞态）

setTimeout(() => {
  console.log('=== 队列测试 ===');
  console.log('后端收到调用:', backendCalls.length, '次（20 原始 + 2 重试 = 22 预期）');
  console.log('前端 resolve:', resolved, '/', N);
  console.log('SYNC_DONE:', SYNC_DONE, '| SYNC_TOTAL:', SYNC_TOTAL);
  console.log('updateSyncBadge 调用次数 >0:', updateSyncBadgeCalls > 0 ? '✓' : '✗');
  console.log('saveLocal 在排空后调用:', saveLocalCalls > 0 ? '✓' : '✗');
  const retryCount = backendCalls.filter(t => t === 'w5' || t === 'w12').length;
  console.log('w5/w12 各被调用 2 次（含重试）:', retryCount === 4 ? '✓' : '✗ 实际 ' + retryCount);

  // 测试 2：新一轮同步计数重置
  CLOUD.add('db1', { __tag: 'new1' }).then(() => {
    console.log('新一轮 SYNC_TOTAL = 1（已重置）:', SYNC_TOTAL === 1 ? '✓' : '✗ 实际 ' + SYNC_TOTAL);
    process.exit(0);
  });
}, 800);
