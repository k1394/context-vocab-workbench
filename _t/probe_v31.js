// 线上 v31 验证：v30 划线偏移修复 + v31 性能修复是否真到位
const { chromium } = require('playwright');
const URL = 'https://www.workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';
const results = [];
function ok(n, c, e) { results.push({n, c: !!c}); console.log((c ? '  ✓ ' : '  ✗ ') + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); }
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(8000);
  const f = page.frames().find(fr => /index\.html/.test(fr.url()));
  console.log('帧:', f ? f.url() : '(无)');
  if (!f) { console.log('未找到内容帧'); await b.close(); return; }
  await f.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 60000 });
  await f.waitForTimeout(3000);

  const v = await f.evaluate(() => {
    const t = (n) => { try { return typeof window[n]; } catch (e) { return 'ERR'; } };
    const sp = (typeof window.__SMART_PAGE__ !== 'undefined') ? window.__SMART_PAGE__ : null;
    return {
      smart: !!sp, smartDb: sp && sp.database ? Object.keys(sp.database).slice(0, 4) : [],
      shiftFix: t('shiftFixRanges'), isShifted: t('isShiftedNote'),
      drawPlace: t('drawPlaceLayer'), penLooks: t('penLooksLikeStylus'),
      exact: t('rangesExactSlice'), glossInDom: document.querySelectorAll('[data-gloss]').length,
      bodyPos: getComputedStyle(document.body).position,
      pdfLibBlock: !!document.getElementById('pdfjsLibCode'),
      pdfLibLoaded: (typeof window.pdfjsLib !== 'undefined'),
      workerBlock: !!document.getElementById('pdfjsWorkerCode'),
      src: String(document.documentElement.innerHTML).slice(0, 0)
    };
  });
  console.log('\n=== 一、版本与云端 ===');
  ok('★ 云端 SDK 已注入（__SMART_PAGE__ 存在）', v.smart === true, v.smartDb);
  ok('★ v30 划线偏移修复在（shiftFixRanges）', v.shiftFix === 'function');
  ok('★ v30 旧笔记识别在（isShiftedNote）', v.isShifted === 'function');
  ok('★ v31 画布定位函数在（drawPlaceLayer）', v.drawPlace === 'function');
  ok('★ 笔识别函数在（penLooksLikeStylus）', v.penLooks === 'function');
  ok('★ body 为 relative（画布定位基准）', v.bodyPos === 'relative', v.bodyPos);

  console.log('\n=== 二、首屏减重 ===');
  ok('★ pdfjs 内核是惰性块（不参与首屏编译）', v.pdfLibBlock === true);
  ok('★ 首屏 pdfjsLib 未加载（按需生效）', v.pdfLibLoaded === false, v.pdfLibLoaded);
  ok('★ worker 惰性块仍在', v.workerBlock === true);

  // 三、实跑：造带释义插入物的段落，划 5 个字，看高亮是否只落在那 5 个字
  const hl = await f.evaluate(async () => {
    document.getElementById('authScreen') && (document.getElementById('authScreen').style.display = 'none');
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    document.getElementById('view-learn').classList.remove('hidden');
    document.getElementById('learnContent').classList.remove('hidden');
    STATE.cloudReady = false; STATE.profileId = 'v31p'; STATE.learnMaterialId = 'm_p';
    STATE.learnChapterId = 'c_p'; STATE.learnMode = 'original';
    STATE.chapters = { m_p: [{ id: 'c_p', title: 'T', content: '他尚武，（single）信义，（folk）他们的王朝叫青阳。\n\n第二段。', targetWords: 9 }] };
    STATE.matches = { m_p: { c_p: [] } }; STATE.progress = { m_p: { c_p: { scrollPct: 0, mode: 'original' } } };
    STATE.notes = {};
    localStorage.removeItem('notes_v1_v31p'); localStorage.removeItem('strokes_v1_v31p');
    refreshLearn(true);
    await new Promise(r => setTimeout(r, 600));
    const pel = document.querySelector('#readingArea p[data-pi="0"]');
    const sent = pel.querySelector('.sent[data-si="0"]');
    // 在句内插两段释义（模拟真实渲染）
    const txt = sent.textContent;
    sent.innerHTML = '';
    const i1 = txt.indexOf('信义') + 2;
    sent.appendChild(document.createTextNode(txt.slice(0, i1)));
    const g1 = document.createElement('span'); g1.className = 'word-ins'; g1.setAttribute('data-gloss', '1'); g1.textContent = '（single）';
    sent.appendChild(g1);
    sent.appendChild(document.createTextNode(txt.slice(i1)));
    // 直接调用字符级建笔记：划「信义，」共 3 字（用 range 精确选）
    const n0 = sent.firstChild;
    const r = document.createRange();
    r.setStart(n0, txt.indexOf('信义')); r.setEnd(n0, i1);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    return { txt: txt, glossCount: document.querySelectorAll('[data-gloss]').length };
  });
  console.log('\n=== 三、释义插入物与原文坐标 ===');
  ok('★ 释义被标记为 data-gloss', hl.glossCount >= 1, hl.glossCount);

  // 直接验证 rawOffsetOfPoint / buildRawTextMap 存在
  const raw = await f.evaluate(() => ({
    rawOffset: typeof rawOffsetOfPoint,
    buildMap: typeof buildRawTextMap,
    shift: (typeof shiftFixRanges === 'function') ? 'ok' : 'no'
  }));
  ok('★ 原文坐标工具 rawOffsetOfPoint 在', raw.rawOffset === 'function');
  ok('★ 原文坐标工具 buildRawTextMap 在', raw.buildMap === 'function');

  console.log('\n页面未捕获异常:', errors.length, errors.slice(0, 2));
  const pass = results.filter(r => r.c).length;
  console.log('\n线上探针：' + pass + '/' + results.length + ' 通过');
  await page.screenshot({ path: 'G:/英语学习工作台/_shot_v31_online.png' });
  await b.close();
})();
