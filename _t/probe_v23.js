// 线上 v23 探针：划线记笔记功能是否真的上线可用
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

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

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);

  const frames = page.frames();
  const f = frames.find(fr => /index\.html/.test(fr.url()));
  ok('找到页面帧', !!f);
  if (!f) { await browser.close(); process.exit(1); }
  console.log('    帧 URL: ' + f.url());
  await f.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });

  // ---------- 一、版本 ----------
  group('一、版本与新表');
  const env = await f.evaluate(() => ({
    dbIds: typeof DB_IDS !== 'undefined' ? Object.keys(DB_IDS).length : 0,
    hasNotes: typeof DB_IDS !== 'undefined' && !!DB_IDS.context_notes,
    notesId: typeof DB_IDS !== 'undefined' ? (DB_IDS.context_notes || '') : ''
  }));
  ok('★ DB_IDS 里有 context_notes', env.hasNotes === true, env);
  ok('笔记表 id 已注入', /^[A-Za-z0-9]{8,}$/.test(env.notesId), env.notesId);

  // ---------- 二、函数就位 ----------
  group('二、划线笔记函数全部就位');
  const fns = await f.evaluate(() => {
    const names = ['splitSentenceRanges', 'buildRanges', 'collectSentenceTexts', 'addNote', 'commitSelection',
      'renderNoteHighlights', 'renderNotePanel', 'toggleNoteMode', 'setNoteMode', 'toggleNoteDrawer',
      'deleteNote', 'noteFromRow', 'noteCloudProps', 'flushPendingNoteAdds', 'queuePendingNoteAdd',
      'sentOfNode', 'pointAtXY', 'isNoteModeOn', 'suppressNextClick', 'clickSuppressed'];
    const out = {};
    names.forEach(n => { out[n] = typeof window[n]; });
    return out;
  });
  const missing = Object.keys(fns).filter(k => fns[k] !== 'function');
  ok('★ 20 个函数全部是 function', missing.length === 0, missing);

  // ---------- 三、UI 在页面上 ----------
  group('三、界面元素真的在页面上');
  // 按钮在学习页工具栏上。#view-learn 和 #learnContent 都带 .hidden，
  // 只取消其中一个 offsetParent 仍是 null，两个都取消才能真实可见。
  await f.evaluate(() => {
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    // refreshLearn 会按数据决定 learnContent 是否显示，这里数据为空会重新隐藏，
    // 所以可见性判定放在 refreshLearn 之后（第四节），这里只验元素存在与样式注入。
  });
  const ui = await f.evaluate(() => {
    const btn = document.getElementById('btnNoteMode');
    const badge = document.getElementById('noteCountBadge');
    const drawer = document.getElementById('noteDrawer');
    return {
      btn: !!btn, btnText: btn ? btn.textContent : null, btnVisible: btn ? !!btn.offsetParent : false,
      btnDisplay: btn ? getComputedStyle(btn).display : null,
      btnVisibility: btn ? getComputedStyle(btn).visibility : null,
      badge: !!badge,
      drawer: !!drawer,
      clsHl: Array.from(document.styleSheets).some(ss => {
        try { return Array.from(ss.cssRules).some(r => (r.selectorText || '').indexOf('note-hl') >= 0); }
        catch (e) { return false; }
      }),
      clsMarking: Array.from(document.styleSheets).some(ss => {
        try { return Array.from(ss.cssRules).some(r => (r.selectorText || '').indexOf('marking-mode') >= 0); }
        catch (e) { return false; }
      })
    };
  });
  ok('★ 「✏️ 划线」按钮在页面上', ui.btn === true, ui.btnText);
  ok('笔记角标元素存在', ui.badge === true);
  ok('★ 右侧抽屉存在', ui.drawer === true);
  ok('note-hl 高亮样式已注入', ui.clsHl === true);
  ok('marking-mode 样式已注入', ui.clsMarking === true);
  ok('★ 按钮自身样式正常（display:flex / visible）',
    ui.btnDisplay === 'flex' && ui.btnVisibility === 'visible', { d: ui.btnDisplay, v: ui.btnVisibility });

  // ---------- 四、真实划线 ----------
  group('四、真实鼠标划线');
  await f.evaluate(([p1, p2, p3]) => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false;                // 离线，绝不碰真实云端
    STATE.profileId = 'probe_v23';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{ id: 'c_t', title: '探针章', content: [p1, p2, p3].join('\n\n'), targetWords: 10 }] };
    STATE.matches = { m_t: { c_t: [] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'original' } } };
    STATE.notes = {};
    refreshLearn(true);
  }, [P1, P2, P3]);
  await f.waitForTimeout(600);

  // 4.0 数据渲染后按钮必须真的可见（不是被 hidden 祖先挡住）
  const vis = await f.evaluate(() => {
    const vl = document.getElementById('view-learn'), lc = document.getElementById('learnContent');
    const btn = document.getElementById('btnNoteMode');
    return {
      viewHidden: vl ? vl.classList.contains('hidden') : null,
      contentHidden: lc ? lc.classList.contains('hidden') : null,
      btnOffsetParent: btn ? !!btn.offsetParent : null,
      btnRectH: btn ? Math.round(btn.getBoundingClientRect().height) : null,
      btnRectW: btn ? Math.round(btn.getBoundingClientRect().width) : null,
      drawerBtn: !!document.getElementById('btnNoteDrawer')
    };
  });
  ok('★ 学习页两层容器都已展开', vis.viewHidden === false && vis.contentHidden === false, vis);
  ok('★ 渲染后「✏️ 划线」按钮真实可见且有尺寸',
    vis.btnOffsetParent === true && vis.btnRectH > 0 && vis.btnRectW > 0, vis);
  ok('★ 「📝 笔记」抽屉按钮也在', vis.drawerBtn === true);

  // 4.1 只划一个单词 → 应吸附成整句
  const b0 = await f.locator('#readingArea p[data-pi="0"] .sent[data-si="1"]').boundingBox();
  ok('第 1 段第 2 句可定位', !!b0, b0 && { x: b0.x, w: b0.width });
  if (b0) {
    // 只在句中拖 20px（肯定只盖住半个单词）
    await page.mouse.move(b0.x + b0.width * 0.4, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width * 0.4 + 22, b0.y + b0.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  await f.waitForTimeout(400);
  const onlyWord = await f.evaluate(() => {
    const arr = chapterNotes('m_t', 'c_t');
    return {
      count: arr.length,
      text: arr[0] ? arr[0].text : null,
      hl: document.querySelectorAll('#readingArea .sent.note-hl').length,
      modalShown: document.getElementById('confirmModal').classList.contains('show')
    };
  });
  ok('★ 只划半个单词也产生 1 条笔记', onlyWord.count === 1, onlyWord.count);
  ok('★ ★ 入笔记的是完整句子，不是光秃秃的单词',
    onlyWord.text === '1. Beta two sentence.', onlyWord.text);
  ok('★ 划完立刻出现高亮', onlyWord.hl === 1, onlyWord.hl);
  ok('★ ★ 划完没有立刻弹「删除这条划线笔记？」', onlyWord.modalShown === false, onlyWord.modalShown);

  // 4.2 一次划两段（第 0 段 → 第 1 段）→ 一条笔记、带序号
  await f.evaluate(() => {
    STATE.notes = {};
    renderNoteHighlights();
    setNoteMode(true);
    const el = document.querySelector('#readingArea p[data-pi="1"]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await f.waitForTimeout(400);
  const c1 = await f.locator('#readingArea p[data-pi="0"] .sent[data-si="2"]').boundingBox();
  const c2 = await f.locator('#readingArea p[data-pi="1"] .sent[data-si="1"]').boundingBox();
  if (c1 && c2) {
    await page.mouse.move(c1.x + 8, c1.y + c1.height / 2);
    await page.mouse.down();
    await page.mouse.move(c1.x + c1.width - 8, c1.y + c1.height / 2, { steps: 6 });
    await page.mouse.move(c2.x + c2.width - 8, c2.y + c2.height / 2, { steps: 14 });
    await page.mouse.up();
  }
  await f.waitForTimeout(400);
  const cross = await f.evaluate(() => {
    const arr = chapterNotes('m_t', 'c_t');
    const n = arr[0];
    return {
      count: arr.length,
      text: n ? n.text : null,
      ranges: n ? n.ranges.length : 0,
      cross: n ? n.crossPara : null,
      hl: Array.from(document.querySelectorAll('#readingArea .sent.note-hl')).map(e => e.textContent.trim())
    };
  });
  ok('★ 两段合起来只是「一条」笔记', cross.count === 1 && cross.ranges === 2, { count: cross.count, ranges: cross.ranges });
  ok('★ 标记为跨段', cross.cross === true);
  ok('★ 内容带序号 1. 2. 3.',
    cross.text === '1. Gamma three sentence.\n2. Delta four sentence.\n3. Epsilon five sentence.', cross.text);
  ok('★ 两段的句子都被标出来了', cross.hl.length === 3, cross.hl);

  // 4.3 一次划三段 → 仍然只是「一条」笔记（比你要求的还多支持一段）
  await f.evaluate(() => {
    STATE.notes = {};
    renderNoteHighlights();
    setNoteMode(true);
    document.querySelector('#readingArea p[data-pi="2"]').scrollIntoView({ block: 'center' });
  });
  await f.waitForTimeout(400);
  const d1 = await f.locator('#readingArea p[data-pi="0"] .sent[data-si="0"]').boundingBox();
  const d3 = await f.locator('#readingArea p[data-pi="2"] .sent[data-si="0"]').boundingBox();
  if (d1 && d3) {
    await page.mouse.move(d1.x + 8, d1.y + d1.height / 2);
    await page.mouse.down();
    await page.mouse.move(d1.x + d1.width - 8, d1.y + d1.height / 2, { steps: 6 });
    await page.mouse.move(d3.x + d3.width - 8, d3.y + d3.height / 2, { steps: 16 });
    await page.mouse.up();
  }
  await f.waitForTimeout(400);
  const three = await f.evaluate(() => {
    const arr = chapterNotes('m_t', 'c_t');
    const n = arr[0];
    return {
      count: arr.length, ranges: n ? n.ranges.length : 0,
      sentences: n ? n.sentences.length : 0,
      firstIsNumbered: n ? /^1\. /.test(n.text) : false,
      numbered: n ? (n.text.match(/\n\d+\. /g) || []).length + 1 : 0
    };
  });
  ok('★ 一次划三段仍只算「一条」笔记', three.count === 1 && three.ranges === 3, three);
  ok('★ 三段共 6 句全部收进来', three.sentences === 6, three.sentences);
  ok('★ 6 句依次编号 1.~6.', three.numbered === 6 && three.firstIsNumbered, three);

  // ---------- 五、抽屉 ----------
  group('五、右侧笔记抽屉');
  await f.evaluate(() => { toggleNoteMode(); toggleNoteDrawer(true); });
  await f.waitForTimeout(300);
  const drawer = await f.evaluate(() => ({
    open: document.getElementById('noteDrawer').classList.contains('open'),
    items: document.querySelectorAll('#noteDrawer .note-item').length,
    hasCross: document.body.innerHTML.indexOf('跨段') >= 0,
    badge: (document.getElementById('noteCountBadge') || {}).textContent
  }));
  ok('★ 抽屉能打开', drawer.open === true);
  ok('★ 列出 1 条笔记', drawer.items === 1, drawer.items);
  ok('跨段那条带「跨段」徽章', drawer.hasCross === true);
  ok('角标显示 1', String(drawer.badge) === '1', drawer.badge);

  // ---------- 六、删除 ----------
  group('六、点划线可以删除');
  await f.evaluate(() => {
    const n = chapterNotes('m_t', 'c_t')[0];
    const okDel = deleteNote(n.id);
    renderNoteHighlights();
    return { okDel: okDel, left: chapterNotes('m_t', 'c_t').length, hl: document.querySelectorAll('#readingArea .sent.note-hl').length };
  }).then(r => {
    ok('删除返回 true', r.okDel === true, r);
    ok('★ 笔记清空', r.left === 0, r.left);
    ok('★ 高亮全部清掉', r.hl === 0, r.hl);
  });

  // ---------- 七、离线不丢 ----------
  group('七、离线新增进待办');
  const pend = await f.evaluate(() => {
    const before = pendingNoteList().length;
    STATE.notes = {};
    const r = buildRanges({ p: 0, si: 0 }, { p: 0, si: 0 });
    const n = addNote(r, collectSentenceTexts(r));
    n._cloudId = undefined;
    queuePendingNoteAdd({ matId: 'm_t', chId: 'c_t', noteId: n.id });
    const list = pendingNoteList();
    return { grew: list.length - before, len: list.length, hasNew: list.some(x => x.noteId === n.id) };
  });
  ok('★ 离线新增被记进待办', pend.grew === 1 && pend.hasNew === true, pend);

  // ---------- 八、运行期异常 ----------
  group('八、运行期异常');
  ok('★ 无未捕获异常', errors.length === 0, errors);

  const pass = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log('线上 v23 探针：' + pass + '/' + results.length + ' 通过');
  const failed = results.filter(r => !r.pass);
  if (failed.length) {
    console.log('失败项：');
    failed.forEach(r => console.log('  ✗ ' + r.name));
  }
  await browser.close();
})();