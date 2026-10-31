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
  const ctx = await chromium.launchPersistentContext('', { headless: false, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  let imgCount = 0, textCalls = 0;
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => {
    const url = route.request().url();
    if (/flash:generateContent|gemini-2\.5-flash/.test(url)) { textCalls++; return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: '```\n' + SCRIPT + '\n```' }] } }] } }); }
    if (/:generateContent/.test(url)) { imgCount++; const n = imgCount; await new Promise(r => setTimeout(r, 3000)); return route.fulfill({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png(90, 160, [n * 60, 120, 200]).toString('base64') } }] } }] } }); }
    return route.fulfill({ json: { models: [] } });
  });
  await ctx.route('https://flow.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Fake Flow</h1></body></html>' }));
  const errors = [];
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('app:' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('appconsole:' + m.text()); });
  await page.goto(`chrome-extension://${id}/app.html`); await page.waitForTimeout(800);
  await page.click('#closeWelcomeBtn').catch(() => {});
  await page.evaluate(async () => { await chrome.storage.local.set({ thekeyGeminiApiKey: 'FAKEKEY' }); window.__cosAlphaApp.state.settings.provider = 'api'; });
  // AI script
  await page.click('#aiScriptOpen'); await page.fill('#aiIdea', 'người tiền sử phát hiện lửa');
  await page.click('[data-ai-write="gemini-api"]'); await page.waitForFunction(() => document.querySelector('#aiScriptStatus').className === 'ok', null, { timeout: 8000 });
  await page.screenshot({ path: 'ai.png' }); console.log('script status:', await page.textContent('#aiScriptStatus'));
  console.log('script starts:', (await page.inputValue('#scriptInput')).slice(0, 40));
  await page.click('#buildScriptNodes'); await page.waitForTimeout(300);
  const counts = await page.evaluate(() => { const s = window.__cosAlphaApp.state; return { gen: s.nodes.filter(n => n.type === 'generateImage').length, chars: s.nodes.filter(n => n.type === 'character').map(n => n.data.name + '|' + n.data.description.slice(0, 20)) }; });
  console.log('nodes:', JSON.stringify(counts));
  // Flow tab
  const flow = await ctx.newPage(); flow.on('pageerror', e => errors.push('flow:' + e.message));
  await flow.goto('https://flow.google.com/project/x'); await flow.waitForTimeout(800);
  await page.bringToFront();
  await page.click('#queueBtn'); await page.waitForTimeout(200);
  await page.click('#runBtn'); await page.waitForTimeout(1200);
  await page.click('[data-q="pause"]'); await page.waitForTimeout(700);
  const ov = async () => flow.evaluate(() => { const h = document.getElementById('cosalpha-queue-overlay'); return h ? h.shadowRoot.querySelector('.p').innerText.replace(/\s+/g, ' ') : 'NO OVERLAY'; });
  console.log('overlay while running+paused:', await ov());
  await page.waitForTimeout(4000);
  console.log('imgCount after pause wait (expect 1):', imgCount);
  await page.screenshot({ path: 'queue-run.png' }); console.log('drawer:', (await page.innerText('#cosDrawerBody')).replace(/\s+/g, ' ').slice(0, 300));
  // expand overlay, skip item 2, resume from overlay
  await flow.evaluate(() => document.getElementById('cosalpha-queue-overlay').shadowRoot.querySelector('[data-c="toggle"]').click());
  await flow.waitForTimeout(300);
  console.log('overlay expanded:', await ov());
  await flow.evaluate(() => document.getElementById('cosalpha-queue-overlay').shadowRoot.querySelector('[data-c="skip"]').click());
  await flow.waitForTimeout(800);
  await flow.evaluate(() => document.getElementById('cosalpha-queue-overlay').shadowRoot.querySelector('[data-c="resume"]').click());
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  console.log('statuses:', JSON.stringify(await page.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => n.type === 'generateImage').map(n => n.data.status))));
  console.log('imgCount (expect 2):', imgCount);
  console.log('overlay after:', await ov());
  // enqueue: run node 2 alone, while running enqueue node 1 regenerate
  // album
  await page.click('#albumBtn'); await page.waitForTimeout(800);
  await page.screenshot({ path: 'album.png' }); console.log('album:', (await page.innerText('#cosDrawerBody')).replace(/\s+/g, ' ').slice(0, 200), 'cards=', await page.locator('.cos-a-card').count());
  const before = await page.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => n.type === 'imageInput').length);
  await page.locator('[data-ause]').first().click(); await page.waitForTimeout(800);
  console.log('imageInput nodes', before, '->', await page.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => n.type === 'imageInput').length));
  // enqueue test
  await page.click('#queueBtn'); await page.waitForTimeout(200);
  const ids = await page.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => n.type === 'generateImage').map(n => n.id));
  await page.evaluate(id => { void window.__cosAlphaApp.executeGenerationNode(id); }, ids[1]); await page.waitForTimeout(500);
  await page.evaluate(id => { void window.__cosAlphaApp.executeGenerationNode(id); }, ids[0]); await page.waitForTimeout(300);
  console.log('queue during enqueue:', (await page.innerText('#cosDrawerBody')).replace(/\s+/g, ' ').slice(0, 250));
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 20000 }); await page.waitForTimeout(1500);
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 20000 });
  console.log('imgCount after enqueue (expect 4):', imgCount, 'textCalls', textCalls);
  await page.screenshot({ path: 'app.png' }); await page.click('#queueBtn'); await page.screenshot({ path: 'queue.png' });
  await flow.screenshot({ path: 'flow.png' });
  console.log('ERRORS:', errors.join('\n') || 'none');
  await ctx.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
