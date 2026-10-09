
// ============================================================
//  语境背单词工作台 - 完整 JS 逻辑
// ============================================================

// ===== 数据库 ID（来自资料库创建结果）=====
var DB_IDS = {"context_users": "CNc4q0WL5EdbWgWGdpXSLQ", "context_materials": "7Ip4jQluqUEsUwuRHzaEJW", "context_chapters": "muRzfkCBZTMcsz7IfjbQWR", "context_wordbooks": "Q7ZDmqXfwcRxrAcjOolCDl", "context_words": "VPepjQPwbQ66A6S1tTXbxh", "context_matches": "IpUm3ety1av4dGshI0xSUK", "context_progress": "WU4C9FiUvQKjq3iz6xX57j", "context_sessions": "hBfBvhzTwkaQEDy8r7KmDv", "context_answers": "XueU3E4F6f8qXY8LFvatNf", "context_mastery": "VV1iISrjLDwhNeFoWUgLjp", "context_review": "HzzICq2Sq8siAiA7S13OHC", "context_vocab": "jqTEXL5kGhJx7enK8kylpr", "context_synonyms": "g1R8TZKGzgGEaDcTO9Bao0"};

// ===== 全局状态 =====
var STATE = {
  profileId: null,      // 当前用户 profile_id (SHA-256 hash)
  nickname: '',
  view: 'dashboard',
  materials: [],        // 资料列表
  wordbooks: [],       // 单词书列表
  words: [],           // 全部单词（跨书）
  chapters: {},        // materialId -> chapters[]
  matches: {},         // materialId -> chapterId -> matches[]
  progress: {},        // materialId -> {chapterId, mode, scrollPct, paraIdx}
  sessions: [],        // 学习会话
  currentSession: null,
  mastery: {},          // lemma -> {status, attempts, correct, wrong, level, nextReview, errorStreakToday}
  reviewQueue: [],     // 今日复习队列
  vocab: [],            // 生词本
  synonyms: {},         // lemma -> [{answer, accepted}]
  answers: [],          // 答题记录
  // 学习页临时状态
  learnMaterialId: null,
  learnChapterId: null,
  learnMode: 'meaning',
  // 测试页临时状态
  testQueue: [],       // 当前待测队列（第一轮：所有词；第二轮：第一轮答对的词）
  testIdx: 0,
  testRound: 1,
  pendingRound2: [],   // 第一轮答对、待第二轮（中文默写）的词
  wrongCounts: {},     // 第一轮答错次数（防止答错词无限重测）
  // 同步状态
  cloudReady: false,
  autoSync: true,
  syncTimer: null
};

var LS_PREFIX = 'ctx_vocab_';

// ===== 工具函数 =====
function sha256(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function(buf) {
    return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  });
}
function nowISO() { return new Date().toISOString(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtDate(iso) { if (!iso) return '--'; var d = new Date(iso); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtMin(iso) { if (!iso) return '--'; var d = new Date(iso); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function uid(prefix) { return (prefix||'id')+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function toast(msg, type, duration) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type||'');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { t.className = 'toast'; }, duration || 2500);
}
function escapeHTML(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== localStorage 数据层 =====
var LS = {
  get: function(key, def) {
    try { var v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : (def !== undefined ? def : null); }
    catch(e) { return def !== undefined ? def : null; }
  },
  set: function(key, val) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); }
    catch(e) {
      // 存储写满时浏览器会抛 QuotaExceededError；留痕以便调用方回读校验
      console.error('LS set err', e);
      LS.saveFailed = true;
      LS.lastError = (e && e.name) ? e.name : String(e);
    }
  },
  del: function(key) { localStorage.removeItem(LS_PREFIX + key); }
};

// 本地版 HTML 首次打开：恢复打包进文件的账号和数据（不覆盖已存在的数据）
(function restoreEmbeddedData() {
  if (!window.__EMBEDDED_LS__) return;
  try {
    Object.keys(window.__EMBEDDED_LS__).forEach(function(k) {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, window.__EMBEDDED_LS__[k]);
    });
    console.log('本地版数据已恢复');
  } catch (e) { console.warn('embedded restore err', e); }
})();

// ===== 云端写入硬错误记录 =====
// 56153 = 数据库单行超 1MB，服务端直接拒绝且不做重试，属不可恢复错误，必须让用户知道
var CLOUD_ROW_ERR = 0;
var CLOUD_ROW_ERR_SHOWN = false;
function recordCloudErr(e) {
  var s = '';
  try { s = JSON.stringify(e) + ' ' + ((e && e.message) || '') + ' ' + ((e && e.code) || ''); }
  catch (x) { s = String(e); }
  if (/56153|row.?too.?large|too large|exceed/i.test(s)) CLOUD_ROW_ERR++;
}

// ===== 资料库数据表 SDK 层 =====
var CLOUD = {
  db: null,
  init: function() {
    if (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) {
      this.db = window.__SMART_PAGE__.database;
      STATE.cloudReady = true;
      return true;
    }
    // 连上过就不再降级（避免瞬时抖动把状态打回离线）
    if (!this.db) STATE.cloudReady = false;
    return STATE.cloudReady;
  },
  // 等待 SDK 注入完成（平台注入时机可能晚于脚本执行）
  waitReady: function(timeoutMs) {
    var self = this;
    timeoutMs = timeoutMs || 5000;
    return new Promise(function(resolve) {
      if (self.init()) return resolve(true);
      var t0 = Date.now();
      (function poll() {
        if (self.init()) return resolve(true);
        if (Date.now() - t0 >= timeoutMs) return resolve(false);
        setTimeout(poll, 200);
      })();
    });
  },
  query: function(dbId, filter) {
    var self = this;
    if (!self.db) return Promise.resolve([]);
    function loadAll(cursor, acc, guard) {
      acc = acc || []; guard = guard || 0;
      if (guard > 100) return Promise.resolve(acc);
      return self.db.query({ databaseId: dbId, filter: filter, pageSize: 200, startCursor: cursor })
        .then(function(r) {
          acc = acc.concat(r.results || []);
          if (r.hasMore && r.nextCursor && r.nextCursor !== cursor && (r.results||[]).length) {
            return loadAll(r.nextCursor, acc, guard + 1);
          }
          return acc;
        });
    }
    return loadAll().catch(function(e) { console.warn('cloud query err', e); return []; });
  },
  // 原始直连（仅供同步队列内部使用）
  _rawAdd: function(dbId, props) {
    if (!this.db) return Promise.resolve(null);
    return this.db.addRecord({ databaseId: dbId, properties: props }).catch(function(e) { console.warn('cloud add err', e); recordCloudErr(e); return null; });
  },
  _rawUpdate: function(dbId, recordId, props) {
    if (!this.db) return Promise.resolve(null);
    return this.db.updateRecord({ databaseId: dbId, recordId: recordId, properties: props }).catch(function(e) { console.warn('cloud update err', e); recordCloudErr(e); return null; });
  },
  _rawDel: function(dbId, recordId) {
    if (!this.db) return Promise.resolve(null);
    return this.db.deleteRecord({ databaseId: dbId, recordId: recordId }).catch(function(e) { console.warn('cloud del err', e); return null; });
  },
  // 队列外观：保持原有 Promise 接口，所有写入经限流队列执行
  add: function(dbId, props) {
    if (!this.db) return Promise.resolve(null);
    return new Promise(function(res) { enqueueSync({ type: 'add', dbId: dbId, props: props, _resolve: res }); });
  },
  update: function(dbId, recordId, props) {
    if (!this.db) return Promise.resolve(null);
    return new Promise(function(res) { enqueueSync({ type: 'update', dbId: dbId, recordId: recordId, props: props, _resolve: res }); });
  },
  del: function(dbId, recordId) {
    if (!this.db) return Promise.resolve(null);
    return new Promise(function(res) { enqueueSync({ type: 'del', dbId: dbId, recordId: recordId, _resolve: res }); });
  }
};

// ===== 同步队列（限流 + 重试 + 进度展示）=====
// 背景：SDK 只有单条 addRecord，1772 个单词并发直发会大面积静默失败（曾导致云端只剩 ~100 词碎片）
var SYNC_QUEUE = [];
var SYNC_RUNNING = 0;
var SYNC_MAX_PARALLEL = 5;
var SYNC_TOTAL = 0;
var SYNC_DONE = 0;

function enqueueSync(task) {
  if (!STATE.cloudReady || !CLOUD.db) { if (task._resolve) task._resolve(null); return; }
  if (SYNC_QUEUE.length === 0 && SYNC_RUNNING === 0) { SYNC_TOTAL = 0; SYNC_DONE = 0; } // 新一轮同步，重置计数
  SYNC_QUEUE.push(task);
  SYNC_TOTAL++;
  updateSyncBadge();
  pumpSyncQueue();
}
function pumpSyncQueue() {
  if (!STATE.cloudReady || !CLOUD.db) return;
  while (SYNC_RUNNING < SYNC_MAX_PARALLEL && SYNC_QUEUE.length > 0) {
    (function(t) {
      SYNC_QUEUE.shift();
      SYNC_RUNNING++;
      var rawP;
      if (t.type === 'add') rawP = CLOUD._rawAdd(t.dbId, t.props);
      else if (t.type === 'update') rawP = CLOUD._rawUpdate(t.dbId, t.recordId, t.props);
      else rawP = CLOUD._rawDel(t.dbId, t.recordId);
      rawP.then(function(r) {
        SYNC_RUNNING--;
        if (r === null && (t.retry || 0) < 1) {
          // 写入失败自动重试一次；仍失败则保持无 _cloudId，下次登录对账重推
          t.retry = (t.retry || 0) + 1;
          SYNC_QUEUE.push(t);
        } else {
          SYNC_DONE++;
          if (t.type === 'del') {
            // 删除成功就销掉待办；失败则记下来，下次进应用补删，绝不静默丢弃
            if (r === null) { if (typeof queuePendingDel === 'function') queuePendingDel(t.dbId, t.recordId); }
            else { if (typeof unqueuePendingDel === 'function') unqueuePendingDel(t.dbId, t.recordId); }
          }
          // 重试后仍失败：若是「单行超限」这类硬错误，明确告知，不再静默
          if (r === null && t.type !== 'del' && CLOUD_ROW_ERR > 0 && !CLOUD_ROW_ERR_SHOWN) {
            CLOUD_ROW_ERR_SHOWN = true;
            toast('有数据超出云端单条容量上限，未能同步到其他设备（共 ' + CLOUD_ROW_ERR + ' 条）。建议把过大的资料拆成几篇再导入', 'err', 9000);
          }
          if (t._resolve) t._resolve(r);
        }
        updateSyncBadge();
        if (SYNC_QUEUE.length === 0 && SYNC_RUNNING === 0) saveLocal(); // 持久化 _cloudId
        pumpSyncQueue();
      });
    })(SYNC_QUEUE[0]);
  }
}

// ===== 同步状态 UI =====
function updateSyncBadge() {
  var b = document.getElementById('syncBadge');
  var d = document.getElementById('syncStatusDesc');
  if (STATE.cloudReady) {
    var pending = SYNC_QUEUE.length + SYNC_RUNNING;
    if (pending > 0) {
      b.textContent = '库 同步中 ' + SYNC_DONE + '/' + SYNC_TOTAL;
      if (d) d.textContent = '正在同步到资料库：' + SYNC_DONE + ' / ' + SYNC_TOTAL + ' 条，请勿关闭页面';
    } else {
      b.textContent = '库 已同步';
      if (d) d.textContent = '云端同步已开启，数据自动同步到资料库';
    }
    b.className = 'sync-badge sync-on';
  } else {
    b.textContent = '📱 离线模式';
    b.className = 'sync-badge sync-off';
    if (d) d.textContent = '离线模式，数据保存在本地浏览器';
  }
}

// ===== 账号与同步自检 =====
function updateDiag() {
  var pidEl = document.getElementById('diagPid');
  if (pidEl) pidEl.textContent = STATE.profileId || '（未登录）';
  var cloudEl = document.getElementById('diagCloud');
  if (cloudEl && (!cloudEl.textContent || cloudEl.textContent === '检测中…')) {
    cloudEl.textContent = STATE.cloudReady ? '已连接 · 点「检测」查看账号登记状态' : '未连接（离线模式）';
  }
}
function runSyncDiagnostics() {
  var pidEl = document.getElementById('diagPid');
  var cloudEl = document.getElementById('diagCloud');
  if (pidEl) pidEl.textContent = STATE.profileId || '（未登录）';
  if (!cloudEl) return;
  cloudEl.textContent = '检测中…';
  CLOUD.waitReady(5000).then(function(ok) {
    if (!ok) { cloudEl.textContent = '未连接云端（离线模式）· 数据仅存本机浏览器'; return; }
    queryCloudUserByNick(STATE.nickname).then(function(row) {
      if (row) {
        cloudEl.textContent = '已连接 · 云端账号已登记（ID: ' + (row['profile_id'] || '?') + '）';
        return;
      }
      cloudEl.textContent = '已连接 · 云端账号未登记，正在自动补登记…';
      ensureCloudUser();
      setTimeout(function() {
        queryCloudUserByNick(STATE.nickname).then(function(r2) {
          cloudEl.textContent = r2
            ? '已连接 · 云端账号已登记（已自动修复），现在可在其他设备直接登录'
            : '已连接 · 补登记失败，请检查网络后再次点「检测」';
        });
      }, 1500);
    });
  });
}

// ===== 数据加载（从云端或本地）=====
function loadDataForProfile(profileId) {
  // 优先从云端拉取，降级到 localStorage
  var promises = [];
  // 云端覆盖式加载前，先快照本地，稍后把"本地独有"的数据合并回来并补推云端
  var localSnap = null;
  // 云端各类数据的「查询失败」标记。查询失败 ≠ 云端没有数据，绝不能当空数组用。
  var _qFail = {};
  // 云端查询包装：失败时留标记并返回空数组（不 reject，避免整批加载中断），
  // 稍后由 restoreFailedLoads 用本地快照把这一类整类回填。
  function _q(dbId, filter) {
    return CLOUD.query(dbId, filter).then(function(r) { return r; }, function(e) {
      var t = cloudTypeOf(dbId);
      _qFail[t] = true;
      console.warn('云端加载失败：' + t, e);
      return [];
    });
  }
  if (STATE.cloudReady) {
    localSnap = {
      materials: LS.get('materials_' + profileId, []),
      wordbooks: LS.get('wordbooks_' + profileId, []),
      words: LS.get('words_' + profileId, []),
      chapters: LS.get('chapters_' + profileId, {}),
      matches: LS.get('matches_' + profileId, {}),
      progress: LS.get('progress_' + profileId, {}),
      mastery: LS.get('mastery_' + profileId, {}),
      vocab: LS.get('vocab_' + profileId, []),
      reviewQueue: LS.get('review_' + profileId, [])
    };
    promises.push(_q(DB_IDS.context_users, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      // 用户表只有一条，不存主要业务数据
    }));
    // 拉 materials
    promises.push(_q(DB_IDS.context_materials, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.materials = rows.map(function(r) {
        return {
          id: r['资料ID'] || r._id,
          title: r['标题'] || '',
          sourceType: r['来源类型'] || 's_txt',
          rawContent: r['原始文本'] || '',
          chapters: r['章节JSON'] ? JSON.parse(r['章节JSON']) : [],
          chapterCount: r['章节数'] || 0,
          createdAt: r['创建时间'],
          updatedAt: r['更新时间'],
          _cloudId: r._id
        };
      });
    }));
    // 拉 wordbooks
    promises.push(_q(DB_IDS.context_wordbooks, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      CLOUD_WB_LOADED = true;   // 单词书成功返回，才允许做"孤立单词"判定
      STATE.wordbooks = rows.map(function(r) {
        return { id: r['单词书ID']||r._id, name: r['书名']||'', source: r['源文件']||'', total: r['词条数']||0, importedAt: r['导入时间'], _cloudId: r._id };
      });
    }));
    // 拉 words
    promises.push(_q(DB_IDS.context_words, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.words = rows.map(function(r) {
        return { lemma: r['词元']||'', wordbookId: r['单词书ID']||'', pos: r['词性']||'', ipa: r['音标']||'', meaning: r['中文释义']||'', example: r['例句']||'', unit: r['单元标签']||'', _cloudId: r._id };
      });
    }));
    // 拉 matches
    promises.push(_q(DB_IDS.context_matches, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.matches = {};
      rows.forEach(function(r) {
        var mid = r['资料ID']; var cid = r['章节ID'];
        if (!STATE.matches[mid]) STATE.matches[mid] = {};
        if (!STATE.matches[mid][cid]) STATE.matches[mid][cid] = [];
        STATE.matches[mid][cid].push({ lemma: r['词元']||'', chWord: r['对应中文']||'', sense: r['使用义项']||'', position: r['位置']||0, sentence: r['所在句子']||'', manual: r['手动修改']||false, _cloudId: r._id });
      });
    }));
    // 拉 chapters
    promises.push(_q(DB_IDS.context_chapters, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.chapters = {};
      rows.forEach(function(r) {
        var mid = r['资料ID'];
        if (!STATE.chapters[mid]) STATE.chapters[mid] = [];
        STATE.chapters[mid].push({ id: r['章节ID']||'', title: r['章节标题']||'', order: r['顺序']||0, content: r['章节内容']||'', targetWords: r['目标词数']||10, generated: r['已生成语境材料']||false, _cloudId: r._id });
      });
    }));
    // 拉 mastery
    promises.push(_q(DB_IDS.context_mastery, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.mastery = {};
      rows.forEach(function(r) {
        STATE.mastery[r['词元']] = { status: r['状态']||'unknown', attempts: r['尝试次数']||0, correct: r['正确次数']||0, wrong: r['错误次数']||0, rate: r['正确率']||0, lastAnswer: r['最近答案']||'', lastReview: r['最近复习'], level: r['复习等级']||0, nextReview: r['下次复习'], errorStreakToday: r['今日连错']||0, materialId: r['资料ID']||'', _cloudId: r._id };
      });
    }));
    // 拉 vocab
    promises.push(_q(DB_IDS.context_vocab, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.vocab = rows.map(function(r) {
        return { lemma: r['词元']||'', ipa: r['音标']||'', pos: r['词性']||'', meaning: r['中文释义']||'', context: r['语境']||'', materialId: r['资料ID']||'', addedAt: r['加入时间'], manual: r['手动添加']||false, _cloudId: r._id };
      });
    }));
    // 拉 answers
    promises.push(_q(DB_IDS.context_answers, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.answers = rows.map(function(r) {
        return { sessionId: r['会话ID']||'', lemma: r['词元']||'', round: r['轮次']||'', qType: r['题型']||'', correct: r['是否正确']||false, userInput: r['用户输入']||'', stdAnswer: r['标准答案']||'', ts: r['时间戳'], _cloudId: r._id };
      });
    }));
    // 拉 progress
    promises.push(_q(DB_IDS.context_progress, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.progress = {};
      rows.forEach(function(r) {
        var mid = r['资料ID'];
        if (!STATE.progress[mid]) STATE.progress[mid] = {};
        STATE.progress[mid][r['章节ID']] = { mode: r['模式']||'meaning', scrollPct: r['滚动百分比']||0, paraIdx: r['段落序号']||0, updatedAt: r['更新时间'], _cloudId: r._id };
      });
    }));
    // 拉 synonyms
    promises.push(_q(DB_IDS.context_synonyms, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.synonyms = {};
      rows.forEach(function(r) {
        var lemma = r['词元'];
        if (!STATE.synonyms[lemma]) STATE.synonyms[lemma] = [];
        STATE.synonyms[lemma].push({ answer: r['同义答案']||'', accepted: r['接受']||false, count: r['使用次数']||0, _cloudId: r._id });
      });
    }));
    // 拉 sessions
    promises.push(_q(DB_IDS.context_sessions, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.sessions = rows.map(function(r) {
        return { id: r['会话ID']||r._id, materialId: r['资料ID']||'', startedAt: r['开始时间'], endedAt: r['结束时间'], durationMin: r['学习分钟']||0, chapters: r['阅读章节']||'', wordsCount: r['遇到词数']||0, _cloudId: r._id };
      });
    }));
    // 拉 review queue
    promises.push(_q(DB_IDS.context_review, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.reviewQueue = rows.map(function(r) {
        return { lemma: r['词元']||'', level: r['等级']||1, nextReviewDate: r['下次复习日期'], lastResult: r['上次结果']||'', materialId: r['资料ID']||'', addedAt: r['加入时间'], _cloudId: r._id };
      });
    }));
  } else {
    // 离线模式从 localStorage 加载
    STATE.materials = LS.get('materials_' + profileId, []);
    STATE.wordbooks = LS.get('wordbooks_' + profileId, []);
    STATE.words = LS.get('words_' + profileId, []);
    STATE.chapters = LS.get('chapters_' + profileId, {});
    STATE.matches = LS.get('matches_' + profileId, {});
    STATE.progress = LS.get('progress_' + profileId, {});
    STATE.sessions = LS.get('sessions_' + profileId, []);
    STATE.mastery = LS.get('mastery_' + profileId, {});
    STATE.vocab = LS.get('vocab_' + profileId, []);
    STATE.synonyms = LS.get('synonyms_' + profileId, {});
    STATE.answers = LS.get('answers_' + profileId, []);
    STATE.reviewQueue = LS.get('review_' + profileId, []);
  }
  return Promise.all(promises).then(function() {
    if (localSnap) {
      restoreFailedLoads(localSnap, _qFail);   // 云端查询失败的类别 → 本地整类回填
      mergeLocalSnapshot(localSnap);           // 其余类别 → 本地独有的补回并补推云端
    }
    STATE.learnOpts = LS.get('learnOpts_' + profileId, null) || JSON.parse(JSON.stringify(LEARN_OPTS_DEFAULT));
    installBuiltinWordbookOnce();   // 内置词书，须早于孤儿词清理
    cleanupOrphanWords();
  });
}

// 清理"孤儿单词"：所属单词书已不存在的单词记录（历史同步失败残留），本地和云端一并清除
// 处理「孤立单词」：所属单词书不在 STATE 里的单词记录。
// 历史版本把这类词当垃圾，本地 + 云端一起删 —— 于是一次同步抖动（单词书上云失败、单词上云成功）
// 就会被判成孤儿而**永久丢失**，一次瞬时故障被放大成不可逆的数据事故。
// 现在改成：不删任何词，改为给缺失的单词书补一条记录（本地还留着定义就用回它，否则建占位书）。
function cleanupOrphanWords() {
  var wbIds = {}; STATE.wordbooks.forEach(function(w) { wbIds[w.id] = true; });
  var orphans = STATE.words.filter(function(w) { return w.wordbookId && !wbIds[w.wordbookId]; });
  if (orphans.length === 0) return;
  // 保护一：本次云端「单词书」查询没成功 → STATE 里的书必然是残缺的，此时任何孤儿判定都不可信
  if (STATE.cloudReady && !CLOUD_WB_LOADED) {
    console.warn('云端单词书未加载成功，本轮跳过孤立单词判定，避免误删 ' + orphans.length + ' 个单词');
    return;
  }
  var byWb = {};
  orphans.forEach(function(w) { byWb[w.wordbookId] = (byWb[w.wordbookId] || 0) + 1; });
  var localWbs = LS.get('wordbooks_' + STATE.profileId, []) || [];
  var fixed = 0;
  Object.keys(byWb).forEach(function(wid) {
    if (wbIds[wid]) return;
    var known = null;
    for (var i = 0; i < localWbs.length; i++) {
      if (localWbs[i] && localWbs[i].id === wid) { known = localWbs[i]; break; }
    }
    // 保护二：本地还留着这本书的定义 → 说明只是没同步上云，词原样保留、把书补推上去
    var book = known || {
      id: wid, name: '（恢复）原记录缺失的单词书', source: '随单词一起恢复',
      total: byWb[wid], importedAt: nowISO()
    };
    book.total = byWb[wid];
    STATE.wordbooks.push(book);
    wbIds[wid] = true;
    syncWordbookToCloud(book);
    fixed++;
  });
  saveLocal();
  console.log('孤立单词保护：为 ' + fixed + ' 本缺失的单词书补建记录，保留 ' + orphans.length + ' 个单词（不再删除）');
}

// 把"本地有但云端没有"的数据合并回来（离线期间创建、或此前同步失败丢失的数据），并补推到云端
function mergeLocalSnapshot(snap) {
  var k;
  var cloudMatIds = {}; STATE.materials.forEach(function(m) { cloudMatIds[m.id] = true; });
  (snap.materials || []).forEach(function(m) { if (m && m.id && !cloudMatIds[m.id]) { STATE.materials.push(m); syncMaterialToCloud(m); } });
  var cloudWbIds = {}; STATE.wordbooks.forEach(function(w) { cloudWbIds[w.id] = true; });
  (snap.wordbooks || []).forEach(function(w) { if (w && w.id && w.id !== BUILTIN_WB_ID && !cloudWbIds[w.id]) { STATE.wordbooks.push(w); syncWordbookToCloud(w); } });
  var cloudWordKeys = {}; STATE.words.forEach(function(w) { cloudWordKeys[(w.lemma || '').toLowerCase() + '|' + (w.wordbookId || '')] = true; });
  (snap.words || []).forEach(function(w) {
    if (!w || !w.lemma) return;
    k = w.lemma.toLowerCase() + '|' + (w.wordbookId || '');
    if (w.wordbookId === BUILTIN_WB_ID) return;   // 内置词不推云端
    if (!cloudWordKeys[k]) { STATE.words.push(w); syncWordToCloud(w); }
  });
  Object.keys(snap.chapters || {}).forEach(function(mid) {
    if (!STATE.chapters[mid]) STATE.chapters[mid] = [];
    var exist = {}; STATE.chapters[mid].forEach(function(c) { exist[c.id] = true; });
    snap.chapters[mid].forEach(function(c) { if (c && c.id && !exist[c.id]) { STATE.chapters[mid].push(c); syncChapterToCloud(mid, c); } });
  });
  Object.keys(snap.matches || {}).forEach(function(mid) {
    if (!STATE.matches[mid]) STATE.matches[mid] = {};
    Object.keys(snap.matches[mid]).forEach(function(cid) {
      if (!STATE.matches[mid][cid]) STATE.matches[mid][cid] = [];
      var exist = {}; STATE.matches[mid][cid].forEach(function(m) { exist[m.lemma + '|' + m.chWord + '|' + m.position] = true; });
      snap.matches[mid][cid].forEach(function(m) {
        k = m.lemma + '|' + m.chWord + '|' + m.position;
        if (!exist[k]) { STATE.matches[mid][cid].push(m); syncMatchToCloud(mid, cid, m); }
      });
    });
  });
  Object.keys(snap.progress || {}).forEach(function(mid) {
    if (!STATE.progress[mid]) STATE.progress[mid] = {};
    Object.keys(snap.progress[mid]).forEach(function(cid) {
      if (!STATE.progress[mid][cid]) STATE.progress[mid][cid] = snap.progress[mid][cid];
    });
  });
  Object.keys(snap.mastery || {}).forEach(function(lemma) {
    if (!STATE.mastery[lemma]) { STATE.mastery[lemma] = snap.mastery[lemma]; syncMasteryToCloud(lemma); }
  });
  var cloudVocabKeys = {}; STATE.vocab.forEach(function(v) { cloudVocabKeys[(v.lemma || '') + '|' + (v.materialId || '')] = true; });
  (snap.vocab || []).forEach(function(v) {
    k = (v.lemma || '') + '|' + (v.materialId || '');
    if (!cloudVocabKeys[k]) { STATE.vocab.push(v); syncVocabToCloud(v); }
  });
  var cloudReviewLemmas = {}; STATE.reviewQueue.forEach(function(r) { cloudReviewLemmas[r.lemma] = true; });
  (snap.reviewQueue || []).forEach(function(r) {
    if (r && r.lemma && !cloudReviewLemmas[r.lemma]) { STATE.reviewQueue.push(r); syncReviewToCloud(r); }
  });
  // 补全（第 3 条）：以下三类此前没参与对账，云端覆盖式加载时会把本地独有的记录静默抹掉。
  // sessions / answers 补回后要补推云端；synonyms 目前没有单条同步通道（只在本地与导出 JSON 里），
  // 所以只做本地并集，但至少不会因为一次加载就凭空消失。
  var cloudSessIds = {}; (STATE.sessions || []).forEach(function(s) { cloudSessIds[s.id] = true; });
  (snap.sessions || []).forEach(function(s) {
    if (s && s.id && !cloudSessIds[s.id]) { STATE.sessions.push(s); syncSessionToCloud(s); }
  });
  var cloudAnsKeys = {};
  (STATE.answers || []).forEach(function(a) { cloudAnsKeys[(a.sessionId || '') + '|' + (a.lemma || '') + '|' + (a.round || '')] = true; });
  (snap.answers || []).forEach(function(a) {
    k = (a.sessionId || '') + '|' + (a.lemma || '') + '|' + (a.round || '');
    if (a && a.lemma && !cloudAnsKeys[k]) { STATE.answers.push(a); syncAnswerToCloud(a); }
  });
  Object.keys(snap.synonyms || {}).forEach(function(lemma) {
    if (!STATE.synonyms[lemma]) STATE.synonyms[lemma] = [];
    var exist = {}; STATE.synonyms[lemma].forEach(function(s) { exist[s.answer] = true; });
    snap.synonyms[lemma].forEach(function(s) {
      if (s && s.answer && !exist[s.answer]) { STATE.synonyms[lemma].push(s); }
    });
  });
}

// ===== 资料体积预算：资料库单行 1MB 上限 =====
// 一篇资料落库时要同时写「原始文本」和「章节JSON」，而 chapters[].content 又是一份完整正文，
// 所以实际体积约为正文的 2 倍；中文一个字 3 字节、英文 1 字节。
// 超限时云端写入会被服务端直接拒绝（56153）且不会重试 —— 表现为「本地导入成功、换设备就没了」。
// 因此在导入前先算清楚，超了自动按章节/段落边界拆成多篇，保证每一篇都在上限内。
var ROW_LIMIT_BYTES = 1024 * 1024;   // 服务端单行硬上限
var ROW_SAFE_BYTES = 900 * 1024;     // 留出标题、ID、时间戳等字段的余量

function utf8Bytes(str) {
  str = String(str == null ? '' : str);
  if (typeof TextEncoder !== 'undefined') { try { return new TextEncoder().encode(str).length; } catch (e) {} }
  var n = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

// 按 syncMaterialToCloud 的真实字段结构，估算这一行落库后的字节数
function estimateMaterialBytes(text, chapters) {
  return utf8Bytes(JSON.stringify({
    'profile_id': 'p', '资料ID': 'mat', '标题': 't', '来源类型': 's_txt',
    '原始文本': text || '',
    '章节JSON': JSON.stringify(chapters || []),
    '章节数': (chapters || []).length,
    '创建时间': '2026-01-01T00:00:00.000Z', '更新时间': '2026-01-01T00:00:00.000Z'
  }));
}

// 这篇文本单篇最多能放多少字符：先按采样比率推算，再用真实结构校验收敛
function maxCharsPerMaterial(text) {
  var s = String(text || '');
  var sample = s.slice(0, 4000) || 'a';
  var ratio = Math.max(utf8Bytes(sample) / sample.length, 1);   // 平均每字符字节数
  var chars = Math.floor((ROW_SAFE_BYTES - 4096) / (2 * ratio));
  for (var i = 0; i < 8 && chars > 500; i++) {
    var probe = s.slice(0, chars);
    if (estimateMaterialBytes(probe, [{ id: 'c', title: 't', order: 0, content: probe, targetWords: 10, generated: false }]) <= ROW_SAFE_BYTES) break;
    chars = Math.floor(chars * 0.85);
  }
  return Math.max(chars, 500);
}

// 把长文本切成不超过 maxChars 的片段，优先在段落/句子边界切
function hardChunks(str, maxChars) {
  str = String(str || '');
  if (!str) return [];
  if (str.length <= maxChars) return [str];
  var out = [];
  var seps = ['\n\n', '\n', '。', '. ', '！', '？', '；', '; ', ' '];
  var buf = str;
  while (buf.length > maxChars) {
    var cut = -1;
    for (var i = 0; i < seps.length && cut === -1; i++) {
      var idx = buf.lastIndexOf(seps[i], maxChars);
      if (idx > maxChars * 0.6) cut = idx + seps[i].length;
    }
    if (cut <= 0) cut = maxChars;   // 极端情况（超长无标点段落）：硬切
    out.push(buf.slice(0, cut));
    buf = buf.slice(cut);
  }
  if (buf) out.push(buf);
  return out;
}

// 把一篇资料规划成若干可独立入库的单元；未超限时原样返回 1 个单元
function planImportUnits(title, text, chapters) {
  chapters = (chapters && chapters.length) ? chapters : [];
  if (!chapters.length) {
    chapters = [{ id: uid('ch'), title: '全文', order: 0, content: text, targetWords: 10, generated: false }];
  }
  if (estimateMaterialBytes(text, chapters) <= ROW_SAFE_BYTES) {
    return [{ title: title, text: text, chapters: chapters }];
  }
  var maxChars = maxCharsPerMaterial(text);
  // 1) 逐章切成 ≤ maxChars 的片段（保留原标题，续片加序号）
  var pieces = [];
  chapters.forEach(function (ch) {
    var content = String(ch.content || '');
    if (!content) return;
    var parts = hardChunks(content, maxChars);
    parts.forEach(function (p, k) {
      pieces.push({
        id: parts.length > 1 ? uid('ch') : ch.id,
        title: parts.length > 1 ? (ch.title + '（' + (k + 1) + '/' + parts.length + '）') : ch.title,
        content: p,
        targetWords: ch.targetWords || 10,
        generated: false
      });
    });
  });
  // 2) 贪心装箱：每个单元的正文总量不超过 maxChars
  var groups = [], cur = [], curLen = 0;
  pieces.forEach(function (p) {
    if (cur.length && curLen + p.content.length > maxChars) { groups.push(cur); cur = []; curLen = 0; }
    cur.push(p); curLen += p.content.length;
  });
  if (cur.length) groups.push(cur);
  // 2.5) 边界均衡：把靠前单元的尾部片段匀给后面的单元，避免最后一篇只剩一小截。
  //      只在相邻单元间移动边界，阅读顺序不变；且接收方不能超上限。
  function groupChars(g) { return g.reduce(function (n, p) { return n + p.content.length; }, 0); }
  for (var pass = 0; pass < 20; pass++) {
    var moved = false;
    for (var gi = 0; gi < groups.length - 1; gi++) {
      var ga = groups[gi], gb = groups[gi + 1];
      if (ga.length <= 1) continue;
      var ta = ga[ga.length - 1];
      var la = groupChars(ga), lb = groupChars(gb);
      if (la - lb > maxChars * 0.2 && lb + ta.content.length <= maxChars) {
        ga.pop(); gb.unshift(ta); moved = true;
      }
    }
    if (!moved) break;
  }
  // 3) 逐单元精确校验；万一仍超限再硬切一次兜底
  var units = [];
  groups.forEach(function (g) {
    var chs = g.map(function (p, k) {
      return { id: p.id, title: p.title, order: k, content: p.content, targetWords: p.targetWords, generated: false };
    });
    var t = g.map(function (p) { return p.content; }).join('\n\n');
    if (estimateMaterialBytes(t, chs) <= ROW_SAFE_BYTES) {
      units.push({ title: title, text: t, chapters: chs });
      return;
    }
    hardChunks(t, Math.max(500, Math.floor(maxChars * 0.8))).forEach(function (tt, k) {
      units.push({
        title: title, text: tt,
        chapters: [{ id: uid('ch'), title: '第 ' + (k + 1) + ' 部分', order: 0, content: tt, targetWords: 10, generated: false }]
      });
    });
  });
  return units;
}

// 统一入库入口：自动按 1MB/行 上限拆分，写入后回读校验；失败返回空数组（已回滚）
function addMaterialSafe(title, text, chapters, extra) {
  var units = planImportUnits(title, text, chapters);
  var created = [];
  units.forEach(function (u, i) {
    var matId = uid('mat');
    var material = {
      id: matId,
      title: units.length > 1 ? (title + '（' + (i + 1) + '/' + units.length + '）') : title,
      rawContent: u.text,
      chapters: u.chapters,
      chapterCount: u.chapters.length,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) material[k] = extra[k]; } }
    STATE.materials.push(material);
    STATE.chapters[matId] = u.chapters;
    created.push(material);
  });
  LS.saveFailed = false;
  saveLocal();
  // 回读校验：浏览器存储写满时 setItem 会抛错，此前是静默失败（刷新后资料凭空消失）
  if (STATE.profileId && LS.saveFailed) {
    created.forEach(function (m) {
      var i = STATE.materials.indexOf(m);
      if (i >= 0) STATE.materials.splice(i, 1);
      delete STATE.chapters[m.id];
    });
    return [];
  }
  created.forEach(function (m) {
    syncMaterialToCloud(m);
    (STATE.chapters[m.id] || []).forEach(function (ch) { syncChapterToCloud(m.id, ch); });
  });
  return created;
}

// 拆分提示文案（未拆分时返回空串）
function materialSplitTip(created, label) {
  if (!created || created.length <= 1) return '';
  return '内容较大，已自动拆成 ' + created.length + ' 篇' + (label || '资料') + '分别导入 · ';
}

// ===== 本地保存 =====
function saveLocal() {
  if (!STATE.profileId) return;
  var pid = STATE.profileId;
  LS.set('materials_' + pid, STATE.materials);
  // 内置词书不落本地存储：页面自带，每次进页面重装即可，省下几百 KB 配额
  LS.set('wordbooks_' + pid, STATE.wordbooks.filter(function(w) { return !w.builtin; }));
  LS.set('words_' + pid, STATE.words.filter(function(w) { return w.wordbookId !== BUILTIN_WB_ID; }));
  LS.set('chapters_' + pid, STATE.chapters);
  if (STATE.learnOpts) LS.set('learnOpts_' + pid, STATE.learnOpts);
  LS.set('matches_' + pid, STATE.matches);
  LS.set('progress_' + pid, STATE.progress);
  LS.set('sessions_' + pid, STATE.sessions);
  LS.set('mastery_' + pid, STATE.mastery);
  LS.set('vocab_' + pid, STATE.vocab);
  LS.set('synonyms_' + pid, STATE.synonyms);
  LS.set('answers_' + pid, STATE.answers);
  LS.set('review_' + pid, STATE.reviewQueue);
}

// ===== 预置词典（语境匹配用）=====
var CONTEXT_DICT = {
  'ceiling': { triggers: ['天花板','吊顶','顶棚'], meaning: '天花板', pos: 'n.', ipa: '/ˈsiːlɪŋ/' },
  'beautiful': { triggers: ['华美的','美丽的','漂亮','好看','华丽'], meaning: '美丽的；华美的', pos: 'adj.', ipa: '/ˈbjuːtɪfl/' },
  'condition': { triggers: ['条件'], meaning: '条件；状况', pos: 'n.', ipa: '/kənˈdɪʃn/' },
  'reflect': { triggers: ['反射'], meaning: '反射；反映', pos: 'v.', ipa: '/rɪˈflekt/' },
  'remove': { triggers: ['移开','移除','调动','移去'], meaning: '移开；调动', pos: 'v.', ipa: '/rɪˈmuːv/' },
  'body': { triggers: ['身体','躯体'], meaning: '身体', pos: 'n.', ipa: '/ˈbɒdi/' },
  'formation': { triggers: ['形成'], meaning: '形成', pos: 'n.', ipa: '/fɔːˈmeɪʃn/' },
  'instinct': { triggers: ['本能','直觉'], meaning: '本能', pos: 'n.', ipa: '/ˈɪnstɪŋkt/' },
  'room': { triggers: ['房间','地方','空间','屋子'], meaning: '房间；地方', pos: 'n.', ipa: '/ruːm/' },
  'internal': { triggers: ['体内的','内部的','内在'], meaning: '体内的；内部的', pos: 'adj.', ipa: '/ɪnˈtɜːnl/' },
  'react': { triggers: ['反应'], meaning: '反应', pos: 'v.', ipa: '/riˈækt/' },
  'inform': { triggers: ['告诉','通知','告知'], meaning: '告诉；通知', pos: 'v.', ipa: '/ɪnˈfɔːm/' },
  'speak': { triggers: ['说话','讲话','说'], meaning: '说话', pos: 'v.', ipa: '/spiːk/' },
  'nor': { triggers: ['也不','也不'], meaning: '也不', pos: 'conj.', ipa: '/nɔːr/' },
  'forget': { triggers: ['忘记','遗忘','忘了'], meaning: '忘记', pos: 'v.', ipa: '/fəˈɡet/' },
  'around': { triggers: ['四周','周围','四处','到处'], meaning: '四处；周围', pos: 'prep.', ipa: '/əˈraʊnd/' },
  'onto': { triggers: ['上面','之上','到...上'], meaning: '在……之上', pos: 'prep.', ipa: '/ˈɒntə/' },
  'elapse': { triggers: ['流逝','过去','消逝'], meaning: '（时间）流逝', pos: 'v.', ipa: '/iˈlæps/' }
};

// ===== 词元归一化 =====
var LEMMA_RULES = [
  [/ies$/i, 'y'],
  [/ied$/i, 'y'],
  [/ing$/i, ''],
  [/ed$/i, ''],
  [/s$/i, '']
];
function toLemma(word) {
  var w = word.toLowerCase().trim();
  for (var i = 0; i < LEMMA_RULES.length; i++) {
    var re = new RegExp(LEMMA_RULES[i][0]);
    if (re.test(w)) {
      var stem = w.replace(re, LEMMA_RULES[i][1]);
      if (stem.length >= 3) return stem;
    }
  }
  return w;
}

// ===== 文件解析 =====
function parseTXT(text) {
  // 按空行分段，提取标题和章节
  var lines = text.split(/\r?\n/);
  var chapters = [];
  var curChapter = null;
  var curParas = [];
  var title = '默认章节';
  var chIdx = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    // 检测章节标题：以「第X章」「第X单元」「Chapter X」开头的行
    var chMatch = line.match(/^(第[一二三四五六七八九十百千0-9]+[章节回卷篇单元]|Chapter\s+\d+|Unit\s+\d+|#\s+)/i);
    if (chMatch && line.length < 50) {
      if (curChapter) {
        chapters.push({ id: uid('ch'), title: curChapter, order: chIdx, content: curParas.join('\n\n'), targetWords: 10, generated: false });
        chIdx++;
      }
      curChapter = line;
      curParas = [];
    } else if (line === '') {
      // 段落分隔
      if (curParas.length > 0 && curParas[curParas.length-1] !== '') curParas.push('');
    } else {
      if (!curChapter) curChapter = '第1章';
      curParas.push(line);
    }
  }
  if (curChapter) {
    chapters.push({ id: uid('ch'), title: curChapter, order: chIdx, content: curParas.join('\n\n').trim(), targetWords: 10, generated: false });
  }
  if (chapters.length === 0) {
    chapters.push({ id: uid('ch'), title: '全文', order: 0, content: text, targetWords: 10, generated: false });
  }
  return { title: chapters[0].title, chapters: chapters };
}

function parseCSV(text) {
  var lines = text.split(/\r?\n/).filter(function(l) { return l.trim(); });
  if (lines.length < 1) return { headers: [], rows: [] };
  // 简易 CSV 解析（支持逗号 / Tab 分隔，不处理引号内逗号）
  function parseLine(line) {
    var result = [];
    var cur = '';
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { inQuote = !inQuote; }
      else if ((c === ',' || c === '\t') && !inQuote) { result.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    result.push(cur.trim());
    return result;
  }
  var headers = parseLine(lines[0]);
  var rows = [];
  // 无表头检测：首行单元格若不像「字段名」，说明首行其实是数据行（PDF / 纯文本词表常见）
  var headerWords = ['lemma','word','单词','英文','词汇','英语','词条','词','pos','词性','属性','ipa','phonetic','音标','发音','meaning','释义','中文','意思','翻译','汉语','解释','词义','example','例句','示例','句子','unit','单元','标签','分类','chapter','课'];
  var looksLikeHeader = headers.length > 0 && headers.every(function(c) {
    var t = String(c || '').toLowerCase().replace(/^\d+[\.、\s]*/, '').trim();
    if (!t) return true;
    if (/^列\d+$/.test(t)) return true;
    for (var w = 0; w < headerWords.length; w++) { if (t === headerWords[w] || t.indexOf(headerWords[w]) !== -1) return true; }
    return false;
  });
  var startIdx = 1;
  if (!looksLikeHeader) {
    headers = headers.map(function(_, i) { return '列' + (i + 1); });
    startIdx = 0;
  }
  for (var i = startIdx; i < lines.length; i++) {
    var vals = parseLine(lines[i]);
    if (vals.length === 1 && !vals[0]) continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) { obj[headers[j]] = vals[j] || ''; }
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

// ===== 语境匹配算法 =====
// 取词设置（单词书选择 + 分布策略 + 词池范围）
var LEARN_OPTS_DEFAULT = {
  bookIds: [],          // 空数组 = 全部单词书都参与
  strategy: 'balanced', // balanced=每段均摊 | length=按篇幅分配 | sequential=顺序取（旧行为）
  perParaMax: 4,        // 每段标注条数软上限（凑不满时会自动放宽）
  maxRepeatPerWord: 2,  // 同一个词全章最多标注几处
  poolScope: 'all',     // all | unknown | fuzzy | vocab
  strictTrigger: true   // 触发词严格模式（屏蔽泛触发词与过短词头）
};

function getLearnOpts() {
  if (!STATE.learnOpts) STATE.learnOpts = JSON.parse(JSON.stringify(LEARN_OPTS_DEFAULT));
  var o = STATE.learnOpts;
  for (var k in LEARN_OPTS_DEFAULT) {
    if (o[k] === undefined || o[k] === null) o[k] = LEARN_OPTS_DEFAULT[k];
  }
  return o;
}

// 从中文释义中提取可用于语境匹配的中文触发词（剔除词性/音标/英文等噪声）
function extractTriggersFromMeaning(meaning, strict) {
  if (!meaning) return [];
  if (strict === undefined) strict = true;
  var cleaned = String(meaning)
    .replace(/\[[^\]]*\]/g, ' ')                          // [音标]
    .replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ')     // 括号注释
    .replace(/\b(vt|vi|v|n|adj|adv|prep|conj|pron|num|art|int|aux|abbr|ad|pl|sing)\.\s*/gi, ' ') // 词性标记
    .replace(/[a-zA-Z\.\[\]<>《》【】「」『』]/g, ' ');
  var runs = cleaned.match(/[一-龥]{2,6}/g) || [];
  var seen = {}; var out = [];
  for (var i = 0; i < runs.length; i++) {
    var t = runs[i];
    if (seen[t]) continue;
    seen[t] = true;
    if (strict) {
      if (/[的了着]$/.test(t)) continue;                 // 「上的」「新的」这类修饰片段不能当触发词
      if (t.length === 2 && out.length > 0) continue;    // 2 字触发词只认释义里的第一个义项
      if (out.length >= 3) break;                        // 最多 3 个触发词
    }
    out.push(t);
  }
  return strict ? out : out.slice(0, 6); // 非严格模式保持释义中的出现顺序，取前 6 个
}

// 每个段落里的标注条数（只统计非空段）
function computeParaDist(matches, paragraphs) {
  var idx = [], d = [];
  for (var i = 0; i < paragraphs.length; i++) {
    if (!paragraphs[i].trim()) continue;
    idx.push(i); d.push(0);
  }
  var map = {};
  for (var k = 0; k < idx.length; k++) map[idx[k]] = k;
  for (var j = 0; j < matches.length; j++) {
    var pi = Math.floor(matches[j].position / 10000);
    if (map[pi] !== undefined) d[map[pi]]++;
  }
  return d;
}

// 分布化选词：段落轮转，把名额铺到全文，而不是被前几段吃光
function pickMatchesByStrategy(noOverlap, paragraphs, target, strategy, perParaMax, maxRepeat) {
  var P = paragraphs.length;

  // 旧行为：按文档顺序取前 target 个不同单词
  if (strategy === 'sequential' || P <= 1) {
    var keep0 = {}, uniq0 = [];
    for (var i = 0; i < noOverlap.length; i++) {
      var lm0 = noOverlap[i].lemma;
      if (!keep0[lm0] && uniq0.length < target) { keep0[lm0] = true; uniq0.push(lm0); }
    }
    var cnt0 = {}, out0 = [];
    for (var j = 0; j < noOverlap.length; j++) {
      var m0 = noOverlap[j];
      if (!keep0[m0.lemma]) continue;
      cnt0[m0.lemma] = (cnt0[m0.lemma] || 0) + 1;
      if (maxRepeat && maxRepeat > 0 && cnt0[m0.lemma] > maxRepeat) continue;
      out0.push(m0);
    }
    return { matches: out0, capBlocked: 0 };
  }

  var byPara = [], cap = [], len = [];
  for (var p = 0; p < P; p++) { byPara.push([]); len.push(paragraphs[p].length); }
  for (var q = 0; q < noOverlap.length; q++) {
    var pi = Math.floor(noOverlap[q].position / 10000);
    if (pi >= 0 && pi < P) byPara[pi].push(noOverlap[q]);
  }

  if (strategy === 'length') {
    var totalLen = 0;
    for (var t1 = 0; t1 < P; t1++) totalLen += len[t1];
    if (!totalLen) totalLen = 1;
    for (var t2 = 0; t2 < P; t2++) cap.push(Math.max(1, Math.round(target * len[t2] / totalLen)));
  } else {
    for (var t3 = 0; t3 < P; t3++) cap.push(perParaMax);
  }

  var cursor = [], used = [], chosen = [], chosenLemma = {};
  for (var u = 0; u < P; u++) { cursor.push(0); used.push(0); }

  // 一轮 = 按「已标注最少的段优先」各取最多 1 个新词（注水法，天然最均）
  function round() {
    var added = 0;
    var order = [];
    for (var i = 0; i < P; i++) order.push(i);
    order.sort(function(a, b) { return (used[a] - used[b]) || (a - b); });
    for (var oi = 0; oi < order.length; oi++) {
      if (chosen.length >= target) break;
      var pi = order[oi];
      if (used[pi] >= cap[pi]) continue;          // 每段上限是硬约束
      var list = byPara[pi];
      while (cursor[pi] < list.length) {
        var m = list[cursor[pi]++];
        if (chosenLemma[m.lemma]) continue;
        chosenLemma[m.lemma] = true;
        chosen.push(m);
        used[pi]++;
        added++;
        break;
      }
    }
    return added;
  }

  var guard = 0;
  while (chosen.length < target && guard++ < P * 40) { if (round() === 0) break; }

  // 有没有哪一段因为「每段上限」被卡住（还有候选却不能再取）
  var capBlocked = 0;
  for (var cb = 0; cb < P; cb++) {
    if (used[cb] >= cap[cb] && cursor[cb] < byPara[cb].length) capBlocked++;
  }

  // 收尾：同一个词跨段补至多 maxRepeat-1 处，同样不许突破每段上限
  if (maxRepeat > 1) {
    var byLemma = {}, home = {};
    for (var b = 0; b < noOverlap.length; b++) {
      var lb = noOverlap[b].lemma;
      if (!byLemma[lb]) byLemma[lb] = [];
      byLemma[lb].push(noOverlap[b]);
    }
    for (var h = 0; h < chosen.length; h++) {
      home[chosen[h].lemma] = Math.floor(chosen[h].position / 10000);
    }
    var extra = [];
    for (var key in home) {
      var occ = byLemma[key] || [];
      var need = maxRepeat - 1;
      var seenPara = {};
      seenPara[home[key]] = true;
      for (var o = 0; o < occ.length && need > 0; o++) {
        var op = Math.floor(occ[o].position / 10000);
        if (seenPara[op] || used[op] >= cap[op]) continue;
        seenPara[op] = true;
        used[op]++;
        extra.push(occ[o]);
        need--;
      }
    }
    chosen = chosen.concat(extra);
  }

  chosen.sort(function(a, b) { return a.position - b.position; });
  return { matches: chosen, capBlocked: capBlocked };
}

function generateContextMatches(chapter, words, repeatMode, targetWords, opts) {
  // repeatMode: 'all' | 'para_once' | 'chapter_once'
  targetWords = (targetWords && targetWords >= 1) ? targetWords : 30;
  opts = opts || {};
  var strategy = opts.strategy || 'balanced';
  var perParaMax = (opts.perParaMax >= 1) ? opts.perParaMax : 4;
  var maxRepeat = (opts.maxRepeatPerWord >= 1) ? opts.maxRepeatPerWord : 2;
  var strict = (opts.strictTrigger === false) ? false : true;

  var paragraphs = chapter.content.split(/\n\n+/);
  var all = [];
  var noTriggerWords = [];

  for (var wi = 0; wi < words.length; wi++) {
    var w = words[wi];
    var lemma = (w.lemma || '').toLowerCase().trim();
    if (!lemma) continue;
    if (strict && !/^[a-z][a-z'\-]{2,}$/.test(lemma)) continue;  // 太短的词头（no / nor / up）不参与
    var dictEntry = CONTEXT_DICT[lemma];
    var triggers = [];
    if (dictEntry && dictEntry.triggers) {
      for (var d = 0; d < dictEntry.triggers.length; d++) triggers.push(dictEntry.triggers[d]);
    }
    var extra = extractTriggersFromMeaning(w.meaning, strict);
    for (var e = 0; e < extra.length; e++) {
      if (triggers.indexOf(extra[e]) === -1) triggers.push(extra[e]);
    }
    if (triggers.length === 0) { noTriggerWords.push(lemma); continue; }
    var sense = dictEntry ? dictEntry.meaning : (w.meaning || '');

    var usedInChapter = false;
    for (var pi = 0; pi < paragraphs.length; pi++) {
      if (repeatMode === 'chapter_once' && usedInChapter) break;
      var para = paragraphs[pi];
      var usedInPara = false;
      for (var ti = 0; ti < triggers.length; ti++) {
        var trigger = triggers[ti];
        if (!trigger || trigger.length < 2) continue;
        var fromIdx = 0;
        while (true) {
          var idx = para.indexOf(trigger, fromIdx);
          if (idx === -1) break;
          fromIdx = idx + trigger.length;
          if (repeatMode === 'para_once' && usedInPara) break;
          // 提取所在句子（前后找句号/问号/感叹号）
          var sentStart = idx;
          for (var k = idx; k >= 0; k--) {
            if (/[。！？!?\n]/.test(para[k])) { sentStart = k + 1; break; }
          }
          var sentEnd = idx + trigger.length;
          for (var k2 = idx + trigger.length; k2 < para.length; k2++) {
            if (/[。！？!?\n]/.test(para[k2])) { sentEnd = k2 + 1; break; }
          }
          var sentence = para.substring(sentStart, Math.min(sentEnd + 20, para.length));
          all.push({
            lemma: lemma, chWord: trigger, sense: sense,
            position: idx + pi * 10000, sentence: sentence.trim(), manual: false,
            senseRank: ti
          });
          usedInPara = true;
          usedInChapter = true;
          if (repeatMode === 'para_once' || repeatMode === 'chapter_once') break;
        }
        if (repeatMode !== 'all' && usedInChapter) break;
      }
    }
  }

  // 按位置排序；同位置时长 trigger 优先，再按义项常用度（senseRank 小者优先）
  all.sort(function(a, b) {
    if (a.position !== b.position) return a.position - b.position;
    if (a.chWord.length !== b.chWord.length) return b.chWord.length - a.chWord.length;
    return (a.senseRank || 0) - (b.senseRank || 0);
  });
  // 剔除重叠（同一文本片段只保留一个标注）
  var noOverlap = [];
  var lastPi = -1, lastEnd = -1;
  for (var oi = 0; oi < all.length; oi++) {
    var m = all[oi];
    var mpi = Math.floor(m.position / 10000);
    var mpos = m.position - mpi * 10000;
    if (mpi === lastPi && mpos < lastEnd) continue;
    noOverlap.push(m);
    lastPi = mpi; lastEnd = mpos + m.chWord.length;
  }

  // ===== 分布化选词（核心改动）=====
  var pick = pickMatchesByStrategy(noOverlap, paragraphs, targetWords, strategy, perParaMax, maxRepeat);
  var picked = pick.matches;

  var keep = {};
  for (var pk = 0; pk < picked.length; pk++) keep[picked[pk].lemma] = true;
  var cappedOut = {};
  for (var co = 0; co < noOverlap.length; co++) {
    if (!keep[noOverlap[co].lemma]) cappedOut[noOverlap[co].lemma] = true;
  }
  var unmatched = Object.keys(cappedOut).concat(noTriggerWords);
  return {
    matches: picked,
    unmatched: unmatched,
    uniqueCount: Object.keys(keep).length,
    paraDist: computeParaDist(picked, paragraphs),
    capBlocked: pick.capBlocked || 0,
    targetWords: targetWords
  };
}

// ===== 重新生成语境材料 =====
// ===== 取词池（单词书选择 + 词池范围过滤）=====
function buildLearnWordPool() {
  var opts = getLearnOpts();
  var ids = opts.bookIds || [];
  var pool = STATE.words;
  if (ids.length) {
    pool = pool.filter(function(w) { return ids.indexOf(w.wordbookId || '') !== -1; });
  }
  var scope = opts.poolScope || 'all';
  if (scope === 'all') return pool;
  var vocabSet = {};
  STATE.vocab.forEach(function(v) { vocabSet[(v.lemma || '').toLowerCase()] = true; });
  return pool.filter(function(w) {
    var lm = (w.lemma || '').toLowerCase();
    var m = STATE.mastery[w.lemma] || STATE.mastery[lm] || {};
    var st = m.status || 'unknown';
    if (scope === 'unknown') return st !== 'known';
    if (scope === 'fuzzy') return st === 'fuzzy';
    if (scope === 'vocab') return !!vocabSet[lm];
    return true;
  });
}

// 当前词池的简短描述，用于按钮文案
function learnPoolSummary() {
  var ids = getLearnOpts().bookIds || [];
  if (!ids.length) return '全部单词书';
  var names = [];
  ids.forEach(function(id) {
    for (var i = 0; i < STATE.wordbooks.length; i++) {
      if (STATE.wordbooks[i].id === id) { names.push(STATE.wordbooks[i].name); return; }
    }
  });
  if (names.length === 0) return '全部单词书';
  if (names.length === 1) return names[0];
  return names[0] + ' +' + (names.length - 1) + ' 本';
}

// 分布策略的中文名（信息条展示用）
function strategyName(v) {
  if (v === 'length') return '按篇幅分配';
  if (v === 'sequential') return '顺序取';
  return '每段均摊';
}

function saveLearnOpts() {
  if (!STATE.profileId) return;
  LS.set('learnOpts_' + STATE.profileId, getLearnOpts());
}

// ===== 单词书选择器 UI =====
function renderWbPicker() {
  var panel = document.getElementById('wbPanel');
  var opts = getLearnOpts();

  var sel = document.getElementById('selStrategy');
  if (sel) sel.value = opts.strategy;
  var pm = document.getElementById('perParaMaxInput');
  if (pm) pm.value = opts.perParaMax;

  var btn = document.getElementById('wbPickerBtn');
  if (btn) btn.textContent = '单词书：' + learnPoolSummary();
  if (!panel) return;

  var ids = opts.bookIds || [];
  var html = '<div class="wp-sec">参与取词的单词书</div>';
  if (STATE.wordbooks.length === 0) {
    html += '<div class="wp-none">还没有单词书</div>';
  } else {
    STATE.wordbooks.forEach(function(wb) {
      var cnt = STATE.words.filter(function(w) { return w.wordbookId === wb.id; }).length;
      var on = (ids.length === 0) || (ids.indexOf(wb.id) !== -1);
      html += '<label class="wp-row"><input type="checkbox" ' + (on ? 'checked' : '') +
        ' onchange="onWbCheck(\'' + wb.id + '\', this.checked)">' +
        '<span class="wp-name">' + escapeHTML(wb.name) + '</span>' +
        '<span class="wp-cnt">' + cnt + ' 词</span></label>';
    });
  }
  html += '<div class="wp-foot"><button type="button" onclick="onWbAll(\'all\')">全部参与</button>' +
    '<button type="button" onclick="onWbAll(\'builtin\')">仅内置</button></div>';

  html += '<div class="wp-sec">词池范围</div>';
  var scopes = [['all', '全部词'], ['unknown', '还没记住（未掌握）'], ['fuzzy', '标记为模糊的'], ['vocab', '生词本']];
  scopes.forEach(function(s) {
    html += '<label class="wp-row"><input type="radio" name="wpScope" value="' + s[0] + '"' +
      (opts.poolScope === s[0] ? ' checked' : '') +
      ' onchange="onPoolScope(\'' + s[0] + '\')"><span class="wp-name">' + escapeHTML(s[1]) + '</span></label>';
  });

  panel.innerHTML = html;
}

function toggleWbPicker(ev) {
  if (ev) ev.stopPropagation();
  var panel = document.getElementById('wbPanel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    renderWbPicker();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function onWbCheck(id, checked) {
  var opts = getLearnOpts();
  var all = STATE.wordbooks.map(function(w) { return w.id; });
  var ids = (opts.bookIds && opts.bookIds.length) ? opts.bookIds.slice() : all.slice();
  var i = ids.indexOf(id);
  if (checked && i === -1) ids.push(id);
  if (!checked && i !== -1) ids.splice(i, 1);
  if (ids.length >= all.length) ids = [];   // 全选时就记成「空数组 = 全部」
  opts.bookIds = ids;
  saveLearnOpts();
  renderWbPicker();
  applyPoolChange();
}

function onWbAll(kind) {
  var opts = getLearnOpts();
  opts.bookIds = (kind === 'builtin') ? [BUILTIN_WB_ID] : [];
  saveLearnOpts();
  renderWbPicker();
  applyPoolChange();
}

function onPoolScope(v) {
  getLearnOpts().poolScope = v;
  saveLearnOpts();
  applyPoolChange();
}

function onStrategyChange() {
  var sel = document.getElementById('selStrategy');
  getLearnOpts().strategy = sel ? sel.value : 'balanced';
  saveLearnOpts();
  applyPoolChange();
}

function onPerParaMaxChange() {
  var el = document.getElementById('perParaMaxInput');
  var v = parseInt(el ? el.value : '4', 10);
  if (!v || v < 1) v = 1;
  if (v > 30) v = 30;
  if (el) el.value = v;
  getLearnOpts().perParaMax = v;
  saveLearnOpts();
  applyPoolChange();
}

// 词池 / 分布设置变化 → 只重算当前章（其他章保持不动）
function applyPoolChange() {
  if (STATE.learnMaterialId && STATE.learnChapterId) {
    var n = regenerateMatches(STATE.learnMaterialId, STATE.learnChapterId);
    refreshLearn();
    toast('已切换到「' + learnPoolSummary() + '」，本章重算 ' + n + ' 处标注（手动标注已保留）', 'ok');
  }
  renderMaterials();
}

// 全部资料重算（按钮兜底）
function regenerateAllMaterials() {
  if (STATE.materials.length === 0) { toast('还没有学习资料', 'err'); return; }
  if (buildLearnWordPool().length === 0) { toast('当前词池里没有可用的词，请换一本单词书或调整词池范围', 'err'); return; }
  var total = 0;
  STATE.materials.forEach(function(m) { total += regenerateMatchesForMaterial(m.id) || 0; });
  if (STATE.learnMaterialId && STATE.learnChapterId) refreshLearn();
  renderMaterials();
  toast('已按当前词池重算 ' + STATE.materials.length + ' 份资料，共 ' + total + ' 处标注', 'ok');
}

// 点空白处收起单词书面板
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', function(e) {
    var panel = document.getElementById('wbPanel');
    if (!panel || panel.classList.contains('hidden')) return;
    var picker = document.getElementById('wbPicker');
    if (picker && picker.contains(e.target)) return;
    panel.classList.add('hidden');
  });
}

// ===== 重新生成语境材料 =====
function regenerateMatches(matId, chId) {
  var chs = STATE.chapters[matId] || [];
  var ch = chs.find(function(c) { return c.id === chId; });
  if (!ch) return 0;
  var allWords = buildLearnWordPool();
  if (allWords.length === 0) return 0;
  var target = (ch.targetWords && ch.targetWords >= 1) ? ch.targetWords : 30;
  var res = generateContextMatches(ch, allWords, 'all', target, getLearnOpts());
  if (!STATE.matches[matId]) STATE.matches[matId] = {};
  // 保留旧的手动修改（如果有 manual 字段）
  var oldMatches = STATE.matches[matId][chId] || [];
  var manualMatches = oldMatches.filter(function(m) { return m.manual; });
  // 新生成的非 manual 匹配，去重（避免和 manual 重复）
  var usedLemmas = {};
  manualMatches.forEach(function(m) { usedLemmas[m.lemma + '|' + m.chWord] = true; });
  var newNonManual = res.matches.filter(function(m) { return !usedLemmas[m.lemma + '|' + m.chWord]; });
  STATE.matches[matId][chId] = manualMatches.concat(newNonManual);
  ch.unmatchedWords = res.unmatched.slice(0, 200);
  ch.paraDist = res.paraDist;
  ch.poolSize = allWords.length;
  ch.capBlocked = res.capBlocked || 0;
  ch.uniqueCount = res.uniqueCount || 0;
  ch.generated = true;
  saveLocal();
  // 同步到云端（仅同步新增的自动匹配）
  newNonManual.forEach(function(m) { syncMatchToCloud(matId, chId, m); });
  return STATE.matches[matId][chId].length;
}
function regenerateMatchesForMaterial(matId) {
  var chs = STATE.chapters[matId] || [];
  var total = 0;
  chs.forEach(function(ch) { total += regenerateMatches(matId, ch.id) || 0; });
  return total;
}
function regenerateAllMatches() {
  var total = 0;
  STATE.materials.forEach(function(m) { total += regenerateMatchesForMaterial(m.id); });
  return total;
}

// ===== 艾宾浩斯复习算法 =====
var REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30]; // 天
function advanceReview(lemma, correct) {
  var m = STATE.mastery[lemma] || { status: 'unknown', attempts: 0, correct: 0, wrong: 0, level: 0, nextReview: null, errorStreakToday: 0 };
  m.attempts++;
  if (correct) {
    m.correct++;
    m.level = Math.min(m.level + 1, REVIEW_INTERVALS.length);
    m.status = m.level >= REVIEW_INTERVALS.length ? 'known' : 'fuzzy';
    m.errorStreakToday = 0;
  } else {
    m.wrong++;
    m.level = Math.max(m.level - 1, 1);
    m.status = 'unknown';
    m.errorStreakToday = (m.errorStreakToday || 0) + 1;
    // 加入生词本
    addToVocab(lemma);
  }
  m.rate = m.attempts > 0 ? Math.round(m.correct / m.attempts * 100) / 100 : 0;
  m.lastReview = nowISO();
  // 下次复习日期
  var intervalIdx = Math.min(m.level - 1, REVIEW_INTERVALS.length - 1);
  if (intervalIdx < 0) intervalIdx = 0;
  var nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + REVIEW_INTERVALS[intervalIdx]);
  m.nextReview = nextDate.toISOString();

  STATE.mastery[lemma] = m;
  return m;
}

function getTodayReviewWords() {
  var today = todayStr();
  return STATE.reviewQueue.filter(function(r) {
    return r.nextReviewDate && r.nextReviewDate.slice(0, 10) <= today;
  });
}

// ===== 生词本 =====
function addToVocab(lemma) {
  for (var i = 0; i < STATE.vocab.length; i++) {
    if (STATE.vocab[i].lemma === lemma) return;
  }
  var w = findWord(lemma);
  STATE.vocab.push({
    lemma: lemma,
    ipa: w ? w.ipa : '',
    pos: w ? w.pos : '',
    meaning: w ? w.meaning : '',
    context: '',
    materialId: STATE.learnMaterialId || '',
    addedAt: nowISO(),
    manual: false
  });
}
function findWord(lemma) {
  for (var i = 0; i < STATE.words.length; i++) {
    if (STATE.words[i].lemma.toLowerCase() === lemma.toLowerCase()) return STATE.words[i];
  }
  return null;
}

// ===== 词条文本解析 =====
// 解析 "818. imprison [ɪm'prɪzn] - v. 监禁；关押" 这类整行词条（很多下载的单词书是单列格式）
function parseEntryText(text) {
  var res = { word: '', ipa: '', pos: '', meaning: '' };
  if (!text) return res;
  var s = String(text).trim();
  s = s.replace(/^\d+\s*[\.、)]\s*/, '');                       // 编号前缀 "818." "12、"
  var ipaM = s.match(/\[([^\]]{1,60})\]/);                     // 音标 [..]
  if (ipaM) { res.ipa = ipaM[1].trim(); s = s.replace(ipaM[0], ' '); }
  var wM = s.match(/^\s*([A-Za-z][A-Za-z\-']*(?:\s+[A-Za-z][A-Za-z\-']*){0,2})\s*[-–—:：]?\s*/); // 开头英文词
  if (wM) { res.word = wM[1].trim(); s = s.slice(wM[0].length); }
  // 误把词性当单词的情况（如 "v. 监禁"）
  if (/^(vt|vi|v|n|adj|adv|prep|conj|pron|num|art|int|aux|abbr|a|ad)\.?$/i.test(res.word)) res.word = '';
  var posM = s.match(/\b(vt|vi|v|n|adj|adv|prep|conj|pron|num|art|int|aux|abbr)\.\s*/i); // 词性
  if (posM) { res.pos = posM[1].toLowerCase() + '.'; s = s.replace(posM[0], ' '); }
  s = s.replace(/^[a-zA-Z\.\s\-–—:：;；,，/]+/, '').trim();    // 剩余英文/分隔符
  res.meaning = s;
  return res;
}
// 展示用纯英文词（对历史脏数据做兜底：lemma 里混入编号/音标/释义时提取纯词）
function displayWord(lemma) {
  var s = String(lemma || '').trim();
  if (/^[A-Za-z][A-Za-z\-']*$/.test(s)) return s;              // 已是纯词
  var p = parseEntryText(s);
  return p.word || s;
}
// 展示用纯净释义（剥离可能混入的编号/音标/词性前缀）
function cleanMeaningText(meaning) {
  if (!meaning) return '';
  var s = String(meaning).trim();
  if (!/[\d\[a-zA-Z]/.test(s.charAt(0))) return s;             // 中文开头 → 已干净
  var p = parseEntryText(s);
  return p.meaning || s;
}
// 取释义的第一个中文义项（保证选项是纯中文短词，不混英文/编号/音标）
function primaryChinese(meaning) {
  var c = cleanMeaningText(meaning);
  if (!c) return '';
  return c.split(/[；;,，、]/)[0].trim();
}

// ===== 发音 =====
function speak(text) {
  if (!window.speechSynthesis) { toast('浏览器不支持语音合成', 'err'); return; }
  var u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.8;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ===== 账号系统 =====
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tab); });
  document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
}

// ===== 云端账号登记（昵称 → profile_id + 密码哈希）=====
// 关键：云端账号记录是跨设备登录的唯一依据。没有它，第二台设备无法发现账号。
function queryCloudUserByNick(nick) {
  CLOUD.init();
  if (!STATE.cloudReady) return Promise.resolve(null);
  return CLOUD.query(DB_IDS.context_users, { property: { property: '昵称', text: { equals: nick } } }).then(function(rows) {
    return rows.length > 0 ? rows[0] : null;
  }).catch(function() { return null; });
}

// 在云端业务表里找出某昵称的历史 profile_id（兼容早期 "p_昵称_时间戳" 格式）
// 返回记录最多的那个 ID；若云端无任何数据返回 null
function pickBestProfileId(nick, localId) {
  if (!STATE.cloudReady) return Promise.resolve(localId || null);
  var pat = 'p_' + nick;
  var counts = {};
  function tally(rows) {
    (rows || []).forEach(function(r) {
      var p = r && r['profile_id'];
      if (p) counts[p] = (counts[p] || 0) + 1;
    });
  }
  return Promise.all([
    CLOUD.query(DB_IDS.context_materials, { property: { property: 'profile_id', text: { contains: pat } } }),
    CLOUD.query(DB_IDS.context_wordbooks, { property: { property: 'profile_id', text: { contains: pat } } }),
    CLOUD.query(DB_IDS.context_words, { property: { property: 'profile_id', text: { contains: pat } } })
  ]).then(function(res) {
    res.forEach(tally);
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function(k) { if (counts[k] > bestN) { bestN = counts[k]; best = k; } });
    if (best) return best;
    return localId || null;
  }).catch(function() { return localId || null; });
}

// 解析某昵称应使用的 profileId（跨设备一致性的核心）
// 规则：云端登记ID > 云端数据所在ID（记录最多者）> 本地ID > 昵称派生ID
function resolveAccountProfileId(nick, localId) {
  if (!STATE.cloudReady) return Promise.resolve(localId || null);
  return queryCloudUserByNick(nick).then(function(regRow) {
    var regId = regRow && regRow['profile_id'];
    return sha256(nick.toLowerCase()).then(function(nh) {
      var stable = 'p_' + nh.substring(0, 16);
      // 一次扫描：找出所有含该昵称的历史 profile_id（兼容早期 p_昵称_时间戳 格式）
      return CLOUD.query(DB_IDS.context_materials, { property: { property: 'profile_id', text: { contains: 'p_' + nick } } }).then(function(rows) {
        var counts = {};
        (rows || []).forEach(function(r) { var p = r['profile_id']; if (p) counts[p] = (counts[p] || 0) + 1; });
        var cands = Object.keys(counts);
        function pushC(x) { if (x && cands.indexOf(x) === -1) cands.push(x); }
        pushC(regId); pushC(localId); pushC(stable);
        return Promise.all(cands.map(function(pid) {
          if (counts[pid] !== undefined) return Promise.resolve({ pid: pid, n: counts[pid] });
          return CLOUD.query(DB_IDS.context_materials, { property: { property: 'profile_id', text: { equals: pid } } })
            .then(function(rs) { return { pid: pid, n: (rs || []).length }; });
        }));
      }).then(function(list) {
        list.sort(function(a, b) { return b.n - a.n; });
        if (list.length && list[0].n > 0) return list[0].pid;   // 数据在哪，身份就在哪
        return regId || localId || stable;
      });
    });
  }).catch(function() { return localId || null; });
}

// 登记/更新云端账号：不存在则登记；密码一致则更新；密码不一致回调 onConflict
function claimCloudUser(nick, passHash, profileId, onConflict) {
  if (!STATE.cloudReady) return Promise.resolve('offline');
  return queryCloudUserByNick(nick).then(function(row) {
    var props = {
      'profile_id': { text: profileId },
      '昵称': { text: nick },
      '密码哈希': { text: passHash },
      '更新时间': { date: nowISO() },
      '最后同步': { date: nowISO() }
    };
    if (!row) {
      props['创建时间'] = { date: nowISO() };
      return CLOUD.add(DB_IDS.context_users, props).then(function(r) {
        if (r && r.id) STATE.cloudUserId = r.id;
        return 'claimed';
      });
    }
    if (row['密码哈希'] === passHash || !row['密码哈希']) {
      if (row._id) CLOUD.update(DB_IDS.context_users, row._id, props);
      STATE.cloudUserId = row._id;
      return 'ok';
    }
    if (onConflict) onConflict();
    return 'conflict';
  }).catch(function() { return 'error'; });
}

// 进入应用时兜底：确保云端有本账号的登记记录（自愈，解决老账号未登记的问题）
function ensureCloudUser() {
  if (!STATE.cloudReady || !STATE.profileId || !STATE.nickname) return;
  var users = LS.get('users', []);
  var me = null;
  for (var i = 0; i < users.length; i++) { if (users[i].nick === STATE.nickname) { me = users[i]; break; } }
  if (!me || !me.passHash) return;
  claimCloudUser(STATE.nickname, me.passHash, STATE.profileId, function() {
    // 云端登记的密码与本设备不一致（例如在另一台设备改过密码）→ 不静默覆盖
    console.warn('cloud user password mismatch for', STATE.nickname);
  });
}

function doRegister() {
  var nick = document.getElementById('regNick').value.trim();
  var pass = document.getElementById('regPass').value;
  var err = document.getElementById('regErr');
  err.textContent = '';
  if (nick.length < 3 || nick.length > 20) { err.textContent = '昵称需 3-20 位字符'; return; }
  if (pass.length < 6) { err.textContent = '密码至少 6 位'; return; }
  var existing = LS.get('users', []);
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].nick === nick) { err.textContent = '该昵称已在本设备注册，请直接登录'; return; }
  }
  sha256(pass).then(function(hash) {
    CLOUD.waitReady(5000).then(function() {
      queryCloudUserByNick(nick).then(function(cloudRow) {
        if (cloudRow && cloudRow['密码哈希'] && cloudRow['密码哈希'] !== hash) {
          err.textContent = '该昵称已在云端注册，如果这是你自己的账号请直接登录（需输入正确密码）';
          return;
        }
        if (cloudRow && cloudRow['密码哈希'] === hash && cloudRow['profile_id']) {
          // 同一昵称同密码 → 本人在新设备上操作，直接登录
          finalizeLogin(nick, hash, cloudRow['profile_id'], null, '检测到你的账号（同昵称同密码），已自动登录');
          return;
        }
        // 云端无登记：检查该昵称下是否已有历史学习数据（早期账号未登记密码）
        pickBestProfileId(nick, null).then(function(existingPid) {
          if (existingPid) {
            claimCloudUser(nick, hash, existingPid);
            finalizeLogin(nick, hash, existingPid, null, '检测到该昵称已有云端学习数据，已关联并登录');
            return;
          }
          sha256(nick.toLowerCase()).then(function(nickHash) {
            var pid = 'p_' + nickHash.substring(0, 16);
            claimCloudUser(nick, hash, pid);
            finalizeLogin(nick, hash, pid, null, '注册成功，已自动登录');
          });
        });
      });
    });
  });
}

function doLogin() {
  var nick = document.getElementById('loginNick').value.trim();
  var pass = document.getElementById('loginPass').value;
  var err = document.getElementById('loginErr');
  err.textContent = '';
  if (!nick || !pass) { err.textContent = '请输入昵称和密码'; return; }
  var users = LS.get('users', []);
  var localUser = null;
  for (var i = 0; i < users.length; i++) {
    if (users[i].nick === nick) { localUser = users[i]; break; }
  }
  sha256(pass).then(function(hash) {
    CLOUD.waitReady(5000).then(function(cloudOk) {
      if (!cloudOk) {
        // 云端不可用：只允许登录本设备用过的账号，给出明确原因而非"未注册"
        if (localUser && localUser.passHash === hash) {
          finalizeLogin(nick, hash, localUser.profileId, localUser, '云端暂时连接不上，已进入离线模式（数据保存在本机）');
          return;
        }
        err.textContent = '暂时连接不上云端（网络问题或加载未完成）。离线状态下只能登录本设备用过的账号，请稍后重试。';
        return;
      }
      queryCloudUserByNick(nick).then(function(cloudRow) {
        // 情况1：云端已登记账号 → 以云端密码为准
        if (cloudRow) {
          if (cloudRow['密码哈希'] && cloudRow['密码哈希'] !== hash) { err.textContent = '密码错误'; return; }
          var pid = cloudRow['profile_id'] || (localUser ? localUser.profileId : '');
          if (!pid) { err.textContent = '该账号云端记录异常（缺少账号ID），请联系管理员或换用注册流程'; return; }
          finalizeLogin(nick, hash, pid, localUser, '已通过云端账号登录');
          return;
        }
        // 情况2：云端未登记 → 本地账号
        if (localUser) {
          if (localUser.passHash !== hash) { err.textContent = '密码错误'; return; }
          pickBestProfileId(nick, localUser.profileId).then(function(pid) {
            finalizeLogin(nick, hash, pid || localUser.profileId, localUser, '');
          });
          return;
        }
        // 情况3：本地云端都没有 → 检查云端是否已有该昵称的学习数据（早期未登记密码的老账号，可找回）
        pickBestProfileId(nick, null).then(function(pid) {
          if (!pid) { err.textContent = '该昵称未注册，请先注册'; return; }
          claimCloudUser(nick, hash, pid);
          finalizeLogin(nick, hash, pid, null, '已找回该昵称此前的云端学习数据，密码按本次输入设置');
        });
      });
    });
  });
}

// 统一收尾：落地本地账号记录 → 迁移旧 ID 的本地数据 → 登记云端 → 进入应用
function finalizeLogin(nick, hash, pid, prevUser, msg) {
  var users = LS.get('users', []);
  var found = false;
  for (var i = 0; i < users.length; i++) {
    if (users[i].nick === nick) {
      users[i].passHash = hash;
      users[i].profileId = pid;
      found = true;
      break;
    }
  }
  if (!found) users.push({ nick: nick, passHash: hash, profileId: pid, createdAt: nowISO() });
  LS.set('users', users);
  // 本地数据迁移：把上一版本用过的 profileId 数据搬到最终 ID，避免"换 ID 就丢数据"
  var prev = prevUser && prevUser.profileId;
  if (prev && prev !== pid) {
    try { migrateProfileId(prev, pid, true); } catch (e) { console.warn('migrate err', e); }
  }
  LS.set('current_user', { nick: nick, profileId: pid });
  STATE.profileId = pid;
  STATE.nickname = nick;
  claimCloudUser(nick, hash, pid, function() {
    toast('注意：云端已存在同昵称但密码不同的账号记录，若这不是你的账号请更换昵称', 'err');
  });
  if (msg) toast(msg, 'ok');
  enterApp();
}

// 把旧 profileId 的所有 localStorage 数据迁移到新 profileId
// 只在新 ID 尚无该键时复制，避免覆盖更新的数据；silent=true 时不弹提示
// 把旧 profileId 的所有 localStorage 数据**真合并**到新 profileId。
// 历史版本只在「新 ID 下为空」时才搬旧数据，却无论如何都 LS.del 掉旧 key ——
// 于是账号 ID 一漂移，旧 ID 下独有的书就被直接丢弃，且不推云端。
// 这就是用户反馈的「我自己添加进去的书不见了」的直接原因之一：
// enterApp 每次进来都跑 resolveAccountProfileId（规则是「哪边 materials 多，身份就在哪边」），
// ID 本就会漂移，而每次漂移都可能丢一批本地数据。
// 现在改为：按业务主键并集合并（只增不覆盖），并且**只有写成功才删旧 key**，
// 写失败就保留旧数据等下次进应用再合并一次，绝不静默丢数据。
function migrateProfileId(oldId, newId, silent) {
  if (!oldId || !newId || oldId === newId) return 0;
  var moved = 0;
  var failed = false;
  try {
    moved += mergeArrayKey('materials_' + oldId, 'materials_' + newId, function(m) {
      return m && m.id;
    });
    moved += mergeArrayKey('wordbooks_' + oldId, 'wordbooks_' + newId, function(w) {
      return w && w.id;
    });
    moved += mergeArrayKey('words_' + oldId, 'words_' + newId, function(w) {
      return (w && w.lemma) ? (w.lemma.toLowerCase() + '|' + (w.wordbookId || '')) : null;
    });
    moved += mergeArrayKey('sessions_' + oldId, 'sessions_' + newId, function(s) {
      return s && s.id;
    });
    moved += mergeArrayKey('answers_' + oldId, 'answers_' + newId, function(a) {
      return a ? ((a.sessionId || '') + '|' + (a.lemma || '') + '|' + (a.round || '')) : null;
    });
    moved += mergeArrayKey('vocab_' + oldId, 'vocab_' + newId, function(v) {
      return v ? ((v.lemma || '') + '|' + (v.materialId || '')) : null;
    });
    moved += mergeArrayKey('review_' + oldId, 'review_' + newId, function(r) {
      return r && r.lemma;
    });
    moved += mergeObjOfArrays('chapters_' + oldId, 'chapters_' + newId, function(c) {
      return c && c.id;
    });
    moved += mergeObjOfArrays('matches_' + oldId, 'matches_' + newId, function(m) {
      return m ? (m.lemma + '|' + m.chWord + '|' + m.position) : null;
    });
    moved += mergeObjOfArrays('synonyms_' + oldId, 'synonyms_' + newId, function(s) {
      return s && s.answer;
    });
    moved += mergeObjOfObjects('progress_' + oldId, 'progress_' + newId);
    moved += mergeObjOfObjects('mastery_' + oldId, 'mastery_' + newId);
    if (LS.get('learnOpts_' + newId, null) === null) {
      var lo = LS.get('learnOpts_' + oldId, null);
      if (lo) { LS.set('learnOpts_' + newId, lo); moved++; }
    }
  } catch (e) {
    failed = true;
    console.warn('migrate merge err', e);
  }
  failed = failed || !!LS.saveFailed;
  if (failed) {
    // 写入失败（多半是本机存储写满）：**保留旧 key**，下次进应用还会再合并一次
    console.warn('迁移写入失败，已保留旧账号数据 ' + oldId);
    if (!silent) toast('账号数据迁移没能写入本机存储，旧数据已保留，稍后会自动重试', 'err', 8000);
    return moved;
  }
  PROFILE_KEYS.forEach(function(k) { LS.del(k + '_' + oldId); });
  if (moved > 0 && !silent) toast('已把旧账号数据合并进当前账号（' + moved + ' 项）', 'ok');
  return moved;
}

function logout() {
  showConfirm('退出登录', '确认退出当前账号？数据已自动同步到云端。', function() {
    LS.del('current_user');
    STATE.profileId = null;
    STATE.nickname = '';
    document.getElementById('app').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
  });
}

function enterApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('userChip').textContent = '👤 ' + STATE.nickname;
  // 等 SDK 就绪再决定在线/离线，避免"云端还没连上就当离线"导致误判
  CLOUD.waitReady(5000).then(function() {
    updateSyncBadge();
    // 身份自愈：把本地记录的账号 ID 与云端登记/云端数据实际落点校准一致
    // （历史上 ID 变过多次、或老账号未登记，都会在这里被纠正，保证换设备能读到同一份数据）
    resolveAccountProfileId(STATE.nickname, STATE.profileId).then(function(pid) {
      if (pid && pid !== STATE.profileId) {
        try { migrateProfileId(STATE.profileId, pid, true); } catch (e) { console.warn('identity migrate err', e); }
        STATE.profileId = pid;
        var users = LS.get('users', []);
        for (var i = 0; i < users.length; i++) {
          if (users[i].nick === STATE.nickname) { users[i].profileId = pid; break; }
        }
        LS.set('users', users);
        LS.set('current_user', { nick: STATE.nickname, profileId: pid });
      }
      // 自愈：确保云端有本账号登记（老账号此前可能从未写登记记录，导致换设备登不上）
      ensureCloudUser();
      flushPendingDels().then(function() { return loadDataForProfile(STATE.profileId); }).then(function() {
        // 标记「该账号在本机已经有过云端数据」—— 一旦有过，就永远不再注入示例
        if (typeof markCloudDataSeen === 'function') markCloudDataSeen();
        // 示例数据只允许注入一次，且必须满足「本机从没见过该账号的任何数据」。
        // 旧逻辑用 seen_<profileId> 作标记，而 enterApp 每次都跑 resolveAccountProfileId
        // （规则「哪边 materials 多，身份就在哪边」）→ ID 一漂移标记就失效 → 示例数据被反复注入并推到云端，
        // 表现正是「我删掉的示例书刷新后又回来了」。现在标记绑定昵称，与 ID 漂移解耦。
        var allowSample = (typeof sampleInjectAllowed === 'function')
          ? sampleInjectAllowed()
          : (STATE.materials.length === 0 && STATE.wordbooks.length === 0);
        if (allowSample) { injectSampleData(); }
        refreshAll();
      });
    });
  });
}

// ===== 示例数据注入 =====
function injectSampleData() {
  // 先落标记再注入：即使注入中途出错，也不会第二次再来一遍
  if (typeof markSampleInjected === 'function') markSampleInjected();
  var matId = uid('mat');
  var sampleContent = "虞寻歌睁眼后看着到天花板上那名贵华美的吊灯还有些茫然。\n她不是被虞寻欢钉在地牢的法阵里放血吗？\n只一秒，她便条件反射地调动体内能量，一整年的逃亡经历让她身体已形成本能，不管在哪儿不管现在什么局面，她先躲到安全的地方再细想。\n然而她一个帅气的鲤鱼挺身，无事发生……\n体内的反应告诉她，她现在就是个普通人。\n正在此时，门外响起了说话声，是她做梦也不会忘记的声音，她的经纪人柳争流。\n她坐起身，环顾四周，是酒店？枕边还有她已经多年没见过的手机，她拿起一看，上面显示时间是2月21日23点。";
  var parsed = parseTXT(sampleContent);
  var material = {
    id: matId,
    title: '虞寻歌·重生（示例）',
    sourceType: 's_manual',
    rawContent: sampleContent,
    chapters: parsed.chapters,
    chapterCount: parsed.chapters.length,
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  // 自动生成语境材料
  var sampleWords = [{"lemma": "ceiling", "pos": "n.", "ipa": "/ˈsiːlɪŋ/", "meaning": "天花板", "example": "A white ceiling reflected the dim light.", "unit": "U1", "wordbookId": ""}, {"lemma": "beautiful", "pos": "adj.", "ipa": "/ˈbjuːtɪfl/", "meaning": "美丽的；华美的", "example": "The ceiling has a beautiful chandelier.", "unit": "U1", "wordbookId": ""}, {"lemma": "condition", "pos": "n.", "ipa": "/kənˈdɪʃn/", "meaning": "条件；状况", "example": "She responded by condition reflex.", "unit": "U1", "wordbookId": ""}, {"lemma": "reflect", "pos": "v.", "ipa": "/rɪˈflekt/", "meaning": "反射；反映", "example": "Her eyes reflected the fear.", "unit": "U1", "wordbookId": ""}, {"lemma": "remove", "pos": "v.", "ipa": "/rɪˈmuːv/", "meaning": "移开；调动", "example": "She tried to remove her body from danger.", "unit": "U1", "wordbookId": ""}, {"lemma": "body", "pos": "n.", "ipa": "/ˈbɒdi/", "meaning": "身体；躯体", "example": "His body was shaking.", "unit": "U1", "wordbookId": ""}, {"lemma": "formation", "pos": "n.", "ipa": "/fɔːˈmeɪʃn/", "meaning": "形成；构成", "example": "The formation of habits takes time.", "unit": "U1", "wordbookId": ""}, {"lemma": "instinct", "pos": "n.", "ipa": "/ˈɪnstɪŋkt/", "meaning": "本能；直觉", "example": "Trust your instinct.", "unit": "U1", "wordbookId": ""}, {"lemma": "room", "pos": "n.", "ipa": "/ruːm/", "meaning": "房间；地方", "example": "She looked around the room.", "unit": "U1", "wordbookId": ""}, {"lemma": "internal", "pos": "adj.", "ipa": "/ɪnˈtɜːnl/", "meaning": "体内的；内部的", "example": "The internal injury was serious.", "unit": "U1", "wordbookId": ""}, {"lemma": "react", "pos": "v.", "ipa": "/riˈækt/", "meaning": "反应", "example": "She reacted instantly.", "unit": "U1", "wordbookId": ""}, {"lemma": "inform", "pos": "v.", "ipa": "/ɪnˈfɔːm/", "meaning": "告诉；通知", "example": "She informed him of the change.", "unit": "U1", "wordbookId": ""}, {"lemma": "speak", "pos": "v.", "ipa": "/spiːk/", "meaning": "说话", "example": "She spoke softly.", "unit": "U1", "wordbookId": ""}, {"lemma": "nor", "pos": "conj.", "ipa": "/nɔːr/", "meaning": "也不", "example": "She did not cry nor did she smile.", "unit": "U1", "wordbookId": ""}, {"lemma": "forget", "pos": "v.", "ipa": "/fəˈɡet/", "meaning": "忘记", "example": "I will never forget that day.", "unit": "U1", "wordbookId": ""}, {"lemma": "around", "pos": "prep.", "ipa": "/əˈraʊnd/", "meaning": "四处；周围", "example": "She looked around.", "unit": "U1", "wordbookId": ""}, {"lemma": "onto", "pos": "prep.", "ipa": "/ˈɒntə/", "meaning": "在…之上", "example": "The book fell onto the floor.", "unit": "U1", "wordbookId": ""}, {"lemma": "elapse", "pos": "v.", "ipa": "/iˈlæps/", "meaning": "(时间)流逝", "example": "Years had elapsed since they met.", "unit": "U1", "wordbookId": ""}];
  var wbId = uid('wb');
  var wordbook = { id: wbId, name: '示例单词书·18词', source: 'sample.csv', total: sampleWords.length, importedAt: nowISO() };
  sampleWords.forEach(function(w) { w.wordbookId = wbId; });

  parsed.chapters.forEach(function(ch) {
    ch.generated = true;
    ch.targetWords = 18;
  });

  STATE.materials.push(material);
  STATE.chapters[matId] = parsed.chapters;
  STATE.wordbooks.push(wordbook);
  STATE.words = STATE.words.concat(sampleWords);

  // 用公共函数生成语境材料
  regenerateMatchesForMaterial(matId);

  saveLocal();
  // 同步到云端
  syncMaterialToCloud(material);
  syncWordbookToCloud(wordbook);
  sampleWords.forEach(function(w) { syncWordToCloud(w); });
  parsed.chapters.forEach(function(ch) { syncChapterToCloud(matId, ch); });
  var allMatches = STATE.matches[matId] || {};
  Object.keys(allMatches).forEach(function(cid) {
    STATE.matches[matId][cid].forEach(function(m) { syncMatchToCloud(matId, cid, m); });
  });
  toast('已注入示例数据，可直接开始学习', 'ok');
}

// ===== 云同步（单条）=====
function syncMaterialToCloud(m) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '资料ID': { text: m.id },
    '标题': { text: m.title },
    '来源类型': { select: m.sourceType || 's_txt' },
    '原始文本': { text: m.rawContent || '' },
    '章节JSON': { text: JSON.stringify(m.chapters || []) },
    '章节数': { number: m.chapterCount || 0 },
    '创建时间': { date: m.createdAt || nowISO() },
    '更新时间': { date: m.updatedAt || nowISO() }
  };
  if (m._cloudId) {
    CLOUD.update(DB_IDS.context_materials, m._cloudId, props);
  } else {
    CLOUD.add(DB_IDS.context_materials, props).then(function(r) { if (r && r.id) m._cloudId = r.id; });
  }
}
function syncWordbookToCloud(wb) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '单词书ID': { text: wb.id },
    '书名': { text: wb.name },
    '源文件': { text: wb.source || '' },
    '词条数': { number: wb.total || 0 },
    '导入时间': { date: wb.importedAt || nowISO() }
  };
  if (wb._cloudId) CLOUD.update(DB_IDS.context_wordbooks, wb._cloudId, props);
  else CLOUD.add(DB_IDS.context_wordbooks, props).then(function(r) { if (r && r.id) wb._cloudId = r.id; });
}
function syncWordToCloud(w) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '单词书ID': { text: w.wordbookId || '' },
    '词元': { text: w.lemma },
    '词性': { text: w.pos || '' },
    '音标': { text: w.ipa || '' },
    '中文释义': { text: w.meaning || '' },
    '例句': { text: w.example || '' },
    '单元标签': { text: w.unit || '' }
  };
  if (w._cloudId) CLOUD.update(DB_IDS.context_words, w._cloudId, props);
  else CLOUD.add(DB_IDS.context_words, props).then(function(r) { if (r && r.id) w._cloudId = r.id; });
}
function syncChapterToCloud(matId, ch) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '资料ID': { text: matId },
    '章节ID': { text: ch.id },
    '章节标题': { text: ch.title },
    '顺序': { number: ch.order || 0 },
    '章节内容': { text: ch.content || '' },
    '目标词数': { number: ch.targetWords || 10 },
    '已生成语境材料': { checkbox: ch.generated || false }
  };
  if (ch._cloudId) CLOUD.update(DB_IDS.context_chapters, ch._cloudId, props);
  else CLOUD.add(DB_IDS.context_chapters, props).then(function(r) { if (r && r.id) ch._cloudId = r.id; });
}
function syncMatchToCloud(matId, chId, m) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '资料ID': { text: matId },
    '章节ID': { text: chId },
    '词元': { text: m.lemma },
    '对应中文': { text: m.chWord },
    '使用义项': { text: m.sense || '' },
    '位置': { number: m.position || 0 },
    '所在句子': { text: m.sentence || '' },
    '手动修改': { checkbox: m.manual || false }
  };
  if (m._cloudId) CLOUD.update(DB_IDS.context_matches, m._cloudId, props);
  else CLOUD.add(DB_IDS.context_matches, props).then(function(r) { if (r && r.id) m._cloudId = r.id; });
}
function syncMasteryToCloud(lemma) {
  if (!STATE.cloudReady) return;
  var m = STATE.mastery[lemma]; if (!m) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '词元': { text: lemma },
    '资料ID': { text: m.materialId || '' },
    '状态': { select: m.status || 'unknown' },
    '尝试次数': { number: m.attempts || 0 },
    '正确次数': { number: m.correct || 0 },
    '错误次数': { number: m.wrong || 0 },
    '正确率': { number: m.rate || 0 },
    '最近答案': { text: m.lastAnswer || '' },
    '最近复习': { date: m.lastReview || nowISO() },
    '复习等级': { number: m.level || 0 },
    '下次复习': { date: m.nextReview || nowISO() },
    '今日连错': { number: m.errorStreakToday || 0 }
  };
  if (m._cloudId) CLOUD.update(DB_IDS.context_mastery, m._cloudId, props);
  else CLOUD.add(DB_IDS.context_mastery, props).then(function(r) { if (r && r.id) m._cloudId = r.id; });
}
function syncVocabToCloud(v) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '词元': { text: v.lemma },
    '音标': { text: v.ipa || '' },
    '词性': { text: v.pos || '' },
    '中文释义': { text: v.meaning || '' },
    '语境': { text: v.context || '' },
    '资料ID': { text: v.materialId || '' },
    '加入时间': { date: v.addedAt || nowISO() },
    '手动添加': { checkbox: v.manual || false }
  };
  if (v._cloudId) CLOUD.update(DB_IDS.context_vocab, v._cloudId, props);
  else CLOUD.add(DB_IDS.context_vocab, props).then(function(r) { if (r && r.id) v._cloudId = r.id; });
}
function syncAnswerToCloud(a) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '会话ID': { text: a.sessionId || '' },
    '词元': { text: a.lemma },
    '轮次': { select: a.round || 'r1' },
    '题型': { select: a.qType || 'q_multi' },
    '是否正确': { checkbox: a.correct || false },
    '用户输入': { text: a.userInput || '' },
    '标准答案': { text: a.stdAnswer || '' },
    '时间戳': { date: a.ts || nowISO() }
  };
  CLOUD.add(DB_IDS.context_answers, props).then(function(r) { if (r && r.id) a._cloudId = r.id; });
}
function syncSessionToCloud(s) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '会话ID': { text: s.id },
    '资料ID': { text: s.materialId || '' },
    '开始时间': { date: s.startedAt || nowISO() },
    '结束时间': { date: s.endedAt || nowISO() },
    '学习分钟': { number: s.durationMin || 0 },
    '阅读章节': { text: s.chapters || '' },
    '遇到词数': { number: s.wordsCount || 0 }
  };
  if (s._cloudId) CLOUD.update(DB_IDS.context_sessions, s._cloudId, props);
  else CLOUD.add(DB_IDS.context_sessions, props).then(function(r) { if (r && r.id) s._cloudId = r.id; });
}
function syncReviewToCloud(r) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '词元': { text: r.lemma },
    '等级': { number: r.level || 1 },
    '下次复习日期': { date: r.nextReviewDate || nowISO() },
    '上次结果': { select: r.lastResult || 'rev_unknown' },
    '资料ID': { text: r.materialId || '' },
    '加入时间': { date: r.addedAt || nowISO() }
  };
  if (r._cloudId) CLOUD.update(DB_IDS.context_review, r._cloudId, props);
  else CLOUD.add(DB_IDS.context_review, props).then(function(res) { if (res && res.id) r._cloudId = res.id; });
}

// ===== 手动同步 =====
function syncNow() {
  if (!STATE.cloudReady) { toast('离线模式，无法同步', 'err'); return; }
  saveLocal();
  toast('正在同步...', 'ok');
  // 重新从云端拉取最新
  loadDataForProfile(STATE.profileId).then(function() {
    refreshAll();
    toast('同步完成', 'ok');
  });
}
function toggleAutoSync() {
  STATE.autoSync = document.getElementById('autoSync').checked;
  LS.set('autoSync', STATE.autoSync);
}
function scheduleSync() {
  if (!STATE.autoSync || !STATE.cloudReady) return;
  if (STATE.syncTimer) clearTimeout(STATE.syncTimer);
  STATE.syncTimer = setTimeout(function() { saveLocal(); }, 2000);
}

// ===== 导航 =====
function navTo(view) {
  STATE.view = view;
  document.querySelectorAll('.nav-tab').forEach(function(t) {
    if (t.dataset.view === view) t.classList.add('active');
    else t.classList.remove('active');
  });
  document.querySelectorAll('section[id^="view-"]').forEach(function(s) {
    if (s.id === 'view-' + view) s.classList.remove('hidden');
    else s.classList.add('hidden');
  });
  // 视图特定渲染
  if (view === 'dashboard') renderDashboard();
  if (view === 'materials') renderMaterials();
  if (view === 'learn') renderLearnInit();
  if (view === 'test') renderTestInit();
  if (view === 'review') renderReview();
  if (view === 'vocab') renderVocab();
  if (view === 'wrong') renderWrong();
}

// ===== Dashboard 渲染 =====
function renderDashboard() {
  var today = todayStr();
  // 连续天数
  var streakDays = 0;
  var lastDate = null;
  STATE.sessions.sort(function(a,b) { return (b.startedAt||'').localeCompare(a.startedAt||''); }).forEach(function(s) {
    var d = (s.startedAt||'').slice(0,10);
    if (d === today || d === lastDate) { streakDays++; lastDate = d; }
    else if (lastDate) {
      var prev = new Date(lastDate); prev.setDate(prev.getDate()-1);
      if (d === prev.toISOString().slice(0,10)) { streakDays++; lastDate = d; }
      else return;
    }
  });

  var newWordsToday = 0;
  var reviewToday = getTodayReviewWords().length;
  var correctToday = 0;
  var totalToday = 0;
  STATE.answers.forEach(function(a) {
    if ((a.ts||'').slice(0,10) === today) {
      totalToday++;
      if (a.correct) correctToday++;
    }
  });
  var rateToday = totalToday > 0 ? Math.round(correctToday/totalToday*100) : 0;

  var html = '<div class="dash-card"><div class="num">' + newWordsToday + '</div><div class="lbl">今日新词</div></div>';
  html += '<div class="dash-card"><div class="num orange">' + reviewToday + '</div><div class="lbl">待复习</div></div>';
  html += '<div class="dash-card"><div class="num">' + streakDays + '</div><div class="lbl">连续天数</div></div>';
  html += '<div class="dash-card"><div class="num ' + (rateToday >= 80 ? '' : 'red') + '">' + rateToday + '%</div><div class="lbl">今日正确率</div></div>';
  document.getElementById('dashStats').innerHTML = html;

  // 最近资料
  var recentHtml = '<h3>最近学习</h3>';
  if (STATE.materials.length === 0) {
    recentHtml += '<p style="color:var(--text3);font-size:13px">暂无资料，请上传</p>';
  } else {
    STATE.materials.slice(0, 5).forEach(function(m) {
      var prog = STATE.progress[m.id] || {};
      var chs = STATE.chapters[m.id] || [];
      var doneCh = 0;
      chs.forEach(function(ch) { if (prog[ch.id]) doneCh++; });
      var pct = chs.length > 0 ? Math.round(doneCh/chs.length*100) : 0;
      recentHtml += '<div class="recent-item"><div class="info"><div class="title">' + escapeHTML(m.title) + '</div><div class="meta">' + chs.length + ' 章 · ' + (m.chapterCount||0) + ' 词</div></div><span class="progress">' + pct + '%</span></div>';
    });
  }
  document.getElementById('dashRecent').innerHTML = recentHtml;
}

// ===== 资料管理渲染 =====
function renderMaterials() {
  // 资料列表
  var matHtml = '';
  if (STATE.materials.length === 0) {
    matHtml = '<div class="empty-state"><p>暂无学习资料</p></div>';
  } else {
    STATE.materials.forEach(function(m) {
      var chs = STATE.chapters[m.id] || [];
      matHtml += '<div class="material-item"><div class="info"><div class="title">' + escapeHTML(m.title) + '</div><div class="meta">' + (m.importedFrom === 'pdf' ? 'PDF导入' : (m.sourceType === 's_manual' ? '手动输入' : 'TXT导入')) + (m.pageCount ? '（' + m.pageCount + ' 页）' : '') + ' · ' + chs.length + ' 章 · ' + (m.rawContent||'').length + ' 字</div></div><div class="actions"><button class="btn btn-sm btn-outline" onclick="navTo(\'learn\');selectMaterial(\'' + m.id + '\')">学习</button><button class="btn btn-sm btn-danger" onclick="deleteMaterial(\'' + m.id + '\')">删除</button></div></div>';
    });
  }
  document.getElementById('materialList').innerHTML = matHtml;

  // 单词书列表
  var wbHtml = '';
  if (STATE.wordbooks.length === 0) {
    wbHtml = '<div class="empty-state"><p>暂无单词书</p></div>';
  } else {
    STATE.wordbooks.forEach(function(wb) {
      var wordCount = STATE.words.filter(function(w) { return w.wordbookId === wb.id; }).length;
      var isBuiltin = (wb.id === BUILTIN_WB_ID || wb.builtin);
      var hitSet = {};
      var curM = (STATE.learnMaterialId && STATE.learnChapterId && STATE.matches[STATE.learnMaterialId]) ? (STATE.matches[STATE.learnMaterialId][STATE.learnChapterId] || []) : [];
      curM.forEach(function(m) { hitSet[m.lemma] = true; });
      var bookHit = 0;
      if (curM.length) {
        STATE.words.forEach(function(w) { if (w.wordbookId === wb.id && hitSet[(w.lemma || '').toLowerCase()]) bookHit++; });
      }
      wbHtml += '<div class="material-item"><div class="info"><div class="title">' + escapeHTML(wb.name) + (isBuiltin && (wb.source || '').indexOf('内置') === -1 ? ' <span style="font-size:11px;padding:1px 6px;border-radius:8px;background:var(--bg3,#eef1f6);color:var(--text2);vertical-align:2px">内置</span>' : '') + '</div><div class="meta">' + (wb.source||'') + ' · ' + wordCount + ' 词' + (bookHit ? ' · 本章命中 ' + bookHit + ' 词' : '') + '</div></div><div class="actions">' + (isBuiltin
        ? '<button class="btn btn-sm btn-outline" onclick="reinstallBuiltinWordbook()">重装</button>'
        : '<button class="btn btn-sm btn-danger" onclick="deleteWordbook(\'' + wb.id + '\')">删除</button>') + '</div></div>';
    });
  }
  document.getElementById('wordbookList').innerHTML = wbHtml;
  renderWbPicker();
}

// ===== 文件上传处理 =====
var pendingFileData = null;
var pendingFileType = null;

function showUploadModal(type) {
  pendingFileType = type;
  if (type === 'material') {
    document.getElementById('uploadModalTitle').textContent = '上传学习资料';
    document.getElementById('uploadModalBody').innerHTML = '<div style="margin-bottom:12px"><label style="font-size:13px;color:var(--text2);display:block;margin-bottom:6px">资料标题</label><input type="text" id="manualMatTitle" placeholder="输入标题" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px"></div><div><label style="font-size:13px;color:var(--text2);display:block;margin-bottom:6px">或直接粘贴文本</label><textarea id="manualMatText" placeholder="粘贴文章全文..." style="width:100%;height:200px;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px"></textarea></div><div style="margin-top:12px"><p style="font-size:12px;color:var(--text3)">支持 TXT / PDF 直接上传（PDF 自动提取文字并按页分章）。DOCX 请先转为纯文本后粘贴。单篇超过约 15 万汉字（或 30 万英文字符）时会自动拆成多篇导入。</p></div><div class="modal-actions"><button class="btn btn-outline" onclick="closeModal(\'uploadModal\')">取消</button><button class="btn btn-primary" onclick="submitManualMaterial()">确认添加</button></div>';
  } else {
    document.getElementById('uploadModalTitle').textContent = '导入单词书';
    document.getElementById('uploadModalBody').innerHTML = '<div style="margin-bottom:12px"><label style="font-size:13px;color:var(--text2);display:block;margin-bottom:6px">单词书名称</label><input type="text" id="manualWbName" placeholder="输入名称" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px"></div><div><label style="font-size:13px;color:var(--text2);display:block;margin-bottom:6px">粘贴 CSV 格式（首行表头：lemma,pos,ipa,meaning,example,unit）</label><textarea id="manualWbText" placeholder="lemma,pos,ipa,meaning,example,unit&#10;ceiling,n.,/si&#720;l&#618;&#331;/,天花板,A white ceiling...,U1" style="width:100%;height:200px;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace"></textarea></div><div style="margin-top:12px"><p style="font-size:12px;color:var(--text3)">支持 CSV / TXT / PDF（PDF 自动提取词表行，可在下一步核对字段）。XLSX 请先转为 CSV。</p></div><div class="modal-actions"><button class="btn btn-outline" onclick="closeModal(\'uploadModal\')">取消</button><button class="btn btn-primary" onclick="submitManualWordbook()">确认导入</button></div>';
  }
  document.getElementById('uploadModal').classList.add('show');
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function submitManualMaterial() {
  var title = document.getElementById('manualMatTitle').value.trim();
  var text = document.getElementById('manualMatText').value.trim();
  if (!title) { toast('请输入标题', 'err'); return; }
  if (!text || text.length < 10) { toast('请粘贴至少 10 字的文本', 'err'); return; }
  var parsed = parseTXT(text);
  var created = addMaterialSafe(title, text, parsed.chapters, { sourceType: 's_manual' });
  if (!created.length) { toast('资料未能保存：浏览器本地存储空间不足，请先删除一些旧资料再试', 'err', 8000); return; }
  // 自动为新章节生成语境材料（用所有单词书）
  var matchCount = 0, chapterTotal = 0;
  created.forEach(function(m) { matchCount += regenerateMatchesForMaterial(m.id); chapterTotal += (STATE.chapters[m.id] || []).length; });
  closeModal('uploadModal');
  toast(materialSplitTip(created) + '资料已添加，已为 ' + chapterTotal + ' 章生成 ' + matchCount + ' 个语境匹配', 'ok', 8000);
  refreshAll();
}

function submitManualWordbook() {
  var name = document.getElementById('manualWbName').value.trim();
  var csvText = document.getElementById('manualWbText').value.trim();
  if (!name) { toast('请输入名称', 'err'); return; }
  if (!csvText) { toast('请粘贴 CSV 内容', 'err'); return; }
  var parsed = parseCSV(csvText);
  if (parsed.rows.length === 0) { toast('未解析到有效数据', 'err'); return; }
  var wbId = uid('wb');
  var wordbook = { id: wbId, name: name, source: 'manual', total: parsed.rows.length, importedAt: nowISO() };
  var words = parsed.rows.map(function(r) {
    var rawLemma = r.lemma || r.word || r['单词'] || r['列1'] || '';
    var p = parseEntryText(rawLemma);
    var meaning = r.meaning || r['中文释义'] || r['释义'] || '';
    if (!meaning || meaning === rawLemma) meaning = p.meaning || meaning;
    return {
      lemma: p.word || rawLemma,
      pos: r.pos || r['词性'] || p.pos || '',
      ipa: r.ipa || r['音标'] || (p.ipa ? '/' + p.ipa + '/' : ''),
      meaning: cleanMeaningText(meaning),
      example: r.example || r['例句'] || '',
      unit: r.unit || r['单元'] || '',
      wordbookId: wbId
    };
  }).filter(function(w) { return w.lemma; });
  // 去重（按 lemma 忽略大小写）
  var seen = {};
  words = words.filter(function(w) {
    var k = w.lemma.toLowerCase();
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
  STATE.wordbooks.push(wordbook);
  STATE.words = STATE.words.concat(words);
  saveLocal();
  syncWordbookToCloud(wordbook);
  words.forEach(function(w) { syncWordToCloud(w); });
  // 新单词书可能匹配到已有资料，重新生成所有资料的语境材料
  var matchCount = regenerateAllMatches();
  closeModal('uploadModal');
  toast('单词书已导入：' + words.length + ' 词 · 已为所有资料重新生成 ' + matchCount + ' 个语境匹配', 'ok');
  refreshAll();
}

function handleFileUpload(files, type) {
  if (!files || files.length === 0) return;
  var file = files[0];
  if (isPdfFile(file)) { handlePdfUpload(file, type); return; }
  if (file.size > 10 * 1024 * 1024) { toast('文件过大（超过 10MB）', 'err'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result;
    // 编码检测：UTF-8 解码出现替换字符（�）时，按 GBK 重新解码（国内下载的 CSV/TXT 常为 GBK 编码）
    if (text.indexOf('�') !== -1) {
      try {
        var gbReader = new FileReader();
        gbReader.onload = function(ev) {
          toast('检测到 GBK 编码文件，已自动转码', 'ok');
          handleFileText(ev.target.result, file, type);
        };
        gbReader.onerror = function() { handleFileText(text, file, type); };
        gbReader.readAsText(file, 'GBK');
        return;
      } catch (err) { /* 继续用 UTF-8 结果 */ }
    }
    handleFileText(text, file, type);
  };
  reader.onerror = function() { toast('文件读取失败', 'err'); };
  reader.readAsText(file, 'UTF-8');
}

function handleFileText(text, file, type) {
    if (type === 'material') {
      if (file.name.match(/\.docx$/i)) {
        toast('DOCX 文件请先转为纯文本后粘贴', 'err');
        showUploadModal('material');
        return;
      }
      // TXT 文件
      var parsed = parseTXT(text);
      var created = addMaterialSafe(file.name.replace(/\.\w+$/, ''), text, parsed.chapters, { sourceType: 's_txt' });
      if (!created.length) { toast('资料未能保存：浏览器本地存储空间不足，请先删除一些旧资料再试', 'err', 8000); return; }
      var matchCount = 0, chapterTotal = 0;
      created.forEach(function(m) { matchCount += regenerateMatchesForMaterial(m.id); chapterTotal += (STATE.chapters[m.id] || []).length; });
      toast(materialSplitTip(created) + '资料已上传，已为 ' + chapterTotal + ' 章生成 ' + matchCount + ' 个语境匹配', 'ok', 8000);
      refreshAll();
    } else {
      // 单词书 CSV/TXT
      if (file.name.match(/\.xlsx$/i)) {
        toast('XLSX 文件请先转为 CSV', 'err');
        showUploadModal('wordbook');
        return;
      }
      var parsed = parseCSV(text);
      if (parsed.rows.length === 0) { toast('未解析到有效数据', 'err'); return; }
      // 显示字段映射
      showFieldMap(parsed, file.name);
    }
}

// 根据中英文列名别名猜测字段对应列
function guessFieldColumn(f, headers) {
  var aliases = {
    lemma: ['lemma', 'word', '单词', '英文', '词汇', '英语', '词'],
    pos: ['pos', '词性', '属性'],
    ipa: ['ipa', 'phonetic', '音标', '发音'],
    meaning: ['meaning', '释义', '中文', '意思', '翻译', '汉语', '解释', '词义'],
    example: ['example', '例句', '示例', '句子'],
    unit: ['unit', '单元', '标签', '分类', 'chapter', '课']
  };
  var list = aliases[f] || [f];
  for (var i = 0; i < headers.length; i++) {
    var h = (headers[i] || '').toLowerCase().trim();
    if (!h) continue;
    for (var j = 0; j < list.length; j++) {
      if (h === list[j] || h.indexOf(list[j]) !== -1) return headers[i];
    }
  }
  return '';
}

function showFieldMap(parsed, fileName) {
  var fields = ['lemma', 'pos', 'ipa', 'meaning', 'example', 'unit'];
  var fieldLabels = { lemma: '英文单词', pos: '词性', ipa: '音标', meaning: '中文释义', example: '例句', unit: '单元' };
  var html = '<p style="font-size:13px;color:var(--text3);margin-bottom:8px">文件：' + escapeHTML(fileName) + ' · 检测到 ' + parsed.headers.length + ' 列，' + parsed.rows.length + ' 行</p>';
  html += '<div style="font-size:13px;color:var(--text2);margin-bottom:8px">将文件列映射到单词书字段（单列整行格式只需映射「英文单词」，释义/音标/词性会自动解析）：</div>';
  html += '<div class="field-map-row" style="font-weight:600"><div>单词书字段</div><div>文件列</div><div>预览</div></div>';
  fields.forEach(function(f) {
    var guessed = guessFieldColumn(f, parsed.headers);
    if (!guessed && f === 'lemma' && parsed.headers.length > 0) guessed = parsed.headers[0]; // 猜不出时默认第一列为单词列（PDF 提取的文本常无表头）
    var preview = guessed && parsed.rows[0] ? (parsed.rows[0][guessed] || '') : '';
    html += '<div class="field-map-row"><div>' + fieldLabels[f] + ' (' + f + ')</div><div><select id="map_' + f + '"><option value="">--不导入--</option>';
    parsed.headers.forEach(function(h) {
      var sample = parsed.rows[0] ? (parsed.rows[0][h] || '') : '';
      html += '<option value="' + escapeHTML(h) + '" ' + (h === guessed ? 'selected' : '') + '>' + escapeHTML(h) + ' (示例: ' + escapeHTML(sample.substring(0, 20)) + ')</option>';
    });
    html += '</select></div><div style="color:var(--text3)">' + escapeHTML(preview.substring(0, 20)) + '</div></div>';
  });
  html += '<div style="margin-top:12px"><label style="font-size:13px">单词书名称</label><input type="text" id="fieldMapWbName" value="' + escapeHTML(fileName.replace(/\.\w+$/, '')) + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:4px"></div>';
  document.getElementById('fieldMapBody').innerHTML = html;
  document.getElementById('fieldMapModal').classList.add('show');
  pendingFileData = parsed;
}

function confirmFieldMap() {
  if (!pendingFileData) return;
  var fields = ['lemma', 'pos', 'ipa', 'meaning', 'example', 'unit'];
  var mapping = {};
  fields.forEach(function(f) {
    var sel = document.getElementById('map_' + f);
    mapping[f] = sel ? sel.value : '';
  });
  if (!mapping.lemma) { toast('必须映射「英文单词」字段', 'err'); return; }
  var wbName = document.getElementById('fieldMapWbName').value.trim() || '导入的单词书';
  // 同名单词书：先确认替换（删除旧书含云端），再导入，避免重复碎片
  var dup = null;
  STATE.wordbooks.forEach(function(w) { if (w.name === wbName) dup = w; });
  if (dup) {
    showConfirm('替换同名单词书', '已存在《' + wbName + '》。继续导入将删除旧书（含云端记录）并用新文件替换，确认？', function() {
      removeWordbook(dup.id);
      doImportFromFieldMap(mapping, wbName);
    });
    return;
  }
  doImportFromFieldMap(mapping, wbName);
}

function doImportFromFieldMap(mapping, wbName) {
  if (!pendingFileData) return;
  var wbId = uid('wb');
  var wordbook = { id: wbId, name: wbName, source: 'csv导入', total: 0, importedAt: nowISO() };
  var words = [];
  var seen = {};
  pendingFileData.rows.forEach(function(r) {
    var rawLemma = (r[mapping.lemma] || '').trim();
    if (!rawLemma) return;
    // 单列整行格式（"818. imprison [ɪm'prɪzn] - v. 监禁；关押"）自动解析出纯词/音标/词性/释义
    var p = parseEntryText(rawLemma);
    var lemma = p.word || rawLemma;
    if (seen[lemma.toLowerCase()]) return;
    seen[lemma.toLowerCase()] = true;
    var meaning = mapping.meaning ? (r[mapping.meaning] || '') : '';
    if (!meaning || meaning === rawLemma) meaning = p.meaning || meaning; // 释义列缺失或与单词列相同 → 用解析结果
    words.push({
      lemma: lemma,
      pos: (mapping.pos ? (r[mapping.pos] || '') : '') || p.pos,
      ipa: (mapping.ipa ? (r[mapping.ipa] || '') : '') || (p.ipa ? '/' + p.ipa + '/' : ''),
      meaning: cleanMeaningText(meaning),
      example: mapping.example ? (r[mapping.example] || '') : '',
      unit: mapping.unit ? (r[mapping.unit] || '') : '',
      wordbookId: wbId
    });
  });
  wordbook.total = words.length;
  // 导入前先拿真实 payload 探一次本机存储配额：localStorage 写满时 setItem 会静默失败，
  // 历史版本表现为「导入成功、刷新后书不见了」。宁可当场拒绝并说清原因，也不要假装成功。
  var payload = JSON.stringify(words);
  if (typeof probeLocalQuota === 'function' && !probeLocalQuota(payload)) {
    closeModal('fieldMapModal');
    pendingFileData = null;
    toast('本机存储空间不足，无法保存这本单词书（约需 ' + Math.ceil(payload.length / 1024) + ' KB）。'
        + '请先删掉不再需要的资料或单词书，再重新导入', 'err', 9000);
    return;
  }
  STATE.wordbooks.push(wordbook);
  STATE.words = STATE.words.concat(words);
  LS.saveFailed = false;
  saveLocal();
  if (LS.saveFailed) {
    // 回读校验失败 → 回滚，绝不留下「看起来成功其实没存进去」的状态
    STATE.wordbooks = STATE.wordbooks.filter(function(w) { return w.id !== wbId; });
    STATE.words = STATE.words.filter(function(w) { return w.wordbookId !== wbId; });
    saveLocal();
    closeModal('fieldMapModal');
    pendingFileData = null;
    toast('本机存储空间不足，这本单词书没有保存成功（已自动回滚）。请先清理空间再导入', 'err', 9000);
    refreshAll();
    return;
  }
  syncWordbookToCloud(wordbook);
  words.forEach(function(w) { syncWordToCloud(w); });
  var matchCount = regenerateAllMatches();
  closeModal('fieldMapModal');
  pendingFileData = null;
  var noMeaning = words.filter(function(w) { return !w.meaning; }).length;
  var msg = '导入成功：' + words.length + ' 词 · 已生成 ' + matchCount + ' 处语境标注';
  if (noMeaning > 0) msg += '（' + noMeaning + ' 词缺中文释义，无法参与匹配）';
  else if (matchCount === 0) msg += '（未匹配到任何词，请检查「中文释义」列内容）';
  msg += '。单词正排队同步到云端，请留意右上角进度';
  toast(msg, (noMeaning > 0 || matchCount === 0) ? 'err' : 'ok');
  refreshAll();
}

// ===== 删除 =====
function deleteMaterial(matId) {
  showConfirm('删除资料', '删除后关联的章节、语境匹配和进度将从本地和云端一并清除，不可恢复。确认删除？', function() {
    var mat = null;
    STATE.materials = STATE.materials.filter(function(m) { if (m.id === matId) { mat = m; return false; } return true; });
    var chs = STATE.chapters[matId] || [];
    var matchGroups = STATE.matches[matId] || {};
    var prog = STATE.progress[matId] || {};
    delete STATE.chapters[matId];
    delete STATE.matches[matId];
    delete STATE.progress[matId];
    if (STATE.learnMaterialId === matId) { STATE.learnMaterialId = null; STATE.learnChapterId = null; }
    saveLocal();
    // 云端同步删除（经限流队列，逐条删除关联记录）
    if (STATE.cloudReady) {
      if (mat && mat._cloudId) CLOUD.del(DB_IDS.context_materials, mat._cloudId);
      chs.forEach(function(c) { if (c._cloudId) CLOUD.del(DB_IDS.context_chapters, c._cloudId); });
      Object.keys(matchGroups).forEach(function(cid) {
        matchGroups[cid].forEach(function(m) { if (m._cloudId) CLOUD.del(DB_IDS.context_matches, m._cloudId); });
      });
      Object.keys(prog).forEach(function(cid) {
        if (prog[cid] && prog[cid]._cloudId) CLOUD.del(DB_IDS.context_progress, prog[cid]._cloudId);
      });
    }
    toast('已删除', 'ok');
    refreshAll();
  });
}
// 删除单词书核心逻辑（无确认弹窗，供删除按钮和"替换同名书"复用）
function removeWordbook(wbId) {
  var wb = null;
  STATE.wordbooks = STATE.wordbooks.filter(function(w) { if (w.id === wbId) { wb = w; return false; } return true; });
  var removedWords = STATE.words.filter(function(w) { return w.wordbookId === wbId; });
  STATE.words = STATE.words.filter(function(w) { return w.wordbookId !== wbId; });
  saveLocal();
  // 云端同步删除；失败或离线时记成待办，下次进应用自动补删（否则下次刷新会被云端覆盖回来）
  var _delJobs = [];
  if (wb && wb._cloudId) _delJobs.push({ db: DB_IDS.context_wordbooks, id: wb._cloudId });
  removedWords.forEach(function(w) { if (w._cloudId) _delJobs.push({ db: DB_IDS.context_words, id: w._cloudId }); });
  if (!STATE.cloudReady) {
    // 离线模式：云端完全没动过，全部记成待办
    _delJobs.forEach(function(j) { queuePendingDel(j.db, j.id); });
  } else {
    _delJobs.forEach(function(j) {
      CLOUD.del(j.db, j.id).then(function(r) {
        if (r === null) queuePendingDel(j.db, j.id);   // _rawDel 失败时返回 null
      });
    });
  }
  return removedWords.length;
}
function deleteWordbook(wbId) {
  showConfirm('删除单词书', '删除后关联的单词将从本地和云端一并清除，不可恢复。确认删除？', function() {
    removeWordbook(wbId);
    toast('已删除', 'ok');
    refreshAll();
  });
}

function showConfirm(title, msg, onOk) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  var btn = document.getElementById('confirmOkBtn');
  btn.onclick = function() { closeModal('confirmModal'); if (onOk) onOk(); };
  document.getElementById('confirmModal').classList.add('show');
}

// ===== 学习页 =====
function renderLearnInit() {
  if (STATE.materials.length === 0) {
    document.getElementById('learnEmpty').classList.remove('hidden');
    document.getElementById('learnContent').classList.add('hidden');
    return;
  }
  document.getElementById('learnEmpty').classList.add('hidden');
  document.getElementById('learnContent').classList.remove('hidden');
  // 填充资料下拉
  var selMat = document.getElementById('selMaterial');
  selMat.innerHTML = STATE.materials.map(function(m) {
    return '<option value="' + m.id + '"' + (STATE.learnMaterialId === m.id ? ' selected' : '') + '>' + escapeHTML(m.title) + '</option>';
  }).join('');
  if (!STATE.learnMaterialId && STATE.materials.length > 0) {
    STATE.learnMaterialId = STATE.materials[0].id;
  }
  onLearnMaterialChange();
  // 检查所有章节是否有 matches，没有则一键自动生成
  var matId = STATE.learnMaterialId;
  var chs = STATE.chapters[matId] || [];
  var needGen = chs.some(function(ch) {
    var ms = (STATE.matches[matId] && STATE.matches[matId][ch.id]) || [];
    return ms.length === 0;
  });
  if (needGen && STATE.words.length > 0) {
    var total = 0;
    chs.forEach(function(ch) {
      if (!STATE.matches[matId]) STATE.matches[matId] = {};
      if (!STATE.matches[matId][ch.id] || STATE.matches[matId][ch.id].length === 0) {
        total += regenerateMatches(matId, ch.id) || 0;
      }
    });
    if (total > 0) {
      toast('已为 ' + chs.length + ' 个空章节自动生成 ' + total + ' 个语境匹配', 'ok');
      refreshLearn();
    }
  } else if (needGen && STATE.words.length === 0) {
    toast('当前资料还没有语境匹配，请先到「资料」页导入单词书', 'err');
  }
}

function onLearnMaterialChange() {
  STATE.learnMaterialId = document.getElementById('selMaterial').value;
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var selCh = document.getElementById('selChapter');
  selCh.innerHTML = chs.map(function(ch) {
    return '<option value="' + ch.id + '"' + (STATE.learnChapterId === ch.id ? ' selected' : '') + '>' + escapeHTML(ch.title) + '</option>';
  }).join('');
  if (chs.length > 0) {
    // 从进度恢复
    var prog = STATE.progress[STATE.learnMaterialId] || {};
    var lastChId = null;
    for (var cid in prog) { lastChId = cid; }
    STATE.learnChapterId = lastChId || chs[0].id;
    selCh.value = STATE.learnChapterId;
  }
  // 开始学习会话
  startOrResumeSession();
  refreshLearn();
}

function onLearnChapterChange() {
  STATE.learnChapterId = document.getElementById('selChapter').value;
  refreshLearn();
}

function startOrResumeSession() {
  if (STATE.currentSession && STATE.currentSession.materialId === STATE.learnMaterialId) return;
  STATE.currentSession = {
    id: uid('sess'),
    materialId: STATE.learnMaterialId,
    startedAt: nowISO(),
    chapters: [],
    wordsEncountered: {}
  };
}

function setLearnMode(mode) {
  STATE.learnMode = mode;
  document.querySelectorAll('.mode-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  refreshLearn();
}

function refreshLearn() {
  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var ch = chs.find(function(c) { return c.id === STATE.learnChapterId; });
  if (!ch) return;
  var matches = (STATE.matches[STATE.learnMaterialId] && STATE.matches[STATE.learnMaterialId][ch.id]) || [];
  var mode = STATE.learnMode;
  var showWord = document.getElementById('toggleWord').checked;
  var showIpa = document.getElementById('toggleIpa').checked;
  var showMeaning = document.getElementById('toggleMeaning').checked;

  document.getElementById('chTitle').textContent = ch.title;
  var chIdx = chs.findIndex(function(c) { return c.id === ch.id; });
  var prog = STATE.progress[STATE.learnMaterialId] && STATE.progress[STATE.learnMaterialId][ch.id];
  var pct = chs.length > 0 ? Math.round((chIdx + 1) / chs.length * 100) : 0;
  document.getElementById('chProgress').textContent = '第 ' + (chIdx + 1) + ' / ' + chs.length + ' 章 · ' + pct + '%';

  // 每章目标词数输入框同步
  var twInput = document.getElementById('targetWordsInput');
  if (twInput) twInput.value = (ch.targetWords && ch.targetWords >= 1) ? ch.targetWords : 30;
  // 匹配信息条
  var infoEl = document.getElementById('matchInfo');
  if (infoEl) {
    var uniq = {};
    matches.forEach(function(m) { uniq[m.lemma] = true; });
    if (matches.length === 0) {
      infoEl.innerHTML = '本章暂无语境标注。当前词池 ' + buildLearnWordPool().length + ' 词，可点「🔄 重新生成」；若仍为 0，请检查单词书字段映射中「中文释义」列是否正确。';
    } else {
      var unCount = (ch.unmatchedWords || []).length;
      var dist = (ch.paraDist && ch.paraDist.length) ? ch.paraDist : computeParaDist(matches, ch.content.split(/\n\n+/));
      var totalPara = dist.length;
      var blank = 0, di;
      for (di = 0; di < dist.length; di++) { if (dist[di] === 0) blank++; }
      var distTxt = dist.length > 26 ? dist.slice(0, 26).join('/') + '/…' : dist.join('/');
      var line1 = '词池 ' + (ch.poolSize || STATE.words.length) + ' 词（' + learnPoolSummary() + ' · ' + strategyName(getLearnOpts().strategy) + '）· 本章标注 ' + matches.length + ' 处 / ' + Object.keys(uniq).length + ' 个目标词 · 覆盖 ' + (totalPara - blank) + '/' + totalPara + ' 段' + (unCount > 0 ? ' · 未匹配 ' + unCount + ' 词' : '');
      var line2 = '段落分布 ' + distTxt;
      var tips = [];
      if (blank > 0) tips.push('有 ' + blank + ' 段没有可标注的词（多为对话段），可提高「每章目标」或换一本单词书');
      if (ch.capBlocked > 0 && Object.keys(uniq).length < ((ch.targetWords && ch.targetWords >= 1) ? ch.targetWords : 30)) {
        tips.push('受「每段上限 ' + getLearnOpts().perParaMax + ' 处」限制，本章只标了 ' + Object.keys(uniq).length + ' 个词；想要更多请调大上限');
      }
      var line3 = tips.length ? '<div class="mi-hint">' + tips.join('；') + '</div>' : '';
      infoEl.innerHTML = escapeHTML(line1) + '<div style="color:var(--text3)">' + escapeHTML(line2) + '</div>' + line3;
    }
  }

  // 渲染阅读区（基于原始 para 用 token 化方法，避免 substring 错位破坏文本）
  var paragraphs = ch.content.split(/\n\n+/);
  var html = '';
  var sortedMatches = matches.slice().sort(function(a, b) { return a.position - b.position; });

  for (var pi = 0; pi < paragraphs.length; pi++) {
    var para = paragraphs[pi];
    if (!para.trim()) continue;
    // 本段的所有 match（按 position 升序）
    var paraMatches = sortedMatches.filter(function(m) {
      return m.position >= pi * 10000 && m.position < (pi + 1) * 10000;
    });
    var segments = [];
    var cursor = 0;
    for (var mi = 0; mi < paraMatches.length; mi++) {
      var m = paraMatches[mi];
      var posInPara = m.position - pi * 10000;
      var chWord = m.chWord;
      var lemma = m.lemma;
      // 在 para 中从 cursor 开始查找 chWord（避免漏匹配重叠词）
      var actualIdx = para.indexOf(chWord, Math.max(cursor, posInPara));
      if (actualIdx === -1) continue;
      // 输出 cursor 到 actualIdx 之间的原文（保留所有字符）
      segments.push(escapeHTML(para.substring(cursor, actualIdx)));
      // 输出替换的 HTML
      var w = findWord(lemma) || {};
      var dispWord = displayWord(lemma);
      var insertHtml;
      if (mode === 'meaning') {
        // 简洁格式：中文词标绿（英文 [音标] [释义]），内容受开关控制
        var parts = [];
        if (showWord) parts.push('<span class="word-ins" onclick="openWordCard(\'' + escapeHTML(lemma) + '\')">' + escapeHTML(dispWord) + '</span>');
        if (showIpa) {
          var ipa = w.ipa || parseEntryText(lemma).ipa || (CONTEXT_DICT[lemma] || {}).ipa || '';
          if (ipa) parts.push('<span class="ipa-text">' + escapeHTML(ipa.indexOf('/') === 0 ? ipa : '/' + ipa + '/') + '</span>');
        }
        if (showMeaning) {
          var sense = cleanMeaningText(m.sense || w.meaning || '');
          if (sense) parts.push('<span class="meaning-text">' + escapeHTML(sense) + '</span>');
        }
        insertHtml = '<span class="word-zh">' + escapeHTML(chWord) + '</span>' + (parts.length ? '<span class="bracket">（</span>' + parts.join(' ') + '<span class="bracket">）</span>' : '');
      } else if (mode === 'blank') {
        // 填英文：隐藏英文，给中文提示
        insertHtml = '<span class="blank-box" data-lemma="' + escapeHTML(lemma) + '"><input type="text" placeholder="?" onblur="checkBlank(this,\'' + escapeHTML(lemma) + '\')"></span>' + escapeHTML(chWord);
      } else if (mode === 'blankZh') {
        // 填中文：显示英文，隐藏中文词
        insertHtml = '<span class="zh-blank-box" data-answer="' + escapeHTML(chWord) + '"><input type="text" placeholder="?" onblur="checkBlankZh(this,\'' + escapeHTML(chWord) + '\')"></span>（<span class="word-ins" onclick="openWordCard(\'' + escapeHTML(lemma) + '\')">' + escapeHTML(dispWord) + '</span>）';
      } else {
        insertHtml = escapeHTML(chWord);
      }
      segments.push(insertHtml);
      cursor = actualIdx + chWord.length;
      // 记录遇到的词
      if (STATE.currentSession) STATE.currentSession.wordsEncountered[lemma] = (STATE.currentSession.wordsEncountered[lemma] || 0) + 1;
    }
    // 输出最后一段原文
    if (cursor < para.length) segments.push(escapeHTML(para.substring(cursor)));
    html += '<p>' + segments.join('') + '</p>';
  }

  document.getElementById('readingArea').innerHTML = html;

  // 恢复滚动位置
  if (prog && prog.scrollPct) {
    setTimeout(function() {
      var area = document.getElementById('readingArea');
      area.scrollTop = area.scrollHeight * (prog.scrollPct / 100);
    }, 50);
  }

  // 保存进度
  if (!STATE.progress[STATE.learnMaterialId]) STATE.progress[STATE.learnMaterialId] = {};
  if (!STATE.progress[STATE.learnMaterialId][ch.id]) {
    STATE.progress[STATE.learnMaterialId][ch.id] = { mode: mode, scrollPct: 0, paraIdx: 0, updatedAt: nowISO() };
  }
  STATE.progress[STATE.learnMaterialId][ch.id].mode = mode;
  saveLocal();
  scheduleSync();
}

function checkBlank(input, lemma) {
  var target = displayWord(lemma).toLowerCase();
  var val = input.value.trim().toLowerCase();
  var box = input.parentElement;
  if (val === target) {
    box.classList.add('correct');
    box.classList.remove('wrong');
  } else {
    box.classList.add('wrong');
    box.classList.remove('correct');
    // 显示正确答案
    if (!box.querySelector('.blank-answer')) {
      var ans = document.createElement('span');
      ans.className = 'blank-answer';
      ans.textContent = displayWord(lemma);
      box.appendChild(ans);
    }
  }
}

// 填中文：对照原文中文词判定
function checkBlankZh(input, answer) {
  var val = input.value.trim();
  var box = input.parentElement;
  if (val === answer) {
    box.classList.add('correct');
    box.classList.remove('wrong');
  } else {
    box.classList.add('wrong');
    box.classList.remove('correct');
    if (!box.querySelector('.blank-answer')) {
      var ans = document.createElement('span');
      ans.className = 'blank-answer';
      ans.textContent = answer;
      box.appendChild(ans);
    }
  }
}

function onTargetWordsChange() {
  var v = parseInt(document.getElementById('targetWordsInput').value, 10);
  if (!v || v < 5) v = 30;
  if (v > 500) v = 500;
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var ch = chs.find(function(c) { return c.id === STATE.learnChapterId; });
  if (!ch) return;
  ch.targetWords = v;
  saveLocal();
  var count = regenerateMatches(STATE.learnMaterialId, STATE.learnChapterId);
  toast('已按每章 ' + v + ' 词重新生成：共 ' + count + ' 处标注', 'ok');
  refreshLearn();
}

function manualRegenerateMatches() {
  if (!STATE.learnMaterialId || !STATE.learnChapterId) { toast('请先选择章节', 'err'); return; }
  if (buildLearnWordPool().length === 0) { toast('当前词池里没有可用的词，请换一本单词书或调整词池范围', 'err'); return; }
  showConfirm('重新生成语境材料', '将用所有单词书的词为当前章节重新生成匹配（手动修改的会保留），可能覆盖之前的自动匹配。确认？', function() {
    var count = regenerateMatches(STATE.learnMaterialId, STATE.learnChapterId);
    toast('已重新生成 ' + count + ' 个语境匹配', 'ok');
    refreshLearn();
  });
}

function saveScrollPos() {
  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;
  var area = document.getElementById('readingArea');
  var pct = area.scrollHeight > 0 ? Math.round(area.scrollTop / area.scrollHeight * 100) : 0;
  if (!STATE.progress[STATE.learnMaterialId]) STATE.progress[STATE.learnMaterialId] = {};
  STATE.progress[STATE.learnMaterialId][STATE.learnChapterId].scrollPct = pct;
  STATE.progress[STATE.learnMaterialId][STATE.learnChapterId].updatedAt = nowISO();
  saveLocal();
  scheduleSync();
}

function prevChapter() {
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var idx = chs.findIndex(function(c) { return c.id === STATE.learnChapterId; });
  if (idx > 0) {
    STATE.learnChapterId = chs[idx - 1].id;
    document.getElementById('selChapter').value = STATE.learnChapterId;
    refreshLearn();
  }
}
function nextChapter() {
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var idx = chs.findIndex(function(c) { return c.id === STATE.learnChapterId; });
  if (idx < chs.length - 1) {
    STATE.learnChapterId = chs[idx + 1].id;
    document.getElementById('selChapter').value = STATE.learnChapterId;
    refreshLearn();
  }
}

function selectMaterial(matId) {
  STATE.learnMaterialId = matId;
  renderLearnInit();
}

// ===== 词卡 =====
function openWordCard(lemma) {
  var w = findWord(lemma) || {};
  var dictEntry = CONTEXT_DICT[lemma] || {};
  var m = STATE.mastery[lemma] || {};
  var parsed = parseEntryText(lemma); // 历史脏数据兜底
  var dispWord = displayWord(lemma);
  var dispIpa = w.ipa || (parsed.ipa ? '/' + parsed.ipa + '/' : '') || dictEntry.ipa || '';
  var dispPos = w.pos || parsed.pos || dictEntry.pos || '';
  var dispMeaning = cleanMeaningText(w.meaning || '') || dictEntry.meaning || cleanMeaningText(m.sense || '') || parsed.meaning || '';
  // 找当前章节的匹配
  var matches = (STATE.matches[STATE.learnMaterialId] && STATE.matches[STATE.learnMaterialId][STATE.learnChapterId]) || [];
  var context = '';
  for (var i = 0; i < matches.length; i++) {
    if (matches[i].lemma === lemma) { context = matches[i].sentence; break; }
  }
  var inVocab = STATE.vocab.some(function(v) { return v.lemma === lemma; });
  var html = '<div class="wc-word">' + escapeHTML(dispWord) + ' <button class="wc-speak" onclick="speak(\'' + escapeHTML(dispWord) + '\')">🔊 发音</button></div>';
  html += '<div class="wc-ipa">' + escapeHTML(dispIpa) + '</div>';
  if (dispPos) html += '<div class="wc-pos">' + escapeHTML(dispPos) + '</div>';
  html += '<div class="wc-meaning">' + escapeHTML(dispMeaning) + '</div>';
  if (context) html += '<div class="wc-context">语境：<span class="hl">' + escapeHTML(context) + '</span></div>';
  html += '<div class="wc-actions">';
  html += '<button class="btn btn-sm ' + (inVocab ? 'btn-outline' : 'btn-primary') + '" onclick="toggleVocab(\'' + escapeHTML(lemma) + '\')">' + (inVocab ? '✓ 已在生词本' : '+ 加入生词本') + '</button>';
  html += '<button class="btn btn-sm btn-outline" onclick="markMastery(\'' + escapeHTML(lemma) + '\',\'known\')">已掌握</button>';
  html += '<button class="btn btn-sm btn-outline" onclick="markMastery(\'' + escapeHTML(lemma) + '\',\'fuzzy\')">模糊</button>';
  html += '<button class="btn btn-sm btn-outline" onclick="markMastery(\'' + escapeHTML(lemma) + '\',\'unknown\')">不认识</button>';
  html += '</div>';
  document.getElementById('wordCardContent').innerHTML = html;
  document.getElementById('wordCardModal').classList.add('show');
}
function closeWordCard() { document.getElementById('wordCardModal').classList.remove('show'); }

function toggleVocab(lemma) {
  var idx = STATE.vocab.findIndex(function(v) { return v.lemma === lemma; });
  if (idx >= 0) {
    STATE.vocab.splice(idx, 1);
    toast('已移出生词本', 'ok');
  } else {
    addToVocab(lemma);
    toast('已加入生词本', 'ok');
  }
  saveLocal();
  openWordCard(lemma);
}

function markMastery(lemma, status) {
  if (!STATE.mastery[lemma]) STATE.mastery[lemma] = { status: 'unknown', attempts: 0, correct: 0, wrong: 0, level: 0, errorStreakToday: 0, materialId: STATE.learnMaterialId };
  STATE.mastery[lemma].status = status;
  saveLocal();
  syncMasteryToCloud(lemma);
  toast('已标记为：' + (status === 'known' ? '已掌握' : status === 'fuzzy' ? '模糊' : '不认识'), 'ok');
  closeWordCard();
}

// ===== 结束学习会话 =====
function endSession() {
  if (!STATE.currentSession) { navTo('dashboard'); return; }
  var sess = STATE.currentSession;
  sess.endedAt = nowISO();
  var durMs = new Date(sess.endedAt) - new Date(sess.startedAt);
  sess.durationMin = Math.round(durMs / 60000);
  var chs = STATE.chapters[sess.materialId] || [];
  var chIdx = chs.findIndex(function(c) { return c.id === STATE.learnChapterId; });
  sess.chapters = chIdx >= 0 ? chs[chIdx].title : '';
  var wordsList = Object.keys(sess.wordsEncountered).map(function(lemma) {
    return { lemma: lemma, count: sess.wordsEncountered[lemma] };
  });
  sess.wordsCount = wordsList.length;
  STATE.sessions.push(sess);
  saveLocal();
  syncSessionToCloud(sess);
  STATE.currentSession = null;

  // 生成报告
  var mat = STATE.materials.find(function(m) { return m.id === sess.materialId; });
  var html = '<div class="report-card"><h3>学习时长</h3><div class="report-stats"><div class="report-stat"><div class="v">' + sess.durationMin + '</div><div class="l">分钟</div></div><div class="report-stat"><div class="v">' + (chIdx+1) + '/' + chs.length + '</div><div class="l">章节进度</div></div><div class="report-stat"><div class="v">' + wordsList.length + '</div><div class="l">遇到单词</div></div></div></div>';
  html += '<div class="report-card"><h3>本次词汇</h3>';
  wordsList.forEach(function(item) {
    var w = findWord(item.lemma) || {};
    var m = STATE.mastery[item.lemma] || {};
    html += '<div class="report-word"><div><span class="en">' + escapeHTML(displayWord(item.lemma)) + '</span> <span class="zh">— ' + escapeHTML(cleanMeaningText(w.meaning || '')) + '</span></div><span class="cnt">出现 ' + item.count + ' 次</span><div class="mark-btns">';
    html += '<button class="mark-btn known ' + (m.status==='known'?'active':'') + '" onclick="markMastery(\'' + escapeHTML(item.lemma) + '\',\'known\')">已掌握</button>';
    html += '<button class="mark-btn fuzzy ' + (m.status==='fuzzy'?'active':'') + '" onclick="markMastery(\'' + escapeHTML(item.lemma) + '\',\'fuzzy\')">模糊</button>';
    html += '<button class="mark-btn unknown ' + (m.status==='unknown'?'active':'') + '" onclick="markMastery(\'' + escapeHTML(item.lemma) + '\',\'unknown\')">不认识</button>';
    html += '</div></div>';
  });
  html += '</div>';
  document.getElementById('reportBody').innerHTML = html;
  document.getElementById('reportModal').classList.add('show');

  // 构建测试队列
  STATE.testQueue = wordsList.map(function(item) { return item.lemma; });
  STATE.testIdx = 0;
  STATE.testRound = 1;
  STATE.pendingRound2 = [];
  STATE.wrongCounts = {};
}

// ===== 测试页 =====
function renderTestInit() {
  if (STATE.testQueue.length === 0) {
    document.getElementById('testEmpty').classList.remove('hidden');
    document.getElementById('testContent').classList.add('hidden');
    return;
  }
  document.getElementById('testEmpty').classList.add('hidden');
  document.getElementById('testContent').classList.remove('hidden');
  renderTestQuestion();
}

function renderTestQuestion() {
  var total = STATE.testQueue.length;
  var idx = STATE.testIdx;
  if (idx >= total) {
    // 全部完成
    document.getElementById('testCard').innerHTML = '<div style="text-align:center;padding:20px"><h3>🎉 测试完成</h3><p style="color:var(--text3);margin:8px 0">本轮共测试 ' + total + ' 词</p><button class="btn btn-primary" onclick="navTo(\'review\')">查看复习队列</button></div>';
    document.getElementById('testBarFill').style.width = '100%';
    document.getElementById('testCount').textContent = total + ' / ' + total;
    return;
  }
  var lemma = STATE.testQueue[idx];
  var w = findWord(lemma) || {};
  var dictEntry = CONTEXT_DICT[lemma] || {};
  var parsed = parseEntryText(lemma);                       // 历史脏数据兜底
  var dispWord = displayWord(lemma);                        // 题干只显示纯英文
  var dispIpa = w.ipa || (parsed.ipa ? '/' + parsed.ipa + '/' : '') || dictEntry.ipa || '';
  var pct = Math.round(idx / total * 100);
  document.getElementById('testBarFill').style.width = pct + '%';
  document.getElementById('testCount').textContent = (idx + 1) + ' / ' + total;

  var html = '';
  if (STATE.testRound === 1) {
    // 第一轮·四选一：题干=纯英文，选项=纯中文
    var meaning = w.meaning || dictEntry.meaning || parsed.meaning || '';
    var correctOption = primaryChinese(meaning) || meaning;
    correctOption = cleanMeaningText(correctOption) || meaning;
    // 干扰项：取其他单词的纯中文义项（避免重复，剔除含英文/编号的）
    var allMeanings = [];
    var seen = {};
    STATE.words.forEach(function(x) {
      if (x.lemma === lemma) return;
      var m = primaryChinese(x.meaning);
      if (!m || seen[m]) return;
      seen[m] = true;
      if (m !== correctOption) allMeanings.push(m);
    });
    // 随机取3个
    var distractors = [];
    while (distractors.length < 3 && allMeanings.length > 0) {
      var r = Math.floor(Math.random() * allMeanings.length);
      var m = allMeanings.splice(r, 1)[0];
      if (distractors.indexOf(m) === -1) distractors.push(m);
    }
    var options = [correctOption].concat(distractors);
    options.sort(function() { return Math.random() - 0.5; });

    html = '<div class="q-phase">第一轮 · 四选一</div>';
    html += '<div class="q-word">' + escapeHTML(dispWord) + ' <button class="wc-speak" onclick="speak(\'' + escapeHTML(dispWord) + '\')" style="display:inline-flex">🔊</button></div>';
    if (dispIpa) html += '<div class="q-ipa">' + escapeHTML(dispIpa) + '</div>';
    html += '<div class="q-hint">选择正确的中文释义</div>';
    options.forEach(function(opt) {
      html += '<button class="opt-btn" onclick="answerMulti(\'' + escapeHTML(opt) + '\',\'' + escapeHTML(correctOption) + '\',\'' + escapeHTML(lemma) + '\',this)">' + escapeHTML(opt) + '</button>';
    });
    html += '<div class="test-feedback" id="testFeedback"></div>';
  } else {
    // 第二轮·主动回忆（中文默写）：题干=纯英文，答案不显示
    var stdAnswer = cleanMeaningText(w.meaning || dictEntry.meaning || parsed.meaning || '') || '';
    html = '<div class="q-phase">第二轮 · 中文默写</div>';
    html += '<div class="q-word">' + escapeHTML(dispWord) + ' <button class="wc-speak" onclick="speak(\'' + escapeHTML(dispWord) + '\')" style="display:inline-flex">🔊</button></div>';
    if (dispIpa) html += '<div class="q-ipa">' + escapeHTML(dispIpa) + '</div>';
    html += '<div class="q-hint">请写出它的中文释义</div>';
    html += '<input type="text" class="test-input" id="recallInput" placeholder="输入中文..." onkeydown="if(event.key===\'Enter\')checkRecall(\'' + escapeHTML(lemma) + '\')">';
    html += '<div style="margin-top:8px"><button class="btn btn-primary" style="width:100%" onclick="checkRecall(\'' + escapeHTML(lemma) + '\')">提交</button></div>';
    html += '<div class="test-feedback" id="testFeedback"></div>';
  }
  document.getElementById('testCard').innerHTML = html;
}

var currentAnswer = null;
function answerMulti(selected, correct, lemma, btn) {
  var isCorrect = selected === correct;
  // 禁用所有按钮
  document.querySelectorAll('.opt-btn').forEach(function(b) {
    b.disabled = true;
    if (b.textContent === correct) b.classList.add('correct');
    else if (b === btn && !isCorrect) b.classList.add('wrong');
  });
  var fb = document.getElementById('testFeedback');
  if (isCorrect) {
    fb.className = 'test-feedback show ok';
    fb.textContent = '✓ 正确！';
  } else {
    fb.className = 'test-feedback show err';
    fb.textContent = '✗ 正确答案：' + correct;
  }
  // 记录答题
  recordAnswer(lemma, 'r1', 'q_multi', isCorrect, selected, correct);
  // 进入第二轮队列或队尾
  setTimeout(function() {
    if (isCorrect) {
      // 本轮不再立即考该词，进入第二轮（中文默写）队列，等第一轮全部走完再考
      STATE.pendingRound2.push(lemma);
    } else {
      // 队尾（同一词最多重测一次，避免答错死循环）
      STATE.wrongCounts[lemma] = (STATE.wrongCounts[lemma] || 0) + 1;
      if (STATE.wrongCounts[lemma] < 2) STATE.testQueue.push(lemma);
    }
    STATE.testIdx++;
    STATE.testRound = 1;
    // 第一轮走完 → 切换到第二轮（中文默写）
    if (STATE.testIdx >= STATE.testQueue.length) {
      STATE.testQueue = (STATE.pendingRound2 || []).slice();
      STATE.pendingRound2 = [];
      STATE.testQueue.sort(function() { return Math.random() - 0.5; }); // 打乱第二轮顺序
      STATE.testIdx = 0;
      STATE.testRound = 2;
      if (STATE.testQueue.length === 0) { renderTestQuestion(); return; }
    }
    renderTestQuestion();
  }, 1200);
}

function checkRecall(lemma) {
  var input = document.getElementById('recallInput');
  var userAns = input.value.trim();
  if (!userAns) { toast('请输入答案', 'err'); return; }
  var w = findWord(lemma) || {};
  var dictEntry = CONTEXT_DICT[lemma] || {};
  var stdAnswer = cleanMeaningText(w.meaning || dictEntry.meaning || '') || '';
  // 检查同义答案
  var synonyms = STATE.synonyms[lemma] || [];
  var accepted = false;
  // 标准释义关键词匹配
  var stdKeywords = stdAnswer.split(/[；;,，\s]/).filter(function(s) { return s.length >= 2; });
  var matchedKeywords = stdKeywords.filter(function(kw) { return userAns.indexOf(kw) >= 0; });
  // 同义答案匹配
  synonyms.forEach(function(syn) {
    if (syn.accepted && userAns.indexOf(syn.answer) >= 0) accepted = true;
  });
  var isCorrect = accepted || matchedKeywords.length >= 1 && matchedKeywords.length >= Math.ceil(stdKeywords.length * 0.5);

  var fb = document.getElementById('testFeedback');
  if (isCorrect) {
    fb.className = 'test-feedback show ok';
    fb.textContent = '✓ 正确！';
    recordAnswer(lemma, 'r2', 'q_recall', true, userAns, stdAnswer);
    setTimeout(function() {
      STATE.testIdx++;
      renderTestQuestion();   // 保持第二轮
    }, 1200);
  } else {
    // 低置信度判断
    var lowConfidence = matchedKeywords.length > 0 && matchedKeywords.length < Math.ceil(stdKeywords.length * 0.5);
    if (lowConfidence) {
      fb.className = 'test-feedback show maybe';
      fb.innerHTML = '🤔 可能正确？标准答案：' + escapeHTML(stdAnswer) + '<br><button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="judgeRecall(true,\'' + escapeHTML(lemma) + '\',\'' + escapeHTML(userAns) + '\',\'' + escapeHTML(stdAnswer) + '\')">算正确</button> <button class="btn btn-sm btn-danger" onclick="judgeRecall(false,\'' + escapeHTML(lemma) + '\',\'' + escapeHTML(userAns) + '\',\'' + escapeHTML(stdAnswer) + '\')">算错误</button>';
    } else {
      fb.className = 'test-feedback show err';
      fb.innerHTML = '✗ 正确答案：' + escapeHTML(stdAnswer);
      recordAnswer(lemma, 'r2', 'q_recall', false, userAns, stdAnswer);
      setTimeout(function() {
        // 加入生词本；此词仍留在本轮（第二轮）队尾重测一次，最多重测一次避免循环
        addToVocab(lemma);
        STATE.wrongCounts[lemma] = (STATE.wrongCounts[lemma] || 0) + 1;
        if (STATE.wrongCounts[lemma] < 2) STATE.testQueue.push(lemma);
        STATE.testIdx++;
        renderTestQuestion();   // 保持第二轮
      }, 1500);
    }
  }
}

function judgeRecall(judgedCorrect, lemma, userAns, stdAnswer) {
  // 保存用户判定
  if (!STATE.synonyms[lemma]) STATE.synonyms[lemma] = [];
  STATE.synonyms[lemma].push({ answer: userAns, accepted: judgedCorrect, count: 1, _id: uid('syn') });
  recordAnswer(lemma, 'r2', 'q_recall', judgedCorrect, userAns, stdAnswer);
  saveLocal();
  if (judgedCorrect) {
    STATE.testIdx++;
  } else {
    addToVocab(lemma);
    STATE.wrongCounts[lemma] = (STATE.wrongCounts[lemma] || 0) + 1;
    if (STATE.wrongCounts[lemma] < 2) STATE.testQueue.push(lemma);
    STATE.testIdx++;
  }
  renderTestQuestion();   // 保持第二轮
}

function recordAnswer(lemma, round, qType, correct, userInput, stdAnswer) {
  var answer = { sessionId: STATE.sessions.length > 0 ? STATE.sessions[STATE.sessions.length-1].id : '', lemma: lemma, round: round, qType: qType, correct: correct, userInput: userInput, stdAnswer: stdAnswer, ts: nowISO() };
  STATE.answers.push(answer);
  // 更新掌握状态
  advanceReview(lemma, correct);
  // 同步到云端
  syncAnswerToCloud(answer);
  syncMasteryToCloud(lemma);
  saveLocal();
}

// ===== 复习页 =====
function renderReview() {
  var today = todayStr();
  var due = STATE.reviewQueue.filter(function(r) { return r.nextReviewDate && r.nextReviewDate.slice(0,10) <= today; });
  var total = STATE.reviewQueue.length;
  var mastered = Object.values(STATE.mastery).filter(function(m) { return m.status === 'known'; }).length;

  var html = '<div class="dash-grid"><div class="dash-card"><div class="num orange">' + due.length + '</div><div class="lbl">今日待复习</div></div><div class="dash-card"><div class="num">' + total + '</div><div class="lbl">总复习词</div></div><div class="dash-card"><div class="num">' + mastered + '</div><div class="lbl">已掌握</div></div></div>';
  document.getElementById('reviewStats').innerHTML = html;

  if (due.length === 0) {
    document.getElementById('reviewContent').innerHTML = '<div class="empty-state"><p>🎉 今日无待复习单词</p></div>';
    document.getElementById('btnStartReview').style.display = 'none';
    return;
  }
  document.getElementById('btnStartReview').style.display = 'inline-flex';
  document.getElementById('reviewContent').innerHTML = '<div class="card"><p style="font-size:14px;color:var(--text2)">今日有 <b>' + due.length + '</b> 个单词需要复习，点击「开始今日复习」开始。</p></div>';
}

var reviewIdx = 0;
function startReview() {
  var today = todayStr();
  var due = STATE.reviewQueue.filter(function(r) { return r.nextReviewDate && r.nextReviewDate.slice(0,10) <= today; });
  if (due.length === 0) { toast('今日无待复习', 'ok'); return; }
  reviewIdx = 0;
  renderReviewQuestion(due);
}

function renderReviewQuestion(queue) {
  if (reviewIdx >= queue.length) {
    document.getElementById('reviewContent').innerHTML = '<div class="empty-state"><p>🎉 复习完成</p><button class="btn btn-primary" onclick="navTo(\'dashboard\')">返回首页</button></div>';
    return;
  }
  var item = queue[reviewIdx];
  var w = findWord(item.lemma) || {};
  var html = '<div class="test-card"><div class="q-word">' + escapeHTML(item.lemma) + ' <button class="wc-speak" onclick="speak(\'' + escapeHTML(item.lemma) + '\')" style="display:inline-flex">🔊</button></div>';
  html += '<div class="q-ipa">' + escapeHTML(w.ipa || '') + '</div>';
  html += '<div class="q-hint">你还记得这个单词吗？</div>';
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">';
  html += '<button class="btn btn-primary" style="flex:1;min-width:80px" onclick="reviewAnswer(\'' + escapeHTML(item.lemma) + '\',\'known\',true)">认识</button>';
  html += '<button class="btn btn-outline" style="flex:1;min-width:80px;background:var(--orange-l);color:var(--orange)" onclick="reviewAnswer(\'' + escapeHTML(item.lemma) + '\',\'fuzzy\',false)">模糊</button>';
  html += '<button class="btn btn-danger" style="flex:1;min-width:80px" onclick="reviewAnswer(\'' + escapeHTML(item.lemma) + '\',\'unknown\',false)">不认识</button>';
  html += '<button class="btn btn-outline" style="flex:1;min-width:80px" onclick="reviewAnswer(\'' + escapeHTML(item.lemma) + '\',\'skip\',false)">跳过</button>';
  html += '</div>';
  html += '<div style="margin-top:12px;font-size:13px;color:var(--text3);text-align:center">当前等级：L' + item.level + ' · 下次复习：' + fmtDate(item.nextReviewDate) + '</div>';
  html += '<div style="margin-top:8px;font-size:14px;color:var(--green-d);text-align:center">释义：' + escapeHTML(w.meaning || '') + '</div>';
  html += '</div>';
  document.getElementById('reviewContent').innerHTML = html;
}

function reviewAnswer(lemma, result, correct) {
  if (result !== 'skip') {
    advanceReview(lemma, correct);
    // 更新复习队列
    var item = STATE.reviewQueue.find(function(r) { return r.lemma === lemma; });
    if (item) {
      item.level = STATE.mastery[lemma].level;
      item.nextReviewDate = STATE.mastery[lemma].nextReview;
      item.lastResult = result;
      syncReviewToCloud(item);
    }
    syncMasteryToCloud(lemma);
  }
  saveLocal();
  reviewIdx++;
  startReview();
}

// ===== 词表 =====
function renderVocab() {
  // 填充筛选下拉
  var selMat = document.getElementById('vocabFilterMat');
  if (selMat.options.length <= 1) {
    STATE.materials.forEach(function(m) {
      var opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.title;
      selMat.appendChild(opt);
    });
  }
  var selCh = document.getElementById('vocabFilterCh');
  var matId = selMat.value;
  selCh.innerHTML = '<option value="">全部章节</option>';
  if (matId) {
    var chs = STATE.chapters[matId] || [];
    chs.forEach(function(ch) {
      var opt = document.createElement('option');
      opt.value = ch.id; opt.textContent = ch.title;
      selCh.appendChild(opt);
    });
  }

  // 收集本资料/章节的词
  var words = [];
  if (matId) {
    var chs = STATE.chapters[matId] || [];
    var chId = selCh.value;
    var allMatches = [];
    if (chId) {
      allMatches = (STATE.matches[matId] && STATE.matches[matId][chId]) || [];
    } else {
      chs.forEach(function(ch) {
        var ms = (STATE.matches[matId] && STATE.matches[matId][ch.id]) || [];
        allMatches = allMatches.concat(ms);
      });
    }
    // 按 lemma 去重并统计出现次数
    var lemmaCount = {};
    allMatches.forEach(function(m) {
      if (!lemmaCount[m.lemma]) lemmaCount[m.lemma] = { count: 0, lemma: m.lemma, sense: m.sense };
      lemmaCount[m.lemma].count++;
    });
    words = Object.values(lemmaCount);
  } else {
    words = STATE.words.map(function(w) {
      return { lemma: w.lemma, sense: w.meaning, count: 0 };
    });
  }

  // 状态筛选
  var statusFilter = document.getElementById('vocabFilterStatus').value;
  if (statusFilter) {
    words = words.filter(function(w) {
      var m = STATE.mastery[w.lemma] || {};
      return m.status === statusFilter;
    });
  }

  // 隐藏/显示
  var hideWord = document.getElementById('toggleHideWord').checked;
  var hideIpa = document.getElementById('toggleHideIpa').checked;
  var hideMeaning = document.getElementById('toggleHideMeaning').checked;

  var html = '<table class="vocab-table"><thead><tr><th>单词</th><th>音标</th><th>词性</th><th>释义</th><th>次数</th><th>状态</th><th>下次复习</th></tr></thead><tbody>';
  words.forEach(function(w) {
    var wd = findWord(w.lemma) || {};
    var m = STATE.mastery[w.lemma] || {};
    var statusTag = m.status === 'known' ? '<span class="tag tag-green">已掌握</span>' : m.status === 'fuzzy' ? '<span class="tag tag-orange">模糊</span>' : m.status === 'unknown' ? '<span class="tag tag-red">不认识</span>' : '<span class="tag tag-gray">未学</span>';
    html += '<tr>';
    html += '<td class="col-word ' + (hideWord ? 'hide-col' : '') + '" onclick="this.classList.toggle(\'hide-col\')">' + escapeHTML(w.lemma) + '</td>';
    html += '<td class="col-ipa ' + (hideIpa ? 'hide-col' : '') + '" onclick="this.classList.toggle(\'hide-col\')">' + escapeHTML(wd.ipa || '') + '</td>';
    html += '<td>' + escapeHTML(wd.pos || '') + '</td>';
    html += '<td ' + (hideMeaning ? 'class="hide-col"' : '') + ' onclick="this.classList.toggle(\'hide-col\')">' + escapeHTML(w.sense || wd.meaning || '') + '</td>';
    html += '<td class="num-cell">' + (w.count || 0) + '</td>';
    html += '<td>' + statusTag + '</td>';
    html += '<td>' + fmtDate(m.nextReview) + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('vocabTableWrap').innerHTML = html;
  document.getElementById('mingxieWrap').classList.add('hidden');
}

var mingxieMode = null;
function toggleMingxie() {
  var wrap = document.getElementById('mingxieWrap');
  if (wrap.classList.contains('hidden')) {
    // 显示默写
    mingxieMode = mingxieMode === 'en2zh' ? 'zh2en' : 'en2zh';
    renderMingxie();
  } else {
    wrap.classList.add('hidden');
  }
}
function renderMingxie() {
  var wrap = document.getElementById('mingxieWrap');
  var words = STATE.words.map(function(w) { return { lemma: w.lemma, ipa: w.ipa, pos: w.pos, meaning: w.meaning }; });
  if (words.length === 0) { wrap.innerHTML = '<p>暂无单词</p>'; return; }
  var html = '<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn btn-sm ' + (mingxieMode==='en2zh'?'btn-primary':'btn-outline') + '" onclick="mingxieMode=\'en2zh\';renderMingxie()">看英文写中文</button><button class="btn btn-sm ' + (mingxieMode==='zh2en'?'btn-primary':'btn-outline') + '" onclick="mingxieMode=\'zh2en\';renderMingxie()">看中文写英文</button><button class="btn btn-sm btn-outline" onclick="checkMingxie()">检查答案</button></div>';
  words.forEach(function(w, i) {
    if (mingxieMode === 'en2zh') {
      html += '<div class="mingxie-item"><div class="prompt">' + escapeHTML(w.lemma) + ' <span style="color:var(--text3);font-size:13px">' + escapeHTML(w.ipa||'') + '</span></div><input type="text" data-idx="' + i + '" data-std="' + escapeHTML(w.meaning||'') + '" placeholder="输入中文释义"><div class="answer">正确：' + escapeHTML(w.meaning||'') + '</div></div>';
    } else {
      html += '<div class="mingxie-item"><div class="prompt">' + escapeHTML(w.meaning||'') + '</div><input type="text" data-idx="' + i + '" data-std="' + escapeHTML(w.lemma) + '" placeholder="输入英文单词"><div class="answer">正确：' + escapeHTML(w.lemma) + '</div></div>';
    }
  });
  wrap.innerHTML = html;
  wrap.classList.remove('hidden');
  document.getElementById('vocabTableWrap').classList.add('hidden');
}
function checkMingxie() {
  var inputs = document.querySelectorAll('#mingxieWrap input[data-idx]');
  inputs.forEach(function(inp) {
    var std = inp.dataset.std;
    var val = inp.value.trim();
    var ans = inp.parentElement.querySelector('.answer');
    if (val.toLowerCase() === std.toLowerCase()) {
      inp.classList.add('correct'); inp.classList.remove('wrong');
      ans.classList.remove('show');
    } else {
      inp.classList.add('wrong'); inp.classList.remove('correct');
      ans.classList.add('show');
    }
  });
}

// ===== 错词 =====
function renderWrong() {
  var selMat = document.getElementById('wrongFilterMat');
  if (selMat.options.length <= 1) {
    STATE.materials.forEach(function(m) {
      var opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.title;
      selMat.appendChild(opt);
    });
  }
  var matId = selMat.value;
  var statusFilter = document.getElementById('wrongFilterStatus').value;

  var wrongWords = Object.values(STATE.mastery).filter(function(m) {
    if (statusFilter && m.status !== statusFilter) return false;
    if (matId && m.materialId !== matId) return false;
    return m.wrong > 0 || m.status === 'unknown' || m.status === 'fuzzy';
  });

  var html = '<table class="vocab-table"><thead><tr><th>单词</th><th>尝试</th><th>正确</th><th>错误</th><th>正确率</th><th>最近答案</th><th>最近复习</th><th>下次复习</th></tr></thead><tbody>';
  wrongWords.forEach(function(m) {
    var w = findWord(Object.keys(STATE.mastery).find(function(k) { return STATE.mastery[k] === m; })) || {};
    html += '<tr><td class="col-word">' + escapeHTML(Object.keys(STATE.mastery).find(function(k) { return STATE.mastery[k] === m; }) || '') + '</td>';
    html += '<td class="num-cell">' + m.attempts + '</td><td class="num-cell">' + m.correct + '</td><td class="num-cell">' + m.wrong + '</td>';
    html += '<td class="num-cell">' + Math.round((m.rate||0)*100) + '%</td><td>' + escapeHTML(m.lastAnswer||'') + '</td>';
    html += '<td>' + fmtDate(m.lastReview) + '</td><td>' + fmtDate(m.nextReview) + '</td></tr>';
  });
  html += '</tbody></table>';
  if (wrongWords.length === 0) html = '<div class="empty-state"><p>暂无错词</p></div>';
  document.getElementById('wrongTableWrap').innerHTML = html;
}

// ===== 导出 =====
function exportVocabCSV() {
  var words = STATE.words;
  var csv = '\ufeff单词,词性,音标,中文释义,出现次数,掌握等级,正确率,下次复习\n';
  words.forEach(function(w) {
    var m = STATE.mastery[w.lemma] || {};
    var count = 0;
    Object.keys(STATE.matches).forEach(function(mid) {
      Object.keys(STATE.matches[mid]).forEach(function(cid) {
        STATE.matches[mid][cid].forEach(function(mt) { if (mt.lemma === w.lemma) count++; });
      });
    });
    csv += [w.lemma, w.pos, w.ipa, w.meaning, count, m.status||'未学', Math.round((m.rate||0)*100)+'%', fmtDate(m.nextReview)].join(',') + '\n';
  });
  downloadCSV(csv, 'vocab_export.csv');
}

function exportWrongCSV() {
  var csv = '\ufeff单词,尝试次数,正确次数,错误次数,正确率,最近答案,最近复习,下次复习\n';
  Object.keys(STATE.mastery).forEach(function(lemma) {
    var m = STATE.mastery[lemma];
    if (m.wrong > 0 || m.status === 'unknown' || m.status === 'fuzzy') {
      csv += [lemma, m.attempts, m.correct, m.wrong, Math.round((m.rate||0)*100)+'%', m.lastAnswer||'', fmtDate(m.lastReview), fmtDate(m.nextReview)].join(',') + '\n';
    }
  });
  downloadCSV(csv, 'wrong_words.csv');
}

function downloadCSV(csv, filename) {
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('已导出 ' + filename, 'ok');
}

function exportAllJSON() {
  var data = {
    profileId: STATE.profileId,
    nickname: STATE.nickname,
    exportedAt: nowISO(),
    materials: STATE.materials,
    wordbooks: STATE.wordbooks,
    words: STATE.words,
    chapters: STATE.chapters,
    matches: STATE.matches,
    progress: STATE.progress,
    sessions: STATE.sessions,
    mastery: STATE.mastery,
    vocab: STATE.vocab,
    synonyms: STATE.synonyms,
    answers: STATE.answers,
    reviewQueue: STATE.reviewQueue
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'ctx_vocab_backup_' + todayStr() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('已导出全部数据', 'ok');
}

function importAllJSON(files) {
  if (!files || files.length === 0) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      showConfirm('导入数据', '将覆盖当前所有数据，不可恢复。确认导入？', function() {
        STATE.materials = data.materials || [];
        STATE.wordbooks = data.wordbooks || [];
        STATE.words = data.words || [];
        STATE.chapters = data.chapters || {};
        STATE.matches = data.matches || {};
        STATE.progress = data.progress || {};
        STATE.sessions = data.sessions || [];
        STATE.mastery = data.mastery || {};
        STATE.vocab = data.vocab || [];
        STATE.synonyms = data.synonyms || {};
        STATE.answers = data.answers || [];
        STATE.reviewQueue = data.reviewQueue || [];
        saveLocal();
        // 同步到云端
        if (STATE.cloudReady) {
          STATE.materials.forEach(syncMaterialToCloud);
          STATE.wordbooks.forEach(syncWordbookToCloud);
          STATE.words.forEach(syncWordToCloud);
        }
        refreshAll();
        toast('导入成功', 'ok');
      });
    } catch (err) {
      toast('文件格式错误', 'err');
    }
  };
  reader.readAsText(files[0]);
}

function clearAllData() {
  showConfirm('清空全部数据', '⚠️ 此操作不可恢复！所有学习记录、单词、进度都将被清除。确认清空？', function() {
    STATE.materials = []; STATE.wordbooks = []; STATE.words = []; STATE.chapters = {}; STATE.matches = {};
    STATE.progress = {}; STATE.sessions = []; STATE.mastery = {}; STATE.vocab = []; STATE.synonyms = {};
    STATE.answers = []; STATE.reviewQueue = [];
    saveLocal();
    toast('已清空', 'ok');
    refreshAll();
  });
}

// 下载当前 HTML 到本地（脱离 WorkBuddy 平台），并把当前账号+全部数据打包进文件
function downloadLocalHtml() {
  // 收集本工作台的全部 localStorage 数据（账号、资料、单词书、进度等）
  var exportData = {};
  var n = 0;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(LS_PREFIX) === 0) { exportData[k] = localStorage.getItem(k); n++; }
    }
  } catch (e) { console.warn('collect LS err', e); }
  fetch(window.location.href)
    .then(function(r) { return r.text(); })
    .then(function(fetched) {
      // 若拿到的不是工作台页面（如被平台重定向到登录页），改用当前页面快照
      var html = fetched.indexOf('authScreen') !== -1 ? fetched : '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
      // 注入数据脚本（在 </head> 前）；< 转义避免提前闭合 script 标签
      var inject = '<script>window.__EMBEDDED_LS__ = ' + JSON.stringify(exportData).replace(/</g, '\\u003c') + ';<\/script>\n</head>';
      var out = html.indexOf('</head>') !== -1 ? html.replace('</head>', inject) : html;
      var blob = new Blob([out], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '语境背单词工作台_本地版.html';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
      toast('已下载本地版（已打包你的 ' + n + ' 项数据）。在浏览器下载记录（Ctrl+J）里可找到文件，双击即可离线使用，账号密码与现在相同', 'ok');
    })
    .catch(function() {
      toast('自动下载失败：请按 Ctrl+S 用「另存为」保存本页面（保存类型选“网页，仅 HTML”）', 'err');
    });
}

// ===== 统一刷新入口（铁律 9）=====
function refreshAll() {
  renderDashboard();
  if (STATE.view === 'materials') renderMaterials();
  if (STATE.view === 'learn') renderLearnInit();
  if (STATE.view === 'test') renderTestInit();
  if (STATE.view === 'review') renderReview();
  if (STATE.view === 'vocab') renderVocab();
  if (STATE.view === 'wrong') renderWrong();
  if (STATE.view === 'settings') updateDiag();
  updateSyncBadge();
}

// ===== 拖拽上传 =====
function setupDragDrop() {
  ['matUploadZone', 'wbUploadZone'].forEach(function(zoneId) {
    var zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', function() { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', function(e) {
      e.preventDefault();
      zone.classList.remove('dragover');
      var files = e.dataTransfer.files;
      var type = zoneId === 'matUploadZone' ? 'material' : 'wordbook';
      handleFileUpload(files, type);
    });
  });
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', function() {
  // 检查已登录用户
  var cur = LS.get('current_user');
  if (cur && cur.profileId) {
    STATE.profileId = cur.profileId;
    STATE.nickname = cur.nick;
    enterApp();
  }
  setupDragDrop();
  // 自动同步状态
  STATE.autoSync = LS.get('autoSync', true);
  var autoSyncEl = document.getElementById('autoSync');
  if (autoSyncEl) autoSyncEl.checked = STATE.autoSync;
});
