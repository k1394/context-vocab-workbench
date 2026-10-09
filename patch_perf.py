# -*- coding: utf-8 -*-
"""v31 平板卡顿与首屏体积整治（A 出拳、C 收尾、B 减重）

背景：用户问「为什么用平板看这个网站特别卡？」
实测（`_t/perf_tablet*.js`，CPU 降频 6 倍 + WiFi 10Mbps 模拟平板）：

  A 主因 —— 滚动时对「铺满整章」的笔迹画布整块 clearRect
     整页大画布 + 滚动重绘 → 44 次长任务 / 累计卡 7382ms
     整页大画布 + 不重绘   → 0 次 / 0ms
     画布缩成 2×2 + 滚动重绘 → 0 次 / 0ms
     → A 的改动落在 `patch_src/draw.js` + `patch_draw.py`（画布只盖一屏、
       滚动平移到当前这一屏、视口外整笔剔除、滚动重绘合并到一帧一次）。
       本文件只负责下面这些「同一个文件里的零散点」。

  C 收尾 —— 三处小刀
     C1 saveLocal 只写内容变了的 key（实测 67.6ms/次，2.44MB 全量序列化 + 14 次同步写）
     C2 滚动监听里把便宜的节流判断提到 getBoundingClientRect 之前（→ patch_src/polish.js）
     C3 切章渲染分帧（实测一次性重建 innerHTML 773ms，主线程全程阻塞）

  B 减重 —— pdf.js 内核 + 中文 CMap 改成按需注入
     pdf.min.js(约 320KB) 与 cmaps_inline.js(约 250KB) 原本是普通 <script>，
     首屏就要解析+编译；平板上读文字根本用不到。现在改成 type="text/plain"
     （浏览器不当 JS 编译），第一次真的导入 PDF 时才塞进一个真 <script> 执行。

⚠ 本补丁必须在补丁链**最后**跑（build_index.py 里排在 patch_draw.py 之后），
  因为它的锚点取的是前面所有补丁叠加之后的最终文本。
⚠ pdf 那段的惰性化只写在这里，没有回写到 patch_pdf.py —— build_index.py 不调用
  patch_pdf.py（pdf 块在基线 index.html.bak5 里已经就位），所以不冲突；
  万一将来要在 bak5 上重跑 patch_pdf.py，本文件的 pdf 锚点会直接 assert 失败，
  不会静默出错。
"""
import argparse
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


# ============================================================
# C1-a  LS 增加 setJSON：已经序列化好的字符串直接写，省一次重复 stringify
# ============================================================
LS_SET_OLD = """  set: function(key, val) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); }
    catch(e) {
      // 存储写满时浏览器会抛 QuotaExceededError；留痕以便调用方回读校验
      console.error('LS set err', e);
      LS.saveFailed = true;
      LS.lastError = (e && e.name) ? e.name : String(e);
    }
  },"""

LS_SET_NEW = """  set: function(key, val) {
    try {
      var __s = JSON.stringify(val);
      localStorage.setItem(LS_PREFIX + key, __s);
      // ★ 让「差异写盘」的比对缓存跟着一起记账。
      //   项目里还有十几处直接 LS.set 的写入（learnOpts / users / matches…），
      //   它们绕过 saveLocalKey。只要有一次直写而缓存不更新，之后就可能
      //   误判「内容没变」而漏写 —— 那是真的丢数据，不是省时间。
      if (typeof _LS_WRITTEN !== 'undefined' && _LS_WRITTEN) _LS_WRITTEN[key] = __s;
    }
    catch(e) {
      // 存储写满时浏览器会抛 QuotaExceededError；留痕以便调用方回读校验
      console.error('LS set err', e);
      LS.saveFailed = true;
      LS.lastError = (e && e.name) ? e.name : String(e);
    }
  },
  // ★ 已经序列化好的 JSON 直接写：调用方要拿字符串做「内容变没变」的比对，
  //   顺手把它写进去，省掉一次重复的 JSON.stringify（大对象上这笔不便宜）
  setJSON: function(key, json) {
    try {
      localStorage.setItem(LS_PREFIX + key, json);
      if (typeof _LS_WRITTEN !== 'undefined' && _LS_WRITTEN) _LS_WRITTEN[key] = json;
      return true;
    }
    catch(e) {
      console.error('LS set err', e);
      LS.saveFailed = true;
      LS.lastError = (e && e.name) ? e.name : String(e);
      return false;
    }
  },"""

# ============================================================
# C1-b  saveLocal：只写内容变了的 key
# ============================================================
SAVE_OLD = """function saveLocal() {
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
  if (STATE.notes) LS.set('notes_v1_' + pid, STATE.notes);   // 划线笔记
}"""

SAVE_NEW = """// ★ 写盘前先比内容：内容没变的 key 直接跳过。
//   为什么值得做：阅读进度是「滚动停 400ms 就保存一次」，
//   而 saveLocal 要把 **2.44MB** 全部序列化（chapters 0.96MB + matches 0.98MB
//   + words 0.5MB）再同步写 14 个 localStorage key —— 实测 **67.6ms/次**，
//   主线程全程阻塞，滚动时一顿一顿的。实际上每次真正变的往往只是
//   progress 里的一个百分比。现在只写变了的那些。
//   · 比对的是「序列化后的字符串」，所以 push 进数组这种原地修改也能发现
//   · 写失败（配额满）不记账，下次调用仍会重试
var _LS_WRITTEN = {};
function saveLocalKey(key, value) {
  var s;
  try { s = JSON.stringify(value); } catch (e) { return false; }
  if (_LS_WRITTEN[key] === s) return true;              // 内容没变，不碰 localStorage
  var errBefore = LS.lastError;
  var ok;
  if (typeof LS.setJSON === 'function') {
    ok = LS.setJSON(key, s);
  } else {
    LS.set(key, value);
    ok = (LS.lastError === errBefore);
  }
  if (!ok) { delete _LS_WRITTEN[key]; return false; }   // 没写成功就别记账
  _LS_WRITTEN[key] = s;
  return true;
}
// 数据被整体换过（换账号 / 云端整表拉回 / 导入）之后作废比对缓存，
// 否则可能出现「以为没变、其实要落盘」的假跳过。
function resetLocalWriteCache() { _LS_WRITTEN = {}; }

function saveLocal() {
  if (!STATE.profileId) return;
  var pid = STATE.profileId;
  saveLocalKey('materials_' + pid, STATE.materials);
  // 内置词书不落本地存储：页面自带，每次进页面重装即可，省下几百 KB 配额
  saveLocalKey('wordbooks_' + pid, STATE.wordbooks.filter(function(w) { return !w.builtin; }));
  saveLocalKey('words_' + pid, STATE.words.filter(function(w) { return w.wordbookId !== BUILTIN_WB_ID; }));
  saveLocalKey('chapters_' + pid, STATE.chapters);
  if (STATE.learnOpts) saveLocalKey('learnOpts_' + pid, STATE.learnOpts);
  saveLocalKey('matches_' + pid, STATE.matches);
  saveLocalKey('progress_' + pid, STATE.progress);
  saveLocalKey('sessions_' + pid, STATE.sessions);
  saveLocalKey('mastery_' + pid, STATE.mastery);
  saveLocalKey('vocab_' + pid, STATE.vocab);
  saveLocalKey('synonyms_' + pid, STATE.synonyms);
  saveLocalKey('answers_' + pid, STATE.answers);
  saveLocalKey('review_' + pid, STATE.reviewQueue);
  if (STATE.notes) saveLocalKey('notes_v1_' + pid, STATE.notes);   // 划线笔记
}"""

# ============================================================
# C3-a  分帧渲染的两个工具函数（插在 refreshLearn 之前）
# ============================================================
RENDER_UTIL = """// ---------- 正文分帧渲染（切章不再一次阻塞 0.7 秒）----------
// 实测：60 段 / 180 个词标注的一章，一次性重建 innerHTML 在降频平板上要 773ms，
// 主线程全程阻塞（页面点不动）。这里把段落切成小批、每帧铺一批。
//   · 永远切在 </p> 边界上 → 不会把半截标签/半截文字塞进 DOM
//   · 用「代号」防串台：连着切两章时，旧的那次渲染会自己停手
//   · 全部铺完再回调 —— 划线标记、章节导航、滚动还原都要等正文齐了再动
//     （正文没铺完时 scrollHeight 是半截的，按百分比还原会落到错位置）
var READING_RENDER_STEP = 12;
var _READING_RENDER_GEN = 0;
function readingRaf(fn) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(fn);
  }
  return setTimeout(fn, 16);
}
function renderReadingAreaChunked(html, done) {
  var area = document.getElementById('readingArea');
  if (!area || typeof area.insertAdjacentHTML !== 'function') {
    if (area) area.innerHTML = html;
    if (typeof done === 'function') done();
    return;
  }
  var gen = ++_READING_RENDER_GEN;
  var parts = String(html == null ? '' : html).split('</p>');
  // 小章按 12 段/帧；超大章适当加大，但封顶 40 段，别又变成一次大阻塞
  var step = Math.max(READING_RENDER_STEP, Math.min(40, Math.ceil(parts.length / 8)));
  var i = 0;
  area.innerHTML = '';
  function chunk() {
    if (gen !== _READING_RENDER_GEN) return;      // 已被更新的一次渲染取代 → 停手
    var buf = '';
    var end = Math.min(i + step, parts.length);
    for (; i < end; i++) buf += (i === parts.length - 1) ? parts[i] : (parts[i] + '</p>');
    if (buf) area.insertAdjacentHTML('beforeend', buf);
    if (i < parts.length) readingRaf(chunk);
    else if (typeof done === 'function') done();
  }
  chunk();
}

"""

# ============================================================
# C3-b  渲染收尾改成「铺完再收尾」
# ============================================================
TAIL_OLD = """  document.getElementById('readingArea').innerHTML = html;
  // 划线笔记：正文刚重建完，立刻把已有的划线标回去（否则每次切模式都会丢标记）
  if (typeof renderNoteHighlights === 'function') renderNoteHighlights();
  if (typeof renderNotePanel === 'function') renderNotePanel();

  // 跳章 → 回到新章的开头。注意 .reading-area 没有 overflow，
  // 它自己并不滚动，直接设 scrollTop 是空操作，必须去滚页面/祖先容器
  if (resetScroll) {
    scrollToChapterStart();
  } else if (prog && prog.scrollPct) {
    // 阅读区不是滚动容器，必须还原到真实滚动层上（见 polish.js）
    restoreScrollPct(prog.scrollPct);
  }
  renderChapterNav();"""

TAIL_NEW = """  // ★ v31：正文改成小批分帧铺开（原来一次性重建 innerHTML，实测一章 773ms 全阻塞）。
  //   所有「依赖正文已经就位」的收尾动作都挪进回调里：
  //   划线标记 / 章节导航 / 滚动还原 —— 尤其滚动还原，
  //   正文只铺了一半时 scrollHeight 也是半截的，这时按百分比还原必然落错位置。
  renderReadingAreaChunked(html, function () {
    // 划线笔记：正文刚重建完，立刻把已有的划线标回去（否则每次切模式都会丢标记）
    if (typeof renderNoteHighlights === 'function') renderNoteHighlights();
    if (typeof renderNotePanel === 'function') renderNotePanel();

    // 跳章 → 回到新章的开头。注意 .reading-area 没有 overflow，
    // 它自己并不滚动，直接设 scrollTop 是空操作，必须去滚页面/祖先容器
    if (resetScroll) {
      scrollToChapterStart();
    } else if (prog && prog.scrollPct) {
      // 阅读区不是滚动容器，必须还原到真实滚动层上（见 polish.js）
      restoreScrollPct(prog.scrollPct);
    }
    renderChapterNav();
  });"""

# ============================================================
# B  pdf.js 内核 / 中文 CMap 惰性化
# ============================================================
PDF_INIT_ANCHOR = "function initPdfSupport() {"

PDF_LAZY_FUNCS = """// ★ v31：pdf.js 内核（约 320KB）与中文 CMap（约 250KB）改成「点了 PDF 才装」。
//   它们原来是普通 <script>，首屏就要下载 + 解析 + 编译一遍；
//   平板上读文字根本用不到，可每次都白付这笔钱。现在它们躺在
//   <script type="text/plain"> 里（浏览器不当 JS 编译），需要时再塞进一个真
//   <script> 执行 —— 同步执行，append 完就能用。
var PDF_LAZY_IDS = ['pdfjsLibCode', 'pdfjsCMapCode'];
var _PDF_CORE_TRIED = false;
function injectLazyScript(id) {
  var el = document.getElementById(id);
  if (!el) return false;
  var src = el.textContent || el.innerText || '';
  if (!src || src.length < 100) return false;
  var s = document.createElement('script');
  s.textContent = src;
  var host = document.head || document.documentElement || document.body;
  if (!host || typeof host.appendChild !== 'function') return false;
  host.appendChild(s);
  return true;
}
// 确保 pdf.js 内核就绪。第一次调用会把两大块惰性代码注入并执行。
function ensurePdfCore() {
  if (PDF_SUPPORT.ready) return true;
  if (_PDF_CORE_TRIED && !PDF_SUPPORT.ready) return false;
  _PDF_CORE_TRIED = true;
  if (typeof pdfjsLib === 'undefined') {
    for (var i = 0; i < PDF_LAZY_IDS.length; i++) {
      if (!injectLazyScript(PDF_LAZY_IDS[i])) {
        PDF_SUPPORT.reason = '缺少解析内核（' + PDF_LAZY_IDS[i] + '）';
        return false;
      }
    }
  }
  initPdfSupport();
  return PDF_SUPPORT.ready === true;
}

function initPdfSupport() {"""

PDF_TAIL_OLD = ("if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initPdfSupport); } "
                "else { initPdfSupport(); }")

PDF_TAIL_NEW = ("// ★ 首屏不再预热 pdf.js：内核与 CMap 由 ensurePdfCore() 在第一次导入 PDF 时按需注入，\n"
                "//   没导入过 PDF 的用户一个字节都不用付。\n"
                "//   （原来这里是在 DOMContentLoaded 上直接 initPdfSupport()，等于让所有人都先编译一遍。）")

EXTRACT_OLD = """    if (!PDF_SUPPORT.ready) {
      reject(new Error('PDF 解析组件未就绪' + (PDF_SUPPORT.reason ? '（' + PDF_SUPPORT.reason + '）' : '')));
      return;
    }"""

EXTRACT_NEW = """    // 按需装载 pdf.js 内核（首屏不再编译这两大块）
    if (!ensurePdfCore()) {
      reject(new Error('PDF 解析组件未就绪' + (PDF_SUPPORT.reason ? '（' + PDF_SUPPORT.reason + '）' : '')));
      return;
    }"""

UPLOAD_OLD = """function handlePdfUpload(file, type) {
  if (file.size > 40 * 1024 * 1024) { toast('PDF 过大（超过 40MB），建议先拆分或压缩后再上传', 'err'); return; }
  toast('正在解析 PDF：' + file.name + ' …', '', 120000);"""

UPLOAD_NEW = """function handlePdfUpload(file, type) {
  if (file.size > 40 * 1024 * 1024) { toast('PDF 过大（超过 40MB），建议先拆分或压缩后再上传', 'err'); return; }
  // 第一次用 PDF 功能时要先把解析内核装起来，多等一点点，告知用户原因
  if (!PDF_SUPPORT.ready) toast('首次使用 PDF 功能，正在加载解析内核…', '', 120000);
  else toast('正在解析 PDF：' + file.name + ' …', '', 120000);"""


def patch(html):
    n = 0

    def rep(old, new, tag):
        nonlocal html, n
        c = html.count(old)
        if c != 1:
            print('[FAIL] 锚点不唯一(%d): %s' % (c, tag))
            sys.exit(1)
        html = html.replace(old, new, 1)
        n += 1

    # ---------- C1：写盘只写变了的 key ----------
    rep(LS_SET_OLD, LS_SET_NEW, 'C1 LS.setJSON')
    rep(SAVE_OLD, SAVE_NEW, 'C1 saveLocal 差异写盘')

    # 登录 / 切号时 STATE 里的数据会被整体换掉，写盘比对缓存必须作废
    rep('function finalizeLogin(nick, hash, pid, prevUser, msg) {',
        'function finalizeLogin(nick, hash, pid, prevUser, msg) {\n'
        '  // ★ 登录/切号 = 数据整体换了一套：写盘比对缓存作废，避免误判「没变」漏写\n'
        '  if (typeof resetLocalWriteCache === "function") resetLocalWriteCache();',
        'C1 登录时作废写盘缓存')

    # ---------- C3：切章渲染分帧 ----------
    rep('function refreshLearn(resetScroll) {',
        RENDER_UTIL + 'function refreshLearn(resetScroll) {',
        'C3 分帧渲染工具函数')
    rep(TAIL_OLD, TAIL_NEW, 'C3 渲染收尾进回调')

    # ---------- B：pdf.js 惰性加载 ----------
    rep(PDF_INIT_ANCHOR, PDF_LAZY_FUNCS, 'B ensurePdfCore')
    rep(PDF_TAIL_OLD, PDF_TAIL_NEW, 'B 去掉首屏预热')
    rep(EXTRACT_OLD, EXTRACT_NEW, 'B extractPdfText 按需装载')
    rep(UPLOAD_OLD, UPLOAD_NEW, 'B 首次加载提示')

    # 把 pdf.js 内核与 CMap 两块从「普通 script」改成惰性 text/plain
    marker = '<script id="pdfjsWorkerCode" type="text/plain">'
    i = html.find(marker)
    if i < 0:
        print('[FAIL] 找不到 pdfjsWorkerCode 块')
        sys.exit(1)
    j = html.index('</script>', i)

    work_open = html.index('<script>', j)
    work_close = html.index('</script>', work_open)
    cmap_open = html.index('<script>', work_close)
    cmap_close = html.index('</script>', cmap_open)

    lib_src = html[work_open + len('<script>'):work_close]
    cmap_src = html[cmap_open + len('<script>'):cmap_close]
    for nm, src in (('pdf 内核', lib_src), ('中文 CMap', cmap_src)):
        if '</script' in src.lower():
            print('[FAIL] %s 内容里含 </script，没法放进惰性块' % nm)
            sys.exit(1)
    if len(lib_src) < 100000 or len(cmap_src) < 100000:
        print('[FAIL] pdf 块长度异常（内核 %d / CMap %d），先别改' % (len(lib_src), len(cmap_src)))
        sys.exit(1)

    html = (html[:work_open]
            + '<script id="pdfjsLibCode" type="text/plain">' + lib_src + '</script>\n'
            + '<script id="pdfjsCMapCode" type="text/plain">' + cmap_src + '</script>'
            + html[cmap_close + len('</script>'):])
    n += 1

    return html, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    args = ap.parse_args()
    html = read(args.input)
    before = len(html)
    html, n = patch(html)
    write(args.output, html)
    print('patch_perf: %d 处改动  %d -> %d 字节' % (n, before, len(html)))


if __name__ == '__main__':
    main()
