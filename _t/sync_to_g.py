# -*- coding: utf-8 -*-
"""把 E:\\英语学习工作台 同步到 G:\\英语学习工作台（只增改，不删除）。
默认只预览；加 --apply 才真正复制。
"""
import os
import sys
import io
import shutil

SRC = r'G:\英语学习工作台'
DST = r'G:\英语学习工作台'
APPLY = '--apply' in sys.argv

# 不参与同步的目录（缓存/临时）
SKIP_DIRS = {'.git', 'node_modules', '__pycache__'}

def walk(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root)
            yield rel, full

new_files, mod_files, same = [], [], 0
for rel, full in walk(SRC):
    target = os.path.join(DST, rel)
    if not os.path.exists(target):
        new_files.append((rel, os.path.getsize(full)))
        continue
    if os.path.getsize(full) != os.path.getsize(target) or \
       abs(os.path.getmtime(full) - os.path.getmtime(target)) > 2:
        mod_files.append((rel, os.path.getsize(full)))
    else:
        same += 1

print('源目录：%s' % SRC)
print('目标目录：%s' % DST)
print('-' * 56)
print('未变   : %d 个文件' % same)
print('新增   : %d 个' % len(new_files))
print('有变化 : %d 个' % len(mod_files))
print('-' * 56)
for label, items in (('新增', new_files), ('变化', mod_files)):
    for rel, size in sorted(items):
        print('  [%s] %-52s %8.1f KB' % (label, rel, size / 1024.0))

if not APPLY:
    print('\n（预览模式，未写入。加 --apply 执行复制）')
    sys.exit(0)

copied = 0
for rel, _ in new_files + mod_files:
    s = os.path.join(SRC, rel)
    d = os.path.join(DST, rel)
    os.makedirs(os.path.dirname(d), exist_ok=True)
    shutil.copy2(s, d)
    copied += 1
print('\n已复制 %d 个文件到 G 盘。' % copied)
