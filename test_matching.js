// 从 index.html 抽取真实函数做验证（按行号截取，避开 CRLF 问题）
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);

// CONTEXT_DICT: 从 "var CONTEXT_DICT" 行到其后第一个以 "};" 开头的行
function extractBlock(startRe, endRe) {
  let s = -1, e = -1;
  for (let i = 0; i < lines.length; i++) {
    if (s === -1 && startRe.test(lines[i])) s = i;
    else if (s !== -1 && endRe.test(lines[i])) { e = i; break; }
  }
  if (s === -1 || e === -1) throw new Error('block not found: ' + startRe);
  return lines.slice(s, e + 1).join('\n');
}

const dictCode = extractBlock(/^var CONTEXT_DICT = \{/, /^\};/);
const fnCode = extractBlock(/^\/\/ 从中文释义中提取/, /^function regenerateMatches/).replace(/function regenerateMatches[\s\S]*$/, '');

eval(dictCode);
eval(fnCode);

if (typeof extractTriggersFromMeaning !== 'function' || typeof generateContextMatches !== 'function') {
  console.error('FAIL: functions not extracted'); process.exit(1);
}
console.log('函数提取成功 ✓\n');

// === 测试 1：CET-6 风格单词书（带词性前缀的释义）+ 龙三文本 ===
const longsanText = `1991年，深秋。西伯利亚北部，无名港。

港口坐落在西伯利亚的最北部，面对着浩瀚的北冰洋。海图上是找不到这个港口的，美国人的间谍卫星都扫描不到它，它跟周围的永久冻土带一样都是灰白色的，热信号很微弱。

这里本不该有港口，周围都是无人区。离这里最近的城市是维尔霍扬斯克，它在沙皇年代是关押政治犯的流放地，是一座让人用来绝望的城市，在漫长的寒冬中，政治犯们往往因为熬不下去而自杀。而维尔霍扬斯克还在无名港以南340公里的地方，从维尔霍扬斯克乘坐狗拉雪橇来这座港口都需要五天时间。这是片被神都遗忘的地方，植物只有地衣和苔藓，偶尔的访客是饥饿的北极熊。

锈迹斑斑的铸铁码头通往冰封的海面，年轻的哨兵站在码头尽处，肩扛"波波沙冲锋枪"，熊皮帽上嵌着五角星。从领章可以看出他是一位苏联红军的中士。

天边的太阳温吞吞的，像一枚水煮蛋，怎么也温暖不了地面。可这就是今年最后的阳光了，极夜很快就要开始了，接下来的几个月里太阳不会再升起。哨兵向着冰海尽头眺望，海面上刮着寂寥的寒风，船还是没`;

const words = [
  { lemma: 'port', meaning: 'n. 港口，口岸' },
  { lemma: 'harbor', meaning: 'n. 海港，港口；vt. 庇护' },
  { lemma: 'despair', meaning: 'n. 绝望；使人失望的人(事物) vi. (of)绝望，失去希望' },
  { lemma: 'scan', meaning: 'vt. 细看，审视；扫描；浏览 n. 扫描' },
  { lemma: 'signal', meaning: 'n. 信号，暗号；标志，表示 vt. 标志着 vi. 发信号 adj. 显著的' },
  { lemma: 'city', meaning: 'n. 城市，都市' },
  { lemma: 'plant', meaning: 'n. 植物；工厂；间谍 vt. 种，植' },
  { lemma: 'warm', meaning: 'adj. 温暖的，暖和的；热情的 v. (使)暖起来' },
  { lemma: 'sun', meaning: 'n. 太阳，日' },
  { lemma: 'sunlight', meaning: 'n. 日光，阳光' },
  { lemma: 'wharf', meaning: 'n. 码头' },
  { lemma: 'young', meaning: 'adj. 年轻的，青年的' },
  { lemma: 'star', meaning: 'n. 星，星形物；明星 v. 主演' },
  { lemma: 'ocean', meaning: 'n. 洋，海洋；[pl.]大量' },
  { lemma: 'spy', meaning: 'n. 间谍 vi. 当间谍；暗中监视 vt. 看见' },
  { lemma: 'abandon', meaning: 'vt. 遗弃，抛弃；放弃' },
  { lemma: 'able', meaning: 'adj. 能够…的，得以…的；有才干的' },
  { lemma: 'absent', meaning: 'adj. 缺席的；缺乏的；心不在焉的' },
];

const chapter = { id: 'ch1', title: '第1章', content: longsanText, targetWords: 30 };
const res = generateContextMatches(chapter, words, 'all', 30);
console.log('=== 测试1：CET-6 风格（词性前缀释义）===');
console.log('匹配数:', res.matches.length, '| 唯一词数:', res.uniqueCount, '| 未匹配:', res.unmatched.join(','));
const byLemma = {};
res.matches.forEach(m => { (byLemma[m.lemma] = byLemma[m.lemma] || []).push(m.chWord + '@' + (m.position % 10000)); });
Object.keys(byLemma).forEach(l => console.log(' ', l, '->', byLemma[l].join(', ')));

// 验证：每个 chWord 真的出现在对应段落文本中
const paras = longsanText.split(/\n\n+/);
let bad = 0;
res.matches.forEach(m => {
  const pi = Math.floor(m.position / 10000);
  if (paras[pi].indexOf(m.chWord) === -1) { bad++; console.log('  BAD match:', m.lemma, m.chWord); }
});
console.log(bad === 0 ? '✓ 所有匹配位置有效' : '✗ 有 ' + bad + ' 个无效匹配');

// === 测试 2：目标词数上限 ===
const res2 = generateContextMatches(chapter, words, 'all', 3);
const uniq2 = {}; res2.matches.forEach(m => uniq2[m.lemma] = true);
console.log('\n=== 测试2：上限 3 词 ===');
console.log('唯一词数:', Object.keys(uniq2).length, Object.keys(uniq2).length <= 3 ? '✓ 通过' : '✗ 超限');

// === 测试 3：虞寻歌示例（预置词典路径）===
const yuText = `虞寻歌睁眼后看着到天花板上那名贵华美的吊灯还有些茫然。

她坐起身，环顾四周，是酒店？枕边还有她已经多年没见过的手机，她拿起一看，上面显示时间是2月21日23点。`;
const yuWords = [
  { lemma: 'ceiling', meaning: '天花板' },
  { lemma: 'beautiful', meaning: '美丽的；华美的' },
  { lemma: 'room', meaning: '房间；地方' },
  { lemma: 'around', meaning: '四处；周围' },
];
const res3 = generateContextMatches({ id: 'c2', content: yuText }, yuWords, 'all', 18);
console.log('\n=== 测试3：虞寻歌示例 ===');
console.log('匹配数:', res3.matches.length);
res3.matches.forEach(m => console.log(' ', m.lemma, '<-', m.chWord));

// === 测试 4：释义提取边界情况 ===
console.log('\n=== 测试4：释义提取 ===');
console.log('  "vt. 细看，审视；扫描；浏览 n. 扫描" ->', JSON.stringify(extractTriggersFromMeaning('vt. 细看，审视；扫描；浏览 n. 扫描')));
console.log('  "n. 绝望；使人失望的人(事物)" ->', JSON.stringify(extractTriggersFromMeaning('n. 绝望；使人失望的人(事物)')));
console.log('  "[əˈbændən] vt. 遗弃，抛弃" ->', JSON.stringify(extractTriggersFromMeaning('[əˈbændən] vt. 遗弃，抛弃')));
console.log('  "" ->', JSON.stringify(extractTriggersFromMeaning('')));
