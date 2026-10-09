# -*- coding: utf-8 -*-
"""划线偏移坐标系：给正文里的「释义插入物」打标记（data-gloss / data-raw-len）

要解决的问题（真实事故）
  正文渲染时，被标注的中文词会变成「一个 （single） 游牧民族 （folk）…」，
  于是同一段里 DOM 文本长度 ≠ 原文长度。
  划线定位如果「量位置」按 DOM 算、「用位置」按原文算，二者相差的
  正好是这段插入物的长度 → 该句之后的所有字整体右移。
  用户划「那里的男儿个个都是热血」(11 个字)，存成 28..39，
  高亮整段跑到句尾：「，他们的王朝叫做青阳。」——用户看到的就是
  「不是说精确到 11 字吗？为什么笔记还是一整句？」

改法
  字符偏移只认一个坐标系：**段落原文**（ch.content 按 \\n\\n 切出来的那串）。
  渲染时给插入物打两种标记，之后 DOM ↔ 原文的换算就有依据了：
    data-gloss="1"    这段 DOM 文本不属于原文（英文/括号/音标/释义/挖空框）
    data-raw-len="N"  这段在 DOM 里看不见，但原文里占 N 个字（填中文模式的挖空框）
  没有标记的节点一律当原文 —— 原文版（不做标注）天然正确。
  换算逻辑在 patch_src/charrange.js 的 rawOffsetOfPoint / buildRawTextMap。

改动清单（三处 insertHtml）
  1. meaning ：中文（英文 音标 释义）里的「（英文 音标 释义）」整段包一层 data-gloss
  2. blank   ：blank-box 打 data-gloss（里面 reveal 出来的 .blank-answer 不算原文）
  3. blankZh ：挖空框打 data-gloss + data-raw-len=chWord.length；后面的「（英文）」打 data-gloss
"""
import argparse
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def patch(html):
    n = 0

    # ---------- 1. meaning：括号 + 英文/音标/释义 整段是插入物 ----------
    MEANING_OLD = ("        insertHtml = '<span class=\"word-zh\">' + escapeHTML(chWord) + "
                   "'</span>' + (parts.length ? '<span class=\"bracket\">（</span>' + "
                   "parts.join(' ') + '<span class=\"bracket\">）</span>' : '');")
    MEANING_NEW = (
        "        // ★ data-gloss：这一段是「插入物」，不属于原文。\n"
        "        //   划线定位靠它把 DOM 偏移换算回原文偏移；少打一处，\n"
        "        //   该句之后的所有字就会整体错位（真实事故，见 patch_rawoff.py 头部）。\n"
        "        insertHtml = '<span class=\"word-zh\">' + escapeHTML(chWord) + "
        "'</span>' + (parts.length ? '<span data-gloss=\"1\"><span class=\"bracket\">（</span>' + "
        "parts.join(' ') + '<span class=\"bracket\">）</span></span>' : '');")
    assert html.count(MEANING_OLD) == 1, '释义版 insertHtml 锚点不唯一：%d' % html.count(MEANING_OLD)
    html = html.replace(MEANING_OLD, MEANING_NEW, 1)
    n += 1

    # ---------- 2. blank：挖空框本身是插入物（框里 reveal 的答案不算原文）----------
    BLANK_OLD = ("        insertHtml = '<span class=\"blank-box\" data-lemma=\"' + escapeHTML(lemma) + "
                 "'\"><input type=\"text\" placeholder=\"?\" onblur=\"checkBlank(this,\\'' + "
                 "escapeHTML(lemma) + '\\')\"></span>' + escapeHTML(chWord);")
    BLANK_NEW = ("        // ★ blank-box 里的 .blank-answer（填错时 reveal 出来的英文）不是原文\n"
                 "        insertHtml = '<span class=\"blank-box\" data-gloss=\"1\" data-lemma=\"' + "
                 "escapeHTML(lemma) + '\"><input type=\"text\" placeholder=\"?\" onblur=\"checkBlank(this,\\'' + "
                 "escapeHTML(lemma) + '\\')\"></span>' + escapeHTML(chWord);")
    assert html.count(BLANK_OLD) == 1, '填英文 insertHtml 锚点不唯一：%d' % html.count(BLANK_OLD)
    html = html.replace(BLANK_OLD, BLANK_NEW, 1)
    n += 1

    # ---------- 3. blankZh：中文词被藏进 input，但原文里占 chWord.length 个字 ----------
    BLANKZH_OLD = ("        insertHtml = '<span class=\"zh-blank-box\" data-answer=\"' + "
                   "escapeHTML(chWord) + '\"><input type=\"text\" placeholder=\"?\" "
                   "onblur=\"checkBlankZh(this,\\'' + escapeHTML(chWord) + '\\')\"></span>"
                   "（<span class=\"word-ins\" onclick=\"openWordCard(\\'' + escapeHTML(lemma) + "
                   "'\\')\">' + escapeHTML(dispWord) + '</span>）';")
    BLANKZH_NEW = (
        "        // ★ 挖空框把中文词藏进 input：DOM 里看不见它，但原文里它占 chWord.length 个字\n"
        "        //   → data-raw-len 把它补回原文坐标（否则这一段之后整体偏 chWord.length 个字）\n"
        "        insertHtml = '<span class=\"zh-blank-box\" data-gloss=\"1\" data-raw-len=\"' + "
        "chWord.length + '\" data-answer=\"' + escapeHTML(chWord) + '\"><input type=\"text\" "
        "placeholder=\"?\" onblur=\"checkBlankZh(this,\\'' + escapeHTML(chWord) + '\\')\"></span>' + "
        "'<span data-gloss=\"1\">（<span class=\"word-ins\" onclick=\"openWordCard(\\'' + "
        "escapeHTML(lemma) + '\\')\">' + escapeHTML(dispWord) + '</span>）</span>';")
    assert html.count(BLANKZH_OLD) == 1, '填中文 insertHtml 锚点不唯一：%d' % html.count(BLANKZH_OLD)
    html = html.replace(BLANKZH_OLD, BLANKZH_NEW, 1)
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
    print('patch_rawoff: %d 处改动' % n)


if __name__ == '__main__':
    main()
