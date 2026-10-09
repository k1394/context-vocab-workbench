# -*- coding: utf-8 -*-
"""生成不同页数的中文文字型 PDF，用于探测「PDF 到底能导入多大」的真实边界。
每页约 700 个中文字符（接近一页正文的排版密度）。"""
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

SENT = ('她仰头看着天花板，那个美丽的角落始终无法忘记，'
        '房间的状况比想象中更糟，需要先把旧家具搬走。'
        '本能告诉她这些东西不能再留，内部的空间比外面看起来小得多。')

def build(path, pages, lines_per_page=22):
    c = canvas.Canvas(path, pagesize=A4)
    for i in range(pages):
        c.setFont(FONT, 11)
        y = H - 70
        for j in range(lines_per_page):
            c.drawString(50, y, SENT[:60])
            y -= 26
        c.setFont('Helvetica', 9)
        c.drawString(300, 40, str(i + 1))   # 页脚页码
        c.showPage()
    c.save()
    chars = 60 * lines_per_page * pages
    print('%-22s %4d 页  %8.2f MB  约 %6d 字' % (
        os.path.basename(path), pages, os.path.getsize(path) / 1048576.0, chars))

for pages in (50, 150, 400, 900):
    build(os.path.join(OUT, 'size_%d.pdf' % pages), pages)
