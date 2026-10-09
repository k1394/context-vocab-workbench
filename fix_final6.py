# -*- coding: utf-8 -*-
"""第四批修正：串台清单里需要人工定夺的 24 条。

自动判定能稳的那 75 条已经改完；剩下这些要么原书那一段本身被音标/页码啃掉了，
要么自动规则判断不了「这是本词自己的义项，还是邻栏串过来的」，
逐条对着原书页看过之后手工定。
"""
import csv, os, io

BASE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
TSV = os.path.join(BASE, 'output', 'builtin_cet6.tsv')

FIX = {
    # 「变模糊，难以区分」是 blur 自己的动词义（原书排版把动词部分排在邻行），上一轮被误截，改回来
    'blur': ('blur', '模糊的形状/记忆；变模糊，难以区分'),
    'praise': ('praise', '称赞；赞美；表扬；赞扬'),
    'old-fashioned': ('old-fashioned', '陈旧的，过时的；守旧的'),
    'infectious': ('infectious', '传染性的；感染的'),
    'rebellious': ('rebellious', '反叛的；叛逆的；桀骜不驯的'),
    'validate': ('validate', '证实；使生效；使合法化；使得到认同'),
    'counteraction': ('counteraction', '抵制；抵消；抵抗'),
    'recorder': ('recorder', '记录员；录音机'),
    'idealistic': ('idealistic', '理想主义的；空想的'),
    'representative': ('representative', '代表，代理人；典型的，有代表性的'),
    'mate': ('mate', '朋友，伙伴；伴侣'),
    'survey': ('survey', '调查；测量'),
    'energetically': ('energetically', '精力充沛地，充满活力地'),
    'aggregate': ('aggregate', '总数；合计；总数的；总计的'),
    'commune': ('commune', '群体，公社'),
    'content': ('content', '内容；目录；主题；含量'),
    'decrease': ('decrease', '减少；降低'),
    'discard': ('discard', '丢弃，抛弃'),
    'escalator': ('escalator', '自动扶梯'),
    'experiment': ('experiment', '实验，试验；尝试，实践'),
    'jungle': ('jungle', '丛林'),
    'lotion': ('lotion', '护肤液，洗涤剂'),
    'powder': ('powder', '粉末；美容粉'),
    'progress': ('progress', '进步；前进；改进'),
}

rows = list(csv.reader(open(CSV, encoding='utf-8-sig', newline='')))
head, body = rows[0], rows[1:]
hits, out = [], []
for lemma, meaning in body:
    k = lemma.strip().lower()
    if k in FIX:
        nl, nm = FIX[k]
        if nm == meaning:
            out.append([lemma, meaning]); continue
        hits.append((lemma, meaning, nm))
        out.append([nl, nm])
    else:
        out.append([lemma, meaning])

print('修正 %d 条 / 期望 %d 条' % (len(hits), len(FIX)))
missing = set(FIX) - set(h.strip().lower() for h, _ in body)
if missing:
    print('!! 没找到:', missing)
for w, old, new in hits:
    print('  %-16s %s' % (w, old[:52]))
    print('  %-16s → %s' % ('', new))

with open(CSV, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f); w.writerow(head); w.writerows(out)
with io.open(TSV, 'w', encoding='utf-8', newline='\n') as f:
    for l, m in out:
        f.write('%s\t%s\n' % (l, m))
print('已写回 CSV 共 %d 词，重建 TSV %.0f KB' % (len(out), os.path.getsize(TSV) / 1024))
