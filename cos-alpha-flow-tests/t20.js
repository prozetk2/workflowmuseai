// 1.8.0 Motion Studio: source video → clips (FFmpeg) → each clip + character picture to Flow (Video · Thành phần)
// → results → merged final video. Uses the fake Flow page with "Tác nhân" off.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow-direct.html', 'utf8');
const MP4 = fs.readFileSync(__dirname + '/v.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, acceptDownloads: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
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
  // The toolbar button in the canvas opens Motion Studio.
  const app = await ctx.newPage(); app.on('pageerror', e => errors.push('app:' + e.message));
  await app.goto(`chrome-extension://${id}/app.html`); await app.waitForTimeout(800);
  await app.click('#closeWelcomeBtn').catch(() => {});
  const opened = ctx.waitForEvent('page');
  await app.click('#motionBtn');
  const page = await opened; page.on('pageerror', e => errors.push('motion:' + e.message)); page.on('dialog', d => d.accept());
  await page.waitForLoadState(); await page.waitForTimeout(800);
  check('Nút Motion Studio mở trang Motion Studio', /motion\.html/.test(page.url()), page.url());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
  const videoFile = path.join(tmp, 'source.mp4'), charFile = path.join(tmp, 'character.png');
  fs.writeFileSync(videoFile, MP4); fs.writeFileSync(charFile, png(120, 160, [200, 60, 60]));
  await page.setInputFiles('#msSourceInput', videoFile);
  await page.waitForFunction(() => window.__cosAlphaMotion?.state.project.source, null, { timeout: 20000 });
  const source = await page.evaluate(() => window.__cosAlphaMotion.state.project.source);
  console.log('source', JSON.stringify(source));
  check('Nạp video gốc, đọc được độ dài', source.duration > 0, String(source.duration));
  await page.setInputFiles('#msCharInput', charFile);
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.chars.length === 1);
  // Clips of 1 s, so the short test video gives several clips (the length list starts at 4 s in the UI).
  const duration = source.duration, wanted = Math.round(duration / 2.5 * 100) / 100;
  await page.evaluate(len => { window.__cosAlphaMotion.state.project.settings.clipLen = len; window.__cosAlphaMotion.state.project.settings.pace = 0; window.__cosAlphaMotion.state.project.settings.sceneAI = false; }, wanted);
  await page.click('#msSplit');
  await page.waitForFunction(() => { const s = window.__cosAlphaMotion.state; return s.project.clips.length && !document.querySelector('#msSplit').disabled; }, null, { timeout: 120000 });
  const clips = await page.evaluate(() => window.__cosAlphaMotion.state.project.clips.map(c => ({ start: c.start, end: c.end, thumb: Boolean(c.thumb) })));
  console.log('clips', JSON.stringify(clips));
  check('Cắt thành các đoạn liền nhau, có ảnh xem trước', clips.length >= 1 && clips.every(c => c.thumb) && Math.abs(clips.at(-1).end - duration) < 0.05, JSON.stringify(clips));
  await page.click('#msGenerate');
  const finished = await page.waitForFunction(() => { const s = window.__cosAlphaMotion.state; return !s.running && s.project.clips.every(c => c.status !== 'idle' && c.status !== 'running'); }, null, { timeout: 240000 }).then(() => true, () => false);
  const st = await page.evaluate(() => window.__cosAlphaMotion.state.project.clips.map(c => ({ s: c.status, e: (c.error || '').slice(0, 120), r: c.result })));
  const sent = await flow.evaluate(() => window.__flowState.sent);
  console.log('status', JSON.stringify(st), JSON.stringify(sent));
  check('Tạo hết các đoạn, không treo', finished && st.every(c => c.s === 'success' && c.r), JSON.stringify(st));
  check('Mỗi đoạn gửi 1 lần ở Video · Thành phần, kèm 1 video + 1 ảnh nhân vật', sent.length === clips.length && sent.every(s => s.mode === 'video' && s.vtype === 'ingredients' && s.videos === 1 && s.attachments === 1), JSON.stringify(sent));
  check('Câu lệnh: nhân vật ảnh 1, giữ nguyên bối cảnh, đồ vật, thao tác tay; không viết "replace the person"', sent.every(s => /Image 1 is the character/.test(s.text) && /Keep exactly as in the reference video/.test(s.text) && /the hands grip, lift, cut, open/i.test(s.text) && /Real-world physics/.test(s.text) && !/replace the person/i.test(s.text)));
  check('Ảnh nhân vật gắn trước, đoạn video gắn sau (nhân vật là ảnh 1)', sent.every(s => s.order === 'image,video'), sent.map(s => s.order).join(' | '));
  check('Motion Studio dùng mô hình đã chọn (mặc định Omni 1.1 Flash)', sent.every(s => s.model === 'Omni 1.1 Flash'), sent.map(s => s.model).join(','));
  check('Tỉ lệ theo video gốc (ngang → 16:9)', sent.every(s => s.aspect === (source.width >= source.height ? '16:9' : '9:16')), sent.map(s => s.aspect).join(','));
  await page.click('#msMerge');
  await page.waitForFunction(() => window.__cosAlphaMotion.state.finalUrl || /thất bại/.test(document.querySelector('#msStatus').textContent), null, { timeout: 240000 });
  const final = await page.evaluate(async () => { const s = window.__cosAlphaMotion.state; if (!s.finalUrl) return { error: document.querySelector('#msStatus').textContent }; const b = await (await fetch(s.finalUrl)).blob(); const v = document.createElement('video'); v.src = s.finalUrl; await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; }); return { size: b.size, duration: v.duration, w: v.videoWidth }; });
  console.log('final', JSON.stringify(final));
  check('Ghép thành video hoàn chỉnh dài bằng video gốc', final.size > 1000 && Math.abs(final.duration - duration) < 0.4, JSON.stringify(final));
  // Reload: the project (clips, results, final) is still there.
  await page.waitForTimeout(800);
  const stored = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('cosalpha-motion'); r.onsuccess = () => { const q = r.result.transaction('meta').objectStore('meta').get('project'); q.onsuccess = () => res({ clips: (q.result?.clips || []).map(c => c.status + ':' + c.result), final: Boolean(q.result?.final) }); q.onerror = () => res('ERR ' + q.error); }; }));
  console.log('stored', JSON.stringify(stored));
  await page.reload(); await page.waitForTimeout(1500);
  const again = await page.evaluate(() => ({ clips: window.__cosAlphaMotion.state.project.clips.filter(c => c.result).length, final: Boolean(window.__cosAlphaMotion.state.finalUrl), source: Boolean(window.__cosAlphaMotion.state.sourceUrl) }));
  check('Tải lại trang vẫn giữ video gốc, kết quả và video cuối', again.clips === clips.length && again.final && again.source, JSON.stringify(again));
  await page.screenshot({ path: 'f20-motion.png' });
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
