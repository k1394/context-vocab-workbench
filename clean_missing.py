# -*- coding: utf-8 -*-
"""给补抽出来的词条做清洗 + 用「词汇索引」当白名单过滤 OCR 噪声。

思路：书末索引（p0316-336）是全书词条名录，虽然它自身也有 OCR 噪声，
      但「候选词必须在索引里出现过」这条能把 sak'se / a'tei / iagnosis 这类
      从音标碎片、断词里误抓的东西滤掉，精确度提升非常大。
"""
import json, glob, os, re, csv, collections

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
OUT = os.path.join(BASE, 'output')
CJK = re.compile(r'[\u4e00-\u9fff]')
POS = r'(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr|det|exclam)'
LEMMA_OK = re.compile(r"^[a-z][a-z\-]{1,24}$")

WATER = ('配套课程', '公众号', '研大', '联系微信', '扫码', '微信', '日目', '日日',
         '考研', 'QQ', 'qq', '咨询', '课程')
NOISE_CUT = ('对照', '构词', '联想', '谐音', '例句', '例 ', '真题', '⇒', '→', '【', '】')
FOOTER = ('按考频划分', '划线释义', '为重点释义', '重点释义', '词汇索引',
          '带*的单词', '使用说明', 'Congratulations')
# 这些"词"是 OCR 把 -ize / -ization 之类后缀切出来的碎片，不是单词
SUFFIX_JUNK = {'ize', 'izer', 'isers', 'ising', 'izing', 'isation', 'ization',
               'zation', 'zation', 'isations', 'izations', 'iser', 'isation'}


def load_index_words():
    PAIR = re.compile(r"([A-Za-z][A-Za-z'\-]{1,24})\s*[-–—*+]{0,2}\s*/\s*(\d{1,3})\b")
    s = set()
    for p in range(315, 339):
        fp = os.path.join(CACHE, 'p%04d.json' % p)
        if not os.path.exists(fp):
            continue
        for it in json.load(open(fp, encoding='utf-8')):
            for m in PAIR.finditer(it.get('text', '')):
                w = m.group(1).strip("'-.").lower()
                if len(w) >= 2:
                    s.add(w)
    return s


def clean(lemma, raw):
    m = raw
    for t in FOOTER:
        i = m.find(t)
        if i > 0:
            m = m[:i]
    for t in WATER:
        i = m.find(t)
        if i > 0:
            m = m[:i]
    for t in NOISE_CUT:
        i = m.find(t)
        if i > 0:
            m = m[:i]
    m = re.sub(r'\b(?:%s)\s*\.' % POS, '；', m, flags=re.I)
    m = re.sub(r'[A-Za-z]{2,}', ' ', m)          # 残留英文
    m = re.sub(r'\d+', ' ', m)                    # 页码数字
    hit = CJK.search(m)
    if hit and hit.start() > 0:
        m = m[hit.start():]
    m = re.sub(r'\s+', '', m)
    m = m.strip(' ；;,，、·.]-*&～扩/')
    m = re.sub(r'[：:]+', '；', m)
    m = re.sub(r'；{2,}', '；', m)
    m = re.sub(r'；+$', '', m)
    m = re.sub(r'[^\u4e00-\u9fff；，、（）%]+$', '', m)   # 尾部残留英文/斜杠/引号
    m = m.strip(' ；;,，、·.]-*&～/')
    return m.strip()


cur = collections.OrderedDict()
with open(os.path.join(OUT, '六级单词书_刘晓燕.csv'), encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f); next(r)
    for a, b in r:
        cur[a.strip().lower()] = b.strip()

idx = load_index_words()
print('索引白名单词数:', len(idx))

add = collections.OrderedDict()
stats = collections.Counter()
with open(os.path.join(OUT, 'missing_words.csv'), encoding='utf-8-sig', newline='') as f:
    r = csv.reader(f); next(r)
    for lemma, raw in r:
        w = lemma.strip().lower()
        if not LEMMA_OK.match(w) or len(w) < 3:
            stats['lemma 形状不合格'] += 1
            continue
        if w in cur:
            stats['已在主表'] += 1
            continue
        if w in SUFFIX_JUNK:
            stats['后缀碎片'] += 1
            continue
        if w not in idx:
            stats['不在索引白名单'] += 1
            continue
        m = clean(w, raw)
        if not m or len(m) < 2 or not CJK.search(m):
            stats['释义无效'] += 1
            continue
        if w not in add or len(m) > len(add[w]):
            add[w] = m

print('过滤统计:', dict(stats))
print('可用新增词条:', len(add))
print('合并后总数:', len(cur) + len(add))
print()
for i, (w, m) in enumerate(list(add.items())[:45]):
    print('  %-20s %s' % (w, m[:65]))

with open(os.path.join(OUT, 'missing_clean.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    wr = csv.writer(f); wr.writerow(['lemma', 'meaning'])
    for w, m in add.items():
        wr.writerow([w, m])
print('\n写出 output/missing_clean.csv')
