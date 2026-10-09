// 用「用户截图里的那一段原文」做端到端复刻
//
// 原文句 0：在九州北陆…有着这样一个游牧民族：他们尚武，信仰盘怼天神，崇拜英雄。
//   → DOM 里插进 （single）（folk）（them）（faith） 共 28 个字
// 原文句 1：那里的男儿个个都是热血汉子，那里的女子个个都是巾帼须眉，他们的王朝叫做青阳。（38 字）
//
// 用户实际划的是句 1 的前 11 个字「那里的男儿个个都是热血」，
// 旧版存成 28..39 → 高亮落在句尾「，他们的王朝叫做青阳。」（夹到句尾只剩 10 个字）。
// 这个脚本同时验证：新划的精确到字 + 用户那条旧笔记能一键修回来。
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8955/index.html';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

const RAW = '在九州北陆的大漠草原上有着这样一个游牧民族：他们尚武，信仰盘怼天神，崇拜英雄。'
          + '那里的男儿个个都是热血汉子，那里的女子个个都是巾帼须眉，他们的王朝叫做青阳。';
const SENT1 = '那里的男儿个个都是热血汉子，那里的女子个个都是巾帼须眉，他们的王朝叫做青阳。';
const WANT = '那里的男儿个个都是热血';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });

  await page.evaluate((raw) => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false;
    STATE.profileId = 'verify_case';
    STATE.learnMaterialId = 'm_jz';
    STATE.learnChapterId = 'c_1';
    STATE.learnMode = 'meaning';
    STATE.chapters = { m_jz: [{ id: 'c_1', title: '第1章', content: raw, targetWords: 10 }] };
    const mk = (w, lemma) => ({ position: 0 * 10000 + raw.indexOf(w), chWord: w, lemma: lemma, sense: '' });
    STATE.matches = { m_jz: { c_1: [mk('一个', 'single'), mk('游牧民族', 'folk'), mk('他们', 'them'), mk('信仰', 'faith')] } };
    STATE.progress = { m_jz: { c_1: { scrollPct: 0, mode: 'meaning' } } };
    STATE.notes = {};
    localStorage.removeItem('notes_v1_verify_case');
    document.getElementById('toggleWord').checked = true;
    document.getElementById('toggleIpa').checked = false;
    document.getElementById('toggleMeaning').checked = false;
    setNoteMode(false);
    refreshLearn(true);
  }, RAW);
  await page.waitForTimeout(700);

  group('一、复刻用户那一段：DOM 多出 28 个字');
  const info = await page.evaluate((raw) => {
    const pel = document.querySelector('#readingArea p[data-pi="0"]');
    const s1 = pel.querySelector('.sent[data-si="1"]');
    const rawStart = splitSentenceRanges(raw)[1].start;
    let domStart = 0;
    for (const k of pel.childNodes) { if (k === s1) break; domStart += k.textContent.length; }
    return {
      s0: pel.querySelector('.sent[data-si="0"]').textContent,
      shift: domStart - rawStart,
      rawStart: rawStart,
      s1Len: splitSentenceRanges(raw)[1].end - rawStart,
      mapped: rawOffsetOfPoint(pel, s1.firstChild, 0)
    };
  }, RAW);
  ok('★ 句 0 里插了 （single）（folk）（them）（faith）', info.s0.indexOf('（single）') >= 0 && info.s0.indexOf('（faith）') >= 0);
  ok('★ ★ 顶歪的量 = ' + 27 + ' 个字（= 4 段英文释义的总长）', info.shift === 27, info);
  ok('★ ★ 换算函数把句 1 起点还原成原文里的正确位置', info.mapped === info.rawStart, info);

  group('二、现在划「'+WANT+'」（11 字）');
  const pts = await page.evaluate(([from, to]) => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="1"]');
    const map = buildRawTextMap(el);
    function caret(off) {
      const loc = locateInMap(map, off);
      const r = document.createRange(); r.setStart(loc.node, loc.offset); r.setEnd(loc.node, loc.offset);
      const rc = r.getBoundingClientRect();
      return { x: rc.left, y: rc.top, h: rc.height };
    }
    return { a: caret(from), b: caret(to) };
  }, [0, WANT.length]);
  const y = pts.a.y + pts.a.h / 2;
  await page.mouse.move(pts.a.x + 0.5, y);
  await page.mouse.down();
  await page.mouse.move(pts.b.x + 0.5, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const now = await page.evaluate(() => {
    const n = chapterNotes('m_jz', 'c_1')[0];
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="1"]');
    const mark = el.querySelector('mark.note-hl-inline');
    return { ranges: n.ranges, markText: mark ? mark.textContent : null, quote: (document.querySelector('#noteDrawerBody .nt-quote') || {}).textContent };
  });
  ok('★ ★ cs=0 / ce=11（不是 28/39）', now.ranges && now.ranges[0].cs === 0 && now.ranges[0].ce === 11, now.ranges);
  ok('★ ★ 高亮正好落在「'+WANT+'」', now.markText === WANT, now.markText);
  ok('★ 卡片主行也是这 11 个字', now.quote === WANT, now.quote);

  group('三、用户那条旧笔记（标记落在句尾）一键修回');
  const fixed = await page.evaluate((want) => {
    const list = chapterNotes('m_jz', 'c_1');
    while (list.length) deleteNote(list[0].id);
    const area = document.getElementById('readingArea');
    const pel = area.querySelector('p[data-pi="0"]');
    const shift = rawShiftBeforeSent(pel, 0, 1);          // 当前页面实测的顶歪量
    const sents = splitSentenceRanges(currentParagraphs()[0]);
    const sentText = sents[1].text, total = sents[1].end - sents[1].start;

    function inject(cs, ce) {
      list.length = 0;
      const nt = {
        id: 'nt_case', ranges: [{ p: 0, si: 1, ei: 1, cs: cs, ce: ce }],
        sentences: [sentText], text: '1. ' + sentText,
        crossPara: false, createdAt: '2026-10-02T16:14:00Z'
      };
      list.push(nt);
      renderNoteHighlights(); renderNotePanel();
      return nt;
    }
    // (a) 错位量与当前页面一致（刚划完就来修，最常见）→ 必须分毫不差
    const a = inject(shift, shift + want.length);
    const aFix = shiftFixRanges(a.ranges, area);
    const aBefore = rangesExactSlice(a.ranges).text;
    const aAfter = rangesExactSlice(aFix || []).text;
    const recognized = isShiftedNote(a);
    const badge = document.getElementById('noteDrawerBody').textContent.slice(0, 90);
    // (b) 用户截图那条（存的是顶歪量 +1 的版本）→ 至少要离开句尾、落在句子开头附近
    const b = inject(shift + 1, shift + 1 + want.length);
    const bFix = shiftFixRanges(b.ranges, area);
    const bAfter = rangesExactSlice(bFix || []).text;
    return {
      shift: shift, total: total,
      recognized: recognized,
      aBefore: aBefore, aAfter: aAfter,
      bBefore: rangesExactSlice(b.ranges).text, bAfter: bAfter,
      bStartOffset: bFix ? bFix[0].cs : null,
      badge: badge, want: want
    };
  }, WANT);
  ok('★ 认出这是错位笔记', fixed.recognized === true, { shift: fixed.shift, total: fixed.total });
  ok('★ 修复前显示的是句尾那段（用户截图里的样子）', fixed.aBefore !== WANT && fixed.aBefore.length > 0, fixed.aBefore);
  ok('★ ★ 顶歪量与当前一致时，修复后分毫不差 = 「' + WANT + '」', fixed.aAfter === WANT, fixed.aAfter);
  ok('★ ★ 用户那条（±1）修完也落在句首附近（不再钉在句尾）', /^[^，。]{0,1}里的男儿个个都是热血/.test(fixed.bAfter), fixed.bAfter);
  ok('★ 修完的起点在句内前两个字以内', fixed.bStartOffset !== null && fixed.bStartOffset <= 1, fixed.bStartOffset);
  ok('★ 卡片标了「位置错位」并给了修复按钮', /位置错位|修复错位划线/.test(fixed.badge), fixed.badge);

  // 截图留证：还原用户那条（cs=27/ce=38，也就是她截图上的那条），修复后的真实样子
  await page.evaluate(() => {
    const list = chapterNotes('m_jz', 'c_1');
    const sents = splitSentenceRanges(currentParagraphs()[0]);
    list.length = 0;
    list.push({
      id: 'nt_user', ranges: [{ p: 0, si: 1, ei: 1, cs: 27, ce: 38 }],
      sentences: [sents[1].text], text: '1. ' + sents[1].text,
      crossPara: false, createdAt: '2026-10-02T16:14:00Z'
    });
    list[0].ranges = shiftFixRanges(list[0].ranges, document.getElementById('readingArea'));
    saveNotesLocal(); renderNoteHighlights();
    toggleNoteDrawer(true);
    renderNotePanel();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'G:/英语学习工作台/_shot_rawoff_fixed.png', fullPage: false });
  group('四、无异常');
  ok('★ 没有 JS 报错', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  const pass = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(60));
  console.log('用户原段复刻：' + pass + '/' + results.length + ' 通过');
  const failed = results.filter(r => !r.pass);
  if (failed.length) { console.log('失败项：'); failed.forEach(r => console.log('  ✗ ' + r.name)); process.exit(1); }
})();
