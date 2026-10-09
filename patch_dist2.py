# -*- coding: utf-8 -*-
"""跳章回到文首 + 「每章目标」全书统一

改动清单
  1. 模块 ：插入 patch_src/dist2.js（回文首、目标词规范化/统一/一键拉平）
  2. 确认框：showConfirm 支持第 4 个参数 onCancel（向后兼容，不传即原行为）
  3. 滚动 ：refreshLearn 的 resetScroll 分支从「area.scrollTop = 0」（空操作）
            改成 scrollToChapterStart()，真正滚到新章开头
  4. 跳章 ：jumpChapter 一律 refreshLearn(true)，顶部/底部导航行为一致
  5. 目标 ：onTargetWordsChange 支持「确认=全书统一 / 取消=仅本章」，且改完推云端
  6. 提示 ：信息条检测到各章目标词不一致时给出「一键统一」入口

依赖：必须在 patch_dist.py 之后执行（它插入 dist.js 并改写 refreshLearn/jumpChapter）
"""
import io
import os
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
    mod = load_module('dist2.js').rstrip('\n')
    html = html.replace(MOD_ANCHOR, mod + '\n\n' + MOD_ANCHOR, 1)
    n += 1

    # ---------- 2. showConfirm 支持 onCancel ----------
    CF_OLD = """function showConfirm(title, msg, onOk) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  var btn = document.getElementById('confirmOkBtn');
  btn.onclick = function() { closeModal('confirmModal'); if (onOk) onOk(); };
  document.getElementById('confirmModal').classList.add('show');
}"""
    CF_NEW = """function showConfirm(title, msg, onOk, onCancel) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  var modal = document.getElementById('confirmModal');
  var btn = document.getElementById('confirmOkBtn');
  var cancelBtn = modal ? modal.querySelector('.modal-actions .btn-outline') : null;
  var settled = false;
  btn.onclick = function() {
    if (settled) return;
    settled = true;
    closeModal('confirmModal');
    if (onOk) onOk();
  };
  // 取消按钮的 inline onclick 会被这里的赋值覆盖，所以必须自己关弹窗
  if (cancelBtn) cancelBtn.onclick = function() {
    if (settled) return;
    settled = true;
    closeModal('confirmModal');
    if (onCancel) onCancel();
  };
  // 点遮罩关闭也按「取消」处理（否则用户以为选了取消，其实什么都没发生）
  if (modal) modal.onclick = function(ev) {
    if (ev.target !== modal || settled) return;
    settled = true;
    closeModal('confirmModal');
    if (onCancel) onCancel();
  };
  if (modal) modal.classList.add('show');
}"""
    assert html.count(CF_OLD) == 1, 'showConfirm 锚点不唯一：%d' % html.count(CF_OLD)
    html = html.replace(CF_OLD, CF_NEW, 1)
    n += 1

    # ---------- 3. refreshLearn：resetScroll 走真正的滚动 ----------
    RF_OLD = """  // 底部导航跳过来的（或显式要求）滚到文首，否则恢复上次阅读位置
  var _area = document.getElementById('readingArea');
  if (resetScroll) { _area.scrollTop = 0; }
  else if (prog && prog.scrollPct) {
    setTimeout(function() {
      _area.scrollTop = _area.scrollHeight * (prog.scrollPct / 100);
    }, 50);
  }
  renderChapterNav();"""
    RF_NEW = """  // 跳章 → 回到新章的开头。注意 .reading-area 没有 overflow，
  // 它自己并不滚动，直接设 scrollTop 是空操作，必须去滚页面/祖先容器
  if (resetScroll) {
    scrollToChapterStart();
  } else if (prog && prog.scrollPct) {
    var _area = document.getElementById('readingArea');
    setTimeout(function() {
      _area.scrollTop = _area.scrollHeight * (prog.scrollPct / 100);
    }, 50);
  }
  renderChapterNav();"""
    assert html.count(RF_OLD) == 1, 'refreshLearn 滚动锚点不唯一：%d' % html.count(RF_OLD)
    html = html.replace(RF_OLD, RF_NEW, 1)
    n += 1

    # ---------- 4. jumpChapter：换章一律回文首 ----------
    JC_OLD = """  var sel = document.getElementById('selChapter');
  if (sel) sel.value = STATE.learnChapterId;
  refreshLearn(!!fromBottom);
}"""
    JC_NEW = """  var sel = document.getElementById('selChapter');
  if (sel) sel.value = STATE.learnChapterId;
  // 换章一律从新章的文首读起（fromBottom 保留在签名里兼容既有调用）
  refreshLearn(true);
}"""
    assert html.count(JC_OLD) == 1, 'jumpChapter 锚点不唯一：%d' % html.count(JC_OLD)
    html = html.replace(JC_OLD, JC_NEW, 1)
    n += 1

    # ---------- 5. onTargetWordsChange：批量统一 ----------
    TW_OLD = """function onTargetWordsChange() {
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
}"""
    TW_NEW = """function onTargetWordsChange() {
  var el = document.getElementById('targetWordsInput');
  var v = parseInt(el ? el.value : '30', 10);
  if (!v || v < 5) v = 30;
  if (v > 500) v = 500;
  if (el) el.value = v;

  var matId = STATE.learnMaterialId;
  var chs = STATE.chapters[matId] || [];
  var cur = null;
  for (var i = 0; i < chs.length; i++) { if (chs[i].id === STATE.learnChapterId) { cur = chs[i]; break; } }
  if (!cur) return;

  // 只有一章，直接改，不用问
  if (chs.length <= 1) {
    var n0 = applyTargetToCurrentChapter(v);
    refreshLearn();
    toast('本章目标已设为 ' + v + ' 词，重算 ' + n0 + ' 处标注' + offlineHint(), 'ok');
    return;
  }

  // 多章：问一次。「确认」= 全书统一；「取消」= 只改本章（改了就一定生效，
  // 不会出现「改了值却没反应」的困惑）
  showConfirm('「每章目标」改为 ' + v + ' 词',
    '本书共 ' + chs.length + ' 章' + (targetWordsUniform(matId) ? '' : '（当前各章目标不一致）') + '。'
      + '「确认」= 全部 ' + chs.length + ' 章统一为 ' + v + ' 词；'
      + '「取消」= 只改当前章（' + cur.title + '）。'
      + '两种方式都会按新目标重新生成标注，手动改过的标注会保留。',
    function() {
      var r = applyTargetToAllChapters(v);
      refreshLearn();
      toast('已把 ' + r.chapters + ' 章的「每章目标」统一为 ' + v + ' 词，共重算 ' + r.total + ' 处标注'
        + (r.offline ? '（当前离线，改动只在本机；连上云端后再改一次即可同步）' : ''), 'ok');
    },
    function() {
      var n1 = applyTargetToCurrentChapter(v);
      refreshLearn();
      toast('只把本章设为 ' + v + ' 词（重算 ' + n1 + ' 处）' + offlineHint() + '；要全书统一请再改一次并点「确认」', 'ok');
    }
  );
}"""
    assert html.count(TW_OLD) == 1, 'onTargetWordsChange 锚点不唯一：%d' % html.count(TW_OLD)
    html = html.replace(TW_OLD, TW_NEW, 1)
    n += 1

    # ---------- 5b. offlineHint：离线改动的提示 ----------
    OH_ANCHOR = """function onTargetWordsChange() {"""
    OH_NEW = """// 离线时 syncChapterToCloud 直接 return，目标词只落本机，得提示用户
function offlineHint() {
  return STATE.cloudReady ? '' : '（当前离线，已存在本机；连上云端后再改一次即可同步）';
}

function onTargetWordsChange() {"""
    assert html.count(OH_ANCHOR) == 1, 'onTargetWordsChange 头部锚点不唯一'
    html = html.replace(OH_ANCHOR, OH_NEW, 1)
    n += 1

    # ---------- 6. 信息条：各章目标不一致时给一键入口 ----------
    TIP_OLD = """      if (dist.length > 6 && Object.keys(uniq).length < dist.length) {
        tips.push('本章 ' + dist.length + ' 段但只标了 ' + Object.keys(uniq).length + ' 个词，后面的段落轮到不词；把「每章目标」调到 ' + dist.length + ' 以上可覆盖到每段');
      }"""
    TIP_NEW = TIP_OLD + """
      if (chs.length > 1 && !targetWordsUniform(STATE.learnMaterialId)) {
        var _tw = normTargetWords(ch);
        tips.push('本书各章「每章目标」不一致（本章 ' + _tw + ' 词）；'
          + '<a href="javascript:void(0)" style="color:var(--green-d);text-decoration:underline" '
          + 'onclick="unifyTargetWords()">一键统一为本章的 ' + _tw + ' 词</a>');
      }"""
    assert html.count(TIP_OLD) == 1, 'tips 锚点不唯一：%d' % html.count(TIP_OLD)
    html = html.replace(TIP_OLD, TIP_NEW, 1)
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
    print('patch_dist2.py: %d 处替换完成  %s -> %s' % (n, src, dst))


if __name__ == '__main__':
    main()
