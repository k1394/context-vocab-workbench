// 从中文释义中提取可用于语境匹配的中文触发词（剔除词性/音标/英文等噪声）
function extractTriggersFromMeaning(meaning, strict) {
  if (!meaning) return [];
  if (strict === undefined) strict = true;
  var cleaned = String(meaning)
    .replace(/\[[^\]]*\]/g, ' ')                          // [音标]
    .replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ')     // 括号注释
    .replace(/\b(vt|vi|v|n|adj|adv|prep|conj|pron|num|art|int|aux|abbr|ad|pl|sing)\.\s*/gi, ' ') // 词性标记
    .replace(/[a-zA-Z\.\[\]<>《》【】「」『』]/g, ' ');
  var runs = cleaned.match(/[一-龥]{2,6}/g) || [];
  var seen = {}; var out = [];
  for (var i = 0; i < runs.length; i++) {
    var t = runs[i];
    if (seen[t]) continue;
    seen[t] = true;
    if (strict) {
      if (/[的了着]$/.test(t)) continue;                 // 「上的」「新的」这类修饰片段不能当触发词
      if (t.length === 2 && out.length > 0) continue;    // 2 字触发词只认释义里的第一个义项
      if (out.length >= 3) break;                        // 最多 3 个触发词
    }
    out.push(t);
  }
  return strict ? out : out.slice(0, 6); // 非严格模式保持释义中的出现顺序，取前 6 个
}
