// 1.17.1 "Không thể chỉnh sửa lời nói trong video này": counted as a sound failure → Flow's silent setting on and the
// clip sent once more without its sound; with "Dùng âm thanh của video gốc" the clip goes out silent from the start.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow-direct.html', 'utf8');
const MP4 = fs.readFileSync(__dirname + '/v.mp4'), SILENT = fs.readFileSync(__dirname + '/v2.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  await ctx.route('https://flow.google.com/**', route => /\/media\/clip\d+\.mp4/.test(route.request().url()) ? route.fulfill({ contentType: 'video/mp4', body: MP4 }) : route.fulfill({ contentType: 'text/html', body: FAKE }));
  const errors = [];
  const flow = await ctx.newPage(); flow.on('pageerror', e => errors.push('flow:' + e.message));
  await flow.goto('https://flow.google.com/project/abc'); await flow.waitForTimeout(1000);
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('motion:' + e.message)); page.on('dialog', d => d.accept());
  await page.goto(`chrome-extension://${id}/motion.html`); await page.waitForTimeout(1000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
  const videoFile = path.join(tmp, 'source.mp4'), charFile = path.join(tmp, 'character.png');
  fs.writeFileSync(videoFile, MP4); fs.writeFileSync(charFile, png(120, 160, [200, 60, 60]));
  await page.setInputFiles('#msSourceInput', videoFile);
  await page.waitForFunction(() => window.__cosAlphaMotion?.state.project.source, null, { timeout: 20000 });
  await page.setInputFiles('#msCharInput', charFile);
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.chars.length === 1);
  await page.evaluate(() => { const s = window.__cosAlphaMotion.state.project.settings; s.clipLen = 8; s.pace = 0; s.sceneAI = false; s.autoFinish = false; s.audioMode = 'auto'; s.prompt = s.prompt + ' SPEECHFAIL'; });
  await page.click('#msSplit');
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.clips.length && !document.querySelector('#msSplit').disabled, null, { timeout: 120000 });
  await page.click('#msGenerate');
  await page.waitForFunction(() => { const s = window.__cosAlphaMotion.state; return !s.running && s.project.clips.every(c => !['idle', 'running'].includes(c.status)); }, null, { timeout: 180000 });
  const clip = await page.evaluate(() => { const c = window.__cosAlphaMotion.state.project.clips[0]; return { s: c.status, e: c.error }; });
  const fl = await flow.evaluate(() => ({ sent: window.__flowState.sent.length, silent: window.__flowState.silentFallback, sizes: window.__flowState.videoSizes || [] }));
  console.log(JSON.stringify(clip), JSON.stringify(fl));
  check('"Không thể chỉnh sửa lời nói": tự bật trả video không tiếng và gửi lại đúng 1 lần, đoạn thành công', clip.s === 'success' && fl.sent === 2 && fl.silent === true, JSON.stringify({ clip, fl }));
  check('Lần gửi lại dùng đoạn gốc đã bỏ tiếng (file nhỏ hơn lần đầu)', fl.sizes.length >= 2 && fl.sizes.at(-1) < fl.sizes[0], JSON.stringify(fl.sizes));
  // With "Dùng âm thanh của video gốc" the clip goes out without sound from the first send.
  await page.evaluate(() => { const s = window.__cosAlphaMotion.state.project.settings; s.audioMode = 'original'; s.prompt = s.prompt.replace(' SPEECHFAIL', ''); });
  await page.click('.ms-clip'); await page.click('#msModalRegen');
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !window.__cosAlphaMotion.state.running, null, { timeout: 120000 });
  const sizes = await flow.evaluate(() => window.__flowState.videoSizes || []);
  check('Âm thanh gốc: gửi Flow đoạn không tiếng ngay từ đầu', sizes.at(-1) === sizes[1] && sizes.at(-1) < sizes[0], JSON.stringify(sizes));
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
