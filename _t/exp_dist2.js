// 验证「段遍历顺序等间隔铺开」的效果（用 vm 隔离两个版本，避免相互污染）
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);
function findIdx(fn, from) { for (let i = from || 0; i < lines.length; i++) if (fn(lines[i])) return i; return -1; }
function extractFn(sig) {
  const s = findIdx(l => l.startsWith(sig));
  if (s < 0) throw new Error('fn not found: ' + sig);
  let depth = 0, started = false;
  for (let i = s; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth === 0) return lines.slice(s, i + 1).join('\n');
  }
  throw new Error('fn end not found: ' + sig);
}
function extractVarObject(name) {
  const s = findIdx(l => l.startsWith('var ' + name + ' = {'));
  let depth = 0, started = false;
  for (let i = s; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth === 0) return lines.slice(s, i + 1).join('\n').replace(/;\s*$/, '');
  }
  throw new Error('var end not found: ' + name);
}
const b64Start = findIdx(l => l.indexOf('<script id="builtinCet6B64"') >= 0);
const b64End = findIdx(l => l.trim() === '</script>', b64Start);
const tsv = Buffer.from(lines.slice(b64Start + 1, b64End).join('').replace(/\s+/g, ''), 'base64').toString('utf-8');
const BUILTIN = [];
tsv.split('\n').forEach(line => { if (!line) return; const t = line.indexOf('\t'); if (t <= 0) return; BUILTIN.push({ lemma: line.substring(0, t), meaning: line.substring(t + 1), wordbookId: 'wb_builtin_cet6' }); });

const BASE_CODE = [
  extractVarObject('CONTEXT_DICT'),
  extractFn('function extractTriggersFromMeaning(meaning, strict) {'),
  extractFn('function computeParaDist(matches, paragraphs) {'),
  extractFn('function pickMatchesByStrategy(noOverlap, paragraphs, target, strategy, perParaMax, maxRepeat) {'),
  extractFn('function generateContextMatches(chapter, words, repeatMode, targetWords, opts) {')
].join('\n\n');

const OLD_BLOCK = `  function round() {
    var added = 0;
    var order = [];
    for (var i = 0; i < P; i++) order.push(i);
    order.sort(function(a, b) { return (used[a] - used[b]) || (a - b); });`;
const NEW_BLOCK = `  function round() {
    var added = 0;
    var order = baseOrder.slice();
    order.sort(function(a, b) { return used[a] - used[b]; });`;
const BASE_ORDER_DECL = `  var baseOrder = (function () {
    var n = Math.min(Math.max(1, target), P);
    if (n >= P) { var a = []; for (var i = 0; i < P; i++) a.push(i); return a; }
    var pri = [], seen = {}, stride = P / n;
    for (var k = 0; k < n; k++) {
      var idx = Math.round(k * stride) % P;
      while (seen[idx]) idx = (idx + 1) % P;
      seen[idx] = true; pri.push(idx);
    }
    var rest = [];
    for (var j = 0; j < P; j++) if (!seen[j]) rest.push(j);
    return pri.concat(rest);
  })();
`;

if (BASE_CODE.indexOf(OLD_BLOCK) < 0) throw new Error('改进锚点没找到');
const FIXED_CODE = BASE_CODE.replace(OLD_BLOCK, BASE_ORDER_DECL + NEW_BLOCK);

function loadGen(code) {
  const ctx = { console, Math, JSON, Object, Array, String, Number, parseInt, parseFloat, RegExp, Date };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.__gen = generateContextMatches;', ctx);
  return ctx.__gen;
}
const genOld = loadGen(BASE_CODE);
const genNew = loadGen(FIXED_CODE);

const ARTICLE = JSON.parse(fs.readFileSync('G:/英语学习工作台/_t/_article.json', 'utf-8'));
const chapter = { id: 'ch1', title: '第一章 祖母的教养方式', content: ARTICLE.join('\n\n'), targetWords: 30 };

function stat(res) {
  const d = res.paraDist, P = d.length;
  const blank = d.filter(x => x === 0).length;
  const ft = Math.max(1, Math.round(P / 3));
  let front = 0, all = 0;
  for (let i = 0; i < P; i++) { all += d[i]; if (i < ft) front += d[i]; }
  return { d: d.join('/'), blank, pct: all ? Math.round(front / all * 100) : 0, all, uniq: res.uniqueCount };
}

console.log('段落数 P =', ARTICLE.length, ' 词库 =', BUILTIN.length, '\n');
console.log('target  改前（现状）                              改后（等间隔铺开）');
console.log('-'.repeat(112));
for (const target of [8, 10, 14, 18, 20, 24, 30, 40]) {
  const optsBase = { strategy: 'balanced', perParaMax: 4, maxRepeatPerWord: 2, strictTrigger: true };
  const a = stat(genOld(chapter, BUILTIN, 'all', target, optsBase));
  const b = stat(genNew(chapter, BUILTIN, 'all', target, optsBase));
  console.log(`${String(target).padEnd(6)} ${a.d.padEnd(40)} 空${String(a.blank).padEnd(3)}前${String(a.pct + '%').padEnd(5)}  ${b.d.padEnd(40)} 空${String(b.blank).padEnd(3)}前${b.pct + '%'}`);
}
console.log('\n其他策略回归（应不受影响）：');
for (const st of ['sequential', 'length']) {
  const o = { strategy: st, perParaMax: 4, maxRepeatPerWord: 2, strictTrigger: true };
  const a = stat(genOld(chapter, BUILTIN, 'all', 10, o));
  const b = stat(genNew(chapter, BUILTIN, 'all', 10, o));
  console.log(`  ${st.padEnd(11)} 改前 ${a.d.padEnd(40)}  (空${a.blank})   改后 ${b.d}  (空${b.blank})`);
}
console.log('\ntarget=30 时的词数一致性：改前', stat(genOld(chapter, BUILTIN, 'all', 30, { strategy: 'balanced', perParaMax: 4, maxRepeatPerWord: 2 })).all,
  ' 改后', stat(genNew(chapter, BUILTIN, 'all', 30, { strategy: 'balanced', perParaMax: 4, maxRepeatPerWord: 2 })).all);
