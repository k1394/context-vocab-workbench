// 诊断：完整复刻 verify 的第五→第六组时序，看划线模式下 pointer 链路在哪断
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8933/index.html';

const P1 = 'Alpha one sentence. Beta two sentence. Gamma three sentence.';
const P2 = 'Delta four sentence. Epsilon five sentence.';
const P3 = 'Zeta six sentence.';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERROR', String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined' && typeof STATE.wordbooks !== 'undefined', { timeout: 40000 });
  await page.evaluate(([p1, p2, p3]) => {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('view-learn').classList.remove('hidden');
    document.getElementById('learnContent').classList.remove('hidden');
    STATE.cloudReady = false;
    STATE.profileId = 'verify_notes';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{ id: 'c_t', title: '测试章', content: [p1, p2, p3].join('\n\n'), targetWords: 10 }] };
    STATE.matches = { m_t: { c_t: [] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'original' } } };
    STATE.notes = {};
    refreshLearn(true);

    // 关键：包一层记录 _ND 每一步的真实状态
    window.__TRACE = [];
    const area = document.getElementById('readingArea');
    const snap = (tag, e) => window.__TRACE.push({
      tag, type: e ? e.type : null, pointerType: e ? e.pointerType : null,
      btn: e ? e.button : null, buttons: e ? e.buttons : null,
      target: e ? (e.target.tagName + '.' + (e.target.className || '')) : null,
      inArea: e ? area.contains(e.target) : null,
      down: _ND.down, self: _ND.self, moved: _ND.moved,
      from: _ND.from ? JSON.stringify(_ND.from) : null,
      to: _ND.to ? JSON.stringify(_ND.to) : null,
      preve: area.querySelectorAll('.sent.preview-hl').length
    });
    area.addEventListener('pointerdown', e => snap('down', e), true);
    area.addEventListener('pointermove', e => snap('move', e), true);
    area.addEventListener('pointerup', e => snap('up', e), true);
    area.addEventListener('pointercancel', e => snap('cancel', e), true);
    // 也监听 window，捕获没进 area 的情况
    window.addEventListener('pointerdown', e => { if (!area.contains(e.target)) snap('down@win', e); }, true);
  }, [P1, P2, P3]);

  // ---- 复刻第五组：原生拖选（第 3 段单句）----
  await page.waitForTimeout(400);
  const b5 = await page.locator('#readingArea p[data-pi="2"] .sent[data-si="0"]').boundingBox();
  await page.mouse.move(b5.x + 20, b5.y + b5.height / 2);
  await page.mouse.down();
  await page.mouse.move(b5.x + b5.width - 6, b5.y + b5.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after5 = await page.evaluate(() => {
    const showns = [];
    document.querySelectorAll('.modal-overlay.show').forEach(m => {
      showns.push({ id: m.id, title: (m.querySelector('#confirmTitle, .modal-title, h3') || {}).textContent });
    });
    return { notes: chapterNotes('m_t', 'c_t').length, modalShown: showns };
  });
  console.log('第五组后 =', JSON.stringify(after5));

  // ---- 复刻第六组：划线模式 ----
  await page.evaluate(() => {
    window.__TRACE = [];
    STATE.notes = {};
    renderNoteHighlights();
    setNoteMode(true);
    const el = document.querySelector('#readingArea p[data-pi="1"]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
  const box1 = await page.locator('#readingArea p[data-pi="1"] .sent[data-si="0"]').boundingBox();
  const box1b = await page.locator('#readingArea p[data-pi="1"] .sent[data-si="1"]').boundingBox();
  console.log('box1 =', JSON.stringify(box1));
  console.log('box1b =', JSON.stringify(box1b));

  await page.mouse.move(box1.x + 10, box1.y + box1.height / 2);
  await page.mouse.down();
  await page.mouse.move(box1b.x + box1b.width - 8, box1b.y + box1b.height / 2, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const out = await page.evaluate(() => {
    const t = window.__TRACE;
    const showns = [];
    document.querySelectorAll('.modal-overlay.show').forEach(m => {
      showns.push({ id: m.id, title: (m.querySelector('.modal-title, #confirmTitle, h3') || {}).textContent });
    });
    return {
      traceLen: t.length,
      modalShown: showns,
      notes: chapterNotes('m_t', 'c_t').length,
      mode: isNoteModeOn(),
      bound: document.getElementById('readingArea').__noteBound === true,
      hl: document.querySelectorAll('#readingArea .sent.note-hl').length
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();