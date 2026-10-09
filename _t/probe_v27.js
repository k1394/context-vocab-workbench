// 线上 v27 验证：三个问题是否真修好
const { chromium } = require('playwright');
const URL = 'https://workbuddy.link/p/HG6YkFG47Qkbq7y0tBimAI';
const results = [];
function ok(n, c, e) { results.push({n, c: !!c}); console.log((c?'  ✓ ':'  ✗ ')+n+(e!==undefined?'  → '+JSON.stringify(e):'')); }

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  const f = page.frames().find(fr => /index\.html/.test(fr.url()));
  console.log('帧:', f ? f.url() : '(无)');
  await f.waitForFunction(() => typeof STATE !== 'undefined', { timeout: 40000 });

  // 1. 版本
  const v = await f.evaluate(() => ({
    extract: document.documentElement.innerHTML.indexOf('extractContents') >= 0,
    penLooks: typeof penLooksLikeStylus === 'function',
    bodyPos: getComputedStyle(document.body).position
  }));
  console.log('\n=== 版本 ===');
  ok('★ 用 extractContents（不再 surroundContents）', v.extract === true, v);
  ok('★ penLooksLikeStylus 在', v.penLooks === true);
  ok('★ body 是 relative（笔迹画布定位基准）', v.bodyPos === 'relative', v.bodyPos);

  // 2. 造带 word-ins 的场景并划几个字
  await f.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display='none';
    const app = document.getElementById('app'); if (app) app.style.display='block';
    document.getElementById('view-learn').classList.remove('hidden');
    document.getElementById('learnContent').classList.remove('hidden');
    STATE.cloudReady=false; STATE.profileId='v27'; STATE.learnMaterialId='m_t';
    STATE.learnChapterId='c_t'; STATE.learnMode='original';
    STATE.chapters={m_t:[{id:'c_t',title:'T',content:'他喜欢看云霞和晚霞。\n\n第二段内容在这里测试。',targetWords:9}]};
    STATE.matches={m_t:{c_t:[]}}; STATE.progress={m_t:{c_t:{scrollPct:0,mode:'original'}}};
    STATE.notes={}; localStorage.removeItem('notes_v1_v27'); localStorage.removeItem('strokes_v1_v27');
    refreshLearn(true);
  });
  await f.waitForTimeout(800);
  await f.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const text = '他喜欢看云霞和晚霞。';
    const i = text.indexOf('云霞');
    el.innerHTML='';
    el.appendChild(document.createTextNode(text.slice(0,i)));
    const sp=document.createElement('span'); sp.className='word-ins'; sp.textContent='云霞';
    el.appendChild(sp);
    el.appendChild(document.createTextNode(text.slice(i+2)));
    setNoteMode(true);
  });
  await f.waitForTimeout(300);

  const chars = await f.evaluate(() => {
    const sp = document.querySelector('#readingArea .word-ins');
    const n = sp.firstChild;
    const out = [];
    for (let i=0;i<n.nodeValue.length;i++){
      const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+1);
      const rc=r.getBoundingClientRect();
      out.push({x:rc.left,w:rc.width,top:rc.top,h:rc.height});
    }
    return out;
  });
  if (chars.length===2){
    const y = chars[0].top + chars[0].h/2;
    await page.mouse.move(chars[0].x+1, y);
    await page.mouse.down();
    await page.mouse.move(chars[1].x+chars[1].w-1, y, {steps:6});
    await page.mouse.up();
  }
  await f.waitForTimeout(500);
  const r1 = await f.evaluate(() => {
    const el = document.querySelector('#readingArea p[data-pi="0"] .sent[data-si="0"]');
    const mark = el.querySelector('mark.note-hl-inline');
    const wi = el.querySelector('.word-ins');
    const list = chapterNotes('m_t','c_t');
    return {
      hasMark: !!mark, markText: mark?mark.textContent:null,
      sentCls: el.className, wordIns: !!wi, wiText: wi?wi.textContent:null,
      insideMark: mark && wi ? mark.contains(wi) : false,
      ranges: list[0]?list[0].ranges:null
    };
  });
  console.log('\n=== 问题1：只划 2 个字（且都在 word-ins 里）===');
  ok('★ 生成了 <mark>', r1.hasMark===true, r1.markText);
  ok('★ ★ 不再退回整句（是 note-hl-partial）', r1.sentCls.indexOf('note-hl-partial')>=0, r1.sentCls);
  ok('★ ★ mark 正好是划的 2 个字', r1.markText==='云霞', r1.markText);
  ok('★ word-ins 还在（点词看释义没坏）', r1.wordIns===true, r1.wiText);
  ok('★ 范围带字符偏移', r1.ranges && r1.ranges[0].cs!==null, r1.ranges);

  // 3. 荧光笔 + 滚动
  await f.evaluate(() => { STATE.notes={}; renderNoteHighlights(); drawClearAll(); });
  await f.waitForTimeout(200);
  const box = await f.locator('#readingArea p[data-pi="1"]').boundingBox();
  if (box){
    const y=box.y+box.height/2;
    await page.mouse.move(box.x+15,y);
    await page.mouse.down();
    for(let i=1;i<=6;i++) await page.mouse.move(box.x+15+i*28, y-8, {steps:3});
    await page.mouse.up();
  }
  await f.waitForTimeout(400);
  const r2 = await f.evaluate(() => {
    const c=document.getElementById('noteDrawLayer');
    if(!c) return {err:'无canvas'};
    const ctx=c.getContext('2d');
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    let ink=0,minY=1e9,maxA=0,sample=null;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const a=d[(y*c.width+x)*4+3];
      if(a>8){ink++;if(y<minY)minY=y;if(a>maxA){maxA=a;sample=[d[(y*c.width+x)*4],d[(y*c.width+x)*4+1],d[(y*c.width+x)*4+2],a];}}
    }
    return {ink,minY,maxA,sample,pos:getComputedStyle(c).position,cssH:c.style.height};
  });
  console.log('\n=== 问题2：荧光笔痕迹 ===');
  ok('★ canvas 有笔迹像素', r2.ink>100, r2.ink);
  ok('★ ★ 半透明（alpha≈107，不是实心 255）', r2.maxA>60&&r2.maxA<160, r2.maxA);
  ok('★ ★ 暖色荧光笔（红>蓝）', r2.sample&&r2.sample[0]>r2.sample[2], r2.sample);
  ok('★ position=absolute + 覆盖整页', r2.pos==='absolute'&&parseInt(r2.cssH)>900, {pos:r2.pos,h:r2.cssH});

  const r3 = await f.evaluate(async () => {
    const c=document.getElementById('noteDrawLayer');
    const ctx=c.getContext('2d');
    const dpr=window.devicePixelRatio||1;
    function inkViewportY(){
      const d=ctx.getImageData(0,0,c.width,c.height).data;
      for(let vy=0;vy<window.innerHeight;vy+=2){
        const y=Math.floor((vy+window.scrollY)*dpr);
        if(y>=c.height)break;
        for(let x=0;x<c.width;x+=4) if(d[(y*c.width+x)*4+3]>8) return vy;
      }
      return -1;
    }
    const before=inkViewportY();
    window.scrollBy(0,150);
    await new Promise(r=>setTimeout(r,300));
    return {before, after:inkViewportY(), scrollY:window.scrollY};
  });
  console.log('\n=== 问题3：滚动跟随 ===');
  ok('★ 滚动后笔迹跟着内容走（视口位置上移）', r3.scrollY>=150&&r3.after<r3.before&&r3.after>=0, r3);

  // 4. 笔特征识别
  const r4 = await f.evaluate(() => {
    const out={};
    // 真pen
    out.realPen = penLooksLikeStylus({pointerType:'pen',pressure:0.5});
    // 伪装成 touch 的笔（带倾斜角）
    out.touchWithTilt = penLooksLikeStylus({pointerType:'touch',pressure:0.5,tiltX:12,tiltY:8});
    // 变压力的 touch：★ 单点看不出来（手指压力也可能是 0.63），
    //   必须跨事件确认「变过」才认成笔
    penResetPressureTrack();
    out.touchWithPressure = false;
    [0.30, 0.55, 0.80].forEach(function(pr, i){
      const ev = {pointerType:'touch', pressure:pr, tiltX:0, tiltY:0, pointerId:9};
      penTrackPressure(ev);
      if (penLooksLikeStylus(ev)) out.touchWithPressure = true;
    });
    // 纯手指（恒定 0.5 压力、无倾斜）
    out.realFinger = penLooksLikeStylus({pointerType:'touch',pressure:0.5,tiltX:0,tiltY:0});
    // 鼠标不应被当成笔
    out.mouse = penLooksLikeStylus({pointerType:'mouse',pressure:0.5});
    return out;
  });
  console.log('\n=== 问题4：笔特征识别 ===');
  ok('★ 真 pen 认得出', r4.realPen===true);
  ok('★ ★ 报成 touch 但有倾斜角 → 认出是笔', r4.touchWithTilt===true, r4.touchWithTilt);
  ok('★ ★ 报成 touch 但压感变化 → 认出是笔', r4.touchWithPressure===true, r4.touchWithPressure);
  ok('★ ★ 纯手指不误判成笔', r4.realFinger===false, r4.realFinger);
  ok('★ 鼠标不当笔', r4.mouse===false);

  console.log('\n=== 异常 ===', errors.slice(0,2));
  const pass=results.filter(r=>r.c).length;
  console.log('线上 v27：'+pass+'/'+results.length+' 通过');
  await b.close();
})();
