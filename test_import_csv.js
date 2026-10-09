// 端到端验证：把 OCR 生成的单词书 CSV 真的导入工作台，并核对字段自动映射是否正确
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 8899;
const BASE = 'http://127.0.0.1:' + PORT;
const CSV = process.argv[2] || path.resolve(__dirname, '_t/a.csv');

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ profileId: 'p_import', nick: 'IMPORT' }));
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && typeof STATE.words !== 'undefined', { timeout: 60000 });
  await page.waitForTimeout(2500);

  console.log('\n[1] 选择 CSV 文件后应弹出字段映射');
  await page.setInputFiles('#wbFileInput', CSV);
  await page.waitForSelector('#fieldMapModal.show', { timeout: 30000 }).catch(() => {});
  const map = await page.evaluate(() => {
    const g = id => { const e = document.getElementById(id); return e ? e.value : '(无此控件)'; };
    return {
      shown: !!document.querySelector('#fieldMapModal.show'),
      lemma: g('map_lemma'), pos: g('map_pos'), ipa: g('map_ipa'),
      meaning: g('map_meaning'), example: g('map_example'), unit: g('map_unit'),
      wbName: (document.getElementById('fieldMapWbName') || {}).value || '',
      rows: (window.pendingFileData && pendingFileData.rows.length) || 0
    };
  });
  ok('字段映射弹窗已弹出', map.shown, map.shown);
  ok('行数解析正确', map.rows > 0, map.rows + ' 行');
  ok('自动识别「英文单词」列', map.lemma === 'lemma', map.lemma);
  ok('自动识别「词性」列', map.pos === 'pos', map.pos);
  ok('自动识别「音标」列', map.ipa === 'ipa', map.ipa);
  ok('自动识别「中文释义」列', map.meaning === 'meaning', map.meaning);
  ok('自动识别「例句」列', map.example === 'example', map.example);
  ok('自动识别「单元」列', map.unit === 'unit', map.unit);

  console.log('\n[2] 确认导入');
  const before = await page.evaluate(() => STATE.words.length);
  const t0 = Date.now();
  await page.evaluate(() => { confirmFieldMap(); });
  await page.waitForFunction((n) => window.STATE && STATE.words.length > n, before, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const ms = Date.now() - t0;

  const after = await page.evaluate(() => {
    const books = STATE.wordbooks.map(b => ({ name: b.name, total: b.total, id: b.id }));
    const last = books[books.length - 1];
    const ws = last ? STATE.words.filter(w => w.wordbookId === last.id) : [];
    return {
      books: books.length, lastBook: last,
      count: ws.length,
      sample: ws.slice(0, 3),
      localSaved: (LS.get('words_' + STATE.profileId, []) || []).length
    };
  });
  ok('新增了一本单词书', after.books >= 1, after.books);
  ok('词条数写入正确', after.count === map.rows, after.count + ' / ' + map.rows);
  ok('单词已落本地存储', after.localSaved >= after.count, after.localSaved);
  ok('导入耗时在可接受范围', ms < 30000, ms + ' ms');

  console.log('\n[3] 词条内容抽检（前 3 条）');
  after.sample.forEach(w => {
    console.log('     ' + w.lemma + '  [' + (w.pos || '-') + ']  ' + w.meaning);
  });
  const clean = after.sample.every(w => /^[A-Za-z][A-Za-z\-']*$/.test(w.lemma)
    && /[\u4e00-\u9fa5]/.test(w.meaning)
    && !/^[a-z]+\./i.test(w.meaning));
  ok('词元干净（纯英文单词）且释义为中文', clean, clean);

  console.log('\n[4] 运行期无脚本报错');
  ok('无 pageerror', errors.length === 0, errors.slice(0, 2));

  const failed = results.filter(r => !r.pass);
  console.log('\n' + (failed.length === 0 ? '✅ 全部通过' : '❌ 失败 ' + failed.length + ' 项')
    + '：' + results.length + ' 项检查');
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error('脚本异常:', e.message); process.exit(1); });
