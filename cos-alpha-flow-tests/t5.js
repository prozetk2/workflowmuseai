// Gemini API mode end to end: Script → Scenes (image + video), Character Lock, Veo polling, end frames,
// Timeline MP4 export (FFmpeg), save/reload, workflow file export/import, Video Reference node.
const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const MP4 = [fs.readFileSync(__dirname + '/v.mp4'), fs.readFileSync(__dirname + '/v2.mp4')];
const SCRIPT = `NHÂN VẬT: Ugg — a prehistoric clay boy, messy brown hair, fur tunic

CẢNH 1 (0:00–0:04): Hang đá

Prompt ảnh: clay boy Ugg in a cave, 16:9

Prompt video: Ugg looks around the cave

CẢNH 2 (0:04–0:08): Tia lửa

Prompt ảnh: clay boy Ugg strikes stones, sparks, 16:9

Prompt video: sparks fly and a small fire starts`;
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, acceptDownloads: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  const calls = []; let ops = 0; const polls = {};
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => {
    const req = route.request(), url = req.url();
    if (/:predictLongRunning/.test(url)) { const body = JSON.parse(req.postData()); ops++; calls.push({ kind: 'video', key: req.headers()['x-goog-api-key'], prompt: body.instances[0].prompt, image: Boolean(body.instances[0].image), refs: (body.instances[0].referenceImages || []).length, params: body.parameters }); return route.fulfill({ json: { name: `models/veo/operations/op${ops}` } }); }
    const op = /operations\/op(\d+)/.exec(url);
    if (op) { polls[op[1]] = (polls[op[1]] || 0) + 1; return route.fulfill({ json: polls[op[1]] < 2 ? { name: 'x', done: false } : { name: 'x', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `https://generativelanguage.googleapis.com/v1beta/files/f${op[1]}:download?alt=media` } }] } } } }); }
    const file = /files\/f(\d+):download/.exec(url);
    if (file) return route.fulfill({ contentType: 'video/mp4', body: MP4[(Number(file[1]) - 1) % 2] });
    if (req.method() === 'POST') { const body = JSON.parse(req.postData()); if (body.generationConfig?.responseModalities) { calls.push({ kind: 'image', prompt: body.contents[0].parts[0].text, refs: body.contents[0].parts.length - 1 }); return route.fulfill({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png(320, 180, [180, 120, 60]).toString('base64') } }] } }] } }); } }
    return route.fulfill({ json: { models: [] } });
  });
  const errors = [];
  let page = await ctx.newPage(); const watch = p => { p.on('pageerror', e => errors.push('app:' + e.message)); p.on('dialog', d => d.accept()); }; watch(page);
  await page.goto(`chrome-extension://${id}/app.html`); await page.waitForTimeout(800);
  await page.click('#closeWelcomeBtn').catch(() => {});
  await page.evaluate(async () => { await chrome.storage.local.set({ thekeyGeminiApiKey: 'FAKEKEY-SECRET' }); const s = window.__cosAlphaApp.state; s.settings.provider = 'api'; s.nodes.length = 0; s.edges.length = 0; window.__cosAlphaApp.render(); });
  await page.evaluate(text => { document.querySelector('#scriptInput').value = text; document.querySelector('#buildScriptNodes').click(); }, SCRIPT);
  await page.waitForTimeout(600);
  const built = await page.evaluate(() => { const s = window.__cosAlphaApp.state; const t = s.nodes.find(n => n.type === 'timeline'); return { img: s.nodes.filter(n => n.type === 'generateImage').length, vid: s.nodes.filter(n => n.type === 'generateVideo').length, chars: s.nodes.filter(n => n.type === 'character').map(n => n.data.name), clips: t?.data.clipOrder?.length }; });
  check('Kịch bản → Cảnh: 2 ảnh, 2 video, 1 nhân vật, Timeline 2 clip', built.img === 2 && built.vid === 2 && built.chars.length === 1 && built.clips === 2, JSON.stringify(built));
  await page.click('#runBtn');
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 150000 }); await page.waitForTimeout(1500);
  const st = await page.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => /generate/.test(n.type)).map(n => ({ t: n.type, s: n.data.status, e: (n.data.error || '').slice(0, 90), k: n.data.asset?.kind, end: Boolean(n.data.endFrame?.url) })));
  console.log(JSON.stringify(st)); console.log(JSON.stringify(calls.map(c => ({ ...c, prompt: c.prompt.replace(/\s+/g, ' ').slice(0, 200) }))));
  check('Chạy cả workflow bằng Gemini API: 4/4 thành công', st.every(n => n.s === 'success'), st.map(n => n.s).join(','));
  check('Veo: gửi 2 lượt, chờ (poll) rồi tải video về', calls.filter(c => c.kind === 'video').length === 2 && Object.values(polls).every(v => v >= 2));
  check('Video lấy ảnh cảnh làm khung đầu', calls.filter(c => c.kind === 'video').every(c => c.image && c.refs === 0));
  check('Khoá nhân vật được thêm vào mọi prompt', calls.every(c => /Character lock: Ugg/.test(c.prompt)));
  check('Video có khung cuối', st.filter(n => n.t === 'generateVideo').every(n => n.end));
  check('API key không nằm trong prompt/URL', calls.every(c => !/FAKEKEY/.test(c.prompt)));
  // Timeline MP4 export with FFmpeg (one clip has audio, one has none → re-encode path).
  await page.selectOption('#timelineExportFormat', 'mp4');
  const dl = page.waitForEvent('download', { timeout: 120000 }).catch(() => null);
  await page.click('#timelineExportBtn', { force: true });
  await page.waitForFunction(() => !window.__cosAlphaApp.state.timelineExporting && /xuất|thất bại/i.test(document.querySelector('#runStatus').textContent), null, { timeout: 150000 }).catch(() => {});
  const status = await page.textContent('#runStatus');
  const exportedSize = await page.evaluate(async () => { const u = window.__cosAlphaApp.state.timelineExportUrl; if (!u) return 0; const b = await (await fetch(u)).arrayBuffer(); return b.byteLength; });
  let probe = '';
  if (exportedSize) { const b64 = await page.evaluate(async () => { const b = new Uint8Array(await (await fetch(window.__cosAlphaApp.state.timelineExportUrl)).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }); fs.writeFileSync('timeline-out.mp4', Buffer.from(b64, 'base64')); probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'csv=p=0', 'timeline-out.mp4']).toString().replace(/\s+/g, ' '); }
  check('Timeline xuất MP4 bằng FFmpeg (ghép 2 clip theo thời lượng cảnh 4+4 giây, có tiếng)', exportedSize > 1000 && /h264/.test(probe) && /aac/.test(probe), `${status} | ${exportedSize} bytes | ${probe}`);
  await dl;
  // Save, reload, everything still there and videos still playable.
  await page.evaluate(() => document.querySelector('#saveBtn')?.click()); await page.waitForTimeout(1500);
  await page.reload(); await page.waitForTimeout(2000); await page.click('#closeWelcomeBtn').catch(() => {});
  const after = await page.evaluate(async () => { const s = window.__cosAlphaApp.state; const vids = s.nodes.filter(n => n.type === 'generateVideo'); const dims = await Promise.all(vids.map(n => new Promise(r => { const v = document.createElement('video'); v.muted = true; v.onloadedmetadata = () => r(v.videoWidth); v.onerror = () => r(-1); setTimeout(() => r(0), 6000); v.src = n.data.asset?.url || ''; }))); return { nodes: s.nodes.length, statuses: s.nodes.filter(n => /generate/.test(n.type)).map(n => n.data.status), dims, provider: s.settings.provider }; });
  check('Tải lại trang: workflow + kết quả còn nguyên, video vẫn mở được', after.statuses.every(x => x === 'success') && after.dims.every(w => w === 320) && after.provider === 'api', JSON.stringify(after));
  // Workflow file export.
  const dl2 = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#workflowExportBtn', { force: true });
  const file = await (await dl2).path(); const json = fs.readFileSync(file, 'utf8'); const wf = JSON.parse(json);
  check('Xuất file workflow: nhúng ảnh/video, không chứa API key', !/FAKEKEY/.test(json) && wf.workflow.nodes.filter(n => n.type === 'generateVideo').every(n => /^data:video/.test(n.data.asset.url)), `${Math.round(json.length / 1024)} KB`);
  // Import into a cleared canvas.
  await page.evaluate(() => { const s = window.__cosAlphaApp.state; s.nodes.length = 0; s.edges.length = 0; window.__cosAlphaApp.render(); });
  await page.setInputFiles('#workflowFileInput', file); await page.waitForTimeout(2500);
  const imported = await page.evaluate(() => { const s = window.__cosAlphaApp.state; return { n: s.nodes.length, ok: s.nodes.filter(n => /generate/.test(n.type)).every(n => n.data.asset?.url) }; });
  check('Mở lại file workflow: đủ node và kết quả', imported.n === after.nodes && imported.ok, JSON.stringify(imported));
  // Video Reference node: cut 3 frames from a real video and send them as a start frame.
  await page.evaluate(() => { window.__cosAlphaApp.addNode('videoReference', 100, 100); });
  await page.waitForTimeout(300);
  const vrId = await page.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => n.type === 'videoReference').at(-1).id);
  await page.setInputFiles(`.node[data-id="${vrId}"] input[type=file]`, __dirname + '/v.mp4');
  await page.waitForFunction(id => (window.__cosAlphaApp.nodeById(id).data.frames || []).length === 3, vrId, { timeout: 30000 }).catch(() => {});
  const frames = await page.evaluate(id => (window.__cosAlphaApp.nodeById(id).data.frames || []).map(f => f.slice(0, 15)), vrId);
  check('Video tham chiếu: cắt được 3 khung hình', frames.length === 3 && frames.every(f => f.startsWith('data:image/jpeg')), JSON.stringify(frames));
  const before = calls.length;
  const vgen = await page.evaluate(id => { const A = window.__cosAlphaApp, s = A.state; const vr = A.nodeById(id); vr.data.motion = 'walks forward and waves'; const p = A.makeNode('prompt', 0, 0); p.data = { text: 'a man in a park' }; const g = A.makeNode('generateVideo', 300, 0); g.data = { size: '16:9', duration: 8, status: 'idle' }; s.nodes.push(p, g); s.edges.push({ id: A.uid('edge'), source: p.id, sourcePort: 'text', target: g.id, targetPort: 'prompt' }, { id: A.uid('edge'), source: vr.id, sourcePort: 'image', target: g.id, targetPort: 'reference' }); A.render(); return g.id; }, vrId);
  await page.evaluate(id => { void window.__cosAlphaApp.executeGenerationNode(id); }, vgen);
  await page.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 60000 }); await page.waitForTimeout(500);
  const vcall = calls.slice(before).find(c => c.kind === 'video');
  check('Video tham chiếu → Tạo video: gửi khung đầu + mô tả chuyển động', vcall && vcall.image && /walks forward and waves/.test(vcall.prompt), vcall ? vcall.prompt.slice(-120) : 'no call');
  await page.screenshot({ path: 'f5-app.png' });
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
