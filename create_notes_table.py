#!/usr/bin/env python3
"""为「划线记笔记」功能新建第 14 张云表：语境背单词-笔记表。

沿用 create_databases.py 的模式（资料库 create_database.py + token-stdin）。
"""
import subprocess
import json
import os
import sys

# 防重复建表：表一旦建好，id 就落在 _notes_db_id.txt 里，误跑本脚本直接返回
if os.path.exists("_notes_db_id.txt"):
    _existing = open("_notes_db_id.txt", encoding="utf-8").read().strip()
    if _existing:
        print("已存在笔记表，跳过建表：NOTES_DB_ID=" + _existing)
        sys.exit(0)

SPACE_ID = "FT8Fm3Mbiii5ORGZKxm3ix"  # 我的文档
TOKEN = "op_xjwwpqzv20de5hkattj7wt5sbg"

CREATE_DB = ("C:/Users/Administrator/AppData/Local/Programs/WorkBuddy/resources/"
             "app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/library/"
             "database/create_database.py")

PY = r"C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe"

COMMON_DATE = {"format": "yyyy-mm-dd hh:mm"}
COMMON_TEXT = {"text": ""}
COMMON_NUM = {"decimalPlaces": 0, "useSeparate": False}


def create_table(title, properties, parent_id=None):
    schema = {"title": title, "properties": properties, "space_id": SPACE_ID}
    if parent_id:
        schema["parent_id"] = parent_id
    cmd = [PY, CREATE_DB, "--token-stdin",
           "--schema", json.dumps(schema, ensure_ascii=False)]
    proc = subprocess.run(cmd, input=TOKEN + "\n", capture_output=True, text=True, timeout=90)
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if not out:
        print("❌ 无输出。stderr=%s" % err[:800])
        return ""
    # 输出可能是多行：第一行是 JSON，后面还跟一行 KS_USER_REPLY 提示语，
    # 所以只取第一行解析（踩过：直接 json.loads 整个 stdout 会报 Extra data）
    first = out.splitlines()[0].strip()
    if first.startswith('{"error"'):
        print("❌ %s: %s" % (title, first[:800]))
        return ""
    try:
        data = json.loads(first)
    except Exception as e:
        print("❌ 解析失败 %s: %s" % (e, first[:800]))
        return ""
    if data.get("database_id"):
        print("✅ %s → %s" % (title, data["database_id"]))
        return data["database_id"]
    print("❌ %s: 无 database_id: %s" % (title, out[:800]))
    return ""


# 笔记表设计
# 一条「笔记」= 一次划线动作。可能覆盖 1 段或 2 段（跨段时两段句子合并成一条、内部编号）
# 范围用 JSON 存，形如 [{"p":3,"s":10,"e":45},{"p":4,"s":0,"e":30}]
# 这样渲染高亮时能按「段落序号 + 字符偏移」精确还原，不受每次整段重建影响
db_id = create_table(
    "语境背单词-笔记表",
    [
        {"name": "profile_id", "config": COMMON_TEXT},
        {"name": "资料ID", "config": COMMON_TEXT},
        {"name": "章节ID", "config": COMMON_TEXT},
        {"name": "笔记ID", "config": COMMON_TEXT},
        {"name": "范围JSON", "config": COMMON_TEXT},
        {"name": "划线内容", "config": COMMON_TEXT},
        {"name": "句子数", "config": {"number": COMMON_NUM}},
        {"name": "跨段", "config": {"checkbox": False}},
        {"name": "创建时间", "config": {"date": COMMON_DATE}},
    ]
)

if db_id:
    print("NOTES_DB_ID=" + db_id)
    with open("_notes_db_id.txt", "w", encoding="utf-8") as f:
        f.write(db_id)
else:
    sys.exit(1)
