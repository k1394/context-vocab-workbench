# -*- coding: utf-8 -*-
"""最终合并 + 清洗：把 part1-4 合成「单词 + 释义」两列词表。

清洗规则（每条都由真实样本逼出来，改动前后都抽样核对）：
  R1 lemma 是页脚/词性标记残留（unit / adj / adv / 以 - 结尾）→ 整条丢弃
  R2 释义开头是音标碎片（a'fens/、'd3epadaiz/.）、页码（08 rectify）、
     或词性标记（n；/ Vv. / in；）→ 砍掉；但合法的「（正常）程序」左括号保留
  R3 释义里出现「对照 xxx；yyy→word」派生栏目 → 从「对照」处截断
  R4 释义中串入邻栏 / 例句（中文后紧跟空格、@、→）→ 从该处截断
  R5 归一化：半角化斜杠、去圆圈序号、去中文之间的空格、清悬挂标点
"""
import csv, os, re, collections

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'output')
CJK = re.compile(r'[\u4e00-\u9fff]')
CJK_CH = u'\u4e00-\u9fff'

DROP_LEMMA = {'unit', 'adj', 'adv', 'n', 'v', 'vt', 'vi', 'prep', 'conj',
              'pron', 'num', 'int', 'art', 'abbr', 'aux', 'modalv'}

FOOTER_CUT = ('按考频划分', '按词频划分', '划线释义', '为重点释义', '重点释义',
              '真题例句', '经典例句', '题例句', '单词的释义', '释义及用法',
              '词群导图', '使用说明', '词以群记', '本单元已学习', 'Congratulations',
              '公众号', '微信', '扫码', '过目不忘', '一图揭示', '词汇索引')


def head_is_junk(head):
    """第一个中文字之前的片段是不是杂质。"""
    if not head:
        return False
    if any(c in head for c in "/'’“”‘\"／=&"):
        return True
    if re.search(r'\d', head):
        return True
    core = re.sub(r'[\s\.\(\)（）\[\]，,、；;:：·*\-]+', '', head)
    if core == '':
        return False                       # 只有括号/标点 → 合法的「（正常）程序」
    if len(core) <= 6 and re.fullmatch(r'[A-Za-z]+', core):
        return True                        # n / adj / Vv / in / kilo
    return False


# 词性标记（det.& / exclam. / Vv. / n；…）——OCR 把栏目符号烤进了释义
POS_MARK = re.compile(r'(?:det|exclam|adj|adv|prep|pron|conj|num|art|abbr|'
                      r'modalv|vt|vi|int|n|v)\s*\.\s*&?\s*；?', re.I)
POS_AFTER_CJK = re.compile(r'(?<=[\u4e00-\u9fff])[A-Za-z]{1,6}\.')   # 自负adji.
IPA_FRAG = re.compile(r"[A-Za-z]{1,}['’\"][A-Za-z]{1,}[A-Za-z]{0,3}(?:v|n|adj)\.")


def split_segs(m):
    """按「；」切段，但括号内的「；」不算（antenna: （；antennae）触须）。"""
    out, buf, depth = [], '', 0
    for ch in m:
        if ch in '（(':
            depth += 1
        elif ch in '）)':
            depth = max(0, depth - 1)
        if ch == '；' and depth == 0:
            out.append(buf)
            buf = ''
        else:
            buf += ch
    out.append(buf)
    return out


def outside_brackets(s):
    return re.sub(r'[（(][^（()）]*[）)]?', '', s)


def clean(lemma, meaning):
    m = re.sub(r'[\u2460-\u2473]', '', meaning).replace('／', '/')
    for cut in FOOTER_CUT:
        i = m.find(cut)
        if i > 0:
            m = m[:i]
    # R2 前缀杂质
    m = re.sub(r'^[A-Za-z]{2,20}\s*[；;,，]\s*', '', m)      # ①ambitious；
    hit = CJK.search(m)
    if hit and head_is_junk(m[:hit.start()]):
        m = m[hit.start():]
        m = re.sub(r'^[\s\.\(\)（）\[\]，,、/；;:：·*\-]+', '', m)
    # R2b 音标碎片必须先于词性标记，否则 "ik'skjuizv." 会被拆成半截
    m = IPA_FRAG.sub('；', m)
    m = POS_MARK.sub('；', m)
    m = POS_AFTER_CJK.sub('；', m)
    # R3 派生栏目
    i = m.find('对照')
    if i > 0:
        m = m[:i]
    # 去「本词重复」开头
    m = re.sub(r'^(?:%s)\s*[；;,，/&\s]\s*' % re.escape(lemma), '', m, flags=re.I)
    # R4 串入邻栏 / 例句
    m = re.split(r'\s@|\s*→', m)[0]
    segs = split_segs(m)
    keep = [segs[0]]
    for s in segs[1:]:
        bare = outside_brackets(s)
        if s.startswith('（=') or s.startswith('(='):
            keep.append(s)
            continue
        if re.search(r'[A-Za-z]{3,}', bare) or '/' in bare:
            break                       # 邻栏单词/音标串台 → 从这里截断
        keep.append(s)
    m = '；'.join(keep)
    m = re.sub(r'(?<=[%s])[ \t]+' % CJK_CH, '\u0001', m)
    m = m.split('\u0001')[0]
    # R5 归一化
    m = re.sub(r'\s+', ' ', m).strip()
    m = m.strip(' ；;,，、·.]-*&～')
    m = re.sub(r'[：:]+', '；', m)
    m = re.sub(r'；{2,}', '；', m)
    m = re.sub(r'；+$', '', m)
    m = re.sub(r'^；+', '', m)
    return m.strip()




rows = []
for p in ['part1.csv', 'part2.csv', 'part3.csv', 'part4.csv']:
    with open(os.path.join(OUT, p), encoding='utf-8-sig', newline='') as f:
        r = csv.reader(f)
        next(r)
        for a, b in r:
            if a.strip() and b.strip():
                rows.append((a.strip(), b.strip()))

seen, order, changed, stats = {}, [], [], collections.Counter()
for lemma, meaning in rows:
    if lemma.lower() in DROP_LEMMA or lemma.endswith('-'):
        stats['丢弃：页脚/词性标记残留'] += 1
        continue
    if any(k in meaning for k in ('词汇索引', '带的单词为书中', '按字母顺序编排', '可用于自测')):
        stats['丢弃：词汇索引页串入'] += 1
        continue
    m = clean(lemma, meaning)
    if not m or not CJK.search(m):
        stats['丢弃：清洗后无中文释义'] += 1
        continue
    if m != meaning:
        changed.append((lemma, meaning, m))
    k = lemma.lower()
    if k in seen:
        stats['重复词合并'] += 1
        if len(m) > len(seen[k]):
            seen[k] = m
        continue
    seen[k] = m
    order.append(k)

final = os.path.join(OUT, '六级单词书_刘晓燕.csv')
with open(final, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['lemma', 'meaning'])
    for k in order:
        w.writerow([k, seen[k]])

print('合并 %d 行 → 最终 %d 词' % (len(rows), len(order)))
print('统计:', dict(stats))
print('清洗改动过的行:', len(changed))
print()
print('--- 抽查：仍含英文单词的释义 ---')
n = 0
for k in order:
    if re.search(r'[A-Za-z]{3,}', seen[k].replace(k, '')):
        n += 1
        if n <= 20:
            print('  ', k, '|', seen[k][:90])
print('合计', n, '条 (%.2f%%)' % (n / len(order) * 100))
print()
print('--- 抽查：释义 >45 字 ---')
n = 0
for k in order:
    if len(seen[k]) > 45:
        n += 1
        if n <= 12:
            print('  ', k, '|', seen[k][:90])
print('合计', n, '条 (%.2f%%)' % (n / len(order) * 100))
print()
print('--- 随机 20 条 ---')
step = len(order) // 20
for k in order[::step][:20]:
    print('  ', k, '|', seen[k])
