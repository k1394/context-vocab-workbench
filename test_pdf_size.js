// 探测 PDF 导入的真实容量边界：解析耗时、提取字数、本地存储配额
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FILES = ['size_50.pdf', 'size_150.pdf', 'size_400.pdf', 'size_900.pdf'];

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  // ---------- A. 本地存储配额（决定能存下多少提取出来的文本）----------
  console.log('===== A. 浏览器 localStorage 实际容量 =====');
  const quota = await page.evaluate(() => {
    const key = '__quota_probe__';
    const can = (n) => {
      try { localStorage.setItem(key, 'a'.repeat(n)); localStorage.removeItem(key); return true; }
      catch (e) { return false; }
    };
    let lo = 0, hi = 64 * 1024 * 1024;   // 上限探到 64M 字符
    if (can(hi)) return { chars: hi, note: '超过 64M 字符仍未触顶' };
    while (lo + 1 < hi) { const mid = Math.floor((lo + hi) / 2); if (can(mid)) lo = mid; else hi = mid; }
    return { chars: lo };
  });
  console.log('  最多可存 ≈ ' + quota.chars.toLocaleString() + ' 个字符'
    + '（约 ' + (quota.chars / 1048576).toFixed(1) + ' MB 字符 / 中英混排约 '
    + (quota.chars / 1048576 * 2).toFixed(1) + ' MB 占用）');

  // ---------- B. 逐档解析 ----------
  console.log('\n===== B. 各档 PDF 的解析表现 =====');
  console.log('  文件'.padEnd(16) + '体积'.padEnd(12) + '页数'.padEnd(8) + '提取字数'.padEnd(14) + '耗时'.padEnd(10) + '能否存下');
  for (const name of FILES) {
    const p = path.join(__dirname, 'testdata', name);
    const b64 = fs.readFileSync(p).toString('base64');
    const sizeMB = (fs.statSync(p).size / 1048576).toFixed(2);
    const r = await page.evaluate(async ({ b64, name }) => {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], name, { type: 'application/pdf' });
      const t0 = performance.now();
      try {
        const res = await extractPdfText(file);
        const ms = Math.round(performance.now() - t0);
        // 模拟真实保存：把提取出的正文塞进 localStorage
        localStorage.setItem('__probe_mat__', JSON.stringify([{ id: 'x', rawContent: res.text }]));
        localStorage.removeItem('__probe_mat__');
        return { pages: res.pages, chars: res.text.replace(/\s/g, '').length, ms, ok: true };
      } catch (e) {
        return { error: (e && e.message) || String(e), ms: Math.round(performance.now() - t0) };
      }
    }, { b64, name });

    if (r.error) {
      console.log('  ' + name.padEnd(16) + sizeMB.padEnd(12) + '-'.padEnd(8) + '-'.padEnd(14) + (r.ms + 'ms').padEnd(10) + '失败: ' + r.error.slice(0, 30));
    } else {
      console.log('  ' + name.padEnd(16) + (sizeMB + 'MB').padEnd(12) + String(r.pages).padEnd(8)
        + r.chars.toLocaleString().padEnd(14) + (r.ms + 'ms').padEnd(10)
        + (r.ok ? '✅ 可以' : '❌ 超配额'));
    }
  }

  // ---------- C. 多次导入累计是否触顶 ----------
  console.log('\n===== C. 连续导入多份，看累计占用何时触顶 =====');
  const b64 = fs.readFileSync(path.join(__dirname, 'testdata', 'size_150.pdf')).toString('base64');
  const cum = await page.evaluate(async (b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'a.pdf', { type: 'application/pdf' });
    const res = await extractPdfText(file);
    const per = JSON.stringify([{ id: 'x', rawContent: res.text }]).length;
    localStorage.removeItem('__cum__');
    let n = 0, err = '';
    try {
      const arr = [];
      for (; n < 60; n++) {
        arr.push({ id: 'm' + n, rawContent: res.text });
        localStorage.setItem('__cum__', JSON.stringify(arr));
      }
    } catch (e) { err = e.name; }
    localStorage.removeItem('__cum__');
    return { perMB: (per / 1048576).toFixed(2), max: n, err };
  }, b64);          // ★ 这个 b64 以前漏传了：evaluate 里拿到 undefined，atob 直接抛
                    //   InvalidCharacterError，测试永远跑不到结论（和产品代码无关）
  console.log('  单份 150 页约占用 ' + cum.perMB + ' MB → 最多可同时存 ' + cum.max + ' 份' + (cum.err ? '（' + cum.err + '）' : ''));

  await b.close();
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
