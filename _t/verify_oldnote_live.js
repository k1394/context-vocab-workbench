// 验证「新旧笔记区分 + 一键清理整句笔记」
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8933/index.html';

const SENT = '吕归尘被族群妻子那一眼张扬而不服输的韧劲所吸引，两人结下了深厚的友谊。';
const WHOLE = '阿亦勒把帐篷的帘子掀开了一线。';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });
  await page.evaluate(([s1, s2]) => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('view-learn').classList.remove('hidden');
    document.getElementById('learnContent').classList.remove('hidden');
    STATE.cloudReady = false;
    STATE.profileId = 'oldnew';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{ id: 'c_t', title: 'T', content: s1 + '\n\n' + s2, targetWords: 9 }] };
    STATE.matches = { m_t: { c_t: [] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'original' } } };
    // ★ 造真实场景：一条旧笔记（整句，无 cs/ce）+ 一条新笔记（有 cs/ce）
    STATE.notes = { 'm_t': { 'c_t': [
      { id: 'nt_old', ranges: [{ p: 0, si: 0, ei: 0 }], sentences: [s1],
        text: '1. ' + s1, crossPara: false, createdAt: '2026-10-02T16:00:00Z' },
      { id: 'nt_new', ranges: [{ p: 1, si: 0, ei: 0, cs: 3, ce: 9 }], sentences: [s2],
        text: '1. ' + s2, crossPara: false, createdAt: '2026-10-02T23:50:00Z' }
    ] } };
    localStorage.setItem('notes_v1_oldnew', JSON.stringify(STATE.notes));
    refreshLearn(true);
  }, [SENT, WHOLE]);
  await page.waitForTimeout(800);

  group('一、旧笔记（整句）能被识别');
  const classify = await page.evaluate(() => {
    const arr = chapterNotes('m_t', 'c_t');
    return {
      total: arr.length,
      oldIsWhole: isWholeSentenceNote(arr.find(n => n.id === 'nt_old')),
      newIsWhole: isWholeSentenceNote(arr.find(n => n.id === 'nt_new')),
      oldChars: noteCharCount(arr.find(n => n.id === 'nt_old')),
      newChars: noteCharCount(arr.find(n => n.id === 'nt_new'))
    };
  });
  ok('★ 旧笔记（无 cs/ce）被识别为整句', classify.oldIsWhole === true, classify);
  ok('★ 新笔记（有 cs/ce）不被误判', classify.newIsWhole === false);
  ok('旧笔记字数统计为 0（没标具体字）', classify.oldChars === 0, classify.oldChars);
  ok('★ 新笔记统计出 6 个字', classify.newChars === 6, classify.newChars);

  group('二、面板上有清晰标识');
  const panel = await page.evaluate(() => {
    toggleNoteDrawer(true);
    renderNotePanel();
    const body = document.getElementById('noteDrawerBody');
    return {
      hasOldBar: !!body.querySelector('.note-oldbar'),
      oldBarText: (body.querySelector('.note-oldbar') || {}).textContent || '',
      wholeBadges: body.querySelectorAll('.nt-badge-whole').length,
      exactBadges: body.querySelectorAll('.nt-badge-exact').length,
      wholeItems: body.querySelectorAll('.note-item-whole').length,
      hasCleanBtn: !!body.querySelector('.note-oldbar button')
    };
  });
  ok('★ 面板顶部出现「整句笔记」提示条', panel.hasOldBar === true, panel.oldBarText.trim().slice(0, 40));
  ok('★ 提示条说明了原因和清理方式', /之前划的/.test(panel.oldBarText), panel.oldBarText.trim());
  ok('★ 有一条「整句」徽章', panel.wholeBadges === 1, panel.wholeBadges);
  ok('★ 有一条「精确 N 字」徽章', panel.exactBadges === 1, panel.exactBadges);
  ok('★ 整句那条有条目有区分样式', panel.wholeItems === 1, panel.wholeItems);
  ok('★ 有一键清理按钮', panel.hasCleanBtn === true);

  group('三、正文里的高亮形态正确区分');
  const hl = await page.evaluate(() => {
    const s0 = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const s1 = document.querySelector('#readingArea p[data-pi="1"] .sent[data-si="0"]');
    return {
      oldCls: s0 ? s0.className : null,
      oldHasMark: s0 ? !!s0.querySelector('mark.note-hl-inline') : null,
      oldBg: s0 ? getComputedStyle(s0).backgroundColor : null,
      newCls: s1 ? s1.className : null,
      newHasMark: s1 ? !!s1.querySelector('mark.note-hl-inline') : null,
      newMarkText: s1 && s1.querySelector('mark') ? s1.querySelector('mark').textContent : null
    };
  });
  ok('★ 旧笔记显示为整句高亮（绿色、无 mark）',
    hl.oldCls.indexOf('note-hl') >= 0 && hl.oldHasMark === false, { cls: hl.oldCls, bg: hl.oldBg });
  ok('★ 新笔记显示为句内 mark（琥珀色、只标几个字）',
    hl.newCls.indexOf('note-hl-partial') >= 0 && hl.newHasMark === true, { cls: hl.newCls, mark: hl.newMarkText });

  group('四、一键清理整句笔记');
  const clean = await page.evaluate(() => {
    const before = chapterNotes('m_t', 'c_t').length;
    // 直接调清理逻辑（跳过 showConfirm 的按钮点击）
    const doomed = chapterNotes('m_t', 'c_t').filter(isWholeSentenceNote);
    const n = doomed.length;
    doomed.forEach(d => deleteNote(d.id));
    renderNoteHighlights();
    renderNotePanel();
    const arr = chapterNotes('m_t', 'c_t');
    return {
      before, doomed: n,
      after: arr.length,
      leftIds: arr.map(x => x.id),
      oldBarGone: !document.getElementById('noteDrawerBody').querySelector('.note-oldbar'),
      // 清理后正文高亮也应该跟着变
      s0Cls: (document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]') || {}).className
    };
  });
  ok('★ 只清掉 1 条整句笔记', clean.doomed === 1, clean.doomed);
  ok('★ 精确划线的那条被保留', clean.after === 1 && clean.leftIds[0] === 'nt_new', clean.leftIds);
  ok('★ 清理后提示条消失', clean.oldBarGone === true);
  ok('★ 清理后正文整句高亮也没了（class 里已无 note-hl）',
    String(clean.s0Cls || '').indexOf('note-hl') < 0, clean.s0Cls);

  group('五、没有整句笔记时不该出现清理提示');
  const noOld = await page.evaluate(() => {
    renderNotePanel();
    const body = document.getElementById('noteDrawerBody');
    return { hasOldBar: !!body.querySelector('.note-oldbar') };
  });
  ok('★ 全是精确笔记时不显示清理提示条', noOld.hasOldBar === false, noOld);

  group('六、运行期异常');
  ok('★ 无未捕获异常', errors.length === 0, errors);

  const pass = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log('新旧笔记区分：' + pass + '/' + results.length + ' 通过');
  const failed = results.filter(r => !r.pass);
  if (failed.length) { console.log('失败项：'); failed.forEach(r => console.log('  ✗ ' + r.name)); process.exit(1); }
  await browser.close();
})();