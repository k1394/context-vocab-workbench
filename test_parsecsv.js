// 针对 index.html 中 parseCSV 的单元测试（PDF 导入依赖它把文本转成词表行）
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(__dirname + '/index.html', 'utf8');
const start = src.indexOf('function parseCSV(text) {');
if (start < 0) { console.error('未找到 parseCSV'); process.exit(1); }
let depth = 0, end = -1;
for (let i = src.indexOf('{', start); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const fnSrc = src.slice(start, end);
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fnSrc, sandbox);
const parseCSV = sandbox.parseCSV;

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      实际: ' + a + '\n      期望: ' + b); }
}

console.log('\n[1] 原有 CSV 行为不能回归');
{
  let r = parseCSV('lemma,pos,ipa,meaning\nceiling,n.,/si:lɪŋ/,天花板\nbeautiful,adj.,,美丽的');
  eq(r.headers, ['lemma', 'pos', 'ipa', 'meaning'], '英文表头被识别为表头');
  eq(r.rows.length, 2, '两行数据');
  eq(r.rows[0].lemma, 'ceiling', '按列名取值正确');

  r = parseCSV('单词,释义\nceiling,天花板');
  eq(r.headers, ['单词', '释义'], '中文表头被识别为表头');
  eq(r.rows.length, 1, '中文表头下数据行数正确');

  r = parseCSV('英文单词,中文释义\nceiling,天花板');
  eq(r.headers, ['英文单词', '中文释义'], '复合中文表头（英文单词/中文释义）也识别为表头');

  r = parseCSV('lemma,meaning\n"a,b",释义');
  eq(r.rows[0].lemma, 'a,b', '引号内的逗号不被切断');
}

console.log('\n[2] PDF/纯文本词表（无表头）');
{
  let r = parseCSV("818. imprison [ɪm'prɪzn] - v. 监禁；关押\n819. reflect [rɪ'flekt] - v. 反射");
  eq(r.headers, ['列1'], '编号式词条首行被当作数据，不丢行');
  eq(r.rows.length, 2, '两行词条都保留');
  eq(r.rows[0]['列1'], "818. imprison [ɪm'prɪzn] - v. 监禁；关押", '整行内容完整保留');

  r = parseCSV('ceiling n. 天花板\nbeautiful adj. 美丽的\nreflect v. 反射');
  eq(r.headers, ['列1'], '纯词条首行被当作数据');
  eq(r.rows.length, 3, '三行词条都保留');

  r = parseCSV('ceiling\tn.\t天花板\nbeautiful\tadj.\t美丽的');
  eq(r.headers, ['列1', '列2', '列3'], 'PDF 表格的大间距（Tab）被识别为分列');
  eq(r.rows.length, 2, '两行数据');
  eq(r.rows[1]['列3'], '美丽的', '第三列取值正确');

  r = parseCSV('ceiling 天花板');
  eq(r.rows.length, 1, '单行文件不丢数据');
}

console.log('\n[3] 边界与容错');
{
  eq(parseCSV('').rows.length, 0, '空文本返回空结果不崩');
  eq(parseCSV('   \n  \n').rows.length, 0, '全空白文本返回空结果');
  eq(parseCSV('a,b\n,\n').rows.length, 2, '多列的空行保留（与原行为一致，导入时空词条会被跳过）');
  const r = parseCSV('lemma,meaning\n\nceiling,天花板\n\nreflect,反射');
  eq(r.rows.length, 2, '中间的空行被忽略');
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
