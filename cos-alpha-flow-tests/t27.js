// 1.14.0 Continuity (like TobyFlow): each clip after the first gets the last frame of the previous result as image 2
// and the prompt says to carry straight on from it; clips then run one at a time.

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
  check('Có ô "Nối tiếp giữa các đoạn", mặc định tắt', !(await page.isChecked('#msContinuity')));
  await page.check('#msContinuity');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
  const videoFile = path.join(tmp, 'source.mp4'), charFile = path.join(tmp, 'character.png');
  fs.writeFileSync(videoFile, MP4); fs.writeFileSync(charFile, png(120, 160, [200, 60, 60]));
  await page.setInputFiles('#msSourceInput', videoFile);
  await page.waitForFunction(() => window.__cosAlphaMotion?.state.project.source, null, { timeout: 20000 });
  await page.setInputFiles('#msCharInput', charFile);
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.chars.length === 1);
  const duration = await page.evaluate(() => window.__cosAlphaMotion.state.project.source.duration);
  await page.evaluate(len => { const s = window.__cosAlphaMotion.state.project.settings; s.clipLen = len; s.pace = 0; s.sceneAI = false; s.parallel = 2; }, Math.round(duration / 3.2 * 100) / 100);
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
  const sentFull = await flow.evaluate(() => window.__flowState.sent.map(x => ({ text: x.text, images: x.attachments, videos: x.videos })));
  console.log(JSON.stringify(sentFull.map(x => [x.images, x.videos, /Image 2 is the last frame of the previous clip/.test(x.text)])));
  check('Có ít nhất 3 đoạn, tạo xong cả', count >= 3 && clips.every(c => c.s === 'success'), JSON.stringify(clips));
  check('Bật nối tiếp: chạy lần lượt từng đoạn (dù ô chạy cùng lúc = 2)', maxRunning === 1, String(maxRunning));
  check('Đoạn 1: chỉ ảnh nhân vật + video; câu lệnh không nhắc ảnh 2', sentFull[0].images === 1 && sentFull[0].videos === 1 && !/Image 2 is the last frame/.test(sentFull[0].text), JSON.stringify(sentFull[0].images));
  check('Đoạn sau: thêm khung cuối đoạn trước làm ảnh 2, câu lệnh dặn nối tiếp', sentFull.slice(1).every(x => x.images === 2 && x.videos === 1 && /Image 2 is the last frame of the previous clip/.test(x.text)), JSON.stringify(sentFull.slice(1).map(x => x.images)));
  check('Câu nối tiếp nằm trong phần mô tả cảnh (trước phần giữ bối cảnh)', sentFull.slice(1).every(x => x.text.indexOf('Image 2 is the last frame') < x.text.indexOf('Keep exactly as in the reference video')));
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
