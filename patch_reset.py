# -*- coding: utf-8 -*-
"""忘记密码（重设密码入口）

背景：密码只以 SHA-256 哈希保存（本地 + 云端），不可逆，所以「找回原密码」做不到。
能做的是「重设」：拿昵称 + 新密码直接改掉云端账号表那条记录的 密码哈希。

改动清单
  1.  登录表单下面加「忘记密码？」入口 + 重设表单（昵称 / 新密码 / 确认新密码）
  2.  插 reset.js 模块（toggleResetForm / doResetPassword / updateLocalPassHash）

依赖：必须在 patch_notes.py 之后执行（模块插在同一个锚点前，跑得越后插得越靠后）。
"""
import argparse
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load_module(name):
    with io.open(os.path.join(HERE, 'patch_src', name), encoding='utf-8') as f:
        return f.read()


ANCHOR = '/* ===== 内置词书《六级词书》 ===== */'

MODULE = load_module('reset.js')

# ---------- 1. 登录表单后插入「忘记密码」入口 + 重设表单 ----------
LOGIN_OLD = """      <button class="btn btn-primary" style="width:100%" onclick="doLogin()" data-page-node-id="oxTdqcrFEU1qacex3k5GKG">登录</button>
    </div>"""

LOGIN_NEW = """      <button class="btn btn-primary" style="width:100%" onclick="doLogin()" data-page-node-id="oxTdqcrFEU1qacex3k5GKG">登录</button>
      <div style="text-align:center;margin-top:10px"><a href="#" onclick="toggleResetForm();return false" style="color:var(--blue);font-size:13px;text-decoration:none">忘记密码？点这里重设</a></div>
    </div>
    <div id="resetForm" style="display:none">
      <div class="form-group">
        <label>昵称</label>
        <input type="text" id="resetNick" placeholder="你注册时用的昵称" autocomplete="username">
      </div>
      <div class="form-group">
        <label>新密码</label>
        <input type="password" id="resetPass1" placeholder="至少6位" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label>再输一遍新密码</label>
        <input type="password" id="resetPass2" placeholder="再输一遍，防手滑" autocomplete="new-password">
      </div>
      <div class="auth-err" id="resetErr"></div>
      <button class="btn btn-primary" style="width:100%" id="resetBtn" onclick="doResetPassword()">重设密码并登录</button>
      <div style="text-align:center;margin-top:10px"><a href="#" onclick="toggleResetForm();return false" style="color:var(--blue);font-size:13px;text-decoration:none">← 返回登录</a></div>
      <div class="auth-hint" style="margin-top:12px;font-size:12px;line-height:1.7">
        · 密码只以哈希形式保存，<b>原密码找不回来</b>，只能直接改成新的<br>
        · 所以这里只认「昵称」这一项凭据 —— 请不要用昵称相同的他人账号<br>
        · 重设后本机也会同步记住新密码，换设备仍可登录
      </div>
    </div>"""

# ---------- 2. 插模块 ----------
INSERT_OLD = ANCHOR
INSERT_NEW = MODULE + '\n' + ANCHOR


def patch(html):
    n = 0

    old = LOGIN_OLD
    assert html.count(old) == 1, '登录表单锚点不唯一：%d' % html.count(old)
    html = html.replace(old, LOGIN_NEW, 1)
    n += 1

    assert html.count(INSERT_OLD) == 1, '内置词书锚点不唯一：%d' % html.count(INSERT_OLD)
    html = html.replace(INSERT_OLD, INSERT_NEW, 1)
    n += 1

    return html, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    args = ap.parse_args()

    with io.open(args.input, encoding='utf-8') as f:
        html = f.read()
    html, n = patch(html)
    with io.open(args.output, 'w', encoding='utf-8', newline='') as f:
        f.write(html)
    print('patch_reset: %d 处改动' % n)


if __name__ == '__main__':
    main()