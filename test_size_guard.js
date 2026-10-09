// 资料体积预算与自动拆分单测（超 1MB/行会自动拆成多篇）
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(__dirname + '/index.html', 'utf8');
const START = '// ===== 资料体积预算：资料库单行 1MB 上限 =====';
const END = '// ===== 本地保存 =====';
const s = src.indexOf(START), e = src.indexOf(END);
if (s < 0 || e < 0 || e < s) { console.error('未找到体积预算模块'); process.exit(1); }
const block = src.slice(s, e);

let seq = 0;
const sandbox = { console, TextEncoder, uid: (p) => p + '_' + (++seq) };
vm.createContext(sandbox);
vm.runInContext(block, sandbox);
const { estimateMaterialBytes, planImportUnits, hardChunks, maxCharsPerMaterial, ROW_SAFE_BYTES } = sandbox;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '\n      实际: ' + JSON.stringify(extra) : '')); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, a); }

// —— 构造测试数据 ——
function cnText(pages, charsPerPage) {
  const seed = '她仰头看着天花板，那个美丽的角落始终无法忘记，房间的状况比想象中更糟，需要先把旧家具搬走。';
  return Array.from({ length: pages }, (_, i) =>
    '第 ' + (i + 1) + ' 段\n' + seed.repeat(Math.ceil(charsPerPage / seed.length)).slice(0, charsPerPage)
  ).join('\n\n');
}
function enText(pages, charsPerPage) {
  const seed = 'The ceiling was clean in the morning light and she looked up for a long time without saying anything at all. ';
  return Array.from({ length: pages }, (_, i) =>
    'Page ' + (i + 1) + '\n' + seed.repeat(Math.ceil(charsPerPage / seed.length)).slice(0, charsPerPage)
  ).join('\n\n');
}
// 按「一章 N 段」把长文切成章节，模拟 parseTXT / splitPagesIntoChapters 的产物
function toChapters(text, perChapter) {
  const paras = text.split('\n\n');
  const chs = [];
  for (let i = 0; i < paras.length; i += perChapter) {
    chs.push({
      id: 'ch' + i, title: '第 ' + (chs.length + 1) + ' 章', order: chs.length,
      content: paras.slice(i, i + perChapter).join('\n\n'), targetWords: 10, generated: false
    });
  }
  return chs;
}
const stripAll = (t) => String(t).replace(/\s/g, '');

console.log('\n[1] 体积估算：与真实落库结构对齐（中文 3 字节/字符、正文写两份）');
{
  const t = '中'.repeat(1000);
  const bytes = estimateMaterialBytes(t, [{ id: 'c', title: 't', order: 0, content: t, targetWords: 10, generated: false }]);
  const perChar = bytes / 1000;
  ok(perChar > 5.5 && perChar < 7, '中文每字符占用 ≈ 6 字节（正文两份 × 3 字节），实测 ' + perChar.toFixed(2));
  const en = estimateMaterialBytes('a'.repeat(1000), [{ id: 'c', title: 't', order: 0, content: 'a'.repeat(1000), targetWords: 10, generated: false }]);
  ok(en / 1000 > 1.9 && en / 1000 < 3, '英文每字符 ≈ 2 字节，实测 ' + (en / 1000).toFixed(2));
}

console.log('\n[2] 未超限：原样返回 1 篇，不做任何改动');
{
  const text = cnText(20, 800);          // 约 1.6 万字
  const chs = toChapters(text, 5);
  const units = planImportUnits('小文章', text, chs);
  eq(units.length, 1, '小资料不拆分');
  ok(units[0].chapters === chs, '章节对象原样透传（不重建）');
  ok(units[0].text === text, '正文原样透传');
}

console.log('\n[3] 中文超限（约 44 万汉字）：自动拆成多篇，且每篇都不超上限');
{
  const text = cnText(400, 1100);        // 44 万汉字
  const chs = toChapters(text, 20);
  const units = planImportUnits('大部头', text, chs);
  ok(units.length > 1, '被拆分（' + units.length + ' 篇）');
  const overs = units.filter(u => estimateMaterialBytes(u.text, u.chapters) > ROW_SAFE_BYTES);
  eq(overs.length, 0, '每篇都 ≤ 900KB 安全线');
  eq(units.map(u => stripAll(u.text)).join(''), stripAll(text), '拆分后正文一字不丢、不重复');
  ok(units.every(u => u.chapters.length >= 1), '每篇至少一个章节');
  const chars = units.map(u => u.text.length);
  ok(Math.max(...chars) / Math.min(...chars) < 2.2, '各篇体量均衡，最大/最小 = ' + (Math.max(...chars) / Math.min(...chars)).toFixed(2) + '（' + chars.join('/') + '）');
}

console.log('\n[4] 英文超限（英文 1 字节/字符，同页数能装更多）');
{
  const cnText400 = cnText(300, 1100);
  const enText300 = enText(300, 1600);
  const cnUnits = planImportUnits('中', cnText400, toChapters(cnText400, 20)).length;
  const enUnits = planImportUnits('en', enText300, toChapters(enText300, 20)).length;
  ok(enUnits < cnUnits, '同样篇数下英文拆得比中文少（英文 ' + enUnits + ' 篇 vs 中文 ' + cnUnits + ' 篇）');
  const enUs = planImportUnits('en', enText300, toChapters(enText300, 20));
  eq(enUs.filter(u => estimateMaterialBytes(u.text, u.chapters) > ROW_SAFE_BYTES).length, 0, '英文拆出的每篇都合规');
  eq(enUs.map(u => stripAll(u.text)).join(''), stripAll(enText300), '英文拆分同样不丢字');
}

console.log('\n[5] 单章本身就超限：按段落再切，标题带续片序号');
{
  const huge = cnText(300, 1100);        // 33 万汉字挤在一个章节里
  const chs = [{ id: 'c1', title: '巨章', order: 0, content: huge, targetWords: 10, generated: false }];
  const units = planImportUnits('单章超大', huge, chs);
  ok(units.length > 1, '超大单章被切开（' + units.length + ' 篇）');
  const titles = units.flatMap(u => u.chapters.map(c => c.title));
  ok(titles.some(t => /巨章（\d+\/\d+）/.test(t)), '续片标题带序号', titles.slice(0, 3));
  eq(units.map(u => stripAll(u.text)).join(''), stripAll(huge), '切分不丢字');
}

console.log('\n[6] 极端情况：一整段 40 万字没有任何标点');
{
  const blob = '字'.repeat(400000);
  const chs = [{ id: 'c1', title: '无标点', order: 0, content: blob, targetWords: 10, generated: false }];
  const units = planImportUnits('无标点', blob, chs);
  ok(units.length > 1, '无标点也会被硬切（' + units.length + ' 篇）');
  eq(units.map(u => stripAll(u.text)).join(''), blob, '硬切不丢字');
  eq(units.filter(u => estimateMaterialBytes(u.text, u.chapters) > ROW_SAFE_BYTES).length, 0, '硬切后每篇仍合规');
}

console.log('\n[7] hardChunks 边界');
{
  eq(hardChunks('', 100), [], '空串返回空数组');
  eq(hardChunks('abc', 100), ['abc'], '不超限时原样返回');
  const parts = hardChunks('a'.repeat(250), 100);
  eq(parts.map(p => p.length), [100, 100, 50], '硬切长度正确');
  eq(parts.join(''), 'a'.repeat(250), '拼回原串');
  const sent = hardChunks('一句话。'.repeat(100), 60);   // 每句 4 字符，应在句号处切
  ok(sent.every(p => p.length <= 60), '按句子边界切且不超长');
  ok(sent.every(p => p.endsWith('。') || p === sent[sent.length - 1]), '优先切在句号后', sent[0]);
  eq(sent.join(''), '一句话。'.repeat(100), '按句切也不丢字');
}

console.log('\n[8] 上限常量与单篇容量');
{
  eq(sandbox.ROW_LIMIT_BYTES, 1048576, '服务端硬上限 1MB');
  ok(ROW_SAFE_BYTES < 1048576, '自留安全线低于硬上限（' + (ROW_SAFE_BYTES / 1024) + 'KB）');
  const cnMax = maxCharsPerMaterial(cnText(50, 1100));
  ok(cnMax > 120000 && cnMax < 175000, '中文单篇容量约 15 万字符，实测 ' + cnMax);
  const enMax = maxCharsPerMaterial(enText(50, 1600));
  ok(enMax > cnMax * 1.7, '英文单篇容量约为中文的 3 倍，实测 ' + enMax);
}

console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
