# -*- coding: utf-8 -*-
"""补齐「释义被切断」的词条（第二版，按原书对应段替换末段）。

思路：表里的释义末段是原书某一段被切了一半。
      到原书里找「包含这段、且最长」的那一段，把末段换成它的完整形态。
      所有内容都取自 _ocrcache 的原书文字，补进去的字一律先过噪音过滤，
      补不动（含页脚/谐音/编号）就原样跳过，绝不硬凑。
"""
import csv, io, json, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
TSV = os.path.join(BASE, 'output', 'builtin_cet6.tsv')
CAND = os.path.join(BASE, 'output', '_audit_candidates.json')

NOISE = ['套程', '品套', '套课', '套婚', '婚程', '世套', '公大', '公纪号', '公众', '研大', '联系微信',
         '公众号', '学丞', '晓艳', '单词发音', '谐音', '构词', '联想', '对照', '配套', '按考频',
         '划线', '词汇索引', '词以群记', '相关', '近义', '反义', '形近', '趣味记忆', '刷基础',
         '唯有拼搏', '心中有光', '最快的脚步', '道固远', '没有伞', '去想', '眼下即是', '方得辉煌',
         '相信自己', '不积跬步', '行而不辍', '星光', '世上无难事', '心向往之', '行必能至',
         '尽最大的努力', '留最小的遗憾', '在心里种花', '进取点点星', '步履稳踏', '笃行可至',
         '处于低谷时', '心里有梦', '努力到一定程度', '追寻自我', '同方面', '勇往直前', '长风破浪', '千里之行',
         '水滴石穿', '宝剑锋', '梅花香', '努力', '奋斗', '梦想', '未来可期', '你所', '愿你',
         '英语六级你还在背单词吗', 'He', 'The', 'Unit', 'Lesson', 'PART']
ALLOW = re.compile(r'[\u4e00-\u9fff/（）()\[\]，,；;、\.·=～]')
MARK = '\x01'

# 自动收集来的页眉/页脚黑名单（励志句、谐音句、例句片段……）
_FT = os.path.join(BASE, 'output', '_footer_noise.txt')
if os.path.exists(_FT):
    with open(_FT, encoding='utf-8') as _f:
        for _line in _f:
            _w = _line.strip()
            if len(_w) >= 3 and _w not in NOISE:
                NOISE.append(_w)


def segs(s):
    """分段，但保护括号内的分隔符（「（企业；学校等）」不该被拆开）。"""
    out, depth = [], 0
    for ch in s:
        if ch in '（([':
            depth += 1
        elif ch in '）)]':
            depth = max(0, depth - 1)
        out.append(MARK if (depth > 0 and ch in '；;，,、') else ch)
    parts = re.split(r'[；;，,、]', ''.join(out))
    return [p.replace(MARK, '，').strip() for p in parts if p.strip()]


_TAILS = [w for w in NOISE if len(w) >= 3]


def take_tail(tail, limit=7):
    """补进去的那一段也要过筛：碰页码、英文、句号、页脚励志句就停。

    页脚句是整句进黑名单的，而这里只能看到它的开头，
    所以边拼边查「当前拼出来的串是不是某条黑名单句的前缀」——
    是就说明撞上页脚了，立刻停手。"""
    out = []
    for ch in tail:
        if len(out) >= limit or ch == '。':
            break
        if not ALLOW.match(ch):
            break
        cand = ''.join(out) + ch
        if len(cand) >= 3 and any(n.startswith(cand) for n in _TAILS):
            break                      # 撞上页脚句的开头了
        out.append(ch)
    s = ''.join(out)
    best = len(s)
    for n in _TAILS:
        i = s.find(n)
        if 0 <= i < best:
            best = i
    s = s[:best].strip(' ，,；;、.·／/（()）')
    if len(s) < 2:
        return ''                      # 只剩「口 / 现 / 星」这种单字残留，丢掉
    if any(n.startswith(s) for n in _TAILS):
        return ''                      # 拼出来正好是某条页脚句的开头
    return s


def try_fill(meaning, rm):
    """顺序消耗对齐：按表里各段的先后顺序在书中定位末段，取它后面剩下的原文。"""
    ta = segs(meaning)
    joined = '；'.join(segs(rm))
    cursor = 0
    for seg in ta:
        i = joined.find(seg, cursor)
        if i < 0:
            return None                     # 顺序对不上，宁可不补
        cursor = i + len(seg)
    end = min(len(joined), cursor + 16)     # 多给一点，让 take_tail 自己决定停在哪
    tail = joined[cursor:end]
    tail = take_tail(tail)
    if not tail:
        return None
    anchor = meaning.rfind(ta[-1])
    if anchor < 0:
        return None
    new_m = meaning[:anchor + len(ta[-1])] + tail
    if len(new_m) > 60 or len(new_m) <= len(meaning):
        return None
    return new_m


cand = json.load(open(CAND, encoding='utf-8'))
cut = {c['w'].lower(): c for c in cand['cut']}

rows = list(csv.reader(open(CSV, encoding='utf-8-sig', newline='')))
head, body = rows[0], rows[1:]
changed, skipped, out = [], [], []
for lemma, meaning in body:
    k = lemma.strip().lower()
    c = cut.get(k)
    if not c or c['m'] != meaning:
        out.append([lemma, meaning]); continue
    nm = try_fill(meaning, c['rm'])
    if nm is None:
        out.append([lemma, meaning]); skipped.append(lemma); continue
    changed.append((lemma, meaning, nm, c['pno']))
    out.append([lemma, nm])

print('候选 %d 条 / 补全 %d 条 / 补不动 %d 条' % (len(cut), len(changed), len(skipped)))
print('补不动（原书那段本身也残缺或掺了页脚）:', '、'.join(skipped[:40]))
print()
for w, old, new, pno in changed:
    print('  p%-4d %-18s %s' % (pno, w, old))
    print('        %-18s %s' % ('', new))

if '--apply' in sys.argv:
    seen, dup = set(), []
    for l, _ in out:
        if l.lower() in seen:
            dup.append(l)
        seen.add(l.lower())
    assert not dup, dup
    with open(CSV, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f); w.writerow(head); w.writerows(out)
    with io.open(TSV, 'w', encoding='utf-8', newline='\n') as f:
        for l, m in out:
            f.write('%s\t%s\n' % (l, m))
    print()
    print('已写回 CSV 共 %d 词，重建 TSV %.0f KB' % (len(out), os.path.getsize(TSV) / 1024))
else:
    print()
    print('（试运行，加 --apply 才写入）')
