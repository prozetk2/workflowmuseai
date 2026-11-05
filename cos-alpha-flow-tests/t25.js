// 1.12.0 Like TobyFlow: the bridge follows Flow's own replies (item id, state, error codes) instead of guessing from
// the grid; Motion Studio runs 2 clips at once, picks the character picture from Flow's library after the first
// upload, and a refusal code stops the clip at once.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow-direct.html', 'utf8');
const MP4 = fs.readFileSync(__dirname + '/v.mp4'), OTHER = fs.readFileSync(__dirname + '/v2.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  await ctx.route('https://flow.google.com/**', route => {
    const m = route.request().url().match(/\/media\/clip(\d+)\.mp4/);
    if (m) return route.fulfill({ contentType: 'video/mp4', body: Number(m[1]) % 2 ? MP4 : OTHER });
    return route.fulfill({ contentType: 'text/html', body: FAKE });
  });
  const errors = [];
  const flow = await ctx.newPage(); flow.on('pageerror', e => errors.push('flow:' + e.message));
  await flow.goto('https://flow.google.com/project/abc'); await flow.waitForTimeout(1000);
  // Flow's prompt box takes a moment per send, and generation takes 1.5 s: with 2 in flight the run overlaps.
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('motion:' + e.message)); page.on('dialog', d => d.accept());
  await page.goto(`chrome-extension://${id}/motion.html`); await page.waitForTimeout(1000);
  check('Có ô "Chạy cùng lúc", mặc định 2 đoạn', (await page.inputValue('#msParallel')) === '2');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
  const videoFile = path.join(tmp, 'source.mp4'), charFile = path.join(tmp, 'character.png');
  fs.writeFileSync(videoFile, MP4); fs.writeFileSync(charFile, png(120, 160, [200, 60, 60]));
  await page.setInputFiles('#msSourceInput', videoFile);
  await page.waitForFunction(() => window.__cosAlphaMotion?.state.project.source, null, { timeout: 20000 });
  await page.setInputFiles('#msCharInput', charFile);
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.chars.length === 1);
  const duration = await page.evaluate(() => window.__cosAlphaMotion.state.project.source.duration);
  await page.evaluate(len => { const s = window.__cosAlphaMotion.state.project.settings; s.clipLen = len; s.pace = 0; }, Math.round(duration / 3.2 * 100) / 100);
  await page.click('#msSplit');
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.clips.length && !document.querySelector('#msSplit').disabled, null, { timeout: 120000 });
  const count = await page.evaluate(() => window.__cosAlphaMotion.state.project.clips.length);
  // Watch how many clips are in flight at once.
  await page.evaluate(() => { window.__maxRunning = 0; setInterval(() => { const n = window.__cosAlphaMotion.state.project.clips.filter(c => c.status === 'running').length; window.__maxRunning = Math.max(window.__maxRunning, n); }, 100); });
  const t0 = Date.now();
  await page.click('#msGenerate');
  await page.waitForFunction(() => { const s = window.__cosAlphaMotion.state; return !s.running && s.project.clips.every(c => !['idle', 'running'].includes(c.status)); }, null, { timeout: 240000 });
  const took = (Date.now() - t0) / 1000;
  const clips = await page.evaluate(async () => { const s = window.__cosAlphaMotion.state; const out = []; for (const c of s.project.clips) { const url = s.resultUrls.get(c.id); out.push({ s: c.status, e: (c.error || '').slice(0, 120), key: c.resultKey, size: url ? (await (await fetch(url)).blob()).size : 0 }); } return out; });
  const fs2 = await flow.evaluate(() => ({ sent: window.__flowState.sent.length, uploads: window.__flowState.uploads.map(u => u.name), reused: window.__flowState.reused }));
  const maxRunning = await page.evaluate(() => window.__maxRunning);
  console.log(count, took, maxRunning, JSON.stringify(clips), JSON.stringify(fs2));
  check('Có ít nhất 3 đoạn, tạo xong cả', count >= 3 && clips.every(c => c.s === 'success'), JSON.stringify(clips));
  check('Kết quả lấy theo mã item Flow trả về (không đoán theo lưới)', clips.every(c => /^flow:[0-9a-f-]{36}$/.test(c.key || '')), clips.map(c => c.key).join(' | '));
  check('Mỗi đoạn đúng video của nó (lẻ = v.mp4, chẵn = v2.mp4)', clips.every((c, i) => c.size === clips[i % 2].size) && clips[0].size !== clips[1].size, clips.map(c => c.size).join(','));
  check('Chạy 2 đoạn cùng lúc', maxRunning === 2, String(maxRunning));
  const refUploads = fs2.uploads.filter(name => /^thekey-ref-/.test(name));
  check('Ảnh nhân vật chỉ tải lên 1 lần, các đoạn sau chọn lại trong thư viện Flow', refUploads.length === 1 && fs2.reused === count - 1, JSON.stringify(fs2));
  check('Mỗi đoạn gửi đúng 1 lần', fs2.sent === count, String(fs2.sent));
  // A refusal code in Flow's reply stops the clip right away (no waiting for the tile text).
  await page.evaluate(() => { const s = window.__cosAlphaMotion.state.project.settings; s.prompt = s.prompt + ' PEOPLEME'; s.parallel = 1; });
  const t1 = Date.now();
  await page.click('.ms-clip'); await page.click('#msModalRegen');
  await page.waitForFunction(() => { const s = window.__cosAlphaMotion.state; return !s.running && s.project.clips[0].status === 'error'; }, null, { timeout: 60000 }).catch(() => {});
  const refused = await page.evaluate(() => ({ s: window.__cosAlphaMotion.state.project.clips[0].status, e: window.__cosAlphaMotion.state.project.clips[0].error }));
  console.log(JSON.stringify(refused), (Date.now() - t1) / 1000);
  check('Mã từ chối của Flow (PROMINENT_PEOPLE) báo lỗi ngay, có tên mã', refused.s === 'error' && /PROMINENT_PEOPLE/.test(refused.e) && Date.now() - t1 < 20000, JSON.stringify(refused));
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
