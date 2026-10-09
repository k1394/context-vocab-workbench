// 浏览器端集成验证：划线记笔记（真实页面、真实渲染、真实鼠标拖动）
// 不写任何云端数据（全程 offline）
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8933/index.html';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

const P1 = 'Alpha one sentence. Beta two sentence. Gamma three sentence.';
const P2 = 'Delta four sentence. Epsilon five sentence.';
const P3 = 'Zeta six sentence.';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined' && typeof STATE.wordbooks !== 'undefined', { timeout: 40000 });
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    // 学习页默认是 hidden 的，不显示出来 boundingBox 会返回 null，真实鼠标拖动就测不了
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
  });

  // ---------- 一、函数就位 ----------
  group('一、新函数在真实页面里就位');
  const fns = await page.evaluate(() => {
    const names = ['splitSentenceRanges', 'buildRanges', 'collectSentenceTexts', 'addNote', 'commitSelection',
      'renderNoteHighlights', 'renderNotePanel', 'toggleNoteMode', 'setNoteMode', 'toggleNoteDrawer',
      'deleteNote', 'noteFromRow', 'noteCloudProps', 'flushPendingNoteAdds', 'queuePendingNoteAdd',
      'sentOfNode', 'pointAtXY', 'isNoteModeOn'];
    const out = {};
    names.forEach(n => { out[n] = typeof window[n]; });
    return out;
  });
  Object.keys(fns).forEach(n => ok(n + ' 是函数', fns[n] === 'function', fns[n]));

  // ---------- 造一章并渲染 ----------
  const setupRes = await page.evaluate((p) => {
    STATE.cloudReady = false;              // 离线，绝不碰真实云端
    STATE.profileId = 'verify_notes';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{ id: 'c_t', title: '测试章', content: [p.p1, p.p2, p.p3].join('\n\n'), targetWords: 10 }] };
    STATE.matches = { m_t: { c_t: [] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'original' } } };
    STATE.notes = {};
    refreshLearn(true);
    const area = document.getElementById('readingArea');
    return {
      paras: area.querySelectorAll('p[data-pi]').length,
      sents: area.querySelectorAll('.sent[data-si]').length,
      s0: area.querySelectorAll('p[data-pi="0"] .sent').length,
      s1: area.querySelectorAll('p[data-pi="1"] .sent').length,
      s2: area.querySelectorAll('p[data-pi="2"] .sent').length,
      t1: (area.querySelector('p[data-pi="0"] .sent[data-si="1"]') || {}).textContent
    };
  }, { p1: P1, p2: P2, p3: P3 });

  group('二、渲染结构：段落带 data-pi，句子带 data-si');
  ok('3 个段落', setupRes.paras === 3, setupRes.paras);
  ok('★ 共 6 个句子 span（3+2+1）', setupRes.sents === 6, setupRes.sents);
  ok('第 1 段 3 句 / 第 2 段 2 句 / 第 3 段 1 句',
    setupRes.s0 === 3 && setupRes.s1 === 2 && setupRes.s2 === 1, [setupRes.s0, setupRes.s1, setupRes.s2]);
  ok('★ 句子文本与原文一致', String(setupRes.t1).trim() === 'Beta two sentence.', setupRes.t1);

  // ---------- 三、高亮还原 ----------
  group('三、已有笔记能被标回去');
  const hlRes = await page.evaluate(() => {
    const r = buildRanges({ p: 0, si: 1 }, { p: 0, si: 1 });
    addNote(r, collectSentenceTexts(r));
    renderNoteHighlights();
    const area = document.getElementById('readingArea');
    return {
      n: area.querySelectorAll('.sent.note-hl').length,
      txt: (area.querySelector('.sent.note-hl') || {}).textContent,
      notes: chapterNotes('m_t', 'c_t').length
    };
  });
  ok('★ 划线后出现 1 个高亮句子', hlRes.n === 1, hlRes.n);
  ok('★ 高亮的正是那一句', String(hlRes.txt).trim() === 'Beta two sentence.', hlRes.txt);
  ok('笔记入库 1 条', hlRes.notes === 1, hlRes.notes);

  // ---------- 四、跨两段 = 一条笔记 ----------
  group('四、一次划到两段 → 两段一起算「一条」笔记');
  const crossRes = await page.evaluate(() => {
    STATE.notes = {};
    const r = buildRanges({ p: 0, si: 2 }, { p: 1, si: 1 });   // Gamma + Delta + Epsilon
    const n = addNote(r, collectSentenceTexts(r));
    renderNoteHighlights();
    const area = document.getElementById('readingArea');
    const drawn = [];
    area.querySelectorAll('.sent.note-hl').forEach(e => drawn.push(e.textContent.trim()));
    return {
      rangeCount: n.ranges.length,
      cross: n.crossPara,
      text: n.text,
      sentences: n.sentences.length,
      drawn: drawn,
      listLen: chapterNotes('m_t', 'c_t').length
    };
  });
  ok('★ 笔记里存了 2 条 range（两段）', crossRes.rangeCount === 2, crossRes.rangeCount);
  ok('★ 标记为跨段', crossRes.cross === true);
  ok('★ 两段合起来只是「一条」笔记', crossRes.listLen === 1, crossRes.listLen);
  ok('★ 收了 3 句', crossRes.sentences === 3, crossRes.sentences);
  ok('★ 内容带序号 1. 2. 3.',
    crossRes.text === '1. Gamma three sentence.\n2. Delta four sentence.\n3. Epsilon five sentence.', crossRes.text);
  ok('★ 两段的句子都被标出来了', crossRes.drawn.length === 3, crossRes.drawn);

  // ---------- 五、真实鼠标拖动（原生选区路径）----------
  group('五、真实鼠标拖选 → 自动吸附成整句入笔记');
  await page.evaluate(() => {
    STATE.notes = {};
    renderNoteHighlights();
    renderNotePanel();
    const el = document.querySelector('#readingArea p[data-pi="2"]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
  const box3 = await page.locator('#readingArea p[data-pi="2"] .sent[data-si="0"]').boundingBox();
  ok('第 3 段的句子能取到屏幕坐标（元素可见）', !!box3, box3);
  if (box3) {
    await page.mouse.move(box3.x + 6, box3.y + box3.height / 2);
    await page.mouse.down();
    await page.mouse.move(box3.x + box3.width - 6, box3.y + box3.height / 2, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  const dragRes = await page.evaluate(() => {
    const arr = chapterNotes('m_t', 'c_t');
    return {
      count: arr.length,
      text: arr[0] ? arr[0].text : null,
      // v26 起高亮有两种形态：整句 class(.note-hl) 或句内切片(<mark>)，
      // 拖短距离会走后者，所以两个都要算
      hl: document.querySelectorAll('#readingArea .sent.note-hl').length,
      hlMark: document.querySelectorAll('#readingArea mark.note-hl-inline').length
    };
  });
  ok('★ 鼠标拖选产生了 1 条笔记', dragRes.count === 1, dragRes.count);
  ok('★ 收的是完整句子（不是单个单词）', dragRes.text === '1. Zeta six sentence.', dragRes.text);
  ok('★ 拖完立刻出现高亮标记（整句或句内切片都算）',
    dragRes.hl + dragRes.hlMark >= 1, { cls: dragRes.hl, mark: dragRes.hlMark });

  // ---------- 六、真实鼠标拖动（划线模式自绘路径）----------
  group('六、开「✏️ 划线」后用鼠标滑动 → 同样入笔记');
  await page.evaluate(() => {
    STATE.notes = {};
    renderNoteHighlights();
    setNoteMode(true);
    const el = document.querySelector('#readingArea p[data-pi="1"]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
  const modeOn = await page.evaluate(() => isNoteModeOn() && document.getElementById('readingArea').classList.contains('marking-mode'));
  ok('划线模式已开启（阅读区带 marking-mode）', modeOn === true);
  const box1 = await page.locator('#readingArea p[data-pi="1"] .sent[data-si="0"]').boundingBox();
  const box1b = await page.locator('#readingArea p[data-pi="1"] .sent[data-si="1"]').boundingBox();
  ok('第 2 段两个句子都能取到屏幕坐标', !!box1 && !!box1b, [!!box1, !!box1b]);
  if (box1 && box1b) {
    await page.mouse.move(box1.x + 10, box1.y + box1.height / 2);
    await page.mouse.down();
    await page.mouse.move(box1b.x + box1b.width - 8, box1b.y + box1b.height / 2, { steps: 14 });
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  const dragRes2 = await page.evaluate(() => {
    const arr = chapterNotes('m_t', 'c_t');
    const n = arr[0];
    return {
      count: arr.length,
      text: n ? n.text : null,
      ranges: n ? n.ranges : null,
      hl: document.querySelectorAll('#readingArea .sent.note-hl').length,
      hlMark: document.querySelectorAll('#readingArea mark.note-hl-inline').length,
      mode: isNoteModeOn()
    };
  });
  ok('★ 划线模式下拖动产生 1 条笔记', dragRes2.count === 1, dragRes2.count);
  ok('★ 同一段内跨句正确合并', dragRes2.text === '1. Delta four sentence.\n2. Epsilon five sentence.', dragRes2.text);
  // v26 起：拖整句 → 整句高亮；只拖一部分 → 句内 <mark>。两种都算「标出来了」
  ok('★ 两句都被标出（整句 class 或句内切片）',
    dragRes2.hl + dragRes2.hlMark >= 2,
    { cls: dragRes2.hl, mark: dragRes2.hlMark, ranges: dragRes2.ranges });

  // ---------- 七、单击不能误触发（点词看释义还得能用）----------
  group('七、单击不划伤原有交互');
  await page.evaluate(() => { STATE.notes = {}; renderNoteHighlights(); });
  const boxClick = await page.locator('#readingArea p[data-pi="2"] .sent[data-si="0"]').boundingBox();
  if (boxClick) {
    await page.mouse.move(boxClick.x + 20, boxClick.y + boxClick.height / 2);
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
  const clickRes = await page.evaluate(() => chapterNotes('m_t', 'c_t').length);
  ok('★ 单击不会产生笔记', clickRes === 0, clickRes);

  // ---------- 八、切模式后高亮不丢 ----------
  group('八、切换阅读模式后高亮仍在（按句子序号记录的好处）');
  const modeRes = await page.evaluate(() => {
    STATE.notes = {};
    const r = buildRanges({ p: 0, si: 1 }, { p: 1, si: 0 });
    addNote(r, collectSentenceTexts(r));
    renderNoteHighlights();
    const before = document.querySelectorAll('#readingArea .sent.note-hl').length;
    setLearnMode('meaning');                      // 会触发整段重建 innerHTML
    const after = document.querySelectorAll('#readingArea .sent.note-hl').length;
    setLearnMode('original');
    const back = document.querySelectorAll('#readingArea .sent.note-hl').length;
    return { before, after, back };
  });
  ok('★ 切到释义版后高亮还在', modeRes.after === modeRes.before && modeRes.after > 0, modeRes);
  ok('★ 切回原文版高亮也还在', modeRes.back === modeRes.before, modeRes);

  // ---------- 九、挖空模式下 input 不受影响 ----------
  group('九、挖空模式共存');
  const blankRes = await page.evaluate(() => {
    STATE.notes = { m_t: { c_t: [] } };
    setLearnMode('blank');
    const area = document.getElementById('readingArea');
    const sents = area.querySelectorAll('.sent').length;
    setLearnMode('original');
    return { sents: sents };
  });
  ok('挖空模式下句子 span 依然存在', blankRes.sents > 0, blankRes.sents);

  // ---------- 十、笔记抽屉 ----------
  group('十、右侧笔记抽屉');
  const drawerRes = await page.evaluate(() => {
    STATE.notes = {};
    const r1 = buildRanges({ p: 0, si: 0 }, { p: 0, si: 0 });
    addNote(r1, collectSentenceTexts(r1));
    const r2 = buildRanges({ p: 0, si: 2 }, { p: 1, si: 1 });
    addNote(r2, collectSentenceTexts(r2));
    toggleNoteDrawer(true);
    const d = document.getElementById('noteDrawer');
    return {
      open: d.classList.contains('open'),
      items: d.querySelectorAll('.note-item').length,
      badge: document.getElementById('noteCountBadge').textContent,
      hasCross: !!d.querySelector('.nt-badge-cross'),
      body: d.querySelector('#noteDrawerBody').textContent.length
    };
  });
  ok('★ 抽屉能打开', drawerRes.open === true);
  ok('★ 列出 2 条笔记', drawerRes.items === 2, drawerRes.items);
  ok('★ 工具栏角标显示 2', drawerRes.badge === '2', drawerRes.badge);
  ok('★ 跨段那条带「跨段」徽章', drawerRes.hasCross === true);
  ok('抽屉有内容', drawerRes.body > 0);

  // ---------- 十一、划完线不会立刻弹「删除？」 ----------
  group('十一、划完线立刻松手不该弹「删除这条划线笔记？」');
  await page.evaluate(() => {
    window.__TRACE = [];
    STATE.notes = {};
    renderNoteHighlights();
    const area = document.getElementById('readingArea');
    window.__POP = 0;
    // 包一层 openModal 的效果观测：直接盯 confirmModal 是否被 show
    const mo = new MutationObserver(() => {
      if (document.getElementById('confirmModal').classList.contains('show')) window.__POP++;
    });
    mo.observe(document.getElementById('confirmModal'), { attributes: true, attributeFilter: ['class'] });
    window.__MO = mo;
    area.__noteBound && area.removeEventListener('click', onNoteClick, true);
    area.addEventListener('click', onNoteClick, true);
  });
  const bx = await page.locator('#readingArea p[data-pi="0"] .sent[data-si="0"]').boundingBox();
  const bx2 = await page.locator('#readingArea p[data-pi="0"] .sent[data-si="1"]').boundingBox();
  if (bx && bx2) {
    await page.mouse.move(bx.x + 8, bx.y + bx.height / 2);
    await page.mouse.down();
    await page.mouse.move(bx2.x + bx2.width - 8, bx2.y + bx2.height / 2, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(600);
  const afterMark = await page.evaluate(() => ({
    notes: chapterNotes('m_t', 'c_t').length,
    pop: window.__POP,
    modalShown: document.getElementById('confirmModal').classList.contains('show')
  }));
  ok('★ 划线成功入笔记', afterMark.notes === 1, afterMark.notes);
  ok('★ 松手后没有弹出删除确认框', afterMark.pop === 0 && !afterMark.modalShown, afterMark);

  // 但等抑制窗口过去后，再点它仍然应该能删
  await page.waitForTimeout(600);
  if (bx) {
    await page.mouse.click(bx.x + 20, bx.y + bx.height / 2);
  }
  await page.waitForTimeout(300);
  const laterPop = await page.evaluate(() => document.getElementById('confirmModal').classList.contains('show'));
  ok('★ 隔一会儿再点划线，仍然会问「删除？」', laterPop === true, laterPop);
  await page.evaluate(() => {
    window.__MO && window.__MO.disconnect();
    closeModal('confirmModal');
  });

  // ---------- 十二、删除 ----------
  group('十二、点划线可以删除');
  const delRes = await page.evaluate(() => {
    const area = document.getElementById('readingArea');
    const arr = chapterNotes('m_t', 'c_t');
    const target = arr[arr.length - 1];
    const before = arr.length;
    const hlBefore = area.querySelectorAll('.sent.note-hl').length;
    const sentencesInTarget = (target.ranges || []).reduce((s, rg) => s + (rg.ei - rg.si + 1), 0);
    const okDel = deleteNote(target.id);
    renderNoteHighlights();
    return {
      okDel: okDel,
      before: before,
      after: chapterNotes('m_t', 'c_t').length,
      hlBefore: hlBefore,
      hlAfter: area.querySelectorAll('.sent.note-hl').length,
      // v26 起句内切片是 <mark>，删除后也应一并消失
      markAfter: area.querySelectorAll('mark.note-hl-inline').length,
      sentencesInTarget: sentencesInTarget,
      items: document.querySelectorAll('#noteDrawer .note-item').length
    };
  });
  ok('删除返回 true', delRes.okDel === true);
  ok('★ 列表少一条', delRes.after === delRes.before - 1, [delRes.before, delRes.after]);
  ok('★ 高亮全部清掉（整句 class 与句内切片都不剩）',
    delRes.hlAfter === 0 && delRes.markAfter === 0,
    { cls: delRes.hlAfter, mark: delRes.markAfter });

  // ---------- 十二、离线新增不会丢（进待办）----------
  group('十三、离线新增进待办，不丢数据');
  const pendRes = await page.evaluate(() => {
    LS.del('pendingNoteAdd_v1_verify_notes');
    STATE.notes = { m_t: { c_t: [] } };
    STATE.cloudReady = false;
    const r = buildRanges({ p: 0, si: 0 }, { p: 0, si: 0 });
    addNote(r, collectSentenceTexts(r));
    const list = LS.get('pendingNoteAdd_v1_verify_notes', []);
    return { len: list.length, id: list[0] && list[0].noteId };
  });
  ok('★ 离线新增被记进待办', pendRes.len === 1, pendRes);
  ok('待办里就是刚划的那条', !!pendRes.id, pendRes.id);

  // ---------- 十三、无异常 ----------
  group('十四、运行期异常');
  ok('★ 无未捕获异常', errors.length === 0, errors.slice(0, 3));

  await browser.close();

  const fail = results.filter(r => !r.pass);
  console.log('\n' + (results.length - fail.length) + '/' + results.length + ' 通过');
  if (fail.length) {
    console.log('失败项：');
    fail.forEach(f => console.log('  ✗ ' + f.name));
    process.exit(1);
  }
})();
