# -*- coding: utf-8 -*-
"""一条命令从 v16 基线构建 index.html（保证产物可复现）。

用法: python build_index.py [--base index.html.bak5] [--out index.html]

链路：v16 基线 --patch_wb_select.py--> 单词书选择/词池/均摊
              --patch_rescue.py--> 数据自检与抢救/删除待办
              --patch_fixes.py--> 对账合并/账号迁移真合并/孤儿保护/配额预检
              --patch_dist.py--> 标注分布（等间隔铺开/签名重算/清旧）+ 章节底部导航
              --patch_dist2.py--> 跳章回到文首 + 「每章目标」全书统一（并推云端）
              --patch_cleanup.py--> 示例数据彻底移除/删除墓碑/多副本删除
              --patch_polish.py--> 阅读进度（真实滚动层）+ 新增标注推云端失败补偿
              --patch_notes.py--> 划线记笔记（句子切分渲染/三端划线/右侧笔记抽屉/云同步）
              --patch_reset.py--> 忘记密码（重设密码入口：改云端账号表的密码哈希）
              --patch_draw.py--> 自由笔迹层（canvas 矢量笔迹/压感/笔尖预测/防手掌误触）
              --patch_perf.py--> 平板卡顿整治（画布只盖一屏/写盘只写变了的 key/切章分帧/pdf 惰性加载）

⚠ 顺序很重要：所有模块都插在同一个锚点之前，所以**后跑的补丁插得更靠后**。
  这里的顺序必须与该补丁在线上发布时的实际执行顺序一致，否则本地产物与线上产物
  会出现「同一段代码位置不同」的假差异，让发布前的 diff 自检失去意义。
  （实际踩过：cleanup 放在 dist 之前 → 每次 diff 都多出 202 行的位移噪音。）
"""
import argparse, io, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable


def run(script, src, dst):
    cmd = [PY, os.path.join(HERE, script), '--input', src, '--output', dst]
    r = subprocess.run(cmd, cwd=HERE, capture_output=True)
    out = (r.stdout or b'').decode('utf-8', 'replace')
    err = (r.stderr or b'').decode('utf-8', 'replace')
    if r.returncode != 0:
        print(out)
        print(err)
        raise SystemExit('%s 失败' % script)
    print('[%s] %s' % (script, out.strip().replace('\n', ' | ')))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=os.path.join(HERE, 'index.html.bak5'))
    ap.add_argument('--out', default=os.path.join(HERE, 'index.html'))
    args = ap.parse_args()

    tmp = os.path.join(HERE, '_t', 'build_step1.html')
    tmp2 = os.path.join(HERE, '_t', 'build_step2.html')
    tmp3 = os.path.join(HERE, '_t', 'build_step3.html')
    tmp4 = os.path.join(HERE, '_t', 'build_step4.html')
    tmp5 = os.path.join(HERE, '_t', 'build_step5.html')
    tmp6 = os.path.join(HERE, '_t', 'build_step6.html')
    tmp7 = os.path.join(HERE, '_t', 'build_step7.html')
    tmp8 = os.path.join(HERE, '_t', 'build_step8.html')
    tmp9 = os.path.join(HERE, '_t', 'build_step9.html')
    tmp10 = os.path.join(HERE, '_t', 'build_step10.html')
    tmp11 = os.path.join(HERE, '_t', 'build_step11.html')
    if not os.path.isdir(os.path.dirname(tmp)):
        os.makedirs(os.path.dirname(tmp))
    run('patch_wb_select.py', args.base, tmp)
    run('patch_rescue.py', tmp, tmp2)
    run('patch_fixes.py', tmp2, tmp3)
    run('patch_dist.py', tmp3, tmp4)
    run('patch_dist2.py', tmp4, tmp5)
    run('patch_cleanup.py', tmp5, tmp6)
    run('patch_polish.py', tmp6, tmp7)
    run('patch_notes.py', tmp7, tmp8)
    run('patch_reset.py', tmp8, tmp9)
    run('patch_rawoff.py', tmp9, tmp10)
    run('patch_draw.py', tmp10, tmp11)
    run('patch_perf.py', tmp11, args.out)

    with io.open(args.out, encoding='utf-8') as f:
        size = len(f.read().encode('utf-8'))
    print('构建完成：%s (%d 字节)' % (args.out, size))


if __name__ == '__main__':
    main()
