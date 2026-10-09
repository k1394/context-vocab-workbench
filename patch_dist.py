# -*- coding: utf-8 -*-
"""语境标注分布修复 + 章节底部导航

改动清单
  1. CSS    ：底部章节导航样式
  2. HTML   ：readingArea 之后插入底部导航条
  3. 模块   ：插入 patch_src/dist.js（签名、清旧、分布体检、底部导航渲染）
  4. 算法   ：pickMatchesByStrategy 的段遍历顺序改「等间隔铺开」
  5. 重算   ：regenerateMatches 先清旧（本地+云端）再生成，并记签名
  6. 判定   ：renderLearnInit 从「只有空才生成」改成「空 或 签名失配就重算」
  7. 渲染   ：refreshLearn 支持 resetScroll、渲染底部导航、加分布偏集中提示
  8. 导航   ：prevChapter / nextChapter 支持从底部跳转时回到文首
"""
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

    # ---------- 1. CSS ----------
    CSS_OLD = '.chapter-nav .btns{display:flex;gap:6px}'
    CSS_NEW = (CSS_OLD + '\n'
               '.chapter-nav.chapter-nav-bottom{margin:14px 0 0}\n'
               '.chapter-nav button:disabled{opacity:.4;cursor:not-allowed}\n'
               '.chapter-nav.chapter-nav-bottom .ch-title{text-align:center}\n'
               '.chapter-nav.chapter-nav-bottom .ch-progress{text-align:center}')
    assert html.count(CSS_OLD) == 1, 'chapter-nav CSS 锚点不唯一：%d' % html.count(CSS_OLD)
    html = html.replace(CSS_OLD, CSS_NEW, 1)
    n += 1

    # ---------- 2. HTML：底部导航 ----------
    BOTTOM_NAV = """
        <div class="chapter-nav chapter-nav-bottom" id="chapterNavBottom">
          <button class="btn btn-sm btn-outline" id="navPrevBtn" onclick="jumpChapter(-1, true)">&#8592; 上一章</button>
          <div>
            <div class="ch-title" id="chNavTitleBottom"></div>
            <div class="ch-progress" id="chNavProgressBottom"></div>
          </div>
          <button class="btn btn-sm btn-outline" id="navNextBtn" onclick="jumpChapter(1, true)">下一章 &#8594;</button>
        </div>"""
    # 线上平台会把 data-page-node-id 挪到属性最前面，所以不能写死属性顺序
    RA_RE = re.compile(r'(<div(?=[^>]*\bid="readingArea")[^>]*></div>)')
    assert len(RA_RE.findall(html)) == 1, 'readingArea 锚点不唯一：%d' % len(RA_RE.findall(html))
    html = RA_RE.sub(lambda m: m.group(1) + BOTTOM_NAV, html, count=1)
    n += 1

    # ---------- 3. 模块 ----------
    MOD_ANCHOR = '/* ===== 内置词书《六级词书》 ===== */'
    assert html.count(MOD_ANCHOR) == 1, '内置词书锚点不唯一'
    mod = load_module('dist.js').rstrip('\n')
    html = html.replace(MOD_ANCHOR, mod + '\n\n' + MOD_ANCHOR, 1)
    n += 1

    # ---------- 4. 算法：段遍历顺序等间隔铺开 ----------
    ROUND_OLD = """  // 一轮 = 按「已标注最少的段优先」各取最多 1 个新词（注水法，天然最均）
  function round() {
    var added = 0;
    var order = [];
    for (var i = 0; i < P; i++) order.push(i);
    order.sort(function(a, b) { return (used[a] - used[b]) || (a - b); });"""
    ROUND_NEW = """  // 段遍历顺序：目标词数不足以铺满所有段时按「等间隔」铺开。
  // 否则 18 段只标 10 个词时，词会全挤在前 10 段、后 8 段永远空白。
  var baseOrder = (function () {
    var n = Math.min(Math.max(1, target), P);
    if (n >= P) { var a = []; for (var i = 0; i < P; i++) a.push(i); return a; }
    var pri = [], seen = {}, stride = P / n;
    for (var k = 0; k < n; k++) {
      var idx = Math.round(k * stride) % P;
      while (seen[idx]) idx = (idx + 1) % P;
      seen[idx] = true; pri.push(idx);
    }
    var rest = [];
    for (var j = 0; j < P; j++) if (!seen[j]) rest.push(j);
    return pri.concat(rest);
  })();

  // 一轮 = 按「已标注最少的段优先」各取最多 1 个新词（注水法，天然最均）
  function round() {
    var added = 0;
    var order = baseOrder.slice();
    // Array.sort 在 ES2019+ 是稳定排序：used 相同时保持上面的等间隔次序
    order.sort(function(a, b) { return used[a] - used[b]; });"""
    assert html.count(ROUND_OLD) == 1, 'round() 锚点不唯一：%d' % html.count(ROUND_OLD)
    html = html.replace(ROUND_OLD, ROUND_NEW, 1)
    n += 1

    # ---------- 5. regenerateMatches：先清旧再生成 ----------
    REGEN_OLD = """  var allWords = buildLearnWordPool();
  if (allWords.length === 0) return 0;
  var target = (ch.targetWords && ch.targetWords >= 1) ? ch.targetWords : 30;
  var res = generateContextMatches(ch, allWords, 'all', target, getLearnOpts());
  if (!STATE.matches[matId]) STATE.matches[matId] = {};
  // 保留旧的手动修改（如果有 manual 字段）
  var oldMatches = STATE.matches[matId][chId] || [];
  var manualMatches = oldMatches.filter(function(m) { return m.manual; });"""
    REGEN_NEW = """  var allWords = buildLearnWordPool();
  if (allWords.length === 0) return 0;
  var target = (ch.targetWords && ch.targetWords >= 1) ? ch.targetWords : 30;
  var opts = getLearnOpts();
  if (!STATE.matches[matId]) STATE.matches[matId] = {};
  // 保留旧的手动修改（如果有 manual 字段）
  var oldMatches = STATE.matches[matId][chId] || [];
  var manualMatches = oldMatches.filter(function(m) { return m.manual; });
  // 旧的自动匹配必须一并清掉：只增不删的话，云端老分布会在下次刷新时
  // 被覆盖式加载拉回来，用户会觉得「点了重新生成还是老样子」
  var staleAuto = oldMatches.filter(function(m) { return !m.manual; });
  if (staleAuto.length) purgeAutoMatches(matId, chId, staleAuto);

  var res = generateContextMatches(ch, allWords, 'all', target, opts);"""
    assert html.count(REGEN_OLD) == 1, 'regenerateMatches 头部锚点不唯一：%d' % html.count(REGEN_OLD)
    html = html.replace(REGEN_OLD, REGEN_NEW, 1)

    REGEN_TAIL_OLD = """  ch.generated = true;
  saveLocal();
  // 同步到云端（仅同步新增的自动匹配）
  newNonManual.forEach(function(m) { syncMatchToCloud(matId, chId, m); });
  return STATE.matches[matId][chId].length;
}"""
    REGEN_TAIL_NEW = """  ch.generated = true;
  saveLocal();
  // 记下本次生成签名：这些参数没再变就不必重算
  matchSigSet(matId, chId, matchSigFor(ch, opts, allWords.length));
  // 同步到云端（分批推，一整本书几百条同时发会被限流）
  pushMatchesThrottled(matId, chId, newNonManual);
  return STATE.matches[matId][chId].length;
}"""
    assert html.count(REGEN_TAIL_OLD) == 1, 'regenerateMatches 尾部锚点不唯一：%d' % html.count(REGEN_TAIL_OLD)
    html = html.replace(REGEN_TAIL_OLD, REGEN_TAIL_NEW, 1)
    n += 1

    # ---------- 6. renderLearnInit：签名失配就重算 ----------
    NEED_OLD = """  var matId = STATE.learnMaterialId;
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
  } else if (needGen && STATE.words.length === 0) {"""
    NEED_NEW = """  var matId = STATE.learnMaterialId;
  var chs = STATE.chapters[matId] || [];
  var poolLen = buildLearnWordPool().length;
  var optsNow = getLearnOpts();
  var needGen = chs.some(function(ch) { return matchSigStale(matId, ch, optsNow, poolLen); });
  if (needGen && STATE.words.length > 0) {
    var total = 0, reGen = 0;
    chs.forEach(function(ch) {
      if (!STATE.matches[matId]) STATE.matches[matId] = {};
      if (!matchSigStale(matId, ch, optsNow, poolLen)) return;
      var had = ((STATE.matches[matId][ch.id] || []).length > 0);
      total += regenerateMatches(matId, ch.id) || 0;
      if (had) reGen++;
    });
    if (total > 0) {
      toast(reGen > 0
        ? ('已按最新分布设置重算 ' + reGen + ' 个章节的标注（共 ' + total + ' 处），标注会更均匀地铺到全章')
        : ('已为 ' + chs.length + ' 个空章节自动生成 ' + total + ' 个语境匹配'), 'ok');
      refreshLearn();
    }
  } else if (needGen && STATE.words.length === 0) {"""
    assert html.count(NEED_OLD) == 1, 'renderLearnInit 判定锚点不唯一：%d' % html.count(NEED_OLD)
    html = html.replace(NEED_OLD, NEED_NEW, 1)
    n += 1

    # ---------- 7a. refreshLearn 支持 resetScroll ----------
    RF_SIG_OLD = 'function refreshLearn() {\n  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;'
    RF_SIG_NEW = 'function refreshLearn(resetScroll) {\n  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;'
    assert html.count(RF_SIG_OLD) == 1, 'refreshLearn 签名锚点不唯一'
    html = html.replace(RF_SIG_OLD, RF_SIG_NEW, 1)

    RF_SCROLL_OLD = """  // 恢复滚动位置
  if (prog && prog.scrollPct) {
    setTimeout(function() {
      var area = document.getElementById('readingArea');
      area.scrollTop = area.scrollHeight * (prog.scrollPct / 100);
    }, 50);
  }"""
    RF_SCROLL_NEW = """  // 底部导航跳过来的（或显式要求）滚到文首，否则恢复上次阅读位置
  var _area = document.getElementById('readingArea');
  if (resetScroll) { _area.scrollTop = 0; }
  else if (prog && prog.scrollPct) {
    setTimeout(function() {
      _area.scrollTop = _area.scrollHeight * (prog.scrollPct / 100);
    }, 50);
  }
  renderChapterNav();"""
    assert html.count(RF_SCROLL_OLD) == 1, 'refreshLearn 滚动锚点不唯一'
    html = html.replace(RF_SCROLL_OLD, RF_SCROLL_NEW, 1)
    n += 1

    # ---------- 7b. 分布偏集中提示 ----------
    TIPS_OLD = """      if (ch.capBlocked > 0 && Object.keys(uniq).length < ((ch.targetWords && ch.targetWords >= 1) ? ch.targetWords : 30)) {
        tips.push('受「每段上限 ' + getLearnOpts().perParaMax + ' 处」限制，本章只标了 ' + Object.keys(uniq).length + ' 个词；想要更多请调大上限');
      }"""
    TIPS_NEW = TIPS_OLD + """
      var _health = matchDistHealth(matches, dist);
      if (_health.skewed) {
        tips.push('标注偏集中：前 1/3 段落承载了 ' + Math.round(_health.frontShare * 100) + '% 的标注。点「🔄 重新生成」可按当前分布设置重排到全章');
      }
      if (dist.length > 6 && Object.keys(uniq).length < dist.length) {
        tips.push('本章 ' + dist.length + ' 段但只标了 ' + Object.keys(uniq).length + ' 个词，后面的段落轮到不词；把「每章目标」调到 ' + dist.length + ' 以上可覆盖到每段');
      }"""
    assert html.count(TIPS_OLD) == 1, 'tips 锚点不唯一'
    html = html.replace(TIPS_OLD, TIPS_NEW, 1)
    n += 1

    # ---------- 8. 顶部导航也支持传参（保持兼容） ----------
    PREV_OLD = """function prevChapter() {
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
}"""
    PREV_NEW = """function prevChapter(fromBottom) { jumpChapter(-1, fromBottom); }
function nextChapter(fromBottom) { jumpChapter(1, fromBottom); }"""
    assert html.count(PREV_OLD) == 1, 'prevChapter/nextChapter 锚点不唯一'
    html = html.replace(PREV_OLD, PREV_NEW, 1)
    n += 1

    return html, n


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', default='index.html')
    ap.add_argument('--output', default=None)
    a = ap.parse_args()
    src = a.input
    dst = a.output or src
    with io.open(src, encoding='utf-8') as f:
        html = f.read()
    out, n = patch(html)
    with io.open(dst, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print('patch_dist.py: %d 处替换完成  %s -> %s' % (n, src, dst))


if __name__ == '__main__':
    main()
