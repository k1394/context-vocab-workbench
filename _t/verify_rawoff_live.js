// 浏览器实测：段落里有英文释义（（them）（faith））时，划线偏移不能被顶歪
//
// 复现的事故：量位置按 DOM 文本算、用位置按原文算，差的就是这段插入物的长度，
// 于是「划 11 个字」记成 13..24，高亮整段跑到句尾。
//
// 这个用例故意把释义放在「前一句」里 —— 旧代码在这里必然失败（cs=13），
// 新代码必须给出 cs=0 / ce=11，且 <mark> 里正好是「那里的男儿个个都是热血」。
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8955/index.html';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

// 原文（注意：这一串是「原文」，DOM 里会被插进 （them）（faith））
const RAW = '他们尚武，信仰盘怼天神。那里的男儿个个都是热血好汉，巾帼也有。';
const SENT1 = '那里的男儿个个都是热血好汉，巾帼也有。';
const WANT = '那里的男儿个个都是热血';        // 只划这 11 个字
const GLOSS = '（them）（faith）';              // 前一句里插入的释义（6+7=13 个字）

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });

  // ---------- 初始化：造一段带标注的正文 ----------
  await page.evaluate((raw) => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false;
    STATE.profileId = 'verify_rawoff';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'meaning';
    STATE.chapters = { m_t: [{ id: 'c_t', title: '测试', content: raw, targetWords: 10 }] };
    STATE.matches = { m_t: { c_t: [
      { position: 0 * 10000 + raw.indexOf('他们'), chWord: '他们', lemma: 'them', sense: '' },
      { position: 0 * 10000 + raw.indexOf('信仰'), chWord: '信仰', lemma: 'faith', sense: '' }
    ] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'meaning' } } };
    STATE.notes = {};
    localStorage.removeItem('notes_v1_verify_rawoff');
    localStorage.removeItem('strokes_v1_verify_rawoff');
    // 只留「英文」这一项，插入物的长度才是确定的
    document.getElementById('toggleWord').checked = true;
    document.getElementById('toggleIpa').checked = false;
    document.getElementById('toggleMeaning').checked = false;
    setNoteMode(false);
    refreshLearn(true);
  }, RAW);
  await page.waitForTimeout(700);

  // ---------- 一、DOM 里确实插了释义（否则这个用例没意义）----------
  group('一、前提：正文 DOM 比原文多出（them）（faith）');
  const dom = await page.evaluate(() => {
    const pel = document.querySelector('#readingArea p[data-pi="0"]');
    const s0 = pel.querySelector('.sent[data-si="0"]');
    const s1 = pel.querySelector('.sent[data-si="1"]');
    return {
      s0Text: s0.textContent,
      s1Text: s1.textContent,
      glossSpans: pel.querySelectorAll('[data-gloss]').length,
      domLen: pel.textContent.length
    };
  });
  ok('★ 释义确实插进去了（（them）（faith）在句子里）', dom.s0Text.indexOf('（them）') >= 0 && dom.s0Text.indexOf('（faith）') >= 0, dom.s0Text);
  ok('★ 打上了 data-gloss 标记（2 个插入物）', dom.glossSpans === 2, dom.glossSpans);

  // ---------- 二、换算函数：DOM 偏移 → 原文偏移 ----------
  group('二、rawOffsetOfPoint / buildRawTextMap 走的是原文坐标');
  const conv = await page.evaluate((raw) => {
    const pel = document.querySelector('#readingArea p[data-pi="0"]');
    const s1 = pel.querySelector('.sent[data-si="1"]');
    // DOM 里第 1 句起点 = 原文起点 + 插入物长度
    const rawStart = splitSentenceRanges(raw)[1].start;
    const domStart = (function () {
      let n = 0;
      for (const k of pel.childNodes) { if (k === s1) break; n += k.textContent.length; }
      return n;
    })();
    const first = s1.firstChild;
    const mapped = rawOffsetOfPoint(pel, first, 0);
    const map = buildRawTextMap(s1);
    return { rawStart, domStart, mapped, shift: domStart - rawStart, mapLen: map.length, mapLast: map[map.length - 1].end };
  }, RAW);
  ok('★ DOM 起点确实比原文起点靠后（就是被顶歪的量）', conv.shift === GLOSS.length, conv);
  ok('★ ★ 换算函数把 DOM 起点还原成原文起点', conv.mapped === conv.rawStart, conv);
  ok('★ 句内 map 的原文总长 = 原文句长（不含释义）', conv.mapLast === SENT1.length, conv);

  // ---------- 三、鼠标拖选 11 个字（原生选区路径）----------
  group('三、★ 划「那里的男儿个个都是热血」→ 必须精确到 11 个字');
  async function dragChars(si, from, to) {
    const pts = await page.evaluate(([si, from, to]) => {
      const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="' + si + '"]');
      const map = buildRawTextMap(el);
      function caret(off) {
        const loc = locateInMap(map, off);
        const r = document.createRange();
        r.setStart(loc.node, loc.offset);
        r.setEnd(loc.node, loc.offset);
        const rc = r.getBoundingClientRect();
        return { x: rc.left, y: rc.top, h: rc.height };
      }
      return { a: caret(from), b: caret(to) };
    }, [si, from, to]);
    const y = pts.a.y + pts.a.h / 2;
    await page.mouse.move(pts.a.x + 0.5, y);
    await page.mouse.down();
    await page.mouse.move(pts.b.x + 0.5, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(450);
    return pts;
  }

  await dragChars(1, 0, WANT.length);

  const after = await page.evaluate(() => {
    const list = chapterNotes('m_t', 'c_t');
    const n = list[0];
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="1"]');
    const mark = el ? el.querySelector('mark.note-hl-inline') : null;
    const sel = window.getSelection();
    const quote = document.querySelector('#noteDrawerBody .nt-quote');
    return {
      notes: list.length,
      ranges: n ? n.ranges : null,
      hasMark: !!mark,
      markText: mark ? mark.textContent : null,
      sentWhole: el ? el.classList.contains('note-hl') : null,
      selText: (sel && !sel.isCollapsed) ? String(sel) : '',
      quote: quote ? quote.textContent : null,
      panel: document.getElementById('noteDrawerBody').textContent
    };
  });
  ok('★ 产生 1 条笔记', after.notes === 1, after.notes);
  ok('★ ★ cs = 0（从句子第一个字开始，不是被顶歪的 13）',
    after.ranges && after.ranges[0].cs === 0, after.ranges);
  ok('★ ★ ce = 11（正好 11 个字，不是 24）',
    after.ranges && after.ranges[0].ce === WANT.length, after.ranges);
  ok('★ ★ 高亮是句内 <mark>，不是整句 class', after.hasMark === true && after.sentWhole === false,
    { hasMark: after.hasMark, sentWhole: after.sentWhole });
  ok('★ ★ ★ mark 里正好是「' + WANT + '」', after.markText === WANT, after.markText);
  ok('★ 划完原生选区被清掉（不再留那片蓝）', after.selText === '', after.selText);
  ok('★ ★ 卡片主行显示的就是这 11 个字', after.quote === WANT, after.quote);
  ok('★ 卡片上有「精确 11 字」', /精确\s*11\s*字/.test(after.panel), (after.panel || '').slice(0, 160));
  ok('★ 没有把这条误标成「位置错位」', after.panel.indexOf('位置错位') < 0);

  // ---------- 四、划线模式（自绘路径）也一样 ----------
  group('四、★ 开「划线模式」用鼠标划：同样精确到字');
  await page.evaluate(() => {
    const list = chapterNotes('m_t', 'c_t');
    while (list.length) deleteNote(list[0].id);
    renderNoteHighlights();
    renderNotePanel();
    setNoteMode(true);
  });
  await page.waitForTimeout(200);
  await dragChars(1, 0, WANT.length);
  const selfPath = await page.evaluate(() => {
    const n = chapterNotes('m_t', 'c_t')[0];
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="1"]');
    const mark = el ? el.querySelector('mark.note-hl-inline') : null;
    return { ranges: n ? n.ranges : null, markText: mark ? mark.textContent : null };
  });
  ok('★ ★ 自绘路径 cs = 0', selfPath.ranges && selfPath.ranges[0].cs === 0, selfPath.ranges);
  ok('★ ★ 自绘路径 ce = 11', selfPath.ranges && selfPath.ranges[0].ce === WANT.length, selfPath.ranges);
  ok('★ ★ 自绘路径 mark 里正好是「' + WANT + '」', selfPath.markText === WANT, selfPath.markText);

  // ---------- 五、原文版（没有释义插入物）不能被改坏 ----------
  group('五、原文版：没有释义插入物时照旧精确');
  await page.evaluate(() => {
    const list = chapterNotes('m_t', 'c_t');
    while (list.length) deleteNote(list[0].id);
    setNoteMode(false);
    STATE.learnMode = 'orig';
    refreshLearn(true);
  });
  await page.waitForTimeout(500);
  await dragChars(0, 0, 6);       // 拖到第 6 个 caret → 覆盖「他们尚武，信」6 个字
  const origMode = await page.evaluate(() => {
    const n = chapterNotes('m_t', 'c_t')[0];
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const mark = el ? el.querySelector('mark.note-hl-inline') : null;
    return { ranges: n ? n.ranges : null, markText: mark ? mark.textContent : null, sentText: el ? el.textContent : null };
  });
  ok('★ 原文版 cs = 0', origMode.ranges && origMode.ranges[0].cs === 0, origMode.ranges);
  ok('★ 原文版 ce = 6（只划到第 6 个字）', origMode.ranges && origMode.ranges[0].ce === 6, origMode.ranges);
  ok('★ 原文版 mark 是「他们尚武，信」', origMode.markText === '他们尚武，信', origMode.markText);

  // ---------- 六、旧版错位笔记：能认出来 + 能修回去 ----------
  group('六、旧版错位笔记（cs=13/ce=24）认得出来且能修');
  const repair = await page.evaluate(([raw, want]) => {
    STATE.learnMode = 'meaning';
    refreshLearn(true);
    const list = chapterNotes('m_t', 'c_t');
    while (list.length) deleteNote(list[0].id);
    // 手动塞一条「旧版算错」的笔记：13..24（正好被前一句的释义顶歪 13 个字）
    const broken = {
      id: 'nt_broken_test', ranges: [{ p: 0, si: 1, ei: 1, cs: 13, ce: 24 }],
      sentences: ['那里的男儿个个都是热血好汉，巾帼也有。'],
      text: '1. 那里的男儿个个都是热血好汉，巾帼也有。',
      crossPara: false, createdAt: '2026-10-02T16:14:00Z'
    };
    list.push(broken);
    renderNoteHighlights();
    renderNotePanel();
    const area = document.getElementById('readingArea');
    const recognized = isShiftedNote(broken);
    const fixed = shiftFixRanges(broken.ranges, area);
    const beforeText = rangesExactSlice(broken.ranges).text;
    const afterText = rangesExactSlice(fixed || []).text;
    const panel = document.getElementById('noteDrawerBody').textContent;
    return { recognized, fixed, beforeText, afterText, panel, want: want };
  }, [RAW, WANT]);
  ok('★ ★ 被认出来是「位置错位」', repair.recognized === true);
  ok('★ 修好后的偏移是 cs=0 / ce=11',
    repair.fixed && repair.fixed[0].cs === 0 && repair.fixed[0].ce === WANT.length, repair.fixed);
  ok('★ ★ 修好后的片段正好是「' + WANT + '」', repair.afterText === WANT, repair.afterText);
  ok('★ 修之前显示的确实是句尾那段（错位可见）', repair.beforeText !== WANT, repair.beforeText);
  ok('★ 面板上有「修复错位划线」入口', repair.panel.indexOf('修复错位划线') >= 0, (repair.panel || '').slice(0, 120));

  // ---------- 七、没有 JS 报错 ----------
  group('七、运行期无报错');
  ok('★ 页面没有抛异常', errors.length === 0, errors.slice(0, 3));

  await browser.close();

  const pass = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(60));
  console.log('划线偏移（释义插入物顶歪）：' + pass + '/' + results.length + ' 通过');
  const failed = results.filter(r => !r.pass);
  if (failed.length) { console.log('失败项：'); failed.forEach(r => console.log('  ✗ ' + r.name)); process.exit(1); }
})();
