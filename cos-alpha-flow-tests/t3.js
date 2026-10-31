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
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 440, height: 950 }, acceptDownloads: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  const calls = []; let img = 0;
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => {
    const req = route.request(); if (req.method() !== 'POST') return route.fulfill({ json: { models: [] } });
    const body = JSON.parse(req.postData()); const sys = body.systemInstruction?.parts?.[0]?.text || ''; const user = body.contents[0].parts[0].text || '';
    const text = t => route.fulfill({ json: { candidates: [{ content: { parts: [{ text: t }] } }] } });
    if (body.generationConfig?.responseModalities) { img++; calls.push({ kind: 'image', prompt: user, refs: body.contents[0].parts.length - 1 }); await new Promise(r => setTimeout(r, 600)); return route.fulfill({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png(90, 160, [img * 50, 100, 200]).toString('base64') } }] } }] } }); }
    calls.push({ kind: 'text', sys: sys.slice(0, 40), user: user.slice(0, 60) });
    if (/describe images as generation prompts/i.test(sys)) return text(JSON.stringify({ en: 'A golden retriever on a beach at sunset', vi: 'Chó vàng trên biển lúc hoàng hôn', short: 'dog on beach' }));
    if (/Write 3 different/.test(sys)) return text('Prompt alpha one\n\nPrompt beta two\n\nPrompt gamma three');
    if (/prompt engineer/i.test(sys)) return text('Detailed english A\n\nDetailed english B');
    return text('ok');
  });
  const errors = [];
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('panel:' + e.message)); page.on('dialog', d => d.accept());
  await page.goto(`chrome-extension://${id}/panel.html`); await page.waitForURL(/view=panel/); await page.waitForTimeout(800);
  await page.evaluate(async () => { await chrome.storage.local.set({ thekeyGeminiApiKey: 'FAKEKEY' }); window.__cosAlphaApp.state.settings.provider = 'api'; });
  // Prompt assistant
  await page.fill('#qpPrompts', 'cô gái cầm hoa\n\nchú mèo ngủ');
  await page.click('#qpAssist'); await page.waitForTimeout(800);
  console.log('assist ->', JSON.stringify(await page.inputValue('#qpPrompts')), '|', await page.textContent('#qpStatus'));
  // Preset
  await page.click('#qpMoreBtn'); await page.selectOption('#qpPreset', 'angles'); await page.click('#qpMoreBtn'); console.log('preset count:', await page.textContent('#qpCount'));
  // Character
  await page.click('[data-qp="characters"]'); await page.waitForTimeout(300);
  await page.locator('#cosCharImage').setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: png(60, 60, [220, 170, 140]) }); await page.waitForTimeout(400);
  await page.fill('#cosCharName', 'Lan Anh'); await page.fill('#cosCharDesc', 'young Vietnamese woman, long black hair'); await page.click('[data-cadd]'); await page.waitForTimeout(300);
  console.log('characters:', (await page.innerText('.cos-c-list')).replace(/\s+/g, ' '));
  await page.screenshot({ path: 'p-chars.png' });
  await page.click('[data-qp="gen"]');
  await page.fill('#qpPrompts', '1. @lan_anh đứng trên cầu\n2. chiếc xe đạp cũ');
  await page.selectOption('#qpStyle', 'film35');
  await page.screenshot({ path: 'p-gen.png', fullPage: true });
  await page.click('#qpGo'); await page.waitForTimeout(400);
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning && !document.querySelector('#qpQueueBadge:not(.hidden)'), null, { timeout: 30000 }); await page.waitForTimeout(800);
  console.log('image calls:', JSON.stringify(calls.filter(c => c.kind === 'image').map(c => ({ refs: c.refs, p: c.prompt.replace(/\s+/g, ' ').slice(0, 170) }))));
  // History + prompts
  await page.click('[data-qp="history"]'); await page.waitForTimeout(700);
  console.log('history:', (await page.innerText('#cosDrawerBody')).replace(/\s+/g, ' ').slice(0, 200));
  await page.screenshot({ path: 'p-history.png' });
  await page.locator('[data-hsave]').first().click(); await page.waitForTimeout(300);
  await page.click('[data-qp="prompts"]'); await page.waitForTimeout(300);
  console.log('prompts:', (await page.innerText('.cos-p-list')).replace(/\s+/g, ' ').slice(0, 150));
  // I2P via storage (as the context menu does)
  await page.evaluate(async () => chrome.storage.local.set({ cosalphaI2P: { image: (() => { const c = document.createElement('canvas'); c.width = c.height = 40; c.getContext('2d').fillStyle = 'orange'; c.getContext('2d').fillRect(0, 0, 40, 40); return c.toDataURL('image/png'); })(), at: Date.now(), consumed: false } }));
  await page.waitForTimeout(1200);
  console.log('i2p modal visible:', await page.isVisible('#i2pModal'), 'out:', await page.inputValue('#i2pOut'));
  await page.screenshot({ path: 'p-i2p.png' });
  await page.click('[data-i2p="use"]'); await page.waitForTimeout(300);
  console.log('after use, prompts box:', JSON.stringify(await page.inputValue('#qpPrompts')).slice(0, 120));
  // Album inbox
  await page.evaluate(async () => chrome.storage.local.set({ cosalphaAlbumInbox: { image: (() => { const c = document.createElement('canvas'); c.width = c.height = 30; return c.toDataURL('image/png'); })(), at: Date.now(), pageUrl: 'https://example.com/x', consumed: false } }));
  await page.waitForTimeout(800); await page.click('[data-qp="album"]'); await page.waitForTimeout(600);
  console.log('album cards:', await page.locator('.cos-a-card').count());
  // Full view: AI Agent -> Text Extract -> Generate -> Download
  const full = await ctx.newPage(); full.on('pageerror', e => errors.push('full:' + e.message)); full.on('dialog', d => d.accept());
  await full.setViewportSize({ width: 1400, height: 900 });
  await full.goto(`chrome-extension://${id}/app.html`); await full.waitForTimeout(1000);
  await full.click('#closeWelcomeBtn').catch(() => {});
  const res = await full.evaluate(async () => {
    const a = window.__cosAlphaApp, s = a.state; s.settings.provider = 'api';
    s.nodes = []; s.edges = [];
    const p = a.makeNode('prompt', 0, 0); p.data = { text: 'quảng cáo cà phê' };
    const ag = a.makeNode('aiAgent', 320, 0); ag.data.mode = 'list'; ag.data.count = 3;
    const ex = a.makeNode('textExtract', 640, 0); ex.data.index = 2;
    const g = a.makeNode('generateImage', 960, 0); g.data = { model: '', size: '9:16', status: 'idle' };
    const dl = a.makeNode('download', 1280, 0); dl.data.folder = 'test_cos';
    s.nodes.push(p, ag, ex, g, dl);
    const e = (src, sp, tgt, tp) => s.edges.push({ id: a.uid('edge'), source: src.id, sourcePort: sp, target: tgt.id, targetPort: tp });
    e(p, 'text', ag, 'text'); e(ag, 'text', ex, 'text'); e(ex, 'text', g, 'prompt'); e(g, 'image', dl, 'media');
    a.render(); await a.execute();
    return { agent: ag.data.resultText, agentStatus: ag.data.status, extract: s.nodes.find(n => n.type === 'textExtract') && document.querySelector(`[data-id="${ex.id}"] .extract-preview`)?.textContent, gen: g.data.status, genErr: g.data.error, dl: dl.data.status, dlErr: dl.data.error, downloaded: dl.data.downloaded.length };
  });
  console.log('workflow:', JSON.stringify(res));
  console.log('last image prompt:', calls.filter(c => c.kind === 'image').pop().prompt.slice(0, 60));
  await full.screenshot({ path: 'f-nodes.png' });
  console.log('ERRORS:', errors.join('\n') || 'none');
  await ctx.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
