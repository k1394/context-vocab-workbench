// 验证《六级词书》内置进工作台：进页面即自动出现一本 7146 词的内置词书
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8899;
const BASE = 'http://127.0.0.1:' + PORT;
const WS = process.env.WS || 'G:/英语学习工作台';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ profileId: 'p_builtin', nick: 'BUILTIN' }));
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && typeof STATE.words !== 'undefined', { timeout: 90000 });
  // 等进入主界面 + 云端 SDK 就绪（离线环境要等 waitReady 超时）后自动安装
  await page.waitForFunction(() => STATE.wordbooks && STATE.wordbooks.length > 0, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log('\n[1] 内置词书是否自动安装');
  const info = await page.evaluate(() => {
    const wb = STATE.wordbooks.filter(w => w.builtin || w.id === 'wb_builtin_cet6');
    const words = STATE.words.filter(w => w.wordbookId === 'wb_builtin_cet6');
    const dec = typeof decodeBuiltinWords === 'function' ? decodeBuiltinWords() : [];
    const sample = {};
    ['abandon', 'ability', 'ambition', 'wireless', 'zipper'].forEach(k => {
      const w = words.find(x => x.lemma.toLowerCase() === k);
      sample[k] = w ? w.meaning : '(缺)';
    });
    return {
      wbCount: wb.length, name: wb[0] && wb[0].name, total: wb[0] && wb[0].total,
      source: wb[0] && wb[0].source, words: words.length, decoded: dec.length, sample
    };
  });
  ok('自动出现一本内置词书', info.wbCount === 1, info.wbCount);
  ok('名字是「六级词书」', info.name === '六级词书', info.name);
  ok('词条数 7146', info.decoded === 7146, info.decoded);
  ok('STATE.words 里挂上了 7146 词', info.words === 7146, info.words);
  ok('抽查词条有中文释义',
    ['abandon', 'ability', 'ambition', 'wireless', 'zipper'].every(k => info.sample[k] !== '(缺)'), info.sample);

  console.log('\n[2] 不应把 7146 词写进 localStorage（否则撑爆配额）');
  const ls = await page.evaluate(() => {
    const raw = localStorage.getItem('ctx_vocab_words_p_builtin') || '[]';
    const books = localStorage.getItem('ctx_vocab_wordbooks_p_builtin') || '[]';
    let n = 0, b = 0;
    try { n = JSON.parse(raw).length; } catch (e) {}
    try { b = JSON.parse(books).length; } catch (e) {}
    return { size: raw.length, words: n, books: b };
  });
  ok('本地存储里没有内置词', ls.words === 0, ls.words + ' 条 / ' + ls.size + ' 字节');
  ok('本地存储里没有内置词书', ls.books === 0, ls.books);

  console.log('\n[3] 重复安装应当是幂等的');
  const again = await page.evaluate(() => {
    const before = STATE.words.length;
    const added = installBuiltinWordbook();
    return { added: added, before: before, after: STATE.words.length };
  });
  ok('再装一次不重复加词', again.added === 0 && again.before === again.after, again);

  console.log('\n[4] 界面上的单词书列表');
  const ui = await page.evaluate(() => {
    navTo('materials');
    renderMaterials();
    const el = document.getElementById('wordbookList');
    return { html: (el && el.innerHTML) || '', text: (el && el.textContent) || '' };
  });
  ok('列表里出现《六级词书》', ui.text.indexOf('六级词书') !== -1, ui.text.slice(0, 80));
  ok('显示「内置」标记', ui.html.indexOf('内置') !== -1);
  ok('内置书没有删除按钮，只有重装', ui.text.indexOf('重装') !== -1 && ui.text.indexOf('删除') === -1);

  console.log('\n[5] 内置词能参与语境标注');
  const match = await page.evaluate(() => {
    const content = '他决定放弃这个计划，重新开始。\n\n专注的能力在这个喧嚣的世界里十分罕见。\n\n我们必须立刻行动，否则情况会继续恶化。';
    const m = addMaterialSafe('内置词测试稿', content, [{ id: 'ch_t1', title: '第1章', content: content, order: 0 }], { sourceType: 's_manual' });
    const n = regenerateMatchesForMaterial(m[0].id);
    const mm = (STATE.matches[m[0].id] || {})['ch_t1'] || [];
    return { chapters: m.length, matches: n, lemmas: mm.map(x => x.lemma) };
  });
  ok('内置词被标注出来', match.matches > 0, match.lemmas);

  if (errors.length) { console.log('\n页面报错:'); errors.forEach(e => console.log('   ' + e)); }
  const pass = results.filter(r => r.pass).length;
  console.log('\n===== ' + pass + '/' + results.length + ' 通过 =====');
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
