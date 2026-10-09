# -*- coding: utf-8 -*-
"""修正「串台」：释义尾部混进了邻栏下一个词的意思。

判定两关，两关都过才改：
  1) 把表中释义按义项逐段拿到原书里顺序定位，定位断掉的地方就是嫌疑截断点；
  2) 被截掉的那些字，必须能在原书**别的词条**的释义里找到——证明它确实是别人家的。
只过第 1 关就改，会误伤那些原书文字本身被音标啃掉一半的词（如 articulate）。
"""
import csv, io, json, glob, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
CSV = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
TSV = os.path.join(BASE, 'output', 'builtin_cet6.tsv')
CAND = os.path.join(BASE, 'output', '_audit_candidates.json')
CJK = re.compile(r'[\u4e00-\u9fff]')
POS = r'(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr|det|exclam|modal)'
ENTRY = re.compile(
    r'(?:口|扩|O|D)?\s*'
    r'([A-Za-z][A-Za-z\'\-]{1,24})'
    r'\s*[-–—*+]{0,3}\s*/\s*([^/\n]{1,45}?)\s*/\s*'
    r'((?:%s)\s*\.[\s\S]{2,120}?)(?=(?:口|扩)?\s*[A-Za-z][A-Za-z\'\-]{1,24}\s*[-–—*+]{0,3}\s*/|\Z)' % POS,
    re.I)


def segs(s):
    out, depth = [], 0
    for ch in s:
        if ch in '（([':
            depth += 1
        elif ch in '）)]':
            depth = max(0, depth - 1)
        out.append('\x01' if (depth > 0 and ch in '；;，,、') else ch)
    return [p.replace('\x01', '，').strip() for p in re.split(r'[；;，,、]', ''.join(out)) if p.strip()]


def only_cjk(s):
    return ''.join(CJK.findall(s))


def clean_raw(raw):
    m = re.sub(r'^(?:%s)\s*\.\s*' % POS, '', raw, flags=re.I)
    m = re.sub(r'[A-Za-z]{2,}', ' ', m)
    hit = CJK.search(m)
    if hit and hit.start() > 0:
        m = m[hit.start():]
    m = re.split(r'【|构词|谐音|联想|对照|例\s|例句|配套|学丞|联系微信|公众号|按考频|划线', m)[0]
    return m.strip()


# 重建原书释义表（用于第 2 关判定）
raw_map = {}
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    pno = int(re.search(r'p(\d+)', os.path.basename(fp)).group(1))
    if pno <= 9 or pno >= 315:
        continue
    items = json.load(open(fp, encoding='utf-8'))
    for lo, hi in ((0, 500), (500, 2000)):
        col = sorted([it for it in items if lo <= it['box'][0][0] < hi],
                     key=lambda it: (it['box'][0][1], it['box'][0][0]))
        stream = '\n'.join(it.get('text', '') for it in col)
        for m in ENTRY.finditer(stream):
            w = m.group(1).strip("'-.").lower()
            c = only_cjk(clean_raw(m.group(3)))
            if len(w) < 2 or not c:
                continue
            if w not in raw_map or len(c) > len(raw_map[w]):
                raw_map[w] = c

cand = json.load(open(CAND, encoding='utf-8'))
rows = list(csv.reader(open(CSV, encoding='utf-8-sig', newline='')))
head, body = rows[0], rows[1:]
by_lemma = {l.strip().lower(): m for l, m in body}

changed, skipped, out = [], [], []
for item in cand['overflow']:
    w, m = item['w'].lower(), item['m']
    if by_lemma.get(w) != m:
        continue
    ta = segs(m)
    jn = only_cjk('；'.join(segs(item['rm'])))
    cursor, cut_idx = 0, None
    for i, seg in enumerate(ta):
        sn = only_cjk(seg)
        if not sn:
            continue
        p = jn.find(sn, cursor)
        if p < 0:
            cut_idx = i
            break
        cursor = p + len(sn)
    if cut_idx is None or cut_idx == 0:
        skipped.append(w + '(书里也不全)')
        continue
    key = only_cjk(''.join(ta[cut_idx:]))
    if len(key) < 2:
        skipped.append(w + '(残缺太短)')
        continue
    # 第 2 关：这些字必须出现在别的词条的释义里
    owner = [w2 for w2, r in raw_map.items() if w2 != w and key[:4] and key[:4] in r]
    if not owner:
        skipped.append(w + '(像是本词自己的义项)')
        continue
    new_m = '；'.join(ta[:cut_idx])
    changed.append((w, m, new_m, item['pno'], owner[0]))
    by_lemma[w] = new_m

for lemma, meaning in body:
    k = lemma.strip().lower()
    out.append([lemma, by_lemma.get(k, meaning)])

print('串台候选 %d / 修正 %d / 跳过 %d' % (len(cand['overflow']), len(changed), len(skipped)))
print()
for w, old, new, pno, owner in changed:
    print('  p%-4d %-16s %s' % (pno, w, old[:52]))
    print('        %-16s → %s   （多出来的属于 %s）' % ('', new, owner))
print()
print('跳过:', '、'.join(skipped[:40]))

if '--apply' in os.sys.argv:
    seen, dup = set(), []
    for l, _ in out:
        if l.lower() in seen:
            dup.append(l)
        seen.add(l.lower())
    assert not dup, dup
    with open(CSV, 'w', encoding='utf-8-sig', newline='') as f:
        wr = csv.writer(f); wr.writerow(head); wr.writerows(out)
    with io.open(TSV, 'w', encoding='utf-8', newline='\n') as f:
        for l, m in out:
            f.write('%s\t%s\n' % (l, m))
    print('已写回 CSV 共 %d 词，重建 TSV %.0f KB' % (len(out), os.path.getsize(TSV) / 1024))
else:
    print('（试运行，加 --apply 才写入）')
