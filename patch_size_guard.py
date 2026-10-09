# -*- coding: utf-8 -*-
"""给语境背单词工作台加入「资料体积预算」防护。

背景：资料库数据表单行有 1MB 硬上限（服务端码 56153，直接拒绝、不重试）。
一篇资料落库要同时写「原始文本」和「章节JSON」，章节里又含一份完整正文，故实际体积≈正文 2 倍。
此前超限时云端静默失败、本地存储写满也静默失败 —— 用户看到「导入成功」，换设备才发现资料没了。
本补丁：导入前估算体积，超限自动按章节/段落边界拆成多篇；并对本地写盘做回读校验 + 云端硬错误兜底提示。
"""
import io, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))

def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)

def apply(inp, outp):
    html = read(inp)
    orig_len = len(html)
    reps = []

    def rep(old, new, tag):
        nonlocal html
        if old not in html:
            print('[FAIL] 未找到锚点: ' + tag)
            sys.exit(1)
        n = html.count(old)
        if n != 1:
            print('[FAIL] 锚点不唯一(%d): %s' % (n, tag))
            sys.exit(1)
        html = html.replace(old, new)
        reps.append(tag)

    # ---- ① LS.set 失败时留痕（原来只 console.error） ----
    rep(
        u"  set: function(key, val) {\n"
        u"    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch(e) { console.error('LS set err', e); }\n"
        u"  },",
        u"  set: function(key, val) {\n"
        u"    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); }\n"
        u"    catch(e) {\n"
        u"      // 存储写满时浏览器会抛 QuotaExceededError；留痕以便调用方回读校验\n"
        u"      console.error('LS set err', e);\n"
        u"      LS.saveFailed = true;\n"
        u"      LS.lastError = (e && e.name) ? e.name : String(e);\n"
        u"    }\n"
        u"  },",
        'LS.set 留痕')

    # ---- ② 云端硬错误（单行超限）留痕 ----
    rep(
        u"// ===== 资料库数据表 SDK 层 =====\nvar CLOUD = {",
        u"// ===== 云端写入硬错误记录 =====\n"
        u"// 56153 = 数据库单行超 1MB，服务端直接拒绝且不做重试，属不可恢复错误，必须让用户知道\n"
        u"var CLOUD_ROW_ERR = 0;\n"
        u"var CLOUD_ROW_ERR_SHOWN = false;\n"
        u"function recordCloudErr(e) {\n"
        u"  var s = '';\n"
        u"  try { s = JSON.stringify(e) + ' ' + ((e && e.message) || '') + ' ' + ((e && e.code) || ''); }\n"
        u"  catch (x) { s = String(e); }\n"
        u"  if (/56153|row.?too.?large|too large|exceed/i.test(s)) CLOUD_ROW_ERR++;\n"
        u"}\n\n"
        u"// ===== 资料库数据表 SDK 层 =====\nvar CLOUD = {",
        '云端硬错误留痕')

    rep(
        u"    return this.db.addRecord({ databaseId: dbId, properties: props }).catch(function(e) { console.warn('cloud add err', e); return null; });",
        u"    return this.db.addRecord({ databaseId: dbId, properties: props }).catch(function(e) { console.warn('cloud add err', e); recordCloudErr(e); return null; });",
        'CLOUD._rawAdd 记录错误')

    rep(
        u"    return this.db.updateRecord({ databaseId: dbId, recordId: recordId, properties: props }).catch(function(e) { console.warn('cloud update err', e); return null; });",
        u"    return this.db.updateRecord({ databaseId: dbId, recordId: recordId, properties: props }).catch(function(e) { console.warn('cloud update err', e); recordCloudErr(e); return null; });",
        'CLOUD._rawUpdate 记录错误')

    # ---- ③ 同步队列：重试后仍失败且是「单行超限」时，明确提示 ----
    rep(
        u"        } else {\n"
        u"          SYNC_DONE++;\n"
        u"          if (t._resolve) t._resolve(r);\n"
        u"        }",
        u"        } else {\n"
        u"          SYNC_DONE++;\n"
        u"          // 重试后仍失败：若是「单行超限」这类硬错误，明确告知，不再静默\n"
        u"          if (r === null && t.type !== 'del' && CLOUD_ROW_ERR > 0 && !CLOUD_ROW_ERR_SHOWN) {\n"
        u"            CLOUD_ROW_ERR_SHOWN = true;\n"
        u"            toast('有数据超出云端单条容量上限，未能同步到其他设备（共 ' + CLOUD_ROW_ERR + ' 条）。建议把过大的资料拆成几篇再导入', 'err', 9000);\n"
        u"          }\n"
        u"          if (t._resolve) t._resolve(r);\n"
        u"        }",
        '同步队列硬错误提示')

    # ---- ④ 核心：体积预算 + 自动拆分 + 统一入库入口 ----
    helper = u"""// ===== 资料体积预算：资料库单行 1MB 上限 =====
// 一篇资料落库时要同时写「原始文本」和「章节JSON」，而 chapters[].content 又是一份完整正文，
// 所以实际体积约为正文的 2 倍；中文一个字 3 字节、英文 1 字节。
// 超限时云端写入会被服务端直接拒绝（56153）且不会重试 —— 表现为「本地导入成功、换设备就没了」。
// 因此在导入前先算清楚，超了自动按章节/段落边界拆成多篇，保证每一篇都在上限内。
var ROW_LIMIT_BYTES = 1024 * 1024;   // 服务端单行硬上限
var ROW_SAFE_BYTES = 900 * 1024;     // 留出标题、ID、时间戳等字段的余量

function utf8Bytes(str) {
  str = String(str == null ? '' : str);
  if (typeof TextEncoder !== 'undefined') { try { return new TextEncoder().encode(str).length; } catch (e) {} }
  var n = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

// 按 syncMaterialToCloud 的真实字段结构，估算这一行落库后的字节数
function estimateMaterialBytes(text, chapters) {
  return utf8Bytes(JSON.stringify({
    'profile_id': 'p', '资料ID': 'mat', '标题': 't', '来源类型': 's_txt',
    '原始文本': text || '',
    '章节JSON': JSON.stringify(chapters || []),
    '章节数': (chapters || []).length,
    '创建时间': '2026-01-01T00:00:00.000Z', '更新时间': '2026-01-01T00:00:00.000Z'
  }));
}

// 这篇文本单篇最多能放多少字符：先按采样比率推算，再用真实结构校验收敛
function maxCharsPerMaterial(text) {
  var s = String(text || '');
  var sample = s.slice(0, 4000) || 'a';
  var ratio = Math.max(utf8Bytes(sample) / sample.length, 1);   // 平均每字符字节数
  var chars = Math.floor((ROW_SAFE_BYTES - 4096) / (2 * ratio));
  for (var i = 0; i < 8 && chars > 500; i++) {
    var probe = s.slice(0, chars);
    if (estimateMaterialBytes(probe, [{ id: 'c', title: 't', order: 0, content: probe, targetWords: 10, generated: false }]) <= ROW_SAFE_BYTES) break;
    chars = Math.floor(chars * 0.85);
  }
  return Math.max(chars, 500);
}

// 把长文本切成不超过 maxChars 的片段，优先在段落/句子边界切
function hardChunks(str, maxChars) {
  str = String(str || '');
  if (!str) return [];
  if (str.length <= maxChars) return [str];
  var out = [];
  var seps = ['\\n\\n', '\\n', '。', '. ', '！', '？', '；', '; ', ' '];
  var buf = str;
  while (buf.length > maxChars) {
    var cut = -1;
    for (var i = 0; i < seps.length && cut === -1; i++) {
      var idx = buf.lastIndexOf(seps[i], maxChars);
      if (idx > maxChars * 0.6) cut = idx + seps[i].length;
    }
    if (cut <= 0) cut = maxChars;   // 极端情况（超长无标点段落）：硬切
    out.push(buf.slice(0, cut));
    buf = buf.slice(cut);
  }
  if (buf) out.push(buf);
  return out;
}

// 把一篇资料规划成若干可独立入库的单元；未超限时原样返回 1 个单元
function planImportUnits(title, text, chapters) {
  chapters = (chapters && chapters.length) ? chapters : [];
  if (!chapters.length) {
    chapters = [{ id: uid('ch'), title: '全文', order: 0, content: text, targetWords: 10, generated: false }];
  }
  if (estimateMaterialBytes(text, chapters) <= ROW_SAFE_BYTES) {
    return [{ title: title, text: text, chapters: chapters }];
  }
  var maxChars = maxCharsPerMaterial(text);
  // 1) 逐章切成 ≤ maxChars 的片段（保留原标题，续片加序号）
  var pieces = [];
  chapters.forEach(function (ch) {
    var content = String(ch.content || '');
    if (!content) return;
    var parts = hardChunks(content, maxChars);
    parts.forEach(function (p, k) {
      pieces.push({
        id: parts.length > 1 ? uid('ch') : ch.id,
        title: parts.length > 1 ? (ch.title + '（' + (k + 1) + '/' + parts.length + '）') : ch.title,
        content: p,
        targetWords: ch.targetWords || 10,
        generated: false
      });
    });
  });
  // 2) 贪心装箱：每个单元的正文总量不超过 maxChars
  var groups = [], cur = [], curLen = 0;
  pieces.forEach(function (p) {
    if (cur.length && curLen + p.content.length > maxChars) { groups.push(cur); cur = []; curLen = 0; }
    cur.push(p); curLen += p.content.length;
  });
  if (cur.length) groups.push(cur);
  // 2.5) 边界均衡：把靠前单元的尾部片段匀给后面的单元，避免最后一篇只剩一小截。
  //      只在相邻单元间移动边界，阅读顺序不变；且接收方不能超上限。
  function groupChars(g) { return g.reduce(function (n, p) { return n + p.content.length; }, 0); }
  for (var pass = 0; pass < 20; pass++) {
    var moved = false;
    for (var gi = 0; gi < groups.length - 1; gi++) {
      var ga = groups[gi], gb = groups[gi + 1];
      if (ga.length <= 1) continue;
      var ta = ga[ga.length - 1];
      var la = groupChars(ga), lb = groupChars(gb);
      if (la - lb > maxChars * 0.2 && lb + ta.content.length <= maxChars) {
        ga.pop(); gb.unshift(ta); moved = true;
      }
    }
    if (!moved) break;
  }
  // 3) 逐单元精确校验；万一仍超限再硬切一次兜底
  var units = [];
  groups.forEach(function (g) {
    var chs = g.map(function (p, k) {
      return { id: p.id, title: p.title, order: k, content: p.content, targetWords: p.targetWords, generated: false };
    });
    var t = g.map(function (p) { return p.content; }).join('\\n\\n');
    if (estimateMaterialBytes(t, chs) <= ROW_SAFE_BYTES) {
      units.push({ title: title, text: t, chapters: chs });
      return;
    }
    hardChunks(t, Math.max(500, Math.floor(maxChars * 0.8))).forEach(function (tt, k) {
      units.push({
        title: title, text: tt,
        chapters: [{ id: uid('ch'), title: '第 ' + (k + 1) + ' 部分', order: 0, content: tt, targetWords: 10, generated: false }]
      });
    });
  });
  return units;
}

// 统一入库入口：自动按 1MB/行 上限拆分，写入后回读校验；失败返回空数组（已回滚）
function addMaterialSafe(title, text, chapters, extra) {
  var units = planImportUnits(title, text, chapters);
  var created = [];
  units.forEach(function (u, i) {
    var matId = uid('mat');
    var material = {
      id: matId,
      title: units.length > 1 ? (title + '（' + (i + 1) + '/' + units.length + '）') : title,
      rawContent: u.text,
      chapters: u.chapters,
      chapterCount: u.chapters.length,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) material[k] = extra[k]; } }
    STATE.materials.push(material);
    STATE.chapters[matId] = u.chapters;
    created.push(material);
  });
  LS.saveFailed = false;
  saveLocal();
  // 回读校验：浏览器存储写满时 setItem 会抛错，此前是静默失败（刷新后资料凭空消失）
  if (STATE.profileId && LS.saveFailed) {
    created.forEach(function (m) {
      var i = STATE.materials.indexOf(m);
      if (i >= 0) STATE.materials.splice(i, 1);
      delete STATE.chapters[m.id];
    });
    return [];
  }
  created.forEach(function (m) {
    syncMaterialToCloud(m);
    (STATE.chapters[m.id] || []).forEach(function (ch) { syncChapterToCloud(m.id, ch); });
  });
  return created;
}

// 拆分提示文案（未拆分时返回空串）
function materialSplitTip(created, label) {
  if (!created || created.length <= 1) return '';
  return '内容较大，已自动拆成 ' + created.length + ' 篇' + (label || '资料') + '分别导入 · ';
}

// ===== 本地保存 ====="""

    rep(u"// ===== 本地保存 =====", helper, '体积预算与拆分模块')

    # ---- ⑤ 手动粘贴入库 ----
    rep(
        u"  var parsed = parseTXT(text);\n"
        u"  var matId = uid('mat');\n"
        u"  var material = { id: matId, title: title, sourceType: 's_manual', rawContent: text, chapters: parsed.chapters, chapterCount: parsed.chapters.length, createdAt: nowISO(), updatedAt: nowISO() };\n"
        u"  STATE.materials.push(material);\n"
        u"  STATE.chapters[matId] = parsed.chapters;\n"
        u"  saveLocal();\n"
        u"  syncMaterialToCloud(material);\n"
        u"  parsed.chapters.forEach(function(ch) { syncChapterToCloud(matId, ch); });\n"
        u"  // 自动为新章节生成语境材料（用所有单词书）\n"
        u"  var matchCount = regenerateMatchesForMaterial(matId);\n"
        u"  closeModal('uploadModal');\n"
        u"  toast('资料已添加，已为 ' + parsed.chapters.length + ' 章生成 ' + matchCount + ' 个语境匹配', 'ok');\n"
        u"  refreshAll();",
        u"  var parsed = parseTXT(text);\n"
        u"  var created = addMaterialSafe(title, text, parsed.chapters, { sourceType: 's_manual' });\n"
        u"  if (!created.length) { toast('资料未能保存：浏览器本地存储空间不足，请先删除一些旧资料再试', 'err', 8000); return; }\n"
        u"  // 自动为新章节生成语境材料（用所有单词书）\n"
        u"  var matchCount = 0, chapterTotal = 0;\n"
        u"  created.forEach(function(m) { matchCount += regenerateMatchesForMaterial(m.id); chapterTotal += (STATE.chapters[m.id] || []).length; });\n"
        u"  closeModal('uploadModal');\n"
        u"  toast(materialSplitTip(created) + '资料已添加，已为 ' + chapterTotal + ' 章生成 ' + matchCount + ' 个语境匹配', 'ok', 8000);\n"
        u"  refreshAll();",
        '手动粘贴入库')

    # ---- ⑥ TXT 上传入库 ----
    rep(
        u"      var parsed = parseTXT(text);\n"
        u"      var matId = uid('mat');\n"
        u"      var material = { id: matId, title: file.name.replace(/\\.\\w+$/, ''), sourceType: 's_txt', rawContent: text, chapters: parsed.chapters, chapterCount: parsed.chapters.length, createdAt: nowISO(), updatedAt: nowISO() };\n"
        u"      STATE.materials.push(material);\n"
        u"      STATE.chapters[matId] = parsed.chapters;\n"
        u"      saveLocal();\n"
        u"      syncMaterialToCloud(material);\n"
        u"      parsed.chapters.forEach(function(ch) { syncChapterToCloud(matId, ch); });\n"
        u"      var matchCount = regenerateMatchesForMaterial(matId);\n"
        u"      toast('资料已上传，已为 ' + parsed.chapters.length + ' 章生成 ' + matchCount + ' 个语境匹配', 'ok');\n"
        u"      refreshAll();",
        u"      var parsed = parseTXT(text);\n"
        u"      var created = addMaterialSafe(file.name.replace(/\\.\\w+$/, ''), text, parsed.chapters, { sourceType: 's_txt' });\n"
        u"      if (!created.length) { toast('资料未能保存：浏览器本地存储空间不足，请先删除一些旧资料再试', 'err', 8000); return; }\n"
        u"      var matchCount = 0, chapterTotal = 0;\n"
        u"      created.forEach(function(m) { matchCount += regenerateMatchesForMaterial(m.id); chapterTotal += (STATE.chapters[m.id] || []).length; });\n"
        u"      toast(materialSplitTip(created) + '资料已上传，已为 ' + chapterTotal + ' 章生成 ' + matchCount + ' 个语境匹配', 'ok', 8000);\n"
        u"      refreshAll();",
        'TXT 上传入库')

    # ---- ⑦ PDF 上传入库 ----
    rep(
        u"  var matId = uid('mat');\n"
        u"  var material = {\n"
        u"    id: matId, title: title, sourceType: 's_txt', importedFrom: 'pdf',\n"
        u"    rawContent: res.text, chapters: chapters, chapterCount: chapters.length,\n"
        u"    pageCount: res.pages, createdAt: nowISO(), updatedAt: nowISO()\n"
        u"  };\n"
        u"  STATE.materials.push(material);\n"
        u"  STATE.chapters[matId] = chapters;\n"
        u"  saveLocal();\n"
        u"  syncMaterialToCloud(material);\n"
        u"  chapters.forEach(function (ch) { syncChapterToCloud(matId, ch); });\n"
        u"  var matchCount = regenerateMatchesForMaterial(matId);\n"
        u"  toast('PDF 已导入：' + res.pages + ' 页 → ' + chapters.length + ' 章 · 生成 ' + matchCount + ' 个语境匹配', 'ok', 5000);\n"
        u"  refreshAll();",
        u"  var created = addMaterialSafe(title, res.text, chapters, { sourceType: 's_txt', importedFrom: 'pdf', pageCount: res.pages });\n"
        u"  if (!created.length) { toast('资料未能保存：浏览器本地存储空间不足，请先删除一些旧资料再试', 'err', 8000); return; }\n"
        u"  var matchCount = 0, chapterTotal = 0;\n"
        u"  created.forEach(function (m) { matchCount += regenerateMatchesForMaterial(m.id); chapterTotal += (STATE.chapters[m.id] || []).length; });\n"
        u"  toast(materialSplitTip(created) + 'PDF 已导入：' + res.pages + ' 页 → ' + chapterTotal + ' 章 · 生成 ' + matchCount + ' 个语境匹配', 'ok', 8000);\n"
        u"  refreshAll();",
        'PDF 上传入库')

    # ---- ⑧ 两个上传区补上体积提示 ----
    rep(
        u'支持 TXT / PDF 直接上传（PDF 自动提取文字并按页分章）。DOCX 请先转为纯文本后粘贴。',
        u'支持 TXT / PDF 直接上传（PDF 自动提取文字并按页分章）。DOCX 请先转为纯文本后粘贴。单篇超过约 15 万汉字（或 30 万英文字符）时会自动拆成多篇导入。',
        '学习资料体积提示')

    write(outp, html)
    print('OK  %s -> %s  共 %d 处修改' % (os.path.basename(inp), os.path.basename(outp), len(reps)))
    for r in reps:
        print('    · ' + r)
    print('体积: %d -> %d 字节' % (orig_len, len(html)))


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', default=os.path.join(BASE, 'index.html'))
    ap.add_argument('--output', default=os.path.join(BASE, 'index.html'))
    a = ap.parse_args()
    apply(a.input, a.output)
