// 对比：现状（按文档顺序取前 N 个）vs 段落轮转（每段轮流取，直到凑满 N）
const fs = require('fs');
eval(fs.readFileSync('_t/contextdict.js', 'utf8'));
eval(fs.readFileSync('_t/words2.js', 'utf8'));
eval(fs.readFileSync('_t/gen.js', 'utf8'));
const WORDS = JSON.parse(fs.readFileSync('_t/words.json', 'utf8'));
const TEXT = [
  '下雨天隔着玻璃看天，落下来的雨丝划过窗面，房间里那盏老式台灯还亮着，光线落在地板上，映出一小片淡淡的灰色。',
  '书桌上摊着一本旧杂志，封面已经泛黄，旁边放着一只空杯子，杯底还留着一圈浅褐色的痕迹。',
  '“你怎么又坐在这里？”她推门进来，把伞靠在墙边，甩了甩袖子上的水。',
  '“外面雨太大了。”他说，“我等一会儿再走。”',
  '她没有接话，走到窗边，把窗户推开一条缝。风灌进来，带着雨后泥土的气味。',
  '“你昨天说的那件事，我后来想了一晚上。”她背对着他说，“我还是觉得不行。”',
  '他沉默了几秒，把手里的书合上，放在桌角。“那你打算怎么办？”',
  '“我不知道。”她转过身，“但你得给我一个理由，哪怕只有一个。”',
  '窗外的雨声渐渐小了，天色一点点暗下去。屋里没有人再说话，只剩下钟表走动的声音。',
  '他站起来，走到门口，停了一下，还是没有回头，推门走进了雨里。'
].join('\n\n');
const para = TEXT.split(/\n\n+/);
const N = 30;

function raw(want) { return generateContextMatches({ content: TEXT }, WORDS, 'all', want); }

function dist(matches) {
  const per = new Array(para.length).fill(0);
  matches.forEach(m => { const pi = Math.floor(m.position / 10000); per[pi]++; });
  return per;
}
function show(title, matches) {
  const per = dist(matches);
  console.log('\n== ' + title + ' ==  共 ' + matches.length + ' 条');
  per.forEach((n, i) => console.log('  第' + String(i + 1).padStart(2) + '段  标注 ' + String(n).padStart(2) + ' 条  ' + '█'.repeat(n)));
  console.log('  覆盖段数 ' + per.filter(n => n > 0).length + '/' + para.length + '，空白段 ' + per.filter(n => n === 0).length);
}

// —— 现状 ——
const a = raw(N);
show('现状：按文档顺序取前 ' + N + ' 个不同词', a.matches);

// —— 方案：段落轮转 ——
// 先按段收集候选（每段内保持原顺序），再从第一段开始逐段轮流各取 1 个新词，直到凑满 N
const cand = raw(99999).matches;                 // 拿到全部候选（含重复）
const byPara = new Map();
cand.forEach(m => {
  const pi = Math.floor(m.position / 10000);
  if (!byPara.has(pi)) byPara.set(pi, []);
  byPara.get(pi).push(m);
});
const picked = [];
const usedLemma = new Set();
let turn = 0, guard = 0;
while (picked.length < N && guard++ < 5000) {
  let added = false;
  for (let pi = 0; pi < para.length; pi++) {
    if (picked.length >= N) break;
    const list = byPara.get(pi) || [];
    const nxt = list.find(m => !usedLemma.has(m.chWord + '|' + m.position));
    if (nxt && list.indexOf(nxt) < (turn + 1) * 3) { /* 每轮每段最多取 1 个 */ }
    // 每段每轮取一个（同段多轮时取后续候选）
    const slot = list.filter(m => !usedLemma.has(m.chWord + '|' + m.position));
    if (!slot.length) continue;
    const pick = slot[Math.min(turn, slot.length - 1)];
    if (usedLemma.has(pick.chWord + '|' + pick.position)) continue;
    usedLemma.add(pick.chWord + '|' + pick.position);
    picked.push(pick);
    added = true;
  }
  turn++;
  if (!added) break;
}
picked.sort((x, y) => x.position - y.position);
show('方案：段落轮转（每段轮流取，凑满 ' + N + '）', picked);
