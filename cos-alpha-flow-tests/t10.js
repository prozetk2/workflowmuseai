// Classic Flow mode (Agent off): the bridge sets kind, Frames/Ingredients, ratio, x1, duration, resolution, model, voice.
const { chromium } = require('playwright');
const fs = require('fs');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow-classic.html', 'utf8');
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
  const flow = await ctx.newPage(); flow.on('console', m => console.log('FLOW', m.text().slice(0,200))); flow.on('pageerror', e => errors.push('flow:' + e.message));
  await flow.goto('https://flow.google.com/project/abc'); await flow.waitForTimeout(1000);
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('app:' + e.message)); page.on('dialog', d => d.accept());
  await page.goto(`chrome-extension://${id}/app.html`); await page.waitForTimeout(800);
  await page.click('#closeWelcomeBtn').catch(() => {});
  // Choose the mode the way the user does: Settings → Chế độ Flow.
  const hasSetting = await page.$('#flowUiMode');
  check('Cài đặt có ô "Chế độ Flow"', hasSetting);
  await page.evaluate(() => { const s = window.__cosAlphaApp.state; s.settings.provider = 'flow'; s.settings.flowUiMode = 'classic'; });
  const refA = 'data:image/png;base64,' + png(64, 64, [200, 30, 30]).toString('base64');
  const refB = 'data:image/png;base64,' + png(64, 64, [30, 30, 200]).toString('base64');
  const ids = await page.evaluate(({ refA, refB }) => {
    const A = window.__cosAlphaApp, s = A.state; s.nodes.length = 0; s.edges.length = 0;
    const mk = (type, data, x, y) => { const n = A.makeNode(type, x, y); Object.assign(n.data, data); s.nodes.push(n); return n; };
    const e = (a, ap, b, bp) => s.edges.push({ id: A.uid('edge'), source: a.id, sourcePort: ap, target: b.id, targetPort: bp });
    const p1 = mk('prompt', { text: 'a red fox in snow' }, 0, 0), g1 = mk('generateImage', { size: '9:16', model: 'Nano Banana Pro', status: 'idle' }, 300, 0); e(p1, 'text', g1, 'prompt');
    const p2 = mk('prompt', { text: 'a girl says hello' }, 0, 300), g2 = mk('generateVideo', { size: '9:16', duration: 10, model: 'Omni 1.1 Flash', resolution: '1080p', voice: 'Achernar' }, 300, 300); e(p2, 'text', g2, 'prompt');
    const iA = mk('imageInput', { localDataUrl: refA, name: 'a.png' }, 0, 600), iB = mk('imageInput', { localDataUrl: refB, name: 'b.png' }, 0, 750);
    const p3 = mk('prompt', { text: 'the girl walks in the park' }, 0, 900), g3 = mk('generateVideo', { size: '16:9', duration: 8, referenceMode: 'ingredients', model: 'Veo 3.1 - Quality' }, 300, 900); e(p3, 'text', g3, 'prompt'); e(iA, 'image', g3, 'reference'); e(iB, 'image', g3, 'reference');
    A.render(); return { g1: g1.id, g2: g2.id, g3: g3.id };
  }, { refA, refB });
  await page.click('#runBtn');
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 150000 });
  await page.waitForTimeout(800);
  const st = await page.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([k, id]) => { const n = window.__cosAlphaApp.nodeById(id); return [k, { status: n.data.status, error: n.data.error, kind: n.data.asset?.kind, d: JSON.stringify(n.data).slice(0, 600) }]; })), ids);
  const log = await flow.evaluate(() => window.__flowLog.sent);
  console.log(JSON.stringify(st)); console.log(JSON.stringify(log));
  const [a, b, c] = log;
  check('3 lượt được gửi qua ô prompt cổ điển', log.length === 3, String(log.length));
  check('Ảnh: chọn Image, 9:16, x1, Nano Banana Pro', a && a.settings.kind === 'image' && a.settings.aspect === '9:16' && a.settings.count === 'x1' && a.settings.model === 'Nano Banana Pro', JSON.stringify(a?.settings));
  check('Ảnh: prompt gõ nguyên văn (không có câu lệnh Agent)', a && a.text === 'a red fox in snow', a?.text);
  check('Video Omni: 10s, 1080p, Omni 1.1 Flash, giọng Achernar', b && b.settings.kind === 'video' && b.settings.duration === '10s' && b.settings.res === '1080p' && b.settings.model === 'Omni 1.1 Flash' && b.settings.voice === 'Achernar', JSON.stringify(b?.settings));
  check('Video 2 ảnh: chế độ Ingredients, 16:9, Veo 3.1 - Quality, 2 ảnh đính kèm', c && c.settings.input === 'ingredients' && c.settings.aspect === '16:9' && c.settings.model === 'Veo 3.1 - Quality' && c.attachments === 2, JSON.stringify(c));
  check('Cả 3 node thành công', Object.values(st).every(x => x.status === 'success'), JSON.stringify(st));
  const flowState = await flow.evaluate(() => ({ agent: document.querySelector('#agentToggle').getAttribute('aria-pressed'), panel: Boolean(document.querySelector('#agentPanel')), typed: window.__flowLog.agentTyped }));
  check('Tự đóng khung Agent và tắt Agent, không gõ vào ô chat Agent', flowState.agent === 'false' && !flowState.panel && !flowState.typed, JSON.stringify(flowState));
  check('Không có lỗi JS', !errors.length, errors.join(' | '));
  await ctx.close();
  process.exit(summary() ? 1 : 0);
})();
