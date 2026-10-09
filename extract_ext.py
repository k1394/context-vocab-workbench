# -*- coding: utf-8 -*-
"""补抽书里的「扩展词」。
正文里扩展词带「扩」标记：扩adversity/ad'v3isati/n.困境，逆境；不幸
索引页图例写着「带*的单词为书中扩展词」——之前只抽了主词条，扩展词全漏了。
"""
import json, glob, os, re, csv, collections

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
CJK = re.compile(r'[\u4e00-\u9fff]')

# 扩 + 单词 + /音标/ + 词性.释义
ENTRY = re.compile(
    r'扩\s*([A-Za-z][A-Za-z\'\-]{1,24})'          # 单词
    r'\s*[-–—*+]{0,2}\s*/\s*[^/\n]{0,45}?/\s*'    # /音标/
    r'((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr)\s*\.[^扩]{2,90})',
    re.I)


def clean_meaning(raw):
    m = raw
    m = re.sub(r'[A-Za-z]{3,}', ' ', m)          # 残留英文
    i = m.find('；')                              # 从第一个分号之后仍可能有串台
    hit = CJK.search(m)
    if hit and hit.start() > 0:
        m = m[hit.start():]
    m = m.split('【')[0]
    m = re.sub(r'\s+', '', m)
    m = m.strip(' ；;,，、·.]-*&～')
    m = re.sub(r'[：:]+', '；', m)
    m = re.sub(r'；{2,}', '；', m)
    return m.strip()


res = collections.OrderedDict()
raw_n = 0
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    items = json.load(open(fp, encoding='utf-8'))
    for it in items:
        t = it.get('text', '')
        if '扩' not in t:
            continue
        for m in ENTRY.finditer(t):
            w = m.group(1).strip("'-.").lower()
            if len(w) < 2:
                continue
            raw_n += 1
            mean = clean_meaning(m.group(2))
            if not mean or not CJK.search(mean):
                continue
            if w not in res or len(mean) > len(res[w]):
                res[w] = mean

print('原始命中条目:', raw_n)
print('抽出的扩展词:', len(res))
print()
print('--- 抽样 40 条 ---')
for i, (w, m) in enumerate(list(res.items())[:40]):
    print('  %-20s %s' % (w, m[:70]))

with open(os.path.join(BASE, 'output', 'ext_words.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    wr = csv.writer(f)
    wr.writerow(['lemma', 'meaning'])
    for w, m in res.items():
        wr.writerow([w, m])
print('\n写出 output/ext_words.csv')
