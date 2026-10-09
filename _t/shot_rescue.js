// 截「数据自检与抢救」面板
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1180, height: 900 } });
  await p.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ nick: '测试用户B', profileId: 'p_me' }));
    localStorage.setItem('ctx_vocab_users', JSON.stringify([{ nick: '测试用户B', profileId: 'p_me' }]));
    localStorage.setItem('ctx_vocab_wordbooks_p_old', JSON.stringify([
      { id: 'wb_lost', name: '四级核心词', source: 'cet4.csv', total: 1200, importedAt: '2026-04-02T00:00:00Z' }
    ]));
    localStorage.setItem('ctx_vocab_words_p_old', JSON.stringify(
      Array.from({ length: 1200 }, (_, i) => ({ lemma: 'w' + i, wordbookId: 'wb_lost' }))
    ));
    localStorage.setItem('ctx_vocab_materials_p_old', JSON.stringify([
      { id: 'mat_lost', title: '旧ID下的资料', sourceType: 's_txt', rawContent: 'x', chapters: [], chapterCount: 0 }
    ]));
  });
  await p.goto('http://127.0.0.1:8933/index.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.STATE && STATE.wordbooks && STATE.wordbooks.length > 0, { timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(1200);
  await p.evaluate(async () => {
    navTo('materials');
    openRescuePanel();
    await new Promise(r => setTimeout(r, 2200));
    // 面板内滚动到顶部
    const box = document.querySelector('#rescuePanel > div');
    if (box) box.scrollTop = 0;
  });
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'G:/英语学习工作台/_shot_rescue.png' });
  console.log('✓ 已截图 _shot_rescue.png');
  await b.close();
})();
