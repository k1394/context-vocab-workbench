# -*- coding: utf-8 -*-
"""补抽上一次流水线漏掉的词条。

线索：索引页图例「带*的单词为书中扩展词」，且 p0260 明明印着
「口abandon/a'baendan/v.遗弃，抛弃；中止；放弃」——上一次只抽到 5201 条，
正文里其实还有一批（含 PART01 后半带复选框「口」的页、扩展词「扩」）。

做法：改为逐页把两栏各自按 y 排好、拼成一条"列文本流"，
      再在列文本上匹配「单词 /音标/ 词性.释义」，这样释义换行也能接住。
      只补我们的词表里没有的词，已有条目不覆盖。
"""
import json, glob, os, re, csv, collections

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
CJK = re.compile(r'[\u4e00-\u9fff]')
SKIP_PAGE = lambda p: p <= 9 or p >= 315      # 封面/说明/目录/索引页

POS = r'(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr|det|exclam)'
ENTRY = re.compile(
    r'(?:口|扩|O|D)?\s*'                                      # 复选框/扩展词标记
    r'([A-Za-z][A-Za-z\'\-]{1,24})'                            # 单词
    r'\s*[-–—*+]{0,3}\s*/\s*([^/\n]{1,45}?)\s*/\s*'            # /音标/
    r'((?:%s)\s*\.[\s\S]{2,120}?)(?=(?:口|扩)?\s*[A-Za-z][A-Za-z\'\-]{1,24}\s*[-–—*+]{0,3}\s*/|\Z)' % POS,
    re.I)


def col_streams(items):
    """按左/右两栏各自按 y 排序拼成文本流。"""
    out = []
    for lo, hi in ((0, 500), (500, 2000)):
        col = [it for it in items if lo <= it['box'][0][0] < hi]
        col.sort(key=lambda it: (it['box'][0][1], it['box'][0][0]))
        out.append('\n'.join(it.get('text', '') for it in col))
    return out


def clean_meaning(raw, lemma):
    m = raw
    m = re.sub(r'^(?:%s)\s*\.\s*' % POS, '', m, flags=re.I)      # 去掉开头词性标记
    m = re.sub(r'\b(?:pl|sing)\b', '', m, flags=re.I)
    m = re.sub(r'[A-Za-z]{3,}', ' ', m)
    m = re.sub(r'\b(?:%s)\s*\.' % POS, '；', m, flags=re.I)
    hit = CJK.search(m)
    if hit and hit.start() > 0:
        m = m[hit.start():]
    m = re.split(r'【|例\s|例句', m)[0]
    m = re.sub(r'\s+', '', m)
    m = m.strip(' ；;,，、·.]-*&～')
    m = re.sub(r'[：:]+', '；', m)
    m = re.sub(r'；{2,}', '；', m)
    m = re.sub(r'；+$', '', m)
    return m.strip()


# 现有词表
cur = collections.OrderedDict()
with open(os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv'), encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f); next(r)
    for a, b in r:
        cur[a.strip().lower()] = b.strip()
print('现有词表:', len(cur))

add = collections.OrderedDict()
raw_hits = 0
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    pno = int(re.search(r'p(\d+)', os.path.basename(fp)).group(1))
    if SKIP_PAGE(pno):
        continue
    for stream in col_streams(json.load(open(fp, encoding='utf-8'))):
        for m in ENTRY.finditer(stream):
            w = m.group(1).strip("'-.").lower()
            if len(w) < 2 or w in cur:
                continue
            raw_hits += 1
            mean = clean_meaning(m.group(3), w)
            if not mean or not CJK.search(mean) or len(mean) < 2:
                continue
            if w not in add or len(mean) > len(add[w]):
                add[w] = mean

print('命中(不含已有词):', raw_hits)
print('新增词条:', len(add))
print()
for i, (w, m) in enumerate(list(add.items())[:40]):
    print('  %-22s %s' % (w, m[:60]))

with open(os.path.join(BASE, 'output', 'missing_words.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    wr = csv.writer(f); wr.writerow(['lemma', 'meaning'])
    for w, m in add.items():
        wr.writerow([w, m])
print('\n写出 output/missing_words.csv')
