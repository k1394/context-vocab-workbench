// 线上 v26 诊断：她看到的到底是什么版本 + 三个问题是否真存在
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  const f = page.frames().find(fr => /index\.html/.test(fr.url()));
  console.log('帧 URL:', f ? f.url() : '(无)');
  await f.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });

  // ---- 1. 线上版本 ----
  const ver = await f.evaluate(() => ({
    pointAtXYChar: typeof pointAtXYChar,
    buildRangesChar: typeof buildRangesChar,
    renderNoteHighlightsByChar: typeof renderNoteHighlightsByChar,
    buildRangesCharInSource: document.documentElement.innerHTML.indexOf('buildRangesChar') >= 0,
    layerPos: (function () {
      const el = document.getElementById('noteDrawLayer');
      return el ? getComputedStyle(el).position : '(无 canvas)';
    })(),
    strokeColor: typeof drawGetStyle === 'function' ? drawGetStyle().color : '?',
    strokeAlpha: typeof drawGetStyle === 'function' ? drawGetStyle().alpha : '?',
    alphaSlider: !!document.getElementById('drawAlpha'),
    swatches: document.querySelectorAll('.note-swatch').length
  }));
  console.log('\n=== 线上版本 ===');
  console.log(JSON.stringify(ver, null, 2));

  // ---- 2. 真实场景：正文里有 word-ins（点词标记）时能否定位到字 ----
  await f.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false;
    STATE.profileId = 'probe_v26';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{
      id: 'c_t', title: 'T',
      content: '他喜欢雨落日时候的云霞，看着阳光把它们渡上一层淡金色。\n\n阿亦勒把帐篷的帘子掀开了一线。',
      targetWords: 10
    }] };
    STATE.matches = { m_t: { c_t: [] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'original' } } };
    STATE.notes = {};
    refreshLearn(true);
  });
  await f.waitForTimeout(800);

  // 注入 word-ins（模拟真实渲染后句子里有 span 的情况）
  const withSpans = await f.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    // 手动把「云霞」包成 word-ins，模拟真实渲染
    const text = el.textContent;
    const i = text.indexOf('云霞');
    if (i >= 0) {
      const node = el.firstChild;
      el.innerHTML = '';
      el.appendChild(document.createTextNode(text.slice(0, i)));
      const sp = document.createElement('span');
      sp.className = 'word-ins';
      sp.textContent = text.slice(i, i + 2);
      el.appendChild(sp);
      el.appendChild(document.createTextNode(text.slice(i + 2)));
    }
    return { text: el.textContent, spans: Array.from(el.querySelectorAll('span')).map(x => x.className) };
  });
  console.log('\n=== 造出带 word-ins 的句子 ===');
  console.log(JSON.stringify(withSpans));

  // 在 word-ins 附近取值
  const probe = await f.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const sp = el.querySelector('.word-ins');
    const r = sp.getBoundingClientRect();
    const px = r.left + r.width / 2, py = r.top + r.height / 2;
    const res = pointAtXYChar(px, py);
    // caretRange 落在哪
    let nodeInfo = null;
    try {
      const rr = document.caretRangeFromPoint(px, py);
      if (rr) {
        const n = rr.startContainer;
        const e2 = n.nodeType === 3 ? n.parentNode : n;
        nodeInfo = { type: n.nodeType, nodeName: e2.tagName, cls: (e2.className || '').toString(), offset: rr.startOffset };
      }
    } catch (e) { nodeInfo = { err: String(e) }; }
    return { off: res ? res.off : null, nodeInfo, sentLen: el.textContent.length };
  });
  console.log('\n=== 在 word-ins 上定位 ===');
  console.log(JSON.stringify(probe, null, 2));

  // ---- 3. 划几个字看结果 ----
  await f.evaluate(() => { setNoteMode(true); STATE.notes = {}; renderNoteHighlights(); });
  await f.waitForTimeout(200);
  const chars = await f.evaluate(() => {
    // 逐字量（可能跨多个文本节点）
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let acc = 0, n;
    while ((n = walker.nextNode())) {
      const len = n.nodeValue.length;
      for (let i = 0; i < len; i++) {
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 1);
        const rc = r.getBoundingClientRect();
        if (rc.width > 0) out.push({ i: acc + i, ch: n.nodeValue.charAt(i), x: rc.left, w: rc.width, top: rc.top, h: rc.height });
      }
      acc += len;
    }
    return { out, textLen: el.textContent.length };
  });
  console.log('\n=== 逐字坐标（含 span 内） ===');
  console.log(' 量到', chars.out.length, '字 / 共', chars.textLen, '字');

  if (chars.out.length >= 8) {
    const c0 = chars.out[0], c6 = chars.out[6];
    const y = c0.top + c0.h / 2;
    await page.mouse.move(c0.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(c6.x + c6.w - 1, y, { steps: 8 });
    await page.mouse.up();
  }
  await f.waitForTimeout(500);
  const after = await f.evaluate(() => {
    const arr = chapterNotes('m_t', 'c_t');
    const n = arr[0];
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const mark = el ? el.querySelector('mark.note-hl-inline') : null;
    return {
      notes: arr.length,
      ranges: n ? n.ranges : null,
      hasMark: !!mark,
      markText: mark ? mark.textContent : null,
      sentCls: el ? el.className : null,
      canvasInk: (function () {
        const c = document.getElementById('noteDrawLayer');
        if (!c) return '无 canvas';
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return n;
      })()
    };
  });
  console.log('\n=== 划 7 个字后 ===');
  console.log(JSON.stringify(after, null, 2));

  // ---- 4. pen 事件 ----
  const pen = await f.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="1"]') || document.querySelector('.sent');
    const r = el.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
    const ev = new PointerEvent('pointerdown', {
      clientX: r.left + 20, clientY: r.top + r.height / 2, pressure: 0.6,
      pointerId: 7, pointerType: 'pen', isPrimary: true, button: 0, buttons: 1,
      bubbles: true, cancelable: true
    });
    (target || el).dispatchEvent(ev);
    const res = { down: _ND.down, self: _ND.self, pointerType: _ND.pointerType, strokeId: _ND.strokeId, noteMode: isNoteModeOn() };
    if (typeof penRelease === 'function') penRelease();
    _ND.down = false; _ND.self = false; _ND.strokeId = null;
    return res;
  });
  console.log('\n=== pen 事件 ===');
  console.log(JSON.stringify(pen));

  console.log('\n=== 异常 ===', errors.slice(0, 3));
  await browser.close();
})();