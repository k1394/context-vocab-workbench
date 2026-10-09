#!/usr/bin/env python3
"""批量创建语境背单词工作台的 13 张数据表。"""
import subprocess
import json
import sys

# 公共参数
SPACE_ID = "FT8Fm3Mbiii5ORGZKxm3ix"  # 我的文档
TOKEN = "op_xjwwpqzv20de5hkattj7wt5sbg"

CREATE_DB = "C:/Users/Administrator/AppData/Local/Programs/WorkBuddy/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/library/database/create_database.py"


def create_table(title: str, properties: list, parent_id: str = None) -> str:
    schema = {"title": title, "properties": properties, "space_id": SPACE_ID}
    if parent_id:
        schema["parent_id"] = parent_id
    cmd = [
        "python3", CREATE_DB,
        "--token-stdin",
        "--schema", json.dumps(schema, ensure_ascii=False)
    ]
    proc = subprocess.run(
        cmd,
        input=f"{TOKEN}\n",
        capture_output=True, text=True, timeout=60
    )
    out = proc.stdout.strip()
    if out.startswith('{"error"'):
        print(f"❌ {title}: {out}", file=sys.stderr)
        return ""
    try:
        data = json.loads(out)
        if data.get("database_id"):
            print(f"✅ {title} → {data.get('database_id')}")
            return data["database_id"]
        print(f"❌ {title}: 无 database_id: {out}", file=sys.stderr)
        return ""
    except Exception as e:
        print(f"❌ {title}: 解析失败 {e}: {out}", file=sys.stderr)
        return ""


# 13 张表的 schema 设计 —— 用资料库支持类型（text/number/select/multi_select/date/checkbox/url/email）
# 用 profile_id (text) 隔离多账号
PROFILE_ID = {"name": "profile_id", "config": {"text": ""}}

COMMON_DATE = {"format": "yyyy-mm-dd hh:mm"}
COMMON_TEXT = {"text": ""}
COMMON_NUM = {"decimalPlaces": 0, "useSeparate": False}

tables = {}

# 1. 用户表
tables["context_users"] = create_table(
    "语境背单词-用户表",
    [
        PROFILE_ID,
        {"name": "昵称", "config": COMMON_TEXT},
        {"name": "密码哈希", "config": COMMON_TEXT},
        {"name": "连续天数", "config": {"number": COMMON_NUM}},
        {"name": "最后学习日", "config": {"date": COMMON_DATE}},
        {"name": "创建时间", "config": {"date": COMMON_DATE}},
        {"name": "更新时间", "config": {"date": COMMON_DATE}},
        {"name": "最后同步", "config": {"date": COMMON_DATE}}
    ]
)

# 2. 学习资料表
tables["context_materials"] = create_table(
    "语境背单词-学习资料表",
    [
        PROFILE_ID,
        {"name": "资料ID", "config": COMMON_TEXT},
        {"name": "标题", "config": COMMON_TEXT},
        {"name": "来源类型", "config": {"select": {"options": [
            {"id": "s_pdf", "text": "PDF"},
            {"id": "s_txt", "text": "TXT"},
            {"id": "s_docx", "text": "DOCX"},
            {"id": "s_manual", "text": "手动"}
        ]}}},
        {"name": "原始文本", "config": COMMON_TEXT},
        {"name": "章节JSON", "config": COMMON_TEXT},
        {"name": "章节数", "config": {"number": COMMON_NUM}},
        {"name": "创建时间", "config": {"date": COMMON_DATE}},
        {"name": "更新时间", "config": {"date": COMMON_DATE}}
    ]
)

# 3. 章节表
tables["context_chapters"] = create_table(
    "语境背单词-章节表",
    [
        PROFILE_ID,
        {"name": "资料ID", "config": COMMON_TEXT},
        {"name": "章节ID", "config": COMMON_TEXT},
        {"name": "章节标题", "config": COMMON_TEXT},
        {"name": "顺序", "config": {"number": COMMON_NUM}},
        {"name": "章节内容", "config": COMMON_TEXT},
        {"name": "目标词数", "config": {"number": COMMON_NUM}},
        {"name": "已生成语境材料", "config": {"checkbox": False}}
    ]
)

# 4. 单词书表
tables["context_wordbooks"] = create_table(
    "语境背单词-单词书表",
    [
        PROFILE_ID,
        {"name": "单词书ID", "config": COMMON_TEXT},
        {"name": "书名", "config": COMMON_TEXT},
        {"name": "源文件", "config": COMMON_TEXT},
        {"name": "词条数", "config": {"number": COMMON_NUM}},
        {"name": "导入时间", "config": {"date": COMMON_DATE}}
    ]
)

# 5. 单词表
tables["context_words"] = create_table(
    "语境背单词-单词表",
    [
        PROFILE_ID,
        {"name": "单词书ID", "config": COMMON_TEXT},
        {"name": "词元", "config": COMMON_TEXT},
        {"name": "词性", "config": COMMON_TEXT},
        {"name": "音标", "config": COMMON_TEXT},
        {"name": "中文释义", "config": COMMON_TEXT},
        {"name": "例句", "config": COMMON_TEXT},
        {"name": "单元标签", "config": COMMON_TEXT}
    ]
)

# 6. 文章词汇匹配表
tables["context_matches"] = create_table(
    "语境背单词-匹配表",
    [
        PROFILE_ID,
        {"name": "资料ID", "config": COMMON_TEXT},
        {"name": "章节ID", "config": COMMON_TEXT},
        {"name": "词元", "config": COMMON_TEXT},
        {"name": "对应中文", "config": COMMON_TEXT},
        {"name": "使用义项", "config": COMMON_TEXT},
        {"name": "位置", "config": {"number": COMMON_NUM}},
        {"name": "所在句子", "config": COMMON_TEXT},
        {"name": "手动修改", "config": {"checkbox": False}}
    ]
)

# 7. 阅读进度表
tables["context_progress"] = create_table(
    "语境背单词-阅读进度表",
    [
        PROFILE_ID,
        {"name": "资料ID", "config": COMMON_TEXT},
        {"name": "章节ID", "config": COMMON_TEXT},
        {"name": "模式", "config": {"select": {"options": [
            {"id": "m_meaning", "text": "释义版"},
            {"id": "m_blank", "text": "挖空版"},
            {"id": "m_original", "text": "原文版"}
        ]}}},
        {"name": "滚动百分比", "config": {"number": {"decimalPlaces": 2, "useSeparate": False}}},
        {"name": "段落序号", "config": {"number": COMMON_NUM}},
        {"name": "更新时间", "config": {"date": COMMON_DATE}}
    ]
)

# 8. 学习会话表
tables["context_sessions"] = create_table(
    "语境背单词-学习会话表",
    [
        PROFILE_ID,
        {"name": "会话ID", "config": COMMON_TEXT},
        {"name": "资料ID", "config": COMMON_TEXT},
        {"name": "开始时间", "config": {"date": COMMON_DATE}},
        {"name": "结束时间", "config": {"date": COMMON_DATE}},
        {"name": "学习分钟", "config": {"number": COMMON_NUM}},
        {"name": "阅读章节", "config": COMMON_TEXT},
        {"name": "遇到词数", "config": {"number": COMMON_NUM}}
    ]
)

# 9. 答题记录表
tables["context_answers"] = create_table(
    "语境背单词-答题记录表",
    [
        PROFILE_ID,
        {"name": "会话ID", "config": COMMON_TEXT},
        {"name": "词元", "config": COMMON_TEXT},
        {"name": "轮次", "config": {"select": {"options": [
            {"id": "r1", "text": "第一轮"},
            {"id": "r2", "text": "第二轮"}
        ]}}},
        {"name": "题型", "config": {"select": {"options": [
            {"id": "q_multi", "text": "四选一"},
            {"id": "q_recall", "text": "主动回忆"}
        ]}}},
        {"name": "是否正确", "config": {"checkbox": False}},
        {"name": "用户输入", "config": COMMON_TEXT},
        {"name": "标准答案", "config": COMMON_TEXT},
        {"name": "时间戳", "config": {"date": COMMON_DATE}}
    ]
)

# 10. 单词掌握状态表
tables["context_mastery"] = create_table(
    "语境背单词-掌握状态表",
    [
        PROFILE_ID,
        {"name": "词元", "config": COMMON_TEXT},
        {"name": "资料ID", "config": COMMON_TEXT},
        {"name": "状态", "config": {"select": {"options": [
            {"id": "st_known", "text": "已掌握"},
            {"id": "st_fuzzy", "text": "模糊"},
            {"id": "st_unknown", "text": "不认识"}
        ]}}},
        {"name": "尝试次数", "config": {"number": COMMON_NUM}},
        {"name": "正确次数", "config": {"number": COMMON_NUM}},
        {"name": "错误次数", "config": {"number": COMMON_NUM}},
        {"name": "正确率", "config": {"number": {"decimalPlaces": 2, "useSeparate": False, "displayType": "percent"}}},
        {"name": "最近答案", "config": COMMON_TEXT},
        {"name": "最近复习", "config": {"date": COMMON_DATE}},
        {"name": "复习等级", "config": {"number": COMMON_NUM}},
        {"name": "下次复习", "config": {"date": COMMON_DATE}},
        {"name": "今日连错", "config": {"number": COMMON_NUM}}
    ]
)

# 11. 复习队列表
tables["context_review"] = create_table(
    "语境背单词-复习队列表",
    [
        PROFILE_ID,
        {"name": "词元", "config": COMMON_TEXT},
        {"name": "等级", "config": {"number": COMMON_NUM}},
        {"name": "下次复习日期", "config": {"date": COMMON_DATE}},
        {"name": "上次结果", "config": {"select": {"options": [
            {"id": "rev_known", "text": "认识"},
            {"id": "rev_fuzzy", "text": "模糊"},
            {"id": "rev_unknown", "text": "不认识"},
            {"id": "rev_skip", "text": "跳过"}
        ]}}},
        {"name": "资料ID", "config": COMMON_TEXT},
        {"name": "加入时间", "config": {"date": COMMON_DATE}}
    ]
)

# 12. 生词本表
tables["context_vocab"] = create_table(
    "语境背单词-生词本表",
    [
        PROFILE_ID,
        {"name": "词元", "config": COMMON_TEXT},
        {"name": "音标", "config": COMMON_TEXT},
        {"name": "词性", "config": COMMON_TEXT},
        {"name": "中文释义", "config": COMMON_TEXT},
        {"name": "语境", "config": COMMON_TEXT},
        {"name": "资料ID", "config": COMMON_TEXT},
        {"name": "加入时间", "config": {"date": COMMON_DATE}},
        {"name": "手动添加", "config": {"checkbox": False}}
    ]
)

# 13. 用户自定义同义答案表
tables["context_synonyms"] = create_table(
    "语境背单词-同义答案表",
    [
        PROFILE_ID,
        {"name": "词元", "config": COMMON_TEXT},
        {"name": "同义答案", "config": COMMON_TEXT},
        {"name": "接受", "config": {"checkbox": False}},
        {"name": "使用次数", "config": {"number": COMMON_NUM}},
        {"name": "更新时间", "config": {"date": COMMON_DATE}}
    ]
)


with open("G:/英语学习工作台/databases.json", "w", encoding="utf-8") as f:
    json.dump(tables, f, ensure_ascii=False, indent=2)

print("\n===== 完成 =====")
print("保存到 G:/英语学习工作台/databases.json")
