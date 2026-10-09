const { chromium } = require('playwright');
const PORT = process.env.PORT || 8933;
const BASE = 'http://127.0.0.1:' + PORT;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ profileId: 'p_shot', nick: 'SHOT' }));
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && typeof STATE.words !== 'undefined', { timeout: 90000 });
  await page.waitForFunction(() => STATE.wordbooks && STATE.wordbooks.length > 0, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const paras = [
    '雨从午后一直下到黄昏，玻璃上全是水痕，房间里那盏老式台灯照出昏黄的光线，落在地板上，映出一小片淡淡的灰色。窗台上积着一层薄薄的灰尘，空气里有旧书和木头的味道。',
    '墙角的书架上堆满了各种资料和笔记，有几本已经合不拢，露出卷起的纸页。墙上挂着一张褪色的地图，边角卷起来，像是很多年没有取下来过。',
    '“你还在写？”她从门口探进半个身子，头发上挂着细小的水珠，肩膀上的外套湿了一片。',
    '“快结束了。”他没有抬头，“再给我十分钟。”',
    '“十分钟之前你也是这么说的。”她走进来，把伞靠在墙边，甩了甩袖子上的水。',
    '他沉默了几秒，把手里的笔放下来，靠回椅背，揉了揉眼睛。“那你打算怎么办？”',
    '“我不知道。”她盯着窗外的雨，声音很轻，“但你得给我一个理由。”',
    '屋里没有人再说话。雨声渐渐小了，天色一点点暗下去，路灯亮起来。他站起来，走到窗边，把窗户推开一条缝。'
  ];
  await page.evaluate((paras) => {
    const content = paras.join('\n\n');
    const m = addMaterialSafe('截图用素材', content, [{ id: 'ch_s', title: '第1章', content: content, order: 0, targetWords: 30, generated: false }], { sourceType: 's_manual' });
    STATE.learnMaterialId = m[0].id; STATE.learnChapterId = 'ch_s';
    navTo('learn');
    selectMaterial(m[0].id);
    if (typeof selectChapter === 'function') selectChapter('ch_s');
    regenerateMatches(m[0].id, 'ch_s');
    refreshLearn();
  }, paras);
  await page.waitForTimeout(900);

  await page.screenshot({ path: 'G:/英语学习工作台/_shot_learn.png', fullPage: false });
  await page.evaluate(() => { toggleWbPicker(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'G:/英语学习工作台/_shot_panel.png', fullPage: false });
  await page.evaluate(() => {
    document.getElementById('wbPanel').classList.add('hidden');
    document.getElementById('selStrategy').value = 'sequential';
    onStrategyChange();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'G:/英语学习工作台/_shot_old.png', fullPage: false });
  console.log('截图完成');
  await browser.close();
})();
