// 线上 v19 探针：确认新版本已生效、5 条修复的函数都在线上产物里
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load', timeout: 90000 });
  let f = null;
  for (let i = 0; i < 60 && !f; i++) {
    for (const x of p.frames()) {
      try { if (await x.evaluate(() => !!(window.STATE && typeof pickMatchesByStrategy === 'function'))) { f = x; break; } } catch (e) {}
    }
    if (!f) await p.waitForTimeout(800);
  }
  if (!f) { console.log('未找到应用帧'); await b.close(); process.exit(1); }
  const r = await f.evaluate(() => ({
    frameUrl: location.href,
    hasSmartPage: !!(window.__SMART_PAGE__ && window.__SMART_PAGE__.database),
    // 老功能
    openRescuePanel: typeof openRescuePanel,
    scanAllSources: typeof scanAllSources,
    rescueFromPid: typeof rescueFromPid,
    flushPendingDels: typeof flushPendingDels,
    strategyName: typeof strategyName,
    builtinTotal: typeof BUILTIN_WB_TOTAL !== 'undefined' ? BUILTIN_WB_TOTAL : null,
    // 本轮新增
    cloudTypeOf: typeof cloudTypeOf,
    restoreFailedLoads: typeof restoreFailedLoads,
    mergeArrayKey: typeof mergeArrayKey,
    mergeObjOfArrays: typeof mergeObjOfArrays,
    mergeObjOfObjects: typeof mergeObjOfObjects,
    sampleInjectAllowed: typeof sampleInjectAllowed,
    markCloudDataSeen: typeof markCloudDataSeen,
    probeLocalQuota: typeof probeLocalQuota,
    CLOUD_WB_LOADED_DECL: typeof CLOUD_WB_LOADED !== 'undefined',
    profileKeys: typeof PROFILE_KEYS !== 'undefined' ? PROFILE_KEYS.length : null,
    // 行为探针
    typeMapOk: cloudTypeOf(DB_IDS.context_wordbooks),
    quotaSmall: probeLocalQuota('x'.repeat(200)),
    quotaLeftover: localStorage.getItem('ctx_vocab___quota_probe__'),
    rescBtn: !!Array.prototype.slice.call(document.querySelectorAll('button')).find(b => b.textContent.trim() === '数据自检'),
    // 源码痕迹（防止"函数存在但没真的接上"）
    hasMergeCall: typeof loadDataForProfile === 'function' && /restoreFailedLoads/.test(String(loadDataForProfile)),
    hasEnterHook: /markCloudDataSeen/.test(String(enterApp)),
    hasCleanGuard: /CLOUD_WB_LOADED/.test(String(cleanupOrphanWords))
  }));
  r.pageErrors = errs.filter(e => !/ResizeObserver|net::/i.test(e));
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
