// 1.15.0 Motion Studio like TobyFlow: a location picture (image 2, the room is not kept), voice modes (lip sync with
// the original voice put back at merge, voice-over narration), and many videos in one go (cut, make, merge, save each).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow-direct.html', 'utf8');
const MP4 = fs.readFileSync(__dirname + '/v.mp4'), OTHER = fs.readFileSync(__dirname + '/v2.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, acceptDownloads: true, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
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
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('motion:' + e.message)); page.on('dialog', d => d.accept());
  await page.goto(`chrome-extension://${id}/motion.html`); await page.waitForTimeout(1000); await page.evaluate(() => document.querySelectorAll(".ms-side details").forEach(d => { d.open = true; }));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
  const videoFile = path.join(tmp, 'source.mp4'), charFile = path.join(tmp, 'character.png'), bgFile = path.join(tmp, 'beach.png');
  const second = path.join(tmp, 'second.mp4');
  fs.writeFileSync(videoFile, MP4); fs.writeFileSync(second, MP4); fs.writeFileSync(charFile, png(120, 160, [200, 60, 60])); fs.writeFileSync(bgFile, png(160, 120, [40, 120, 220]));
  await page.setInputFiles('#msSourceInput', videoFile);
  await page.waitForFunction(() => window.__cosAlphaMotion?.state.project.source, null, { timeout: 20000 });
  await page.setInputFiles('#msCharInput', charFile);
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.chars.length === 1);
  // 1) Location picture.
  check('Có ô ảnh bối cảnh', await page.isVisible('#msBgDrop'));
  await page.setInputFiles('#msBgInput', bgFile);
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.bgs.length === 1);
  await page.evaluate(() => { const s = window.__cosAlphaMotion.state.project.settings; s.clipLen = 8; s.pace = 0; s.sceneAI = false; s.parallel = 1; });
  await page.click('#msSplit');
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.clips.length && !document.querySelector('#msSplit').disabled, null, { timeout: 120000 });
  // A spoken line for the clip, typed by hand (as the clip dialog allows).
  await page.evaluate(() => { const c = window.__cosAlphaMotion.state.project.clips[0]; c.transcript = { has_speech: true, language: 'English', text: 'This chair is great.', translation: '', segments: [{ start: 0.2, end: 1.4, text: 'This chair is great.', translation: '' }], target: '', manual: true }; });
  await page.check('#msSync'); await page.selectOption('#msVoiceMode', 'lipsync');
  await page.click('#msGenerate');
  await page.waitForFunction(() => { const s = window.__cosAlphaMotion.state; return !s.running && s.project.clips.every(c => !['idle', 'running'].includes(c.status)); }, null, { timeout: 180000 });
  let sent = await flow.evaluate(() => window.__flowState.sent.map(x => ({ text: x.text, images: x.attachments, videos: x.videos })));
  const first = sent[0] || { text: '' };
  console.log(first.images, first.videos, first.text.slice(0, 500));
  check('Ảnh bối cảnh gửi kèm thành ảnh 2 (nhân vật + bối cảnh + video)', first.images === 2 && first.videos === 1, `${first.images}/${first.videos}`);
  check('Câu lệnh: ảnh 2 là địa điểm mới, không còn câu giữ căn phòng gốc', /Image 2 is the new location/.test(first.text) && !/background, furniture and their positions/.test(first.text) && /in the location of image 2/.test(first.text), first.text.slice(0, 400));
  check('Khẩu hình theo giọng gốc: câu Lip sync + chỉ tiếng phòng (giọng gốc ghép sau)', /Lip sync: the character says exactly the original words/.test(first.text) && /This chair is great/.test(first.text) && /the original voice is added afterwards/.test(first.text) && !/a new voice/.test(first.text), first.text.slice(-400));
  await page.click('#msMerge');
  await page.waitForFunction(() => window.__cosAlphaMotion.state.finalUrl || /thất bại/.test(document.querySelector('#msStatus').textContent), null, { timeout: 180000 });
  check('Ghép bản khẩu hình dùng âm thanh (giọng) của video gốc', await page.evaluate(() => window.__cosAlphaMotion.state.project.final?.audio === 'original'));
  // 2) Voice-over narration.
  await page.selectOption('#msVoiceMode', 'narration'); await page.fill('#msVoiceDesc', 'giọng nam trầm');
  await page.click('.ms-clip'); await page.click('#msModalRegen');
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !window.__cosAlphaMotion.state.running, null, { timeout: 120000 });
  sent = await flow.evaluate(() => window.__flowState.sent.map(x => x.text));
  const narr = sent.at(-1) || '';
  check('Thuyết minh: giọng đọc bên ngoài, nhân vật không nói', /Voice-over: a narrator/.test(narr) && /The character does not talk/.test(narr) && /giọng nam trầm/.test(narr), narr.slice(-400));
  // 3) Many videos in one go.
  await page.evaluate(() => { window.__cosAlphaMotion.state.project.bgs = []; window.__cosAlphaMotion.state.project.settings.sync = false; });
  const before = await flow.evaluate(() => window.__flowState.sent.length);
  await page.setInputFiles('#msBatchInput', [videoFile, second]);
  check('Danh sách nhiều video có 2 dòng', (await page.$$('.ms-batch-row')).length === 2);
  const downloads = [];
  ctx.on('page', () => {});
  page.on('download', d => downloads.push(d.suggestedFilename()));
  await page.click('#msBatchRun');
  await page.waitForFunction(() => [...document.querySelectorAll('.ms-batch-row')].every(r => /done|error|stopped/.test(r.className)), null, { timeout: 300000 });
  const rows = await page.$$eval('.ms-batch-row', rs => rs.map(r => r.className + ' | ' + r.textContent));
  const after = await flow.evaluate(() => window.__flowState.sent.length);
  console.log(JSON.stringify(rows), after - before, JSON.stringify(downloads));
  check('Chạy cả 2 video: mỗi video cắt, tạo trên Flow, ghép và lưu', rows.every(r => /done/.test(r) && /đã lưu motion-/.test(r)), JSON.stringify(rows));
  check('Mỗi video gửi Flow đủ số đoạn của nó', after - before >= 2, String(after - before));
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
