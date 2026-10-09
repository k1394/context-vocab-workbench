# -*- coding: utf-8 -*-
"""划线记笔记（参考微信读书的划线交互）

改动清单
  1.  DB_IDS    ：加 context_notes（第 14 张云表「语境背单词-笔记表」）
  2.  CSS       ：划线高亮、划线模式光标、右侧笔记抽屉
  3.  工具栏    ：加「✏️ 划线」开关 + 「📝 笔记」抽屉按钮
  4.  抽屉 HTML ：右侧滑出的笔记面板
  5.  渲染      ：段落先按句子切分，包 <span class="sent" data-si="i">，<p> 加 data-pi
  6.  渲染收尾  ：innerHTML 赋值后把已有划线标回去 + 刷新笔记面板
  7.  saveLocal ：笔记写盘
  8.  加载      ：localSnap 加 notes + 云端查 notes
  9.  兜底      ：restoreFailedLoads / cloudTypeOf / mergeLocalSnapshot 认识 notes
 10.  补推      ：enterApp 里 flushPendingNoteAdds()

依赖：必须在 patch_polish.py 之后执行（第 5 步的锚点是前面所有补丁跑完后的最终形态）
"""
import argparse
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))

NOTES_DB_ID = 'm2kUmiSs4lBDMG20E37OnX'


def load_module(name):
    with io.open(os.path.join(HERE, 'patch_src', name), encoding='utf-8') as f:
        return f.read()


CSS = """
/* ===== 划线记笔记 ===== */
/* 划线高亮用 background + inset box-shadow 画下划线，不动行高，避免整段重排 */
.reading-area .sent{transition:background .15s}
.reading-area .sent.note-hl{background:rgba(45,134,89,.13);box-shadow:inset 0 -2px 0 rgba(45,134,89,.55);border-radius:2px;cursor:pointer}
.reading-area .sent.note-hl:hover{background:rgba(214,72,61,.12);box-shadow:inset 0 -2px 0 rgba(214,72,61,.5)}
.reading-area .sent.preview-hl{background:rgba(58,110,165,.18);box-shadow:inset 0 -2px 0 rgba(58,110,165,.55);border-radius:2px}
/* 划线模式下自己接管手势：手指才能「滑动划线」而不是滚动页面 */
.reading-area.marking-mode{cursor:crosshair;user-select:none;-webkit-user-select:none;touch-action:none}
.reading-area.marking-mode ::selection{background:rgba(58,110,165,.2)}
.note-drawer{position:fixed;top:0;right:0;width:368px;max-width:90vw;height:100%;background:var(--card);border-left:1px solid var(--border);box-shadow:-8px 0 28px rgba(0,0,0,.13);transform:translateX(103%);transition:transform .22s ease;z-index:900;display:flex;flex-direction:column}
.note-drawer.open{transform:translateX(0)}
.note-drawer-head{display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid var(--border);font-weight:700;color:var(--green-d);font-size:15px}
.note-scope-tabs{display:flex;gap:0;padding:0 16px;border-bottom:1px solid var(--border)}
.note-scope-tab{flex:1;padding:8px 0;text-align:center;font-size:13px;font-weight:600;color:var(--text3);border-bottom:2px solid transparent;margin-bottom:-1px;background:none;cursor:pointer}
.note-scope-tab.active{color:var(--green);border-color:var(--green)}
.note-drawer-body{flex:1;overflow-y:auto;padding:12px 14px;background:var(--bg)}
.note-empty{color:var(--text3);font-size:13px;line-height:2;text-align:center;padding:36px 12px}
.note-item{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:11px 12px;margin-bottom:10px}
.note-item .nt-text{font-size:14px;line-height:1.8;white-space:pre-wrap;word-break:break-word;color:var(--text)}
.note-item .nt-meta{margin-top:9px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--text3)}
.note-item .nt-badge{background:var(--green-l);color:var(--green-d);border-radius:10px;padding:1px 7px;font-size:11px;margin-right:4px}
.note-item .nt-badge-cross{background:var(--orange-l);color:var(--orange)}
#noteCountBadge{background:var(--green);color:#fff;border-radius:9px;padding:0 6px;font-size:11px;margin-left:2px}
@media(max-width:640px){.note-drawer{width:100vw;max-width:100vw}}
"""

DRAWER_HTML = """    <!-- 划线笔记抽屉（右侧滑出） -->
    <aside class="note-drawer" id="noteDrawer">
      <div class="note-drawer-head">
        <span id="noteDrawerTitle">笔记</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm btn-outline" onclick="toggleNoteDrawer(false)">关闭</button>
      </div>
      <div class="note-scope-tabs">
        <button class="note-scope-tab active" id="noteScopeChapter" onclick="setNoteScope('chapter')">本章</button>
        <button class="note-scope-tab" id="noteScopeBook" onclick="setNoteScope('book')">整本</button>
      </div>
      <div class="note-drawer-body" id="noteDrawerBody"></div>
    </aside>

"""

TOOLBAR_BTN_OLD = """          <button class="btn btn-sm btn-outline" onclick="regenerateAllMaterials()" title="按当前词池与分布设置重算全部资料" data-page-node-id="Grd0vctoXuCrHY4NPOuMo5">↻ 全部重算</button>"""
TOOLBAR_BTN_NEW = TOOLBAR_BTN_OLD + """
          <button class="btn btn-sm btn-outline" id="btnNoteMode" onclick="toggleNoteMode()" title="开启后可用鼠标、触控笔或手指在正文上滑动划线（手指必须开这个，否则滑动等于滚动页面）">✏️ 划线</button>
          <button class="btn btn-sm btn-outline" id="btnNoteDrawer" onclick="toggleNoteDrawer()" title="查看划线笔记">📝 笔记 <span id="noteCountBadge">0</span></button>"""

# ---- 渲染循环：把「整段 token 替换」改成「先按句子切分，再在句内做 token 替换」----
RENDER_OLD = """    var segments = [];
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
      segments.push(escapeHTML(para.substring(cursor, actualIdx)));"""

RENDER_NEW = """    var segments = [];
    var cursor = 0;
    // ★ 划线记笔记：先按句子把本段切开，每句包一层 <span class="sent" data-si="i">。
    //   划线只记「段号 + 句号」，所以换模式重渲染也不会错位；句子按原文切，
    //   不受「中文词被替换成 中文（英文 释义）」影响（实现见 patch_src/highlight.js）。
    var _sents = (typeof splitSentenceRanges === 'function') ? splitSentenceRanges(para) : [];
    if (!_sents.length) _sents = [{ start: 0, end: para.length, text: para }];
    var _mi = 0;
    // 把本句 [lo,hi) 范围内还没处理过的 match 吐进 segments。
    // 跨句时 _mi 保持不动，下一句接着处理，不会重复扫描。
    var emitMatches = function(lo, hi) {
    while (_mi < paraMatches.length) {
      var m = paraMatches[_mi];
      var posInPara = m.position - pi * 10000;
      var chWord = m.chWord;
      var lemma = m.lemma;
      // 在 para 中从 cursor 开始查找 chWord（避免漏匹配重叠词）
      var actualIdx = para.indexOf(chWord, Math.max(cursor, posInPara));
      if (actualIdx === -1) { _mi++; continue; }
      // 这个词整体落在本句之后 → 留给后面的句子处理
      if (actualIdx >= hi || actualIdx + chWord.length > hi) break;
      // 输出 cursor 到 actualIdx 之间的原文（保留所有字符）
      segments.push(escapeHTML(para.substring(cursor, actualIdx)));"""

RENDER_TAIL_OLD = """      cursor = actualIdx + chWord.length;
      // 记录遇到的词
      if (STATE.currentSession) STATE.currentSession.wordsEncountered[lemma] = (STATE.currentSession.wordsEncountered[lemma] || 0) + 1;
    }
    // 输出最后一段原文
    if (cursor < para.length) segments.push(escapeHTML(para.substring(cursor)));
    html += '<p>' + segments.join('') + '</p>';"""

RENDER_TAIL_NEW = """      cursor = actualIdx + chWord.length;
      // 记录遇到的词
      if (STATE.currentSession) STATE.currentSession.wordsEncountered[lemma] = (STATE.currentSession.wordsEncountered[lemma] || 0) + 1;
      _mi++;
    }
    };
    for (var _si = 0; _si < _sents.length; _si++) {
      var _sr = _sents[_si];
      if (_sr.start > cursor) segments.push(escapeHTML(para.substring(cursor, _sr.start)));
      segments.push('<span class="sent" data-si="' + _si + '">');
      emitMatches(_sr.start, _sr.end);
      if (cursor < _sr.end) { segments.push(escapeHTML(para.substring(cursor, _sr.end))); cursor = _sr.end; }
      segments.push('</span>');
    }
    emitMatches(0, para.length);   // 兜底：落在句子间隙里的词
    // 输出最后一段原文
    if (cursor < para.length) segments.push(escapeHTML(para.substring(cursor)));
    html += '<p data-pi="' + pi + '">' + segments.join('') + '</p>';"""


def patch(html):
    n = 0

    # ---------- 1. DB_IDS ----------
    old = '"context_synonyms": "g1R8TZKGzgGEaDcTO9Bao0"};'
    new = '"context_synonyms": "g1R8TZKGzgGEaDcTO9Bao0", "context_notes": "%s"};' % NOTES_DB_ID
    assert html.count(old) == 1, 'DB_IDS 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ---------- 2. 模块 ----------
    MOD_ANCHOR = '/* ===== 内置词书《六级词书》 ===== */'
    assert html.count(MOD_ANCHOR) == 1, '内置词书锚点不唯一：%d' % html.count(MOD_ANCHOR)
    mod = load_module('highlight.js').rstrip('\n')
    html = html.replace(MOD_ANCHOR, mod + '\n\n' + MOD_ANCHOR, 1)
    n += 1

    # ---------- 3. CSS ----------
    assert html.count('</style>') >= 1, '找不到 </style>'
    html = html.replace('</style>', CSS + '</style>', 1)
    n += 1

    # ---------- 4. 工具栏按钮 ----------
    assert html.count(TOOLBAR_BTN_OLD) == 1, '工具栏「全部重算」锚点不唯一：%d' % html.count(TOOLBAR_BTN_OLD)
    html = html.replace(TOOLBAR_BTN_OLD, TOOLBAR_BTN_NEW, 1)
    n += 1

    # ---------- 5. 抽屉 HTML ----------
    drawer_anchor = '    <!-- 测试页 -->'
    assert html.count(drawer_anchor) == 1, '测试页锚点不唯一：%d' % html.count(drawer_anchor)
    html = html.replace(drawer_anchor, DRAWER_HTML + drawer_anchor, 1)
    n += 1

    # ---------- 6. 渲染：句子切分 ----------
    assert html.count(RENDER_OLD) == 1, '渲染循环头锚点不唯一：%d' % html.count(RENDER_OLD)
    html = html.replace(RENDER_OLD, RENDER_NEW, 1)
    n += 1

    assert html.count(RENDER_TAIL_OLD) == 1, '渲染循环尾锚点不唯一：%d' % html.count(RENDER_TAIL_OLD)
    html = html.replace(RENDER_TAIL_OLD, RENDER_TAIL_NEW, 1)
    n += 1

    # ---------- 7. 渲染收尾：把划线标回去 ----------
    old = "  document.getElementById('readingArea').innerHTML = html;"
    new = ("  document.getElementById('readingArea').innerHTML = html;\n"
           "  // 划线笔记：正文刚重建完，立刻把已有的划线标回去（否则每次切模式都会丢标记）\n"
           "  if (typeof renderNoteHighlights === 'function') renderNoteHighlights();\n"
           "  if (typeof renderNotePanel === 'function') renderNotePanel();")
    assert html.count(old) == 1, 'readingArea.innerHTML 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ---------- 8. saveLocal 写盘 ----------
    old = "  LS.set('review_' + pid, STATE.reviewQueue);"
    new = ("  LS.set('review_' + pid, STATE.reviewQueue);\n"
           "  if (STATE.notes) LS.set('notes_v1_' + pid, STATE.notes);   // 划线笔记")
    assert html.count(old) == 1, 'saveLocal 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ---------- 9. 本地兜底加载 ----------
    old = "    STATE.matches = LS.get('matches_' + profileId, {});"
    new = ("    STATE.matches = LS.get('matches_' + profileId, {});\n"
           "    STATE.notes = LS.get('notes_v1_' + profileId, {});   // 划线笔记")
    assert html.count(old) == 1, '本地 matches 加载锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ---------- 10. 云快照 ----------
    old = "      synonyms: LS.get('synonyms_' + profileId, {})\n    };"
    new = ("      synonyms: LS.get('synonyms_' + profileId, {}),\n"
           "      notes: LS.get('notes_v1_' + profileId, {})\n    };")
    assert html.count(old) == 1, 'localSnap 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ---------- 11. 云端查询 ----------
    old = ("    promises.push(_q(DB_IDS.context_review, { property: { property: 'profile_id', "
           "text: { equals: profileId } } }).then(function(rows) {\n"
           "      rows = filterCloudRows(DB_IDS.context_review, rows);")
    new = ("    // 划线笔记本轮新增：按 资料ID/章节ID 归成 STATE.notes[matId][chId] = [note]\n"
           "    promises.push(_q(DB_IDS.context_notes, { property: { property: 'profile_id', "
           "text: { equals: profileId } } }).then(function(rows) {\n"
           "      rows = filterCloudRows(DB_IDS.context_notes, rows);\n"
           "      var _acc = {};\n"
           "      rows.forEach(function(r) {\n"
           "        var _mid = r['资料ID'] || '', _cid = r['章节ID'] || '';\n"
           "        if (!_mid || !_cid) return;\n"
           "        if (!_acc[_mid]) _acc[_mid] = {};\n"
           "        if (!_acc[_mid][_cid]) _acc[_mid][_cid] = [];\n"
           "        _acc[_mid][_cid].push(noteFromRow(r));\n"
           "      });\n"
           "      STATE.notes = _acc;\n"
           "    }));\n" + old)
    assert html.count(old) == 1, '云端 review 查询锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ---------- 12. restoreFailedLoads ----------
    old = "    reviewQueue: 'reviewQueue', sessions: 'sessions', answers: 'answers', synonyms: 'synonyms'"
    new = ("    reviewQueue: 'reviewQueue', sessions: 'sessions', answers: 'answers', synonyms: 'synonyms',\n"
           "    notes: 'notes'")
    assert html.count(old) == 1, 'restoreFailedLoads 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ---------- 13. cloudTypeOf ----------
    old = "      context_synonyms: 'synonyms'\n    };"
    new = "      context_synonyms: 'synonyms', context_notes: 'notes'\n    };"
    assert html.count(old) == 1, 'cloudTypeOf 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ---------- 14. mergeLocalSnapshot 补回本地独有的笔记 ----------
    old = """  (snap.reviewQueue || []).forEach(function(r) {
    if (r && r.lemma && !cloudReviewLemmas[r.lemma]) { STATE.reviewQueue.push(r); syncReviewToCloud(r); }
  });"""
    new = old + """
  // 划线笔记：云端覆盖式加载会把本地独有的笔记一并抹掉，这里按 资料ID/章节ID/笔记ID 补回来并补推
  (function() {
    var snapNotes = snap.notes || {};
    ensureNotesState();
    Object.keys(snapNotes).forEach(function(mid) {
      var chMap = snapNotes[mid] || {};
      Object.keys(chMap).forEach(function(cid) {
        (chMap[cid] || []).forEach(function(nt) {
          if (!nt || !nt.id) return;
          if (findNoteById(mid, cid, nt.id)) return;
          chapterNotes(mid, cid).push(nt);
          if (!nt._cloudId) pushNoteToCloud(mid, cid, nt);
        });
      });
    });
  })();"""
    assert html.count(old) == 1, 'mergeLocalSnapshot reviewQueue 锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
    n += 1

    # ---------- 15. enterApp 补推 ----------
    old = """        // 补推「上次没推上云端」的新增标注
        flushPendingAdds();
        refreshAll();"""
    new = """        // 补推「上次没推上云端」的新增标注
        flushPendingAdds();
        // 补推「上次没推上云端」的划线笔记
        if (typeof flushPendingNoteAdds === 'function') flushPendingNoteAdds();
        refreshAll();"""
    assert html.count(old) == 1, 'enterApp 补推锚点不唯一：%d' % html.count(old)
    html = html.replace(old, new, 1)
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
    print('patch_notes: %d 处改动' % n)


if __name__ == '__main__':
    main()
