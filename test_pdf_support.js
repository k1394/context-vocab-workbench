// 针对 pdf_support.js 中文本重建逻辑的单元测试
const fs = require('fs');
const vm = require('vm');

const sandbox = {
  console: console,
  Promise: Promise,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  document: { readyState: 'complete', getElementById: () => null, addEventListener: () => {} },
  Blob: function () {},
  URL: { createObjectURL: () => '' },
  FileReader: function () {},
  toast: () => {},
  uid: (p) => p + '_' + Math.random().toString(36).slice(2, 8)
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/pdf_support.js', 'utf8'), sandbox);

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      实际: ' + a + '\n      期望: ' + b); }
}

console.log('\n[1] 文本行/列重建');
{
  const T = [12, 0, 0, 12, 0, 0];
  const mk = (str, x, y, w) => ({ str, transform: [12, 0, 0, 12, x, y], width: w, height: 12 });
  const items = [
    mk('Hello', 72, 720, 30),
    mk(' world', 104, 720, 35),   // 间隙 2pt ≈ 空格宽度，不重复补空格
    { str: '', hasEOL: true, transform: [12, 0, 0, 12, 140, 720], width: 0, height: 12 },
    mk('ceiling', 72, 700, 40),
    mk('n.', 140, 700, 15),        // 间隙 28 > 12*1.6=19.2 → 分列(Tab)
    mk('天花板', 185, 700, 36),     // 间隙 30 → 分列(Tab)
    { str: '', hasEOL: true, transform: [12, 0, 0, 12, 230, 700], width: 0, height: 12 },
    mk('line-a', 72, 640, 40),
    mk('line-b', 115, 640, 40),    // 间隙 3 → 补空格
    mk('tick', 160, 640.8, 24)     // y 抖动 0.8pt → 仍属同一行
  ];
  const out = sandbox.pdfItemsToText(items);
  const lines = out.split('\n');
  eq(lines[0], 'Hello world', '同 y 的片段拼成一行，词间补空格');
  eq(lines[1], 'ceiling\tn.\t天花板', '大间隔识别为分列，输出 Tab');
  eq(lines[2], 'line-a line-b tick', 'y 抖动 0.8pt 不误判为换行，间隙补空格');
  eq(lines.length, 3, '共还原出 3 行');
}

console.log('\n[2] 页码清洗');
{
  const raw = '12\nceiling  n. 天花板\nreflect  v. 反射\n35';
  eq(sandbox.cleanPdfPageText(raw), 'ceiling  n. 天花板\nreflect  v. 反射', '去掉页首页尾孤立页码');
  eq(sandbox.cleanPdfPageText('2024\n正文内容'), '正文内容', '年份形态页码也去掉');
  eq(sandbox.cleanPdfPageText('有数字 2024 的正文'), '有数字 2024 的正文', '正文中的数字不被误删');
}

console.log('\n[3] 按页分章');
{
  const pages = ['a'.repeat(700), 'b'.repeat(700), 'c'.repeat(700), 'd'.repeat(700)];
  const chs = sandbox.splitPagesIntoChapters(pages);
  eq(chs.length, 2, '4 页 × 700 字 → 按 1800 字目标合并成 2 章');
  eq(chs[0].title, '第 1–2 页', '第 1 章覆盖第 1–2 页');
  eq(chs.every(c => c.content.length > 0 && c.id && c.order !== undefined), true, '每章字段完整');
  eq(chs.every(c => c.content.length <= 1800), true, '每章不超过目标字数');
  const big = sandbox.splitPagesIntoChapters(['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(300)]);
  eq(big.length, 2, '单页超目标时独立成章，尾部短页并入上一章');
  eq(big[0].content.length, 1000, '第 1 章只含第 1 页');
  eq(big[1].content.length > 1000, true, '第 2 章吸收了尾部短页');
  const many = sandbox.splitPagesIntoChapters(new Array(200).fill('x'.repeat(1000)));
  eq(many.length <= 30, true, '200 页大文件章数被压在 30 章以内（实际 ' + many.length + '）');
  eq(many.reduce((s, c) => s + c.content.length, 0) > 0, true, '合并后内容不丢');
  eq(sandbox.splitPagesIntoChapters(['只有一页'])[0].title, '全文', '单页文件命名为全文');
  eq(sandbox.splitPagesIntoChapters([]), [], '空页列表返回空数组不崩');
  eq(sandbox.splitPagesIntoChapters(['', '  ', 'beep'])[0].content, 'beep', '跳过空白页');
}

console.log('\n[4] 错误文案');
{
  eq(sandbox.pdfErrorText({ name: 'PasswordException' }).indexOf('密码') !== -1, true, '密码 PDF 给中文提示');
  eq(sandbox.pdfErrorText({ name: 'InvalidPDFException' }).indexOf('损坏') !== -1, true, '损坏 PDF 给中文提示');
  eq(sandbox.pdfErrorText({ message: 'Password required' }).indexOf('密码') !== -1, true, '仅凭 message 也能识别密码问题');
  eq(sandbox.pdfErrorText(new Error('boom')).indexOf('boom') !== -1, true, '未知错误保留原始信息');
}

console.log('\n[5] PDF 判定');
{
  eq(sandbox.isPdfFile({ name: 'book.PDF' }), true, '大写扩展名也识别');
  eq(sandbox.isPdfFile({ name: 'a.txt' }), false, 'txt 不误判');
  eq(sandbox.isPdfFile({ name: 'x', type: 'application/pdf' }), true, '按 MIME 识别');
  eq(sandbox.isPdfFile(null), false, '空值不崩');
}

console.log('\n[7] 单词书质量检测（防止把正文型 PDF 当词表导入）');
{
  const good = { headers: ['列1'], rows: [{ '列1': 'ceiling n. 天花板' }, { '列1': 'beautiful adj. 美丽的' }, { '列1': 'reflect v. 反射' }] };
  eq(sandbox.pdfWordbookQuality(good), 1, '标准词条行占比 100%');
  const bad = { headers: ['列1'], rows: [{ '列1': '这是一段中文正文，并不是词条' }, { '列1': '第二段正文内容继续' }] };
  eq(sandbox.pdfWordbookQuality(bad), 0, '纯正文行占比 0%（会触发提醒）');
  const half = { headers: ['列1'], rows: [{ '列1': 'ceiling n. 天花板' }, { '列1': '这是一整段正文' }] };
  eq(sandbox.pdfWordbookQuality(half), 0.5, '混合内容给出中间比例');
  eq(sandbox.pdfWordbookQuality({ headers: ['列1'], rows: [] }), 0, '空行集返回 0 不崩');
  eq(sandbox.pdfWordbookQuality(null), 0, '空对象返回 0 不崩');
}

console.log('\n[6] 未就绪时的兜底');{
  sandbox.PDF_SUPPORT.ready = false;
  sandbox.PDF_SUPPORT.reason = '测试';
  sandbox.extractPdfText({}).then(
    () => { console.log('  ✗ 未就绪时应拒绝'); process.exit(1); },
    (e) => {
      eq(/未就绪/.test(e.message), true, '内核未就绪时给出明确拒绝原因');
      console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
      process.exit(fail ? 1 : 0);
    }
  );
}
