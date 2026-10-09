// 「划线记笔记」纯逻辑回归测试（不依赖真实 DOM）
// 覆盖：句子切分 / 划选范围构造 / 跨段合并成一条笔记 / 去重 / 云端行往返 / 补推队列 / 源码结构
const fs = require('fs');
const html = fs.readFileSync('G:/英语学习工作台/index.html', 'utf-8');
const lines = html.split(/\r?\n/);

function sliceBetween(startRe, endRe) {
  let s = -1, e = -1;
  for (let i = 0; i < lines.length; i++) {
    if (s === -1 && startRe.test(lines[i])) s = i;
    else if (s !== -1 && endRe.test(lines[i])) { e = i; break; }
  }
  if (s === -1 || e === -1) throw new Error('block not found: ' + startRe);
  return lines.slice(s, e).join('\n');
}
function hasLine(re) { return lines.some(x => re.test(x)); }
function countLine(re) { return lines.filter(x => re.test(x)).length; }

const notesCode = sliceBetween(
  /^var NOTES_ADD_PREFIX = 'pendingNoteAdd_v1_';/,
  /^\/\* ===== 内置词书《六级词书》 ===== \*\/$/
);

// ---------- 最小桩 ----------
let LSSTORE = {};
var LS = {
  get: function (k, d) { try { const v = LSSTORE[k]; return v !== undefined ? JSON.parse(v) : (d !== undefined ? d : null); } catch (e) { return d; } },
  set: function (k, v) { LSSTORE[k] = JSON.stringify(v); },
  del: function (k) { delete LSSTORE[k]; }
};
var STATE = {
  cloudReady: false, profileId: 'p_me', notes: {},
  chapters: {}, learnMaterialId: null, learnChapterId: null
};
var DB_IDS = { context_notes: 'db_notes' };
var ADDED = [];
var CLOUD = {
  db: {},
  add: function (id, props) { ADDED.push({ id, props }); return Promise.resolve({ id: 'cl_' + ADDED.length }); }
};
function uid(p) { return (p || 'id') + '_' + (uid._n = (uid._n || 0) + 1); }
function nowISO() { return new Date().toISOString(); }
var TOASTS = [];
function toast(m, t, d) { TOASTS.push(m); }
function escapeHTML(s) { return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function saveLocal() { }
function showConfirm() { }
function softDeleteCloud() { }

var readingAreaEl = null;
var document = {
  readyState: 'loading',
  getElementById: function (id) { return id === 'readingArea' ? readingAreaEl : null; },
  addEventListener: function () { },
  querySelector: function () { return null; }
};
var window = { addEventListener: function () { } };

// ---------- 载入被测代码 ----------
eval(notesCode);

// ---------- 测试框架 ----------
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

// 造一章：段落用 \n\n 分隔
function setupChapter(paras, mid, cid) {
  mid = mid || 'm1'; cid = cid || 'c1';
  STATE.learnMaterialId = mid;
  STATE.learnChapterId = cid;
  STATE.chapters = {};
  STATE.chapters[mid] = [{ id: cid, title: '第 1 章', content: paras.join('\n\n') }];
  STATE.notes = {};
  return { mid, cid };
}

// ---------- 一、句子切分 ----------
group('一、句子切分');
{
  const en = 'The quick brown fox jumps over the lazy dog. It was a sunny day! Was it? Yes.';
  const rs = splitSentenceRanges(en);
  ok('英文段落切成 4 句', rs.length === 4, rs.map(r => r.text));
  ok('首句文本正确', rs[0].text === 'The quick brown fox jumps over the lazy dog. ', rs[0].text);
  ok('句子区间首尾相接（start/end 连续）',
    rs[0].end === rs[1].start && rs[1].end === rs[2].start, rs.map(r => [r.start, r.end]));

  const zh = '他走进屋里。屋里没有人，只有一盏灯亮着。他喊了一声，没有人应。';
  const rz = splitSentenceRanges(zh);
  ok('中文段落切成 3 句', rz.length === 3, rz.map(r => r.text));
  ok('中文句号被当作边界', rz[0].text === '他走进屋里。', rz[0].text);

  const one = '没有标点的一整段话';
  ok('无标点 → 整段算一句', splitSentenceRanges(one).length === 1);

  ok('空字符串 → 空数组', splitSentenceRanges('').length === 0);
  ok('同一段重复问命中缓存（返回同一对象）',
    splitSentenceRanges(zh) === splitSentenceRanges(zh));
}

// ---------- 二、划选范围构造 ----------
group('二、划选范围构造（同段 / 跨段）');
{
  setupChapter([
    'First paragraph. Second sentence here. Third one.',
    'Next paragraph. Another sentence.',
    'Third paragraph only.'
  ]);

  const r1 = buildRanges({ p: 0, si: 1 }, { p: 0, si: 1 });
  ok('同段同句 → 一条 range，si==ei', r1.length === 1 && r1[0].si === 1 && r1[0].ei === 1, r1);

  const r2 = buildRanges({ p: 0, si: 0 }, { p: 0, si: 2 });
  ok('同段跨句 → 一条 range，si..ei', r2.length === 1 && r2[0].si === 0 && r2[0].ei === 2, r2);

  const r3 = buildRanges({ p: 0, si: 2 }, { p: 1, si: 1 });
  ok('★ 相邻两段 → 两条 range', r3.length === 2, r3);
  ok('★ 第一条收到第 1 段末尾', r3[0].p === 0 && r3[0].si === 2 && r3[0].ei === 2, r3[0]);
  ok('★ 第二条从第 2 段开头起', r3[1].p === 1 && r3[1].si === 0 && r3[1].ei === 1, r3[1]);

  const r4 = buildRanges({ p: 1, si: 1 }, { p: 0, si: 0 });
  ok('反向拖（从后往前）会被自动摆正', r4[0].p === 0 && r4[r4.length - 1].p === 1, r4);

  const r5 = buildRanges({ p: 0, si: 0 }, { p: 2, si: 0 });
  ok('跨三段 → 三条 range，中间段整段收进来', r5.length === 3, r5);
  ok('中间段 si=0 起', r5[1].p === 1 && r5[1].si === 0, r5[1]);
}

// ---------- 三、入笔记：句子收录 + 编号 ----------
group('三、入笔记：只收完整句子 + 标序号');
{
  setupChapter([
    'Alpha sentence one. Beta sentence two. Gamma sentence three.',
    'Delta sentence four. Epsilon sentence five.'
  ]);

  const rgs = buildRanges({ p: 0, si: 1 }, { p: 1, si: 1 });
  const texts = collectSentenceTexts(rgs);
  // 段0 的 si1..2 = Beta / Gamma，段1 的 si0..1 = Delta / Epsilon
  ok('★ 跨段收集到 4 句', texts.length === 4, texts);
  ok('★ 句子按顺序排列', /^Beta/.test(texts[0]) && /^Gamma/.test(texts[1]) && /^Delta/.test(texts[2]) && /^Epsilon/.test(texts[3]), texts);

  const note = addNote(rgs, texts);
  ok('★ 两段合成「一条」笔记', !!note && note.ranges.length === 2, note && note.ranges);
  ok('★ 笔记标记为跨段', note.crossPara === true);
  ok('★ 内容带序号 1. 2. 3. 4.', note.text === '1. Beta sentence two.\n2. Gamma sentence three.\n3. Delta sentence four.\n4. Epsilon sentence five.', note.text);
  ok('句子数记录正确', note.sentences.length === 4, note.sentences.length);

  // 只划一个「单词」时，也会扩成它所在的整句 → 笔记里不会出现光秃秃的单词
  const r6 = buildRanges({ p: 0, si: 0 }, { p: 0, si: 0 });
  const t6 = collectSentenceTexts(r6);
  ok('★ 只划一个词也会收成完整句子（不是单词）', t6.length === 1 && t6[0].trim().split(/\s+/).length > 1, t6);

  // 同一位置再划一次 → 不重复入库
  const before = chapterNotes('m1', 'c1').length;
  addNote(rgs, texts);
  ok('★ 重复划同一段不会新增笔记', chapterNotes('m1', 'c1').length === before, chapterNotes('m1', 'c1').length);
  ok('重复划线给出提示', TOASTS.some(t => /已经划过/.test(t)));
}

// ---------- 四、云端行往返 ----------
group('四、云端行往返（写出去 / 读回来一致）');
{
  setupChapter(['One. Two. Three.', 'Four. Five.']);
  const rgs = buildRanges({ p: 0, si: 1 }, { p: 1, si: 0 });
  const texts = collectSentenceTexts(rgs);
  const note = addNote(rgs, texts);

  const props = noteCloudProps('m1', 'c1', note);
  ok('写出去的字段齐全',
    props['资料ID'].text === 'm1' && props['章节ID'].text === 'c1' && props['笔记ID'].text === note.id);
  ok('范围JSON 是合法 JSON', typeof props['范围JSON'].text === 'string' && JSON.parse(props['范围JSON'].text).length === 2);
  ok('句子数写对', props['句子数'].number === 3, props['句子数']);
  ok('跨段标记写对', props['跨段'].checkbox === true);

  const row = {
    _id: 'cl_9', '资料ID': 'm1', '章节ID': 'c1', '笔记ID': note.id,
    '范围JSON': props['范围JSON'].text, '划线内容': props['划线内容'].text,
    '句子数': 3, '跨段': true, '创建时间': '2026-10-02T12:00'
  };
  const back = noteFromRow(row);
  ok('★ 读回来 range 数量一致', back.ranges.length === 2, back.ranges);
  ok('★ 读回来 range 内容一致', JSON.stringify(back.ranges) === JSON.stringify(note.ranges));
  ok('★ 读回来句子序号前缀被剥掉', back.sentences[0] === 'Two.' && back.sentences[2] === 'Four.', back.sentences);
  ok('读回来保留 _cloudId', back._cloudId === 'cl_9');

  const bad = noteFromRow({ _id: 'x', '范围JSON': '这不是 JSON', '划线内容': '' });
  ok('坏 JSON 不会抛异常，退化成空 range', Array.isArray(bad.ranges) && bad.ranges.length === 0);
}

// ---------- 五、补推队列 ----------
group('五、新增推云端失败 → 待办补推');
{
  LSSTORE = {};
  STATE.profileId = 'p_me';
  setupChapter(['One. Two.']);

  queuePendingNoteAdd({ matId: 'm1', chId: 'c1', noteId: 'nt_a' });
  queuePendingNoteAdd({ matId: 'm1', chId: 'c1', noteId: 'nt_a' });
  ok('同一条待办只记一次', pendingNoteList().length === 1, pendingNoteList());

  queuePendingNoteAdd({ matId: 'm1', chId: 'c1', noteId: 'nt_b' });
  ok('不同笔记各记一条', pendingNoteList().length === 2);

  unqueuePendingNoteAdd('nt_a');
  ok('销账后只剩一条', pendingNoteList().length === 1 && pendingNoteList()[0].noteId === 'nt_b');

  for (let i = 0; i < 3; i++) bumpPendingNoteTries('nt_b');
  ok('连续失败到上限后放弃，不再堆积', pendingNoteList().length === 0, pendingNoteList());

  // flush：本地已经被删掉的待办直接销账，绝不凭空重建
  LSSTORE = {};
  ADDED = [];
  STATE.cloudReady = false;                      // addNote 先离线，别让它抢在 flush 前面推一次
  const n1 = addNote(buildRanges({ p: 0, si: 0 }, { p: 0, si: 0 }), ['One.']);
  n1._cloudId = undefined;                       // 假装没推上去
  queuePendingNoteAdd({ matId: 'm1', chId: 'c1', noteId: n1.id });
  queuePendingNoteAdd({ matId: 'm1', chId: 'c1', noteId: 'nt_gone' });   // 本地根本没有这条
  ADDED = [];
  STATE.cloudReady = true;

  flushPendingNoteAdds().then(() => {
    ok('★ 本地已删的待办被销账（不重建）', pendingNoteList().length === 0, pendingNoteList());
    ok('★ 只对还存在的笔记补推一次', ADDED.length === 1, ADDED.length);
    ok('★ 补推的就是那条笔记', ADDED[0] && ADDED[0].props['笔记ID'].text === n1.id);
    ok('★ 补推后拿到 _cloudId', !!n1._cloudId, n1._cloudId);

    // ---------- 六、删除 ----------
    group('六、删除笔记');
    const rgsDel = buildRanges({ p: 0, si: 1 }, { p: 0, si: 1 });
    const nd = addNote(rgsDel, collectSentenceTexts(rgsDel));
    const cntBefore = chapterNotes('m1', 'c1').length;
    ok('删除返回 true', deleteNote(nd.id) === true);
    ok('列表里少了一条', chapterNotes('m1', 'c1').length === cntBefore - 1);
    ok('删除不存在的 id 返回 false', deleteNote('no_such') === false);

    // ---------- 七、源码结构 ----------
    group('七、源码结构断言');
    ok('DB_IDS 里有 context_notes', hasLine(/context_notes": "/), true);
    ok('云加载里查了 context_notes', hasLine(/DB_IDS\.context_notes, \{ property/));
    ok('云加载走了墓碑过滤', hasLine(/filterCloudRows\(DB_IDS\.context_notes/));
    ok('restoreFailedLoads 认识 notes', hasLine(/notes: 'notes'/));
    ok('cloudTypeOf 认识 context_notes', hasLine(/context_notes: 'notes'/));
    // v31 起 saveLocal 改成「只写内容变了的 key」：笔记走 saveLocalKey 落到同一个 key 上
    ok('saveLocal 写了 notes_v1_',
      hasLine(/saveLocalKey\('notes_v1_' \+ pid/) || hasLine(/LS\.set\('notes_v1_' \+ pid/));
    ok('本地兜底加载了 notes_v1_', hasLine(/STATE\.notes = LS\.get\('notes_v1_'/));
    ok('渲染出 <p data-pi>', hasLine(/html \+= '<p data-pi="/));
    ok('渲染出句子 span', hasLine(/segments\.push\('<span class="sent" data-si="/));
    ok('渲染完立刻标回划线', hasLine(/if \(typeof renderNoteHighlights === 'function'\) renderNoteHighlights\(\);/));
    ok('进应用补推笔记', hasLine(/flushPendingNoteAdds\(\)/));
    ok('工具栏有划线开关按钮', hasLine(/id="btnNoteMode"/));
    ok('工具栏有笔记抽屉按钮', hasLine(/id="btnNoteDrawer"/));
    ok('抽屉 DOM 存在', hasLine(/<aside class="note-drawer" id="noteDrawer">/));
    ok('CSS 定义了划线高亮', hasLine(/\.sent\.note-hl\{/));
    ok('CSS 定义了划线模式（触屏才划得动）', hasLine(/\.reading-area\.marking-mode\{.*touch-action:none/));
    ok('模块里没有遗留的长按定时器', !hasLine(/_ND_LONGPRESS_TIMER/));
    ok('★ 字符级高亮用 <mark>，且用 DOM Range 包裹（不动 .word-ins 等交互元素）',
      hasLine(/createElement\('mark'\)/) && hasLine(/surroundContents/));
    ok('★ 不再「句内有交互元素就退回整句」（那是划7字变整句的根因）',
      !hasLine(/querySelector\('a, button, input, \.word-ins/));
    ok('★ 清除高亮时无条件拆 mark（之前跳过会导致永久残留）',
      hasLine(/function clearNoteHighlights/) && !hasLine(/parent\.querySelector\('a, button, input'\)\) continue/));

    const fail = results.filter(r => !r.pass);
    console.log('\n' + (results.length - fail.length) + '/' + results.length + ' 通过');
    if (fail.length) { console.log('失败项：'); fail.forEach(f => console.log('  ✗ ' + f.name)); process.exit(1); }
  });
}
