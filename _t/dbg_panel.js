const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ nick: 'RESCUE', profileId: 'p_me' }));
    localStorage.setItem('ctx_vocab_wordbooks_p_old', JSON.stringify([{ id: 'wb_lost', name: '旧书' }]));
  });
  await p.goto('http://127.0.0.1:8933/index.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.STATE && typeof STATE.words !== 'undefined', { timeout: 90000 });
  await p.waitForTimeout(2000);
  const r = await p.evaluate(async () => {
    openRescuePanel();
    await new Promise(r => setTimeout(r, 2500));
    return {
      pid: STATE.profileId,
      wbs: STATE.wordbooks.length,
      words: STATE.words.length,
      mats: STATE.materials.length,
      txt: document.getElementById('rescueBody').innerText.replace(/\s+/g, ' ')
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
