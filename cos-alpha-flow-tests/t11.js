// Web providers: ChatGPT / Grok / Gemini web (chat-bridge.js) and Muse (muse-bridge.js) generate images and videos.
const { chromium } = require('playwright');
const fs = require('fs');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const GEN = fs.readFileSync(__dirname + '/fake-gen.html', 'utf8'), MUSE = fs.readFileSync(__dirname + '/fake-muse.html', 'utf8');
const MP4 = fs.readFileSync(__dirname + '/v.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1300, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = sw.url().split('/')[2];
  const media = r => { const u = r.request().url(); if (/\/gen\/\d+\.png/.test(u)) return r.fulfill({ contentType: 'image/png', body: png(512, 512, [250, 120, 20]) }); if (/\/gen\/\d+\.mp4/.test(u)) return r.fulfill({ contentType: 'video/mp4', body: MP4 }); return null; };
  await ctx.route(/https:\/\/(chatgpt\.com|grok\.com|gemini\.google\.com)\/.*/, r => media(r) || r.fulfill({ contentType: 'text/html', body: GEN }));
  await ctx.route(/https:\/\/lh3\.googleusercontent\.com\/.*/, r => media(r) || r.fulfill({ status: 404, body: '' }));
  await ctx.route(/https:\/\/muse\.ai\/.*/, r => media(r) || r.fulfill({ contentType: 'text/html', body: MUSE }));
  await ctx.route('https://flow.google.com/**', r => r.fulfill({ contentType: 'text/html', body: '<h1>Flow</h1>' }));
  const errors = [];
  const pages = {};
  for (const [k, u] of [['chatgpt', 'https://chatgpt.com/'], ['grok', 'https://grok.com/'], ['gemini', 'https://gemini.google.com/app'], ['muse', 'https://muse.ai/chat']]) { pages[k] = await ctx.newPage(); pages[k].on('pageerror', e => errors.push(k + ':' + e.message)); await pages[k].goto(u); }
  const app = await ctx.newPage(); app.on('pageerror', e => errors.push('app:' + e.message)); app.on('dialog', d => d.accept());
  await app.goto(`chrome-extension://${id}/app.html`); await app.waitForTimeout(800); await app.click('#closeWelcomeBtn').catch(() => {});
  await app.evaluate(async () => { const t = await chrome.tabs.query({}); const id = rx => t.find(x => rx.test(x.url)).id; await chrome.storage.session.set({ cosalphaChatTabs: { chatgpt: id(/chatgpt/), 'gemini-web': id(/gemini/), grok: id(/grok/) } }); });
  const refA = 'data:image/png;base64,' + png(64, 64, [200, 30, 30]).toString('base64'), refB = 'data:image/png;base64,' + png(64, 64, [30, 30, 200]).toString('base64');
  async function run(provider, type, text, refs = [], extra = {}) {
    return app.evaluate(async ({ provider, type, text, refs, extra }) => {
      const A = window.__cosAlphaApp, s = A.state; s.settings.provider = provider; s.nodes.length = 0; s.edges.length = 0;
      const mk = (t, data) => { const n = A.makeNode(t, 0, 0); Object.assign(n.data, data); s.nodes.push(n); return n; };
      const p = mk('prompt', { text }), g = mk(type, { size: '9:16', duration: 8, referenceMode: 'ingredients', ...extra });
      s.edges.push({ id: A.uid('edge'), source: p.id, sourcePort: 'text', target: g.id, targetPort: 'prompt' });
      refs.forEach((r, i) => { const im = mk('imageInput', { localDataUrl: r, name: `r${i}.png` }); s.edges.push({ id: A.uid('edge'), source: im.id, sourcePort: 'image', target: g.id, targetPort: 'reference' }); });
      A.render(); await A.executeGenerationNode(g.id);
      for (let i = 0; i < 120 && (s.isRunning || g.data.status === 'running'); i++) await new Promise(r => setTimeout(r, 500));
      return { status: g.data.status, error: g.data.error || '', kind: g.data.asset?.kind || '', url: (g.data.asset?.url || '').slice(0, 22) };
    }, { provider, type, text, refs, extra });
  }
  const r1 = await run('chatgpt', 'generateImage', 'a red fox in snow', [refA, refB]);
  const s1 = await pages.chatgpt.evaluate(() => window.__gen.sent.at(-1));
  check('ChatGPT ảnh + 2 ảnh tham chiếu (dán): thành công, ảnh lưu về máy', r1.status === 'success' && r1.kind === 'image' && r1.url.startsWith('data:image'), JSON.stringify(r1));
  check('ChatGPT nhận 2 ảnh và lời yêu cầu tạo ảnh 9:16', s1?.images === 2 && /Create one image, aspect ratio 9:16/.test(s1.text) && /a red fox in snow/.test(s1.text), JSON.stringify(s1));
  const r2 = await run('chatgpt', 'generateVideo', 'a fox runs');
  check('ChatGPT video: báo rõ là không hỗ trợ', r2.status === 'error' && /ChatGPT không tạo video/.test(r2.error), JSON.stringify(r2));
  const r3 = await run('grok', 'generateVideo', 'waves at sunset');
  const s3 = await pages.grok.evaluate(() => window.__gen.sent.at(-1));
  check('Grok video (ô textarea): thành công', r3.status === 'success' && r3.kind === 'video', JSON.stringify(r3));
  check('Grok nhận lời yêu cầu video 8 giây 9:16', /Create one video, 8 seconds long, aspect ratio 9:16/.test(s3?.text || ''), s3?.text?.slice(0, 80));
  const r4 = await run('gemini', 'generateImage', 'a cat astronaut', [refA]);
  const s4 = await pages.gemini.evaluate(() => window.__gen.sent.at(-1));
  check('Gemini ảnh + 1 ảnh (qua ô chọn file), ảnh khác tên miền vẫn lưu về máy', r4.status === 'success' && r4.url.startsWith('data:image') && s4?.images === 1, JSON.stringify({ r4, images: s4?.images }));
  const r5 = await run('grok', 'generateImage', 'REFUSE this please');
  check('Bị từ chối: node báo lỗi kèm lời của trang', r5.status === 'error' && /không tạo được|content policy/.test(r5.error), JSON.stringify(r5));
  const r6 = await run('muse', 'generateImage', 'a dancer on stage', [refA]);
  const s6 = await pages.muse.evaluate(() => window.__muse.sent.at(-1));
  check('Muse ảnh + 1 ảnh tham chiếu: thành công', r6.status === 'success' && r6.kind === 'image' && s6?.images === 1 && /Create one image/.test(s6.text), JSON.stringify({ r6, s6 }));
  const r7 = await run('muse', 'generateVideo', 'a dancer spins');
  check('Muse video: thành công', r7.status === 'success' && r7.kind === 'video', JSON.stringify(r7));
  // Side panel shows the five provider tabs.
  const panel = await ctx.newPage(); await panel.goto(`chrome-extension://${id}/panel.html`); await panel.waitForTimeout(1200);
  const provs = await panel.$$eval('[data-qprov]', b => b.map(x => x.textContent.trim()));
  check('Bảng bên có tab Flow, ChatGPT, Grok, Muse, Gemini (không còn Gemini API)', provs.join(',') === 'Flow,ChatGPT,Grok,Muse,Gemini', provs.join(','));
  await panel.screenshot({ path: 'p4-providers.png', clip: { x: 0, y: 380, width: 430, height: 200 } }).catch(() => {});
  check('Không có lỗi JS', !errors.length, errors.join(' | '));
  const failed = summary(); await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
