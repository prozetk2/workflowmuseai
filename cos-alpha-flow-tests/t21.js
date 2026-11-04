// 1.8.2: running one node asks before it also runs the unfinished image/video nodes it depends on.
// "Cancel" runs that node only; "OK" runs the missing ones first.
const { chromium } = require('playwright');
const fs = require('fs');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow-direct.html', 'utf8');
const MP4 = fs.readFileSync(__dirname + '/v.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  await ctx.route('https://flow.google.com/**', route => {
    const url = route.request().url();
    if (/\/media\/img\d+\.png/.test(url)) return route.fulfill({ contentType: 'image/png', body: png(180, 320, [40, 200, 90]) });
    if (/\/media\/clip\d+\.mp4/.test(url)) return route.fulfill({ contentType: 'video/mp4', body: MP4 });
    return route.fulfill({ contentType: 'text/html', body: FAKE });
  });
  const errors = [];
  const flow = await ctx.newPage(); flow.on('pageerror', e => errors.push('flow:' + e.message));
  await flow.goto('https://flow.google.com/project/abc'); await flow.waitForTimeout(1000);
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('app:' + e.message));
  let answer = false; const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await page.goto(`chrome-extension://${id}/app.html`); await page.waitForTimeout(800);
  await page.click('#closeWelcomeBtn').catch(() => {});
  const ids = await page.evaluate(() => {
    const A = window.__cosAlphaApp, s = A.state; s.settings.provider = 'flow'; s.nodes = s.nodes.filter(n => n.type === 'timeline'); s.edges.length = 0;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const e = (a, ap, b, bp) => s.edges.push({ id: A.uid('edge'), source: a.id, sourcePort: ap, target: b.id, targetPort: bp });
    const p1 = mk('prompt', { text: 'a red fox portrait' }, 0, 0), img = mk('generateImage', { size: '9:16' }, 300, 0); e(p1, 'text', img, 'prompt');
    const p2 = mk('prompt', { text: 'the fox walks' }, 0, 300), vid = mk('generateVideo', { size: '9:16', duration: 8 }, 600, 0); e(p2, 'text', vid, 'prompt'); e(img, 'image', vid, 'reference');
    A.render(); return { img: img.id, vid: vid.id };
  });
  const runVideo = async () => {
    await page.evaluate(id => { void window.__cosAlphaApp.executeGenerationNode(id); }, ids.vid);
    await page.waitForTimeout(500);
    await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 90000 });
    return page.evaluate(ids => ({ img: window.__cosAlphaApp.nodeById(ids.img).data.status, vid: window.__cosAlphaApp.nodeById(ids.vid).data.status, sent: 0 }), ids);
  };
  const first = await runVideo();
  const sent1 = await flow.evaluate(() => window.__flowState.sent.map(s => s.mode));
  console.log(JSON.stringify(first), JSON.stringify(sent1), JSON.stringify(dialogs));
  check('Chạy 1 node video có node ảnh chưa chạy phía trước: hỏi trước', dialogs.length === 1 && /cần 1 node tạo khác/.test(dialogs[0]), dialogs[0]);
  check('Bấm Huỷ: chỉ chạy node video, node ảnh không chạy', first.vid === 'success' && first.img !== 'success' && sent1.length === 1 && sent1[0] === 'video', JSON.stringify({ first, sent1 }));
  answer = true;
  await page.evaluate(id => { const n = window.__cosAlphaApp.nodeById(id); n.data.asset = null; n.data.status = 'idle'; }, ids.vid);
  const second = await runVideo();
  const sent2 = await flow.evaluate(() => window.__flowState.sent.map(s => s.mode));
  console.log(JSON.stringify(second), JSON.stringify(sent2));
  check('Bấm OK: chạy node ảnh trước rồi tới video', second.img === 'success' && second.vid === 'success' && sent2.slice(1).join(',') === 'image,video', JSON.stringify(sent2));
  const before = dialogs.length;
  await page.evaluate(id => { const n = window.__cosAlphaApp.nodeById(id); n.data.asset = null; n.data.status = 'idle'; }, ids.vid);
  await runVideo();
  check('Node phía trước đã có kết quả: không hỏi, chỉ chạy node này', dialogs.length === before && (await flow.evaluate(() => window.__flowState.sent.length)) === sent2.length + 1);
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
