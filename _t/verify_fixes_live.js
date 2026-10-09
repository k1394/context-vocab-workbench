// 浏览器端集成验证：确认新增函数真的挂在全局、且跨 script 块能互相调用
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8933;
const BASE = 'http://127.0.0.1:' + PORT;

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(() => {
    localStorage.setItem('ctx_vocab_current_user', JSON.stringify({ nick: 'FIXCHK', profileId: 'p_me' }));
    localStorage.setItem('ctx_vocab_users', JSON.stringify([{ nick: 'FIXCHK', profileId: 'p_me' }]));
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.STATE && STATE.wordbooks && STATE.wordbooks.length > 0, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1200);

  console.log('\n[1] 新增函数是否都在全局作用域（跨 <script> 块）');
  const fns = await page.evaluate(() => ({
    cloudTypeOf: typeof cloudTypeOf, restoreFailedLoads: typeof restoreFailedLoads,
    mergeArrayKey: typeof mergeArrayKey, mergeObjOfArrays: typeof mergeObjOfArrays,
    mergeObjOfObjects: typeof mergeObjOfObjects, sampleInjectAllowed: typeof sampleInjectAllowed,
    markCloudDataSeen: typeof markCloudDataSeen, markSampleInjected: typeof markSampleInjected,
    probeLocalQuota: typeof probeLocalQuota, cleanupOrphanWords: typeof cleanupOrphanWords,
    migrateProfileId: typeof migrateProfileId, loadDataForProfile: typeof loadDataForProfile,
    cloudTypeResolves: cloudTypeOf(DB_IDS.context_wordbooks)
  }));
  const wantFns = ['cloudTypeOf', 'restoreFailedLoads', 'mergeArrayKey', 'mergeObjOfArrays',
    'mergeObjOfObjects', 'sampleInjectAllowed', 'markCloudDataSeen', 'markSampleInjected',
    'probeLocalQuota', 'cleanupOrphanWords', 'migrateProfileId', 'loadDataForProfile'];
  const miss = wantFns.filter(k => fns[k] !== 'function');
  ok('12 个新增/改动函数全部就位', miss.length === 0, miss);
  ok('cloudTypeOf 能把数据库 ID 映射成业务类型', fns.cloudTypeResolves === 'wordbooks', fns.cloudTypeResolves);

  console.log('\n[2] migrateProfileId 在真实页面里跨块调用成功（合并而非丢弃）');
  const mig = await page.evaluate(() => {
    localStorage.setItem('ctx_vocab_materials_p_A', JSON.stringify([{ id: 'mA', title: '旧ID独有的书', _cloudId: 'cA' }]));
    localStorage.setItem('ctx_vocab_materials_p_B', JSON.stringify([{ id: 'mB', title: '新ID已有的书' }]));
    localStorage.setItem('ctx_vocab_words_p_A', JSON.stringify([{ lemma: 'alpha', wordbookId: 'wbK' }]));
    localStorage.setItem('ctx_vocab_words_p_B', JSON.stringify([{ lemma: 'beta', wordbookId: 'wbK' }]));
    const moved = migrateProfileId('p_A', 'p_B', true);
    const g = k => JSON.parse(localStorage.getItem('ctx_vocab_' + k) || 'null');
    return { moved: moved, mB: g('materials_p_B'), wB: g('words_p_B'), mA: g('materials_p_A'), wA: g('words_p_A') };
  });
  ok('返回合并条数 > 0', mig.moved > 0, mig.moved);
  ok('旧 ID 独有的书已并入新 ID', (mig.mB || []).some(m => m.id === 'mA') && (mig.mB || []).some(m => m.id === 'mB'), (mig.mB || []).map(m => m.id));
  ok('旧 ID 独有的词已并入', (mig.wB || []).length === 2, mig.wB);
  ok('写成功后旧 key 才被清掉', mig.mA === null && mig.wA === null, { mA: mig.mA, wA: mig.wA });

  console.log('\n[3] cleanupOrphanWords 在真实页面上不再删词');
  const orph = await page.evaluate(() => {
    const wordsBefore = STATE.words.length;
    const wbBefore = STATE.wordbooks.length;
    // 造一个「书丢了但词还在」的场景
    STATE.words.push({ lemma: 'ghostword', wordbookId: 'wb_missing_in_page' });
    cleanupOrphanWords();
    return {
      wordsBefore: wordsBefore, wordsAfter: STATE.words.length,
      wbBefore: wbBefore, wbAfter: STATE.wordbooks.length,
      kept: STATE.words.some(w => w.lemma === 'ghostword'),
      ghostBook: STATE.wordbooks.some(w => w.id === 'wb_missing_in_page')
    };
  });
  ok('孤立的词没有被删掉', orph.kept === true, orph);
  ok('缺失的单词书被补建出来', orph.ghostBook === true, { wbBefore: orph.wbBefore, wbAfter: orph.wbAfter });

  console.log('\n[4] 配额探针在真实浏览器里可用');
  const quota = await page.evaluate(() => ({
    small: probeLocalQuota('x'.repeat(100)),
    huge: probeLocalQuota('x'.repeat(6 * 1024 * 1024)),
    leftover: localStorage.getItem('ctx_vocab___quota_probe__')
  }));
  ok('小数据 → 探针通过', quota.small === true);
  ok('超大（6MB）→ 探针不通过（说明能真实反映配额）', quota.huge === false, quota.huge);
  ok('探针写进去的数据被清掉（不占空间）', quota.leftover === null, quota.leftover);

  console.log('\n[5] 示例注入幂等：真实调用序列');
  const sample = await page.evaluate(() => {
    const keepPid = STATE.profileId;
    STATE.nickname = 'SAMPLE_CHK';
    STATE.materials = []; STATE.wordbooks = [];
    const a = sampleInjectAllowed();
    markSampleInjected();
    const b = sampleInjectAllowed();
    STATE.profileId = 'p_drift_' + Date.now();     // 模拟 ID 漂移
    const c = sampleInjectAllowed();
    STATE.profileId = keepPid;
    return { first: a, afterMark: b, afterDrift: c };
  });
  ok('首次允许注入', sample.first === true, sample);
  ok('标记后不再注入', sample.afterMark === false, sample);
  ok('ID 漂移后依旧不再注入', sample.afterDrift === false, sample);

  console.log('\n[6] 页面无 JS 报错');
  const realErrs = errors.filter(e => !/ResizeObserver|Failed to load resource|net::/i.test(e));
  ok('没有未捕获异常', realErrs.length === 0, realErrs.slice(0, 3));

  await page.screenshot({ path: 'G:/英语学习工作台/_shot_fixcheck.png' });
  await browser.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(56));
  console.log('浏览器端集成验证：' + (results.length - failed.length) + '/' + results.length + ' 项通过');
  if (failed.length) failed.forEach(f => console.log('  ✗ ' + f.name));
  console.log('='.repeat(56));
  process.exit(failed.length ? 1 : 0);
})();
