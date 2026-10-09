# -*- coding: utf-8 -*-
"""阅读进度（saveScrollPos）+ 新增标注推云端失败补偿

改动清单
  1. 模块 ：插入 patch_src/polish.js（滚动层探测、进度保存/恢复、pendingAdd 补偿）
  2. 进度 ：saveScrollPos 从「读不滚动的 area.scrollTop」改成读真实滚动层
  3. 恢复 ：renderLearnChapter 的 prog.scrollPct 分支改用 restoreScrollPct()
  4. 补偿 ：syncMatchToCloud 的 CLOUD.add 失败改成「记 pendingAdd 墓碑」
  5. 补推 ：enterApp 加载完成后调 flushPendingAdds()

依赖：必须在 patch_cleanup.py 之后执行（改动点在同一段 enterApp 回调里）
"""
import argparse
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load_module(name):
    with io.open(os.path.join(HERE, 'patch_src', name), encoding='utf-8') as f:
        return f.read()


def patch(html):
    n = 0

    # ---------- 1. 模块 ----------
    MOD_ANCHOR = '/* ===== 内置词书《六级词书》 ===== */'
    assert html.count(MOD_ANCHOR) == 1, '内置词书锚点不唯一：%d' % html.count(MOD_ANCHOR)
    mod = load_module('polish.js').rstrip('\n')
    html = html.replace(MOD_ANCHOR, mod + '\n\n' + MOD_ANCHOR, 1)
    n += 1

    # ---------- 2. saveScrollPos 重写 ----------
    SSP_OLD = """function saveScrollPos() {
  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;
  var area = document.getElementById('readingArea');
  var pct = area.scrollHeight > 0 ? Math.round(area.scrollTop / area.scrollHeight * 100) : 0;
  if (!STATE.progress[STATE.learnMaterialId]) STATE.progress[STATE.learnMaterialId] = {};
  STATE.progress[STATE.learnMaterialId][STATE.learnChapterId].scrollPct = pct;
  STATE.progress[STATE.learnMaterialId][STATE.learnChapterId].updatedAt = nowISO();
  saveLocal();
  scheduleSync();
}"""
    SSP_NEW = """// 进度保存的实现已移到 patch_src/polish.js（读真实滚动层）。
// 旧实现必须删掉而不是留着：它读的是永远不会滚动的 area.scrollTop，恒为 0，
// 留着还会在同一个 script 块里把新实现覆盖掉。"""
    assert html.count(SSP_OLD) == 1, 'saveScrollPos 锚点不唯一：%d' % html.count(SSP_OLD)
    html = html.replace(SSP_OLD, SSP_NEW, 1)
    n += 1

    # ---------- 3. 恢复滚动位置 ----------
    RS_OLD = """  } else if (prog && prog.scrollPct) {
    var _area = document.getElementById('readingArea');
    setTimeout(function() {
      _area.scrollTop = _area.scrollHeight * (prog.scrollPct / 100);
    }, 50);
  }"""
    RS_NEW = """  } else if (prog && prog.scrollPct) {
    // 阅读区不是滚动容器，必须还原到真实滚动层上（见 polish.js）
    restoreScrollPct(prog.scrollPct);
  }"""
    assert html.count(RS_OLD) == 1, '恢复滚动位置锚点不唯一：%d' % html.count(RS_OLD)
    html = html.replace(RS_OLD, RS_NEW, 1)
    n += 1

    # ---------- 4. syncMatchToCloud 失败补偿 ----------
    SMC_OLD = """function syncMatchToCloud(matId, chId, m) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '资料ID': { text: matId },
    '章节ID': { text: chId },
    '词元': { text: m.lemma },
    '对应中文': { text: m.chWord },
    '使用义项': { text: m.sense || '' },
    '位置': { number: m.position || 0 },
    '所在句子': { text: m.sentence || '' },
    '手动修改': { checkbox: m.manual || false }
  };
  if (m._cloudId) CLOUD.update(DB_IDS.context_matches, m._cloudId, props);
  else CLOUD.add(DB_IDS.context_matches, props).then(function(r) { if (r && r.id) m._cloudId = r.id; });
}"""
    SMC_NEW = """function syncMatchToCloud(matId, chId, m) {
  if (!STATE.cloudReady) return;
  if (m._cloudId) {
    CLOUD.update(DB_IDS.context_matches, m._cloudId, {
      'profile_id': { text: STATE.profileId },
      '资料ID': { text: matId },
      '章节ID': { text: chId },
      '词元': { text: m.lemma },
      '对应中文': { text: m.chWord },
      '使用义项': { text: m.sense || '' },
      '位置': { number: m.position || 0 },
      '所在句子': { text: m.sentence || '' },
      '手动修改': { checkbox: m.manual || false }
    });
    return;
  }
  // 新增：以前失败只是静默丢掉 _cloudId，同一次会话内不会重试。
  // 现在失败记一条 pendingAdd 墓碑，进应用加载完成后集中补推（见 patch_src/polish.js）。
  pushOneMatch(matId, chId, m).then(function(ok) {
    if (!ok) {
      queuePendingAdd({
        matId: matId, chId: chId, lemma: m.lemma, chWord: m.chWord,
        position: m.position || 0, sense: m.sense || '',
        sentence: m.sentence || '', manual: !!m.manual
      });
    }
  });
}"""
    assert html.count(SMC_OLD) == 1, 'syncMatchToCloud 锚点不唯一：%d' % html.count(SMC_OLD)
    html = html.replace(SMC_OLD, SMC_NEW, 1)
    n += 1

    # ---------- 5. enterApp 里补推 ----------
    EA_OLD = """        purgeLegacySampleLeftovers();
        refreshAll();"""
    EA_NEW = """        purgeLegacySampleLeftovers();
        // 补推「上次没推上云端」的新增标注
        flushPendingAdds();
        refreshAll();"""
    assert html.count(EA_OLD) == 1, 'enterApp 补推锚点不唯一：%d' % html.count(EA_OLD)
    html = html.replace(EA_OLD, EA_NEW, 1)
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
    print('patch_polish: %d 处改动' % n)


if __name__ == '__main__':
    main()
