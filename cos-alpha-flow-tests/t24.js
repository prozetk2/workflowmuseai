// 1.11.0 Motion Studio: every clip gets its own Flow video. Flow signs result links anew when the grid redraws, so
// the previous clip's video must not be taken as the new one (the user saw clips 2–8 all get clip 2's video).
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
  // Each Flow result is a different file (clip1 = v.mp4, clip2 = v2.mp4, clip3 = v.mp4 …).
  await ctx.route('https://flow.google.com/**', route => {
    const m = route.request().url().match(/\/media\/clip(\d+)\.mp4/);
    if (m) return route.fulfill({ contentType: 'video/mp4', body: Number(m[1]) % 2 ? MP4 : OTHER });
    return route.fulfill({ contentType: 'text/html', body: FAKE });
  });
  const errors = [];
  const flow = await ctx.newPage(); flow.on('pageerror', e => errors.push('flow:' + e.message));
  await flow.goto('https://flow.google.com/project/abc'); await flow.waitForTimeout(1000);
  await flow.evaluate(() => { window.__flowState.resign = true; });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('motion:' + e.message)); page.on('dialog', d => d.accept());
  await page.goto(`chrome-extension://${id}/motion.html`); await page.waitForTimeout(1000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
  const videoFile = path.join(tmp, 'source.mp4'), charFile = path.join(tmp, 'character.png');
  fs.writeFileSync(videoFile, MP4); fs.writeFileSync(charFile, png(120, 160, [200, 60, 60]));
  await page.setInputFiles('#msSourceInput', videoFile);
  await page.waitForFunction(() => window.__cosAlphaMotion?.state.project.source, null, { timeout: 20000 });
  await page.setInputFiles('#msCharInput', charFile);
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.chars.length === 1);
  const duration = await page.evaluate(() => window.__cosAlphaMotion.state.project.source.duration);
  await page.evaluate(len => { const s = window.__cosAlphaMotion.state.project.settings; s.clipLen = len; s.pace = 0; }, Math.round(duration / 3 * 100) / 100);
  await page.click('#msSplit');
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.clips.length && !document.querySelector('#msSplit').disabled, null, { timeout: 120000 });
  await page.click('#msGenerate');
  await page.waitForFunction(() => { const s = window.__cosAlphaMotion.state; return !s.running && s.project.clips.every(c => !['idle', 'running'].includes(c.status)); }, null, { timeout: 240000 });
  const clips = await page.evaluate(async () => { const s = window.__cosAlphaMotion.state; const out = []; for (const c of s.project.clips) { const url = s.resultUrls.get(c.id); out.push({ s: c.status, e: (c.error || '').slice(0, 100), key: c.resultKey, size: url ? (await (await fetch(url)).blob()).size : 0 }); } return out; });
  const sent = await flow.evaluate(() => window.__flowState.sent.length);
  console.log(JSON.stringify(clips), sent);
  check('Có ít nhất 2 đoạn và tạo xong cả', clips.length >= 2 && clips.every(c => c.s === 'success'), JSON.stringify(clips));
  check('Mỗi đoạn lấy đúng video mới của nó (không lấy lại video đoạn trước)', clips.every((c, i) => /\/media\/clip(\d+)\.mp4$/.test(c.key) && c.key.endsWith(`clip${i + 1}.mp4`)), clips.map(c => c.key).join(' | '));
  check('Video các đoạn liền nhau khác nhau', clips.every((c, i) => !i || c.size !== clips[i - 1].size), clips.map(c => c.size).join(','));
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
