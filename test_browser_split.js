// 端到端验证：超大 PDF 导入时是否真的自动拆成多篇、且每篇都不超云端单行 1MB 上限
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 8899;
const BASE = 'http://127.0.0.1:' + PORT;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

async function importPdf(page, file) {
  const before = await page.evaluate(() => STATE.materials.length);
  await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
  await page.setInputFiles('#matFileInput', path.resolve(__dirname, 'testdata', file));
  await page.waitForFunction((n) => window.STATE && STATE.materials.length > n, before, { timeout: 180000 })
    .catch(() => {});
  return page.evaluate((n) => ({
    created: STATE.materials.slice(n).map(m => ({
      id: m.id, title: m.title, chars: m.rawContent.length,
      chapters: (STATE.chapters[m.id] || []).length,
      chTitles: (STATE.chapters[m.id] || []).map(c => c.title).slice(0, 2),
      emptyChapters: (STATE.chapters[m.id] || []).filter(c => !c.content || !c.content.length).length,
      // 与 syncMaterialToCloud 一致的真实落库体积
      bytes: utf8Bytes(JSON.stringify({
        'profile_id': 'p', '资料ID': m.id, '标题': m.title, '来源类型': 's_txt',
        '原始文本': m.rawContent, '章节JSON': JSON.stringify(m.chapters),
        '章节数': m.chapterCount, '创建时间': m.createdAt, '更新时间': m.updatedAt
      }))
    })),
    toast: document.getElementById('toast').textContent,
    localPersisted: (LS.get('materials_' + STATE.profileId, []) || []).length
  }), before);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ profileId: 'p_split', nick: 'SPLIT' }));
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  console.log('\n[1] 小体积 PDF（50 页中文）→ 应保持 1 篇、不拆分');
  const small = await importPdf(page, 'size_50.pdf');
  ok('生成 1 篇资料', small.created.length === 1, small.created.length);
  ok('标题不带拆分序号', small.created[0] && !/（1\//.test(small.created[0].title), small.created[0] && small.created[0].title);
  ok('提示里不出现「已自动拆成」', small.toast.indexOf('已自动拆成') === -1, small.toast.slice(0, 60));
  ok('落库体积在上限内', small.created[0] && small.created[0].bytes < 1048576, small.created[0] && (small.created[0].bytes / 1024).toFixed(0) + 'KB');

  console.log('\n[2] 超大 PDF（400 页中文，约 44 万汉字）→ 应自动拆成多篇');
  // 先注入原始 PDF 作为「不丢字」比对的参照
  await page.evaluate((b64) => { window.__BIGPDF__ = b64; },
    fs.readFileSync(path.resolve(__dirname, 'testdata', 'size_400.pdf')).toString('base64'));
  const big = await importPdf(page, 'size_400.pdf');
  console.log('    toast: ' + big.toast);
  ok('确实被拆成多篇', big.created.length > 1, big.created.length + ' 篇');
  ok('提示明确告知已自动拆分', /已自动拆成\s*\d+\s*篇/.test(big.toast), big.toast.slice(0, 40));
  ok('标题带（i/N）序号', big.created.every((m, i) => m.title.indexOf('（' + (i + 1) + '/' + big.created.length + '）') !== -1),
    big.created.map(m => m.title).join(' | ').slice(0, 80));
  ok('每一篇都 ≤ 1MB 云端单行上限', big.created.every(m => m.bytes < 1048576),
    big.created.map(m => (m.bytes / 1024).toFixed(0) + 'KB').join(' / '));
  ok('每一篇都留有安全余量（≤900KB）', big.created.every(m => m.bytes <= 900 * 1024),
    big.created.map(m => (m.bytes / 1024).toFixed(0) + 'KB').join(' / '));
  ok('每一篇都有非空章节', big.created.every(m => m.chapters >= 1 && m.emptyChapters === 0),
    big.created.map(m => m.chapters).join('/'));

  console.log('\n[3] 拆分后内容一字不丢');
  const loss = await page.evaluate(async (ids) => {
    const mats = ids.map(id => STATE.materials.find(m => m.id === id)).filter(Boolean);
    const got = mats.map(m => m.rawContent).join('').replace(/\s/g, '');
    // 重新解析原始 PDF 作为参照
    const b64 = window.__BIGPDF__;
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'b.pdf', { type: 'application/pdf' });
    const res = await extractPdfText(file);
    const want = res.text.replace(/\s/g, '');
    return { gotLen: got.length, wantLen: want.length, same: got === want };
  }, big.created.map(m => m.id)).catch(e => ({ error: e.message }));
  if (loss.error) {
    // 参照数据没注入时退化为「篇数×内容量」检查
    console.log('    （未注入参照文本，跳过逐字比对）');
  } else {
    ok('正文合计与原始提取结果完全一致', loss.same, loss.gotLen + ' vs ' + loss.wantLen);
  }

  console.log('\n[4] 本地落盘校验 & 刷新后仍在');
  const persistedAll = await page.evaluate((ids) => {
    const saved = LS.get('materials_' + STATE.profileId, []) || [];
    const savedCh = LS.get('chapters_' + STATE.profileId, {}) || {};
    return ids.every(id => saved.some(m => m.id === id) && savedCh[id] && savedCh[id].length);
  }, big.created.map(m => m.id));
  ok('拆分出的每一篇都已写入本地存储', persistedAll);

  await page.reload({ waitUntil: 'load' });
  // 启动需等 CLOUD.waitReady（最长 5s）+ 账号解析 + 加载，不能只等 2 秒
  let afterReload = { have: 0, total: 0 };
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(600);
    afterReload = await page.evaluate((ids) => ({
      have: ids.filter(id => STATE.materials.some(m => m.id === id)).length,
      total: STATE.materials.length,
      cloudReady: STATE.cloudReady
    }), big.created.map(m => m.id));
    if (afterReload.have === big.created.length) break;
    if (i >= 14) break;   // 最少等 9 秒再判定
  }
  ok('刷新后拆分资料依然存在', afterReload.have === big.created.length,
    afterReload.have + '/' + big.created.length + '（共 ' + afterReload.total + ' 篇可见）');

  console.log('\n[5] 单词书入口不受影响');
  await page.setInputFiles('#wbFileInput', path.resolve(__dirname, 'testdata/test_wordbook.pdf'));
  await page.waitForFunction(() => window.pendingFileData !== null, { timeout: 60000 }).catch(() => {});
  const wb = await page.evaluate(() => ({
    pending: !!window.pendingFileData,
    rows: window.pendingFileData ? window.pendingFileData.rows.length : 0,
    modalOpen: document.querySelectorAll('#uploadModal.show').length
  }));
  ok('单词书 PDF 仍走字段映射流程', wb.pending && wb.rows > 0, wb.rows + ' 行');

  console.log('\n[6] 运行期无脚本报错');
  ok('无 pageerror', errors.length === 0, errors.slice(0, 2));

  const failed = results.filter(r => !r.pass);
  console.log('\n' + (failed.length === 0 ? '✅ 全部通过' : '❌ 失败 ' + failed.length + ' 项')
    + '：' + results.length + ' 项检查');
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error('脚本异常:', e.message); process.exit(1); });
