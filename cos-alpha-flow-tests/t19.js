// 1.7.2: Flow with "Tác nhân" off (Nov 2026 UI). The prompt box sends straight to the model in the settings chip,
// so the bridge must switch it to Video / Image, frames / ingredients, aspect and length before sending.
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
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('app:' + e.message)); page.on('dialog', d => d.accept());
  await page.goto(`chrome-extension://${id}/app.html`); await page.waitForTimeout(800);
  await page.click('#closeWelcomeBtn').catch(() => {});
  const ref = 'data:image/png;base64,' + png(64, 64, [200, 30, 30]).toString('base64');
  const ids = await page.evaluate(ref => {
    const A = window.__cosAlphaApp, s = A.state; s.settings.provider = 'flow'; s.nodes = s.nodes.filter(n => n.type === 'timeline'); s.edges.length = 0;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const e = (a, ap, b, bp) => s.edges.push({ id: A.uid('edge'), source: a.id, sourcePort: ap, target: b.id, targetPort: bp });
    const p1 = mk('prompt', { text: 'a red fox in snow' }, 0, 0), g1 = mk('generateImage', { size: '9:16' }, 300, 0); e(p1, 'text', g1, 'prompt');
    const i1 = mk('imageInput', { localDataUrl: ref, name: 'a.png', role: 'startFrame' }, 0, 250);
    const p2 = mk('prompt', { text: 'the fox runs across the field' }, 0, 450), v1 = mk('generateVideo', { size: '16:9', duration: 8 }, 300, 300); e(p2, 'text', v1, 'prompt'); e(i1, 'image', v1, 'reference');
    const p3 = mk('prompt', { text: 'camera slowly zooms in' }, 0, 650), v2 = mk('generateVideo', { size: '9:16', duration: 4, referenceMode: 'references' }, 300, 600); e(p3, 'text', v2, 'prompt');
    A.render(); return { g1: g1.id, v1: v1.id, v2: v2.id };
  }, ref);
  await page.click('#runBtn');
  const finished = await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 150000 }).then(() => true, () => false);
  check('Chạy tất cả chạy hết, không treo', finished);
  const st = await page.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([k, id]) => { const d = window.__cosAlphaApp.nodeById(id).data; return [k, { s: d.status, e: (d.error || '').slice(0, 120), kind: d.asset?.kind, end: Boolean(d.endFrame?.url) }]; })), ids);
  const sent = await flow.evaluate(() => window.__flowState.sent);
  console.log(JSON.stringify(st), JSON.stringify(sent));
  check('Ảnh: tạo xong, là ảnh', st.g1.s === 'success' && st.g1.kind === 'image', JSON.stringify(st.g1));
  check('Video 1: tạo xong, là video, có khung cuối', st.v1.s === 'success' && st.v1.kind === 'video' && st.v1.end, JSON.stringify(st.v1));
  check('Video 2: tạo xong, là video', st.v2.s === 'success' && st.v2.kind === 'video', JSON.stringify(st.v2));
  check('Gửi đúng 3 lần', sent.length === 3, String(sent.length));
  check('Ảnh gửi ở chế độ Hình ảnh 9:16, đúng câu lệnh (không có lời dặn cho trợ lý)', sent[0]?.mode === 'image' && sent[0]?.aspect === '9:16' && sent[0]?.text.startsWith('a red fox in snow') && !/Generate exactly/.test(sent[0]?.text), JSON.stringify(sent[0]));
  check('Video có khung đầu: chế độ Video · Khung hình, 16:9, 8 giây, ảnh nằm ở ô Bắt đầu', sent[1]?.mode === 'video' && sent[1]?.vtype === 'frames' && sent[1]?.aspect === '16:9' && sent[1]?.dur === 8 && sent[1]?.slot === 1, JSON.stringify(sent[1]));
  check('Video không ảnh: chế độ Video · Thành phần, 9:16, 4 giây', sent[2]?.mode === 'video' && sent[2]?.vtype === 'ingredients' && sent[2]?.aspect === '9:16' && sent[2]?.dur === 4, JSON.stringify(sent[2]));
  check('Ảnh tải lên (thekey-…) không bị lấy nhầm làm kết quả', st.v1.kind === 'video');

  // "Unusual activity" on the new tile still stops the whole run without retrying.
  const blk = await page.evaluate(() => {
    const A = window.__cosAlphaApp, s = A.state;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const e = (a, b) => s.edges.push({ id: A.uid('edge'), source: a.id, sourcePort: 'text', target: b.id, targetPort: 'prompt' });
    const p = mk('prompt', { text: 'BLOCKME please' }, 900, 0), g = mk('generateVideo', { size: '16:9' }, 1200, 0); e(p, g);
    const p2 = mk('prompt', { text: 'after the block' }, 900, 300), g2 = mk('generateVideo', { size: '16:9' }, 1200, 300); e(p2, g2);
    A.render(); return [g.id, g2.id];
  });
  const before = sent.length;
  await page.click('#runBtn');
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 60000 }).catch(() => {});
  const bst = await page.evaluate(ids => ids.map(id => { const d = window.__cosAlphaApp.nodeById(id).data; return { s: d.status, e: (d.error || '').slice(0, 70) }; }), blk);
  const after = await flow.evaluate(() => window.__flowState.sent.length);
  check('"Hoạt động bất thường": dừng cả lượt, không gửi thêm', bst[0].s === 'error' && /bất thường/.test(bst[0].e) && bst[1].s !== 'success' && after === before + 1, JSON.stringify(bst) + ` sent+${after - before}`);
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
