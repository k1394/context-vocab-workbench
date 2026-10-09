// 临时探针：划线模式下自绘路径为什么不产生笔记
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8933/index.html';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERROR', String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined' && typeof STATE.wordbooks !== 'undefined', { timeout: 40000 });
  await page.evaluate(() => {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('view-learn').classList.remove('hidden');
    document.getElementById('learnContent').classList.remove('hidden');
    STATE.cloudReady = false;
    STATE.profileId = 'probe_notes';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{ id: 'c_t', title: '测试章', content: 'Delta four sentence. Epsilon five sentence.', targetWords: 10 }] };
    STATE.matches = { m_t: { c_t: [] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'original' } } };
    STATE.notes = {};
    refreshLearn(true);

    // 额外挂一层打点（不影响原有监听）
    window.__CNT = { down: 0, move: 0, up: 0, cancel: 0, lastXY: null, targets: [], preve: [] };
    const area = document.getElementById('readingArea');
    window.__CNT.bound = !!area.__noteBound;
    area.addEventListener('pointerdown', e => { window.__CNT.down++; window.__CNT.targets.push((e.target.tagName || '') + '.' + (e.target.className || '')); }, true);
    area.addEventListener('pointermove', e => { window.__CNT.move++; window.__CNT.lastXY = [e.clientX, e.clientY]; }, true);
    area.addEventListener('pointerup', e => { window.__CNT.up++; }, true);
    area.addEventListener('pointercancel', () => { window.__CNT.cancel++; }, true);
    setNoteMode(true);
  });
  await page.waitForTimeout(300);

  // 1) 手写 PointerEvent 直接喂给处理器，验证逻辑本身
  const manual = await page.evaluate(() => {
    const area = document.getElementById('readingArea');
    const p = area.querySelector('p[data-pi="0"] .sent[data-si="0"]');
    const q = area.querySelector('p[data-pi="0"] .sent[data-si="1"]');
    const a = p.getBoundingClientRect(), b = q.getBoundingClientRect();
    const mk = (type, x, y) => new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, pointerType: 'mouse' });
    const x0 = a.left + 10, y0 = a.top + a.height / 2;
    const x1 = b.right - 8, y1 = b.top + b.height / 2;
    area.dispatchEvent(mk('pointerdown', x0, y0));
    const st1 = { down: _ND.down, self: _ND.self, from: _ND.from };
    area.dispatchEvent(mk('pointermove', x0 + 30, y0));
    area.dispatchEvent(mk('pointermove', x1, y1));
    const st2 = { moved: _ND.moved, to: _ND.to, preview: area.querySelectorAll('.sent.preview-hl').length };
    area.dispatchEvent(mk('pointerup', x1, y1));
    return { st1, st2, notes: chapterNotes('m_t', 'c_t').length };
  });
  console.log('--- 手写 PointerEvent ---');
  console.log(JSON.stringify(manual, null, 2));

  // 2) 真实鼠标拖动
  await page.evaluate(() => { STATE.notes = {}; renderNoteHighlights(); window.__CNT = Object.assign(window.__CNT, { down: 0, move: 0, up: 0, cancel: 0 }); });
  const box1 = await page.locator('#readingArea p[data-pi="0"] .sent[data-si="0"]').boundingBox();
  const box1b = await page.locator('#readingArea p[data-pi="0"] .sent[data-si="1"]').boundingBox();
  console.log('box1 =', JSON.stringify(box1), ' box1b =', JSON.stringify(box1b));
  await page.mouse.move(box1.x + 10, box1.y + box1.height / 2);
  await page.mouse.down();
  await page.mouse.move(box1b.x + box1b.width - 8, box1b.y + box1b.height / 2, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const real = await page.evaluate(() => ({
    cnt: window.__CNT,
    notes: chapterNotes('m_t', 'c_t').length,
    mode: isNoteModeOn(),
    bound: document.getElementById('readingArea').__noteBound === true
  }));
  console.log('--- 真实鼠标拖动 ---');
  console.log(JSON.stringify(real, null, 2));

  await browser.close();
})();
