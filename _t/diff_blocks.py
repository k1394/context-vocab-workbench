import difflib
import sys

old = open(sys.argv[1], encoding='utf-8').read().splitlines(keepends=True)
new = open(sys.argv[2], encoding='utf-8').read().splitlines(keepends=True)

sm = difflib.SequenceMatcher(None, old, new, autojunk=False)
same = 0
repl = 0
ins = 0
dele = 0
blocks = 0
ins_blocks = 0
del_blocks = 0
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == 'equal':
        same += i2 - i1
    elif tag == 'replace':
        repl += max(i2 - i1, j2 - j1)
        blocks += 1
    elif tag == 'insert':
        ins += j2 - j1
        ins_blocks += 1
    elif tag == 'delete':
        dele += i2 - i1
        del_blocks += 1
print('块=%d 改=%d 增=%d(%d块) 删=%d(%d块) 未变=%d' % (blocks, repl, ins, ins_blocks, dele, del_blocks, same))