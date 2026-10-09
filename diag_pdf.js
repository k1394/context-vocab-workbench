// 细粒度诊断：逐项确认 pdf.js 在浏览器里的行为
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8899;
const BASE = 'http://127.0.0.1:' + PORT;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push('[' + m.type() + '] ' + m.text().slice(0, 240)));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => logs.push('[reqfail] ' + r.url().slice(-60) + ' ' + (r.failure() || {}).errorText));
  page.on('response', r => { if (r.status() >= 400) logs.push('[http' + r.status() + '] ' + r.url().slice(-70)); });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const out = await page.evaluate(async () => {
    const r = {};

    // 内置 worker 文本块的组成
    const t = document.getElementById('pdfjsWorkerCode').textContent;
    r.workerBlockLen = t.length;
    r.hasCMAPVar = t.indexOf('var CMAP_B64') !== -1;
    r.shimPos = t.indexOf('内置中文字符映射表');
    r.workerPos = t.indexOf('__webpack_require__') !== -1 ? t.indexOf('__webpack_require__') : t.indexOf('function');
    r.headOfBlock = t.slice(0, 60);

    const buf = await (await fetch('/testdata/test_material.pdf')).arrayBuffer();
    const data = new Uint8Array(buf);

    async function tryCfg(name, opt) {
      const res = { cfg: name };
      try {
        const pdf = await pdfjsLib.getDocument(Object.assign({ data: data.slice() }, opt)).promise;
        res.pages = pdf.numPages;
        const p = await pdf.getPage(1);
        const tc = await p.getTextContent();
        res.items = tc.items.length;
        res.strs = tc.items.slice(0, 6).map(i => i.str);
        res.styles = Object.keys(tc.styles || {}).slice(0, 4);
      } catch (e) {
        res.error = (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
      }
      return res;
    }

    r.a_noCmap = await tryCfg('无 cMapUrl', { isEvalSupported: false });
    r.b_withCmap = await tryCfg('cMapUrl=inline-cmaps/', { isEvalSupported: false, cMapUrl: 'inline-cmaps/', cMapPacked: true });
    r.c_likeProd = await tryCfg('与 extractPdfText 一致', { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, cMapUrl: 'inline-cmaps/', cMapPacked: true });
    r.d_customFactory = await tryCfg('自定义 CMapReaderFactory', { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, CMapReaderFactory: InlineCMapReaderFactory });
    r.e_viaExtract = await (async () => {
      const f = new File([buf], 'test_material.pdf', { type: 'application/pdf' });
      const res = await extractPdfText(f);
      return { pages: res.pages, scannedRatio: res.scannedRatio, textLen: res.text.length, head: res.text.slice(0, 90) };
    })();
    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  console.log('\n--- 网络/控制台 ---');
  logs.slice(0, 30).forEach(l => console.log('  ' + l));
  await browser.close();
})().catch(e => { console.error('诊断异常: ' + e.message); process.exit(1); });
