const fs = require('fs');
eval(fs.readFileSync('_t/contextdict.js', 'utf8'));
eval(fs.readFileSync('_t/words2b.js', 'utf8'));
eval(fs.readFileSync('_t/gen2.js', 'utf8'));
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
const OPTS = { strategy:'balanced', perParaMax:4, maxRepeatPerWord:2, strictTrigger:true };
for (const [name, opts] of [['旧：顺序取', {strategy:'sequential',maxRepeatPerWord:99,strictTrigger:false}],
                            ['新：每段均摊', OPTS],
                            ['新：按篇幅', {...OPTS, strategy:'length'}]]) {
  const r = generateContextMatches({content: TEXT}, WORDS, 'all', 30, opts);
  const d = r.paraDist;
  console.log('\n== ' + name + ' ==  标注 ' + r.matches.length + ' 条 / 不同词 ' + r.uniqueCount);
  console.log('  ' + d.map((n,i)=>'第'+(i+1)+'段:'+n).join('  '));
  console.log('  覆盖 ' + d.filter(n=>n>0).length + '/' + d.length + ' 段，空白 ' + d.filter(n=>n===0).length + ' 段');
  if (name.indexOf('均摊') >= 0) console.log('  选中词: ' + r.matches.map(m=>m.lemma+'←'+m.chWord).join(', '));
}
