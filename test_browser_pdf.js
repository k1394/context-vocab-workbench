// 端到端验证：真实浏览器里用真实 PDF 走完整导入链路
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8899;
const BASE = 'http://127.0.0.1:' + PORT;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ profileId: 'p_e2e', nick: 'E2E' }));
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  console.log('\n[1] PDF 内核在真实浏览器中是否可用');
  // ★ v31 起 pdf.js 内核改成「按需加载」：首屏不该编译这两大块。
  //   所以先断言「还没加载」，再断言「按需加载之后可用」。
  const before = await page.evaluate(() => ({
    lib: typeof (typeof pdfjsLib !== 'undefined' ? pdfjsLib : undefined),
    eager: typeof window.__pdfEager,
    lazyBlocks: ['pdfjsLibCode', 'pdfjsCMapCode', 'pdfjsWorkerCode'].map(function (id) {
      var el = document.getElementById(id);
      return el ? (el.tagName === 'SCRIPT' && el.type === 'text/plain' ? 'lazy:' + Math.round((el.textContent || '').length / 1024) + 'KB' : 'EAGER') : 'missing';
    })
  }));
  console.log('    首屏：lib=' + before.lib + '  惰性块=' + JSON.stringify(before.lazyBlocks));
  ok('★ 首屏没有加载 pdf.js 内核（惰性块仍是 text/plain）', before.lib === 'undefined', before.lib);
  ok('★ 内核与 CMap 两块都是惰性块且体积正常',
    before.lazyBlocks[0].indexOf('lazy:') === 0 && before.lazyBlocks[1].indexOf('lazy:') === 0,
    before.lazyBlocks);
  ok('worker 块同样是 text/plain（本来就没在首屏编译）', before.lazyBlocks[2].indexOf('lazy:') === 0, before.lazyBlocks[2]);

  const sup = await page.evaluate(() => {
    var okCore = (typeof ensurePdfCore === 'function') ? ensurePdfCore() : false;
    return {
      okCore: okCore,
      ready: (typeof PDF_SUPPORT !== 'undefined') && PDF_SUPPORT.ready,
      reason: (typeof PDF_SUPPORT !== 'undefined') ? PDF_SUPPORT.reason : 'PDF_SUPPORT 未定义',
      lib: typeof pdfjsLib,
      ver: (typeof pdfjsLib !== 'undefined') ? pdfjsLib.version : '',
      workerSrc: (typeof pdfjsLib !== 'undefined') ? String(pdfjsLib.GlobalWorkerOptions.workerSrc).slice(0, 24) : ''
    };
  });
  console.log('    ' + JSON.stringify(sup));
  ok('★ ensurePdfCore() 能把内核按需装起来', sup.okCore === true, sup.reason);
  ok('pdf.js 内核已加载', sup.lib === 'object' && sup.ver, sup.ver);
  ok('worker 源为 blob URL 且初始化成功', sup.ready === true, sup.reason || sup.workerSrc);

  console.log('\n[2] 中文正文型 PDF → 学习资料');
  const beforeMat = await page.evaluate(() => STATE.materials.length);
  console.log('    导入前资料数: ' + beforeMat + '（含预置示例）');
  await page.setInputFiles('#matFileInput', path.resolve(__dirname, 'testdata/test_material.pdf'));
  await page.waitForFunction((n) => window.STATE && STATE.materials.length > n, beforeMat, { timeout: 60000 })
    .catch(() => console.log('    （等待超时）toast = ' + ''));
  const matDiag = await page.evaluate(() => ({
    n: STATE.materials.length,
    toast: document.getElementById('toast').textContent
  }));
  console.log('    导入后资料数: ' + matDiag.n + ' | toast: ' + matDiag.toast);
  const mat = await page.evaluate(() => {
    const list = STATE.materials.filter(m => m.importedFrom === 'pdf');
    const m = list[list.length - 1];
    if (!m) return null;
    return {
      title: m.title, pages: m.pageCount, chapters: m.chapterCount, from: m.importedFrom,
      len: m.rawContent.length, head: m.rawContent.slice(0, 70),
      hasChinese: /[\u4e00-\u9fa5]/.test(m.rawContent),
      chTitles: (STATE.chapters[m.id] || []).map(c => c.title),
      hasPageNumber: /(^|\n)\s*[123]\s*(\n|$)/.test(m.rawContent),
      hasChapterHeading: /第一章|第二章|第三章/.test(m.rawContent)
    };
  });
  console.log('    ' + JSON.stringify(mat));
  ok('PDF 已生成学习资料', !!mat, mat && mat.title);
  ok('中文文字层被正确提取（CID 字体场景）', mat && mat.hasChinese);
  ok('页数识别正确（应为 3）', mat && mat.pages === 3, mat && mat.pages);
  ok('来源标记为 PDF 导入', mat && mat.from === 'pdf');
  ok('内容含正文首句', mat && mat.head.indexOf('天花板') !== -1, mat && mat.head.slice(0, 40));
  ok('页脚页码已被清洗掉', mat && mat.hasPageNumber === false);
  ok('已按章节切分', mat && mat.chapters >= 1, mat && mat.chTitles);

  console.log('\n[3] 中文词表型 PDF → 单词书');
  await page.evaluate(() => { window.pendingFileData = null; });
  await page.setInputFiles('#wbFileInput', path.resolve(__dirname, 'testdata/test_wordbook.pdf'));
  await page.waitForFunction(() => window.pendingFileData !== null, { timeout: 60000 })
    .catch(async () => console.log('    （等待超时）toast = ' + await page.evaluate(() => document.getElementById('toast').textContent)));
  const wb = await page.evaluate(() => {
    if (!pendingFileData) return null;
    const rows = pendingFileData.rows;
    return {
      headers: pendingFileData.headers,
      n: rows.length,
      first: rows.slice(0, 3).map(r => Object.values(r).join(' | ')),
      quality: Math.round(pdfWordbookQuality(pendingFileData) * 100) / 100,
      modalOpen: document.getElementById('fieldMapModal').classList.contains('show'),
      defaultLemma: (document.getElementById('map_lemma') || {}).value
    };
  });
  console.log('    ' + JSON.stringify(wb));
  ok('词表行被解析出来（13 词，与 PDF 内容一致）', wb && wb.n === 13, wb && wb.n);
  ok('未混入页脚页码', wb && !wb.first.some(x => /^\d+$/.test(x.trim())), wb && wb.first);
  ok('词与释义保持同行（未被拆散）', wb && /ceiling/.test(wb.first[0]) && /天花板/.test(wb.first[0]), wb && wb.first[0]);
  ok('质量检测判定为标准词表', wb && wb.quality >= 0.9, wb && wb.quality);
  ok('自动弹出字段映射弹窗', wb && wb.modalOpen);
  ok('单词列已自动预选（无需手工点选）', wb && wb.defaultLemma, wb && wb.defaultLemma);

  console.log('\n[4] 扫描版 PDF 应被识别并拒绝');
  await page.evaluate(() => { const t = document.getElementById('toast'); t.textContent = ''; t.className = 'toast'; });
  const beforeScanned = await page.evaluate(() => STATE.materials.length);
  await page.setInputFiles('#matFileInput', path.resolve(__dirname, 'testdata/test_scanned.pdf'));
  await page.waitForFunction(() => /扫描版|OCR|图片|未从/.test(document.getElementById('toast').textContent), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  const scannedToast = await page.evaluate(() => document.getElementById('toast').textContent);
  const matCount = await page.evaluate(() => STATE.materials.length);
  console.log('    提示文案: ' + scannedToast);
  ok('扫描版 PDF 给出「无文字层」提示', /扫描版|OCR|图片/.test(scannedToast), scannedToast.slice(0, 40));
  ok('扫描版 PDF 未被误建为资料', matCount === beforeScanned, matCount + ' vs ' + beforeScanned);

  console.log('\n[5] 运行期无 JS 报错');
  ok('控制台无未捕获错误', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n结果: ' + (results.length - failed.length) + ' 通过 / ' + failed.length + ' 失败');
  if (failed.length) { console.log('失败项: ' + failed.map(f => f.name).join('、')); process.exit(1); }
})().catch(e => { console.error('测试脚本异常: ' + e.message); process.exit(1); });
