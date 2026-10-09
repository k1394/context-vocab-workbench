# -*- coding: utf-8 -*-
"""把《六级词书》直接内置进工作台。

改动点：
  1. 页面底部插入 base64 词表 + 内置词书模块（离线自带，不发网络请求）
  2. loadDataForProfile 成功回调里安装内置词书（早于 cleanupOrphanWords，避免被当孤儿词清掉）
  3. mergeLocalSnapshot / saveLocal 跳过内置词书，避免 7147 词反复推云端、撑爆 localStorage
  4. 单词书列表：内置书显示「内置」标记与「重装」按钮，不给删除按钮
用法：python patch_builtin_wb.py --input <源> --output <目标>
"""
import argparse, base64, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TSV = os.path.join(HERE, 'output', 'builtin_cet6.tsv')
MARK = '/* ===== 内置词书《六级词书》 ===== */'


def build_module(count):
    with open(TSV, 'rb') as f:
        raw = f.read()
    b64 = base64.b64encode(raw).decode('ascii')
    chunks = [b64[i:i + 200] for i in range(0, len(b64), 200)]
    data = '\n'.join(chunks)

    module = f'''<script id="builtinCet6B64" type="text/plain">
{data}
</script>
<script>
{MARK}
// 词表随页面一起离线自带：解码一次、缓存到内存，不写 localStorage、不推云端，
// 否则 7000+ 词会把本地存储撑满、还会把云端单词表刷爆。
var BUILTIN_WB_ID = 'wb_builtin_cet6';
var BUILTIN_WB_NAME = '六级词书';
var BUILTIN_WB_TOTAL = {count};
var _builtinWords = null;

function decodeBuiltinWords() {{
  if (_builtinWords) return _builtinWords;
  var el = document.getElementById('builtinCet6B64');
  if (!el) return (_builtinWords = []);
  var b64 = el.textContent.replace(/\\s+/g, '');
  var bin, txt;
  try {{
    bin = atob(b64);
    if (typeof TextDecoder !== 'undefined') {{
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      txt = new TextDecoder('utf-8').decode(bytes);
    }} else {{
      txt = decodeURIComponent(escape(bin));
    }}
  }} catch (e) {{
    console.error('内置词书解码失败', e);
    return (_builtinWords = []);
  }}
  var out = [];
  txt.split('\\n').forEach(function(line) {{
    if (!line) return;
    var tab = line.indexOf('\\t');
    if (tab <= 0) return;
    out.push({{
      lemma: line.substring(0, tab), meaning: line.substring(tab + 1),
      pos: '', ipa: '', example: '', unit: '',
      wordbookId: BUILTIN_WB_ID, builtin: true
    }});
  }});
  return (_builtinWords = out);
}}

// 安装/补齐内置词书；返回本次新加的词数
function installBuiltinWordbook() {{
  var words = decodeBuiltinWords();
  if (!words.length) return 0;
  var wb = null;
  STATE.wordbooks.forEach(function(w) {{ if (w && w.id === BUILTIN_WB_ID) wb = w; }});
  var exist = {{}};
  STATE.words.forEach(function(w) {{
    if (w && w.wordbookId === BUILTIN_WB_ID) exist[(w.lemma || '').toLowerCase()] = true;
  }});
  var miss = words.filter(function(w) {{ return !exist[w.lemma.toLowerCase()]; }});
  if (miss.length) STATE.words = STATE.words.concat(miss);
  if (!wb) {{
    STATE.wordbooks.push({{
      id: BUILTIN_WB_ID, name: BUILTIN_WB_NAME, source: '内置 · 全书',
      total: words.length, importedAt: nowISO(), builtin: true
    }});
  }} else {{
    wb.total = words.length; wb.builtin = true; wb.name = BUILTIN_WB_NAME;
  }}
  return miss.length;
}}

// 首次安装时才重算语境标注；本地没有词书副本，每次进页面都会重装，
// 靠这个标记保证「重算」只跑一次
function installBuiltinWordbookOnce() {{
  var added = installBuiltinWordbook();
  if (!added) return;
  var flagKey = 'builtinwb_v1_' + STATE.profileId;
  if (LS.get(flagKey, false)) return;
  LS.set(flagKey, true);
  if (STATE.materials.length > 0) {{
    var n = regenerateAllMatches();
    toast('已内置《六级词书》' + BUILTIN_WB_TOTAL + ' 词 · 为所有资料重新生成 ' + n + ' 处语境标注', 'ok', 8000);
  }} else {{
    toast('已内置《六级词书》' + BUILTIN_WB_TOTAL + ' 词，导入文章后即可自动标注', 'ok', 6000);
  }}
  hintDuplicateWordbook();
}}

// 若此前手动导入过同一本书，提示删除，避免同一个词出现两条
function hintDuplicateWordbook() {{
  var set = {{}};
  decodeBuiltinWords().forEach(function(w) {{ set[w.lemma.toLowerCase()] = true; }});
  var names = [];
  STATE.wordbooks.forEach(function(wb) {{
    if (!wb || wb.id === BUILTIN_WB_ID) return;
    var ws = STATE.words.filter(function(w) {{ return w.wordbookId === wb.id; }});
    if (ws.length < 50) return;
    var hit = ws.filter(function(w) {{ return set[(w.lemma || '').toLowerCase()]; }}).length;
    if (hit / ws.length >= 0.8) names.push(wb.name + '（' + ws.length + ' 词）');
  }});
  if (names.length) {{
    toast('检测到 ' + names.join('、') + ' 与内置《六级词书》内容重复，建议在下方删除它，否则同一个词会出现两条', 'err', 15000);
  }}
}}

function reinstallBuiltinWordbook() {{
  STATE.words = STATE.words.filter(function(w) {{ return w.wordbookId !== BUILTIN_WB_ID; }});
  STATE.wordbooks = STATE.wordbooks.filter(function(w) {{ return w.id !== BUILTIN_WB_ID; }});
  installBuiltinWordbook();
  saveLocal();
  var n = regenerateAllMatches();
  toast('已重装《六级词书》' + BUILTIN_WB_TOTAL + ' 词 · ' + n + ' 处语境标注', 'ok');
  refreshAll();
}}
</script>
'''
    return module


def patch(src, dst):
    with open(src, encoding='utf-8') as f:
        html = f.read()
    if MARK in html:
        print('已包含内置词书模块，改为整体替换')
        html = re.sub(r'<script id="builtinCet6B64" type="text/plain">[\s\S]*?</script>\n<script>\n'
                      + re.escape(MARK) + r'[\s\S]*?</script>\n', '', html, count=1)
    count = 0
    with open(TSV, encoding='utf-8') as f:
        for line in f:
            if line.strip():
                count += 1

    # --- 1. 插入模块 ---
    # 线上版会被平台规范化属性顺序、并注入 data-page-node-id，所以用正则匹配锚点
    anchor_re = re.compile(r'<script[^>]*id="pdfjsWorkerCode"[^>]*>')
    hits = anchor_re.findall(html)
    assert len(hits) == 1, '找不到 worker 锚点，实际命中 %d 处' % len(hits)
    html = anchor_re.sub(lambda m: build_module(count) + m.group(0), html, count=1)


    # --- 2. 安装点 ---
    old = ('    if (localSnap) mergeLocalSnapshot(localSnap);\n'
           '    cleanupOrphanWords();')
    assert html.count(old) == 1, '找不到 loadDataForProfile 安装点'
    html = html.replace(old,
        '    if (localSnap) mergeLocalSnapshot(localSnap);\n'
        '    installBuiltinWordbookOnce();   // 内置词书，须早于孤儿词清理\n'
        '    cleanupOrphanWords();', 1)

    # --- 3a. mergeLocalSnapshot 跳过内置词书 ---
    old = ("  (snap.wordbooks || []).forEach(function(w) { if (w && w.id && !cloudWbIds[w.id]) "
           "{ STATE.wordbooks.push(w); syncWordbookToCloud(w); } });")
    assert html.count(old) == 1, '找不到 merge wordbooks'
    html = html.replace(old,
        "  (snap.wordbooks || []).forEach(function(w) { if (w && w.id && w.id !== BUILTIN_WB_ID && !cloudWbIds[w.id]) "
        "{ STATE.wordbooks.push(w); syncWordbookToCloud(w); } });", 1)

    old = ("    if (!cloudWordKeys[k]) { STATE.words.push(w); syncWordToCloud(w); }")
    assert html.count(old) == 1, '找不到 merge words'
    html = html.replace(old,
        "    if (w.wordbookId === BUILTIN_WB_ID) return;   // 内置词不推云端\n"
        "    if (!cloudWordKeys[k]) { STATE.words.push(w); syncWordToCloud(w); }", 1)

    # --- 3b. saveLocal 跳过内置词书 ---
    old = ("  LS.set('wordbooks_' + pid, STATE.wordbooks);\n"
           "  LS.set('words_' + pid, STATE.words);")
    assert html.count(old) == 1, '找不到 saveLocal'
    html = html.replace(old,
        "  // 内置词书不落本地存储：页面自带，每次进页面重装即可，省下几百 KB 配额\n"
        "  LS.set('wordbooks_' + pid, STATE.wordbooks.filter(function(w) { return !w.builtin; }));\n"
        "  LS.set('words_' + pid, STATE.words.filter(function(w) { return w.wordbookId !== BUILTIN_WB_ID; }));", 1)

    # --- 4. 单词书列表 ---
    old = ("      wbHtml += '<div class=\"material-item\"><div class=\"info\"><div class=\"title\">' + "
           "escapeHTML(wb.name) + '</div><div class=\"meta\">' + (wb.source||'') + ' · ' + wordCount + "
           "' 词</div></div><div class=\"actions\"><button class=\"btn btn-sm btn-danger\" "
           "onclick=\"deleteWordbook(\\'' + wb.id + '\\')\">删除</button></div></div>';")
    assert html.count(old) == 1, '找不到单词书列表渲染'
    new = ("      var isBuiltin = (wb.id === BUILTIN_WB_ID || wb.builtin);\n"
           "      wbHtml += '<div class=\"material-item\"><div class=\"info\"><div class=\"title\">' + "
           "escapeHTML(wb.name) + (isBuiltin ? ' <span style=\"font-size:11px;padding:1px 6px;"
           "border-radius:8px;background:var(--bg3,#eef1f6);color:var(--text2);vertical-align:2px\">内置</span>' : '') "
           "+ '</div><div class=\"meta\">' + (wb.source||'') + ' · ' + wordCount + ' 词</div></div>"
           "<div class=\"actions\">' + (isBuiltin\n"
           "        ? '<button class=\"btn btn-sm btn-outline\" onclick=\"reinstallBuiltinWordbook()\">重装</button>'\n"
           "        : '<button class=\"btn btn-sm btn-danger\" onclick=\"deleteWordbook(\\'' + wb.id + '\\')\">删除</button>') "
           "+ '</div></div>';")
    html = html.replace(old, new, 1)

    with open(dst, 'w', encoding='utf-8', newline='') as f:
        f.write(html)
    print('写入:', dst, '%.0f KB' % (os.path.getsize(dst) / 1024), '词数:', count)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    a = ap.parse_args()
    patch(a.input, a.output)
