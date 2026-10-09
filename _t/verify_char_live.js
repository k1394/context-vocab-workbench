// 浏览器端验证：字符级划线（只划前 8 个字）+ 荧光笔风格 + 滚动跟随
// 全程 offline
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8933/index.html';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
function group(t) { console.log('\n' + t); }

// 真实段落（第一句 24 个字）
const P1 = '夜幕低垂，鬼火狐鸣，凉飕飕的冷风一直往山洞里灌。他缓缓站起身来。';
const P2 = '山洞入口处有一浅绿色锦衣青年盘膝而坐，外面阴风阵阵，宽大的袖子都被吹得发出了声音。';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });
  await page.evaluate(([p1, p2]) => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    const vl = document.getElementById('view-learn'); if (vl) vl.classList.remove('hidden');
    const lc = document.getElementById('learnContent'); if (lc) lc.classList.remove('hidden');
    STATE.cloudReady = false;
    STATE.profileId = 'verify_char';
    STATE.learnMaterialId = 'm_t';
    STATE.learnChapterId = 'c_t';
    STATE.learnMode = 'original';
    STATE.chapters = { m_t: [{ id: 'c_t', title: '测试', content: [p1, p2].join('\n\n'), targetWords: 10 }] };
    STATE.matches = { m_t: { c_t: [] } };
    STATE.progress = { m_t: { c_t: { scrollPct: 0, mode: 'original' } } };
    STATE.notes = {};
    localStorage.removeItem('strokes_v1_verify_char');
    localStorage.removeItem('notes_v1_verify_char');
    refreshLearn(true);
  }, [P1, P2]);
  await page.waitForTimeout(800);

  // ---------- 一、句子结构 ----------
  group('一、页面渲染结构');
  const struct = await page.evaluate(() => {
    const area = document.getElementById('readingArea');
    const s0 = area.querySelector('p[data-pi="0"] .sent[data-si="0"]');
    return {
      paras: area.querySelectorAll('p[data-pi]').length,
      sents: area.querySelectorAll('.sent[data-si]').length,
      sent0Text: s0 ? s0.textContent.trim() : null,
      sent0Len: s0 ? s0.textContent.length : 0
    };
  });
  ok('2 个段落', struct.paras === 2, struct.paras);
  ok('第1段第1句是 24 字那句', struct.sent0Text.indexOf('夜幕低垂') === 0 && struct.sent0Len === 24, struct);

  // ---------- 二、只划前 8 个字 ----------
  group('二、★ 只划前 8 个字 → 只高亮那 8 个字');
  const box = await page.locator('#readingArea p[data-pi="0"] .sent[data-si="0"]').boundingBox();
  ok('第1句能取到屏幕坐标', !!box, box);
  // 用 getClientRects 拿到每个字的横向位置，从第 1 个字划到第 8 个字
  const charRects = await page.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const text = el.textContent;
    // 用 Range 逐字量位置
    const node = el.firstChild;
    const out = [];
    for (let i = 0; i < 9; i++) {
      let r;
      try {
        r = document.createRange();
        r.setStart(node, i); r.setEnd(node, i + 1);
      } catch (e) { break; }
      const rc = r.getBoundingClientRect();
      out.push({ i: i, ch: text.charAt(i), x: rc.left, y: rc.top, w: rc.width, h: rc.height });
    }
    return { rects: out, textLen: text.length, isTextNode: node && node.nodeType === 3 };
  });
  ok('★ 能逐字量到位置（句子内是纯文本）', charRects.isTextNode === true, charRects);
  ok('★ 量到前 9 个字', charRects.rects.length === 9, charRects.rects.length);

  if (charRects.rects.length >= 9) {
    const r0 = charRects.rects[0], r7 = charRects.rects[7];
    const y = r0.y + r0.h / 2;
    // 划：第 1 个字左端 → 第 8 个字右端
    await page.mouse.move(r0.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(r7.x + r7.w - 1, y, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const list = chapterNotes('m_t', 'c_t');
    const n = list[0];
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const mark = el ? el.querySelector('mark.note-hl-inline') : null;
    return {
      notes: list.length,
      ranges: n ? n.ranges : null,
      text: n ? n.text : null,
      hasMark: !!mark,
      markText: mark ? mark.textContent : null,
      sentCls: el ? el.className : null,
      sentFullHl: el ? el.classList.contains('note-hl') : null
    };
  });
  ok('★ 产生 1 条笔记', after.notes === 1, after.notes);
  ok('★ 范围带字符偏移 cs/ce', after.ranges && after.ranges[0].cs !== null && after.ranges[0].cs !== undefined,
    after.ranges);
  ok('★ ★ cs ≈ 0（从第 1 个字开始）', after.ranges && after.ranges[0].cs <= 1, after.ranges && after.ranges[0].cs);
  ok('★ ★ ce ≈ 8（只到第 8 个字，不是整句 24）',
    after.ranges && after.ranges[0].ce >= 7 && after.ranges[0].ce <= 9, after.ranges && after.ranges[0].ce);
  ok('★ ★ 高亮是 <mark>（句内切片），不是整句 class', after.hasMark === true, after.sentCls);
  ok('★ ★ mark 里只有约 8 个字（不是整句 24）',
    after.markText && after.markText.length <= 10 && after.markText.length >= 6,
    { len: after.markText && after.markText.length, text: after.markText });
  ok('★ 句 span 没有被整句标 note-hl', after.sentFullHl === false, after.sentCls);
  ok('★ 笔记内容是那句话（可搜索）',
    after.text && after.text.indexOf('夜幕低垂') >= 0, after.text);

  // 视觉：高亮不能盖住整句
  const visual = await page.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const mark = el.querySelector('mark.note-hl-inline');
    const mr = mark.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return {
      markW: Math.round(mr.width), sentW: Math.round(er.width),
      ratio: Math.round((mr.width / er.width) * 100)
    };
  });
  ok('★ ★ 高亮宽度只有句子的约三分之一（不是整句）',
    visual.ratio > 15 && visual.ratio < 55, visual);

  // ---------- 三、重划 / 清除不残留 ----------
  group('三、重复渲染不残留（旧 <mark> 会被清掉）');
  const noResidue = await page.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    // 连续重渲染 3 次
    for (let i = 0; i < 3; i++) renderNoteHighlights();
    return {
      marks: el.querySelectorAll('mark.note-hl-inline').length,
      text: el.textContent.length
    };
  });
  ok('★ ★ 重渲染 3 次仍只有 1 个 mark（不套娃）', noResidue.marks === 1, noResidue);
  ok('★ 句子文本长度没变（mark 被拆回文本了）', noResidue.text === struct.sent0Len,
    { now: noResidue.text, before: struct.sent0Len });

  // ---------- 四、荧光笔风格 ----------
  group('四、荧光笔风格（不要黑线）');
  const style = await page.evaluate(() => {
    const s = drawGetStyle();
    const el = document.getElementById('noteDrawLayer');
    const cs = el ? getComputedStyle(el) : null;
    return {
      color: s.color, width: s.width, alpha: s.alpha,
      pos: cs ? cs.position : null
    };
  });
  ok('★ 默认色是琥珀荧光笔', style.color === '#F5C76A', style.color);
  ok('★ ★ 半透明 0.42（不是实心黑线）', style.alpha < 0.6, style.alpha);
  ok('★ 宽度是荧光笔级（6.5）', style.width >= 5, style.width);
  ok('★ ★ canvas 是 absolute（不是 fixed，否则笔迹钉在屏幕上）', style.pos === 'absolute', style.pos);

  // 画一笔，看实际像素颜色是不是黑线
  await page.evaluate(() => { setNoteMode(true); drawClearAll(); STATE.notes = {}; renderNoteHighlights(); });
  await page.waitForTimeout(300);
  const box2 = await page.locator('#readingArea p[data-pi="1"] .sent[data-si="0"]').boundingBox();
  if (box2) {
    const y = box2.y + box2.height / 2;
    await page.mouse.move(box2.x + 10, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(box2.x + 10 + i * 25, y, { steps: 3 });
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  const pixels = await page.evaluate(() => {
    const el = document.getElementById('noteDrawLayer');
    const c = el.getContext('2d');
    const d = c.getImageData(0, 0, el.width, el.height).data;
    let n = 0, maxA = 0, sample = null;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 8) {
        n++;
        if (d[i + 3] > maxA) { maxA = d[i + 3]; sample = [d[i], d[i + 1], d[i + 2], d[i + 3]]; }
      }
    }
    return { nonTransparent: n, maxAlpha: maxA, sample: sample };
  });
  ok('★ canvas 上有笔迹', pixels.nonTransparent > 100, pixels.nonTransparent);
  ok('★ ★ 最大 alpha 约等于 0.42×255≈107（半透明，不是实心 255）',
    pixels.maxAlpha > 60 && pixels.maxAlpha < 160, pixels.maxAlpha);
  ok('★ ★ 颜色是暖色（红>蓝），不是黑线', pixels.sample && (pixels.sample[0] > pixels.sample[2]),
    pixels.sample);

  // ---------- 五、★ 滚动跟随（黑线钉住的根因）----------
  group('五、★ 滚动后笔迹跟着内容走（不再钉在屏幕上）');
  const scrollTest = await page.evaluate(() => {
    const el = document.getElementById('noteDrawLayer');
    const c = el.getContext('2d');
    function rowWithInk() {
      const d = c.getImageData(0, 0, el.width, el.height).data;
      for (let y = 0; y < el.height; y++) {
        let hit = 0;
        for (let x = 0; x < el.width; x += 4) {
          if (d[(y * el.width + x) * 4 + 3] > 8) hit++;
        }
        if (hit > 3) return y;
      }
      return -1;
    }
    return {
      docH: el.height, styleH: el.style.height, inkYBefore: rowWithInk(),
      w: el.width, h: el.height, viewH: window.innerHeight, top: el.style.top, scrollY: window.scrollY
    };
  });
  // ★ v31 起画布只盖一屏（原来是铺满整章）。铺满整章 = 2048×20332 ≈ 4160 万像素，
  //   既超过 iPad Safari 单画布上限（16,777,216 px），又让每次滚动 clearRect 变成灾难
  //   （实测同一段滚动 60 次长任务 / 累计卡 12 秒）。所以这里的断言跟着翻转。
  ok('★ canvas 只盖一屏（不再是整章高度）',
    Math.abs(parseInt(scrollTest.styleH) - scrollTest.viewH) <= 2,
    { styleH: scrollTest.styleH, viewH: scrollTest.viewH });
  ok('★ canvas 面积落回 iPad 单画布上限内（16,777,216 px）',
    scrollTest.w * scrollTest.h <= 16777216, scrollTest.w * scrollTest.h);
  ok('★ canvas 用 top=scrollY 贴在当前这一屏上（滚动天然跟随）',
    Math.abs(parseInt(scrollTest.top || '0') - scrollTest.scrollY) <= 2,
    { top: scrollTest.top, scrollY: scrollTest.scrollY });
  ok('★ 笔迹当前在文档第几行能找到', scrollTest.inkYBefore > 0, scrollTest.inkYBefore);

  // 滚一段，看笔迹在文档坐标里不动（视口里会跟着往上走）
  const scrollMove = await page.evaluate(async () => {
    const el = document.getElementById('noteDrawLayer');
    const c = el.getContext('2d');
    function firstInkViewportY() {
      const dpr = window.devicePixelRatio || 1;
      const d = c.getImageData(0, 0, el.width, el.height).data;
      // 换算成视口坐标再找
      for (let vy = 0; vy < window.innerHeight; vy += 2) {
        const y = Math.floor((vy + window.scrollY) * dpr);
        if (y >= el.height) break;
        for (let x = 0; x < el.width; x += 4) {
          if (d[(y * el.width + x) * 4 + 3] > 8) return vy;
        }
      }
      return -1;
    }
    const before = firstInkViewportY();
    window.scrollBy(0, 200);
    await new Promise(r => setTimeout(r, 300));
    const after = firstInkViewportY();
    return { before, after, scrollY: window.scrollY };
  });
  ok('★ 滚动后视口位置随之上移（笔迹跟着内容走）',
    scrollMove.scrollY >= 200 && scrollMove.after < scrollMove.before && scrollMove.after >= 0,
    scrollMove);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  // ---------- 六、整句划线仍正常（旧行为不能坏）----------
  group('六、整句划线仍然整句高亮（旧行为不能坏）');
  const wholeTest = await page.evaluate(() => {
    STATE.notes = {};
    renderNoteHighlights();
    const list = chapterNotes('m_t', 'c_t');
    return list.length;
  });
  ok('清空后 0 条', wholeTest === 0, wholeTest);

  const box3 = await page.locator('#readingArea p[data-pi="0"] .sent[data-si="1"]').boundingBox();
  if (box3) {
    const y = box3.y + box3.height / 2;
    await page.mouse.move(box3.x + 5, y);
    await page.mouse.down();
    await page.mouse.move(box3.x + box3.width - 5, y, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  const whole = await page.evaluate(() => {
    const list = chapterNotes('m_t', 'c_t');
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="1"]');
    const n = list[0];
    return {
      notes: list.length,
      fullHl: el ? el.classList.contains('note-hl') : null,
      hasMark: el ? !!el.querySelector('mark.note-hl-inline') : null,
      cs: n && n.ranges ? n.ranges[0].cs : null,
      ce: n && n.ranges ? n.ranges[0].ce : undefined,
      text: n ? n.text : null
    };
  });
  ok('整句划线产生笔记', whole.notes === 1, whole.notes);
  ok('★ 划整句时走整句高亮（note-hl class）', whole.fullHl === true, whole.fullHl);
  // 第2句「他缓缓站起身来。」只有 8 个字，拖到接近右边缘
  ok('★ 划满整句时 ce 到达句尾（≈句长 8）',
    whole.cs === 0 && whole.ce >= 7, { cs: whole.cs, ce: whole.ce, sentLen: 8 });
  ok('★ 高亮宽度等于整句宽度（100%，不是切了一半）',
    await page.evaluate(() => {
      const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="1"]');
      return el.classList.contains('note-hl') && !el.querySelector('mark');
    }) === true);

  group('七、★ 句子里有点词标记（word-ins）时也能精确到字');
  // 这是 v26 的真 bug：正文里几乎每句都有 .word-ins（点词看释义），
  // 而当时为了「保护交互元素」会退回整句高亮 → 用户划 7 个字却看到整句。
  const withWordIns = await page.evaluate(() => {
    // 用一句干净的话重造，并确保目标词存在
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const text = '他喜欢看云霞和晚霞';
    const i = text.indexOf('云霞');
    el.innerHTML = '';
    el.appendChild(document.createTextNode(text.slice(0, i)));
    const sp = document.createElement('span');
    sp.className = 'word-ins';
    sp.textContent = text.slice(i, i + 2);
    el.appendChild(sp);
    el.appendChild(document.createTextNode(text.slice(i + 2)));
    return { text: el.textContent, hasWordIns: !!el.querySelector('.word-ins') };
  });
  ok('造出带 word-ins 的句子', withWordIns.hasWordIns === true, withWordIns);

  // 划「云霞」这两个字（在 word-ins 内部）
  const insChars = await page.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const sp = el.querySelector('.word-ins');
    const out = [];
    const walker = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT);
    const n = walker.nextNode();
    for (let i = 0; i < n.nodeValue.length; i++) {
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + 1);
      const rc = r.getBoundingClientRect();
      out.push({ ch: n.nodeValue.charAt(i), x: rc.left, w: rc.width, top: rc.top, h: rc.height });
    }
    return out;
  });
  ok('量到 word-ins 里的 2 个字', insChars.length === 2, insChars);

  if (insChars.length === 2) {
    const c0 = insChars[0], c1 = insChars[1];
    const y = c0.top + c0.h / 2;
    await page.mouse.move(c0.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(c1.x + c1.w - 1, y, { steps: 6 });
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  const insRes = await page.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const mark = el.querySelector('mark.note-hl-inline');
    const wordIns = el.querySelector('.word-ins');
    return {
      hasMark: !!mark,
      markText: mark ? mark.textContent : null,
      sentCls: el.className,
      // ★ 关键：word-ins 必须还在（没被 innerHTML 冲掉）
      wordInsStillThere: !!wordIns,
      wordInsText: wordIns ? wordIns.textContent : null,
      // mark 应该包住 word-ins 或在它内部
      markWrapsWordIns: mark ? (mark.querySelector('.word-ins') !== null || wordIns && mark.contains(wordIns)) : false
    };
  });
  ok('★ 句内有 word-ins 时仍然生成 <mark>', insRes.hasMark === true, insRes);
  ok('★ ★ 退回整句的 bug 已修（不再只有 note-hl class）',
    insRes.sentCls.indexOf('note-hl-partial') >= 0 && insRes.sentCls.indexOf('note-hl ') < 0, insRes.sentCls);
  ok('★ ★ word-ins 元素还在（点词看释义没被破坏）', insRes.wordInsStillThere === true, insRes.wordInsText);
  ok('★ mark 内容和划的字一致', insRes.markText && insRes.markText.length <= 3, insRes.markText);

  group('八、运行期异常');
  ok('★ 无未捕获异常', errors.length === 0, errors);

  const pass = results.filter(r => r.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log('字符级划线验证：' + pass + '/' + results.length + ' 通过');
  const failed = results.filter(r => !r.pass);
  if (failed.length) { console.log('失败项：'); failed.forEach(r => console.log('  ✗ ' + r.name)); }
  await browser.close();
})();