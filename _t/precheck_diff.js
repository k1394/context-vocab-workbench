// 发布前双向 diff 自检
// 判据：B≡C 证明补丁一致，A≡D 证明平台改写一致；D 里出现 insert/delete 就是有非平台差异
const fs = require('fs');
const path = require('path');

const DIR = 'G:/英语学习工作台';
const A_DIR = path.join(DIR, '_artifacts');
const T = path.join(DIR, '_t');

// 用 difflib 做块级比对
const { execFileSync } = require('child_process');
function cmpBlocks(oldF, newF) {
  const py = 'C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe';
  const script = path.join(T, 'diff_blocks.py');
  return execFileSync(py, [script, oldF, newF], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const onV22 = path.join(A_DIR, 'index_v22_online_check.html');   // 线上 v22（平台改写后）
const preNotes = path.join(A_DIR, 'index_v22_local_before_notes.html'); // 本地 v22（发布前）
const nowLocal = path.join(DIR, 'index.html');                   // 本地 v23 候选

console.log('--- A 本地v22 vs 线上v22（应只见平台改写） ---');
console.log(cmpBlocks(preNotes, onV22).trim());
console.log('--- B 线上v22 vs 线上v23（先占位） ---');
console.log('--- C 本地v22 vs 本地v23（本轮补丁） ---');
console.log(cmpBlocks(preNotes, nowLocal).trim());