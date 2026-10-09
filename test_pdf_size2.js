// 精确探测：PDF 导入后，落库的那一行数据到底多大（1MB/行 是硬上限）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FILES = ['size_50.pdf', 'size_150.pdf', 'size_400.pdf', 'size_900.pdf'];

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  console.log('===== 中文文字型 PDF：解析结果与落库体积 =====');
  console.log('  文件'.padEnd(15) + '页数'.padEnd(7) + '提取字数'.padEnd(12) + '单行字节数'.padEnd(13) + '占 1MB 上限'.padEnd(13) + '结论');

  for (const name of FILES) {
    const p = path.join(__dirname, 'testdata', name);
    const b64 = fs.readFileSync(p).toString('base64');
    const r = await page.evaluate(async (arg) => {
      const bin = atob(arg.b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], arg.name, { type: 'application/pdf' });
      const res = await extractPdfText(file);
      // 按真实落库方式构造章节（splitPagesIntoChapters 会带上全文）
      const chapters = (typeof splitPagesIntoChapters === 'function')
        ? splitPagesIntoChapters(res.pageTexts || []) : [];
      const payload = JSON.stringify({
        原始文本: res.text,
        章节JSON: JSON.stringify(chapters)
      });
      const utf8 = new TextEncoder().encode(payload).length;
      return { pages: res.pages, chars: res.text.replace(/\s/g, '').length, utf8, rows: chapters.length };
    }, { b64, name });

    const pct = (r.utf8 / 1048576 * 100).toFixed(0) + '%';
    const okText = r.utf8 <= 1048576 ? '✅ 可同步' : '❌ 超行上限，云同步会失败';
    console.log('  ' + name.padEnd(15) + String(r.pages).padEnd(7)
      + r.chars.toLocaleString().padEnd(12)
      + (r.utf8 / 1024).toFixed(0).padStart(6) + ' KB'.padEnd(7)
      + pct.padEnd(13) + okText);
  }

  // ---------- 英文文本的对照：同样页数能装更多 ----------
  console.log('\n===== 英文文字型 PDF 对照（英文 1 字节/字符）=====');
  const en = await page.evaluate(() => {
    const para = 'The ceiling was clean in the morning light, and she looked up for a long time. She could not forget that beautiful corner. ';
    const perPage = para.repeat(Math.ceil(1600 / para.length)).slice(0, 1600); // 每页约 1600 字符
    const out = [];
    for (const pages of [50, 150, 300, 600]) {
      const text = Array.from({ length: pages }, (_, i) => 'Page ' + (i + 1) + '\n' + perPage).join('\n\n');
      const chapters = splitPagesIntoChapters(Array.from({ length: pages }, (_, i) => perPage));
      const payload = JSON.stringify({ 原始文本: text, 章节JSON: JSON.stringify(chapters) });
      out.push({ pages, utf8: new TextEncoder().encode(payload).length });
    }
    return out;
  });
  en.forEach(e => {
    console.log('  ' + (e.pages + ' 页').padEnd(10) + (e.utf8 / 1024).toFixed(0).padStart(6) + ' KB   '
      + (e.utf8 <= 1048576 ? '✅ 可同步' : '❌ 超 1MB'));
  });

  // ---------- 本地存储累计上限 ----------
  console.log('\n===== 本地存储累计上限（浏览器 localStorage）=====');
  const cum = await page.evaluate(() => {
    const blob = 'x'.repeat(500000);
    localStorage.removeItem('__cum__');
    let n = 0;
    try {
      const arr = [];
      for (; n < 40; n++) { arr.push(blob); localStorage.setItem('__cum__', arr.join('')); }
    } catch (e) { /* 触顶 */ }
    localStorage.removeItem('__cum__');
    const failed = (() => {
      try { localStorage.setItem('__full__', 'y'.repeat(6 * 1024 * 1024)); return false; }
      catch (e) { return true; }
    })();
    localStorage.removeItem('__full__');
    return { chunks: n, totalChars: n * 500000, quotaErrorDetected: failed };
  });
  console.log('  可容纳 ≈ ' + cum.totalChars.toLocaleString() + ' 字符（约 ' + (cum.totalChars / 1048576).toFixed(1) + ' M 字符）');
  console.log('  超出配额时浏览器是否抛错: ' + (cum.quotaErrorDetected ? '是' : '否'));

  await b.close();
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
