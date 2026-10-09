// ===== 数据自检与抢救 =====
// 背景：页面是「云端覆盖式加载」，而本地改动不保证到达云端。一旦同步漏掉，
// 就会出现「删掉的书刷新后复活」「自己加的书凭空消失」。
// 这个模块做两件事：① 把「云端/本地里所有可能属于我的账号 ID」扫出来，让你看见数据到底在哪；
// ② 把某个来源下的单词书/单词/资料并入当前账号（合并前先落一份本地备份）。

var RESCUE_TABLES = ['materials', 'wordbooks', 'words', 'chapters', 'matches', 'progress', 'sessions', 'mastery', 'vocab', 'synonyms', 'answers', 'review'];
var RESCUE_BACKUP_PREFIX = 'rescueBackup_';

// 收集「可能属于我」的账号 ID：当前 ID + 本地记录过的 ID + localStorage 里出现过的 ID
function collectCandidatePids() {
  var out = [];
  function push(x) { if (x && typeof x === 'string' && out.indexOf(x) === -1) out.push(x); }
  push(STATE.profileId);
  var cu = LS.get('current_user', null);
  if (cu && cu.profileId) push(cu.profileId);
  (LS.get('users', []) || []).forEach(function (u) { if (u && u.profileId) push(u.profileId); });
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf(LS_PREFIX) !== 0) continue;
      var rest = k.substring(LS_PREFIX.length);
      for (var t = 0; t < RESCUE_TABLES.length; t++) {
        var pre = RESCUE_TABLES[t] + '_';
        if (rest.indexOf(pre) === 0) { push(rest.substring(pre.length)); break; }
      }
    }
  } catch (e) { /* 隐私模式下 localStorage 可能不可读 */ }
  return out;
}

// 本地某个账号 ID 下存了什么
function scanLocalPid(pid) {
  var out = {};
  RESCUE_TABLES.forEach(function (t) {
    var v = LS.get(t + '_' + pid, null);
    out[t] = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0);
  });
  return out;
}

// 云端某个账号 ID 下存了什么
function scanCloudPid(pid) {
  return Promise.all([
    CLOUD.query(DB_IDS.context_materials, { property: { property: 'profile_id', text: { equals: pid } } }),
    CLOUD.query(DB_IDS.context_wordbooks, { property: { property: 'profile_id', text: { equals: pid } } }),
    CLOUD.query(DB_IDS.context_words, { property: { property: 'profile_id', text: { equals: pid } } })
  ]).then(function (r) {
    return { pid: pid, materials: (r[0] || []).length, wordbooks: (r[1] || []).length, words: (r[2] || []).length };
  });
}

// 扫描全部候选来源；返回 { cloud: [...], local: [...] }
function scanAllSources() {
  var pids = collectCandidatePids();
  var jobs = pids.map(function (pid) {
    if (!STATE.cloudReady) return Promise.resolve({ pid: pid, materials: 0, wordbooks: 0, words: 0 });
    return scanCloudPid(pid);
  });
  return Promise.all(jobs).then(function (cloud) {
    var local = pids.map(function (pid) { return { pid: pid, counts: scanLocalPid(pid) }; });
    return { cloud: cloud, local: local, pids: pids };
  });
}

// 当前账号的本地存储占用估算（字节）
function localUsageText() {
  var bytes = 0, n = 0;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf(LS_PREFIX) !== 0) continue;
      var v = localStorage.getItem(k) || '';
      bytes += k.length + v.length; n++;
    }
  } catch (e) { return '（读取失败）'; }
  return (bytes / 1024).toFixed(0) + ' KB / ' + n + ' 项';
}

// ===== 备份 =====
function makeRescueBackup() {
  return {
    at: nowISO(), pid: STATE.profileId,
    materials: STATE.materials, wordbooks: STATE.wordbooks, words: STATE.words,
    chapters: STATE.chapters, matches: STATE.matches,
    localRaw: (function () {
      var o = {};
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(LS_PREFIX) === 0) o[k] = localStorage.getItem(k);
        }
      } catch (e) {}
      return o;
    })()
  };
}

function saveRescueBackup() {
  if (!STATE.profileId) return null;
  var snap = makeRescueBackup();
  var key = RESCUE_BACKUP_PREFIX + STATE.profileId + '_' + Date.now();
  try { LS.set(key, snap); } catch (e) { console.warn('备份写入失败', e); }
  return key;
}

function downloadRescueBackup() {
  var snap = makeRescueBackup();
  try {
    var blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'backup_' + (STATE.profileId || 'anon') + '_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    toast('备份已开始下载', 'ok');
  } catch (e) { toast('备份下载失败：' + e.message, 'err'); }
}

// ===== 并入（抢救）=====
// 把某个来源下的单词书 / 单词 / 资料合并进当前账号，按 id 去重，合并结果重推到当前账号的云端。
function rescueFromPid(srcPid) {
  if (!srcPid) return Promise.resolve(null);
  if (!STATE.profileId) { toast('还没登录，无法并入', 'err'); return Promise.resolve(null); }
  if (srcPid === STATE.profileId) { toast('这是当前账号，无需并入', 'err'); return Promise.resolve(null); }

  var backupKey = saveRescueBackup();
  console.log('[抢救] 已备份到 ' + backupKey);

  function q(dbId) { return CLOUD.query(dbId, { property: { property: 'profile_id', text: { equals: srcPid } } }); }
  var useCloud = STATE.cloudReady;

  return Promise.all([
    useCloud ? q(DB_IDS.context_wordbooks) : Promise.resolve([]),
    useCloud ? q(DB_IDS.context_words) : Promise.resolve([]),
    useCloud ? q(DB_IDS.context_materials) : Promise.resolve([]),
    useCloud ? q(DB_IDS.context_chapters) : Promise.resolve([]),
    useCloud ? q(DB_IDS.context_matches) : Promise.resolve([])
  ]).then(function (r) {
    var add = { wordbooks: 0, words: 0, materials: 0, chapters: 0, matches: 0, synth: 0, skipped: 0 };

    // ① 单词书
    var haveWb = {}; STATE.wordbooks.forEach(function (w) { haveWb[w.id] = true; });
    (r[0] || []).forEach(function (row) {
      var id = row['单词书ID'] || row._id;
      if (!id || haveWb[id]) return;
      var wb = { id: id, name: row['书名'] || '', source: row['源文件'] || '', total: row['词条数'] || 0, importedAt: row['导入时间'] };
      haveWb[id] = true;
      STATE.wordbooks.push(wb);
      add.wordbooks++;
      syncWordbookToCloud(wb);
    });

    // ② 单词：所属单词书不存在时，补一本书占位，避免下一轮「孤儿清理」把它们真删掉
    var haveW = {};
    STATE.words.forEach(function (w) { haveW[(w.lemma || '').toLowerCase() + '|' + (w.wordbookId || '')] = true; });
    (r[1] || []).forEach(function (row) {
      var le = row['词元'] || '';
      var wid = row['单词书ID'] || '';
      if (!le) { add.skipped++; return; }
      if (!wid || !haveWb[wid]) {
        if (!wid) { add.skipped++; return; }
        haveWb[wid] = true;
        var ph = { id: wid, name: '（恢复）原记录缺失的单词书', source: '随单词一起恢复', total: 0, importedAt: nowISO() };
        STATE.wordbooks.push(ph); add.synth++;
        syncWordbookToCloud(ph);
      }
      var key = le.toLowerCase() + '|' + wid;
      if (haveW[key]) return;
      var w = { lemma: le, wordbookId: wid, pos: row['词性'] || '', ipa: row['音标'] || '', meaning: row['中文释义'] || '', example: row['例句'] || '', unit: row['单元标签'] || '' };
      haveW[key] = true;
      STATE.words.push(w);
      add.words++;
      syncWordToCloud(w);
    });

    // ③ 资料 + 章节 + 匹配
    var haveM = {}; STATE.materials.forEach(function (m) { haveM[m.id] = true; });
    (r[2] || []).forEach(function (row) {
      var id = row['资料ID'] || row._id;
      if (!id || haveM[id]) return;
      var mat = {
        id: id, title: row['标题'] || '', sourceType: row['来源类型'] || 's_txt',
        rawContent: row['原始文本'] || '', chapters: row['章节JSON'] ? JSON.parse(row['章节JSON']) : [],
        chapterCount: row['章节数'] || 0, createdAt: row['创建时间'], updatedAt: row['更新时间']
      };
      haveM[id] = true;
      STATE.materials.push(mat);
      if (!STATE.chapters[id]) STATE.chapters[id] = mat.chapters || [];
      add.materials++;
      syncMaterialToCloud(mat);
    });
    (r[3] || []).forEach(function (row) {
      var mid = row['资料ID'], cid = row['章节ID'];
      if (!mid || !cid) return;
      if (!STATE.chapters[mid]) STATE.chapters[mid] = [];
      if (STATE.chapters[mid].some(function (c) { return c.id === cid; })) return;
      var ch = {
        id: cid, title: row['标题'] || '', content: row['正文'] || '', order: row['序号'] || 0,
        targetWords: row['目标词数'] || 30, generated: row['已生成'] || false
      };
      STATE.chapters[mid].push(ch);
      add.chapters++;
      syncChapterToCloud(mid, ch);
    });
    (r[4] || []).forEach(function (row) {
      var mid = row['资料ID'], cid = row['章节ID'];
      if (!mid || !cid) return;
      if (!STATE.matches[mid]) STATE.matches[mid] = {};
      if (!STATE.matches[mid][cid]) STATE.matches[mid][cid] = [];
      var le = row['词元'] || '';
      if (STATE.matches[mid][cid].some(function (m) { return m.lemma === le && m.position === (row['位置'] || 0); })) return;
      var mm = {
        lemma: le, chWord: row['对应中文'] || '', sense: row['使用义项'] || '',
        position: row['位置'] || 0, sentence: row['所在句子'] || '', manual: row['手动修改'] || false
      };
      STATE.matches[mid][cid].push(mm);
      add.matches++;
      syncMatchToCloud(mid, cid, mm);
    });

    saveLocal();
    console.log('[抢救] 结果', add);
    return add;
  });
}

// ===== 自检面板 UI =====
function ensureRescuePanel() {
  if (document.getElementById('rescuePanel')) return;
  var d = document.createElement('div');
  d.id = 'rescuePanel';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:none;align-items:center;justify-content:center;padding:20px';
  d.innerHTML = '<div style="background:var(--card,#fff);color:var(--text,#222);border-radius:12px;max-width:780px;width:100%;max-height:86vh;overflow:auto;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25)">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
    + '<h2 style="margin:0;font-size:17px">数据自检与抢救</h2>'
    + '<button class="btn btn-sm btn-outline" onclick="closeRescuePanel()">关闭</button></div>'
    + '<p style="font-size:13px;color:var(--text2);margin:4px 0 14px">页面每次打开都是「用云端数据覆盖本地」，所以只要某次同步漏掉，就会出现「删掉的书又回来」「加的书不见了」。下面把云端和本地里所有可能属于你的账号数据都列出来，你可以把需要的那份并入当前账号。</p>'
    + '<div id="rescueBody"><p style="font-size:13px;color:var(--text2)">正在扫描…</p></div>'
    + '</div>';
  document.body.appendChild(d);
}

function openRescuePanel() {
  ensureRescuePanel();
  var p = document.getElementById('rescuePanel');
  p.style.display = 'flex';
  renderRescueBody();
}

function closeRescuePanel() {
  var p = document.getElementById('rescuePanel');
  if (p) p.style.display = 'none';
}

function renderRescueBody() {
  var box = document.getElementById('rescueBody');
  if (!box) return;
  box.innerHTML = '<p style="font-size:13px;color:var(--text2)">正在扫描云端与本地…</p>';

  scanAllSources().then(function (res) {
    var me = STATE.profileId || '（未登录）';
    var html = '';

    html += '<div style="background:var(--bg2,#f6f7f9);border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:16px">'
      + '<div>当前账号：<b>' + escapeHTML(me) + '</b>　昵称：' + escapeHTML(STATE.nickname || '（未登录）') + '</div>'
      + '<div style="color:var(--text2);margin-top:4px">本地存储占用：' + localUsageText()
      + '　·　云端：' + (STATE.cloudReady ? '已连接' : '离线模式')
      + '　·　删除待办：' + (typeof pendingDelCount === 'function' ? pendingDelCount() : 0) + ' 项</div></div>';

    // 云端各来源
    html += '<h3 style="font-size:14px;margin:0 0 8px">云端找到的账号数据</h3>';
    var cloud = res.cloud || [];
    var cloudHas = cloud.filter(function (c) { return (c.materials + c.wordbooks + c.words) > 0; });
    if (!cloudHas.length) {
      html += '<p style="font-size:13px;color:var(--text2);margin:0 0 16px">没有扫到其他账号 ID 下的云端数据。</p>';
    } else {
      html += '<div style="border:0.5px solid var(--border,#e3e6ea);border-radius:8px;overflow:hidden;margin-bottom:16px">';
      cloudHas.forEach(function (c) {
        var isMe = c.pid === me;
        html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:0.5px solid var(--border,#e3e6ea)">'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:13px;font-family:monospace;word-break:break-all">' + escapeHTML(c.pid) + (isMe ? ' <span style="color:var(--primary,#2f7d4f)">← 当前账号</span>' : '') + '</div>'
          + '<div style="font-size:12px;color:var(--text2);margin-top:2px">资料 ' + c.materials + ' · 单词书 ' + c.wordbooks + ' · 单词 ' + c.words + '</div></div>'
          + (isMe ? '' : '<button class="btn btn-sm btn-primary" onclick="doRescue(\'' + c.pid + '\')">并入当前账号</button>')
          + '</div>';
      });
      html += '</div>';
    }

    // 本地各来源（当前账号始终展示，本地可能还没落盘，用内存里的真实数量）
    html += '<h3 style="font-size:14px;margin:0 0 8px">本地浏览器里找到的账号数据</h3>';
    var localMap = {};
    (res.local || []).forEach(function (l) { localMap[l.pid] = l.counts; });
    localMap[me] = { materials: STATE.materials.length, wordbooks: STATE.wordbooks.length, words: STATE.words.length };
    var localPids = Object.keys(localMap).filter(function (pid) {
      var c = localMap[pid] || {};
      return (c.materials || 0) + (c.wordbooks || 0) + (c.words || 0) > 0;
    });
    localPids.sort(function (a, b) { return (a === me ? -1 : 0) - (b === me ? -1 : 0); });
    if (!localPids.length) {
      html += '<p style="font-size:13px;color:var(--text2);margin:0 0 16px">本地没有其他账号 ID 的残留数据。</p>';
    } else {
      html += '<div style="border:0.5px solid var(--border,#e3e6ea);border-radius:8px;overflow:hidden;margin-bottom:16px">';
      localPids.forEach(function (pid) {
        var counts = localMap[pid] || {};
        var parts = [];
        ['materials', 'wordbooks', 'words'].forEach(function (k) {
          if (counts[k] > 0) parts.push(({ materials: '资料', wordbooks: '单词书', words: '单词' })[k] + ' ' + counts[k]);
        });
        var isMe = pid === me;
        html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:0.5px solid var(--border,#e3e6ea)">'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:13px;font-family:monospace;word-break:break-all">' + escapeHTML(pid) + (isMe ? ' <span style="color:var(--primary,#2f7d4f)">← 当前账号</span>' : '') + '</div>'
          + '<div style="font-size:12px;color:var(--text2);margin-top:2px">' + escapeHTML(parts.join(' · ')) + '</div></div>'
          + (isMe ? '' : '<button class="btn btn-sm btn-outline" onclick="doRescueLocal(\'' + pid + '\')">并入当前账号</button>')
          + '</div>';
      });
      html += '</div>';
    }

    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;border-top:0.5px solid var(--border,#e3e6ea);padding-top:14px">'
      + '<button class="btn btn-sm btn-outline" onclick="renderRescueBody()">重新扫描</button>'
      + '<button class="btn btn-sm btn-outline" onclick="downloadRescueBackup()">下载当前数据备份</button>'
      + '</div>';
    html += '<p style="font-size:12px;color:var(--text3,#8a8f98);margin:12px 0 0">并入只会「补上缺的」，不会覆盖或删除现有数据；同一本书、同一个词不会重复。并入前会自动存一份本地备份。</p>';

    box.innerHTML = html;
  }).catch(function (e) {
    box.innerHTML = '<p style="font-size:13px;color:var(--err,#c0392b)">扫描失败：' + escapeHTML(String(e && e.message || e)) + '</p>';
  });
}

function doRescue(pid) {
  if (!confirm('把 ' + pid + ' 云端下的数据并入当前账号？只会补上缺的，不会覆盖现有数据。')) return;
  var box = document.getElementById('rescueBody');
  if (box) box.innerHTML = '<p style="font-size:13px">正在并入…（数据多时需要一会儿）</p>';
  rescueFromPid(pid).then(function (add) {
    if (!add) return;
    toast('并入完成：单词书 ' + add.wordbooks + ' 本 · 单词 ' + add.words + ' 个 · 资料 ' + add.materials + ' 篇'
      + (add.synth ? ' · 补建缺失单词书 ' + add.synth + ' 本' : '') + (add.skipped ? ' · 跳过无效词 ' + add.skipped + ' 个' : ''), 'ok', 9000);
    renderMaterials();
    renderRescueBody();
  }).catch(function (e) {
    toast('并入失败：' + (e && e.message || e), 'err');
    renderRescueBody();
  });
}

// 从本地遗留键并入：把这些键当成某个账号的数据读出来再合并
function doRescueLocal(pid) {
  if (!pid || pid === STATE.profileId) { toast('这是当前账号，无需并入', 'err'); return; }
  if (!confirm('把本地浏览器里 ' + pid + ' 的残留数据并入当前账号？')) return;
  var box = document.getElementById('rescueBody');
  if (box) box.innerHTML = '<p style="font-size:13px">正在并入…</p>';

  saveRescueBackup();
  var add = { wordbooks: 0, words: 0, materials: 0, chapters: 0, matches: 0, synth: 0, skipped: 0 };

  // 单词书
  var haveWb = {}; STATE.wordbooks.forEach(function (w) { haveWb[w.id] = true; });
  (LS.get('wordbooks_' + pid, []) || []).forEach(function (wb) {
    if (!wb || !wb.id || haveWb[wb.id]) return;
    haveWb[wb.id] = true;
    var copy = { id: wb.id, name: wb.name || '', source: wb.source || '', total: wb.total || 0, importedAt: wb.importedAt || nowISO() };
    if (copy.id === BUILTIN_WB_ID) return;
    STATE.wordbooks.push(copy); add.wordbooks++;
    syncWordbookToCloud(copy);
  });
  // 单词
  var haveW = {};
  STATE.words.forEach(function (w) { haveW[(w.lemma || '').toLowerCase() + '|' + (w.wordbookId || '')] = true; });
  (LS.get('words_' + pid, []) || []).forEach(function (w) {
    if (!w || !w.lemma || w.wordbookId === BUILTIN_WB_ID) return;
    var key = w.lemma.toLowerCase() + '|' + (w.wordbookId || '');
    if (haveW[key]) return;
    if (w.wordbookId && !haveWb[w.wordbookId]) {
      haveWb[w.wordbookId] = true;
      var ph = { id: w.wordbookId, name: '（恢复）原记录缺失的单词书', source: '随单词一起恢复', total: 0, importedAt: nowISO() };
      STATE.wordbooks.push(ph); add.synth++;
      syncWordbookToCloud(ph);
    }
    haveW[key] = true;
    var copy = { lemma: w.lemma, wordbookId: w.wordbookId || '', pos: w.pos || '', ipa: w.ipa || '', meaning: w.meaning || '', example: w.example || '', unit: w.unit || '' };
    STATE.words.push(copy); add.words++;
    syncWordToCloud(copy);
  });
  // 资料 + 章节
  var haveM = {}; STATE.materials.forEach(function (m) { haveM[m.id] = true; });
  (LS.get('materials_' + pid, []) || []).forEach(function (m) {
    if (!m || !m.id || haveM[m.id]) return;
    haveM[m.id] = true;
    STATE.materials.push(m); add.materials++;
    syncMaterialToCloud(m);
  });
  var chapters = LS.get('chapters_' + pid, {}) || {};
  Object.keys(chapters).forEach(function (mid) {
    if (!STATE.chapters[mid]) STATE.chapters[mid] = [];
    (chapters[mid] || []).forEach(function (ch) {
      if (!ch || !ch.id) return;
      if (STATE.chapters[mid].some(function (c) { return c.id === ch.id; })) return;
      STATE.chapters[mid].push(ch); add.chapters++;
      syncChapterToCloud(mid, ch);
    });
  });

  saveLocal();
  toast('并入完成：单词书 ' + add.wordbooks + ' 本 · 单词 ' + add.words + ' 个 · 资料 ' + add.materials + ' 篇', 'ok', 9000);
  renderMaterials();
  renderRescueBody();
}
