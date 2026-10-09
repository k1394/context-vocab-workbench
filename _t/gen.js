function generateContextMatches(chapter, words, repeatMode, targetWords) {
  // repeatMode: 'all' | 'para_once' | 'chapter_once'
  targetWords = (targetWords && targetWords >= 1) ? targetWords : 30;
  var paragraphs = chapter.content.split(/\n\n+/);
  var all = [];
  var noTriggerWords = [];

  for (var wi = 0; wi < words.length; wi++) {
    var w = words[wi];
    var lemma = (w.lemma || '').toLowerCase().trim();
    if (!lemma) continue;
    var dictEntry = CONTEXT_DICT[lemma];
    var triggers = [];
    if (dictEntry && dictEntry.triggers) {
      for (var d = 0; d < dictEntry.triggers.length; d++) triggers.push(dictEntry.triggers[d]);
    }
    var extra = extractTriggersFromMeaning(w.meaning);
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
  // 按文档出场顺序选取前 targetWords 个不同单词，其余进未匹配列表
  var keep = {}; var uniqueOrder = [];
  for (var ui = 0; ui < noOverlap.length; ui++) {
    var lm = noOverlap[ui].lemma;
    if (!keep[lm] && uniqueOrder.length < targetWords) { keep[lm] = true; uniqueOrder.push(lm); }
  }
  var finalMatches = noOverlap.filter(function(m) { return keep[m.lemma]; });
  var cappedOut = {};
  noOverlap.forEach(function(m) { if (!keep[m.lemma]) cappedOut[m.lemma] = true; });
  var unmatched = Object.keys(cappedOut).concat(noTriggerWords);
  return { matches: finalMatches, unmatched: unmatched, uniqueCount: uniqueOrder.length };
}

// ===== 重新生成语境材料 =====