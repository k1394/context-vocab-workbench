# -*- coding: utf-8 -*-
"""示例数据彻底移除 + 删除墓碑 + 多副本删除

改动清单
  1. 模块 ：插入 patch_src/cleanup.js（示例识别、加载期拦截、墓碑、softDeleteCloud）
  2. 加载 ：loadDataForProfile 开头 tombBuild() + legacyPurgeReset()
  3. 加载 ：每个云端查询的 .then(rows) 里插入 filterCloudRows(...)，剔除示例残留与墓碑行
  4. 收尾 ：cleanupOrphanWords 之前插 purgeLegacySampleLeftovers()（清示例的词/章节/匹配/进度）
  5. 删除 ：removeWordbook 改为「收集所有同 ID 记录全部删」，并统一走 softDeleteCloud
  6. 注入 ：删掉 injectSampleData 调用点
  7. 注入 ：删掉 injectSampleData 函数本体（含示例文章与示例词）
  8. 注入 ：删掉示例幂等函数块（sampleInjectAllowed / markSampleInjected / markCloudDataSeen ...）

依赖：必须在 patch_fixes.py 之后、patch_dist.py 之前执行
"""
import argparse
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_module(name):
    with io.open(os.path.join(HERE, 'patch_src', name), encoding='utf-8') as f:
        return f.read()


def patch(html):
    n = 0

    # ---------- 1. 模块 ----------
    MOD_ANCHOR = '/* ===== 内置词书《六级词书》 ===== */'
    assert html.count(MOD_ANCHOR) == 1, '内置词书锚点不唯一：%d' % html.count(MOD_ANCHOR)
    mod = load_module('cleanup.js').rstrip('\n')
    html = html.replace(MOD_ANCHOR, mod + '\n\n' + MOD_ANCHOR, 1)
    n += 1

    # ---------- 2. 加载入口初始化 ----------
    LOAD_HEAD_OLD = """function loadDataForProfile(profileId) {
  // 优先从云端拉取，降级到 localStorage
  var promises = [];"""
    LOAD_HEAD_NEW = """function loadDataForProfile(profileId) {
  // 优先从云端拉取，降级到 localStorage
  var promises = [];
  // 本轮加载的「示例残留清理」与「删除墓碑」准备
  tombBuild();
  legacyPurgeReset();"""
    assert html.count(LOAD_HEAD_OLD) == 1, 'loadDataForProfile 头部锚点不唯一'
    html = html.replace(LOAD_HEAD_OLD, LOAD_HEAD_NEW, 1)
    n += 1

    # ---------- 3. 每个云端查询插入行过滤 ----------
    FILTER_RE = re.compile(r"(_q\(DB_IDS\.(context_\w+), [^\n]*\}\)\.then\(function\(rows\) \{\n)")
    inserted = []

    def _ins(m):
        inserted.append(m.group(2))
        return m.group(1) + "      rows = filterCloudRows(DB_IDS.%s, rows);\n" % m.group(2)

    html, cnt = FILTER_RE.subn(_ins, html)
    assert cnt >= 10, '云端查询锚点太少（%d），loadDataForProfile 结构可能已变' % cnt
    print('  · 行过滤插入 %d 处：%s' % (cnt, ', '.join(inserted)))
    n += cnt

    # ---------- 4. 收尾清理（必须在孤儿判定之前） ----------
    TAIL_OLD = """    installBuiltinWordbookOnce();   // 内置词书，须早于孤儿词清理
    cleanupOrphanWords();"""
    TAIL_NEW = """    installBuiltinWordbookOnce();   // 内置词书，须早于孤儿词清理
    // 先清掉历史示例残留（否则示例书的词会被当成孤词，反而补建出「（恢复）原记录缺失的单词书」）
    purgeLegacySampleLeftovers();
    cleanupOrphanWords();"""
    assert html.count(TAIL_OLD) == 1, 'loadDataForProfile 收尾锚点不唯一'
    html = html.replace(TAIL_OLD, TAIL_NEW, 1)
    n += 1

    # ---------- 5. removeWordbook 重写 ----------
    RW_OLD = """function removeWordbook(wbId) {
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
}"""
    RW_NEW = """function removeWordbook(wbId) {
  // 同一个「单词书ID」在云端可能有多条记录（历史上被重复推送过），必须**全部**收集起来删，
  // 否则删掉一条、留下几条，刷新后又被拉回来 —— 这正是「删掉的书刷新后又出现」的直接原因。
  var removedWbs = [];
  STATE.wordbooks = STATE.wordbooks.filter(function(w) {
    if (w.id === wbId || (w._cloudId && w._cloudId === wbId)) { removedWbs.push(w); return false; }
    return true;
  });
  var removedWords = STATE.words.filter(function(w) { return w.wordbookId === wbId; });
  STATE.words = STATE.words.filter(function(w) { return w.wordbookId !== wbId; });
  saveLocal();
  var _delJobs = [];
  removedWbs.forEach(function(w) { if (w._cloudId) _delJobs.push({ db: DB_IDS.context_wordbooks, id: w._cloudId }); });
  removedWords.forEach(function(w) { if (w._cloudId) _delJobs.push({ db: DB_IDS.context_words, id: w._cloudId }); });
  // 失败或离线都进墓碑 + 待办：下次进应用补删，且在那之前界面也不会再显示它
  _delJobs.forEach(function(j) { softDeleteCloud(j.db, j.id); });
  return removedWords.length;
}"""
    assert html.count(RW_OLD) == 1, 'removeWordbook 锚点不唯一：%d' % html.count(RW_OLD)
    html = html.replace(RW_OLD, RW_NEW, 1)
    n += 1

    # ---------- 6. 删掉示例注入调用点 ----------
    CALL_OLD = """      flushPendingDels().then(function() { return loadDataForProfile(STATE.profileId); }).then(function() {
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
      });"""
    CALL_NEW = """      flushPendingDels().then(function() { return loadDataForProfile(STATE.profileId); }).then(function() {
        // 示例数据已彻底移除：不再向任何账号注入示例内容。
        // 这里只做历史残留清理 —— 把过去被注入过的那份示例数据（词书 + 资料）
        // 连同它们的词、章节、匹配、进度一并清掉（本地 + 云端）。
        purgeLegacySampleLeftovers();
        refreshAll();
      });"""
    assert html.count(CALL_OLD) == 1, '示例注入调用点锚点不唯一：%d' % html.count(CALL_OLD)
    html = html.replace(CALL_OLD, CALL_NEW, 1)
    n += 1

    # ---------- 7. 删掉 injectSampleData 函数本体 ----------
    START = '// ===== 示例数据注入 ====='
    END = "  toast('已注入示例数据，可直接开始学习', 'ok');\n}\n"
    assert html.count(START) == 1, '示例注入函数起始锚点不唯一：%d' % html.count(START)
    assert html.count(END) == 1, '示例注入函数结束锚点不唯一：%d' % html.count(END)
    i = html.index(START)
    j = html.index(END, i) + len(END)
    removed_bytes = len(html[i:j].encode('utf-8'))
    html = html[:i] + html[j:]
    print('  · 删除 injectSampleData 本体 %d 字节' % removed_bytes)
    n += 1

    # ---------- 8. 删掉示例幂等函数块 ----------
    IDEM_OLD = """// ---------- 示例数据注入的幂等判定（第 6 条）----------
// 旧逻辑用 seen_<profileId> 作标记，而 enterApp 每次都会跑 resolveAccountProfileId
// （规则「哪边 materials 多，身份就在哪边」）→ ID 漂移就换一把新 key → 示例数据被反复注入并推到云端。
// 表现正是用户看到的「我删掉的示例书刷新后又回来了」。现在标记绑定**昵称**，与 ID 漂移解耦。
function sampleInjectedKey() { return 'sampleInjected_v1_' + (STATE.nickname || ''); }
function hadCloudDataKey() { return 'hadCloudData_v1_' + (STATE.nickname || ''); }

function sampleInjectAllowed() {
  if (STATE.materials.length > 0 || STATE.wordbooks.length > 0) return false;  // 已经有数据，不注入
  if (LS.get(sampleInjectedKey(), false)) return false;   // 本账号在本机注入过 → 永不再注入
  if (LS.get(hadCloudDataKey(), false)) return false;     // 本账号曾有过云端数据 → 永不再注入
  return true;
}
function markCloudDataSeen() {
  if (STATE.materials.length > 0 || STATE.wordbooks.length > 0) LS.set(hadCloudDataKey(), true);
}
function markSampleInjected() { LS.set(sampleInjectedKey(), true); }"""
    IDEM_NEW = """// ---------- 示例数据注入：已彻底移除 ----------
// 现在不再有任何示例内容注入逻辑；历史上的残留由 patch_src/cleanup.js 里的
// purgeLegacySampleLeftovers() 在每次加载收尾时清掉（本地 + 云端）。"""
    assert html.count(IDEM_OLD) == 1, '示例幂等函数块锚点不唯一：%d' % html.count(IDEM_OLD)
    html = html.replace(IDEM_OLD, IDEM_NEW, 1)
    n += 1

    return html, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    args = ap.parse_args()

    with io.open(args.input, encoding='utf-8') as f:
        html = f.read()
    html, n = patch(html)
    with io.open(args.output, 'w', encoding='utf-8', newline='') as f:
        f.write(html)
    print('patch_cleanup: %d 处改动' % n)


if __name__ == '__main__':
    main()
