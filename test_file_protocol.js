// 验证「本地双击打开的 HTML」（file:// 协议）里 PDF 功能是否可用
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push('[' + m.type() + '] ' + m.text().slice(0, 200)));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

  const fileUrl = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
  console.log('打开: ' + fileUrl);
  await page.goto(fileUrl, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const sup = await page.evaluate(() => ({
    ready: typeof PDF_SUPPORT !== 'undefined' && PDF_SUPPORT.ready,
    reason: typeof PDF_SUPPORT !== 'undefined' ? PDF_SUPPORT.reason : 'PDF_SUPPORT 未定义',
    workerSrc: (typeof pdfjsLib !== 'undefined') ? String(pdfjsLib.GlobalWorkerOptions.workerSrc).slice(0, 20) : ''
  }));
  console.log('内核状态: ' + JSON.stringify(sup));

  const b64 = fs.readFileSync(path.resolve(__dirname, 'testdata/test_material.pdf')).toString('base64');
  const res = await page.evaluate(async (b64) => {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const f = new File([bytes], 'test_material.pdf', { type: 'application/pdf' });
      const r = await extractPdfText(f);
      return { pages: r.pages, len: r.text.length, head: r.text.slice(0, 60) };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  }, b64);
  console.log('提取结果: ' + JSON.stringify(res));

  console.log('\n--- 控制台 ---');
  logs.slice(0, 12).forEach(l => console.log('  ' + l));

  const okPdf = res.pages === 3 && res.len > 200 && /天花板/.test(res.head || '');
  console.log('\n本地版 PDF 导入: ' + (okPdf ? '✓ 可用' : '✗ 不可用'));
  await browser.close();
  process.exit(okPdf ? 0 : 2);
})().catch(e => { console.error('异常: ' + e.message); process.exit(1); });
