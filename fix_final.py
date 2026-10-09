# -*- coding: utf-8 -*-
"""修正抽检挑出的 24 条问题词条。

每一条的「正确释义」都是从 _ocrcache 的原书页 OCR 原文逐条核出来的
（探针见 probe_fix.py / search_lines.py / dump_page.py），
不是凭词典改写的。词头错的（hono / di'fju）按原书正文页更正。

同时重建 output/builtin_cet6.tsv（页面内置词表的数据源）。
"""
import csv, os, io

BASE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(BASE, 'output', '六级单词书_刘晓燕.csv')
TSV = os.path.join(BASE, 'output', 'builtin_cet6.tsv')

# key = 当前 CSV 里的词头（小写）；value = (新词头, 新释义)
FIX = {
    # --- 词头 OCR 错（原书分别是 hono(u)r、diffuse）---
    'hono': ('honor', '尊敬；荣幸；荣誉；尊重（某人）；给予表扬（或奖励、头衔、称号）'),
    "di'fju": ('diffuse', '普及；散布；渗透；扩散的；弥漫的'),
    # --- 释义残缺 ---
    'prohibition': ('prohibition', '（尤指通过法律的）禁止，阻止'),
    'transplantation': ('transplantation', '移栽；移种；移植'),
    # --- 两栏串台：释义尾部混进了邻栏下一个词 ---
    'inject': ('inject', '（给…）注射（药物等）；（给…）投入（资金）'),
    'deploy': ('deploy', '部署，调度（军队或武器）；有效地利用'),
    'compass': ('compass', '指南针；范围'),
    'predominant': ('predominant', '显著的；盛行的；占优势的，主导的'),
    'faulty': ('faulty', '不完美的；有错误的；有缺陷的'),
    'flash': ('flash', '闪耀；突然显露；快速地出示；掠过；闪光；显示'),
    'deductible': ('deductible', '可扣除的，可减免的；免赔额；自负额'),
    'articulate': ('articulate', '清楚地表达；口齿清楚地讲；能说会道的；清楚的'),
    'zigzag': ('zigzag', '锯齿形线条（或形状）；之字形；曲折前进'),
    'layout': ('layout', '布局；设计；版面编排，版面设计'),
    'eliminate': ('eliminate', '排除，消除；（比赛中）淘汰'),
    'clockwise': ('clockwise', '顺时针的/地'),
    'fashionable': ('fashionable', '流行的；时兴的；时髦的'),
    'cream': ('cream', '奶油；护肤霜；奶油色；精华油色的；把…搅成糊；彻底打败'),
    # --- 词性标记被啃掉 / 词典符号残留 ---
    'over': ('over', '落下；翻转；穿过；覆盖；以上；剩余；又，再；结束；在/向…上方；穿越；翻越；超过；遍及；在期间'),
    'call': ('call', '把…叫作/看作；称呼；召唤；打电话给；命令；通话；叫喊声；短暂拜访；要求，呼吁；召唤'),
    'check': ('check', '检查；控制；寄放；在…上打记号；检查；（象棋）将军；寄存单；（=cheque）账单，支票'),
    'casino': ('casino', '（复数 casinos）赌场'),
    'equator': ('equator', '赤道'),
    'breadth': ('breadth', '宽度；广泛'),
}

rows = list(csv.reader(open(CSV, encoding='utf-8-sig', newline='')))
assert rows[0][0] == 'lemma', rows[0]
head, body = rows[0], rows[1:]

hits, out = [], []
for lemma, meaning in body:
    k = lemma.strip().lower()
    if k in FIX:
        nl, nm = FIX[k]
        if nl == lemma and nm == meaning:
            raise AssertionError('%s 词头和释义都没变，检查一下' % k)
        hits.append((lemma, meaning, nm))
        out.append([nl, nm])
    else:
        out.append([lemma, meaning])

print('命中待修 %d 条 / 期望 %d 条' % (len(hits), len(FIX)))
missing = set(FIX) - set(h.strip().lower() for h, _ in body)
if missing:
    print('!! 以下词头没在表里找到:', missing)

# 重复检查
seen, dup = set(), []
for l, _ in out:
    k = l.lower()
    if k in seen:
        dup.append(l)
    seen.add(k)
print('重复词头:', dup if dup else '无')
assert not dup, dup

print()
print('--- 修改明细 ---')
for old_w, old_m, new_m in hits:
    print('  %-16s %s' % (old_w, old_m[:46]))
    print('  %-16s %s' % ('  ->', new_m))

with open(CSV, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(head)
    w.writerows(out)
print()
print('已写回', CSV, '共', len(out), '词')

# 重建内置词表 TSV（tab 分隔，无表头，页面 base64 直接解码这个）
with io.open(TSV, 'w', encoding='utf-8', newline='\n') as f:
    for l, m in out:
        f.write('%s\t%s\n' % (l, m))
print('已重建', TSV, '%.0f KB' % (os.path.getsize(TSV) / 1024))
