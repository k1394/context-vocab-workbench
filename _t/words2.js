function extractTriggersFromMeaning(meaning) {
  if (!meaning) return [];
  var cleaned = String(meaning)
    .replace(/\[[^\]]*\]/g, ' ')                          // [音标]
    .replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ')     // 括号注释
    .replace(/\b(vt|vi|v|n|adj|adv|prep|conj|pron|num|art|int|aux|abbr|ad|pl|sing)\.\s*/gi, ' ') // 词性标记
    .replace(/[a-zA-Z\.\[\]<>《》【】「」『』]/g, ' ');
  var runs = cleaned.match(/[一-龥]{2,6}/g) || [];
  var seen = {}; var out = [];
  for (var i = 0; i < runs.length; i++) {
    var t = runs[i];
    if (!seen[t]) { seen[t] = true; out.push(t); }
  }
  return out.slice(0, 6); // 保持释义中的出现顺序（前面的义项更常用）
}
