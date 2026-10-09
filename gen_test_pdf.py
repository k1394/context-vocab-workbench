# -*- coding: utf-8 -*-
"""生成三个真实 PDF，用于验证工作台的 PDF 导入链路。
1) test_material.pdf  中文正文型资料（CID 字体，最难的场景）
2) test_wordbook.pdf  中文词表型单词书
3) test_scanned.pdf   纯图形、无文字层（模拟扫描件）
"""
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'testdata')
os.makedirs(OUT, exist_ok=True)

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
FONT = 'STSong-Light'
W, H = A4

MATERIAL_PAGES = [
    [
        '第一章  清晨的光',
        '天花板在晨光里显得格外干净，她仰头看了很久。',
        '那个美丽的角落一直放着一只旧木箱，她始终无法忘记。',
        '房间里的状况比想象中更糟，需要先把旧家具搬走。',
        '她决定在今天之内整理完，然后通知房东来看房。',
        '窗外的光反射在地板上，形成一片温暖的光斑。',
    ],
    [
        '第二章  旧物',
        '本能告诉她，这些东西不能再留了。',
        '内部的空间比外面看起来要小得多，堆放得很挤。',
        '她伸手去拿那本书，指尖触到一层薄薄的灰。',
        '时间一点点流逝，她终于把最后一个箱子封好。',
        '她打算把这件事告诉母亲，让她不必再担心。',
    ],
    [
        '第三章  离开',
        '身体很累，但心里是轻松的。',
        '她绕着房间走了一圈，最后看了一眼天花板。',
        '条件已经谈妥，剩下的只是把钥匙交出去。',
        '她提醒自己，不要忘记带上那封信。',
        '门在身后关上，声音很轻。',
    ],
]

WORDBOOK_PAGES = [
    [
        'ceiling        n.  天花板',
        'beautiful      adj.  美丽的',
        'condition      n.  状况；条件',
        'reflect        v.  反射；反映',
        'remove         v.  移开；搬走',
        'body           n.  身体；主体',
    ],
    [
        'formation      n.  形成；构成',
        'instinct       n.  本能；直觉',
        'room           n.  房间；空间',
        'internal       adj.  内部的',
        'react          v.  反应',
        'inform         v.  通知；告知',
        'elapse         v.  流逝',
    ],
]


def build_material(path):
    c = canvas.Canvas(path, pagesize=A4)
    for i, lines in enumerate(MATERIAL_PAGES):
        c.setFont(FONT, 12)
        y = H - 80
        for ln in lines:
            c.drawString(60, y, ln)
            y -= 24
        c.setFont('Helvetica', 9)
        c.drawString(300, 40, str(i + 1))   # 页脚页码，用于验证页码清洗
        c.showPage()
    c.save()


def build_wordbook(path):
    c = canvas.Canvas(path, pagesize=A4)
    for i, lines in enumerate(WORDBOOK_PAGES):
        c.setFont(FONT, 12)
        y = H - 80
        for ln in lines:
            c.drawString(60, y, ln)
            y -= 24
        c.setFont('Helvetica', 9)
        c.drawString(300, 40, str(i + 1))
        c.showPage()
    c.save()


def build_scanned(path):
    c = canvas.Canvas(path, pagesize=A4)
    for i in range(2):
        # 只画图形，不写任何文字 → 无文字层的“扫描件”
        c.setFillGray(0.85)
        c.rect(60, 200, 480, 500, stroke=0, fill=1)
        c.setFillGray(0.4)
        c.rect(80, 640, 300, 24, stroke=0, fill=1)
        c.rect(80, 600, 420, 12, stroke=0, fill=1)
        c.rect(80, 570, 380, 12, stroke=0, fill=1)
        c.showPage()
    c.save()


for name, fn in (('test_material.pdf', build_material),
                 ('test_wordbook.pdf', build_wordbook),
                 ('test_scanned.pdf', build_scanned)):
    p = os.path.join(OUT, name)
    fn(p)
    print('%-20s %8d bytes' % (name, os.path.getsize(p)))
