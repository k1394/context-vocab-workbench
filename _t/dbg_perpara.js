const { chromium } = require('playwright');
const PORT = process.env.PORT || 8933;
const BASE = 'http://127.0.0.1:' + PORT;
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
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ profileId: 'p_dbg', nick: 'DBG' }));
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && typeof STATE.words !== 'undefined', { timeout: 90000 });
  await page.waitForFunction(() => STATE.wordbooks && STATE.wordbooks.length > 0, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const setup = await page.evaluate((paras) => {
    const content = paras.join('\n\n');
    const m = addMaterialSafe('调试稿', content, [{ id: 'ch_x', title: '第1章', content: content, order: 0, targetWords: 30, generated: false }], { sourceType: 's_manual' });
    STATE.learnMaterialId = m[0].id; STATE.learnChapterId = 'ch_x';
    regenerateMatches(m[0].id, 'ch_x');
    return { id: m[0].id, dist: STATE.chapters[m[0].id][0].paraDist };
  }, PARAS);
  console.log('基线 dist:', setup.dist.join('/'));

  for (const v of ['2', '1', '8', '4']) {
    const r = await page.evaluate((val) => {
      const el = document.getElementById('perParaMaxInput');
      el.value = val;
      const optsBefore = JSON.stringify(getLearnOpts());
      onPerParaMaxChange();
      const optsAfter = JSON.stringify(getLearnOpts());
      // 直接用同一份 opts 手工跑一次，看算法本身对不对
      const ch = STATE.chapters[STATE.learnMaterialId].find(c => c.id === STATE.learnChapterId);
      const manual = generateContextMatches(ch, buildLearnWordPool(), 'all', 30, getLearnOpts());
      return {
        val: val, optsBefore: optsBefore, optsAfter: optsAfter,
        distFromState: ch.paraDist, distManual: manual.paraDist,
        inputVal: el.value
      };
    }, v);
    console.log('\n设上限 ' + v + ' → input=' + r.inputVal);
    console.log('  opts 前: ' + r.optsBefore);
    console.log('  opts 后: ' + r.optsAfter);
    console.log('  重算后 dist:      ' + r.distFromState.join('/'));
    console.log('  手工算 dist:      ' + r.distManual.join('/'));
  }
  await browser.close();
})();
