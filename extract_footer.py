# -*- coding: utf-8 -*-
"""自动收集全书每页的页眉/页脚（励志句、公众号、书名……），作为清洗黑名单。

页脚励志句每页都不同，靠人工列列不全；但它们位置固定——在栏内 y 最大处，
且是纯中文、不含音标。页眉同理取 y 最小处。
"""
import json, glob, os, re, collections

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(BASE, '_ocrcache')
OUT = os.path.join(BASE, 'output', '_footer_noise.txt')
CJK = re.compile(r'[\u4e00-\u9fff]')
SKIP = ('微信', '公众号', '研大', '学丞', '晓艳', '英语六级你还在背单词吗', 'PART', 'Unit',
        'Lesson', '词以序记', '词以群记', '配套课程', '考频')

cnt = collections.Counter()
for fp in sorted(glob.glob(os.path.join(CACHE, '*.json'))):
    pno = int(re.search(r'p(\d+)', os.path.basename(fp)).group(1))
    items = json.load(open(fp, encoding='utf-8'))
    for lo, hi in ((0, 500), (500, 2000)):
        col = sorted([it for it in items if lo <= it['box'][0][0] < hi],
                     key=lambda it: it['box'][0][1])
        for group in (col[:2], col[-2:]):          # 顶部 2 行 / 底部 2 行
            for it in group:
                t = it.get('text', '').strip()
                t = re.sub(r'[\d\./]+$', '', t).strip()
                if len(t) < 5 or len(t) > 26:
                    continue
                if not CJK.search(t):
                    continue
                if any(s in t for s in SKIP):
                    continue
                if '/' in t or re.search(r'[A-Za-z]{3,}', t):
                    continue
                # 排掉「词条行」：以词性开头或带分号分隔的，那是正文释义不是页脚
                if re.match(r'^(v|n|adj|adv|prep|conj|pron|num|art|int|aux|vt|vi|abbr|det|exclam)\s*\.', t, re.I):
                    continue
                if '；' in t or ';' in t:
                    continue
                if not ('。' in t or '，' in t or ',' in t or len(t) >= 8):
                    continue
                cnt[t] += 1

# 页脚句每页都不同，所以不做次数过滤，只要出现在页脚位置就收
words = list(cnt.keys())
words.sort(key=lambda w: -cnt[w])
with open(OUT, 'w', encoding='utf-8') as f:
    for w in words:
        f.write(w + '\n')
print('收集到固定页眉/页脚候选 %d 条，已写 %s' % (len(words), OUT))
for w in words[:40]:
    print('  %3d 次  %s' % (cnt[w], w))
