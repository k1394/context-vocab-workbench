# -*- coding: utf-8 -*-
"""给语境背单词工作台加「单词书选择 + 词池范围 + 分布均摊」。
用法: python patch_wb_select.py --input <基线.html> --output <输出.html>
基线要求：v16（已含内置《六级词书》模块），不受 patch_builtin_wb.py 的安装点 assert 影响。
"""
import argparse, io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


CSS_ADD = """.wb-picker{position:relative;flex:none}
.wb-panel{position:absolute;top:calc(100% + 6px);left:0;z-index:60;min-width:252px;max-width:86vw;max-height:340px;overflow:auto;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:10px 12px}
.wb-panel .wp-sec{font-size:11px;color:var(--text3);margin:10px 0 4px}
.wb-panel .wp-sec:first-child{margin-top:0}
.wb-panel .wp-none{font-size:12px;color:var(--text3);padding:4px}
.wb-panel label.wp-row{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);padding:6px 4px;border-radius:5px;cursor:pointer;line-height:1.4}
.wb-panel label.wp-row:hover{background:var(--gray-l)}
.wb-panel label.wp-row input{margin:0;flex:none}
.wb-panel label.wp-row .wp-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wb-panel label.wp-row .wp-cnt{font-size:11px;color:var(--text3);flex:none}
.wb-panel .wp-foot{display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border)}
.wb-panel .wp-foot button{flex:1;font-size:12px;padding:5px 6px;border:1px solid var(--border);border-radius:5px;background:var(--card);color:var(--text2);cursor:pointer}
.wb-panel .wp-foot button:hover{background:var(--gray-l)}
#matchInfo .mi-hint{color:#b7791f;margin-top:2px}
"""

# 线上版会被平台规范化属性顺序，所以锚点用正则而不是精确字符串
TOOLBAR_RE = re.compile(r'<select[^>]*\bid="selChapter"[^>]*>\s*</select>')
TARGET_RE = re.compile(r'<label[^>]*data-page-node-id="PglO4mCsqJfiSOxZahEgBR"[^>]*>[\s\S]*?</label>')

TOOLBAR_ADD = """
          <div class="wb-picker" id="wbPicker">
            <button class="btn btn-sm btn-outline" id="wbPickerBtn" onclick="toggleWbPicker(event)">单词书：全部单词书</button>
            <div class="wb-panel hidden" id="wbPanel"></div>
          </div>
          <select id="selStrategy" onchange="onStrategyChange()" title="选词分布策略" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
            <option value="balanced">分布：每段均摊</option>
            <option value="length">分布：按篇幅分配</option>
            <option value="sequential">分布：顺序取（旧）</option>
          </select>"""

TARGET_ADD = """
          <label class="toggle" title="每个段落最多标注几处，防止词都挤在一两段" data-page-node-id="PglO4mCsqJfiSOxZahEgBR2">每段上限 <input type="number" id="perParaMaxInput" min="1" max="30" value="4" onchange="onPerParaMaxChange()" style="width:48px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:13px" data-page-node-id="ixowRPik8eN5qKzNivlXxH2"> 处</label>
          <button class="btn btn-sm btn-outline" onclick="regenerateAllMaterials()" title="按当前词池与分布设置重算全部资料" data-page-node-id="Grd0vctoXuCrHY4NPOuMo5">↻ 全部重算</button>"""

MATCHINFO_ANCHOR = """    if (matches.length === 0) {
      infoEl.innerHTML = '本章暂无语境标注。若已导入单词书，请点「\U0001f504 重新生成」；若仍为 0，请检查单词书字段映射中「中文释义」列是否正确。';
    } else {
      var unCount = (ch.unmatchedWords || []).length;
      infoEl.textContent = '本章已标注 ' + matches.length + ' 处 · ' + Object.keys(uniq).length + ' 个目标词' + (unCount > 0 ? ' · 未匹配 ' + unCount + ' 词' : '');
    }"""

MATCHINFO_NEW = """    if (matches.length === 0) {
      infoEl.innerHTML = '\u672c\u7ae0\u6682\u65e0\u8bed\u5883\u6807\u6ce8\u3002\u5f53\u524d\u8bcd\u6c60 ' + buildLearnWordPool().length + ' \u8bcd\uff0c\u53ef\u70b9\u300c\U0001f504 \u91cd\u65b0\u751f\u6210\u300d\uff1b\u82e5\u4ecd\u4e3a 0\uff0c\u8bf7\u68c0\u67e5\u5355\u8bcd\u4e66\u5b57\u6bb5\u6620\u5c04\u4e2d\u300c\u4e2d\u6587\u91ca\u4e49\u300d\u5217\u662f\u5426\u6b63\u786e\u3002';
    } else {
      var unCount = (ch.unmatchedWords || []).length;
      var dist = (ch.paraDist && ch.paraDist.length) ? ch.paraDist : computeParaDist(matches, ch.content.split(/\\n\\n+/));
      var totalPara = dist.length;
      var blank = 0, di;
      for (di = 0; di < dist.length; di++) { if (dist[di] === 0) blank++; }
      var distTxt = dist.length > 26 ? dist.slice(0, 26).join('/') + '/…' : dist.join('/');
      var line1 = '\u8bcd\u6c60 ' + (ch.poolSize || STATE.words.length) + ' \u8bcd\uff08' + learnPoolSummary() + ' \u00b7 ' + strategyName(getLearnOpts().strategy) + '\uff09\u00b7 \u672c\u7ae0\u6807\u6ce8 ' + matches.length + ' \u5904 / ' + Object.keys(uniq).length + ' \u4e2a\u76ee\u6807\u8bcd \u00b7 \u8986\u76d6 ' + (totalPara - blank) + '/' + totalPara + ' \u6bb5' + (unCount > 0 ? ' \u00b7 \u672a\u5339\u914d ' + unCount + ' \u8bcd' : '');
      var line2 = '\u6bb5\u843d\u5206\u5e03 ' + distTxt;
      var tips = [];
      if (blank > 0) tips.push('\u6709 ' + blank + ' \u6bb5\u6ca1\u6709\u53ef\u6807\u6ce8\u7684\u8bcd\uff08\u591a\u4e3a\u5bf9\u8bdd\u6bb5\uff09\uff0c\u53ef\u63d0\u9ad8\u300c\u6bcf\u7ae0\u76ee\u6807\u300d\u6216\u6362\u4e00\u672c\u5355\u8bcd\u4e66');
      if (ch.capBlocked > 0 && Object.keys(uniq).length < ((ch.targetWords && ch.targetWords >= 1) ? ch.targetWords : 30)) {
        tips.push('\u53d7\u300c\u6bcf\u6bb5\u4e0a\u9650 ' + getLearnOpts().perParaMax + ' \u5904\u300d\u9650\u5236\uff0c\u672c\u7ae0\u53ea\u6807\u4e86 ' + Object.keys(uniq).length + ' \u4e2a\u8bcd\uff1b\u60f3\u8981\u66f4\u591a\u8bf7\u8c03\u5927\u4e0a\u9650');
      }
      var line3 = tips.length ? '<div class="mi-hint">' + tips.join('\uff1b') + '</div>' : '';
      infoEl.innerHTML = escapeHTML(line1) + '<div style="color:var(--text3)">' + escapeHTML(line2) + '</div>' + line3;
    }"""

OPTS_LOAD_ANCHOR = '    installBuiltinWordbookOnce();   // \u5185\u7f6e\u8bcd\u4e66\uff0c\u987b\u65e9\u4e8e\u5b64\u513f\u8bcd\u6e05\u7406'
OPTS_LOAD_NEW = ('    STATE.learnOpts = LS.get(\'learnOpts_\' + profileId, null) || JSON.parse(JSON.stringify(LEARN_OPTS_DEFAULT));\n'
                 '    installBuiltinWordbookOnce();   // \u5185\u7f6e\u8bcd\u4e66\uff0c\u987b\u65e9\u4e8e\u5b64\u513f\u8bcd\u6e05\u7406')

SAVE_ANCHOR = "  LS.set('chapters_' + pid, STATE.chapters);"
SAVE_NEW = ("  LS.set('chapters_' + pid, STATE.chapters);\n"
            "  if (STATE.learnOpts) LS.set('learnOpts_' + pid, STATE.learnOpts);")

GUARD_ANCHOR = "  if (STATE.words.length === 0) { toast('\u8bf7\u5148\u5bfc\u5165\u5355\u8bcd\u4e66', 'err'); return; }"
GUARD_NEW = "  if (buildLearnWordPool().length === 0) { toast('\u5f53\u524d\u8bcd\u6c60\u91cc\u6ca1\u6709\u53ef\u7528\u7684\u8bcd\uff0c\u8bf7\u6362\u4e00\u672c\u5355\u8bcd\u4e66\u6216\u8c03\u6574\u8bcd\u6c60\u8303\u56f4', 'err'); return; }"

# 单词书列表：卡片上加「本章命中 N 词」角标
CARD_ANCHOR = ("      var wordCount = STATE.words.filter(function(w) { return w.wordbookId === wb.id; }).length;\n"
               "      var isBuiltin = (wb.id === BUILTIN_WB_ID || wb.builtin);")
CARD_NEW = ("      var wordCount = STATE.words.filter(function(w) { return w.wordbookId === wb.id; }).length;\n"
            "      var isBuiltin = (wb.id === BUILTIN_WB_ID || wb.builtin);\n"
            "      var hitSet = {};\n"
            "      var curM = (STATE.learnMaterialId && STATE.learnChapterId && STATE.matches[STATE.learnMaterialId]) ? (STATE.matches[STATE.learnMaterialId][STATE.learnChapterId] || []) : [];\n"
            "      curM.forEach(function(m) { hitSet[m.lemma] = true; });\n"
            "      var bookHit = 0;\n"
            "      if (curM.length) {\n"
            "        STATE.words.forEach(function(w) { if (w.wordbookId === wb.id && hitSet[(w.lemma || '').toLowerCase()]) bookHit++; });\n"
            "      }")

CARD_META_ANCHOR = "<div class=\"meta\">' + (wb.source||'') + ' · ' + wordCount + ' 词</div>"
CARD_META_NEW = "<div class=\"meta\">' + (wb.source||'') + ' · ' + wordCount + ' 词' + (bookHit ? ' · 本章命中 ' + bookHit + ' 词' : '') + '</div>"

# renderMaterials 末尾挂上选择器初始化
RENDER_TAIL_ANCHOR = "  document.getElementById('wordbookList').innerHTML = wbHtml;\n}"
RENDER_TAIL_NEW = "  document.getElementById('wordbookList').innerHTML = wbHtml;\n  renderWbPicker();\n}"

# 内置标记不重复显示（来源里已经写了「内置」）
BADGE_ANCHOR = "(isBuiltin ? ' <span style=\"font-size:11px;padding:1px 6px;border-radius:8px;background:var(--bg3,#eef1f6);color:var(--text2);vertical-align:2px\">\u5185\u7f6e</span>' : '')"
BADGE_NEW = "(isBuiltin && (wb.source || '').indexOf('\u5185\u7f6e') === -1 ? ' <span style=\"font-size:11px;padding:1px 6px;border-radius:8px;background:var(--bg3,#eef1f6);color:var(--text2);vertical-align:2px\">\u5185\u7f6e</span>' : '')"


def apply(html):
    n = 0

    # 1. CSS
    a = '.learn-toolbar .toggle input{margin:0}\n'
    assert html.count(a) == 1, 'CSS 锚点不唯一'
    html = html.replace(a, a + CSS_ADD, 1); n += 1

    # 2. 工具栏：单词书选择器 + 分布策略
    hits = TOOLBAR_RE.findall(html)
    assert len(hits) == 1, 'selChapter 锚点不唯一（找到 %d 处）' % len(hits)
    html = TOOLBAR_RE.sub(lambda m: m.group(0) + TOOLBAR_ADD, html, count=1); n += 1

    # 3. 工具栏：每段上限 + 全部重算
    hits = TARGET_RE.findall(html)
    assert len(hits) == 1, 'targetWordsInput 锚点不唯一（找到 %d 处）' % len(hits)
    html = TARGET_RE.sub(lambda m: m.group(0) + TARGET_ADD, html, count=1); n += 1

    # 4. 算法块整体替换
    start = html.index('// ===== \u8bed\u5883\u5339\u914d\u7b97\u6cd5 =====')
    end = html.index('// ===== \u91cd\u65b0\u751f\u6210\u8bed\u5883\u6750\u6599 =====')
    assert 0 < start < end
    html = html[:start] + read(os.path.join(HERE, 'patch_src', 'algo.js')) + html[end:]
    n += 1

    # 5. regenerateMatches 起，到艾宾浩斯算法前，整体替换
    s2 = html.index('function regenerateMatches(matId, chId) {')
    e2 = html.index('// ===== \u827e\u5bbe\u6d69\u65af\u590d\u4e60\u7b97\u6cd5 =====')
    assert 0 < s2 < e2
    html = html[:s2] + read(os.path.join(HERE, 'patch_src', 'regen.js')) + html[e2:]
    n += 1

    # 6. 匹配信息条增强
    assert html.count(MATCHINFO_ANCHOR) == 1, 'matchInfo 锚点不唯一'
    html = html.replace(MATCHINFO_ANCHOR, MATCHINFO_NEW, 1); n += 1

    # 7. 载入取词设置
    assert html.count(OPTS_LOAD_ANCHOR) == 1, 'installBuiltin 锚点不唯一'
    html = html.replace(OPTS_LOAD_ANCHOR, OPTS_LOAD_NEW, 1); n += 1

    # 8. 持久化取词设置
    assert html.count(SAVE_ANCHOR) == 1, 'saveLocal 锚点不唯一'
    html = html.replace(SAVE_ANCHOR, SAVE_NEW, 1); n += 1

    # 9. 手动重生成的词池判空
    assert html.count(GUARD_ANCHOR) == 1, 'guard 锚点不唯一'
    html = html.replace(GUARD_ANCHOR, GUARD_NEW, 1); n += 1

    # 10. 单词书卡片角标
    assert html.count(CARD_ANCHOR) == 1, '卡片锚点不唯一'
    html = html.replace(CARD_ANCHOR, CARD_NEW, 1); n += 1
    assert html.count(CARD_META_ANCHOR) == 1, '卡片 meta 锚点不唯一'
    html = html.replace(CARD_META_ANCHOR, CARD_META_NEW, 1); n += 1

    # 11. renderMaterials 尾部初始化选择器
    assert html.count(RENDER_TAIL_ANCHOR) == 1, 'renderMaterials 尾部锚点不唯一'
    html = html.replace(RENDER_TAIL_ANCHOR, RENDER_TAIL_NEW, 1); n += 1

    # 12. 内置标记不重复显示
    assert html.count(BADGE_ANCHOR) == 1, '内置标记锚点不唯一'
    html = html.replace(BADGE_ANCHOR, BADGE_NEW, 1); n += 1

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
