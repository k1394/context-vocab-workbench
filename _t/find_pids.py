import glob
import os
import re
from collections import Counter

PAT = re.compile(rb'p_([A-Za-z0-9_\-]{1,40}|[\xe4-\xe9][\x80-\xbf]{2}(\xe4[\x80-\xbf]{2}|[\xe5-\xe9][\x80-\xbf]{2}|\xe5[\x80-\xbf]{2})+)_\d{10,}')

agg = Counter()
for fn in sorted(glob.glob('_t/edge_ls/*.ldb')):
    data = open(fn, 'rb').read()
    for m in PAT.finditer(data):
        raw = m.group(1)
        # 只保留可打印 ASCII 与 UTF-8 中文
        try:
            nick = raw.decode('utf-8')
        except Exception:
            continue
        nick = ''.join(ch for ch in nick if ch.isprintable())
        if nick:
            agg[nick] += 1

print('=== 从 profile_id（p_昵称_时间戳）反查到的昵称 ===')
if not agg:
    print('  没匹配到')
for nick, c in agg.most_common(30):
    print('  昵称: %-24s 命中 %d 次' % (nick, c))