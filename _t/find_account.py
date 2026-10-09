# 只读地从浏览器 localStorage (leveldb) 里提取账号昵称与 profile_id
# 安全约束：绝不输出、绝不处理 passHash 字段
import glob
import json
import os
import re

TARGETS = [
    r'C:/Users/Administrator/AppData/Local/Google/Chrome/User Data/Default/Local Storage/leveldb/*',
    r'C:/Users/Administrator/AppData/Local/Microsoft/Edge/User Data/Default/Local Storage/leveldb/*',
]

NICK_RE = re.compile(rb'"nick"\s*:\s*"((?:[^"\\]|\\.)*)"')
PID_RE = re.compile(rb'"profileId"\s*:\s*"((?:[^"\\]|\\.)*)"')
# 只确认哈希存在，不输出内容
HASHS_RE = re.compile(rb'"passHash"\s*:\s*"[^"]*"')


def decode(b):
    try:
        return b.decode('utf-8')
    except Exception:
        return b.decode('utf-8', 'replace')


def scan(path_glob, label):
    out = []
    for fn in glob.glob(path_glob):
        try:
            data = open(fn, 'rb').read()
        except Exception:
            continue
        # 只在含 nick 的片段里配对
        for m in NICK_RE.finditer(data):
            nick = decode(m.group(1))
            if not nick.strip():
                continue
            window = data[max(0, m.start() - 400): m.end() + 400]
            pid_m = PID_RE.search(window)
            pid = decode(pid_m.group(1)) if pid_m else ''
            out.append((nick, pid, bool(HASHS_RE.search(window)), os.path.basename(fn)))
    return out


seen = {}
for pat in TARGETS:
    label = pat.split('/Local')[0].split('/')[-3]
    rows = scan(pat, label)
    for nick, pid, has, fn in rows:
        key = (nick, pid)
        if key not in seen:
            seen[key] = (label, fn, has)

print('=== 浏览器里能找到的账号（只列昵称和 profile_id，不含密码）===')
if not seen:
    print('  没有找到已登记的账号')
for (nick, pid), (label, fn, has) in seen.items():
    print('  昵称: %-16s  profile_id: %-24s  已存密码哈希: %s   [%s/%s]'
          % (nick, pid or '(空)', '是' if has else '否', label, fn))

print()
print('说明：密码在 localStorage 里只以 SHA-256 哈希形式存在，无法反推出原文。')