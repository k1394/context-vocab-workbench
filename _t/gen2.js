function computeParaDist(matches, paragraphs) {
  var idx = [], d = [];
  for (var i = 0; i < paragraphs.length; i++) {
    if (!paragraphs[i].trim()) continue;
    idx.push(i); d.push(0);
  }
  var map = {};
  for (var k = 0; k < idx.length; k++) map[idx[k]] = k;
  for (var j = 0; j < matches.length; j++) {
    var pi = Math.floor(matches[j].position / 10000);
    if (map[pi] !== undefined) d[map[pi]]++;
  }
  return d;
}
function pickMatchesByStrategy(noOverlap, paragraphs, target, strategy, perParaMax, maxRepeat) {
  var P = paragraphs.length;

  // 旧行为：按文档顺序取前 target 个不同单词
  if (strategy === 'sequential' || P <= 1) {
    var keep0 = {}, uniq0 = [];
    for (var i = 0; i < noOverlap.length; i++) {
      var lm0 = noOverlap[i].lemma;
      if (!keep0[lm0] && uniq0.length < target) { keep0[lm0] = true; uniq0.push(lm0); }
    }
    var cnt0 = {}, out0 = [];
    for (var j = 0; j < noOverlap.length; j++) {
      var m0 = noOverlap[j];
      if (!keep0[m0.lemma]) continue;
      cnt0[m0.lemma] = (cnt0[m0.lemma] || 0) + 1;
      if (maxRepeat && maxRepeat > 0 && cnt0[m0.lemma] > maxRepeat) continue;
      out0.push(m0);
    }
    return { matches: out0, capBlocked: 0 };
  }

  var byPara = [], cap = [], len = [];
  for (var p = 0; p < P; p++) { byPara.push([]); len.push(paragraphs[p].length); }
  for (var q = 0; q < noOverlap.length; q++) {
    var pi = Math.floor(noOverlap[q].position / 10000);
    if (pi >= 0 && pi < P) byPara[pi].push(noOverlap[q]);
  }

  if (strategy === 'length') {
    var totalLen = 0;
    for (var t1 = 0; t1 < P; t1++) totalLen += len[t1];
    if (!totalLen) totalLen = 1;
    for (var t2 = 0; t2 < P; t2++) cap.push(Math.max(1, Math.round(target * len[t2] / totalLen)));
  } else {
    for (var t3 = 0; t3 < P; t3++) cap.push(perParaMax);
  }

  var cursor = [], used = [], chosen = [], chosenLemma = {};
  for (var u = 0; u < P; u++) { cursor.push(0); used.push(0); }

  // 一轮 = 按「已标注最少的段优先」各取最多 1 个新词（注水法，天然最均）
  function round() {
    var added = 0;
    var order = [];
    for (var i = 0; i < P; i++) order.push(i);
    order.sort(function(a, b) { return (used[a] - used[b]) || (a - b); });
    for (var oi = 0; oi < order.length; oi++) {
      if (chosen.length >= target) break;
      var pi = order[oi];
      if (used[pi] >= cap[pi]) continue;          // 每段上限是硬约束
      var list = byPara[pi];
      while (cursor[pi] < list.length) {
        var m = list[cursor[pi]++];
        if (chosenLemma[m.lemma]) continue;
        chosenLemma[m.lemma] = true;
        chosen.push(m);
        used[pi]++;
        added++;
        break;
      }
    }
    return added;
  }

  var guard = 0;
  while (chosen.length < target && guard++ < P * 40) { if (round() === 0) break; }

  // 有没有哪一段因为「每段上限」被卡住（还有候选却不能再取）
  var capBlocked = 0;
  for (var cb = 0; cb < P; cb++) {
    if (used[cb] >= cap[cb] && cursor[cb] < byPara[cb].length) capBlocked++;
  }

  // 收尾：同一个词跨段补至多 maxRepeat-1 处，同样不许突破每段上限
  if (maxRepeat > 1) {
    var byLemma = {}, home = {};
    for (var b = 0; b < noOverlap.length; b++) {
      var lb = noOverlap[b].lemma;
      if (!byLemma[lb]) byLemma[lb] = [];
      byLemma[lb].push(noOverlap[b]);
    }
    for (var h = 0; h < chosen.length; h++) {
      home[chosen[h].lemma] = Math.floor(chosen[h].position / 10000);
    }
    var extra = [];
    for (var key in home) {
      var occ = byLemma[key] || [];
      var need = maxRepeat - 1;
      var seenPara = {};
      seenPara[home[key]] = true;
      for (var o = 0; o < occ.length && need > 0; o++) {
        var op = Math.floor(occ[o].position / 10000);
        if (seenPara[op] || used[op] >= cap[op]) continue;
        seenPara[op] = true;
        used[op]++;
        extra.push(occ[o]);
        need--;
      }
    }
    chosen = chosen.concat(extra);
  }

  chosen.sort(function(a, b) { return a.position - b.position; });
  return { matches: chosen, capBlocked: capBlocked };
}
function generateContextMatches(chapter, words, repeatMode, targetWords, opts) {
  // repeatMode: 'all' | 'para_once' | 'chapter_once'
  targetWords = (targetWords && targetWords >= 1) ? targetWords : 30;
  opts = opts || {};
  var strategy = opts.strategy || 'balanced';
  var perParaMax = (opts.perParaMax >= 1) ? opts.perParaMax : 4;
  var maxRepeat = (opts.maxRepeatPerWord >= 1) ? opts.maxRepeatPerWord : 2;
  var strict = (opts.strictTrigger === false) ? false : true;

  var paragraphs = chapter.content.split(/\n\n+/);
  var all = [];
  var noTriggerWords = [];

  for (var wi = 0; wi < words.length; wi++) {
    var w = words[wi];
    var lemma = (w.lemma || '').toLowerCase().trim();
    if (!lemma) continue;
    if (strict && !/^[a-z][a-z'\-]{2,}$/.test(lemma)) continue;  // 太短的词头（no / nor / up）不参与
    var dictEntry = CONTEXT_DICT[lemma];
    var triggers = [];
    if (dictEntry && dictEntry.triggers) {
      for (var d = 0; d < dictEntry.triggers.length; d++) triggers.push(dictEntry.triggers[d]);
    }
    var extra = extractTriggersFromMeaning(w.meaning, strict);
    for (var e = 0; e < extra.length; e++) {
      if (triggers.indexOf(extra[e]) === -1) triggers.push(extra[e]);
    }
    if (triggers.length === 0) { noTriggerWords.push(lemma); continue; }
    var sense = dictEntry ? dictEntry.meaning : (w.meaning || '');

    var usedInChapter = false;
    for (var pi = 0; pi < paragraphs.length; pi++) {
      if (repeatMode === 'chapter_once' && usedInChapter) break;
      var para = paragraphs[pi];
      var usedInPara = false;
      for (var ti = 0; ti < triggers.length; ti++) {
        var trigger = triggers[ti];
        if (!trigger || trigger.length < 2) continue;
        var fromIdx = 0;
        while (true) {
          var idx = para.indexOf(trigger, fromIdx);
          if (idx === -1) break;
          fromIdx = idx + trigger.length;
          if (repeatMode === 'para_once' && usedInPara) break;
          // 提取所在句子（前后找句号/问号/感叹号）
          var sentStart = idx;
          for (var k = idx; k >= 0; k--) {
            if (/[。！？!?\n]/.test(para[k])) { sentStart = k + 1; break; }
          }
          var sentEnd = idx + trigger.length;
          for (var k2 = idx + trigger.length; k2 < para.length; k2++) {
            if (/[。！？!?\n]/.test(para[k2])) { sentEnd = k2 + 1; break; }
          }
          var sentence = para.substring(sentStart, Math.min(sentEnd + 20, para.length));
          all.push({
            lemma: lemma, chWord: trigger, sense: sense,
            position: idx + pi * 10000, sentence: sentence.trim(), manual: false,
            senseRank: ti
          });
          usedInPara = true;
          usedInChapter = true;
          if (repeatMode === 'para_once' || repeatMode === 'chapter_once') break;
        }
        if (repeatMode !== 'all' && usedInChapter) break;
      }
    }
  }

  // 按位置排序；同位置时长 trigger 优先，再按义项常用度（senseRank 小者优先）
  all.sort(function(a, b) {
    if (a.position !== b.position) return a.position - b.position;
    if (a.chWord.length !== b.chWord.length) return b.chWord.length - a.chWord.length;
    return (a.senseRank || 0) - (b.senseRank || 0);
  });
  // 剔除重叠（同一文本片段只保留一个标注）
  var noOverlap = [];
  var lastPi = -1, lastEnd = -1;
  for (var oi = 0; oi < all.length; oi++) {
    var m = all[oi];
    var mpi = Math.floor(m.position / 10000);
    var mpos = m.position - mpi * 10000;
    if (mpi === lastPi && mpos < lastEnd) continue;
    noOverlap.push(m);
    lastPi = mpi; lastEnd = mpos + m.chWord.length;
  }

  // ===== 分布化选词（核心改动）=====
  var pick = pickMatchesByStrategy(noOverlap, paragraphs, targetWords, strategy, perParaMax, maxRepeat);
  var picked = pick.matches;

  var keep = {};
  for (var pk = 0; pk < picked.length; pk++) keep[picked[pk].lemma] = true;
  var cappedOut = {};
  for (var co = 0; co < noOverlap.length; co++) {
    if (!keep[noOverlap[co].lemma]) cappedOut[noOverlap[co].lemma] = true;
  }
  var unmatched = Object.keys(cappedOut).concat(noTriggerWords);
  return {
    matches: picked,
    unmatched: unmatched,
    uniqueCount: Object.keys(keep).length,
    paraDist: computeParaDist(picked, paragraphs),
    capBlocked: pick.capBlocked || 0,
    targetWords: targetWords
  };
}
