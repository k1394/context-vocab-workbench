// 复现「单词集中在前几段」：用页面里真实的匹配函数 + 真实 7146 词词书
const fs = require('fs');
eval(fs.readFileSync('_t/contextdict.js', 'utf8'));
eval(fs.readFileSync('_t/words2.js', 'utf8'));
eval(fs.readFileSync('_t/gen.js', 'utf8'));
const WORDS = JSON.parse(fs.readFileSync('_t/words.json', 'utf8'));

// 一篇结构贴近真实素材的短文：首段环境描写（名词密集），中段大量对话，末段动作描写
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
console.log('段落数:', para.length);

const res = generateContextMatches({ content: TEXT }, WORDS, 'all', 30);
console.log('匹配总数:', res.matches.length, ' 不同单词:', res.uniqueCount);

// 统计每个段落落在哪个位置
const per = new Array(para.length).fill(0);
let cum = 0;
const bounds = para.map((p, i) => { const s = cum; cum += p.length + 2; return s; });
res.matches.forEach(m => {
  const pi = Math.floor(m.position / 10000);
  const pos = m.position - pi * 10000;
  per[pi] = (per[pi] || 0) + 1;
});
console.log('\n各段标注条数：');
per.forEach((n, i) => {
  console.log('  第' + (i + 1) + '段  文本' + String(para[i].length).padStart(3) + '字   标注 ' + String(n).padStart(2) + ' 条  ' + '█'.repeat(n));
});
const hitParas = per.filter(n => n > 0).length;
console.log('\n有标注的段落: ' + hitParas + '/' + para.length);
console.log('前 2 段占全部标注: ' + Math.round((per[0] + per[1]) / res.matches.length * 100) + '%');

// 看看被选中的是哪些词
console.log('\n被选中的 30 个词（按出场顺序）：');
res.matches.forEach((m, i) => console.log('  ' + String(i + 1).padStart(2) + '. ' + m.lemma.padEnd(14) + ' ←「' + m.chWord + '」  第' + (Math.floor(m.position / 10000) + 1) + '段'));
