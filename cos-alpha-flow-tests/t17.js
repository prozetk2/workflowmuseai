// Flow results whose links redirect to a media host that sends no CORS headers and is not in the extension's host
// permissions: the copy goes through the Flow tab (DevTools loader). Image made on Flow → video on Flow, the video
// plays in the node, and an image node still holding an old Flow link can feed a new video.
const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow.html', 'utf8');
const MP4 = fs.readFileSync(__dirname + '/v.mp4');
const PNG = png(180, 320, [40, 200, 90]);
// Requests made by the extension's background and by the DevTools loader bypass Playwright's routing, so both hosts
// are served by a local HTTPS server (self-signed, mapped with --host-resolver-rules). Flow answers media links with a
// redirect to another host (a signed link) that sends no CORS headers.
// The throwaway certificate is made on first run with openssl (not kept in git).
const KEY = __dirname + '/test-key.pem', CERT = __dirname + '/test-cert.pem';
if (!fs.existsSync(KEY) || !fs.existsSync(CERT)) {
  try { require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', KEY, '-out', CERT, '-days', '3650', '-subj', '/CN=flow.google.com', '-addext', 'subjectAltName=DNS:flow.google.com,DNS:media-cdn.example.com'], { stdio: 'ignore' }); }
  catch { console.log('SKIP t17: cần lệnh openssl để tạo chứng chỉ thử (Git for Windows có sẵn openssl).'); console.log('\n=== 0/0 passed'); process.exit(0); }
}
const cdnHits = [];
const server = https.createServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }, (req, res) => {
  const host = String(req.headers.host || '').split(':')[0], m = /\/media\/((?:img|clip)\d+\.(?:png|mp4))/.exec(req.url);
  if (host === 'flow.google.com' && m) { res.writeHead(302, { location: `https://media-cdn.example.com/signed/${m[1]}?sig=abc` }); return res.end(); }
  if (host === 'media-cdn.example.com') { cdnHits.push('server:' + req.url); const png = /\.png/.test(req.url); res.writeHead(200, { 'content-type': png ? 'image/png' : 'video/mp4' }); return res.end(png ? PNG : MP4); }
  if (host === 'flow.google.com') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(FAKE); }
  res.writeHead(404); res.end();
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
  const ctx = await chromium.launchPersistentContext('', { headless: false, ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new', '--no-proxy-server', '--ignore-certificate-errors', `--host-resolver-rules=MAP flow.google.com 127.0.0.1:${port},MAP media-cdn.example.com 127.0.0.1:${port}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  const errors = [];
  const flow = await ctx.newPage(); flow.on('pageerror', e => errors.push('flow:' + e.message));
  await flow.goto('https://flow.google.com/project/abc'); await flow.waitForTimeout(1000);
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('app:' + e.message)); page.on('dialog', d => d.accept());
  await page.goto(`chrome-extension://${id}/app.html`); await page.waitForTimeout(800);
  await page.click('#closeWelcomeBtn').catch(() => {});
  const cors = await flow.evaluate(async () => { try { await fetch('/media/img99.png', { credentials: 'include' }); return 'read'; } catch (e) { return e.message; } });
  check('Trang Flow giả: link ảnh chuyển hướng sang host không cho đọc (giống lỗi "Failed to fetch")', /Failed to fetch/i.test(cors), cors);

  // Model photo made on Flow → that photo as the video's reference.
  const ids = await page.evaluate(() => {
    const A = window.__cosAlphaApp, s = A.state; s.settings.provider = 'flow'; s.nodes.length = 0; s.edges.length = 0;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const e = (a, ap, b, bp) => s.edges.push({ id: A.uid('edge'), source: a.id, sourcePort: ap, target: b.id, targetPort: bp });
    const p1 = mk('prompt', { text: 'fashion model full body' }, 0, 0), g1 = mk('generateImage', { size: '9:16', status: 'idle', outputRole: 'model' }, 300, 0); e(p1, 'text', g1, 'prompt');
    const p2 = mk('prompt', { text: 'the model walks toward the camera' }, 0, 400), g2 = mk('generateVideo', { size: '9:16', duration: 8, referenceMode: 'ingredients' }, 700, 0); e(p2, 'text', g2, 'prompt'); e(g1, 'image', g2, 'reference');
    A.render(); return { g1: g1.id, g2: g2.id };
  });
  await page.click('#runBtn');
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 150000 }); await page.waitForTimeout(800);
  const st = await page.evaluate(async ids => {
    const A = window.__cosAlphaApp, out = {};
    for (const [k, id] of Object.entries(ids)) { const d = A.nodeById(id).data; out[k] = { s: d.status, e: d.error || '', url: (d.asset?.url || '').slice(0, 30), full: (d.asset?.url || '').slice(0, 80) }; }
    const el = document.querySelector(`.node[data-id="${CSS.escape(ids.g2)}"] video`);
    if (el) { if (el.readyState < 1) await new Promise(r => { el.onloadedmetadata = r; el.onerror = r; setTimeout(r, 4000); }); out.player = { w: el.videoWidth, h: el.videoHeight, d: Math.round(el.duration || 0), src: el.src.slice(0, 20) }; }
    return out;
  }, ids);
  const log = await flow.evaluate(() => window.__flowLog);
  console.log(JSON.stringify(st), JSON.stringify(log.sent.map(s => ({ a: s.attachments, t: s.text.slice(0, 80) }))), cdnHits.length);
  check('Ảnh người mẫu tạo trên Flow được chép về máy (không còn là link Flow)', st.g1.s === 'success' && st.g1.url.startsWith('data:image'), JSON.stringify(st.g1));
  check('Không còn báo "không chép được từ tab Flow" trên node ảnh', !/không chép được|đường link/.test(st.g1.e), st.g1.e);
  check('Video dùng ảnh đó làm tham chiếu: thành công, gắn đúng 1 ảnh', st.g2.s === 'success' && log.sent[1]?.attachments === 1 && /Reference-to-Video/.test(log.sent[1]?.text || ''), JSON.stringify({ g2: st.g2, sent: log.sent[1] }));
  check('Video chép về máy và phát được ngay trong node', /^(?:blob:|data:video)/.test(st.g2.url) && st.player?.w === 320 && st.player?.h === 180 && !/không chép được/.test(st.g2.e), JSON.stringify({ url: st.g2.url, player: st.player, e: st.g2.e }));

  // An image node from an older run still holding a Flow link (not copied): a new video can still use it.
  const old = await page.evaluate(() => {
    const A = window.__cosAlphaApp, s = A.state; s.nodes.length = 0; s.edges.length = 0;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const g1 = mk('generateImage', { size: '9:16', status: 'success', outputRole: 'model', asset: { id: 'a1', kind: 'image', url: 'https://flow.google.com/media/img77.png' } }, 300, 0);
    const p2 = mk('prompt', { text: 'old photo comes alive' }, 0, 400), g2 = mk('generateVideo', { size: '9:16', duration: 8, referenceMode: 'ingredients' }, 700, 0);
    s.edges.push({ id: A.uid('edge'), source: p2.id, sourcePort: 'text', target: g2.id, targetPort: 'prompt' }, { id: A.uid('edge'), source: g1.id, sourcePort: 'image', target: g2.id, targetPort: 'reference' });
    A.render(); return g2.id;
  });
  const sentBefore = log.sent.length;
  await page.evaluate(id => window.__cosAlphaApp.executeGenerationNode(id), old);
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 120000 }); await page.waitForTimeout(500);
  const oldSt = await page.evaluate(id => { const d = window.__cosAlphaApp.nodeById(id).data; return { s: d.status, e: (d.error || '').slice(0, 160) }; }, old);
  const sentAfter = await flow.evaluate(() => window.__flowLog.sent);
  check('Ảnh cũ còn là link Flow vẫn gửi được làm tham chiếu cho video mới', oldSt.s === 'success' && sentAfter.length === sentBefore + 1 && sentAfter.at(-1).attachments === 1, JSON.stringify({ oldSt, last: sentAfter.at(-1) }));

  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  check('Không có lỗi JavaScript', !errors.length);
  await ctx.close(); server.close();
  process.exit(summary() ? 1 : 0);
})();
