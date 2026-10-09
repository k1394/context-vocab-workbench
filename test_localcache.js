// 差异写盘（saveLocalKey）的比对缓存回归
// 核心命题：既要真的省掉重复序列化/写盘，又绝不能因为缓存陈旧而漏写 —— 后者是丢数据。
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);

function sliceFrom(startRe, endRe) {
  let s = -1;
  for (let i = 0; i < lines.length; i++) {
    if (s === -1) { if (startRe.test(lines[i])) s = i; continue; }
    if (endRe.test(lines[i])) return lines.slice(s, i + 1).join('\n');
  }
  throw new Error('block not found: ' + startRe + ' .. ' + endRe);
}

// 从构建产物里取真实代码，而不是抄一份 —— 抄一份就测不到真正的实现
const lsSrc = sliceFrom(/^var LS = \{/, /^\};/);
// saveLocal 的最后一行是 notes_v1_，收尾的 } 在它下一行 —— 补回来，否则 eval 语法不完整
const cacheSrc = sliceFrom(/^var _LS_WRITTEN = \{\};/, /notes_v1_' \+ pid, STATE\.notes\);/) + '\n}';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function group(t) { console.log('\n' + t); }

// ---------- mock 环境 ----------
var LS_PREFIX = 'ctx_vocab_';
var disk = {};
var writes = [];
var failKeyOnce = null;
var localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(disk, k) ? disk[k] : null; },
  setItem: function (k, v) {
    if (failKeyOnce === k) { failKeyOnce = null; var e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    disk[k] = String(v); writes.push(k);
  },
  removeItem: function (k) { delete disk[k]; }
};
var BUILTIN_WB_ID = 'builtin_cet6';
var STATE = {
  profileId: 'p1', materials: [], wordbooks: [], words: [], chapters: {},
  matches: {}, progress: { m1: { c1: { scrollPct: 0 } } }, sessions: {}, mastery: {},
  vocab: {}, synonyms: {}, answers: {}, reviewQueue: [], notes: {}, learnOpts: null
};

eval(lsSrc);
eval(cacheSrc);

group('一、基本行为');
writes.length = 0;
ok('saveLocalKey 首次写盘', saveLocalKey('k1', { a: 1 }) === true && writes.length === 1, writes);
ok('磁盘上真的有值', disk['ctx_vocab_k1'] === '{"a":1}', disk['ctx_vocab_k1']);
ok('内容没变 → 不重复写（这是省下来的那笔）', saveLocalKey('k1', { a: 1 }) === true && writes.length === 1, writes);
ok('内容变了 → 会写', saveLocalKey('k1', { a: 2 }) === true && writes.length === 2, writes);
ok('原地 push 也能被发现', (function () {
  var arr = [1];
  saveLocalKey('k2', arr); var n = writes.length;
  arr.push(2); saveLocalKey('k2', arr);
  return writes.length === n + 1;
})());

group('二、★ 缓存陈旧守门：绕过 saveLocalKey 的直写不能导致漏写');
{
  writes.length = 0;
  LS.set('k3', { b: 1 });                       // 直写（项目里 users/learnOpts/matches 都这么写）
  ok('直写后缓存同步 → 相同内容不重复写', (function () {
    var n = writes.length; saveLocalKey('k3', { b: 1 }); return writes.length === n;
  })());
  LS.set('k3', { b: 9 });                       // 又一次直写，磁盘变成 b:9
  var before = writes.length;
  saveLocalKey('k3', { b: 1 });                 // 现在要写的是 b:1，和磁盘不一致 → 必须写
  ok('★ 磁盘被直写改过之后，同 key 的新内容必须落盘（否则丢数据）',
    writes.length === before + 1 && disk['ctx_vocab_k3'] === '{"b":1}', disk['ctx_vocab_k3']);
}

group('三、写失败不能记账（否则再也不会重试）');
{
  writes.length = 0;
  failKeyOnce = 'ctx_vocab_k4';
  var r1 = saveLocalKey('k4', { c: 1 });
  ok('配额满时返回 false', r1 === false, r1);
  var n = writes.length;
  saveLocalKey('k4', { c: 1 });
  ok('★ 下次仍会重试（没有把失败当成功记进缓存）', writes.length === n + 1, writes.length - n);
}

group('四、resetLocalWriteCache 之后一定重写');
{
  writes.length = 0;
  saveLocalKey('k5', { d: 1 });
  var n = writes.length;
  saveLocalKey('k5', { d: 1 });
  ok('缓存命中 → 不写', writes.length === n);
  resetLocalWriteCache();
  saveLocalKey('k5', { d: 1 });
  ok('作废缓存后 → 重写一次', writes.length === n + 1, writes);
}

group('五、saveLocal 全量：第二次是零写入，改动一个字段只多写一个 key');
{
  resetLocalWriteCache(); writes.length = 0;
  saveLocal();
  var first = writes.length;
  ok('首次 saveLocal 写了一批 key', first > 8, first);
  saveLocal();
  ok('★ 内容没变时，第二次 saveLocal 一次磁盘都不碰', writes.length === first, writes.length - first);
  STATE.progress.m1.c1.scrollPct = 50;
  saveLocal();
  var delta = writes.slice(first).filter(function (k) { return writes.indexOf(k) < first ? false : true; });
  var added = writes.slice(first);
  ok('★ 只滚了一下进度 → 只写 progress 这一个 key',
    added.length === 1 && added[0] === 'ctx_vocab_progress_p1', added);
}

group('六、源码结构断言');
ok('LS.set 会同步写盘缓存', /_LS_WRITTEN\[key\] = __s;/.test(lsSrc), true);
ok('LS.setJSON 会同步写盘缓存', /_LS_WRITTEN\[key\] = json;/.test(lsSrc), true);
ok('登录/切号时作废缓存', /finalizeLogin\(nick, hash, pid, prevUser, msg\) \{\s*\n\s*\/\/ ★ [^\n]*\n\s*if \(typeof resetLocalWriteCache/.test(html));

console.log('\n' + (fail === 0 ? '差异写盘回归：' + pass + '/' + pass + ' 通过' : '差异写盘回归：通过 ' + pass + ' / 失败 ' + fail));
process.exit(fail === 0 ? 0 : 1);
