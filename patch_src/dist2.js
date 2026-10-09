/* ===== 跳章回文首 + 每章目标词全书统一 =====
   问题一：点「下一章」后没有回到新章开头。
     根因： .reading-area 的 CSS 里没有 overflow / max-height，它本身不是滚动容器，
            area.scrollTop = 0 永远是空操作；真正滚动的是页面。另外 saveScrollPos()
            一直挂在 area 上读 scrollTop，也因为 area 不滚动而恒为 0。
   问题二：改了「每章目标」，别的章还是旧值；而且这个值只写本地、从不推云端，
            刷新一次就被云端旧值覆盖回来。
   ============================================================ */

// ---------- 一、跳章后回到「新章开头」 ----------

// 回文首的落点：优先顶部章节导航条（能看到章标题 + 正文开头），退而求其次才是阅读区
function learnScrollAnchor() {
  var area = document.getElementById('readingArea');
  if (!area) return null;
  var prev = area.previousElementSibling;
  if (prev && prev.classList && prev.classList.contains('chapter-nav')) return prev;
  return area;
}

// 真正把视图滚到当前章的开头（兼容「阅读区自滚动」与「页面整体滚动」两种布局）
function scrollToChapterStart() {
  var area = document.getElementById('readingArea');
  if (!area) return 0;
  // ① 阅读区自己若是滚动容器（将来给它加 max-height 时），先归零
  if (typeof area.scrollTop === 'number') { try { area.scrollTop = 0; } catch (e) { } }

  var anchor = learnScrollAnchor();
  if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return 0;

  var doc = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement : {};
  var hasWin = (typeof window !== 'undefined');
  var off = (hasWin && typeof window.pageYOffset === 'number')
    ? window.pageYOffset
    : (typeof doc.scrollTop === 'number' ? doc.scrollTop : 0);
  var y = anchor.getBoundingClientRect().top + off - 12;
  if (!(y > 0)) y = 0;

  var canWin = hasWin && typeof window.scrollTo === 'function';
  if (canWin) { try { window.scrollTo(0, y); } catch (e) { } }
  else { try { doc.scrollTop = y; } catch (e) { } }

  // ② 兜底：调了 scrollTo 页面却没动，说明滚动层在内层容器上 → 逐级归零
  if (canWin && y > 1 && typeof window.pageYOffset === 'number'
      && Math.abs(window.pageYOffset - off) < 2) {
    var p = area.parentElement, g = 0;
    while (p && g++ < 40) {
      if (typeof p.scrollTop === 'number' && typeof p.scrollHeight === 'number'
          && typeof p.clientHeight === 'number' && p.scrollHeight > p.clientHeight + 2) {
        try { p.scrollTop = 0; } catch (e) { }
      }
      p = p.parentElement;
    }
  }
  return y;
}

// ---------- 二、「每章目标」的规范化与统一 ----------

function normTargetWords(ch) {
  var v = ch && ch.targetWords;
  return (v && v >= 1) ? v : 30;
}

// 本书各章目标词是否一致（<2 章视为一致）
function targetWordsUniform(matId) {
  var chs = STATE.chapters[matId] || [];
  if (chs.length < 2) return true;
  var first = normTargetWords(chs[0]);
  for (var i = 1; i < chs.length; i++) {
    if (normTargetWords(chs[i]) !== first) return false;
  }
  return true;
}

// 只改当前章：写本地 + 推云端 + 重算本章
// 推云端这步很关键 —— 原来只 saveLocal()，刷新后被云端旧值覆盖，等于白改
function applyTargetToCurrentChapter(v) {
  var matId = STATE.learnMaterialId;
  var chs = STATE.chapters[matId] || [];
  var ch = null;
  for (var i = 0; i < chs.length; i++) { if (chs[i].id === STATE.learnChapterId) { ch = chs[i]; break; } }
  if (!ch) return 0;
  ch.targetWords = v;
  saveLocal();
  if (typeof syncChapterToCloud === 'function') syncChapterToCloud(matId, ch);
  var n = regenerateMatches(matId, ch.id) || 0;
  saveLocal();
  return n;
}

// 把本书所有章节统一为 v：逐章改值 + 推云端 + 重算
function applyTargetToAllChapters(v) {
  var matId = STATE.learnMaterialId;
  var chs = STATE.chapters[matId] || [];
  if (!chs.length) return { chapters: 0, total: 0, touched: 0, offline: !STATE.cloudReady };
  for (var i = 0; i < chs.length; i++) { chs[i].targetWords = v; }
  saveLocal();
  if (typeof syncChapterToCloud === 'function') {
    for (var j = 0; j < chs.length; j++) { syncChapterToCloud(matId, chs[j]); }
  }
  var total = 0, touched = 0;
  for (var k = 0; k < chs.length; k++) {
    var n = regenerateMatches(matId, chs[k].id) || 0;
    total += n;
    if (n > 0) touched++;
  }
  saveLocal();
  // 离线时 syncChapterToCloud 会直接 return，改动只落本机 —— 必须明确告诉用户
  return { chapters: chs.length, total: total, touched: touched, offline: !STATE.cloudReady };
}

// 信息条里的一键入口：以本章当前目标词为准，拉平全书
function unifyTargetWords() {
  var matId = STATE.learnMaterialId;
  var chs = STATE.chapters[matId] || [];
  var ch = null;
  for (var i = 0; i < chs.length; i++) { if (chs[i].id === STATE.learnChapterId) { ch = chs[i]; break; } }
  if (!ch) return;
  if (chs.length <= 1) { toast('本书只有 1 章，不需要统一', 'ok'); return; }
  var v = normTargetWords(ch);
  var r = applyTargetToAllChapters(v);
  refreshLearn();
  toast('已把 ' + r.chapters + ' 章的「每章目标」统一为 ' + v + ' 词，共重算 ' + r.total + ' 处标注', 'ok');
}
