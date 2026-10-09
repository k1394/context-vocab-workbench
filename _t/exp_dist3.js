// 对比 v19（改前）与当前 index.html（改后）的真实生成算法分布
const fs = require('fs');
const vm = require('vm');

function extractFrom(file) {
  const html = fs.readFileSync(file, 'utf-8');
  const lines = html.split(/\r?\n/);
  const findIdx = (fn, from) => { for (let i = from || 0; i < lines.length; i++) if (fn(lines[i])) return i; return -1; };
  function extractFn(sig) {
    const s = findIdx(l => l.startsWith(sig));
    if (s < 0) throw new Error('fn not found in ' + file + ': ' + sig);
    let depth = 0, started = false;
    for (let i = s; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
      if (started && depth === 0) return lines.slice(s, i + 1).join('\n');
    }
    throw new Error('fn end not found');
  }
  function extractVarObject(name) {
    const s = findIdx(l => l.startsWith('var ' + name + ' = {'));
    let depth = 0, started = false;
    for (let i = s; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
      if (started && depth === 0) return lines.slice(s, i + 1).join('\n').replace(/;\s*$/, '');
    }
    throw new Error('var end not found');
  }
  return [
    extractVarObject('CONTEXT_DICT'),
    extractFn('function extractTriggersFromMeaning(meaning, strict) {'),
    extractFn('function computeParaDist(matches, paragraphs) {'),
    extractFn('function pickMatchesByStrategy(noOverlap, paragraphs, target, strategy, perParaMax, maxRepeat) {'),
    extractFn('function generateContextMatches(chapter, words, repeatMode, targetWords, opts) {')
  ].join('\n\n');
}

function loadGen(code) {
  const ctx = { console, Math, JSON, Object, Array, String, Number, parseInt, parseFloat, RegExp, Date };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.__gen = generateContextMatches;', ctx);
  return ctx.__gen;
}

const genOld = loadGen(extractFrom('G:/英语学习工作台/index.html.v19'));
const genNew = loadGen(extractFrom('G:/英语学习工作台/index.html'));

const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);
let bs = -1, be = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].indexOf('<script id="builtinCet6B64"') >= 0) bs = i;
  else if (bs >= 0 && be < 0 && lines[i].trim() === '</script>') be = i;
}
const tsv = Buffer.from(lines.slice(bs + 1, be).join('').replace(/\s+/g, ''), 'base64').toString('utf-8');
const BUILTIN = [];
tsv.split('\n').forEach(l => { if (!l) return; const t = l.indexOf('\t'); if (t > 0) BUILTIN.push({ lemma: l.substring(0, t), meaning: l.substring(t + 1) }); });

const ARTICLE = JSON.parse(fs.readFileSync('G:/英语学习工作台/_t/_article.json', 'utf-8'));
const chapter = { id: 'ch1', title: '第一章', content: ARTICLE.join('\n\n') };

function stat(res) {
  const d = res.paraDist, P = d.length;
  const blank = d.filter(x => x === 0).length;
  const ft = Math.max(1, Math.round(P / 3));
  let front = 0, all = 0;
  for (let i = 0; i < P; i++) { all += d[i]; if (i < ft) front += d[i]; }
  return { d: d.join('/'), blank, pct: all ? Math.round(front / all * 100) : 0, all, uniq: res.uniqueCount };
}

console.log('文章段数 =', ARTICLE.length, '  词库 =', BUILTIN.length, '\n');
console.log('target    v19（改前）                            当前（改后）');
console.log('-'.repeat(116));
for (const t of [8, 10, 12, 14, 18, 20, 30, 40]) {
  const o = { strategy: 'balanced', perParaMax: 4, maxRepeatPerWord: 2, strictTrigger: true };
  const a = stat(genOld(chapter, BUILTIN, 'all', t, o));
  const b = stat(genNew(chapter, BUILTIN, 'all', t, o));
  const mark = (a.d === b.d) ? '  =' : '  ← 改善';
  console.log(`${String(t).padEnd(8)} ${a.d.padEnd(40)} 空${String(a.blank).padEnd(3)}前${String(a.pct + '%').padEnd(5)} ${b.d.padEnd(40)} 空${String(b.blank).padEnd(3)}前${b.pct + '%'}${mark}`);
}
console.log('\n回归：其他两个策略（应完全一致）');
for (const st of ['sequential', 'length']) {
  const o = { strategy: st, perParaMax: 4, maxRepeatPerWord: 2, strictTrigger: true };
  const a = stat(genOld(chapter, BUILTIN, 'all', 10, o));
  const b = stat(genNew(chapter, BUILTIN, 'all', 10, o));
  console.log(`  ${st.padEnd(11)} ${a.d === b.d ? '一致 ✓' : '不一致 ✗'}   改前 ${a.d}   改后 ${b.d}`);
}
