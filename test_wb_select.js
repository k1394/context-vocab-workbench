// 验证「单词书选择 + 词池范围 + 分布均摊」新功能
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8933;
const BASE = 'http://127.0.0.1:' + PORT;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

const PARAS = [
  '雨从午后一直下到黄昏，玻璃上全是水痕，房间里那盏老式台灯照出昏黄的光线，落在地板上，映出一小片淡淡的灰色。窗台上积着一层薄薄的灰尘，空气里有旧书和木头的味道。他坐在书桌前面，手边摊着一本翻旧的杂志，封面已经泛黄，旁边放着一只空杯子，杯底留着一圈浅褐色的痕迹。',
  '墙角的书架上堆满了各种资料和笔记，有几本已经合不拢，露出卷起的纸页。墙上挂着一张褪色的地图，边角卷起来，像是很多年没有取下来过。窗帘被风吹得轻轻晃动，影子在金黄的墙面上来回移动，像某种缓慢的呼吸。',
  '暖气片发出轻微的响声，屋子里弥漫着一种闷闷的、被关久了的空气。桌上的笔记本写满了密密麻麻的字，最后一页只写了半行就停住了，笔尖留下的痕迹还很清楚。他把杯子端起来喝了一口，水已经凉了。',
  '“你还在写？”她从门口探进半个身子，头发上挂着细小的水珠，肩膀上的外套湿了一片。',
  '“快结束了。”他没有抬头，“再给我十分钟。”',
  '“十分钟之前你也是这么说的。”她走进来，把伞靠在墙边，甩了甩袖子上的水，在椅子上坐下，“外面雨太大了，整条街都淹了。”',
  '他沉默了几秒，把手里的笔放下来，靠回椅背，揉了揉眼睛。“那你打算怎么办？总不能一直这样下去。”',
  '“我不知道。”她盯着窗外的雨，声音很轻，“但你得给我一个理由，哪怕只有一个，哪怕只是你随便编一个。”',
  '屋里没有人再说话。雨声渐渐小了，天色一点点暗下去，路灯亮起来，黄色的光圈在湿漉漉的地面上散开，又被风吹得歪斜。他站起来，走到窗边，把窗户推开一条缝，冷空气立刻涌进来，带着雨后泥土和树叶的气味。',
  '“我想过很多次。”他终于开口，“一开始我以为只是习惯，后来发现不是。你走的那天我在楼下站了很久，回家以后把你说过的每句话都想了一遍。”',
  '她没有回头，肩膀轻轻颤了一下，过了一会儿才说：“那你现在想明白了吗？”',
  '“还没有。”他说，“但我不想再等到下一个下雨天，才发现自己什么都没做。”'
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ profileId: 'p_wbsel', nick: 'WBSEL' }));
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && typeof STATE.words !== 'undefined', { timeout: 90000 });
  await page.waitForFunction(() => STATE.wordbooks && STATE.wordbooks.length > 0, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log('\n[1] 工具栏新增控件是否就位');
  const ui = await page.evaluate(() => {
    navTo('learn');
    return {
      pickerBtn: !!document.getElementById('wbPickerBtn'),
      pickerText: (document.getElementById('wbPickerBtn') || {}).textContent || '',
      panel: !!document.getElementById('wbPanel'),
      strategy: !!document.getElementById('selStrategy'),
      strategyVal: (document.getElementById('selStrategy') || {}).value,
      perPara: !!document.getElementById('perParaMaxInput'),
      perParaVal: (document.getElementById('perParaMaxInput') || {}).value,
      allBtn: document.body.innerHTML.indexOf('全部重算') !== -1 || document.documentElement.innerHTML.indexOf('全部重算') !== -1
    };
  });
  ok('有「单词书」选择按钮', ui.pickerBtn, ui.pickerText);
  ok('按钮显示当前词池', ui.pickerText.indexOf('单词书：') === 0, ui.pickerText);
  ok('有分布策略下拉，默认 balanced', ui.strategy && ui.strategyVal === 'balanced', ui.strategyVal);
  ok('有每段上限输入，默认 4', ui.perPara && ui.perParaVal === '4', ui.perParaVal);
  ok('有「全部重算」按钮', ui.allBtn);

  console.log('\n[2] 面板内容：单词书多选 + 词池范围');
  const panel = await page.evaluate(() => {
    toggleWbPicker();
    const el = document.getElementById('wbPanel');
    const txt = el.textContent || '';
    return {
      hidden: el.classList.contains('hidden'),
      checks: el.querySelectorAll('input[type=checkbox]').length,
      radios: el.querySelectorAll('input[type=radio]').length,
      hasBuiltin: txt.indexOf('六级词书') !== -1,
      hasScope: txt.indexOf('全部词') !== -1 && txt.indexOf('生词本') !== -1,
      hasFoot: txt.indexOf('仅内置') !== -1,
      checked: el.querySelectorAll('input[type=checkbox]:checked').length
    };
  });
  ok('点开后面板可见', !panel.hidden);
  ok('列出单词书复选框（≥1）', panel.checks >= 1, panel.checks);
  ok('含《六级词书》', panel.hasBuiltin);
  ok('默认全部勾选', panel.checked === panel.checks, panel.checked + '/' + panel.checks);
  ok('有 4 个词池范围选项', panel.radios === 4, panel.radios);
  ok('有「仅内置」快捷按钮', panel.hasFoot);

  console.log('\n[3] 导入 12 段长素材，默认「每段均摊」');
  const st1 = await page.evaluate((paras) => {
    const content = paras.join('\n\n');
    const m = addMaterialSafe('分布测试稿', content, [{ id: 'ch_d1', title: '第1章', content: content, order: 0, targetWords: 30, generated: false }], { sourceType: 's_manual' });
    const mid = m[0].id;
    STATE.learnMaterialId = mid;
    STATE.learnChapterId = 'ch_d1';
    const n = regenerateMatches(mid, 'ch_d1');
    const ch = STATE.chapters[mid].find(c => c.id === 'ch_d1');
    return { n, dist: ch.paraDist, pool: ch.poolSize, total: STATE.words.length };
  }, PARAS);
  const sum = st1.dist.reduce((a, b) => a + b, 0);
  const blank = st1.dist.filter(n => n === 0).length;
  const maxN = Math.max.apply(null, st1.dist);
  ok('生成了标注', st1.n > 0, st1.n);
  ok('覆盖全部 12 段，无空白段', st1.dist.length === 12 && blank === 0, '段数 ' + st1.dist.length + ' 空白 ' + blank);
  ok('没有任何一段被塞爆（≤6 条）', maxN <= 6, '最多 ' + maxN + ' 条 · 分布 ' + st1.dist.join('/'));
  ok('首段不再独占（≤6 条，旧版会到 20+）', st1.dist[0] <= 6, st1.dist[0]);
  ok('每条标注都能归到某个段（dist 合计 = 标注数）', sum === st1.n, sum + ' vs ' + st1.n);
  ok('词池等于全部单词（含内置）', st1.pool === st1.total, st1.pool + '/' + st1.total);

  console.log('\n[4] 切到「顺序取（旧）」应当变回集中');
  const st2 = await page.evaluate(() => {
    document.getElementById('selStrategy').value = 'sequential';
    onStrategyChange();
    const ch = STATE.chapters[STATE.learnMaterialId].find(c => c.id === STATE.learnChapterId);
    return { dist: ch.paraDist, n: (STATE.matches[STATE.learnMaterialId][STATE.learnChapterId] || []).length };
  });
  ok('顺序取时首段明显更多', st2.dist[0] > st1.dist[0], st1.dist[0] + ' → ' + st2.dist[0]);
  ok('顺序取时出现空白段', st2.dist.filter(n => n === 0).length > 0, st2.dist.join('/'));

  console.log('\n[5] 切回「每段均摊」应恢复均匀');
  const st3 = await page.evaluate(() => {
    document.getElementById('selStrategy').value = 'balanced';
    onStrategyChange();
    const ch = STATE.chapters[STATE.learnMaterialId].find(c => c.id === STATE.learnChapterId);
    return { dist: ch.paraDist };
  });
  ok('恢复为无空白段', st3.dist.filter(n => n === 0).length === 0, st3.dist.join('/'));

  console.log('\n[6] 每段上限改成 2 应当生效');
  const st4 = await page.evaluate(() => {
    document.getElementById('perParaMaxInput').value = '2';
    onPerParaMaxChange();
    const ch = STATE.chapters[STATE.learnMaterialId].find(c => c.id === STATE.learnChapterId);
    return { dist: ch.paraDist, total: (STATE.matches[STATE.learnMaterialId][STATE.learnChapterId] || []).length, max: Math.max.apply(null, ch.paraDist), saved: (function () {
      try { return JSON.parse(localStorage.getItem('ctx_vocab_learnOpts_p_wbsel')).perParaMax; } catch (e) { return null; }
    })() };
  });
  ok('每段上限是硬约束：每段 ≤ 2', st4.max <= 2, '最多 ' + st4.max + ' · ' + st4.dist.join('/'));
  ok('上限卡住后标注总数变少', st4.total < st3.dist.reduce((a, b) => a + b, 0), st4.total + ' < ' + st3.dist.reduce((a, b) => a + b, 0));
  ok('设置已写入本地存储', st4.saved === 2, st4.saved);

  console.log('\n[7] 词池范围：只取未掌握');
  const st5 = await page.evaluate(() => {
    document.getElementById('perParaMaxInput').value = '4';
    onPerParaMaxChange();
    const all = buildLearnWordPool().length;
    // 先把 200 个词标成「已掌握」，再看「未掌握」池是否相应变小
    STATE.words.slice(0, 200).forEach(function(w) {
      STATE.mastery[w.lemma] = { status: 'known', level: 6, attempts: 6, correct: 6 };
    });
    onPoolScope('unknown');
    const unk = buildLearnWordPool().length;
    // 已被标注的某个词改成「已掌握」后，重算时它不该再出现
    const lemmas = (STATE.matches[STATE.learnMaterialId][STATE.learnChapterId] || []).map(m => m.lemma);
    const target = lemmas[0];
    STATE.mastery[target] = { status: 'known', level: 6, attempts: 6, correct: 6 };
    regenerateMatches(STATE.learnMaterialId, STATE.learnChapterId);
    const after = (STATE.matches[STATE.learnMaterialId][STATE.learnChapterId] || []).map(m => m.lemma);
    onPoolScope('all');
    return { all: all, unk: unk, target: target, stillThere: after.indexOf(target) !== -1 };
  });
  ok('未掌握词池 = 全部 − 已掌握(200)', st5.unk === st5.all - 200, st5.all + ' → ' + st5.unk);
  ok('已标记「已掌握」的词不再被标注', !st5.stillThere, st5.target);

  console.log('\n[8] 选「仅内置」只留内置词');
  const st6 = await page.evaluate(() => {
    const before = buildLearnWordPool().length;
    onWbAll('builtin');
    const pool = buildLearnWordPool();
    const onlyBuiltin = pool.every(w => w.wordbookId === 'wb_builtin_cet6');
    const btn = document.getElementById('wbPickerBtn').textContent;
    onWbAll('all');
    return { before: before, after: pool.length, onlyBuiltin: onlyBuiltin, btn: btn };
  });
  ok('切到「仅内置」后词池只剩内置词', st6.onlyBuiltin, st6.after + ' 词');
  ok('按钮文案跟着变', st6.btn.indexOf('六级词书') !== -1, st6.btn);

  console.log('\n[9] 信息条应当显示分布');
  const info = await page.evaluate(() => {
    refreshLearn();
    return document.getElementById('matchInfo').textContent;
  });
  ok('显示「词池 N 词」', /词池 \d+ 词/.test(info), info.slice(0, 100));
  ok('显示「覆盖 x/y 段」', /覆盖 \d+\/\d+ 段/.test(info));
  ok('显示「段落分布」', info.indexOf('段落分布') !== -1);

  console.log('\n[10] 单词书卡片显示「本章命中」');
  const card = await page.evaluate(() => {
    navTo('materials');
    renderMaterials();
    return document.getElementById('wordbookList').textContent;
  });
  ok('卡片上有「本章命中 N 词」', card.indexOf('本章命中') !== -1, card.slice(0, 120));

  console.log('\n[11] 刷新后设置应当保持');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && typeof STATE.words !== 'undefined', { timeout: 90000 });
  await page.waitForFunction(() => STATE.words.length > 0, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const persist = await page.evaluate(() => ({
    strategy: (document.getElementById('selStrategy') || {}).value,
    perPara: (document.getElementById('perParaMaxInput') || {}).value,
    pool: buildLearnWordPool().length
  }));
  ok('分布策略保留', persist.strategy === 'balanced', persist.strategy);
  ok('每段上限保留', persist.perPara === '4', persist.perPara);
  ok('词池正常重建', persist.pool > 0, persist.pool);

  if (errors.length) { console.log('\n页面报错:'); errors.forEach(e => console.log('   ' + e)); }
  const pass = results.filter(r => r.pass).length;
  console.log('\n===== ' + pass + '/' + results.length + ' 通过 =====');
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
