const { chromium } = require('playwright');
const zlib = require('zlib');
function png(w, h, rgb) { const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) rgb.forEach((v, i) => raw[y * (w * 3 + 1) + 1 + x * 3 + i] = v); }
  const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const EXT = process.argv[2];
const SCRIPT = `NHÂN VẬT: Ugg — a prehistoric clay boy, 8 years old, messy brown hair, fur tunic

CẢNH 1 (0:00–0:08): Hang đá

Prompt ảnh: clay boy Ugg in a cave, 9:16

CẢNH 2 (0:08–0:16): Tia lửa

Prompt ảnh: clay boy Ugg strikes stones, sparks, 9:16

CẢNH 3 (0:16–0:24): Ăn mừng

Prompt ảnh: clay tribe dancing around fire, 9:16`;
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 420, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  let imgCount = 0; const refsSeen = [];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => {
    const url = route.request().url();
    if (/:generateContent/.test(url)) { imgCount++; const body = JSON.parse(route.request().postData()); refsSeen.push(body.contents[0].parts.length - 1); await new Promise(r => setTimeout(r, 1500)); return route.fulfill({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png(90, 160, [imgCount * 70, 90, 180]).toString('base64') } }] } }] } }); }
    return route.fulfill({ json: { models: [] } });
  });
  const errors = [];
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('panel:' + e.message));
  await page.goto(`chrome-extension://${id}/panel.html`); await page.waitForURL(/view=panel/); await page.waitForTimeout(800);
  await page.evaluate(async () => { await chrome.storage.local.set({ thekeyGeminiApiKey: 'FAKEKEY' }); window.__cosAlphaApp.state.settings.provider = 'api'; });
  console.log('welcome hidden:', await page.evaluate(() => document.querySelector('#welcomeModal').classList.contains('hidden')));
  await page.fill('#qpPrompts', '1. Cô gái cầm chai serum mỉm cười\n2. Cận cảnh tay xoay chai serum\n3. Chai serum trên bàn đá');
  await page.locator('#qpRefFile').setInputFiles({ name: 'ref.png', mimeType: 'image/png', buffer: png(40, 40, [250, 200, 120]) });
  await page.waitForTimeout(300);
  console.log('count:', await page.textContent('#qpCount'));
  await page.screenshot({ path: 'panel-gen.png' });
  await page.click('#qpGo'); await page.waitForTimeout(500);
  console.log('status:', await page.textContent('#qpStatus'));
  await page.click('[data-qp="queue"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: 'panel-queue.png' });
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning && !document.querySelector('#qpQueueBadge:not(.hidden)'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  console.log('statuses', await page.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => n.type === 'generateImage').map(n => n.data.status).join(','))); console.log('imgCount', imgCount, 'refs per call', refsSeen.join(','));
  await page.click('[data-qp="album"]'); await page.waitForTimeout(600);
  console.log('album cards', await page.locator('.cos-a-card').count());
  await page.screenshot({ path: 'panel-album.png' });
  // full view opens -> panel becomes inactive
  const full = await ctx.newPage(); full.on('pageerror', e => errors.push('full:' + e.message));
  await full.goto(`chrome-extension://${id}/app.html`); await full.waitForTimeout(1000);
  console.log('full busy modal:', await full.evaluate(() => !document.querySelector('#instanceModal').classList.contains('hidden'))); console.log('panel inactive modal shown:', await page.evaluate(() => !document.querySelector('#instanceModal').classList.contains('hidden')));
  console.log('full has nodes:', await full.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => n.type === 'generateImage' && n.data.status === 'success').length));
  console.log('full: viewPanelBtn visible', await full.isVisible('#viewPanelBtn'), 'viewFullBtn visible', await full.isVisible('#viewFullBtn'));
  console.log('ERRORS:', errors.join('\n') || 'none');
  await ctx.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
