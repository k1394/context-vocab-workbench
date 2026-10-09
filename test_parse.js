// 验证词条解析与挖空判定
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);
function extractBlock(startRe, endRe) {
  let s = -1, e = -1;
  for (let i = 0; i < lines.length; i++) {
    if (s === -1 && startRe.test(lines[i])) s = i;
    else if (s !== -1 && endRe.test(lines[i])) { e = i; break; }
  }
  if (s === -1 || e === -1) throw new Error('not found: ' + startRe);
  return lines.slice(s, e + 1).join('\n');
}
eval(extractBlock(/^\/\/ ===== 词条文本解析 =====/, /^\/\/ ===== 发音 =====/));

console.log('=== parseEntryText ===');
const cases = [
  "818. imprison [ɪm'prɪzn] - v. 监禁；关押",
  "467. desolate ['desələt] - a. 无人居住的；荒凉的；孤独凄凉的；v. 使感到悲惨/绝望",
  "1503. suicide ['suːɪsaɪd] - n. 自杀；自毁；自杀者",
  "597. entail [ɪn'teɪl] - v. 牵涉；需要；使必要",
  "1633. vegetation [ˌvedʒə'teɪʃn] - n. 植物；植被；草木",
  "imprison",
  "v. 监禁；关押",
  "美丽的；华美的",
  "n. 洋，海洋；[pl.]大量"
];
cases.forEach(c => {
  const p = parseEntryText(c);
  console.log(JSON.stringify(c), '=>', JSON.stringify(p));
});
console.log('\n=== displayWord ===');
console.log(displayWord("818. imprison [ɪm'prɪzn] - v. 监禁；关押")); // 期望 imprison
console.log(displayWord("beautiful")); // 期望 beautiful
console.log('\n=== cleanMeaningText ===');
console.log(cleanMeaningText("818. imprison [ɪm'prɪzn] - v. 监禁；关押")); // 期望 监禁；关押
console.log(cleanMeaningText("v. 牵涉；需要；使必要")); // 期望 牵涉；需要；使必要
console.log(cleanMeaningText("美丽的；华美的")); // 期望 原样
