# -*- coding: utf-8 -*-
import json, glob, os

fs = sorted(glob.glob(os.path.join('_ocrcache', '*.json')))
print('files', len(fs))
d = json.load(open(fs[0], encoding='utf-8'))
print('type', type(d))
if isinstance(d, dict):
    print('keys', list(d.keys())[:10])
    s = json.dumps(d, ensure_ascii=False)
    print('sample', s[:500])
else:
    print('len', len(d), 'first', json.dumps(d[:3], ensure_ascii=False)[:400])
