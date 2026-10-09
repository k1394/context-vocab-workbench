// 线上真实链接端到端验证 v2 —— 不登录、不进云端，直接离线注入状态后跑真实功能
const { chromium } = require('playwright');
const URL = process.env.URL || 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

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

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

async function findAppFrame(page, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (const f of page.frames()) {
      try {
        const has = await f.evaluate(() => !!(window.STATE && typeof pickMatchesByStrategy === 'function'));
        if (has) return f;
      } catch (e) { /* 跨域帧跳过 */ }
    }
    await page.waitForTimeout(800);
  }
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  const frame = await findAppFrame(page, 60000);
  if (!frame) { console.log('❌ 没找到应用帧'); await browser.close(); process.exit(1); }
  console.log('✓ 找到应用帧（线上 v17）');

  // 【1】离线引导 + 内置词书
  const boot = await frame.evaluate(() => {
    STATE.profileId = 'live_verify_tmp';
    STATE.nickname = 'LV';
    STATE.cloudReady = false;              // 全程不离线转云端，避免写用户数据
    STATE.materials = []; STATE.chapters = {}; STATE.matches = {};
    STATE.wordbooks = []; STATE.words = [];
    installBuiltinWordbook();               // 纯本地解码，无云端
    return { words: STATE.words.length, wbs: STATE.wordbooks.map(w => w.name), total: BUILTIN_WB_TOTAL };
  });
  console.log('  内置词书：' + boot.wbs.join(',') + ' / ' + boot.words + ' 词（声明 ' + boot.total + '）');
  ok('内置词书 7146 词在线上可用', boot.words >= 7000, boot.words);

  // 【2】工具栏控件
  const ui = await frame.evaluate(() => ({
    pickerBtn: !!document.getElementById('wbPickerBtn'),
    pickerText: (document.getElementById('wbPickerBtn') || {}).textContent || '',
    panel: !!document.getElementById('wbPanel'),
    strategy: !!document.getElementById('selStrategy'),
    strategyVal: (document.getElementById('selStrategy') || {}).value,
    perPara: !!document.getElementById('perParaMaxInput'),
    perParaVal: (document.getElementById('perParaMaxInput') || {}).value,
    allBtn: document.documentElement.innerHTML.indexOf('全部重算') !== -1
  }));
  ok('有「单词书」按钮', ui.pickerBtn, ui.pickerText);
  ok('按钮文案以「单词书：」开头', ui.pickerText.indexOf('单词书：') === 0, ui.pickerText);
  ok('有分布策略下拉，默认 balanced', ui.strategy && ui.strategyVal === 'balanced', ui.strategyVal);
  ok('有每段上限输入，默认 4', ui.perPara && ui.perParaVal === '4', ui.perParaVal);
  ok('有「全部重算」入口', ui.allBtn);

  // 【3】导入一篇文章并生成
  const gen = await frame.evaluate((paras) => {
    const content = paras.join('\n\n');
    const m = addMaterialSafe('线上验证稿', content, [{ id: 'ch_v', title: '第1章', content: content, order: 0, targetWords: 30, generated: false }], { sourceType: 's_manual' });
    const mid = m[0].id;
    STATE.learnMaterialId = mid; STATE.learnChapterId = 'ch_v';
    navTo('learn');
    const pool = buildLearnWordPool();
    if (pool.length === 0) return { diag: 'empty pool', words: STATE.words.length };
    const n = regenerateMatches(mid, 'ch_v');
    const ch = STATE.chapters[mid].find(c => c.id === 'ch_v');
    return {
      mid: mid, n: n, pool: pool.length,
      paraDist: (ch.paraDist || []).slice(),
      poolSize: ch.poolSize, capBlocked: ch.capBlocked, uniqueCount: ch.uniqueCount,
      total: (STATE.matches[mid]['ch_v'] || []).length,
      infoText: (document.getElementById('matchInfo') || {}).textContent || ''
    };
  }, PARAS);
  if (gen.diag) { console.log('❌ 生成失败：', JSON.stringify(gen)); await browser.close(); process.exit(1); }
  const blank = a => a.filter(x => x === 0).length;
  console.log('  均摊分布：' + gen.paraDist.join('/') + '  空白段 ' + blank(gen.paraDist) + '  最多 ' + Math.max.apply(null, gen.paraDist) + '  总计 ' + gen.total);
  ok('生成成功且每段都有词（0 空白段）', blank(gen.paraDist) === 0, gen.paraDist);
  ok('单段不超过上限 4', Math.max.apply(null, gen.paraDist) <= 4, Math.max.apply(null, gen.paraDist));
  ok('信息条显示「覆盖 x/y 段」', /覆盖 \d+\/\d+ 段/.test(gen.infoText), gen.infoText.replace(/\s+/g, ' ').slice(0, 140));
  ok('信息条显示「段落分布」', /段落分布/.test(gen.infoText));

  // 【4】切到「顺序取」应退化（前段扎堆）
  const seq = await frame.evaluate(() => {
    document.getElementById('selStrategy').value = 'sequential';
    onStrategyChange();
    const ch = STATE.chapters[STATE.learnMaterialId].find(c => c.id === 'ch_v');
    return { dist: (ch.paraDist || []).slice(), opts: getLearnOpts().strategy };
  });
  console.log('  顺序取分布：' + seq.dist.join('/') + '  空白段 ' + blank(seq.dist) + '  最多 ' + Math.max.apply(null, seq.dist));
  ok('切策略生效（opts=sequential）', seq.opts === 'sequential', seq.opts);
  ok('顺序取确实更集中（最多 > 均摊最多）', Math.max.apply(null, seq.dist) > Math.max.apply(null, gen.paraDist), { seqMax: Math.max.apply(null, seq.dist), balMax: Math.max.apply(null, gen.paraDist) });

  // 【5】切回均摊应还原
  const back = await frame.evaluate(() => {
    document.getElementById('selStrategy').value = 'balanced';
    onStrategyChange();
    const ch = STATE.chapters[STATE.learnMaterialId].find(c => c.id === 'ch_v');
    return { dist: (ch.paraDist || []).slice(), opts: getLearnOpts().strategy };
  });
  ok('切回均摊后分布还原', JSON.stringify(back.dist) === JSON.stringify(gen.paraDist), { back: back.dist, wan: gen.paraDist });

  // 【6】每段上限硬约束
  const caps = await frame.evaluate(() => {
    const out = {};
    [2, 1].forEach(function(cv) {
      document.getElementById('perParaMaxInput').value = String(cv);
      onPerParaMaxChange();
      const ch = STATE.chapters[STATE.learnMaterialId].find(c => c.id === 'ch_v');
      const d = ch.paraDist || [];
      out['cap' + cv] = { dist: d.slice(), max: d.length ? Math.max.apply(null, d) : null, blocked: ch.capBlocked };
    });
    document.getElementById('perParaMaxInput').value = '4';
    onPerParaMaxChange();
    return out;
  });
  console.log('  上限 2 → ' + caps.cap2.dist.join('/') + '  上限 1 → ' + caps.cap1.dist.join('/'));
  ok('上限 2：每段都恰好 ≤2', caps.cap2.max <= 2, caps.cap2.dist);
  ok('上限 1：每段都恰好 ≤1', caps.cap1.max <= 1, caps.cap1.dist);
  ok('触发过「被上限卡住」记录', (caps.cap1.blocked || 0) > 0, caps.cap1.blocked);

  // 【7】单词书面板 + 多本切换
  const panel = await frame.evaluate(() => {
    // 再塞一本假的单词书，验证「多选」和「仅内置」筛选
    STATE.wordbooks.push({ id: 'wb_fake', name: '雅思核心词', source: '手动导入', total: 3, importedAt: nowISO(), builtin: false });
    ['abandon', 'diligent', 'fragment'].forEach(function(l, i) {
      STATE.words.push({ lemma: l, meaning: '测试义项' + i, pos: '', ipa: '', example: '', unit: '', wordbookId: 'wb_fake' });
    });
    var btn = document.getElementById('wbPickerBtn');
    var p = document.getElementById('wbPanel');
    if (p.classList.contains('hidden')) toggleWbPicker();

    function snap() {
      var boxes = Array.from(document.querySelectorAll('#wbPanel input[type=checkbox]'));
      return {
        rows: boxes.length,
        checked: boxes.length,
        scopes: Array.from(document.querySelectorAll('#wbPanel input[type=radio]')).map(r => r.value),
        scopeChecked: (Array.from(document.querySelectorAll('#wbPanel input[type=radio]')).filter(r => r.checked)[0] || {}).value,
        text: p.innerText ? p.innerText.replace(/\s+/g, ' ').slice(0, 240) : ''
      };
    }
    var openState = !p.classList.contains('hidden');
    var s0 = snap();
    var poolAll = buildLearnWordPool().length;

    // 仅内置
    onWbAll('builtin');
    var poolBuiltin = buildLearnWordPool().length;
    var txtBuiltin = btn.textContent;

    // 全部参与
    onWbAll('all');
    var poolAll2 = buildLearnWordPool().length;
    var txtAll = btn.textContent;

    return {
      open: openState, rows: s0.rows, scopes: s0.scopes, scopeChecked: s0.scopeChecked, text: s0.text,
      poolAll: poolAll, poolBuiltin: poolBuiltin, poolAll2: poolAll2,
      txtBuiltin: txtBuiltin, txtAll: txtAll,
      btnText: btn.textContent
    };
  });
  console.log('  面板：' + panel.rows + ' 本单词书，' + panel.scopes.length + ' 个词池范围，当前范围=' + panel.scopeChecked);
  console.log('  仅内置 → ' + panel.poolBuiltin + ' 词（' + panel.txtBuiltin + '）；全部参与 → ' + panel.poolAll2 + ' 词（' + panel.txtAll + '）');
  ok('面板可展开', panel.open);
  ok('面板列出 2 本单词书', panel.rows === 2, panel.rows);
  ok('词池范围 4 档（全部/未掌握/模糊/生词本）', panel.scopes.length === 4, panel.scopes);
  ok('面板文案含「词池范围」', /词池范围/.test(panel.text), panel.text.slice(0, 100));
  ok('「仅内置」把词池收到 7146', panel.poolBuiltin === 7146 && panel.poolAll2 === 7149, { only: panel.poolBuiltin, all: panel.poolAll2 });
  ok('按钮文案随选择变化', panel.txtBuiltin.indexOf('六级词书') !== -1 && panel.txtAll.indexOf('全部') !== -1, { b: panel.txtBuiltin, a: panel.txtAll });

  // 【8】词池范围过滤：切到「生词本」应为空池
  const scope = await frame.evaluate(() => {
    var out = {};
    ['vocab', 'fuzzy', 'unknown', 'all'].forEach(function(v) {
      onPoolScope(v);
      out[v] = buildLearnWordPool().length;
    });
    var info = (document.getElementById('matchInfo') || {}).textContent || '';
    return { sizes: out, info: info.replace(/\s+/g, ' ').slice(0, 160) };
  });
  console.log('  词池范围：生词本=' + scope.sizes.vocab + ' 模糊=' + scope.sizes.fuzzy +
              ' 未掌握=' + scope.sizes.unknown + ' 全部=' + scope.sizes.all);
  ok('切「生词本」词池为空（本地无生词本）', scope.sizes.vocab === 0, scope.sizes);
  ok('切「全部」恢复 7149 词', scope.sizes.all === 7149, scope.sizes.all);
  ok('切回后信息条仍有内容', scope.info.length > 0, scope.info);

  // 【9】刷新后 learnOpts 持久化（必须从应用帧里读，外层域名不同）
  const persist = await frame.evaluate(() => {
    try { return localStorage.getItem('ctx_vocab_learnOpts_live_verify_tmp'); } catch (e) { return 'blocked'; }
  });
  ok('learnOpts 已写入本地存储', !!persist && /strategy/.test(String(persist)), String(persist).slice(0, 160));

  // 清理测试残留
  await frame.evaluate(() => {
    try {
      Object.keys(localStorage).filter(k => k.indexOf('live_verify_tmp') !== -1).forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  });

  if (errors.length) { console.log('\n页面错误：'); errors.slice(0, 5).forEach(e => console.log('  ' + e)); }

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(52));
  console.log('线上验证：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(52));

  await browser.close();
  process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
})();
