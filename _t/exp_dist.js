// 诊断实验：语境标注为什么集中在前几段
// 代码全部从 index.html 现抽现跑，只额外插一行调试赋值，不改动算法本身
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);

function findIdx(fn, from) {
  for (let i = from || 0; i < lines.length; i++) if (fn(lines[i])) return i;
  return -1;
}
function sliceByLines(startLine, endLine) { return lines.slice(startLine, endLine).join('\n'); }
function extractFn(sig) {
  const s = findIdx(l => l.startsWith(sig));
  if (s < 0) throw new Error('fn not found: ' + sig);
  let depth = 0, started = false;
  for (let i = s; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; }
    }
    if (started && depth === 0) return lines.slice(s, i + 1).join('\n');
  }
  throw new Error('fn end not found: ' + sig);
}
function extractVarObject(name) {
  const s = findIdx(l => l.startsWith('var ' + name + ' = {'));
  if (s < 0) throw new Error('var not found: ' + name);
  let depth = 0, started = false;
  for (let i = s; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; }
    }
    if (started && depth === 0) return lines.slice(s, i + 1).join('\n').replace(/;\s*$/, '');
  }
  throw new Error('var end not found: ' + name);
}

// ---------- 解码内置词库 ----------
const b64Start = findIdx(l => l.indexOf('<script id="builtinCet6B64"') >= 0);
const b64End = findIdx(l => l.trim() === '</script>', b64Start);
const b64 = lines.slice(b64Start + 1, b64End).join('').replace(/\s+/g, '');
const buf = Buffer.from(b64, 'base64');
const tsv = buf.toString('utf-8');
const BUILTIN = [];
tsv.split('\n').forEach(line => {
  if (!line) return;
  const tab = line.indexOf('\t');
  if (tab <= 0) return;
  BUILTIN.push({ lemma: line.substring(0, tab), meaning: line.substring(tab + 1), wordbookId: 'wb_builtin_cet6' });
});
console.log('内置词库词数:', BUILTIN.length);

// ---------- 抽算法代码 ----------
let CODE = [
  extractVarObject('CONTEXT_DICT'),
  extractFn('function extractTriggersFromMeaning(meaning, strict) {'),
  extractFn('function computeParaDist(matches, paragraphs) {'),
  extractFn('function pickMatchesByStrategy(noOverlap, paragraphs, target, strategy, perParaMax, maxRepeat) {'),
  extractFn('function generateContextMatches(chapter, words, repeatMode, targetWords, opts) {')
].join('\n\n');

// 插桩：把 noOverlap / paragraphs 暴露出来（纯诊断，不动算法）
const ANCHOR = '  var pick = pickMatchesByStrategy(';
if (CODE.indexOf(ANCHOR) < 0) throw new Error('插桩锚点没找到');
CODE = CODE.replace(ANCHOR, '  global.__DBG_noOverlap = noOverlap; global.__DBG_paragraphs = paragraphs;\n' + ANCHOR);

eval(CODE);

// ---------- 构造一篇中文长文（模仿截图那类家庭回忆叙事） ----------
const ARTICLE = [
'当年父亲在日本战败后，把大部分收入都捐成了粮食的支出，但父亲却是没能撑过去，终于积劳成疾。后来，小阿嬷病倒了，母亲一个人既要照看孩子，又要下地干活，日子过得艰难。',

'在乡下，他想到我的父亲，想到父亲年轻时候的样子。父亲读书不多，可是做人老实，乡里乡亲都愿意跟他来往。母亲做起了女工，每天天不亮就出门，天黑透了才回家。',

'他当了搬运工，一天扛几十袋粮食，肩膀磨破了皮。母亲在纺织厂做女工，手指被机器绞伤过一次，从此落下了病根。那时候家里没有钱，孩子的学费都是东拼西凑来的。',

'女孩子读书的机会少，家里只肯让男孩上学。祖母不同意，她说女孩子也要识字，不然将来要吃亏。她偷偷把陪嫁的银镯子卖了，凑齐了第一笔学费。',

'学校里老师很严厉，背不出课文就要罚站。他成绩一般，可特别喜欢看书，常常在煤油灯下读到半夜。祖母从不催他睡觉，只在旁边纳鞋底。',

'有一年闹饥荒，村里好多人家都断了粮。祖母把仅有的半袋玉米面分成小份，每天熬一锅稀粥，让全家人分着喝。她自己总是最后一个吃，只喝碗底的清汤。',

'他十六岁那年离开家，一个人坐火车去了城里。祖母送他到村口，把攒了半年的钱塞进他口袋，一句话也没说，只是站在那里看着，直到火车看不见。',

'城里的生活并不容易。他住在工棚里，冬天冷得睡不着，就把所有的衣服都盖在身上。白天在工地干活，晚上去夜校上课，学了认字，也学了算术。',

'后来他进了一家工厂，从学徒做起。师傅脾气不好，骂人很凶，可是手艺是真好。他跟在后面学，把每一道工序都记在本子上，晚上回去反复看。',

'工厂的活很累，机器的声音整天在耳朵里响。有一回机器出了故障，他被飞出来的零件打中胳膊，在家躺了两个月。那两个月，他把厂里图书馆的书都读了一遍。',

'祖母听说他受伤，连夜赶了三百里路来看他。她带了一篮子鸡蛋，还有自己腌的咸菜。她没哭，只是摸着他的胳膊说，人没事就好，钱慢慢挣。',

'再后来，他成了技术员，又成了车间主任。厂里的人都说他肯钻研，遇到难题不撒手。他把祖母接来住了一段时间，可祖母住不惯城里，总惦记着乡下的菜地。',

'祖母回乡下去了。他每个月寄钱回去，逢年过节一定回家。有一年冬天大雪封路，他走了四十里山路回去，进门的时候鞋里全是冰碴子。',

'祖母走的那年，他正在外地出差。家里人怕耽误他的工作，没有及时告诉他。等他赶回去，人已经下葬三天了。他在坟前坐了一整夜，谁劝都不肯走。',

'他后来常跟孩子讲祖母的事，讲她怎么一个人撑起一个家，怎么在最难的时候也不肯低头。他说，人这一辈子，最要紧的是把腰杆挺直，别让人看不起。',

'孩子长大了，也成了家，有了自己的孩子。他教孩子认字的时候，用的还是祖母当年教他的法子，一个字写十遍，写不好就再写十遍。',

'如今他老了，头发全白了，坐在院子里的藤椅上晒太阳。有时候会想起小时候的事，想起煤油灯，想起稀粥，想起村口那个站着的背影。',

'他把这些事写下来，一笔一画写在纸上，写给孙子孙女看。他说，你们要记住，家里从前有多难，是一步一步走过来的。'
];

const chapter = { id: 'ch1', title: '第一章 祖母的教养方式', content: ARTICLE.join('\n\n'), targetWords: 30 };

// ---------- 三种策略各跑一次 ----------
function distStr(d) { return d.join('/'); }
function summarize(tag, res, paragraphs) {
  const dist = res.paraDist;
  const P = dist.length;
  const blank = dist.filter(x => x === 0).length;
  const firstThird = Math.max(1, Math.round(P / 3));
  let front = 0, all = 0;
  for (let i = 0; i < P; i++) { all += dist[i]; if (i < firstThird) front += dist[i]; }
  const pct = all ? Math.round(front / all * 100) : 0;
  console.log(`\n【${tag}】`);
  console.log('  段落数(P) =', P, ' 标注总数 =', all, ' 不同目标词 =', res.uniqueCount);
  console.log('  段落分布 =', distStr(dist));
  console.log('  空白段 =', blank, ' 前 1/3 段承载 =', front + '/' + all, '(' + pct + '%)', ' capBlocked =', res.capBlocked);
}

console.log('\n================ 实验一：当前 ' + BUILTIN.length + ' 词词库 + 18 段文章 ================');

const P = ARTICLE.length;
const opts = { strategy: 'balanced', perParaMax: 4, maxRepeatPerWord: 2, strictTrigger: true };
const r1 = generateContextMatches(chapter, BUILTIN, 'all', 30, opts);
summarize('balanced（默认分布化）target=30 perParaMax=4', r1, __DBG_paragraphs);

// 每段候选数（诊断：到底是候选不均，还是选词不均）
(function () {
  const no = global.__DBG_noOverlap;
  const byPara = new Array(P).fill(0);
  const lemmaByPara = new Array(P).fill(null).map(() => new Set());
  no.forEach(m => { const pi = Math.floor(m.position / 10000); if (pi >= 0 && pi < P) { byPara[pi]++; lemmaByPara[pi].add(m.lemma); } });
  console.log('\n  —— 诊断：每段的「候选标注点」与「不同候选词」——');
  console.log('  候选点/段 =', byPara.join('/'));
  console.log('  候选词/段 =', lemmaByPara.map(s => s.size).join('/'));
})();

const r2 = generateContextMatches(chapter, BUILTIN, 'all', 30, Object.assign({}, opts, { strategy: 'sequential' }));
summarize('sequential（旧行为：按文档顺序取前 N 个）', r2, __DBG_paragraphs);

const r3 = generateContextMatches(chapter, BUILTIN, 'all', 30, Object.assign({}, opts, { strategy: 'length' }));
summarize('length（按段落长度分配）', r3, __DBG_paragraphs);

// 每段上限极小 / 极大
const r4 = generateContextMatches(chapter, BUILTIN, 'all', 30, Object.assign({}, opts, { perParaMax: 1 }));
summarize('balanced perParaMax=1', r4, __DBG_paragraphs);

const r5 = generateContextMatches(chapter, BUILTIN, 'all', 30, Object.assign({}, opts, { perParaMax: 30 }));
summarize('balanced perParaMax=30', r5, __DBG_paragraphs);

// 目标词很少（导入默认 targetWords=10）
const r6 = generateContextMatches(chapter, BUILTIN, 'all', 10, opts);
summarize('balanced target=10（导入默认值）', r6, __DBG_paragraphs);
