// 诊断：按下点落在 span 左边界时，pointAtXY 是否返回 null
const { chromium } = require('playwright');
const path = require('path');

const P1 = 'The first sentence here. The second sentence here. The third sentence here.';
const P2 = 'Beta sentence two. Gamma sentence three.';
const P3 = 'Delta sentence four.';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://127.0.0.1:8933/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(([p1, p2, p3]) => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    STATE.cloudReady = false;
    STATE.profileId = 'dbg_edge';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{ id: 'c_t', title: 'T', content: [p1, p2, p3].join('\n\n'), targetWords: 10 }] };
    STATE.matches = { m_t: { c_t: [] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'original' } } };
    STATE.notes = {};
    refreshLearn(true);
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
  }, [P1, P2, P3]);
  await page.waitForTimeout(600);

  const box = await page.locator('#readingArea p[data-pi="1"] .sent[data-si="0"]').boundingBox();
  console.log('box =', JSON.stringify(box));

  // 采样：左边缘 / 中心 / 右边缘 各点，看 pointAtXY 返回什么
  const probes = [
    ['box.x+0', box.x + 0],
    ['box.x+1', box.x + 1],
    ['box.x+2', box.x + 2],
    ['box.x+4', box.x + 4],
    ['中心', box.x + box.width / 2],
  ];
  for (const [label, x] of probes) {
    const y = box.y + box.height / 2;
    const r = await page.evaluate(([px, py]) => {
      let rr = null;
      try { rr = document.caretRangeFromPoint(px, py); } catch (e) {}
      const sn = rr && rr.startContainer ? (rr.startContainer.nodeType === 3 ? rr.startContainer.parentNode : rr.startContainer) : null;
      return {
        hasRange: !!rr,
        nodeName: sn ? sn.nodeName : null,
        cls: sn ? (sn.className || '') : null,
        dataSi: sn ? sn.getAttribute && sn.getAttribute('data-si') : null,
        pointAt: pointAtXY(px, py),
        elFrom: (function () { const e = document.elementFromPoint(px, py); return e ? (e.tagName + '.' + (e.className || '')) : null; })()
      };
    }, [x, y]);
    console.log(label.padEnd(10), JSON.stringify(r));
  }

  await browser.close();
})();