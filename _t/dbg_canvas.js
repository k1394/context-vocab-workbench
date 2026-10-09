const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('http://127.0.0.1:8933/index.html', { waitUntil: 'load' });
  await p.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });
  await p.evaluate(() => {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('view-learn').classList.remove('hidden');
    document.getElementById('learnContent').classList.remove('hidden');
    STATE.cloudReady = false; STATE.profileId = 'dbg'; STATE.learnMaterialId='m_t';
    STATE.learnChapterId='c_t'; STATE.learnMode='original';
    STATE.chapters={m_t:[{id:'c_t',title:'t',content:'Alpha one. Beta two.',targetWords:9}]};
    STATE.matches={m_t:{c_t:[]}}; STATE.progress={m_t:{c_t:{scrollPct:0,mode:'original'}}};
    STATE.notes={}; localStorage.removeItem('strokes_v1_dbg');
    refreshLearn(true);
  });
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const el = document.getElementById('noteDrawLayer');
    const rect = el.getBoundingClientRect();
    const s = drawScale();
    return { styleW: el.style.width, styleH: el.style.height, w: el.width, h: el.height,
      rect: {l:rect.left,t:rect.top,w:rect.width,h:rect.height},
      scale: {r:{l:s.r.left,t:s.r.top}, w:s.w, h:s.h}, dpr: window.devicePixelRatio,
      show: _DRAW_STYLE.show, hasCtx: !!_DRAW_CTX };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
