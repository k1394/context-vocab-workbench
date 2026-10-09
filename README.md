# 语境背单词工作台

把六级词汇书拆成「语境 + 例句 + 挖空 + 释义」，在阅读中记单词。单文件网页，手机 / 平板 / 电脑都能用，数据存在云端，多设备自动同步。

## 它能做什么

- · 内置六级词书，按文章语境出题，不是孤立地背单词
- · 正文里的生词自动标出，挖空填词，可点开看释义、音标、例句
- · **划线记笔记**：滑过正文即时出标记，划哪几个字就记哪几个字；跨段落划会合并成一条笔记
- · **自由笔迹**：支持鼠标、手指、电容笔（压感 / 倾斜 / 笔尖预测 / 防手掌误触），荧光笔风格
- · 笔记带完整云端同步 + 离线缓存 + 导入导出备份
- · 可导入 PDF 作为阅读材料

## 怎么用

直接用线上版：<https://www.workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI>

想本地跑：双击 `index.html`。数据存在浏览器本地 + 云端，跟文件放在哪个盘无关。

## 怎么构建

`index.html` 是构建产物，不要手改。改 `patch_src/` 下的源码，然后跑：

```bash
python build_index.py --base index.html.bak5 --out index.html
```

一条命令串起全部补丁，按顺序应用：

| 顺序 | 补丁 | 作用 |
|---|---|---|
| 1 | `patch_wb_select.py` | 内置词书选择器 |
| 2 | `patch_rescue.py` | 加载失败救援 |
| 3 | `patch_fixes.py` | 数据安全：加载对账、账号ID 迁移、孤立单词保护、示例注入幂等、配额预检 |
| 4 | `patch_dist.py` | 分布式词书 |
| 5 | `patch_dist2.py` | 分布式词书（续） |
| 6 | `patch_cleanup.py` | 清理示例数据、14 张表行过滤 |
| 7 | `patch_polish.py` | 界面打磨 |
| 8 | `patch_notes.py` | 划线记笔记 + `patch_src/highlight.js` |
| 9 | `patch_reset.py` | 忘记密码（改云端账号表密码哈希） |
| 10 | `patch_rawoff.py` | 释义插入物打 `data-gloss`，建立 DOM↔原文偏移映射 |
| 11 | `patch_perf.py` | 性能：差异写盘、切章分帧渲染、pdf.js 按需加载 |
| 12 | `patch_draw.py` | 自由笔迹层 + `patch_src/{charrange,hlchar,pen,draw}.js` |

**所有补丁都插在同一个锚点 `/* ===== 内置词书《六级词书》 ===== */` 之前，后跑者更靠前。**
所有 `patch_*.py` 用**纯字符串或正则替换**（不是行号插队），且锚点要兼容平台对HTML 的改写
（属性顺序会被规范化、`<!--pnid:xxx-->` 会被注入）。

`index.html.bak5` 是构建基线，必须一起保留，否则无法复现构建。

## 怎么跑测试

```bash
# 逻辑测试（19 个，不需要浏览器）
node test_notes.js
node test_draw.js
...

# 浏览器测试（8 个，需要先起静态服务器）
python -m http.server 8899 --bind 127.0.0.1
node test_builtin_wb.js
node test_browser_pdf.js
...
```

浏览器测试依赖 Playwright：`NODE_PATH=<playwright 安装目录>/node_modules`。

实测脚本在 `_t/`（`verify_*.js` / `probe_*.js`）：

- `verify_*.js` —— 跑在本地服务器上，验证划线、笔记、笔迹
- `probe_v31.js` —— 跑在**线上链接**上。注意线上内容在 iframe 里，必须
  `page.frames().find(fr => /index\.html/.test(fr.url()))` 再 evaluate，
  在顶层 page 上读只会看到外壳

## 部署

**必须走 WorkBuddy 资料库的 page 事务链**，不能用 `workbuddy_sites_deploy`——
后者发的是应用（`*.app.workbuddy.host`），**不注入 `__SMART_PAGE__.database`，云端同步全废**。

```bash
S=<library skill 路径>/page
python "$S/create_page_transaction.py" --node-id "<node_id>"   # 开事务，拿 CDN 基线
#把改动应用到线上基线（平台改写过，不能直接覆盖上传）
git merge-file -p 线上基线 本地上一版 本地新版 > merged.html
python "$S/upload_page_artifact.py" --transaction-id "<tx>" --path index.html --file merged.html
python "$S/commit_page_transaction.py" --transaction-id "<tx>" --message "..." --cleanup-dir <dir>
python "$S/publish_page.py" --node-id "<node_id>"
```

### 部署时最容易踩的坑

1. **不能直接覆盖上传**。线上 HTML 被平台改写过：每个元素加了 `data-page-node-id` /
   `data-pnid-children`、属性顺序被规范化、注入了 `/page/page_comm/inject.js`。
   正解是三方合并（见上），只带自己的改动上去。
2. **`--node-id` 传裸 id**，传 `/p/<id>` 会被拼成 `P:/...` 报 node not found。
3. **双向 diff 自检**：A =本地旧版 vs 线上旧版，B = 本地新版 vs 合并产物，
   两者的差异规模必须完全一致（块数 / 改行数）。相等才证明没碰平台托管区。
4. pdf.js 的 `<script>` 标签冲突要用平台风格解决：**保留平台 pnid 属性 + 追加 `id` /
   `type="text/plain"`**，和平台给 `pdfjsWorkerCode` 的写法一致。

## 目录结构

```
index.html              构建产物（勿手改）
index.html.bak5         构建基线（必须保留）
build_index.py          一条命令跑完整条补丁链
patch_*.py              各功能的补丁脚本
patch_src/*.js          被插入 index.html 的功能模块源码
  highlight.js            划线、笔记抽屉、云端同步
  charrange.js            字符级区间计算（光标位置 → 句内偏移）
  hlchar.js               字符级高亮渲染
  pen.js                  触控笔识别（压感 / 倾斜 / 防手掌误触）
  draw.js                 画布笔迹层
test_*.js               测试
_t/                     浏览器实测脚本
testdata/               测试素材
create_notes_table.py   建 context_notes 表
```

## 数据与隐私

-· 真实学习数据（文章、标注、笔记、进度）存在**云端数据库**，不在代码里
- `index.html` 里不含任何真实文章内容、昵称、账号
- 测试脚本里的昵称已替换为假名
- `.workbuddy/` 记忆日志已 gitignore

## 第三方

`index.html` 与 `index.html.bak5` 内嵌了 [pdf.js](https://mozilla.github.io/pdf.js/)（Apache-2.0），
用于 PDF 导入。已改成按需加载：首次真正导入 PDF 时才注入，不占首屏体积。