# -*- coding: utf-8 -*-
"""数据安全修复包（第 3~7 条）：对账合并 / 账号ID迁移真合并 / 孤立单词保护 / 示例注入幂等 / 导入配额预检。

用法: python patch_fixes.py --input <patch_rescue 的输出.html> --output <输出.html>

设计说明：
  这个补丁改的是「已存在的函数体」，逐字面量匹配太脆（函数动辄上百行），
  所以对 loadDataForProfile / migrateProfileId 这两个大函数采用**区间定位**（按函数首尾标记切出整段再改），
  其余小改动才用逐字面量替换。所有锚点都做「唯一性断言」，锚点漂了就报错而不是静默改坏。
"""
import argparse, io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


# ---------- 模块插入点（与 patch_rescue.py 同一个锚点，插在救援模块之前）----------
MODULE_ANCHOR = '/* ===== 内置词书《六级词书》 ===== */'

# ---------- 区间定位标记 ----------
LOAD_START = 'function loadDataForProfile(profileId) {'
LOAD_END = '// ===== 资料体积预算：资料库单行 1MB 上限 ====='
MIG_START = 'function migrateProfileId(oldId, newId, silent) {'

# ---------- 第 3 条：云端查询包装（插在 localSnap 之后）----------
Q_OLD = """  var localSnap = null;
  if (STATE.cloudReady) {"""
Q_NEW = """  var localSnap = null;
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
  if (STATE.cloudReady) {"""

# ---------- 第 3 条：标记云端单词书已成功加载 ----------
WB_FLAG_OLD = '      STATE.wordbooks = rows.map(function(r) {'
WB_FLAG_NEW = """      CLOUD_WB_LOADED = true;   // 单词书成功返回，才允许做"孤立单词"判定
      STATE.wordbooks = rows.map(function(r) {"""

# ---------- 第 3 条：本地快照本身也得把三类补上（否则对账时根本没数据可比）----------
SNAP_OLD = """      vocab: LS.get('vocab_' + profileId, []),
      reviewQueue: LS.get('review_' + profileId, [])
    };"""
SNAP_NEW = """      vocab: LS.get('vocab_' + profileId, []),
      reviewQueue: LS.get('review_' + profileId, []),
      // 这三类此前压根没进快照，所以对账时"本地有云端没有"根本比不出来 —— 补上
      sessions: LS.get('sessions_' + profileId, []),
      answers: LS.get('answers_' + profileId, []),
      synonyms: LS.get('synonyms_' + profileId, {})
    };"""

# ---------- 第 3 条：加载收尾改为「回填失败类 + 对账合并」----------
TAIL_OLD = '    if (localSnap) mergeLocalSnapshot(localSnap);'
TAIL_NEW = """    if (localSnap) {
      restoreFailedLoads(localSnap, _qFail);   // 云端查询失败的类别 → 本地整类回填
      mergeLocalSnapshot(localSnap);           // 其余类别 → 本地独有的补回并补推云端
    }"""

# ---------- 第 3 条：mergeLocalSnapshot 补全漏掉的三类 ----------
MERGE_ADD = """
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
  });"""

# ---------- 第 5 条：孤立单词不再删除，改为补建书 ----------
CLEAN_NEW = """// 处理「孤立单词」：所属单词书不在 STATE 里的单词记录。
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
}"""

# ---------- 第 4 条：migrateProfileId 真合并 ----------
MIG_NEW = """// 把旧 profileId 的所有 localStorage 数据**真合并**到新 profileId。
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
}"""

# ---------- 第 6 条：示例注入幂等 ----------
SAMPLE_OLD = """        var seenKey = 'seen_' + STATE.profileId;
        // 仅该账号在本设备首次进入且确实无数据时才注入示例，避免云端加载异常时污染数据
        if (STATE.materials.length === 0 && STATE.wordbooks.length === 0 && !LS.get(seenKey, false)) {
          injectSampleData();
        }
        LS.set(seenKey, true);"""
SAMPLE_NEW = """        // 标记「该账号在本机已经有过云端数据」—— 一旦有过，就永远不再注入示例
        if (typeof markCloudDataSeen === 'function') markCloudDataSeen();
        // 示例数据只允许注入一次，且必须满足「本机从没见过该账号的任何数据」。
        // 旧逻辑用 seen_<profileId> 作标记，而 enterApp 每次都跑 resolveAccountProfileId
        // （规则「哪边 materials 多，身份就在哪边」）→ ID 一漂移标记就失效 → 示例数据被反复注入并推到云端，
        // 表现正是「我删掉的示例书刷新后又回来了」。现在标记绑定昵称，与 ID 漂移解耦。
        var allowSample = (typeof sampleInjectAllowed === 'function')
          ? sampleInjectAllowed()
          : (STATE.materials.length === 0 && STATE.wordbooks.length === 0);
        if (allowSample) { injectSampleData(); }"""

SAMPLE_FN_OLD = """function injectSampleData() {
  var matId = uid('mat');"""
SAMPLE_FN_NEW = """function injectSampleData() {
  // 先落标记再注入：即使注入中途出错，也不会第二次再来一遍
  if (typeof markSampleInjected === 'function') markSampleInjected();
  var matId = uid('mat');"""

# ---------- 第 7 条：导入前探配额 + 写失败回滚 ----------
IMPORT_OLD = """  wordbook.total = words.length;
  STATE.wordbooks.push(wordbook);
  STATE.words = STATE.words.concat(words);
  saveLocal();
  syncWordbookToCloud(wordbook);"""
IMPORT_NEW = """  wordbook.total = words.length;
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
  syncWordbookToCloud(wordbook);"""


def _fn_span(html, sig):
    """返回函数区间 [start, end)：end 指向函数结尾 '}' 之后的换行处。"""
    s = html.index(sig)
    m = re.search(r'\n\}\n', html[s:])
    if not m:
        raise SystemExit('找不到函数结尾: %s' % sig)
    return s, s + m.end()


def apply(html):
    n = 0

    # ---------- 0. 插入模块代码 ----------
    assert html.count(MODULE_ANCHOR) == 1, '内置词书注释锚点不唯一'
    mod = read(os.path.join(HERE, 'patch_src', 'fixes.js')) + '\n'
    html = html.replace(MODULE_ANCHOR, mod + MODULE_ANCHOR, 1)
    n += 1

    # ---------- 1. loadDataForProfile 区间 ----------
    assert html.count(LOAD_START) == 1, 'loadDataForProfile 起始锚点不唯一'
    assert html.count(LOAD_END) == 1, '资料体积预算注释锚点不唯一'
    s = html.index(LOAD_START)
    e = html.index(LOAD_END)
    seg = html[s:e]

    nq = seg.count('CLOUD.query(')
    assert nq == 13, 'loadDataForProfile 里 CLOUD.query 出现 %d 次（预期 13），锚点异常' % nq
    # 先统一换成包装函数，再插入包装函数本体（顺序反了会把自己的调用也换掉 → 无限递归）
    seg = seg.replace('CLOUD.query(', '_q(')

    assert seg.count(Q_OLD) == 1, 'localSnap 锚点不唯一'
    seg = seg.replace(Q_OLD, Q_NEW, 1)
    n += 1

    assert seg.count(SNAP_OLD) == 1, 'localSnap 快照字段锚点不唯一'
    seg = seg.replace(SNAP_OLD, SNAP_NEW, 1)
    n += 1

    assert seg.count(WB_FLAG_OLD) == 1, 'wordbooks 赋值锚点不唯一'
    seg = seg.replace(WB_FLAG_OLD, WB_FLAG_NEW, 1)
    n += 1

    assert seg.count(TAIL_OLD) == 1, '加载收尾锚点不唯一'
    seg = seg.replace(TAIL_OLD, TAIL_NEW, 1)
    n += 1

    # ---------- 2. cleanupOrphanWords 整函数替换 ----------
    cs = seg.index('function cleanupOrphanWords() {')
    cm = re.search(r'\n\}\n', seg[cs:])
    assert cm, '找不到 cleanupOrphanWords 结尾'
    ce = cs + cm.end()
    seg = seg[:cs] + CLEAN_NEW + '\n' + seg[ce:]
    n += 1

    # ---------- 3. mergeLocalSnapshot 补三类 ----------
    ms = seg.index('function mergeLocalSnapshot(snap) {')
    mm = re.search(r'\n\}', seg[ms:])
    assert mm, '找不到 mergeLocalSnapshot 结尾'
    brace = ms + mm.start()
    seg = seg[:brace] + MERGE_ADD + seg[brace:]
    n += 1

    html = html[:s] + seg + html[e:]

    # ---------- 4. migrateProfileId 整函数替换 ----------
    ms2, me2 = _fn_span(html, MIG_START)
    html = html[:ms2] + MIG_NEW + '\n' + html[me2:]
    n += 1

    # ---------- 5. 示例注入幂等 ----------
    assert html.count(SAMPLE_OLD) == 1, 'enterApp 示例注入锚点不唯一'
    html = html.replace(SAMPLE_OLD, SAMPLE_NEW, 1)
    n += 1
    assert html.count(SAMPLE_FN_OLD) == 1, 'injectSampleData 开头锚点不唯一'
    html = html.replace(SAMPLE_FN_OLD, SAMPLE_FN_NEW, 1)
    n += 1

    # ---------- 6. 导入配额预检 ----------
    assert html.count(IMPORT_OLD) == 1, 'doImportFromFieldMap 保存段锚点不唯一'
    html = html.replace(IMPORT_OLD, IMPORT_NEW, 1)
    n += 1

    return html, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    args = ap.parse_args()
    html = read(args.input)
    out, n = apply(html)
    with io.open(args.output, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print('完成 %d 处替换' % n)
    print('输出 %s (%d 字节)' % (args.output, len(out.encode('utf-8'))))


if __name__ == '__main__':
    main()
