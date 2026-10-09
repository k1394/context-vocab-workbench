import difflib
import os

DIR = r'G:/英语学习工作台'
A = os.path.join(DIR, '_artifacts')
on_v25 = os.path.join(A, 'index_v25_online.html')
on_v26 = os.path.join(A, 'index_v26_online.html')
pre = os.path.join(A, 'index_v25_local_before_char.html')
now = os.path.join(DIR, 'index.html')


def cmp_blocks(old_f, new_f):
    old = open(old_f, encoding='utf-8').read().splitlines(keepends=True)
    new = open(new_f, encoding='utf-8').read().splitlines(keepends=True)
    sm = difflib.SequenceMatcher(None, old, new, autojunk=False)
    repl = ins = dele = blocks = insb = delb = same = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            same += i2 - i1
        elif tag == 'replace':
            repl += max(i2 - i1, j2 - j1)
            blocks += 1
        elif tag == 'insert':
            ins += j2 - j1
            insb += 1
        elif tag == 'delete':
            dele += i2 - i1
            delb += 1
    return dict(blocks=blocks, repl=repl, ins=ins, insb=insb, dele=dele, delb=delb, same=same)


print('A 本地v25 vs 线上v25（平台改写） ', cmp_blocks(pre, on_v25))
print('B 线上v25 vs 线上v26（本轮补丁） ', cmp_blocks(on_v25, on_v26))
print('C 本地v25 vs 本地v26（本轮补丁） ', cmp_blocks(pre, now))
print('D 本地v26 vs 线上v26（应只剩平台） ', cmp_blocks(now, on_v26))
