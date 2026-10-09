// 定位 NaN 坐标来源
const fs = require('fs');
const vm = require('vm');
const HTML = fs.readFileSync('G:/英语学习工作台/index.html', 'utf8');

const ps = HTML.indexOf("var PEN_POINTER_TYPE = 'pen';");
const ds = HTML.indexOf("var STROKE_KEY = 'strokes_v1_';");
const me = HTML.indexOf('/* ===== 内置词书《六级词书》 ===== */');
console.log('索引:', ps, ds, me);

const FAKE = {};
function mkCtx() {
  return {
    save() { }, restore() { }, beginPath() { }, moveTo() { }, lineTo() { },
    closePath() { }, fill() { }, arc() { }, clearRect() { }, setTransform() { }
  };
}
const s = {
  console: console, Math: Math, Date: Date, JSON: JSON,
  parseFloat: parseFloat, parseInt: parseInt, isNaN: isNaN,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  LS: { get: (k, d) => d, set: () => { } },
  STATE: { profileId: 'p1', learnMaterialId: 'm1', learnChapterId: 'c1' },
  document: {
    documentElement: { clientWidth: 800, clientHeight: 600 },
    getElementById(id) {
      if (FAKE[id]) return FAKE[id];
      if (id === 'readingArea') {
        return { parentElement: { insertBefore: e => { FAKE[e.id] = e; } } };
      }
      return null;
    },
    addEventListener() { },
    body: { classList: { add() { }, remove() { } } },
    createElement() {
      return {
        id: '', getContext: mkCtx,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        setAttribute() { }, style: {}, classList: { add() { } }, width: 0, height: 0
      };
    }
  },
  window: { devicePixelRatio: 1, addEventListener() { } },
  devicePixelRatio: 1,
  renderNotePanel() { }, toast() { }
};
s.globalThis = s;

const c = vm.createContext(s);
try { vm.runInContext(HTML.slice(ps, ds), c); } catch (e) { console.log('PEN 加载失败:', e.stack); }
try { vm.runInContext(HTML.slice(ds, me), c); } catch (e) { console.log('DRAW 加载失败:', e.stack); }

console.log('drawScale =', JSON.stringify(c.drawScale()));
console.log('drawToNorm(100,120) =', JSON.stringify(c.drawToNorm(100, 120)));
console.log('drawToNorm(130,130) =', JSON.stringify(c.drawToNorm(130, 130)));

const id = c.drawStrokeStart({ clientX: 100, clientY: 100, pressure: 0.5, pointerType: 'pen' }, 'pen');
console.log('strokeId =', id);
console.log('_LIVE 起始 raw =', JSON.stringify(c._LIVE && c._LIVE.raw));
c.drawStrokeExtend(id, [{ clientX: 130, clientY: 130, pressure: 0.4 }], 130, 130);
console.log('extend 后 raw =', JSON.stringify(c._LIVE && c._LIVE.raw));
const rec = c.drawStrokeEnd(id, {});
console.log('rec =', JSON.stringify(rec));