#!/usr/bin/env python3
"""生成完整的语境背单词工作台 HTML 文件。"""
import json
import os

# 读取数据库ID映射
with open("G:/英语学习工作台/databases.json", "r", encoding="utf-8") as f:
    db_ids = json.load(f)

# 示例文章内容
sample_text = """虞寻歌睁眼后看着到天花板上那名贵华美的吊灯还有些茫然。
她不是被虞寻欢钉在地牢的法阵里放血吗？
只一秒，她便条件反射地调动体内能量，一整年的逃亡经历让她身体已形成本能，不管在哪儿不管现在什么局面，她先躲到安全的地方再细想。
然而她一个帅气的鲤鱼挺身，无事发生……
体内的反应告诉她，她现在就是个普通人。
正在此时，门外响起了说话声，是她做梦也不会忘记的声音，她的经纪人柳争流。
她坐起身，环顾四周，是酒店？枕边还有她已经多年没见过的手机，她拿起一看，上面显示时间是2月21日23点。"""

# 示例单词书 (CSV格式)
sample_csv = """lemma,pos,ipa,meaning,example,unit
ceiling,n.,/ˈsiːlɪŋ/,天花板,A white ceiling reflected the dim light.,U1
beautiful,adj.,/ˈbjuːtɪfl/,美丽的；华美的,The ceiling has a beautiful chandelier.,U1
condition,n.,/kənˈdɪʃn/,条件；状况,She responded by condition reflex.,U1
reflect,v.,/rɪˈflekt/,反射；反映,Her eyes reflected the fear.,U1
remove,v.,/rɪˈmuːv/,移开；调动,She tried to remove her body from danger.,U1
body,n.,/ˈbɒdi/,身体；躯体,His body was shaking.,U1
formation,n.,/fɔːˈmeɪʃn/,形成；构成,The formation of habits takes time.,U1
instinct,n.,/ˈɪnstɪŋkt/,本能；直觉,Trust your instinct.,U1
room,n.,/ruːm/,房间；空间,She looked around the room.,U1
internal,adj.,/ɪnˈtɜːnl/,体内的；内部的,The internal injury was serious.,U1
react,v.,/riˈækt/,反应；做出反应,She reacted instantly.,U1
inform,v.,/ɪnˈfɔːm/,告诉；通知,She informed him of the change.,U1
speak,v.,/spiːk/,说话；讲话,She spoke softly.,U1
nor,conj.,/nɔːr/,也不,She did not cry nor did she smile.,U1
forget,v.,/fəˈɡet/,忘记；遗忘,I will never forget that day.,U1
around,prep.,/əˈraʊnd/,四处；周围,She looked around.,U1
onto,prep.,/ˈɒntə/,在...之上,The book fell onto the floor.,U1
elapse,v.,/iˈlæps/,(时间)流逝,Years had elapsed since they met.,U1"""

# 构建 databaseId JSON
db_ids_json = json.dumps(db_ids, ensure_ascii=False)

html = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=5.0">
<meta name="theme-color" content="#2d8659">
<title>语境背单词工作台</title>
<style>
:root{
  --bg:#f7f8f5;--card:#fff;--border:#e2e6df;--text:#2a2e26;--text2:#5a6055;--text3:#8a9085;
  --green:#2d8659;--green-l:#e8f3ec;--green-d:#1f5f3f;--orange:#e8820e;--orange-l:#fdf3e3;
  --red:#d6483d;--red-l:#fbe9e7;--blue:#3a6ea5;--gray:#8a9085;--gray-l:#f0f1ed;
  --radius:10px;--shadow:0 1px 4px rgba(0,0,0,.06);--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;-webkit-text-size-adjust:100%}
body{font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,textarea,select{font-family:inherit;font-size:16px;outline:none}
a{color:var(--green);text-decoration:none}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;transition:.15s;min-height:40px;border:1px solid transparent}
.btn-primary{background:var(--green);color:#fff}.btn-primary:hover{background:var(--green-d)}
.btn-outline{border:1px solid var(--border);color:var(--text)}.btn-outline:hover{border-color:var(--green);color:var(--green)}
.btn-danger{background:var(--red);color:#fff}.btn-sm{padding:5px 12px;font-size:13px;min-height:32px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600}
.tag-green{background:var(--green-l);color:var(--green-d)}
.tag-orange{background:var(--orange-l);color:var(--orange)}
.tag-red{background:var(--red-l);color:var(--red)}
.tag-gray{background:var(--gray-l);color:var(--gray)}

/* ===== 登录页 ===== */
#authScreen{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;background:linear-gradient(135deg,var(--green-l) 0%,var(--bg) 100%)}
.auth-box{background:var(--card);border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:36px 32px;width:100%;max-width:400px}
.auth-box h1{font-size:24px;color:var(--green-d);margin-bottom:4px;display:flex;align-items:center;gap:8px}
.auth-box p.sub{color:var(--text3);font-size:14px;margin-bottom:24px}
.auth-tabs{display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid var(--border)}
.auth-tab{flex:1;padding:10px;text-align:center;font-weight:600;color:var(--text3);border-bottom:2px solid transparent;margin-bottom:-2px;font-size:14px}
.auth-tab.active{color:var(--green);border-color:var(--green)}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:13px;color:var(--text2);margin-bottom:6px;font-weight:600}
.form-group input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:16px}
.form-group input:focus{border-color:var(--green);box-shadow:0 0 0 3px var(--green-l)}
.auth-err{color:var(--red);font-size:13px;margin:8px 0;min-height:18px}
.auth-hint{color:var(--text3);font-size:12px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border);line-height:1.5}

/* ===== 主应用 ===== */
#app{display:none;min-height:100vh}
.topbar{position:sticky;top:0;z-index:100;background:var(--card);border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;justify-content:space-between;height:56px}
.topbar-left{display:flex;align-items:center;gap:12px}
.topbar h2{font-size:18px;color:var(--green-d);white-space:nowrap}
.topbar-right{display:flex;align-items:center;gap:10px}
.sync-badge{font-size:12px;padding:3px 10px;border-radius:12px;display:flex;align-items:center;gap:4px}
.sync-on{background:var(--green-l);color:var(--green-d)}
.sync-off{background:var(--gray-l);color:var(--gray)}
.user-chip{font-size:13px;color:var(--text2);padding:4px 10px;background:var(--gray-l);border-radius:16px}
.nav-tabs{display:flex;gap:2px;background:var(--card);border-bottom:1px solid var(--border);padding:0 12px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.nav-tab{padding:10px 14px;font-size:14px;color:var(--text2);white-space:nowrap;border-bottom:2px solid transparent;transition:.15s}
.nav-tab:hover{color:var(--green)}
.nav-tab.active{color:var(--green);border-color:var(--green);font-weight:600}
.main{max-width:900px;margin:0 auto;padding:20px 16px 80px}

/* ===== Dashboard ===== */
.dash-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.dash-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-align:center}
.dash-card .num{font-size:28px;font-weight:800;color:var(--green-d)}
.dash-card .num.orange{color:var(--orange)}
.dash-card .num.red{color:var(--red)}
.dash-card .lbl{font-size:13px;color:var(--text3);margin-top:4px}
.dash-recent{margin-bottom:16px}
.dash-recent h3{font-size:15px;margin-bottom:8px;color:var(--text)}
.recent-item{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:6px}
.recent-item .info{flex:1}
.recent-item .title{font-size:14px;font-weight:600}
.recent-item .meta{font-size:12px;color:var(--text3)}
.recent-item .progress{font-size:12px;color:var(--green);padding:2px 8px;background:var(--green-l);border-radius:4px}
.btn-continue{display:block;width:100%;padding:14px;text-align:center;background:var(--green);color:#fff;border-radius:10px;font-size:16px;font-weight:700;margin-top:8px}
.btn-continue:hover{background:var(--green-d)}

/* ===== 资料管理 ===== */
.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.section-head h2{font-size:18px;color:var(--text)}
.upload-zone{border:2px dashed var(--border);border-radius:var(--radius);padding:32px;text-align:center;color:var(--text3);cursor:pointer;transition:.15s;margin-bottom:16px}
.upload-zone:hover{border-color:var(--green);background:var(--green-l)}
.upload-zone.dragover{border-color:var(--green);background:var(--green-l)}
.material-list{display:flex;flex-direction:column;gap:8px}
.material-item{display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:8px}
.material-item .info{flex:1;min-width:0}
.material-item .title{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.material-item .meta{font-size:12px;color:var(--text3);margin-top:2px}
.material-item .actions{display:flex;gap:6px;flex-shrink:0}
.empty-state{text-align:center;padding:40px 20px;color:var(--text3)}
.empty-state svg{width:48px;height:48px;opacity:.4;margin-bottom:8px}

/* ===== 学习页 ===== */
.learn-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px}
.learn-toolbar .mode-tabs{display:flex;gap:2px;background:var(--gray-l);border-radius:6px;padding:2px}
.learn-toolbar .mode-tab{padding:6px 12px;font-size:13px;border-radius:4px;color:var(--text2)}
.learn-toolbar .mode-tab.active{background:var(--card);color:var(--green-d);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.learn-toolbar .spacer{flex:1}
.learn-toolbar .toggle-group{display:flex;gap:6px}
.learn-toolbar .toggle{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text2);cursor:pointer;padding:4px 8px;border-radius:4px}
.learn-toolbar .toggle input{margin:0}
.reading-area{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px 28px;font-size:17px;line-height:2;min-height:300px}
.reading-area p{margin-bottom:12px;text-indent:2em}
.reading-area .word-ins{color:var(--green);font-weight:600;cursor:pointer;border-bottom:1px dashed var(--green);padding:0 2px}
.reading-area .word-ins:hover{background:var(--green-l)}
.reading-area .blank-box{display:inline-block;min-width:80px;padding:2px 8px;border:1px solid var(--green);border-radius:4px;background:var(--green-l);margin:0 2px}
.reading-area .blank-box input{width:100%;border:none;background:transparent;text-align:center;color:var(--green-d);font-weight:600;font-size:15px;padding:2px 0}
.reading-area .blank-box.correct{border-color:var(--green);background:#d4edda}
.reading-area .blank-box.wrong{border-color:var(--red);background:var(--red-l)}
.reading-area .blank-answer{color:var(--red);font-weight:600;font-size:14px;margin-left:4px}
.chapter-nav{display:flex;align-items:center;justify-content:space-between;margin-top:16px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px}
.chapter-nav .ch-title{font-size:14px;font-weight:600}
.chapter-nav .ch-progress{font-size:12px;color:var(--text3)}
.chapter-nav .btns{display:flex;gap:6px}

/* 词卡弹窗 */
.word-card-modal{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.4);padding:20px}
.word-card-modal.show{display:flex}
.word-card{background:var(--card);border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.15)}
.word-card .wc-word{font-size:28px;font-weight:800;color:var(--text);margin-bottom:4px}
.word-card .wc-ipa{font-size:16px;color:var(--text3);margin-bottom:12px}
.word-card .wc-pos{font-size:13px;color:var(--orange);font-weight:600;margin-bottom:8px}
.word-card .wc-meaning{font-size:16px;color:var(--text);line-height:1.6;margin-bottom:12px}
.word-card .wc-context{font-size:14px;color:var(--text2);background:var(--green-l);border-radius:8px;padding:10px 12px;margin-bottom:16px;line-height:1.6}
.word-card .wc-context .hl{color:var(--green-d);font-weight:700}
.word-card .wc-actions{display:flex;gap:8px;flex-wrap:wrap}
.word-card .wc-speak{padding:6px 12px;border-radius:20px;background:var(--green-l);color:var(--green-d);font-size:13px;display:flex;align-items:center;gap:4px}

/* ===== 测试页 ===== */
.test-area{max-width:600px;margin:0 auto}
.test-progress{display:flex;align-items:center;gap:8px;margin-bottom:16px}
.test-progress .bar{flex:1;height:6px;background:var(--gray-l);border-radius:3px;overflow:hidden}
.test-progress .bar-fill{height:100%;background:var(--green);transition:.3s}
.test-progress .count{font-size:13px;color:var(--text3)}
.test-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px 24px}
.test-card .q-word{font-size:28px;font-weight:800;text-align:center;margin-bottom:6px}
.test-card .q-ipa{text-align:center;color:var(--text3);font-size:15px;margin-bottom:20px}
.test-card .q-hint{text-align:center;font-size:13px;color:var(--text3);margin-bottom:20px}
.opt-btn{display:block;width:100%;padding:12px 16px;margin-bottom:8px;border:1px solid var(--border);border-radius:8px;text-align:left;font-size:15px;transition:.15s;background:var(--card)}
.opt-btn:hover{border-color:var(--green);background:var(--green-l)}
.opt-btn.correct{border-color:var(--green);background:#d4edda;color:var(--green-d);font-weight:600}
.opt-btn.wrong{border-color:var(--red);background:var(--red-l);color:var(--red);font-weight:600}
.opt-btn:disabled{cursor:default}
.test-input{width:100%;padding:12px 16px;border:2px solid var(--border);border-radius:8px;font-size:16px;text-align:center}
.test-input:focus{border-color:var(--green)}
.test-feedback{margin-top:12px;padding:12px;border-radius:8px;font-size:14px;display:none}
.test-feedback.show{display:block}
.test-feedback.ok{background:#d4edda;color:var(--green-d)}
.test-feedback.err{background:var(--red-l);color:var(--red)}
.test-feedback.maybe{background:var(--orange-l);color:var(--orange)}

/* ===== 词表/错词/复习 ===== */
.vocab-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.vocab-toolbar select,.vocab-toolbar input{padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px}
.vocab-table{width:100%;border-collapse:collapse;font-size:14px;background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden}
.vocab-table th,.vocab-table td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--border)}
.vocab-table th{background:var(--gray-l);font-weight:600;font-size:13px;color:var(--text2);white-space:nowrap}
.vocab-table tr:last-child td{border-bottom:none}
.vocab-table .col-word{font-weight:700;color:var(--green-d)}
.vocab-table .col-ipa{color:var(--text3);font-size:13px}
.vocab-table .hide-col{opacity:.15;filter:blur(3px);cursor:pointer}
.vocab-table tr:hover{background:var(--green-l)}
.vocab-table .num-cell{text-align:center}
.mingxie-area{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
.mingxie-item{margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.mingxie-item .prompt{font-size:16px;font-weight:600;margin-bottom:6px}
.mingxie-item input{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:15px}
.mingxie-item input.correct{border-color:var(--green);background:#d4edda}
.mingxie-item input.wrong{border-color:var(--red);background:var(--red-l)}
.mingxie-item .answer{font-size:13px;color:var(--red);margin-top:4px;display:none}
.mingxie-item .answer.show{display:block}

/* ===== 设置 ===== */
.settings-card{margin-bottom:16px}
.settings-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border)}
.settings-row:last-child{border-bottom:none}
.settings-row .label{font-size:14px}
.settings-row .desc{font-size:12px;color:var(--text3);margin-top:2px}

/* ===== 模态框 ===== */
.modal-overlay{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.4);padding:20px}
.modal-overlay.show{display:flex}
.modal-box{background:var(--card);border-radius:16px;padding:24px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.15)}
.modal-box h3{font-size:18px;margin-bottom:16px}
.modal-box .close{position:relative;float:right;font-size:24px;color:var(--text3);cursor:pointer;line-height:1}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
.field-map-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.field-map-row select{padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px}
.preview-table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
.preview-table th,.preview-table td{padding:4px 8px;border:1px solid var(--border);text-align:left}
.preview-table th{background:var(--gray-l)}

/* ===== 报告 ===== */
.report-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px}
.report-card h3{font-size:16px;margin-bottom:12px;color:var(--green-d)}
.report-stats{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px}
.report-stat{text-align:center}
.report-stat .v{font-size:22px;font-weight:800;color:var(--green-d)}
.report-stat .l{font-size:12px;color:var(--text3)}
.report-words{display:flex;flex-direction:column;gap:6px}
.report-word{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--gray-l);border-radius:6px;font-size:14px}
.report-word .en{font-weight:700;color:var(--green-d)}
.report-word .zh{color:var(--text2)}
.report-word .cnt{font-size:12px;color:var(--text3);background:var(--card);padding:1px 6px;border-radius:8px}
.report-word .mark-btns{display:flex;gap:4px}
.mark-btn{padding:3px 8px;font-size:12px;border-radius:4px;border:1px solid var(--border)}
.mark-btn.known{background:var(--green-l);color:var(--green-d)}
.mark-btn.fuzzy{background:var(--orange-l);color:var(--orange)}
.mark-btn.unknown{background:var(--red-l);color:var(--red)}
.mark-btn.active{font-weight:700;box-shadow:0 0 0 2px currentColor inset}

/* ===== 移动端 ===== */
@media(max-width:768px){
  .main{padding:12px 12px 100px}
  .reading-area{padding:16px 14px;font-size:16px;line-height:1.9}
  .dash-grid{grid-template-columns:repeat(2,1fr)}
  .nav-tab{padding:8px 10px;font-size:13px}
  .topbar{padding:0 12px}
  .topbar h2{font-size:16px}
  .user-chip{display:none}
  .modal-box{padding:18px}
  .field-map-row{grid-template-columns:1fr;gap:4px}
  .vocab-table{font-size:13px}
  .vocab-table th,.vocab-table td{padding:6px 8px}
  .reading-area p{text-indent:2em}
  .reading-area .word-ins{font-size:15px}
}
.m-bottom-nav{display:none}
@media(max-width:768px){
  .m-bottom-nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:var(--card);border-top:1px solid var(--border);z-index:100;padding-bottom:env(safe-area-inset-bottom)}
  .m-bottom-nav .nav-tab{flex:1;padding:8px 4px;text-align:center;font-size:11px;border-bottom:none}
  .m-bottom-nav .nav-tab .icon{display:block;font-size:18px;margin-bottom:2px}
  .main{padding-bottom:80px}
}

/* Toast */
.toast{position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:300;background:var(--text);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;transition:.3s;pointer-events:none}
.toast.show{opacity:1}
.toast.ok{background:var(--green)}
.toast.err{background:var(--red)}

/* loading */
.loading{display:inline-block;width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--green);border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.hidden{display:none!important}
</style>
</head>
<body>

<!-- ===== 登录/注册 ===== -->
<div id="authScreen">
  <div class="auth-box">
    <h1>📖 语境背单词</h1>
    <p class="sub">在真实文章语境中反复遇见目标词</p>
    <div class="auth-tabs">
      <button class="auth-tab active" data-tab="login" onclick="switchAuthTab('login')">登录</button>
      <button class="auth-tab" data-tab="register" onclick="switchAuthTab('register')">注册</button>
    </div>
    <div id="loginForm">
      <div class="form-group">
        <label>昵称</label>
        <input type="text" id="loginNick" placeholder="输入昵称" autocomplete="username">
      </div>
      <div class="form-group">
        <label>密码</label>
        <input type="password" id="loginPass" placeholder="输入密码" autocomplete="current-password">
      </div>
      <div class="auth-err" id="loginErr"></div>
      <button class="btn btn-primary" style="width:100%" onclick="doLogin()">登录</button>
    </div>
    <div id="registerForm" style="display:none">
      <div class="form-group">
        <label>昵称（用作账号）</label>
        <input type="text" id="regNick" placeholder="3-20位字符">
      </div>
      <div class="form-group">
        <label>密码</label>
        <input type="password" id="regPass" placeholder="至少6位">
      </div>
      <div class="auth-err" id="regErr"></div>
      <button class="btn btn-primary" style="width:100%" onclick="doRegister()">注册</button>
    </div>
    <div class="auth-hint">数据存储在资料库数据表中（按昵称隔离），离线时自动降级到本地存储。首次使用可直接注册。</div>
  </div>
</div>

<!-- ===== 主应用 ===== -->
<div id="app">
  <div class="topbar">
    <div class="topbar-left">
      <h2>📖 语境背单词</h2>
    </div>
    <div class="topbar-right">
      <span class="sync-badge" id="syncBadge" onclick="syncNow()">同步中…</span>
      <span class="user-chip" id="userChip"></span>
      <button class="btn btn-sm btn-outline" onclick="logout()">退出</button>
    </div>
  </div>
  <div class="nav-tabs" id="navTabs">
    <button class="nav-tab active" data-view="dashboard" onclick="navTo('dashboard')">首页</button>
    <button class="nav-tab" data-view="materials" onclick="navTo('materials')">资料</button>
    <button class="nav-tab" data-view="learn" onclick="navTo('learn')">学习</button>
    <button class="nav-tab" data-view="test" onclick="navTo('test')">测试</button>
    <button class="nav-tab" data-view="review" onclick="navTo('review')">复习</button>
    <button class="nav-tab" data-view="vocab" onclick="navTo('vocab')">词表</button>
    <button class="nav-tab" data-view="wrong" onclick="navTo('wrong')">错词</button>
    <button class="nav-tab" data-view="settings" onclick="navTo('settings')">设置</button>
  </div>

  <div class="main">
    <!-- Dashboard -->
    <section id="view-dashboard">
      <div class="dash-grid" id="dashStats"></div>
      <div class="dash-recent" id="dashRecent"></div>
      <button class="btn-continue" id="btnContinue" onclick="navTo('learn')">继续学习 →</button>
      <div class="card" style="margin-top:16px">
        <h3 style="font-size:15px;margin-bottom:8px">快速操作</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" onclick="navTo('materials')">上传资料</button>
          <button class="btn btn-outline btn-sm" onclick="navTo('materials')">导入单词书</button>
          <button class="btn btn-outline btn-sm" onclick="navTo('review')">今日复习</button>
          <button class="btn btn-outline btn-sm" onclick="navTo('test')">开始测试</button>
          <button class="btn btn-outline btn-sm" onclick="exportAllJSON()">导出备份</button>
        </div>
      </div>
    </section>

    <!-- 资料管理 -->
    <section id="view-materials" class="hidden">
      <div class="section-head">
        <h2>📚 学习资料</h2>
        <button class="btn btn-primary btn-sm" onclick="showUploadModal('material')">+ 上传资料</button>
      </div>
      <div class="upload-zone" id="matUploadZone" onclick="document.getElementById('matFileInput').click()">
        拖拽 TXT 文件到此处，或点击选择
        <input type="file" id="matFileInput" accept=".txt,.pdf,.docx" style="display:none" onchange="handleFileUpload(this.files,'material')">
      </div>
      <div id="materialList"></div>

      <div class="section-head" style="margin-top:24px">
        <h2>📒 单词书</h2>
        <button class="btn btn-primary btn-sm" onclick="showUploadModal('wordbook')">+ 导入单词书</button>
      </div>
      <div class="upload-zone" id="wbUploadZone" onclick="document.getElementById('wbFileInput').click()">
        拖拽 CSV/TXT 单词书文件到此处，或点击选择
        <input type="file" id="wbFileInput" accept=".csv,.txt,.xlsx" style="display:none" onchange="handleFileUpload(this.files,'wordbook')">
      </div>
      <div id="wordbookList"></div>
    </section>

    <!-- 学习页 -->
    <section id="view-learn" class="hidden">
      <div id="learnEmpty" class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 6.253v13m0-13C10.832 5.477 9.25 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.75 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.75 5 16.5 5s2.832.477 4 1.253v13C19.332 18.477 17.75 18 16.5 18s-3.332.477-4.5 1.253"/></svg>
        <p>请先上传资料和单词书，然后生成语境材料</p>
        <button class="btn btn-outline btn-sm" onclick="navTo('materials')" style="margin-top:8px">去上传</button>
      </div>
      <div id="learnContent" class="hidden">
        <div class="learn-toolbar">
          <select id="selMaterial" onchange="onLearnMaterialChange()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px"></select>
          <select id="selChapter" onchange="onLearnChapterChange()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px"></select>
          <div class="mode-tabs">
            <button class="mode-tab active" data-mode="meaning" onclick="setLearnMode('meaning')">释义版</button>
            <button class="mode-tab" data-mode="blank" onclick="setLearnMode('blank')">挖空版</button>
            <button class="mode-tab" data-mode="original" onclick="setLearnMode('original')">原文版</button>
          </div>
          <div class="spacer"></div>
          <label class="toggle"><input type="checkbox" id="toggleWord" checked onchange="refreshLearn()"> 英文</label>
          <label class="toggle"><input type="checkbox" id="toggleIpa" onchange="refreshLearn()"> 音标</label>
          <label class="toggle"><input type="checkbox" id="toggleMeaning" checked onchange="refreshLearn()"> 释义</label>
        </div>
        <div class="chapter-nav">
          <button class="btn btn-sm btn-outline" onclick="prevChapter()">← 上一章</button>
          <div>
            <div class="ch-title" id="chTitle"></div>
            <div class="ch-progress" id="chProgress"></div>
          </div>
          <button class="btn btn-sm btn-outline" onclick="nextChapter()">下一章 →</button>
        </div>
        <div class="reading-area" id="readingArea" onscroll="saveScrollPos()"></div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-outline btn-sm" onclick="navTo('learn')">章节目录</button>
          <button class="btn btn-danger btn-sm" onclick="endSession()">结束本次学习</button>
        </div>
      </div>
    </section>

    <!-- 测试页 -->
    <section id="view-test" class="hidden">
      <div id="testEmpty" class="empty-state">
        <p>暂无可测试的单词</p>
        <p style="font-size:13px;margin-top:8px">请先学习材料并结束学习会话，系统会自动生成测试队列</p>
      </div>
      <div id="testContent" class="hidden">
        <div class="test-progress">
          <div class="bar"><div class="bar-fill" id="testBarFill" style="width:0%"></div></div>
          <span class="count" id="testCount">0 / 0</span>
        </div>
        <div class="test-card" id="testCard"></div>
      </div>
    </section>

    <!-- 复习页 -->
    <section id="view-review" class="hidden">
      <div class="section-head">
        <h2>🔄 复习队列（艾宾浩斯）</h2>
        <button class="btn btn-primary btn-sm" onclick="startReview()" id="btnStartReview">开始今日复习</button>
      </div>
      <div id="reviewStats"></div>
      <div id="reviewContent"></div>
    </section>

    <!-- 词表 -->
    <section id="view-vocab" class="hidden">
      <div class="section-head">
        <h2>📋 词表</h2>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="toggleMingxie()">默写模式</button>
          <button class="btn btn-outline btn-sm" onclick="exportVocabCSV()">导出CSV</button>
        </div>
      </div>
      <div class="vocab-toolbar">
        <select id="vocabFilterMat" onchange="renderVocab()"><option value="">全部资料</option></select>
        <select id="vocabFilterCh" onchange="renderVocab()"><option value="">全部章节</option></select>
        <select id="vocabFilterStatus" onchange="renderVocab()">
          <option value="">全部状态</option>
          <option value="known">已掌握</option>
          <option value="fuzzy">模糊</option>
          <option value="unknown">不认识</option>
        </select>
        <label class="toggle"><input type="checkbox" id="toggleHideWord" onchange="renderVocab()"> 隐藏单词</label>
        <label class="toggle"><input type="checkbox" id="toggleHideIpa" onchange="renderVocab()"> 隐藏音标</label>
        <label class="toggle"><input type="checkbox" id="toggleHideMeaning" onchange="renderVocab()"> 隐藏释义</label>
      </div>
      <div id="vocabTableWrap"></div>
      <div id="mingxieWrap" class="hidden"></div>
    </section>

    <!-- 错词 -->
    <section id="view-wrong" class="hidden">
      <div class="section-head">
        <h2>❌ 错词整理</h2>
        <button class="btn btn-outline btn-sm" onclick="exportWrongCSV()">导出CSV</button>
      </div>
      <div class="vocab-toolbar">
        <select id="wrongFilterMat" onchange="renderWrong()"><option value="">全部资料</option></select>
        <select id="wrongFilterStatus" onchange="renderWrong()">
          <option value="">全部</option>
          <option value="unknown">不认识</option>
          <option value="fuzzy">模糊</option>
        </select>
      </div>
      <div id="wrongTableWrap"></div>
    </section>

    <!-- 设置 -->
    <section id="view-settings" class="hidden">
      <div class="card settings-card">
        <h3 style="font-size:16px;margin-bottom:12px">数据同步</h3>
        <div class="settings-row">
          <div>
            <div class="label">云端同步状态</div>
            <div class="desc" id="syncStatusDesc">检测中…</div>
          </div>
          <button class="btn btn-sm btn-outline" onclick="syncNow()">立即同步</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="label">自动同步</div>
            <div class="desc">每次修改后自动同步到云端</div>
          </div>
          <label class="toggle"><input type="checkbox" id="autoSync" checked onchange="toggleAutoSync()"> 开启</label>
        </div>
      </div>
      <div class="card settings-card">
        <h3 style="font-size:16px;margin-bottom:12px">数据备份</h3>
        <div class="settings-row">
          <div><div class="label">导出全部数据</div><div class="desc">JSON 格式，包含全部学习记录</div></div>
          <button class="btn btn-sm btn-outline" onclick="exportAllJSON()">导出</button>
        </div>
        <div class="settings-row">
          <div><div class="label">导入恢复</div><div class="desc">从 JSON 备份恢复数据</div></div>
          <button class="btn btn-sm btn-outline" onclick="document.getElementById('importFile').click()">选择文件</button>
          <input type="file" id="importFile" accept=".json" style="display:none" onchange="importAllJSON(this.files)">
        </div>
        <div class="settings-row">
          <div><div class="label" style="color:var(--red)">清空全部数据</div><div class="desc">不可恢复，请谨慎</div></div>
          <button class="btn btn-sm btn-danger" onclick="clearAllData()">清空</button>
        </div>
      </div>
      <div class="card settings-card">
        <h3 style="font-size:16px;margin-bottom:12px">关于</h3>
        <p style="font-size:13px;color:var(--text2);line-height:1.8">
          语境背单词工作台 v1.0<br>
          数据存储：资料库数据表（云端同步）+ localStorage（离线缓存）<br>
          复习算法：艾宾浩斯遗忘曲线（1/2/4/7/15/30天间隔）<br>
          发音：浏览器内置 Web Speech API
        </p>
      </div>
    </section>
  </div>
</div>

<!-- 移动端底部导航 -->
<div class="m-bottom-nav" id="mBottomNav">
  <button class="nav-tab" data-view="dashboard" onclick="navTo('dashboard')"><span class="icon">🏠</span>首页</button>
  <button class="nav-tab" data-view="learn" onclick="navTo('learn')"><span class="icon">📖</span>学习</button>
  <button class="nav-tab" data-view="test" onclick="navTo('test')"><span class="icon">✏️</span>测试</button>
  <button class="nav-tab" data-view="review" onclick="navTo('review')"><span class="icon">🔄</span>复习</button>
  <button class="nav-tab" data-view="vocab" onclick="navTo('vocab')"><span class="icon">📋</span>词表</button>
</div>

<!-- 词卡弹窗 -->
<div class="word-card-modal" id="wordCardModal" onclick="if(event.target===this)closeWordCard()">
  <div class="word-card" id="wordCardContent"></div>
</div>

<!-- 上传模态框 -->
<div class="modal-overlay" id="uploadModal" onclick="if(event.target===this)closeModal('uploadModal')">
  <div class="modal-box">
    <span class="close" onclick="closeModal('uploadModal')">×</span>
    <h3 id="uploadModalTitle"></h3>
    <div id="uploadModalBody"></div>
  </div>
</div>

<!-- 字段映射模态框 -->
<div class="modal-overlay" id="fieldMapModal" onclick="if(event.target===this)closeModal('fieldMapModal')">
  <div class="modal-box">
    <span class="close" onclick="closeModal('fieldMapModal')">×</span>
    <h3>字段映射与预览</h3>
    <p style="font-size:13px;color:var(--text3);margin-bottom:8px">请将文件列映射到单词书字段：</p>
    <div id="fieldMapBody"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal('fieldMapModal')">取消</button>
      <button class="btn btn-primary" onclick="confirmFieldMap()">确认导入</button>
    </div>
  </div>
</div>

<!-- 确认弹窗 -->
<div class="modal-overlay" id="confirmModal" onclick="if(event.target===this)closeModal('confirmModal')">
  <div class="modal-box" style="max-width:400px">
    <h3 id="confirmTitle">确认</h3>
    <p id="confirmMsg" style="font-size:14px;color:var(--text2);line-height:1.6;margin-bottom:8px"></p>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal('confirmModal')">取消</button>
      <button class="btn btn-danger" id="confirmOkBtn">确认</button>
    </div>
  </div>
</div>

<!-- 报告弹窗 -->
<div class="modal-overlay" id="reportModal" onclick="if(event.target===this)closeModal('reportModal')">
  <div class="modal-box" style="max-width:600px">
    <span class="close" onclick="closeModal('reportModal')">×</span>
    <h3>本次学习报告</h3>
    <div id="reportBody"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal('reportModal')">关闭</button>
      <button class="btn btn-primary" onclick="closeModal('reportModal');navTo('test')">开始测试 →</button>
    </div>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
// ============================================================
//  语境背单词工作台 - 完整 JS 逻辑
// ============================================================

// ===== 数据库 ID（来自资料库创建结果）=====
var DB_IDS = __DB_IDS__;

// ===== 全局状态 =====
var STATE = {
  profileId: null,      // 当前用户 profile_id (SHA-256 hash)
  nickname: '',
  view: 'dashboard',
  materials: [],        // 资料列表
  wordbooks: [],       // 单词书列表
  words: [],           // 全部单词（跨书）
  chapters: {},        // materialId -> chapters[]
  matches: {},         // materialId -> chapterId -> matches[]
  progress: {},        // materialId -> {chapterId, mode, scrollPct, paraIdx}
  sessions: [],        // 学习会话
  currentSession: null,
  mastery: {},          // lemma -> {status, attempts, correct, wrong, level, nextReview, errorStreakToday}
  reviewQueue: [],     // 今日复习队列
  vocab: [],            // 生词本
  synonyms: {},         // lemma -> [{answer, accepted}]
  answers: [],          // 答题记录
  // 学习页临时状态
  learnMaterialId: null,
  learnChapterId: null,
  learnMode: 'meaning',
  // 测试页临时状态
  testQueue: [],
  testIdx: 0,
  testRound: 1,
  // 同步状态
  cloudReady: false,
  autoSync: true,
  syncTimer: null
};

var LS_PREFIX = 'ctx_vocab_';

// ===== 工具函数 =====
function sha256(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function(buf) {
    return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  });
}
function nowISO() { return new Date().toISOString(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtDate(iso) { if (!iso) return '--'; var d = new Date(iso); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtMin(iso) { if (!iso) return '--'; var d = new Date(iso); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function uid(prefix) { return (prefix||'id')+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function toast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type||'');
  setTimeout(function() { t.className = 'toast'; }, 2500);
}
function escapeHTML(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== localStorage 数据层 =====
var LS = {
  get: function(key, def) {
    try { var v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : (def !== undefined ? def : null); }
    catch(e) { return def !== undefined ? def : null; }
  },
  set: function(key, val) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch(e) { console.error('LS set err', e); }
  },
  del: function(key) { localStorage.removeItem(LS_PREFIX + key); }
};

// ===== 资料库数据表 SDK 层 =====
var CLOUD = {
  db: null,
  init: function() {
    if (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) {
      this.db = window.__SMART_PAGE__.database;
      STATE.cloudReady = true;
      return true;
    }
    STATE.cloudReady = false;
    return false;
  },
  query: function(dbId, filter) {
    var self = this;
    if (!self.db) return Promise.resolve([]);
    function loadAll(cursor, acc, guard) {
      acc = acc || []; guard = guard || 0;
      if (guard > 100) return Promise.resolve(acc);
      return self.db.query({ databaseId: dbId, filter: filter, pageSize: 200, startCursor: cursor })
        .then(function(r) {
          acc = acc.concat(r.results || []);
          if (r.hasMore && r.nextCursor && r.nextCursor !== cursor && (r.results||[]).length) {
            return loadAll(r.nextCursor, acc, guard + 1);
          }
          return acc;
        });
    }
    return loadAll().catch(function(e) { console.warn('cloud query err', e); return []; });
  },
  add: function(dbId, props) {
    if (!this.db) return Promise.resolve(null);
    return this.db.addRecord({ databaseId: dbId, properties: props }).catch(function(e) { console.warn('cloud add err', e); return null; });
  },
  update: function(dbId, recordId, props) {
    if (!this.db) return Promise.resolve(null);
    return this.db.updateRecord({ databaseId: dbId, recordId: recordId, properties: props }).catch(function(e) { console.warn('cloud update err', e); return null; });
  },
  del: function(dbId, recordId) {
    if (!this.db) return Promise.resolve(null);
    return this.db.deleteRecord({ databaseId: dbId, recordId: recordId }).catch(function(e) { console.warn('cloud del err', e); return null; });
  }
};

// ===== 同步状态 UI =====
function updateSyncBadge() {
  var b = document.getElementById('syncBadge');
  var d = document.getElementById('syncStatusDesc');
  if (STATE.cloudReady) {
    b.textContent = '☁ 已同步';
    b.className = 'sync-badge sync-on';
    if (d) d.textContent = '云端同步已开启，数据自动同步到资料库';
  } else {
    b.textContent = '📱 离线模式';
    b.className = 'sync-badge sync-off';
    if (d) d.textContent = '离线模式，数据保存在本地浏览器';
  }
}

// ===== 数据加载（从云端或本地）=====
function loadDataForProfile(profileId) {
  // 优先从云端拉取，降级到 localStorage
  var promises = [];
  if (STATE.cloudReady) {
    promises.push(CLOUD.query(DB_IDS.context_users, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      // 用户表只有一条，不存主要业务数据
    }));
    // 拉 materials
    promises.push(CLOUD.query(DB_IDS.context_materials, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.materials = rows.map(function(r) {
        return {
          id: r['资料ID'] || r._id,
          title: r['标题'] || '',
          sourceType: r['来源类型'] || 's_txt',
          rawContent: r['原始文本'] || '',
          chapters: r['章节JSON'] ? JSON.parse(r['章节JSON']) : [],
          chapterCount: r['章节数'] || 0,
          createdAt: r['创建时间'],
          updatedAt: r['更新时间'],
          _cloudId: r._id
        };
      });
    }));
    // 拉 wordbooks
    promises.push(CLOUD.query(DB_IDS.context_wordbooks, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.wordbooks = rows.map(function(r) {
        return { id: r['单词书ID']||r._id, name: r['书名']||'', source: r['源文件']||'', total: r['词条数']||0, importedAt: r['导入时间'], _cloudId: r._id };
      });
    }));
    // 拉 words
    promises.push(CLOUD.query(DB_IDS.context_words, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.words = rows.map(function(r) {
        return { lemma: r['词元']||'', wordbookId: r['单词书ID']||'', pos: r['词性']||'', ipa: r['音标']||'', meaning: r['中文释义']||'', example: r['例句']||'', unit: r['单元标签']||'', _cloudId: r._id };
      });
    }));
    // 拉 matches
    promises.push(CLOUD.query(DB_IDS.context_matches, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.matches = {};
      rows.forEach(function(r) {
        var mid = r['资料ID']; var cid = r['章节ID'];
        if (!STATE.matches[mid]) STATE.matches[mid] = {};
        if (!STATE.matches[mid][cid]) STATE.matches[mid][cid] = [];
        STATE.matches[mid][cid].push({ lemma: r['词元']||'', chWord: r['对应中文']||'', sense: r['使用义项']||'', position: r['位置']||0, sentence: r['所在句子']||'', manual: r['手动修改']||false, _cloudId: r._id });
      });
    }));
    // 拉 chapters
    promises.push(CLOUD.query(DB_IDS.context_chapters, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.chapters = {};
      rows.forEach(function(r) {
        var mid = r['资料ID'];
        if (!STATE.chapters[mid]) STATE.chapters[mid] = [];
        STATE.chapters[mid].push({ id: r['章节ID']||'', title: r['章节标题']||'', order: r['顺序']||0, content: r['章节内容']||'', targetWords: r['目标词数']||10, generated: r['已生成语境材料']||false, _cloudId: r._id });
      });
    }));
    // 拉 mastery
    promises.push(CLOUD.query(DB_IDS.context_mastery, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.mastery = {};
      rows.forEach(function(r) {
        STATE.mastery[r['词元']] = { status: r['状态']||'unknown', attempts: r['尝试次数']||0, correct: r['正确次数']||0, wrong: r['错误次数']||0, rate: r['正确率']||0, lastAnswer: r['最近答案']||'', lastReview: r['最近复习'], level: r['复习等级']||0, nextReview: r['下次复习'], errorStreakToday: r['今日连错']||0, materialId: r['资料ID']||'', _cloudId: r._id };
      });
    }));
    // 拉 vocab
    promises.push(CLOUD.query(DB_IDS.context_vocab, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.vocab = rows.map(function(r) {
        return { lemma: r['词元']||'', ipa: r['音标']||'', pos: r['词性']||'', meaning: r['中文释义']||'', context: r['语境']||'', materialId: r['资料ID']||'', addedAt: r['加入时间'], manual: r['手动添加']||false, _cloudId: r._id };
      });
    }));
    // 拉 answers
    promises.push(CLOUD.query(DB_IDS.context_answers, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.answers = rows.map(function(r) {
        return { sessionId: r['会话ID']||'', lemma: r['词元']||'', round: r['轮次']||'', qType: r['题型']||'', correct: r['是否正确']||false, userInput: r['用户输入']||'', stdAnswer: r['标准答案']||'', ts: r['时间戳'], _cloudId: r._id };
      });
    }));
    // 拉 progress
    promises.push(CLOUD.query(DB_IDS.context_progress, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.progress = {};
      rows.forEach(function(r) {
        var mid = r['资料ID'];
        if (!STATE.progress[mid]) STATE.progress[mid] = {};
        STATE.progress[mid][r['章节ID']] = { mode: r['模式']||'meaning', scrollPct: r['滚动百分比']||0, paraIdx: r['段落序号']||0, updatedAt: r['更新时间'], _cloudId: r._id };
      });
    }));
    // 拉 synonyms
    promises.push(CLOUD.query(DB_IDS.context_synonyms, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.synonyms = {};
      rows.forEach(function(r) {
        var lemma = r['词元'];
        if (!STATE.synonyms[lemma]) STATE.synonyms[lemma] = [];
        STATE.synonyms[lemma].push({ answer: r['同义答案']||'', accepted: r['接受']||false, count: r['使用次数']||0, _cloudId: r._id });
      });
    }));
    // 拉 sessions
    promises.push(CLOUD.query(DB_IDS.context_sessions, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.sessions = rows.map(function(r) {
        return { id: r['会话ID']||r._id, materialId: r['资料ID']||'', startedAt: r['开始时间'], endedAt: r['结束时间'], durationMin: r['学习分钟']||0, chapters: r['阅读章节']||'', wordsCount: r['遇到词数']||0, _cloudId: r._id };
      });
    }));
    // 拉 review queue
    promises.push(CLOUD.query(DB_IDS.context_review, { property: { property: 'profile_id', text: { equals: profileId } } }).then(function(rows) {
      STATE.reviewQueue = rows.map(function(r) {
        return { lemma: r['词元']||'', level: r['等级']||1, nextReviewDate: r['下次复习日期'], lastResult: r['上次结果']||'', materialId: r['资料ID']||'', addedAt: r['加入时间'], _cloudId: r._id };
      });
    }));
  } else {
    // 离线模式从 localStorage 加载
    STATE.materials = LS.get('materials_' + profileId, []);
    STATE.wordbooks = LS.get('wordbooks_' + profileId, []);
    STATE.words = LS.get('words_' + profileId, []);
    STATE.chapters = LS.get('chapters_' + profileId, {});
    STATE.matches = LS.get('matches_' + profileId, {});
    STATE.progress = LS.get('progress_' + profileId, {});
    STATE.sessions = LS.get('sessions_' + profileId, []);
    STATE.mastery = LS.get('mastery_' + profileId, {});
    STATE.vocab = LS.get('vocab_' + profileId, []);
    STATE.synonyms = LS.get('synonyms_' + profileId, {});
    STATE.answers = LS.get('answers_' + profileId, []);
    STATE.reviewQueue = LS.get('review_' + profileId, []);
  }
  return Promise.all(promises);
}

// ===== 本地保存 =====
function saveLocal() {
  if (!STATE.profileId) return;
  var pid = STATE.profileId;
  LS.set('materials_' + pid, STATE.materials);
  LS.set('wordbooks_' + pid, STATE.wordbooks);
  LS.set('words_' + pid, STATE.words);
  LS.set('chapters_' + pid, STATE.chapters);
  LS.set('matches_' + pid, STATE.matches);
  LS.set('progress_' + pid, STATE.progress);
  LS.set('sessions_' + pid, STATE.sessions);
  LS.set('mastery_' + pid, STATE.mastery);
  LS.set('vocab_' + pid, STATE.vocab);
  LS.set('synonyms_' + pid, STATE.synonyms);
  LS.set('answers_' + pid, STATE.answers);
  LS.set('review_' + pid, STATE.reviewQueue);
}

// ===== 预置词典（语境匹配用）=====
var CONTEXT_DICT = {
  'ceiling': { triggers: ['天花板','吊顶','顶棚'], meaning: '天花板', pos: 'n.', ipa: '/ˈsiːlɪŋ/' },
  'beautiful': { triggers: ['华美的','美丽的','漂亮','好看','华丽'], meaning: '美丽的；华美的', pos: 'adj.', ipa: '/ˈbjuːtɪfl/' },
  'condition': { triggers: ['条件'], meaning: '条件；状况', pos: 'n.', ipa: '/kənˈdɪʃn/' },
  'reflect': { triggers: ['反射'], meaning: '反射；反映', pos: 'v.', ipa: '/rɪˈflekt/' },
  'remove': { triggers: ['移开','移除','调动','移去'], meaning: '移开；调动', pos: 'v.', ipa: '/rɪˈmuːv/' },
  'body': { triggers: ['身体','躯体'], meaning: '身体', pos: 'n.', ipa: '/ˈbɒdi/' },
  'formation': { triggers: ['形成'], meaning: '形成', pos: 'n.', ipa: '/fɔːˈmeɪʃn/' },
  'instinct': { triggers: ['本能','直觉'], meaning: '本能', pos: 'n.', ipa: '/ˈɪnstɪŋkt/' },
  'room': { triggers: ['房间','地方','空间','屋子'], meaning: '房间；地方', pos: 'n.', ipa: '/ruːm/' },
  'internal': { triggers: ['体内的','内部的','内在'], meaning: '体内的；内部的', pos: 'adj.', ipa: '/ɪnˈtɜːnl/' },
  'react': { triggers: ['反应'], meaning: '反应', pos: 'v.', ipa: '/riˈækt/' },
  'inform': { triggers: ['告诉','通知','告知'], meaning: '告诉；通知', pos: 'v.', ipa: '/ɪnˈfɔːm/' },
  'speak': { triggers: ['说话','讲话','说'], meaning: '说话', pos: 'v.', ipa: '/spiːk/' },
  'nor': { triggers: ['也不','也不'], meaning: '也不', pos: 'conj.', ipa: '/nɔːr/' },
  'forget': { triggers: ['忘记','遗忘','忘了'], meaning: '忘记', pos: 'v.', ipa: '/fəˈɡet/' },
  'around': { triggers: ['四处','周围','到处','环顾'], meaning: '四处；周围', pos: 'prep.', ipa: '/əˈraʊnd/' },
  'onto': { triggers: ['上面','之上','到...上'], meaning: '在……之上', pos: 'prep.', ipa: '/ˈɒntə/' },
  'elapse': { triggers: ['流逝','过去','消逝'], meaning: '（时间）流逝', pos: 'v.', ipa: '/iˈlæps/' }
};

// ===== 词元归一化 =====
var LEMMA_RULES = [
  [/ies$/i, 'y'],
  [/ied$/i, 'y'],
  [/ing$/i, ''],
  [/ed$/i, ''],
  [/s$/i, '']
];
function toLemma(word) {
  var w = word.toLowerCase().trim();
  for (var i = 0; i < LEMMA_RULES.length; i++) {
    var re = new RegExp(LEMMA_RULES[i][0]);
    if (re.test(w)) {
      var stem = w.replace(re, LEMMA_RULES[i][1]);
      if (stem.length >= 3) return stem;
    }
  }
  return w;
}

// ===== 文件解析 =====
function parseTXT(text) {
  // 按空行分段，提取标题和章节
  var lines = text.split(/\r?\n/);
  var chapters = [];
  var curChapter = null;
  var curParas = [];
  var title = '默认章节';
  var chIdx = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    // 检测章节标题：以「第X章」「第X单元」「Chapter X」开头的行
    var chMatch = line.match(/^(第[一二三四五六七八九十百千0-9]+[章节回卷篇单元]|Chapter\s+\d+|Unit\s+\d+|#\s+)/i);
    if (chMatch && line.length < 50) {
      if (curChapter) {
        chapters.push({ id: uid('ch'), title: curChapter, order: chIdx, content: curParas.join('\n\n'), targetWords: 10, generated: false });
        chIdx++;
      }
      curChapter = line;
      curParas = [];
    } else if (line === '') {
      // 段落分隔
      if (curParas.length > 0 && curParas[curParas.length-1] !== '') curParas.push('');
    } else {
      if (!curChapter) curChapter = '第1章';
      curParas.push(line);
    }
  }
  if (curChapter) {
    chapters.push({ id: uid('ch'), title: curChapter, order: chIdx, content: curParas.join('\n\n').trim(), targetWords: 10, generated: false });
  }
  if (chapters.length === 0) {
    chapters.push({ id: uid('ch'), title: '全文', order: 0, content: text, targetWords: 10, generated: false });
  }
  return { title: chapters[0].title, chapters: chapters };
}

function parseCSV(text) {
  var lines = text.split(/\r?\n/).filter(function(l) { return l.trim(); });
  if (lines.length < 2) return { headers: [], rows: [] };
  // 简易 CSV 解析（支持逗号分隔，不处理引号内逗号）
  function parseLine(line) {
    var result = [];
    var cur = '';
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { inQuote = !inQuote; }
      else if (c === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    result.push(cur.trim());
    return result;
  }
  var headers = parseLine(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var vals = parseLine(lines[i]);
    if (vals.length === 1 && !vals[0]) continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) { obj[headers[j]] = vals[j] || ''; }
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

// ===== 语境匹配算法 =====
function generateContextMatches(chapter, words, repeatMode) {
  // repeatMode: 'all' | 'para_once' | 'chapter_once'
  var content = chapter.content;
  var paragraphs = content.split(/\n\n+/);
  var matches = [];
  var usedInChapter = {}; // lemma -> 已用（chapter_once 模式）

  for (var pi = 0; pi < paragraphs.length; pi++) {
    var para = paragraphs[pi];
    var usedInPara = {}; // lemma -> 已用（para_once 模式）
    var pos = 0;

    for (var wi = 0; wi < words.length; wi++) {
      var w = words[wi];
      var lemma = w.lemma.toLowerCase();
      var dictEntry = CONTEXT_DICT[lemma];

      // 优先用预置词典的 trigger，否则用单词书的中文释义
      var triggers = [];
      if (dictEntry && dictEntry.triggers) {
        triggers = dictEntry.triggers;
      } else if (w.meaning) {
        // 从释义中提取中文关键词（按；或，分割取第一段）
        triggers = w.meaning.split(/[；;,，]/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length >= 2; });
      }

      if (triggers.length === 0) continue;
      if (repeatMode === 'chapter_once' && usedInChapter[lemma]) continue;

      // 在段落中找 trigger 的位置
      for (var ti = 0; ti < triggers.length; ti++) {
        var trigger = triggers[ti];
        if (!trigger || trigger.length < 2) continue;
        var searchStart = (repeatMode === 'para_once' && usedInPara[lemma]) ? -1 : 0;
        if (searchStart === -1) continue;

        var idx = para.indexOf(trigger, pos);
        while (idx !== -1) {
          if (repeatMode === 'para_once' && usedInPara[lemma]) break;
          // 提取所在句子（前后找句号/问号/感叹号）
          var sentStart = idx;
          for (var k = idx; k >= 0; k--) {
            if (/[。！？!?\n]/.test(para[k])) { sentStart = k + 1; break; }
          }
          var sentEnd = idx + trigger.length;
          for (var k2 = idx + trigger.length; k2 < para.length; k2++) {
            if (/[。！？!?\n]/.test(para[k2])) { sentEnd = k2 + 1; break; }
          }
          var sentence = para.substring(sentStart, Math.min(sentEnd + 20, para.length));

          matches.push({
            lemma: lemma,
            chWord: trigger,
            sense: dictEntry ? dictEntry.meaning : (w.meaning || ''),
            position: idx + pi * 10000,
            sentence: sentence.trim(),
            manual: false
          });

          usedInPara[lemma] = true;
          usedInChapter[lemma] = true;
          pos = idx + trigger.length;

          if (repeatMode === 'para_once') break;
          if (repeatMode === 'chapter_once') break;
          idx = para.indexOf(trigger, pos);
        }
      }
    }
  }

  return matches;
}

// ===== 艾宾浩斯复习算法 =====
var REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30]; // 天
function advanceReview(lemma, correct) {
  var m = STATE.mastery[lemma] || { status: 'unknown', attempts: 0, correct: 0, wrong: 0, level: 0, nextReview: null, errorStreakToday: 0 };
  m.attempts++;
  if (correct) {
    m.correct++;
    m.level = Math.min(m.level + 1, REVIEW_INTERVALS.length);
    m.status = m.level >= REVIEW_INTERVALS.length ? 'known' : 'fuzzy';
    m.errorStreakToday = 0;
  } else {
    m.wrong++;
    m.level = Math.max(m.level - 1, 1);
    m.status = 'unknown';
    m.errorStreakToday = (m.errorStreakToday || 0) + 1;
    // 加入生词本
    addToVocab(lemma);
  }
  m.rate = m.attempts > 0 ? Math.round(m.correct / m.attempts * 100) / 100 : 0;
  m.lastReview = nowISO();
  // 下次复习日期
  var intervalIdx = Math.min(m.level - 1, REVIEW_INTERVALS.length - 1);
  if (intervalIdx < 0) intervalIdx = 0;
  var nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + REVIEW_INTERVALS[intervalIdx]);
  m.nextReview = nextDate.toISOString();

  STATE.mastery[lemma] = m;
  return m;
}

function getTodayReviewWords() {
  var today = todayStr();
  return STATE.reviewQueue.filter(function(r) {
    return r.nextReviewDate && r.nextReviewDate.slice(0, 10) <= today;
  });
}

// ===== 生词本 =====
function addToVocab(lemma) {
  for (var i = 0; i < STATE.vocab.length; i++) {
    if (STATE.vocab[i].lemma === lemma) return;
  }
  var w = findWord(lemma);
  STATE.vocab.push({
    lemma: lemma,
    ipa: w ? w.ipa : '',
    pos: w ? w.pos : '',
    meaning: w ? w.meaning : '',
    context: '',
    materialId: STATE.learnMaterialId || '',
    addedAt: nowISO(),
    manual: false
  });
}
function findWord(lemma) {
  for (var i = 0; i < STATE.words.length; i++) {
    if (STATE.words[i].lemma.toLowerCase() === lemma.toLowerCase()) return STATE.words[i];
  }
  return null;
}

// ===== 发音 =====
function speak(text) {
  if (!window.speechSynthesis) { toast('浏览器不支持语音合成', 'err'); return; }
  var u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.8;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ===== 账号系统 =====
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tab); });
  document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
}

function doRegister() {
  var nick = document.getElementById('regNick').value.trim();
  var pass = document.getElementById('regPass').value;
  var err = document.getElementById('regErr');
  err.textContent = '';
  if (nick.length < 3 || nick.length > 20) { err.textContent = '昵称需 3-20 位字符'; return; }
  if (pass.length < 6) { err.textContent = '密码至少 6 位'; return; }
  var existing = LS.get('users', []);
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].nick === nick) { err.textContent = '该昵称已被注册'; return; }
  }
  sha256(pass).then(function(hash) {
    var profileId = 'p_' + nick + '_' + Date.now().toString(36);
    existing.push({ nick: nick, passHash: hash, profileId: profileId, createdAt: nowISO() });
    LS.set('users', existing);
    toast('注册成功，请登录', 'ok');
    switchAuthTab('login');
    document.getElementById('loginNick').value = nick;
  });
}

function doLogin() {
  var nick = document.getElementById('loginNick').value.trim();
  var pass = document.getElementById('loginPass').value;
  var err = document.getElementById('loginErr');
  err.textContent = '';
  if (!nick || !pass) { err.textContent = '请输入昵称和密码'; return; }
  var existing = LS.get('users', []);
  var user = null;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].nick === nick) { user = existing[i]; break; }
  }
  if (!user) { err.textContent = '该昵称未注册'; return; }
  sha256(pass).then(function(hash) {
    if (hash !== user.passHash) { err.textContent = '密码错误'; return; }
    STATE.profileId = user.profileId;
    STATE.nickname = nick;
    LS.set('current_user', { nick: nick, profileId: user.profileId });
    enterApp();
  });
}

function logout() {
  showConfirm('退出登录', '确认退出当前账号？数据已自动同步到云端。', function() {
    LS.del('current_user');
    STATE.profileId = null;
    STATE.nickname = '';
    document.getElementById('app').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
  });
}

function enterApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('userChip').textContent = '👤 ' + STATE.nickname;
  CLOUD.init();
  updateSyncBadge();
  loadDataForProfile(STATE.profileId).then(function() {
    // 如果是新用户且无数据，注入示例数据
    if (STATE.materials.length === 0 && STATE.wordbooks.length === 0) {
      injectSampleData();
    }
    refreshAll();
  });
}

// ===== 示例数据注入 =====
function injectSampleData() {
  var matId = uid('mat');
  var sampleContent = __SAMPLE_TEXT__;
  var parsed = parseTXT(sampleContent);
  var material = {
    id: matId,
    title: '虞寻歌·重生（示例）',
    sourceType: 's_manual',
    rawContent: sampleContent,
    chapters: parsed.chapters,
    chapterCount: parsed.chapters.length,
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  // 自动生成语境材料
  var sampleWords = __SAMPLE_WORDS__;
  var wbId = uid('wb');
  var wordbook = { id: wbId, name: '示例单词书·18词', source: 'sample.csv', total: sampleWords.length, importedAt: nowISO() };
  sampleWords.forEach(function(w) { w.wordbookId = wbId; });

  parsed.chapters.forEach(function(ch) {
    ch.generated = true;
    ch.targetWords = 18;
    var matches = generateContextMatches(ch, sampleWords, 'all');
    if (!STATE.matches[matId]) STATE.matches[matId] = {};
    STATE.matches[matId][ch.id] = matches;
  });

  STATE.materials.push(material);
  STATE.chapters[matId] = parsed.chapters;
  STATE.wordbooks.push(wordbook);
  STATE.words = STATE.words.concat(sampleWords);

  saveLocal();
  // 同步到云端
  syncMaterialToCloud(material);
  syncWordbookToCloud(wordbook);
  sampleWords.forEach(function(w) { syncWordToCloud(w); });
  parsed.chapters.forEach(function(ch) { syncChapterToCloud(matId, ch); });
  Object.keys(STATE.matches[matId]).forEach(function(cid) {
    STATE.matches[matId][cid].forEach(function(m) { syncMatchToCloud(matId, cid, m); });
  });
  toast('已注入示例数据，可直接开始学习', 'ok');
}

// ===== 云同步（单条）=====
function syncMaterialToCloud(m) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '资料ID': { text: m.id },
    '标题': { text: m.title },
    '来源类型': { select: m.sourceType || 's_txt' },
    '原始文本': { text: m.rawContent || '' },
    '章节JSON': { text: JSON.stringify(m.chapters || []) },
    '章节数': { number: m.chapterCount || 0 },
    '创建时间': { date: m.createdAt || nowISO() },
    '更新时间': { date: m.updatedAt || nowISO() }
  };
  if (m._cloudId) {
    CLOUD.update(DB_IDS.context_materials, m._cloudId, props);
  } else {
    CLOUD.add(DB_IDS.context_materials, props).then(function(r) { if (r && r.id) m._cloudId = r.id; });
  }
}
function syncWordbookToCloud(wb) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '单词书ID': { text: wb.id },
    '书名': { text: wb.name },
    '源文件': { text: wb.source || '' },
    '词条数': { number: wb.total || 0 },
    '导入时间': { date: wb.importedAt || nowISO() }
  };
  if (wb._cloudId) CLOUD.update(DB_IDS.context_wordbooks, wb._cloudId, props);
  else CLOUD.add(DB_IDS.context_wordbooks, props).then(function(r) { if (r && r.id) wb._cloudId = r.id; });
}
function syncWordToCloud(w) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '单词书ID': { text: w.wordbookId || '' },
    '词元': { text: w.lemma },
    '词性': { text: w.pos || '' },
    '音标': { text: w.ipa || '' },
    '中文释义': { text: w.meaning || '' },
    '例句': { text: w.example || '' },
    '单元标签': { text: w.unit || '' }
  };
  if (w._cloudId) CLOUD.update(DB_IDS.context_words, w._cloudId, props);
  else CLOUD.add(DB_IDS.context_words, props).then(function(r) { if (r && r.id) w._cloudId = r.id; });
}
function syncChapterToCloud(matId, ch) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '资料ID': { text: matId },
    '章节ID': { text: ch.id },
    '章节标题': { text: ch.title },
    '顺序': { number: ch.order || 0 },
    '章节内容': { text: ch.content || '' },
    '目标词数': { number: ch.targetWords || 10 },
    '已生成语境材料': { checkbox: ch.generated || false }
  };
  if (ch._cloudId) CLOUD.update(DB_IDS.context_chapters, ch._cloudId, props);
  else CLOUD.add(DB_IDS.context_chapters, props).then(function(r) { if (r && r.id) ch._cloudId = r.id; });
}
function syncMatchToCloud(matId, chId, m) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '资料ID': { text: matId },
    '章节ID': { text: chId },
    '词元': { text: m.lemma },
    '对应中文': { text: m.chWord },
    '使用义项': { text: m.sense || '' },
    '位置': { number: m.position || 0 },
    '所在句子': { text: m.sentence || '' },
    '手动修改': { checkbox: m.manual || false }
  };
  if (m._cloudId) CLOUD.update(DB_IDS.context_matches, m._cloudId, props);
  else CLOUD.add(DB_IDS.context_matches, props).then(function(r) { if (r && r.id) m._cloudId = r.id; });
}
function syncMasteryToCloud(lemma) {
  if (!STATE.cloudReady) return;
  var m = STATE.mastery[lemma]; if (!m) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '词元': { text: lemma },
    '资料ID': { text: m.materialId || '' },
    '状态': { select: m.status || 'unknown' },
    '尝试次数': { number: m.attempts || 0 },
    '正确次数': { number: m.correct || 0 },
    '错误次数': { number: m.wrong || 0 },
    '正确率': { number: m.rate || 0 },
    '最近答案': { text: m.lastAnswer || '' },
    '最近复习': { date: m.lastReview || nowISO() },
    '复习等级': { number: m.level || 0 },
    '下次复习': { date: m.nextReview || nowISO() },
    '今日连错': { number: m.errorStreakToday || 0 }
  };
  if (m._cloudId) CLOUD.update(DB_IDS.context_mastery, m._cloudId, props);
  else CLOUD.add(DB_IDS.context_mastery, props).then(function(r) { if (r && r.id) m._cloudId = r.id; });
}
function syncVocabToCloud(v) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '词元': { text: v.lemma },
    '音标': { text: v.ipa || '' },
    '词性': { text: v.pos || '' },
    '中文释义': { text: v.meaning || '' },
    '语境': { text: v.context || '' },
    '资料ID': { text: v.materialId || '' },
    '加入时间': { date: v.addedAt || nowISO() },
    '手动添加': { checkbox: v.manual || false }
  };
  if (v._cloudId) CLOUD.update(DB_IDS.context_vocab, v._cloudId, props);
  else CLOUD.add(DB_IDS.context_vocab, props).then(function(r) { if (r && r.id) v._cloudId = r.id; });
}
function syncAnswerToCloud(a) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '会话ID': { text: a.sessionId || '' },
    '词元': { text: a.lemma },
    '轮次': { select: a.round || 'r1' },
    '题型': { select: a.qType || 'q_multi' },
    '是否正确': { checkbox: a.correct || false },
    '用户输入': { text: a.userInput || '' },
    '标准答案': { text: a.stdAnswer || '' },
    '时间戳': { date: a.ts || nowISO() }
  };
  CLOUD.add(DB_IDS.context_answers, props).then(function(r) { if (r && r.id) a._cloudId = r.id; });
}
function syncSessionToCloud(s) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '会话ID': { text: s.id },
    '资料ID': { text: s.materialId || '' },
    '开始时间': { date: s.startedAt || nowISO() },
    '结束时间': { date: s.endedAt || nowISO() },
    '学习分钟': { number: s.durationMin || 0 },
    '阅读章节': { text: s.chapters || '' },
    '遇到词数': { number: s.wordsCount || 0 }
  };
  if (s._cloudId) CLOUD.update(DB_IDS.context_sessions, s._cloudId, props);
  else CLOUD.add(DB_IDS.context_sessions, props).then(function(r) { if (r && r.id) s._cloudId = r.id; });
}
function syncReviewToCloud(r) {
  if (!STATE.cloudReady) return;
  var props = {
    'profile_id': { text: STATE.profileId },
    '词元': { text: r.lemma },
    '等级': { number: r.level || 1 },
    '下次复习日期': { date: r.nextReviewDate || nowISO() },
    '上次结果': { select: r.lastResult || 'rev_unknown' },
    '资料ID': { text: r.materialId || '' },
    '加入时间': { date: r.addedAt || nowISO() }
  };
  if (r._cloudId) CLOUD.update(DB_IDS.context_review, r._cloudId, props);
  else CLOUD.add(DB_IDS.context_review, props).then(function(res) { if (res && res.id) r._cloudId = res.id; });
}

// ===== 手动同步 =====
function syncNow() {
  if (!STATE.cloudReady) { toast('离线模式，无法同步', 'err'); return; }
  saveLocal();
  toast('正在同步...', 'ok');
  // 重新从云端拉取最新
  loadDataForProfile(STATE.profileId).then(function() {
    refreshAll();
    toast('同步完成', 'ok');
  });
}
function toggleAutoSync() {
  STATE.autoSync = document.getElementById('autoSync').checked;
  LS.set('autoSync', STATE.autoSync);
}
function scheduleSync() {
  if (!STATE.autoSync || !STATE.cloudReady) return;
  if (STATE.syncTimer) clearTimeout(STATE.syncTimer);
  STATE.syncTimer = setTimeout(function() { saveLocal(); }, 2000);
}

// ===== 导航 =====
function navTo(view) {
  STATE.view = view;
  document.querySelectorAll('.nav-tab').forEach(function(t) {
    if (t.dataset.view === view) t.classList.add('active');
    else t.classList.remove('active');
  });
  document.querySelectorAll('section[id^="view-"]').forEach(function(s) {
    if (s.id === 'view-' + view) s.classList.remove('hidden');
    else s.classList.add('hidden');
  });
  // 视图特定渲染
  if (view === 'dashboard') renderDashboard();
  if (view === 'materials') renderMaterials();
  if (view === 'learn') renderLearnInit();
  if (view === 'test') renderTestInit();
  if (view === 'review') renderReview();
  if (view === 'vocab') renderVocab();
  if (view === 'wrong') renderWrong();
}

// ===== Dashboard 渲染 =====
function renderDashboard() {
  var today = todayStr();
  // 连续天数
  var streakDays = 0;
  var lastDate = null;
  STATE.sessions.sort(function(a,b) { return (b.startedAt||'').localeCompare(a.startedAt||''); }).forEach(function(s) {
    var d = (s.startedAt||'').slice(0,10);
    if (d === today || d === lastDate) { streakDays++; lastDate = d; }
    else if (lastDate) {
      var prev = new Date(lastDate); prev.setDate(prev.getDate()-1);
      if (d === prev.toISOString().slice(0,10)) { streakDays++; lastDate = d; }
      else return;
    }
  });

  var newWordsToday = 0;
  var reviewToday = getTodayReviewWords().length;
  var correctToday = 0;
  var totalToday = 0;
  STATE.answers.forEach(function(a) {
    if ((a.ts||'').slice(0,10) === today) {
      totalToday++;
      if (a.correct) correctToday++;
    }
  });
  var rateToday = totalToday > 0 ? Math.round(correctToday/totalToday*100) : 0;

  var html = '<div class="dash-card"><div class="num">' + newWordsToday + '</div><div class="lbl">今日新词</div></div>';
  html += '<div class="dash-card"><div class="num orange">' + reviewToday + '</div><div class="lbl">待复习</div></div>';
  html += '<div class="dash-card"><div class="num">' + streakDays + '</div><div class="lbl">连续天数</div></div>';
  html += '<div class="dash-card"><div class="num ' + (rateToday >= 80 ? '' : 'red') + '">' + rateToday + '%</div><div class="lbl">今日正确率</div></div>';
  document.getElementById('dashStats').innerHTML = html;

  // 最近资料
  var recentHtml = '<h3>最近学习</h3>';
  if (STATE.materials.length === 0) {
    recentHtml += '<p style="color:var(--text3);font-size:13px">暂无资料，请上传</p>';
  } else {
    STATE.materials.slice(0, 5).forEach(function(m) {
      var prog = STATE.progress[m.id] || {};
      var chs = STATE.chapters[m.id] || [];
      var doneCh = 0;
      chs.forEach(function(ch) { if (prog[ch.id]) doneCh++; });
      var pct = chs.length > 0 ? Math.round(doneCh/chs.length*100) : 0;
      recentHtml += '<div class="recent-item"><div class="info"><div class="title">' + escapeHTML(m.title) + '</div><div class="meta">' + chs.length + ' 章 · ' + (m.chapterCount||0) + ' 词</div></div><span class="progress">' + pct + '%</span></div>';
    });
  }
  document.getElementById('dashRecent').innerHTML = recentHtml;
}

// ===== 资料管理渲染 =====
function renderMaterials() {
  // 资料列表
  var matHtml = '';
  if (STATE.materials.length === 0) {
    matHtml = '<div class="empty-state"><p>暂无学习资料</p></div>';
  } else {
    STATE.materials.forEach(function(m) {
      var chs = STATE.chapters[m.id] || [];
      matHtml += '<div class="material-item"><div class="info"><div class="title">' + escapeHTML(m.title) + '</div><div class="meta">' + (m.sourceType||'TXT') + ' · ' + chs.length + ' 章 · ' + (m.rawContent||'').length + ' 字</div></div><div class="actions"><button class="btn btn-sm btn-outline" onclick="navTo(\'learn\');selectMaterial(\'' + m.id + '\')">学习</button><button class="btn btn-sm btn-danger" onclick="deleteMaterial(\'' + m.id + '\')">删除</button></div></div>';
    });
  }
  document.getElementById('materialList').innerHTML = matHtml;

  // 单词书列表
  var wbHtml = '';
  if (STATE.wordbooks.length === 0) {
    wbHtml = '<div class="empty-state"><p>暂无单词书</p></div>';
  } else {
    STATE.wordbooks.forEach(function(wb) {
      var wordCount = STATE.words.filter(function(w) { return w.wordbookId === wb.id; }).length;
      wbHtml += '<div class="material-item"><div class="info"><div class="title">' + escapeHTML(wb.name) + '</div><div class="meta">' + (wb.source||'') + ' · ' + wordCount + ' 词</div></div><div class="actions"><button class="btn btn-sm btn-danger" onclick="deleteWordbook(\'' + wb.id + '\')">删除</button></div></div>';
    });
  }
  document.getElementById('wordbookList').innerHTML = wbHtml;
}

// ===== 文件上传处理 =====
var pendingFileData = null;
var pendingFileType = null;

function showUploadModal(type) {
  pendingFileType = type;
  if (type === 'material') {
    document.getElementById('uploadModalTitle').textContent = '上传学习资料';
    document.getElementById('uploadModalBody').innerHTML = '<div style="margin-bottom:12px"><label style="font-size:13px;color:var(--text2);display:block;margin-bottom:6px">资料标题</label><input type="text" id="manualMatTitle" placeholder="输入标题" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px"></div><div><label style="font-size:13px;color:var(--text2);display:block;margin-bottom:6px">或直接粘贴文本</label><textarea id="manualMatText" placeholder="粘贴文章全文..." style="width:100%;height:200px;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px"></textarea></div><div style="margin-top:12px"><p style="font-size:12px;color:var(--text3)">支持 TXT 直接上传。PDF/DOCX 请先转为纯文本后粘贴。</p></div><div class="modal-actions"><button class="btn btn-outline" onclick="closeModal(\'uploadModal\')">取消</button><button class="btn btn-primary" onclick="submitManualMaterial()">确认添加</button></div>';
  } else {
    document.getElementById('uploadModalTitle').textContent = '导入单词书';
    document.getElementById('uploadModalBody').innerHTML = '<div style="margin-bottom:12px"><label style="font-size:13px;color:var(--text2);display:block;margin-bottom:6px">单词书名称</label><input type="text" id="manualWbName" placeholder="输入名称" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px"></div><div><label style="font-size:13px;color:var(--text2);display:block;margin-bottom:6px">粘贴 CSV 格式（首行表头：lemma,pos,ipa,meaning,example,unit）</label><textarea id="manualWbText" placeholder="lemma,pos,ipa,meaning,example,unit&#10;ceiling,n.,/si&#720;l&#618;&#331;/,天花板,A white ceiling...,U1" style="width:100%;height:200px;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace"></textarea></div><div style="margin-top:12px"><p style="font-size:12px;color:var(--text3)">支持 CSV/TXT。XLSX 请先转为 CSV。</p></div><div class="modal-actions"><button class="btn btn-outline" onclick="closeModal(\'uploadModal\')">取消</button><button class="btn btn-primary" onclick="submitManualWordbook()">确认导入</button></div>';
  }
  document.getElementById('uploadModal').classList.add('show');
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function submitManualMaterial() {
  var title = document.getElementById('manualMatTitle').value.trim();
  var text = document.getElementById('manualMatText').value.trim();
  if (!title) { toast('请输入标题', 'err'); return; }
  if (!text || text.length < 10) { toast('请粘贴至少 10 字的文本', 'err'); return; }
  var parsed = parseTXT(text);
  var matId = uid('mat');
  var material = { id: matId, title: title, sourceType: 's_manual', rawContent: text, chapters: parsed.chapters, chapterCount: parsed.chapters.length, createdAt: nowISO(), updatedAt: nowISO() };
  STATE.materials.push(material);
  STATE.chapters[matId] = parsed.chapters;
  saveLocal();
  syncMaterialToCloud(material);
  parsed.chapters.forEach(function(ch) { syncChapterToCloud(matId, ch); });
  closeModal('uploadModal');
  toast('资料已添加', 'ok');
  refreshAll();
}

function submitManualWordbook() {
  var name = document.getElementById('manualWbName').value.trim();
  var csvText = document.getElementById('manualWbText').value.trim();
  if (!name) { toast('请输入名称', 'err'); return; }
  if (!csvText) { toast('请粘贴 CSV 内容', 'err'); return; }
  var parsed = parseCSV(csvText);
  if (parsed.rows.length === 0) { toast('未解析到有效数据', 'err'); return; }
  var wbId = uid('wb');
  var wordbook = { id: wbId, name: name, source: 'manual', total: parsed.rows.length, importedAt: nowISO() };
  var words = parsed.rows.map(function(r) {
    return {
      lemma: r.lemma || r.word || r['单词'] || '',
      pos: r.pos || r['词性'] || '',
      ipa: r.ipa || r['音标'] || '',
      meaning: r.meaning || r['中文释义'] || r['释义'] || '',
      example: r.example || r['例句'] || '',
      unit: r.unit || r['单元'] || '',
      wordbookId: wbId
    };
  }).filter(function(w) { return w.lemma; });
  // 去重（按 lemma 忽略大小写）
  var seen = {};
  words = words.filter(function(w) {
    var k = w.lemma.toLowerCase();
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
  STATE.wordbooks.push(wordbook);
  STATE.words = STATE.words.concat(words);
  saveLocal();
  syncWordbookToCloud(wordbook);
  words.forEach(function(w) { syncWordToCloud(w); });
  closeModal('uploadModal');
  toast('单词书已导入：' + words.length + ' 词', 'ok');
  refreshAll();
}

function handleFileUpload(files, type) {
  if (!files || files.length === 0) return;
  var file = files[0];
  if (file.size > 10 * 1024 * 1024) { toast('文件过大（超过 10MB）', 'err'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result;
    if (type === 'material') {
      if (file.name.match(/\.pdf$/i)) {
        toast('PDF 文件请先转为纯文本后粘贴', 'err');
        showUploadModal('material');
        return;
      }
      if (file.name.match(/\.docx$/i)) {
        toast('DOCX 文件请先转为纯文本后粘贴', 'err');
        showUploadModal('material');
        return;
      }
      // TXT 文件
      var parsed = parseTXT(text);
      var matId = uid('mat');
      var material = { id: matId, title: file.name.replace(/\.\w+$/, ''), sourceType: 's_txt', rawContent: text, chapters: parsed.chapters, chapterCount: parsed.chapters.length, createdAt: nowISO(), updatedAt: nowISO() };
      STATE.materials.push(material);
      STATE.chapters[matId] = parsed.chapters;
      saveLocal();
      syncMaterialToCloud(material);
      parsed.chapters.forEach(function(ch) { syncChapterToCloud(matId, ch); });
      toast('资料已上传', 'ok');
      refreshAll();
    } else {
      // 单词书 CSV/TXT
      if (file.name.match(/\.xlsx$/i)) {
        toast('XLSX 文件请先转为 CSV', 'err');
        showUploadModal('wordbook');
        return;
      }
      var parsed = parseCSV(text);
      if (parsed.rows.length === 0) { toast('未解析到有效数据', 'err'); return; }
      // 显示字段映射
      showFieldMap(parsed, file.name);
    }
  };
  reader.onerror = function() { toast('文件读取失败', 'err'); };
  reader.readAsText(file, 'UTF-8');
}

function showFieldMap(parsed, fileName) {
  var fields = ['lemma', 'pos', 'ipa', 'meaning', 'example', 'unit'];
  var fieldLabels = { lemma: '英文单词', pos: '词性', ipa: '音标', meaning: '中文释义', example: '例句', unit: '单元' };
  var html = '<p style="font-size:13px;color:var(--text3);margin-bottom:8px">文件：' + escapeHTML(fileName) + ' · 检测到 ' + parsed.headers.length + ' 列，' + parsed.rows.length + ' 行</p>';
  html += '<div style="font-size:13px;color:var(--text2);margin-bottom:8px">将文件列映射到单词书字段：</div>';
  html += '<div class="field-map-row" style="font-weight:600"><div>单词书字段</div><div>文件列</div><div>预览</div></div>';
  fields.forEach(function(f) {
    html += '<div class="field-map-row"><div>' + fieldLabels[f] + ' (' + f + ')</div><div><select id="map_' + f + '"><option value="">--不导入--</option>';
    parsed.headers.forEach(function(h, i) {
      var sample = parsed.rows[0] ? (parsed.rows[0][h] || '') : '';
      html += '<option value="' + escapeHTML(h) + '" ' + (h.toLowerCase() === f || h.toLowerCase().indexOf(f) >= 0 ? 'selected' : '') + '>' + escapeHTML(h) + ' (示例: ' + escapeHTML(sample.substring(0, 20)) + ')</option>';
    });
    html += '</select></div><div style="color:var(--text3)">' + (parsed.rows[0] ? escapeHTML((parsed.rows[0][fields[f]] || '').substring(0, 20)) : '') + '</div></div>';
  });
  html += '<div style="margin-top:12px"><label style="font-size:13px">单词书名称</label><input type="text" id="fieldMapWbName" value="' + escapeHTML(fileName.replace(/\.\w+$/, '')) + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:4px"></div>';
  document.getElementById('fieldMapBody').innerHTML = html;
  document.getElementById('fieldMapModal').classList.add('show');
  pendingFileData = parsed;
}

function confirmFieldMap() {
  if (!pendingFileData) return;
  var fields = ['lemma', 'pos', 'ipa', 'meaning', 'example', 'unit'];
  var mapping = {};
  fields.forEach(function(f) {
    var sel = document.getElementById('map_' + f);
    mapping[f] = sel ? sel.value : '';
  });
  if (!mapping.lemma) { toast('必须映射「英文单词」字段', 'err'); return; }
  var wbName = document.getElementById('fieldMapWbName').value.trim() || '导入的单词书';
  var wbId = uid('wb');
  var wordbook = { id: wbId, name: wbName, source: 'csv导入', total: 0, importedAt: nowISO() };
  var words = [];
  var seen = {};
  pendingFileData.rows.forEach(function(r) {
    var lemma = r[mapping.lemma] || '';
    if (!lemma || seen[lemma.toLowerCase()]) return;
    seen[lemma.toLowerCase()] = true;
    words.push({
      lemma: lemma,
      pos: mapping.pos ? (r[mapping.pos] || '') : '',
      ipa: mapping.ipa ? (r[mapping.ipa] || '') : '',
      meaning: mapping.meaning ? (r[mapping.meaning] || '') : '',
      example: mapping.example ? (r[mapping.example] || '') : '',
      unit: mapping.unit ? (r[mapping.unit] || '') : '',
      wordbookId: wbId
    });
  });
  wordbook.total = words.length;
  STATE.wordbooks.push(wordbook);
  STATE.words = STATE.words.concat(words);
  saveLocal();
  syncWordbookToCloud(wordbook);
  words.forEach(function(w) { syncWordToCloud(w); });
  closeModal('fieldMapModal');
  pendingFileData = null;
  toast('导入成功：' + words.length + ' 词', 'ok');
  refreshAll();
}

// ===== 删除 =====
function deleteMaterial(matId) {
  showConfirm('删除资料', '删除后关联的章节、匹配和进度也将清除，不可恢复。确认删除？', function() {
    STATE.materials = STATE.materials.filter(function(m) { return m.id !== matId; });
    delete STATE.chapters[matId];
    delete STATE.matches[matId];
    delete STATE.progress[matId];
    saveLocal();
    // 云端删除（如果有 _cloudId）
    // 简化：不逐条删除，只删本地引用
    toast('已删除', 'ok');
    refreshAll();
  });
}
function deleteWordbook(wbId) {
  showConfirm('删除单词书', '删除后关联的单词也将清除。确认删除？', function() {
    STATE.wordbooks = STATE.wordbooks.filter(function(w) { return w.id !== wbId; });
    STATE.words = STATE.words.filter(function(w) { return w.wordbookId !== wbId; });
    saveLocal();
    toast('已删除', 'ok');
    refreshAll();
  });
}

function showConfirm(title, msg, onOk) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  var btn = document.getElementById('confirmOkBtn');
  btn.onclick = function() { closeModal('confirmModal'); if (onOk) onOk(); };
  document.getElementById('confirmModal').classList.add('show');
}

// ===== 学习页 =====
function renderLearnInit() {
  if (STATE.materials.length === 0) {
    document.getElementById('learnEmpty').classList.remove('hidden');
    document.getElementById('learnContent').classList.add('hidden');
    return;
  }
  document.getElementById('learnEmpty').classList.add('hidden');
  document.getElementById('learnContent').classList.remove('hidden');
  // 填充资料下拉
  var selMat = document.getElementById('selMaterial');
  selMat.innerHTML = STATE.materials.map(function(m) {
    return '<option value="' + m.id + '"' + (STATE.learnMaterialId === m.id ? ' selected' : '') + '>' + escapeHTML(m.title) + '</option>';
  }).join('');
  if (!STATE.learnMaterialId && STATE.materials.length > 0) {
    STATE.learnMaterialId = STATE.materials[0].id;
  }
  onLearnMaterialChange();
}

function onLearnMaterialChange() {
  STATE.learnMaterialId = document.getElementById('selMaterial').value;
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var selCh = document.getElementById('selChapter');
  selCh.innerHTML = chs.map(function(ch) {
    return '<option value="' + ch.id + '"' + (STATE.learnChapterId === ch.id ? ' selected' : '') + '>' + escapeHTML(ch.title) + '</option>';
  }).join('');
  if (chs.length > 0) {
    // 从进度恢复
    var prog = STATE.progress[STATE.learnMaterialId] || {};
    var lastChId = null;
    for (var cid in prog) { lastChId = cid; }
    STATE.learnChapterId = lastChId || chs[0].id;
    selCh.value = STATE.learnChapterId;
  }
  // 开始学习会话
  startOrResumeSession();
  refreshLearn();
}

function onLearnChapterChange() {
  STATE.learnChapterId = document.getElementById('selChapter').value;
  refreshLearn();
}

function startOrResumeSession() {
  if (STATE.currentSession && STATE.currentSession.materialId === STATE.learnMaterialId) return;
  STATE.currentSession = {
    id: uid('sess'),
    materialId: STATE.learnMaterialId,
    startedAt: nowISO(),
    chapters: [],
    wordsEncountered: {}
  };
}

function setLearnMode(mode) {
  STATE.learnMode = mode;
  document.querySelectorAll('.mode-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  refreshLearn();
}

function refreshLearn() {
  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var ch = chs.find(function(c) { return c.id === STATE.learnChapterId; });
  if (!ch) return;
  var matches = (STATE.matches[STATE.learnMaterialId] && STATE.matches[STATE.learnMaterialId][ch.id]) || [];
  var mode = STATE.learnMode;
  var showWord = document.getElementById('toggleWord').checked;
  var showIpa = document.getElementById('toggleIpa').checked;
  var showMeaning = document.getElementById('toggleMeaning').checked;

  document.getElementById('chTitle').textContent = ch.title;
  var chIdx = chs.findIndex(function(c) { return c.id === ch.id; });
  var prog = STATE.progress[STATE.learnMaterialId] && STATE.progress[STATE.learnMaterialId][ch.id];
  var pct = chs.length > 0 ? Math.round((chIdx + 1) / chs.length * 100) : 0;
  document.getElementById('chProgress').textContent = '第 ' + (chIdx + 1) + ' / ' + chs.length + ' 章 · ' + pct + '%';

  // 渲染阅读区
  var paragraphs = ch.content.split(/\n\n+/);
  var html = '';
  // 构建匹配索引：按 position 排序
  var sortedMatches = matches.slice().sort(function(a, b) { return a.position - b.position; });

  for (var pi = 0; pi < paragraphs.length; pi++) {
    var para = paragraphs[pi];
    if (!para.trim()) continue;
    // 在段落中插入单词
    var enriched = para;
    var paraMatches = sortedMatches.filter(function(m) {
      return m.position >= pi * 10000 && m.position < (pi + 1) * 10000;
    });
    // 从后往前替换，避免位置偏移
    paraMatches.sort(function(a, b) { return b.position - a.position; }).forEach(function(m) {
      var posInPara = m.position - pi * 10000;
      var chWord = m.chWord;
      var lemma = m.lemma;
      var insertHtml;
      if (mode === 'meaning') {
        var parts = [];
        if (showWord) parts.push('<span class="word-ins" onclick="openWordCard(\'' + escapeHTML(lemma) + '\')">' + escapeHTML(lemma) + '</span>');
        if (showIpa) parts.push('<span style="color:var(--text3);font-size:13px">/' + escapeHTML((findWord(lemma)||{}).ipa || (CONTEXT_DICT[lemma]||{}).ipa || '') + '/</span>');
        if (showMeaning) parts.push('<span style="color:var(--green-d)">(' + escapeHTML(m.sense || (findWord(lemma)||{}).meaning || '') + ')</span>');
        insertHtml = escapeHTML(chWord) + '（' + parts.join(' ') + '）';
      } else if (mode === 'blank') {
        insertHtml = '<span class="blank-box" id="blank_' + pi + '_' + posInPara + '"><input type="text" placeholder="?" onblur="checkBlank(this,\'' + escapeHTML(lemma) + '\',\'' + escapeHTML(m.sense||'') + '\')"></span>';
      } else {
        insertHtml = escapeHTML(chWord);
      }
      // 找到 chWord 在 enriched 中的位置并替换
      var idx = enriched.indexOf(chWord);
      if (idx !== -1) {
        enriched = enriched.substring(0, idx) + insertHtml + enriched.substring(idx + chWord.length);
        // 记录遇到的词
        if (STATE.currentSession) STATE.currentSession.wordsEncountered[lemma] = (STATE.currentSession.wordsEncountered[lemma] || 0) + 1;
      }
    });
    html += '<p>' + enriched + '</p>';
  }

  document.getElementById('readingArea').innerHTML = html;

  // 恢复滚动位置
  if (prog && prog.scrollPct) {
    setTimeout(function() {
      var area = document.getElementById('readingArea');
      area.scrollTop = area.scrollHeight * (prog.scrollPct / 100);
    }, 50);
  }

  // 保存进度
  if (!STATE.progress[STATE.learnMaterialId]) STATE.progress[STATE.learnMaterialId] = {};
  if (!STATE.progress[STATE.learnMaterialId][ch.id]) {
    STATE.progress[STATE.learnMaterialId][ch.id] = { mode: mode, scrollPct: 0, paraIdx: 0, updatedAt: nowISO() };
  }
  STATE.progress[STATE.learnMaterialId][ch.id].mode = mode;
  saveLocal();
  scheduleSync();
}

function checkBlank(input, lemma, sense) {
  var val = input.value.trim().toLowerCase();
  var box = input.parentElement;
  if (val === lemma.toLowerCase()) {
    box.classList.add('correct');
    box.classList.remove('wrong');
  } else {
    box.classList.add('wrong');
    box.classList.remove('correct');
    // 显示正确答案
    if (!box.querySelector('.blank-answer')) {
      var ans = document.createElement('span');
      ans.className = 'blank-answer';
      ans.textContent = lemma;
      box.appendChild(ans);
    }
  }
}

function saveScrollPos() {
  if (!STATE.learnMaterialId || !STATE.learnChapterId) return;
  var area = document.getElementById('readingArea');
  var pct = area.scrollHeight > 0 ? Math.round(area.scrollTop / area.scrollHeight * 100) : 0;
  if (!STATE.progress[STATE.learnMaterialId]) STATE.progress[STATE.learnMaterialId] = {};
  STATE.progress[STATE.learnMaterialId][STATE.learnChapterId].scrollPct = pct;
  STATE.progress[STATE.learnMaterialId][STATE.learnChapterId].updatedAt = nowISO();
  saveLocal();
  scheduleSync();
}

function prevChapter() {
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var idx = chs.findIndex(function(c) { return c.id === STATE.learnChapterId; });
  if (idx > 0) {
    STATE.learnChapterId = chs[idx - 1].id;
    document.getElementById('selChapter').value = STATE.learnChapterId;
    refreshLearn();
  }
}
function nextChapter() {
  var chs = STATE.chapters[STATE.learnMaterialId] || [];
  var idx = chs.findIndex(function(c) { return c.id === STATE.learnChapterId; });
  if (idx < chs.length - 1) {
    STATE.learnChapterId = chs[idx + 1].id;
    document.getElementById('selChapter').value = STATE.learnChapterId;
    refreshLearn();
  }
}

function selectMaterial(matId) {
  STATE.learnMaterialId = matId;
  renderLearnInit();
}

// ===== 词卡 =====
function openWordCard(lemma) {
  var w = findWord(lemma) || {};
  var dictEntry = CONTEXT_DICT[lemma] || {};
  var m = STATE.mastery[lemma] || {};
  // 找当前章节的匹配
  var matches = (STATE.matches[STATE.learnMaterialId] && STATE.matches[STATE.learnMaterialId][STATE.learnChapterId]) || [];
  var context = '';
  for (var i = 0; i < matches.length; i++) {
    if (matches[i].lemma === lemma) { context = matches[i].sentence; break; }
  }
  var inVocab = STATE.vocab.some(function(v) { return v.lemma === lemma; });
  var html = '<div class="wc-word">' + escapeHTML(lemma) + ' <button class="wc-speak" onclick="speak(\'' + escapeHTML(lemma) + '\')">🔊 发音</button></div>';
  html += '<div class="wc-ipa">' + escapeHTML(w.ipa || dictEntry.ipa || '') + '</div>';
  if (w.pos || dictEntry.pos) html += '<div class="wc-pos">' + escapeHTML(w.pos || dictEntry.pos || '') + '</div>';
  html += '<div class="wc-meaning">' + escapeHTML(w.meaning || dictEntry.meaning || m.sense || '') + '</div>';
  if (context) html += '<div class="wc-context">语境：<span class="hl">' + escapeHTML(context) + '</span></div>';
  html += '<div class="wc-actions">';
  html += '<button class="btn btn-sm ' + (inVocab ? 'btn-outline' : 'btn-primary') + '" onclick="toggleVocab(\'' + escapeHTML(lemma) + '\')">' + (inVocab ? '✓ 已在生词本' : '+ 加入生词本') + '</button>';
  html += '<button class="btn btn-sm btn-outline" onclick="markMastery(\'' + escapeHTML(lemma) + '\',\'known\')">已掌握</button>';
  html += '<button class="btn btn-sm btn-outline" onclick="markMastery(\'' + escapeHTML(lemma) + '\',\'fuzzy\')">模糊</button>';
  html += '<button class="btn btn-sm btn-outline" onclick="markMastery(\'' + escapeHTML(lemma) + '\',\'unknown\')">不认识</button>';
  html += '</div>';
  document.getElementById('wordCardContent').innerHTML = html;
  document.getElementById('wordCardModal').classList.add('show');
}
function closeWordCard() { document.getElementById('wordCardModal').classList.remove('show'); }

function toggleVocab(lemma) {
  var idx = STATE.vocab.findIndex(function(v) { return v.lemma === lemma; });
  if (idx >= 0) {
    STATE.vocab.splice(idx, 1);
    toast('已移出生词本', 'ok');
  } else {
    addToVocab(lemma);
    toast('已加入生词本', 'ok');
  }
  saveLocal();
  openWordCard(lemma);
}

function markMastery(lemma, status) {
  if (!STATE.mastery[lemma]) STATE.mastery[lemma] = { status: 'unknown', attempts: 0, correct: 0, wrong: 0, level: 0, errorStreakToday: 0, materialId: STATE.learnMaterialId };
  STATE.mastery[lemma].status = status;
  saveLocal();
  syncMasteryToCloud(lemma);
  toast('已标记为：' + (status === 'known' ? '已掌握' : status === 'fuzzy' ? '模糊' : '不认识'), 'ok');
  closeWordCard();
}

// ===== 结束学习会话 =====
function endSession() {
  if (!STATE.currentSession) { navTo('dashboard'); return; }
  var sess = STATE.currentSession;
  sess.endedAt = nowISO();
  var durMs = new Date(sess.endedAt) - new Date(sess.startedAt);
  sess.durationMin = Math.round(durMs / 60000);
  var chs = STATE.chapters[sess.materialId] || [];
  var chIdx = chs.findIndex(function(c) { return c.id === STATE.learnChapterId; });
  sess.chapters = chIdx >= 0 ? chs[chIdx].title : '';
  var wordsList = Object.keys(sess.wordsEncountered).map(function(lemma) {
    return { lemma: lemma, count: sess.wordsEncountered[lemma] };
  });
  sess.wordsCount = wordsList.length;
  STATE.sessions.push(sess);
  saveLocal();
  syncSessionToCloud(sess);
  STATE.currentSession = null;

  // 生成报告
  var mat = STATE.materials.find(function(m) { return m.id === sess.materialId; });
  var html = '<div class="report-card"><h3>学习时长</h3><div class="report-stats"><div class="report-stat"><div class="v">' + sess.durationMin + '</div><div class="l">分钟</div></div><div class="report-stat"><div class="v">' + (chIdx+1) + '/' + chs.length + '</div><div class="l">章节进度</div></div><div class="report-stat"><div class="v">' + wordsList.length + '</div><div class="l">遇到单词</div></div></div></div>';
  html += '<div class="report-card"><h3>本次词汇</h3>';
  wordsList.forEach(function(item) {
    var w = findWord(item.lemma) || {};
    var m = STATE.mastery[item.lemma] || {};
    html += '<div class="report-word"><div><span class="en">' + escapeHTML(item.lemma) + '</span> <span class="zh">— ' + escapeHTML(w.meaning || '') + '</span></div><span class="cnt">出现 ' + item.count + ' 次</span><div class="mark-btns">';
    html += '<button class="mark-btn known ' + (m.status==='known'?'active':'') + '" onclick="markMastery(\'' + escapeHTML(item.lemma) + '\',\'known\')">已掌握</button>';
    html += '<button class="mark-btn fuzzy ' + (m.status==='fuzzy'?'active':'') + '" onclick="markMastery(\'' + escapeHTML(item.lemma) + '\',\'fuzzy\')">模糊</button>';
    html += '<button class="mark-btn unknown ' + (m.status==='unknown'?'active':'') + '" onclick="markMastery(\'' + escapeHTML(item.lemma) + '\',\'unknown\')">不认识</button>';
    html += '</div></div>';
  });
  html += '</div>';
  document.getElementById('reportBody').innerHTML = html;
  document.getElementById('reportModal').classList.add('show');

  // 构建测试队列
  STATE.testQueue = wordsList.map(function(item) { return item.lemma; });
  STATE.testIdx = 0;
  STATE.testRound = 1;
}

// ===== 测试页 =====
function renderTestInit() {
  if (STATE.testQueue.length === 0) {
    document.getElementById('testEmpty').classList.remove('hidden');
    document.getElementById('testContent').classList.add('hidden');
    return;
  }
  document.getElementById('testEmpty').classList.add('hidden');
  document.getElementById('testContent').classList.remove('hidden');
  renderTestQuestion();
}

function renderTestQuestion() {
  var total = STATE.testQueue.length;
  var idx = STATE.testIdx;
  if (idx >= total) {
    // 全部完成
    document.getElementById('testCard').innerHTML = '<div style="text-align:center;padding:20px"><h3>🎉 测试完成</h3><p style="color:var(--text3);margin:8px 0">本轮共测试 ' + total + ' 词</p><button class="btn btn-primary" onclick="navTo(\'review\')">查看复习队列</button></div>';
    document.getElementById('testBarFill').style.width = '100%';
    document.getElementById('testCount').textContent = total + ' / ' + total;
    return;
  }
  var lemma = STATE.testQueue[idx];
  var w = findWord(lemma) || {};
  var pct = Math.round(idx / total * 100);
  document.getElementById('testBarFill').style.width = pct + '%';
  document.getElementById('testCount').textContent = (idx + 1) + ' / ' + total;

  var html = '';
  if (STATE.testRound === 1) {
    // 四选一
    var meaning = w.meaning || (CONTEXT_DICT[lemma]||{}).meaning || '';
    var correctOption = meaning.split(/[；;,，]/)[0] || meaning;
    // 生成干扰项：从其他单词的释义中取
    var allMeanings = STATE.words.filter(function(x) { return x.lemma !== lemma && x.meaning; }).map(function(x) {
      return x.meaning.split(/[；;,，]/)[0];
    }).filter(function(m) { return m && m !== correctOption; });
    // 随机取3个
    var distractors = [];
    while (distractors.length < 3 && allMeanings.length > 0) {
      var r = Math.floor(Math.random() * allMeanings.length);
      var m = allMeanings.splice(r, 1)[0];
      if (distractors.indexOf(m) === -1) distractors.push(m);
    }
    var options = [correctOption].concat(distractors);
    // 打乱
    options.sort(function() { return Math.random() - 0.5; });

    html = '<div class="q-word">' + escapeHTML(lemma) + ' <button class="wc-speak" onclick="speak(\'' + escapeHTML(lemma) + '\')" style="display:inline-flex">🔊</button></div>';
    html += '<div class="q-ipa">' + escapeHTML(w.ipa || '') + '</div>';
    html += '<div class="q-hint">选择正确的中文释义</div>';
    options.forEach(function(opt) {
      html += '<button class="opt-btn" onclick="answerMulti(\'' + escapeHTML(opt) + '\',\'' + escapeHTML(correctOption) + '\',\'' + escapeHTML(lemma) + '\',this)">' + escapeHTML(opt) + '</button>';
    });
    html += '<div class="test-feedback" id="testFeedback"></div>';
  } else {
    // 主动回忆
    html = '<div class="q-word">' + escapeHTML(lemma) + ' <button class="wc-speak" onclick="speak(\'' + escapeHTML(lemma) + '\')" style="display:inline-flex">🔊</button></div>';
    html += '<div class="q-ipa">' + escapeHTML(w.ipa || '') + '</div>';
    html += '<div class="q-hint">请输入中文释义</div>';
    html += '<input type="text" class="test-input" id="recallInput" placeholder="输入中文..." onkeydown="if(event.key===\'Enter\')checkRecall(\'' + escapeHTML(lemma) + '\')">';
    html += '<div style="margin-top:8px"><button class="btn btn-primary" style="width:100%" onclick="checkRecall(\'' + escapeHTML(lemma) + '\')">提交</button></div>';
    html += '<div class="test-feedback" id="testFeedback"></div>';
  }
  document.getElementById('testCard').innerHTML = html;
}

var currentAnswer = null;
function answerMulti(selected, correct, lemma, btn) {
  var isCorrect = selected === correct;
  // 禁用所有按钮
  document.querySelectorAll('.opt-btn').forEach(function(b) {
    b.disabled = true;
    if (b.textContent === correct) b.classList.add('correct');
    else if (b === btn && !isCorrect) b.classList.add('wrong');
  });
  var fb = document.getElementById('testFeedback');
  if (isCorrect) {
    fb.className = 'test-feedback show ok';
    fb.textContent = '✓ 正确！';
  } else {
    fb.className = 'test-feedback show err';
    fb.textContent = '✗ 正确答案：' + correct;
  }
  // 记录答题
  recordAnswer(lemma, 'r1', 'q_multi', isCorrect, selected, correct);
  // 进入第二轮或队尾
  setTimeout(function() {
    if (isCorrect) {
      STATE.testRound = 2;
      renderTestQuestion();
    } else {
      // 队尾
      STATE.testQueue.push(lemma);
      STATE.testIdx++;
      STATE.testRound = 1;
      renderTestQuestion();
    }
  }, 1200);
}

function checkRecall(lemma) {
  var input = document.getElementById('recallInput');
  var userAns = input.value.trim();
  if (!userAns) { toast('请输入答案', 'err'); return; }
  var w = findWord(lemma) || {};
  var stdAnswer = w.meaning || (CONTEXT_DICT[lemma]||{}).meaning || '';
  // 检查同义答案
  var synonyms = STATE.synonyms[lemma] || [];
  var accepted = false;
  // 标准释义关键词匹配
  var stdKeywords = stdAnswer.split(/[；;,，\s]/).filter(function(s) { return s.length >= 2; });
  var matchedKeywords = stdKeywords.filter(function(kw) { return userAns.indexOf(kw) >= 0; });
  // 同义答案匹配
  synonyms.forEach(function(syn) {
    if (syn.accepted && userAns.indexOf(syn.answer) >= 0) accepted = true;
  });
  var isCorrect = accepted || matchedKeywords.length >= 1 && matchedKeywords.length >= Math.ceil(stdKeywords.length * 0.5);

  var fb = document.getElementById('testFeedback');
  if (isCorrect) {
    fb.className = 'test-feedback show ok';
    fb.textContent = '✓ 正确！';
    recordAnswer(lemma, 'r2', 'q_recall', true, userAns, stdAnswer);
    setTimeout(function() {
      STATE.testIdx++;
      STATE.testRound = 1;
      renderTestQuestion();
    }, 1200);
  } else {
    // 低置信度判断
    var lowConfidence = matchedKeywords.length > 0 && matchedKeywords.length < Math.ceil(stdKeywords.length * 0.5);
    if (lowConfidence) {
      fb.className = 'test-feedback show maybe';
      fb.innerHTML = '🤔 可能正确？标准答案：' + escapeHTML(stdAnswer) + '<br><button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="judgeRecall(true,\'' + escapeHTML(lemma) + '\',\'' + escapeHTML(userAns) + '\',\'' + escapeHTML(stdAnswer) + '\')">算正确</button> <button class="btn btn-sm btn-danger" onclick="judgeRecall(false,\'' + escapeHTML(lemma) + '\',\'' + escapeHTML(userAns) + '\',\'' + escapeHTML(stdAnswer) + '\')">算错误</button>';
    } else {
      fb.className = 'test-feedback show err';
      fb.innerHTML = '✗ 正确答案：' + escapeHTML(stdAnswer);
      recordAnswer(lemma, 'r2', 'q_recall', false, userAns, stdAnswer);
      setTimeout(function() {
        // 队尾 + 生词本
        STATE.testQueue.push(lemma);
        addToVocab(lemma);
        STATE.testIdx++;
        STATE.testRound = 1;
        renderTestQuestion();
      }, 1500);
    }
  }
}

function judgeRecall(judgedCorrect, lemma, userAns, stdAnswer) {
  // 保存用户判定
  if (!STATE.synonyms[lemma]) STATE.synonyms[lemma] = [];
  STATE.synonyms[lemma].push({ answer: userAns, accepted: judgedCorrect, count: 1, _id: uid('syn') });
  recordAnswer(lemma, 'r2', 'q_recall', judgedCorrect, userAns, stdAnswer);
  saveLocal();
  if (judgedCorrect) {
    STATE.testIdx++;
  } else {
    STATE.testQueue.push(lemma);
    addToVocab(lemma);
    STATE.testIdx++;
  }
  STATE.testRound = 1;
  renderTestQuestion();
}

function recordAnswer(lemma, round, qType, correct, userInput, stdAnswer) {
  var answer = { sessionId: STATE.sessions.length > 0 ? STATE.sessions[STATE.sessions.length-1].id : '', lemma: lemma, round: round, qType: qType, correct: correct, userInput: userInput, stdAnswer: stdAnswer, ts: nowISO() };
  STATE.answers.push(answer);
  // 更新掌握状态
  advanceReview(lemma, correct);
  // 同步到云端
  syncAnswerToCloud(answer);
  syncMasteryToCloud(lemma);
  saveLocal();
}

// ===== 复习页 =====
function renderReview() {
  var today = todayStr();
  var due = STATE.reviewQueue.filter(function(r) { return r.nextReviewDate && r.nextReviewDate.slice(0,10) <= today; });
  var total = STATE.reviewQueue.length;
  var mastered = Object.values(STATE.mastery).filter(function(m) { return m.status === 'known'; }).length;

  var html = '<div class="dash-grid"><div class="dash-card"><div class="num orange">' + due.length + '</div><div class="lbl">今日待复习</div></div><div class="dash-card"><div class="num">' + total + '</div><div class="lbl">总复习词</div></div><div class="dash-card"><div class="num">' + mastered + '</div><div class="lbl">已掌握</div></div></div>';
  document.getElementById('reviewStats').innerHTML = html;

  if (due.length === 0) {
    document.getElementById('reviewContent').innerHTML = '<div class="empty-state"><p>🎉 今日无待复习单词</p></div>';
    document.getElementById('btnStartReview').style.display = 'none';
    return;
  }
  document.getElementById('btnStartReview').style.display = 'inline-flex';
  document.getElementById('reviewContent').innerHTML = '<div class="card"><p style="font-size:14px;color:var(--text2)">今日有 <b>' + due.length + '</b> 个单词需要复习，点击「开始今日复习」开始。</p></div>';
}

var reviewIdx = 0;
function startReview() {
  var today = todayStr();
  var due = STATE.reviewQueue.filter(function(r) { return r.nextReviewDate && r.nextReviewDate.slice(0,10) <= today; });
  if (due.length === 0) { toast('今日无待复习', 'ok'); return; }
  reviewIdx = 0;
  renderReviewQuestion(due);
}

function renderReviewQuestion(queue) {
  if (reviewIdx >= queue.length) {
    document.getElementById('reviewContent').innerHTML = '<div class="empty-state"><p>🎉 复习完成</p><button class="btn btn-primary" onclick="navTo(\'dashboard\')">返回首页</button></div>';
    return;
  }
  var item = queue[reviewIdx];
  var w = findWord(item.lemma) || {};
  var html = '<div class="test-card"><div class="q-word">' + escapeHTML(item.lemma) + ' <button class="wc-speak" onclick="speak(\'' + escapeHTML(item.lemma) + '\')" style="display:inline-flex">🔊</button></div>';
  html += '<div class="q-ipa">' + escapeHTML(w.ipa || '') + '</div>';
  html += '<div class="q-hint">你还记得这个单词吗？</div>';
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">';
  html += '<button class="btn btn-primary" style="flex:1;min-width:80px" onclick="reviewAnswer(\'' + escapeHTML(item.lemma) + '\',\'known\',true)">认识</button>';
  html += '<button class="btn btn-outline" style="flex:1;min-width:80px;background:var(--orange-l);color:var(--orange)" onclick="reviewAnswer(\'' + escapeHTML(item.lemma) + '\',\'fuzzy\',false)">模糊</button>';
  html += '<button class="btn btn-danger" style="flex:1;min-width:80px" onclick="reviewAnswer(\'' + escapeHTML(item.lemma) + '\',\'unknown\',false)">不认识</button>';
  html += '<button class="btn btn-outline" style="flex:1;min-width:80px" onclick="reviewAnswer(\'' + escapeHTML(item.lemma) + '\',\'skip\',false)">跳过</button>';
  html += '</div>';
  html += '<div style="margin-top:12px;font-size:13px;color:var(--text3);text-align:center">当前等级：L' + item.level + ' · 下次复习：' + fmtDate(item.nextReviewDate) + '</div>';
  html += '<div style="margin-top:8px;font-size:14px;color:var(--green-d);text-align:center">释义：' + escapeHTML(w.meaning || '') + '</div>';
  html += '</div>';
  document.getElementById('reviewContent').innerHTML = html;
}

function reviewAnswer(lemma, result, correct) {
  if (result !== 'skip') {
    advanceReview(lemma, correct);
    // 更新复习队列
    var item = STATE.reviewQueue.find(function(r) { return r.lemma === lemma; });
    if (item) {
      item.level = STATE.mastery[lemma].level;
      item.nextReviewDate = STATE.mastery[lemma].nextReview;
      item.lastResult = result;
      syncReviewToCloud(item);
    }
    syncMasteryToCloud(lemma);
  }
  saveLocal();
  reviewIdx++;
  startReview();
}

// ===== 词表 =====
function renderVocab() {
  // 填充筛选下拉
  var selMat = document.getElementById('vocabFilterMat');
  if (selMat.options.length <= 1) {
    STATE.materials.forEach(function(m) {
      var opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.title;
      selMat.appendChild(opt);
    });
  }
  var selCh = document.getElementById('vocabFilterCh');
  var matId = selMat.value;
  selCh.innerHTML = '<option value="">全部章节</option>';
  if (matId) {
    var chs = STATE.chapters[matId] || [];
    chs.forEach(function(ch) {
      var opt = document.createElement('option');
      opt.value = ch.id; opt.textContent = ch.title;
      selCh.appendChild(opt);
    });
  }

  // 收集本资料/章节的词
  var words = [];
  if (matId) {
    var chs = STATE.chapters[matId] || [];
    var chId = selCh.value;
    var allMatches = [];
    if (chId) {
      allMatches = (STATE.matches[matId] && STATE.matches[matId][chId]) || [];
    } else {
      chs.forEach(function(ch) {
        var ms = (STATE.matches[matId] && STATE.matches[matId][ch.id]) || [];
        allMatches = allMatches.concat(ms);
      });
    }
    // 按 lemma 去重并统计出现次数
    var lemmaCount = {};
    allMatches.forEach(function(m) {
      if (!lemmaCount[m.lemma]) lemmaCount[m.lemma] = { count: 0, lemma: m.lemma, sense: m.sense };
      lemmaCount[m.lemma].count++;
    });
    words = Object.values(lemmaCount);
  } else {
    words = STATE.words.map(function(w) {
      return { lemma: w.lemma, sense: w.meaning, count: 0 };
    });
  }

  // 状态筛选
  var statusFilter = document.getElementById('vocabFilterStatus').value;
  if (statusFilter) {
    words = words.filter(function(w) {
      var m = STATE.mastery[w.lemma] || {};
      return m.status === statusFilter;
    });
  }

  // 隐藏/显示
  var hideWord = document.getElementById('toggleHideWord').checked;
  var hideIpa = document.getElementById('toggleHideIpa').checked;
  var hideMeaning = document.getElementById('toggleHideMeaning').checked;

  var html = '<table class="vocab-table"><thead><tr><th>单词</th><th>音标</th><th>词性</th><th>释义</th><th>次数</th><th>状态</th><th>下次复习</th></tr></thead><tbody>';
  words.forEach(function(w) {
    var wd = findWord(w.lemma) || {};
    var m = STATE.mastery[w.lemma] || {};
    var statusTag = m.status === 'known' ? '<span class="tag tag-green">已掌握</span>' : m.status === 'fuzzy' ? '<span class="tag tag-orange">模糊</span>' : m.status === 'unknown' ? '<span class="tag tag-red">不认识</span>' : '<span class="tag tag-gray">未学</span>';
    html += '<tr>';
    html += '<td class="col-word ' + (hideWord ? 'hide-col' : '') + '" onclick="this.classList.toggle(\'hide-col\')">' + escapeHTML(w.lemma) + '</td>';
    html += '<td class="col-ipa ' + (hideIpa ? 'hide-col' : '') + '" onclick="this.classList.toggle(\'hide-col\')">' + escapeHTML(wd.ipa || '') + '</td>';
    html += '<td>' + escapeHTML(wd.pos || '') + '</td>';
    html += '<td ' + (hideMeaning ? 'class="hide-col"' : '') + ' onclick="this.classList.toggle(\'hide-col\')">' + escapeHTML(w.sense || wd.meaning || '') + '</td>';
    html += '<td class="num-cell">' + (w.count || 0) + '</td>';
    html += '<td>' + statusTag + '</td>';
    html += '<td>' + fmtDate(m.nextReview) + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('vocabTableWrap').innerHTML = html;
  document.getElementById('mingxieWrap').classList.add('hidden');
}

var mingxieMode = null;
function toggleMingxie() {
  var wrap = document.getElementById('mingxieWrap');
  if (wrap.classList.contains('hidden')) {
    // 显示默写
    mingxieMode = mingxieMode === 'en2zh' ? 'zh2en' : 'en2zh';
    renderMingxie();
  } else {
    wrap.classList.add('hidden');
  }
}
function renderMingxie() {
  var wrap = document.getElementById('mingxieWrap');
  var words = STATE.words.map(function(w) { return { lemma: w.lemma, ipa: w.ipa, pos: w.pos, meaning: w.meaning }; });
  if (words.length === 0) { wrap.innerHTML = '<p>暂无单词</p>'; return; }
  var html = '<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn btn-sm ' + (mingxieMode==='en2zh'?'btn-primary':'btn-outline') + '" onclick="mingxieMode=\'en2zh\';renderMingxie()">看英文写中文</button><button class="btn btn-sm ' + (mingxieMode==='zh2en'?'btn-primary':'btn-outline') + '" onclick="mingxieMode=\'zh2en\';renderMingxie()">看中文写英文</button><button class="btn btn-sm btn-outline" onclick="checkMingxie()">检查答案</button></div>';
  words.forEach(function(w, i) {
    if (mingxieMode === 'en2zh') {
      html += '<div class="mingxie-item"><div class="prompt">' + escapeHTML(w.lemma) + ' <span style="color:var(--text3);font-size:13px">' + escapeHTML(w.ipa||'') + '</span></div><input type="text" data-idx="' + i + '" data-std="' + escapeHTML(w.meaning||'') + '" placeholder="输入中文释义"><div class="answer">正确：' + escapeHTML(w.meaning||'') + '</div></div>';
    } else {
      html += '<div class="mingxie-item"><div class="prompt">' + escapeHTML(w.meaning||'') + '</div><input type="text" data-idx="' + i + '" data-std="' + escapeHTML(w.lemma) + '" placeholder="输入英文单词"><div class="answer">正确：' + escapeHTML(w.lemma) + '</div></div>';
    }
  });
  wrap.innerHTML = html;
  wrap.classList.remove('hidden');
  document.getElementById('vocabTableWrap').classList.add('hidden');
}
function checkMingxie() {
  var inputs = document.querySelectorAll('#mingxieWrap input[data-idx]');
  inputs.forEach(function(inp) {
    var std = inp.dataset.std;
    var val = inp.value.trim();
    var ans = inp.parentElement.querySelector('.answer');
    if (val.toLowerCase() === std.toLowerCase()) {
      inp.classList.add('correct'); inp.classList.remove('wrong');
      ans.classList.remove('show');
    } else {
      inp.classList.add('wrong'); inp.classList.remove('correct');
      ans.classList.add('show');
    }
  });
}

// ===== 错词 =====
function renderWrong() {
  var selMat = document.getElementById('wrongFilterMat');
  if (selMat.options.length <= 1) {
    STATE.materials.forEach(function(m) {
      var opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.title;
      selMat.appendChild(opt);
    });
  }
  var matId = selMat.value;
  var statusFilter = document.getElementById('wrongFilterStatus').value;

  var wrongWords = Object.values(STATE.mastery).filter(function(m) {
    if (statusFilter && m.status !== statusFilter) return false;
    if (matId && m.materialId !== matId) return false;
    return m.wrong > 0 || m.status === 'unknown' || m.status === 'fuzzy';
  });

  var html = '<table class="vocab-table"><thead><tr><th>单词</th><th>尝试</th><th>正确</th><th>错误</th><th>正确率</th><th>最近答案</th><th>最近复习</th><th>下次复习</th></tr></thead><tbody>';
  wrongWords.forEach(function(m) {
    var w = findWord(Object.keys(STATE.mastery).find(function(k) { return STATE.mastery[k] === m; })) || {};
    html += '<tr><td class="col-word">' + escapeHTML(Object.keys(STATE.mastery).find(function(k) { return STATE.mastery[k] === m; }) || '') + '</td>';
    html += '<td class="num-cell">' + m.attempts + '</td><td class="num-cell">' + m.correct + '</td><td class="num-cell">' + m.wrong + '</td>';
    html += '<td class="num-cell">' + Math.round((m.rate||0)*100) + '%</td><td>' + escapeHTML(m.lastAnswer||'') + '</td>';
    html += '<td>' + fmtDate(m.lastReview) + '</td><td>' + fmtDate(m.nextReview) + '</td></tr>';
  });
  html += '</tbody></table>';
  if (wrongWords.length === 0) html = '<div class="empty-state"><p>暂无错词</p></div>';
  document.getElementById('wrongTableWrap').innerHTML = html;
}

// ===== 导出 =====
function exportVocabCSV() {
  var words = STATE.words;
  var csv = '\ufeff单词,词性,音标,中文释义,出现次数,掌握等级,正确率,下次复习\n';
  words.forEach(function(w) {
    var m = STATE.mastery[w.lemma] || {};
    var count = 0;
    Object.keys(STATE.matches).forEach(function(mid) {
      Object.keys(STATE.matches[mid]).forEach(function(cid) {
        STATE.matches[mid][cid].forEach(function(mt) { if (mt.lemma === w.lemma) count++; });
      });
    });
    csv += [w.lemma, w.pos, w.ipa, w.meaning, count, m.status||'未学', Math.round((m.rate||0)*100)+'%', fmtDate(m.nextReview)].join(',') + '\n';
  });
  downloadCSV(csv, 'vocab_export.csv');
}

function exportWrongCSV() {
  var csv = '\ufeff单词,尝试次数,正确次数,错误次数,正确率,最近答案,最近复习,下次复习\n';
  Object.keys(STATE.mastery).forEach(function(lemma) {
    var m = STATE.mastery[lemma];
    if (m.wrong > 0 || m.status === 'unknown' || m.status === 'fuzzy') {
      csv += [lemma, m.attempts, m.correct, m.wrong, Math.round((m.rate||0)*100)+'%', m.lastAnswer||'', fmtDate(m.lastReview), fmtDate(m.nextReview)].join(',') + '\n';
    }
  });
  downloadCSV(csv, 'wrong_words.csv');
}

function downloadCSV(csv, filename) {
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('已导出 ' + filename, 'ok');
}

function exportAllJSON() {
  var data = {
    profileId: STATE.profileId,
    nickname: STATE.nickname,
    exportedAt: nowISO(),
    materials: STATE.materials,
    wordbooks: STATE.wordbooks,
    words: STATE.words,
    chapters: STATE.chapters,
    matches: STATE.matches,
    progress: STATE.progress,
    sessions: STATE.sessions,
    mastery: STATE.mastery,
    vocab: STATE.vocab,
    synonyms: STATE.synonyms,
    answers: STATE.answers,
    reviewQueue: STATE.reviewQueue
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'ctx_vocab_backup_' + todayStr() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('已导出全部数据', 'ok');
}

function importAllJSON(files) {
  if (!files || files.length === 0) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      showConfirm('导入数据', '将覆盖当前所有数据，不可恢复。确认导入？', function() {
        STATE.materials = data.materials || [];
        STATE.wordbooks = data.wordbooks || [];
        STATE.words = data.words || [];
        STATE.chapters = data.chapters || {};
        STATE.matches = data.matches || {};
        STATE.progress = data.progress || {};
        STATE.sessions = data.sessions || [];
        STATE.mastery = data.mastery || {};
        STATE.vocab = data.vocab || [];
        STATE.synonyms = data.synonyms || {};
        STATE.answers = data.answers || [];
        STATE.reviewQueue = data.reviewQueue || [];
        saveLocal();
        // 同步到云端
        if (STATE.cloudReady) {
          STATE.materials.forEach(syncMaterialToCloud);
          STATE.wordbooks.forEach(syncWordbookToCloud);
          STATE.words.forEach(syncWordToCloud);
        }
        refreshAll();
        toast('导入成功', 'ok');
      });
    } catch (err) {
      toast('文件格式错误', 'err');
    }
  };
  reader.readAsText(files[0]);
}

function clearAllData() {
  showConfirm('清空全部数据', '⚠️ 此操作不可恢复！所有学习记录、单词、进度都将被清除。确认清空？', function() {
    STATE.materials = []; STATE.wordbooks = []; STATE.words = []; STATE.chapters = {}; STATE.matches = {};
    STATE.progress = {}; STATE.sessions = []; STATE.mastery = {}; STATE.vocab = []; STATE.synonyms = {};
    STATE.answers = []; STATE.reviewQueue = [];
    saveLocal();
    toast('已清空', 'ok');
    refreshAll();
  });
}

// ===== 统一刷新入口（铁律 9）=====
function refreshAll() {
  renderDashboard();
  if (STATE.view === 'materials') renderMaterials();
  if (STATE.view === 'learn') renderLearnInit();
  if (STATE.view === 'test') renderTestInit();
  if (STATE.view === 'review') renderReview();
  if (STATE.view === 'vocab') renderVocab();
  if (STATE.view === 'wrong') renderWrong();
  updateSyncBadge();
}

// ===== 拖拽上传 =====
function setupDragDrop() {
  ['matUploadZone', 'wbUploadZone'].forEach(function(zoneId) {
    var zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', function() { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', function(e) {
      e.preventDefault();
      zone.classList.remove('dragover');
      var files = e.dataTransfer.files;
      var type = zoneId === 'matUploadZone' ? 'material' : 'wordbook';
      handleFileUpload(files, type);
    });
  });
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', function() {
  // 检查已登录用户
  var cur = LS.get('current_user');
  if (cur && cur.profileId) {
    STATE.profileId = cur.profileId;
    STATE.nickname = cur.nick;
    enterApp();
  }
  setupDragDrop();
  // 自动同步状态
  STATE.autoSync = LS.get('autoSync', true);
  var autoSyncEl = document.getElementById('autoSync');
  if (autoSyncEl) autoSyncEl.checked = STATE.autoSync;
});
</script>
</body>
</html>'''

# 替换占位符
html = html.replace('__DB_IDS__', db_ids_json)
html = html.replace('__SAMPLE_TEXT__', json.dumps(sample_text, ensure_ascii=False))
html = html.replace('__SAMPLE_WORDS__', json.dumps(
    [{'lemma':'ceiling','pos':'n.','ipa':'/ˈsiːlɪŋ/','meaning':'天花板','example':'A white ceiling reflected the dim light.','unit':'U1','wordbookId':''},
     {'lemma':'beautiful','pos':'adj.','ipa':'/ˈbjuːtɪfl/','meaning':'美丽的；华美的','example':'The ceiling has a beautiful chandelier.','unit':'U1','wordbookId':''},
     {'lemma':'condition','pos':'n.','ipa':'/kənˈdɪʃn/','meaning':'条件；状况','example':'She responded by condition reflex.','unit':'U1','wordbookId':''},
     {'lemma':'reflect','pos':'v.','ipa':'/rɪˈflekt/','meaning':'反射；反映','example':'Her eyes reflected the fear.','unit':'U1','wordbookId':''},
     {'lemma':'remove','pos':'v.','ipa':'/rɪˈmuːv/','meaning':'移开；调动','example':'She tried to remove her body from danger.','unit':'U1','wordbookId':''},
     {'lemma':'body','pos':'n.','ipa':'/ˈbɒdi/','meaning':'身体；躯体','example':'His body was shaking.','unit':'U1','wordbookId':''},
     {'lemma':'formation','pos':'n.','ipa':'/fɔːˈmeɪʃn/','meaning':'形成；构成','example':'The formation of habits takes time.','unit':'U1','wordbookId':''},
     {'lemma':'instinct','pos':'n.','ipa':'/ˈɪnstɪŋkt/','meaning':'本能；直觉','example':'Trust your instinct.','unit':'U1','wordbookId':''},
     {'lemma':'room','pos':'n.','ipa':'/ruːm/','meaning':'房间；地方','example':'She looked around the room.','unit':'U1','wordbookId':''},
     {'lemma':'internal','pos':'adj.','ipa':'/ɪnˈtɜːnl/','meaning':'体内的；内部的','example':'The internal injury was serious.','unit':'U1','wordbookId':''},
     {'lemma':'react','pos':'v.','ipa':'/riˈækt/','meaning':'反应','example':'She reacted instantly.','unit':'U1','wordbookId':''},
     {'lemma':'inform','pos':'v.','ipa':'/ɪnˈfɔːm/','meaning':'告诉；通知','example':'She informed him of the change.','unit':'U1','wordbookId':''},
     {'lemma':'speak','pos':'v.','ipa':'/spiːk/','meaning':'说话','example':'She spoke softly.','unit':'U1','wordbookId':''},
     {'lemma':'nor','pos':'conj.','ipa':'/nɔːr/','meaning':'也不','example':'She did not cry nor did she smile.','unit':'U1','wordbookId':''},
     {'lemma':'forget','pos':'v.','ipa':'/fəˈɡet/','meaning':'忘记','example':'I will never forget that day.','unit':'U1','wordbookId':''},
     {'lemma':'around','pos':'prep.','ipa':'/əˈraʊnd/','meaning':'四处；周围','example':'She looked around.','unit':'U1','wordbookId':''},
     {'lemma':'onto','pos':'prep.','ipa':'/ˈɒntə/','meaning':'在…之上','example':'The book fell onto the floor.','unit':'U1','wordbookId':''},
     {'lemma':'elapse','pos':'v.','ipa':'/iˈlæps/','meaning':'(时间)流逝','example':'Years had elapsed since they met.','unit':'U1','wordbookId':''}],
    ensure_ascii=False))

output_path = "G:/英语学习工作台/index.html"
with open(output_path, "w", encoding="utf-8") as f:
    f.write(html)

print(f"✅ HTML 已生成: {output_path}")
print(f"   大小: {len(html)} 字符")
print(f"   数据表 ID: {len(db_ids)} 张")
