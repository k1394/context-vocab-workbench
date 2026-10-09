// 线上界面截图：进入学习页 + 展开单词书面板
const { chromium } = require('playwright');
const URL = process.env.URL || 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';

const PARAS = [
  '雨从午后一直下到黄昏，玻璃上全是水痕，房间里那盏老式台灯照出昏黄的光线，落在地板上，映出一小片淡淡的灰色。窗台上积着一层薄薄的灰尘，空气里有旧书和木头的味道。他坐在书桌前面，手边摊着一本翻旧的杂志，封面已经泛黄。',
  '墙角的书架上堆满了各种资料和笔记，有几本已经合不拢，露出卷起的纸页。墙上挂着一张褪色的地图，边角卷起来，像是很多年没有取下来过。窗帘被风吹得轻轻晃动。',
  '暖气片发出轻微的响声，屋子里弥漫着一种闷闷的、被关久了的空气。桌上的笔记本写满了密密麻麻的字，最后一页只写了半行就停住了。',
  '“你还在写？”她从门口探进半个身子，头发上挂着细小的水珠，肩膀上的外套湿了一片。',
  '“快结束了。”他没有抬头，“再给我十分钟。”',
  '“十分钟之前你也是这么说的。”她走进来，把伞靠在墙边，甩了甩袖子上的水。',
  '他沉默了几秒，把手里的笔放下来，靠回椅背，揉了揉眼睛。“那你打算怎么办？”',
  '“我不知道。”她盯着窗外的雨，声音很轻，“但你得给我一个理由。”',
  '屋里没有人再说话。雨声渐渐小了，天色一点点暗下去，路灯亮起来。他站起来，走到窗边，把窗户推开一条缝。',
  '“我想过很多次。”他终于开口，“一开始我以为只是习惯，后来发现不是。你走的那天我在楼下站了很久。”',
  '她没有回头，肩膀轻轻颤了一下，过了一会儿才说：“那你现在想明白了吗？”',
  '“还没有。”他说，“但我不想再等到下一个下雨天，才发现自己什么都没做。”'
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 980 } });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  let frame = null;
  for (let i = 0; i < 75 && !frame; i++) {
    for (const f of page.frames()) {
      try { if (await f.evaluate(() => !!(window.STATE && typeof pickMatchesByStrategy === 'function'))) { frame = f; break; } } catch (e) {}
    }
    if (!frame) await page.waitForTimeout(800);
  }
  if (!frame) { console.log('❌ 未找到应用帧'); await browser.close(); process.exit(1); }

  await frame.evaluate((paras) => {
    STATE.profileId = 'live_shot_tmp'; STATE.nickname = 'SHOT'; STATE.cloudReady = false;
    STATE.materials = []; STATE.chapters = {}; STATE.matches = {}; STATE.wordbooks = []; STATE.words = [];
    installBuiltinWordbook();
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('userChip').textContent = '👤 示例账号';
    updateSyncBadge();
    var content = paras.join('\n\n');
    var m = addMaterialSafe('雨夜（示例）', content, [{ id: 'ch_v', title: '第1章', content: content, order: 0, targetWords: 30, generated: false }], { sourceType: 's_manual' });
    STATE.learnMaterialId = m[0].id; STATE.learnChapterId = 'ch_v';
    navTo('learn');
    regenerateMatches(m[0].id, 'ch_v');
    refreshLearn();
    var p = document.getElementById('wbPanel');
    if (p.classList.contains('hidden')) toggleWbPicker();
    renderWbPicker();
  }, PARAS);
  await page.waitForTimeout(1200);

  await frame.evaluate(() => { window.scrollTo(0, 0); });
  const el = await frame.frameElement();
  await el.screenshot({ path: 'G:/英语学习工作台/_shot_live_panel.png' });
  console.log('✓ 已截图 _shot_live_panel.png');

  await frame.evaluate(() => {
    try { Object.keys(localStorage).filter(k => k.indexOf('live_shot_tmp') !== -1).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  });
  await browser.close();
})();
