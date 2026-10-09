# -*- coding: utf-8 -*-
"""给语境背单词工作台加「数据自检与抢救」+「删除待办自动补删」。

用法: python patch_rescue.py --input <patch_wb_select 的输出.html> --output <输出.html>

处理的两个真实故障：
  ① 删除的单词书刷新后又出现 —— 云端那份没删成功，而页面是云端覆盖式加载
  ② 自己添加的单词书不见了 —— 本地写成功但云端没写成功（或账号 ID 变化时本地被丢弃）
"""
import argparse, io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


# ---------- 1. 单词书区域加「数据自检」入口 ----------
# 注意：线上基线的按钮里会被平台塞入 `<!--pnid:xxx-->` 注释节点，正则必须兼容
IMPORT_WB_BTN_RE = re.compile(
    r"<button[^>]*\bonclick=\"showUploadModal\('wordbook'\)\"[^>]*>"
    r"(?:<!--[^>]*-->)?[^<]*导入单词书</button>")
RESCUE_BTN = ('\n        <button class="btn btn-outline btn-sm" onclick="openRescuePanel()"'
              ' title="查看云端与本地所有账号下的数据，找回丢失的单词书">数据自检</button>')

# ---------- 2. 模块插入点 ----------
MODULE_ANCHOR = '/* ===== 内置词书《六级词书》 ===== */'

# ---------- 3. removeWordbook 的云端删除改为「失败就记待办」 ----------
REMOVE_OLD = """  // 云端同步删除
  if (STATE.cloudReady) {
    if (wb && wb._cloudId) CLOUD.del(DB_IDS.context_wordbooks, wb._cloudId);
    removedWords.forEach(function(w) { if (w._cloudId) CLOUD.del(DB_IDS.context_words, w._cloudId); });
  }"""
REMOVE_NEW = """  // 云端同步删除；失败或离线时记成待办，下次进应用自动补删（否则下次刷新会被云端覆盖回来）
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
  }"""

# ---------- 4. 同步队列：删除也重试一次，失败记待办 ----------
QUEUE_RETRY_OLD = "        if (r === null && (t.retry || 0) < 1 && t.type !== 'del') {"
QUEUE_RETRY_NEW = "        if (r === null && (t.retry || 0) < 1) {"

QUEUE_ELSE_OLD = """        } else {
          SYNC_DONE++;"""
QUEUE_ELSE_NEW = """        } else {
          SYNC_DONE++;
          if (t.type === 'del') {
            // 删除成功就销掉待办；失败则记下来，下次进应用补删，绝不静默丢弃
            if (r === null) { if (typeof queuePendingDel === 'function') queuePendingDel(t.dbId, t.recordId); }
            else { if (typeof unqueuePendingDel === 'function') unqueuePendingDel(t.dbId, t.recordId); }
          }"""

# ---------- 5. 进应用先补删，再加载云端数据 ----------
ENTER_OLD = "      loadDataForProfile(STATE.profileId).then(function() {"
ENTER_NEW = ("      flushPendingDels().then(function() { return loadDataForProfile(STATE.profileId); })"
             ".then(function() {")


# ---------- 6. 信息条显示当前分布策略 ----------
STRATEGY_FN_ANCHOR = """  if (names.length === 0) return '全部单词书';
  if (names.length === 1) return names[0];
  return names[0] + ' +' + (names.length - 1) + ' 本';
}"""
STRATEGY_FN_NEW = STRATEGY_FN_ANCHOR + """

// 分布策略的中文名（信息条展示用）
function strategyName(v) {
  if (v === 'length') return '按篇幅分配';
  if (v === 'sequential') return '顺序取';
  return '每段均摊';
}"""

INFO_LINE_OLD = ("      var line1 = '词池 ' + (ch.poolSize || STATE.words.length) + ' 词（' + learnPoolSummary() "
                 "+ '）· 本章标注 ' + matches.length + ' 处 / ' + Object.keys(uniq).length + ' 个目标词 · 覆盖 ' "
                 "+ (totalPara - blank) + '/' + totalPara + ' 段' + (unCount > 0 ? ' · 未匹配 ' + unCount + ' 词' : '');")
INFO_LINE_NEW = ("      var line1 = '词池 ' + (ch.poolSize || STATE.words.length) + ' 词（' + learnPoolSummary() "
                 "+ ' · ' + strategyName(getLearnOpts().strategy) + '）· 本章标注 ' + matches.length + ' 处 / ' "
                 "+ Object.keys(uniq).length + ' 个目标词 · 覆盖 ' + (totalPara - blank) + '/' + totalPara + ' 段' "
                 "+ (unCount > 0 ? ' · 未匹配 ' + unCount + ' 词' : '');")


def apply(html):
    n = 0

    # 1. 数据自检入口
    btns = IMPORT_WB_BTN_RE.findall(html)
    assert len(btns) == 1, '导入单词书按钮锚点不唯一：%d 个' % len(btns)
    html = IMPORT_WB_BTN_RE.sub(lambda m: m.group(0) + RESCUE_BTN, html, count=1)
    n += 1

    # 2. 模块代码
    assert html.count(MODULE_ANCHOR) == 1, '内置词书注释锚点不唯一'
    mods = read(os.path.join(HERE, 'patch_src', 'rescue.js')) + '\n' + \
           read(os.path.join(HERE, 'patch_src', 'pendingdel.js')) + '\n'
    html = html.replace(MODULE_ANCHOR, mods + MODULE_ANCHOR, 1)
    n += 1

    # 3. removeWordbook
    assert html.count(REMOVE_OLD) == 1, 'removeWordbook 云端删除锚点不唯一'
    html = html.replace(REMOVE_OLD, REMOVE_NEW, 1)
    n += 1

    # 4. 同步队列
    assert html.count(QUEUE_RETRY_OLD) == 1, '同步队列重试锚点不唯一'
    html = html.replace(QUEUE_RETRY_OLD, QUEUE_RETRY_NEW, 1)
    n += 1
    assert html.count(QUEUE_ELSE_OLD) == 1, '同步队列 SYNC_DONE 锚点不唯一'
    html = html.replace(QUEUE_ELSE_OLD, QUEUE_ELSE_NEW, 1)
    n += 1

    # 5. enterApp 先补删
    assert html.count(ENTER_OLD) == 1, 'enterApp 加载锚点不唯一'
    html = html.replace(ENTER_OLD, ENTER_NEW, 1)
    n += 1

    # 6. 信息条显示当前分布策略（两条构建路径都支持：已有就跳过）
    if 'function strategyName(' in html:
        pass
    else:
        assert html.count(STRATEGY_FN_ANCHOR) == 1, 'learnPoolSummary 尾部锚点不唯一'
        html = html.replace(STRATEGY_FN_ANCHOR, STRATEGY_FN_NEW, 1)
        n += 1
    if html.count(INFO_LINE_OLD) == 1:
        html = html.replace(INFO_LINE_OLD, INFO_LINE_NEW, 1)
        n += 1
    else:
        assert html.count(INFO_LINE_NEW) == 1, 'matchInfo line1 既不是旧版也不是新版，锚点异常'

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
