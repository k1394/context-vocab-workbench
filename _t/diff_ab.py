import difflib
import os

DIR = r'G:/英语学习工作台'
A = os.path.join(DIR, '_artifacts')
on_v22 = os.path.join(A, 'index_v22_online_check.html')
pre = os.path.join(A, 'index_v22_local_before_notes.html')
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


on_v23 = os.path.join(A, 'index_v23_online.html')

print('A 本地v22 vs 线上v22（平台改写） ', cmp_blocks(pre, on_v22))
print('B 线上v22 vs 线上v23（本轮补丁） ', cmp_blocks(on_v22, on_v23))
print('C 本地v22 vs 本地v23（本轮补丁） ', cmp_blocks(pre, now))
print('D 本地v23 vs 线上v23（应只剩平台） ', cmp_blocks(now, on_v23))