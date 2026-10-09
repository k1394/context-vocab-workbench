const fs = require('fs');
eval(fs.readFileSync('_t/contextdict.js', 'utf8'));
eval(fs.readFileSync('_t/words2b.js', 'utf8'));
eval(fs.readFileSync('_t/gen2.js', 'utf8'));
const WORDS = JSON.parse(fs.readFileSync('_t/words.json', 'utf8'));

// 12 段、每段 150~260 字，结构接近真实素材：前 3 段环境描写，中段对话，后段动作与心理
const P = [
'雨从午后一直下到黄昏，玻璃上全是水痕，房间里那盏老式台灯照出昏黄的光线，落在地板上，映出一小片淡淡的灰色。窗台上积着一层薄薄的灰尘，空气里有旧书和木头的味道。他坐在书桌前面，手边摊着一本翻旧的杂志，封面已经泛黄，旁边放着一只空杯子，杯底留着一圈浅褐色的痕迹。屋里很安静，只有钟表走动的声音。',
'墙角的书架上堆满了各种资料和笔记，有几本已经合不拢，露出卷起的纸页。墙上挂着一张褪色的地图，边角卷起来，像是很多年没有取下来过。窗帘被风吹得轻轻晃动，影子在金黄的墙面上来回移动，像某种缓慢的呼吸。他抬头看了一眼，又低下头继续写字。',
'暖气片发出轻微的响声，屋子里弥漫着一种闷闷的、被关久了的空气。桌上的笔记本写满了密密麻麻的字，最后一页只写了半行就停住了，笔尖留下的痕迹还很清楚。他把杯子端起来喝了一口，水已经凉了，味道寡淡得像白开水里泡过一片柠檬。',
'“你还在写？”她从门口探进半个身子，头发上挂着细小的水珠，肩膀上的外套湿了一片。',
'“快结束了。”他没有抬头，“再给我十分钟。”',
'“十分钟之前你也是这么说的。”她走进来，把伞靠在墙边，甩了甩袖子上的水，在椅子上坐下，“外面雨太大了，整条街都淹了。”',
'他沉默了几秒，把手里的笔放下来，靠回椅背，揉了揉眼睛。“那你打算怎么办？总不能一直这样下去。”',
'“我不知道。”她盯着窗外的雨，声音很轻，“但你得给我一个理由，哪怕只有一个，哪怕只是你随便编一个。”',
'屋里没有人再说话。雨声渐渐小了，天色一点点暗下去，路灯亮起来，黄色的光圈在湿漉漉的地面上散开，又被风吹得歪斜。他站起来，走到窗边，把窗户推开一条缝，冷空气立刻涌进来，带着雨后泥土和树叶的气味。',
'“我想过很多次。”他终于开口，“一开始我以为只是习惯，后来发现不是。你走的那天我在楼下站了很久，回家以后把你说过的每句话都想了一遍，还是想不明白问题出在哪里。”',
'她没有回头，肩膀轻轻颤了一下，过了一会儿才说：“那你现在想明白了吗？”',
'“还没有。”他说，“但我不想再等到下一个下雨天，才发现自己什么都没做。”'
].join('\n\n');


const lines = [
  ['旧：顺序取（原行为）', { strategy: 'sequential', maxRepeatPerWord: 99, strictTrigger: false }],
  ['新：每段均摊 · 上限 4', { strategy: 'balanced', perParaMax: 4, maxRepeatPerWord: 2, strictTrigger: true }],
  ['新：每段均摊 · 上限 6', { strategy: 'balanced', perParaMax: 6, maxRepeatPerWord: 2, strictTrigger: true }],
  ['新：每段均摊 · 上限 2', { strategy: 'balanced', perParaMax: 2, maxRepeatPerWord: 2, strictTrigger: true }],
  ['新：每段均摊 · 上限 1', { strategy: 'balanced', perParaMax: 1, maxRepeatPerWord: 2, strictTrigger: true }],
  ['新：按篇幅分配', { strategy: 'length', perParaMax: 4, maxRepeatPerWord: 2, strictTrigger: true }]
];
for (const [name, opts] of lines) {
  const r = generateContextMatches({ content: P }, WORDS, 'all', 30, opts);
  const d = r.paraDist;
  const over = d.filter(function(n){ return n > (opts.perParaMax || 99); }).length;
  console.log('\n== ' + name + ' ==  标注 ' + r.matches.length + ' 条 / 不同词 ' + r.uniqueCount);
  console.log('  ' + d.map((n,i)=>'第'+(i+1)+'段:'+n).join('  '));
  console.log('  覆盖 ' + d.filter(n=>n>0).length + '/' + d.length + ' 段 · 空白 ' + d.filter(n=>n===0).length + ' 段 · 超上限段数 ' + over);
}
