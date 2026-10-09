import io

p = '_t/probe_v25.js'
s = io.open(p, encoding='utf-8').read()

old = """  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof STATE !== 'undefined' && typeof drawLoad === 'function', { timeout: 40000 });
  await f.evaluate("""
new = """  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  // 刷新后 iframe 会换新，旧的 f 引用全部失效，必须重新取一次
  const f2 = page.frames().find(fr => /index\\.html/.test(fr.url()));
  if (!f2) { console.log('刷新后没找到帧'); await browser.close(); return; }
  await f2.waitForFunction(() => typeof STATE !== 'undefined' && typeof drawLoad === 'function', { timeout: 40000 });
  await f2.evaluate("""
assert s.count(old) == 1, 'reload 段锚点不唯一: %d' % s.count(old)
s = s.replace(old, new, 1)

idx = s.index('const f2 = page.frames()')
head, tail = s[:idx], s[idx:]
tail = tail.replace('await f.evaluate(', 'await f2.evaluate(')
s = head + tail

io.open(p, 'w', encoding='utf-8').write(s)
print('patched, f2 refs =', s.count('f2.evaluate'))