// 1.7.1: Run all keeps going through a chain of "Nối khung cuối" videos even when the app page cannot
// decode video (as when it sits in a background tab), and a Flow tab that reloads mid-request is not sent the scene twice.
const { chromium } = require('playwright');
const fs = require('fs');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow.html', 'utf8');
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
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('app:' + e.message)); page.on('dialog', d => d.accept());
  // The app page never loads video: no metadata, no frames, no error event (what a hidden tab can do).
  await page.addInitScript(() => {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return this.__fakeSrc || ''; }, set(value) { this.__fakeSrc = String(value); } });
    window.__realMediaSrc = desc;
  });
  await page.goto(`chrome-extension://${id}/app.html`); await page.waitForTimeout(800);
  await page.click('#closeWelcomeBtn').catch(() => {});
  const ids = await page.evaluate(() => {
    const A = window.__cosAlphaApp, s = A.state; s.settings.provider = 'flow'; s.nodes = s.nodes.filter(n => n.type === 'timeline'); s.edges.length = 0;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const e = (a, b) => s.edges.push({ id: A.uid('edge'), source: a.id, sourcePort: 'text', target: b.id, targetPort: 'prompt' });
    const vids = [0, 1, 2].map(i => { const p = mk('prompt', { text: `scene ${i + 1} of the walk` }, 0, i * 250), v = mk('generateVideo', { size: '16:9', duration: 8, continuity: i > 0 }, 300, i * 250); e(p, v); return v; });
    let tl = s.nodes.find(n => n.type === 'timeline'); if (!tl) { tl = A.makeNode('timeline', 700, 0); s.nodes.push(tl); }
    tl.data.clipOrder = vids.map(v => v.id);
    A.render(); return vids.map(v => v.id);
  });
  await page.click('#runBtn');
  const finished = await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 150000 }).then(() => true, () => false);
  check('Chạy tất cả không bị treo khi trang app không đọc được video', finished);
  const st = await page.evaluate(ids => ids.map(id => { const d = window.__cosAlphaApp.nodeById(id).data; return { s: d.status, e: (d.error || '').slice(0, 90), end: Boolean(d.endFrame?.url), w: d.asset?.width }; }), ids);
  console.log(JSON.stringify(st));
  check('Cả 3 video nối khung cuối đều tạo xong', st.every(x => x.s === 'success'), JSON.stringify(st.map(x => x.s + ' ' + x.e)));
  check('Khung cuối lấy từ tab Flow cho mọi clip', st.every(x => x.end));
  check('Kích thước video lấy từ tab Flow (320)', st.every(x => x.w === 320), JSON.stringify(st.map(x => x.w)));
  const sent = await flow.evaluate(() => window.__flowLog.sent.map(x => x.attachments));
  check('Gửi đúng 3 lần, clip 2 và 3 có khung đầu', sent.length === 3 && sent[1] === 1 && sent[2] === 1, JSON.stringify(sent));

  // Flow tab reloads mid-request: that scene fails without a second send, the next one still runs.
  const ids2 = await page.evaluate(() => {
    const A = window.__cosAlphaApp, s = A.state;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const e = (a, b) => s.edges.push({ id: A.uid('edge'), source: a.id, sourcePort: 'text', target: b.id, targetPort: 'prompt' });
    const p = mk('prompt', { text: 'RELOADME image' }, 900, 0), g = mk('generateImage', { size: '1:1' }, 1200, 0); e(p, g);
    const p2 = mk('prompt', { text: 'an image after the reload' }, 900, 300), g2 = mk('generateImage', { size: '1:1' }, 1200, 300); e(p2, g2);
    A.render(); return [g.id, g2.id];
  });
  await page.click('#runBtn');
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 120000 }).catch(() => {});
  const st2 = await page.evaluate(ids => ids.map(id => { const d = window.__cosAlphaApp.nodeById(id).data; return { s: d.status, e: (d.error || '').slice(0, 90) }; }), ids2);
  const reloadSends = await flow.evaluate(() => Number(localStorage.getItem('reloadSends') || 0));
  console.log(JSON.stringify(st2), reloadSends);
  check('Tab Flow tải lại giữa chừng: node báo mất kết nối', st2[0].s === 'error' && /kết nối/i.test(st2[0].e), JSON.stringify(st2[0]));
  check('…không gửi lại cảnh đó lần 2', reloadSends === 1, String(reloadSends));
  check('…và vẫn chạy tiếp node sau', st2[1].s === 'success', JSON.stringify(st2[1]));
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
