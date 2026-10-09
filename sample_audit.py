# -*- coding: utf-8 -*-
"""对最终词表做分层抽检 + 可疑行排序。"""
import csv, re, random, collections, sys

CSV = 'output/六级单词书_刘晓燕.csv'
CJK = re.compile(r'[\u4e00-\u9fff]')
LEMMA_OK = re.compile(r"^[A-Za-z][A-Za-z'\- ]*$")
ASCII_WORD = re.compile(r'[A-Za-z]{3,}')
POS = {'n', 'v', 'vt', 'vi', 'adj', 'adv', 'prep', 'conj', 'pron', 'art', 'num',
       'int', 'aux', 'abbr', 'pl', 'det'}

rows = list(csv.reader(open(CSV, encoding='utf-8-sig')))
assert rows[0][0] == 'lemma', rows[0]
data = [(a.strip(), b.strip()) for a, b in rows[1:] if a.strip()]

problems = collections.Counter()
suspects = []          # (score, idx, lemma, meaning, tags)

for i, (w, m) in enumerate(data):
    score, tags = 0, []
    if not LEMMA_OK.match(w):
        score += 3; tags.append('词头异常')
    if len(w) < 2:
        score += 3; tags.append('词头过短')
    if not CJK.search(m):
        score += 3; tags.append('无中文')
    if '/' in m:
        score += 2; tags.append('含斜杠/音标')
    if '扩' in m:
        score += 2; tags.append('含"扩"标记')
    if '@' in m or '→' in m or '⇒' in m:
        score += 2; tags.append('含串栏符')
    if len(m) > 40:
        score += 2; tags.append('释义过长%d' % len(m))
    # 中文之间夹杂英文长词（排除 （=xxx） 与词性）
    seg = re.sub(r'[（(]=[^）)]*[）)]', '', m)
    words = [x for x in ASCII_WORD.findall(seg) if x.lower() not in POS]
    if words:
        score += 2; tags.append('夹英文:%s' % ','.join(words[:3]))
    if m[:1].isascii() and m[:1].isalpha():
        score += 1; tags.append('英文开头')
    if score:
        suspects.append((score, i, w, m, tags))
        for t in tags:
            problems[t.split(':')[0].split('（')[0]] += 1

n = len(data)
print('总词条 %d' % n)
print('可疑行 %d（%.2f%%）' % (len(suspects), 100.0 * len(suspects) / n))
print()
print('--- 问题类型分布 ---')
for k, v in problems.most_common():
    print('  %-14s %5d  %.2f%%' % (k, v, 100.0 * v / n))

print()
print('=== A. 分层抽样 50 条（全书均匀） ===')
random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 20261002)
K = 50
seg_len = n // K
samp = []
for j in range(K):
    lo, hi = j * seg_len, min(n, (j + 1) * seg_len)
    if lo >= hi:
        continue
    samp.append(random.randrange(lo, hi))
for idx in samp:
    w, m = data[idx]
    flag = ''
    for s, si, sw, sm, st in suspects:
        if si == idx:
            flag = '   <-- 可疑: ' + '/'.join(st)
            break
    print('  #%-5d %-18s %s%s' % (idx + 1, w, m, flag))

print()
print('=== B. 最可疑 40 条 ===')
suspects.sort(key=lambda x: (-x[0], x[1]))
for s, i, w, m, t in suspects[:40]:
    print('  #%-5d [%d] %-18s %s   <%s>' % (i + 1, s, w, m[:60], '/'.join(t)))

print()
print('=== C. 释义最长 15 条 ===')
for i, (w, m) in sorted(enumerate(data), key=lambda x: -len(x[1][1]))[:15]:
    print('  #%-5d %-18s (%d字) %s' % (i + 1, w, len(m), m[:80]))
