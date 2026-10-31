// Side panel quick generate through the Flow tab: image ×2 with one reference, then one video.
const { chromium } = require('playwright');
const fs = require('fs');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow.html', 'utf8');
const MP4 = fs.readFileSync(__dirname + '/v.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1300, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
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
  await flow.goto('https://flow.google.com/project/abc'); await flow.waitForTimeout(800);
  const panel = await ctx.newPage(); panel.on('pageerror', e => errors.push('panel:' + e.message)); panel.on('dialog', d => d.accept());
  await panel.setViewportSize({ width: 420, height: 900 });
  await panel.goto(`chrome-extension://${id}/panel.html`); await panel.waitForURL(/view=panel/); await panel.waitForTimeout(800);
  await panel.evaluate(() => { window.__cosAlphaApp.state.settings.provider = 'flow'; });
  await panel.fill('#qpPrompts', 'cô gái cầm hoa\n\nchú mèo ngủ');
  await panel.locator('#qpRefFile').setInputFiles({ name: 'ref.png', mimeType: 'image/png', buffer: png(80, 80, [220, 100, 40]) }); await panel.waitForTimeout(500);
  await panel.click('#qpGo'); await panel.waitForTimeout(500);
  await panel.waitForFunction(() => !window.__cosAlphaApp.state.isRunning && !document.querySelector('#qpQueueBadge:not(.hidden)'), null, { timeout: 90000 }); await panel.waitForTimeout(500);
  let log = await flow.evaluate(() => window.__flowLog);
  const st = await panel.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => /generate/.test(n.type)).map(n => n.data.status));
  check('Panel → Flow: 2 ảnh xong', st.filter(s => s === 'success').length === 2, JSON.stringify(st));
  check('Mỗi lượt gắn 1 ảnh tham chiếu', log.sent.length === 2 && log.sent.every(s => s.attachments === 1), JSON.stringify(log.sent.map(s => s.attachments)));
  // Video from the panel
  await panel.click('[data-qkind="video"]'); await panel.fill('#qpPrompts', 'sóng biển vỗ vào bờ'); await panel.click('[data-qp-refclear], .qp-ref-x', { timeout: 1000 }).catch(() => {});
  await panel.evaluate(() => document.querySelectorAll('#qpRefs [data-rm], #qpRefs button').forEach(b => b.click()));
  await panel.click('#qpGo'); await panel.waitForTimeout(500);
  await panel.waitForFunction(() => !window.__cosAlphaApp.state.isRunning && !document.querySelector('#qpQueueBadge:not(.hidden)'), null, { timeout: 90000 }); await panel.waitForTimeout(500);
  log = await flow.evaluate(() => window.__flowLog);
  const vs = await panel.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => n.type === 'generateVideo').map(n => n.data.status));
  check('Panel → Flow: 1 video xong (có phê duyệt)', vs.length === 1 && vs[0] === 'success' && log.approvals === 1, JSON.stringify(vs) + ' ' + log.sent.at(-1)?.text.slice(0, 90));
  await panel.click('[data-qp="album"]'); await panel.waitForTimeout(700);
  check('Album panel có 3 mục', (await panel.locator('.cos-a-card').count()) === 3);
  await panel.screenshot({ path: 'f7-panel.png' });
  check('Không có lỗi JavaScript', !errors.length, errors.join(' | '));
  const failed = summary(); await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
