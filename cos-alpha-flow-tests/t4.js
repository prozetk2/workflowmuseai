// Flow-tab path: fake Flow agent page, image + video (R2V and first frame), approval, overlay, album, blocked, stop.
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
  await page.goto(`chrome-extension://${id}/app.html`); await page.waitForTimeout(800);
  await page.click('#closeWelcomeBtn').catch(() => {});
  const session = await page.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://flow.google.com/*' }); return chrome.tabs.sendMessage(tab.id, { type: 'THEKEY_FLOW_CHECK_SESSION' }); });
  check('Kiểm tra trang Flow trả lời (bridge gắn vào tab)', session?.ok, JSON.stringify({ ready: session?.ready }));
  const refA = 'data:image/png;base64,' + png(64, 64, [200, 30, 30]).toString('base64');
  const refB = 'data:image/png;base64,' + png(64, 64, [30, 30, 200]).toString('base64');
  const ids = await page.evaluate(({ refA, refB }) => {
    const A = window.__cosAlphaApp, s = A.state; s.settings.provider = 'flow'; s.nodes.length = 0; s.edges.length = 0;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const e = (a, ap, b, bp) => s.edges.push({ id: A.uid('edge'), source: a.id, sourcePort: ap, target: b.id, targetPort: bp });
    const p1 = mk('prompt', { text: 'a red fox in snow' }, 0, 0), g1 = mk('generateImage', { size: '9:16', status: 'idle' }, 300, 0); e(p1, 'text', g1, 'prompt');
    const iA = mk('imageInput', { localDataUrl: refA, name: 'a.png' }, 0, 300), iB = mk('imageInput', { localDataUrl: refB, name: 'b.png' }, 0, 450);
    const p2 = mk('prompt', { text: 'the girl walks in the park' }, 0, 600), g2 = mk('generateVideo', { size: '9:16', duration: 8 }, 300, 400); e(p2, 'text', g2, 'prompt'); e(iA, 'image', g2, 'reference'); e(iB, 'image', g2, 'reference');
    const p3 = mk('prompt', { text: 'camera slowly zooms in' }, 0, 800), g3 = mk('generateVideo', { size: '16:9', duration: 8 }, 300, 800); e(p3, 'text', g3, 'prompt'); e(iA, 'image', g3, 'reference');
    A.render(); return { g1: g1.id, g2: g2.id, g3: g3.id };
  }, { refA, refB });
  // Run all through the toolbar button, as the user does.
  await page.click('#runBtn');
  let overlaySeen = '';
  for (let i = 0; i < 40 && !overlaySeen; i++) { await flow.waitForTimeout(500); overlaySeen = await flow.evaluate(() => document.getElementById('cosalpha-queue-overlay')?.shadowRoot?.querySelector('.p')?.innerText.replace(/\s+/g, ' ') || ''); }
  check('Bảng hàng đợi hiện trên trang Flow khi đang chạy', overlaySeen, overlaySeen.slice(0, 80));
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const st = await page.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([k, id]) => { const n = window.__cosAlphaApp.nodeById(id); return [k, { status: n.data.status, error: n.data.error, kind: n.data.asset?.kind, url: (n.data.asset?.url || '').slice(0, 15), w: n.data.asset?.width, h: n.data.asset?.height, endFrame: Boolean(n.data.endFrame?.url) }]; })), ids);
  const log = await flow.evaluate(() => window.__flowLog);
  console.log(JSON.stringify(st), JSON.stringify(log.sent.map(s => ({ a: s.attachments, t: s.text.slice(0, 160) }))));
  check('Ảnh qua tab Flow: thành công, có ảnh', st.g1.status === 'success' && st.g1.kind === 'image' && st.g1.url.startsWith('data:image'), JSON.stringify(st.g1));
  check('Video 2 ảnh tham chiếu: thành công', st.g2.status === 'success' && st.g2.kind === 'video', JSON.stringify(st.g2));
  check('Video 1 ảnh khung đầu: thành công', st.g3.status === 'success' && st.g3.kind === 'video', JSON.stringify(st.g3));
  check('Kích thước video đọc được (320x180)', st.g2.w === 320 && st.g2.h === 180, `${st.g2.w}x${st.g2.h}`);
  check('Video có khung cuối (để nối cảnh)', st.g2.endFrame && st.g3.endFrame);
  check('Đã gửi đúng 3 tin nhắn cho trợ lý Flow (không gửi lặp)', log.sent.length === 3, String(log.sent.length));
  check('Ảnh: gửi 0 ảnh đính kèm, có tỉ lệ 9:16', log.sent[0]?.attachments === 0 && /aspect ratio 9:16/.test(log.sent[0]?.text) && /a red fox in snow/.test(log.sent[0]?.text));
  check('Video 2 ảnh: gắn đủ 2 ảnh + yêu cầu Reference-to-Video', log.sent[1]?.attachments === 2 && /Reference-to-Video/.test(log.sent[1]?.text));
  check('Video 1 ảnh: gắn 1 ảnh làm khung đầu', log.sent[2]?.attachments === 1 && /start frame/.test(log.sent[2]?.text));
  check('Tự bấm "Phê duyệt" cho 2 video', log.approvals === 2, String(log.approvals));
  const overlayEnd = await flow.evaluate(() => document.getElementById('cosalpha-queue-overlay')?.shadowRoot?.querySelector('.t')?.textContent || '');
  check('Bảng trên Flow báo xong 3/3', /Xong 3\/3/.test(overlayEnd), overlayEnd);
  const album = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('cosalpha-album'); r.onsuccess = () => { const tx = r.result.transaction('items'); const q = tx.objectStore('items').getAll(); q.onsuccess = () => res(q.result.map(i => i.kind)); }; r.onerror = () => res('ERR'); }));
  check('Kết quả tự vào Album dự án (1 ảnh + 2 video)', Array.isArray(album) && album.filter(k => k === 'image').length === 1 && album.filter(k => k === 'video').length === 2, JSON.stringify(album));
  const hist = await page.evaluate(async () => (await chrome.storage.local.get('cosalphaHistory')).cosalphaHistory || []);
  check('Lịch sử ghi 3 lượt tạo', hist.length === 3, String(hist.length));

  // Google "unusual activity": stop the whole run, no retry, next node not run.
  const blk = await page.evaluate(() => {
    const A = window.__cosAlphaApp, s = A.state;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const e = (a, b) => s.edges.push({ id: A.uid('edge'), source: a.id, sourcePort: 'text', target: b.id, targetPort: 'prompt' });
    const p = mk('prompt', { text: 'BLOCKME please' }, 900, 0), g = mk('generateImage', { size: '1:1', status: 'idle' }, 1200, 0); e(p, g);
    const p2 = mk('prompt', { text: 'a second image after block' }, 900, 300), g2 = mk('generateImage', { size: '1:1', status: 'idle' }, 1200, 300); e(p2, g2);
    A.render(); return { g: g.id, g2: g2.id };
  });
  const sentBefore = log.sent.length;
  await page.click('#runBtn');
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 60000 }); await page.waitForTimeout(500);
  const bst = await page.evaluate(b => [window.__cosAlphaApp.nodeById(b.g).data, window.__cosAlphaApp.nodeById(b.g2).data].map(d => ({ s: d.status, e: (d.error || '').slice(0, 70) })), blk);
  const sentAfter = (await flow.evaluate(() => window.__flowLog.sent.length));
  check('"Hoạt động bất thường": node báo lỗi chặn', bst[0].s === 'error' && /bất thường/.test(bst[0].e), JSON.stringify(bst[0]));
  check('…và dừng cả lượt, không chạy node sau, không gửi lại', bst[1].s !== 'success' && bst[1].s !== 'running' && sentAfter === sentBefore + 1, JSON.stringify(bst[1]) + ` sent+${sentAfter - sentBefore}`);
  // Stop button while Flow is working.
  const slow = await page.evaluate(() => {
    const A = window.__cosAlphaApp, s = A.state;
    s.nodes = s.nodes.filter(n => n.type !== 'generateImage' || !/BLOCK|second/.test(JSON.stringify(n))); // keep things simple
    const n = A.makeNode('generateImage', 1500, 0); n.data = { size: '1:1', status: 'idle' }; const p = A.makeNode('prompt', 1500, 300); p.data = { text: 'SLOWME' }; s.nodes.push(n, p);
    s.edges.push({ id: A.uid('edge'), source: p.id, sourcePort: 'text', target: n.id, targetPort: 'prompt' }); A.render(); return n.id;
  });
  await page.evaluate(id => { void window.__cosAlphaApp.executeGenerationNode(id); }, slow);
  await page.waitForTimeout(4000);
  await page.evaluate(id => window.__cosAlphaApp.stopGeneration(id), slow);
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 15000 }).catch(() => {});
  const sst = await page.evaluate(id => ({ s: window.__cosAlphaApp.nodeById(id).data.status, running: window.__cosAlphaApp.state.isRunning }), slow);
  check('Nút Dừng khi Flow đang làm: node dừng, app mở khoá', sst.s === 'stopped' && !sst.running, JSON.stringify(sst));
  // After a stop, a new generation works again.
  const sentB = await flow.evaluate(() => window.__flowLog.sent.length);
  const okId = await page.evaluate(() => window.__cosAlphaApp.state.nodes.find(n => n.type === 'generateImage' && n.data.status === 'success').id);
  await page.evaluate(id => { void window.__cosAlphaApp.executeGenerationNode(id); }, okId);
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 60000 }); await page.waitForTimeout(300);
  const again = await page.evaluate(id => window.__cosAlphaApp.nodeById(id).data.status, okId);
  check('Sau khi dừng, tạo lại vẫn chạy được', again === 'success' && (await flow.evaluate(() => window.__flowLog.sent.length)) === sentB + 1, again);
  await flow.screenshot({ path: 'f4-flow.png' }); await page.screenshot({ path: 'f4-app.png' });
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
