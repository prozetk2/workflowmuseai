// 1.17.0 One button, no chores: with Flow only on its home page and "Tác nhân" switched on, "Tạo video" opens the
// recent project, switches Tác nhân off, cuts the clips, makes them on Flow, merges and saves the final video.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
// Flow's project page with the "Tác nhân" chip on (a click switches it off).
const FAKE = fs.readFileSync(__dirname + '/fake-flow-direct.html', 'utf8')
  .replace('class="agent-mode-chip" aria-pressed="false"', 'class="agent-mode-chip" aria-pressed="true" onclick="this.setAttribute(\'aria-pressed\', this.getAttribute(\'aria-pressed\') === \'true\' ? \'false\' : \'true\'); window.__flowState.agentOffClicks = (window.__flowState.agentOffClicks || 0) + 1;"');
const HOME = '<!doctype html><html><head><meta charset="utf-8"><title>Google Flow</title></head><body><h1>Flow</h1><a href="/project/11111111-2222-3333-4444-555555555555">Dự án gần đây</a><button>Dự án mới</button></body></html>';
const MP4 = fs.readFileSync(__dirname + '/v.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, acceptDownloads: true, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  await ctx.route('https://flow.google.com/**', route => {
    const url = route.request().url();
    if (/\/media\/clip\d+\.mp4/.test(url)) return route.fulfill({ contentType: 'video/mp4', body: MP4 });
    if (/\/project\//.test(url)) return route.fulfill({ contentType: 'text/html', body: FAKE });
    return route.fulfill({ contentType: 'text/html', body: HOME });
  });
  const errors = [];
  const flow = await ctx.newPage(); flow.on('pageerror', e => errors.push('flow:' + e.message));
  await flow.goto('https://flow.google.com/'); await flow.waitForTimeout(1000);
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('motion:' + e.message)); page.on('dialog', d => d.accept());
  const downloads = []; page.on('download', d => downloads.push(d.suggestedFilename()));
  await page.goto(`chrome-extension://${id}/motion.html`); await page.waitForTimeout(1500);
  check('Chưa có video: nút chính ghi "Chọn video gốc", có dòng hướng dẫn 3 bước', /Chọn video gốc/.test(await page.textContent('#msGenerate')) && /Bước 1/.test(await page.textContent('#msCost')));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
  const videoFile = path.join(tmp, 'demo.mp4'), charFile = path.join(tmp, 'character.png');
  fs.writeFileSync(videoFile, MP4); fs.writeFileSync(charFile, png(120, 160, [200, 60, 60]));
  await page.setInputFiles('#msSourceInput', videoFile);
  await page.waitForFunction(() => window.__cosAlphaMotion?.state.project.source, null, { timeout: 20000 });
  check('Có video, chưa có nhân vật: nút chính nhắc thêm ảnh nhân vật', /Thêm ảnh nhân vật/.test(await page.textContent('#msGenerate')));
  await page.setInputFiles('#msCharInput', charFile);
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.chars.length === 1);
  await page.evaluate(() => { const s = window.__cosAlphaMotion.state.project.settings; s.clipLen = 8; s.pace = 0; s.sceneAI = false; });
  check('Đủ video + nhân vật: nút "Tạo video", hiện số đoạn và tín dụng ước tính', /Tạo video/.test(await page.textContent('#msGenerate')) && /tín dụng/.test(await page.textContent('#msCost')), await page.textContent('#msCost'));
  // One click, no "Cắt thành đoạn", no Flow project open, Tác nhân on.
  await page.click('#msGenerate');
  await page.waitForFunction(() => window.__cosAlphaMotion.state.finalUrl && /Xong!/.test(document.querySelector('#msStatus').textContent), null, { timeout: 240000 }).catch(() => {});
  const status = await page.textContent('#msStatus');
  const st = await page.evaluate(() => ({ clips: window.__cosAlphaMotion.state.project.clips.map(c => c.status), final: Boolean(window.__cosAlphaMotion.state.project.final) }));
  const flowUrl = flow.url();
  const flowState = await flow.evaluate(() => ({ sent: window.__flowState?.sent.length || 0, agentOffClicks: window.__flowState?.agentOffClicks || 0, chip: document.querySelector('.agent-mode-chip')?.getAttribute('aria-pressed') })).catch(() => ({}));
  console.log(status, JSON.stringify(st), flowUrl, JSON.stringify(flowState), JSON.stringify(downloads));
  check('Tự mở dự án Flow gần nhất từ trang chủ Flow', /\/project\/11111111/.test(flowUrl), flowUrl);
  check('Tự tắt "Tác nhân" trong Flow', flowState.agentOffClicks === 1 && flowState.chip === 'false', JSON.stringify(flowState));
  check('Tự cắt đoạn và tạo hết các đoạn trên Flow', st.clips.length >= 1 && st.clips.every(s => s === 'success') && flowState.sent === st.clips.length, JSON.stringify(st));
  check('Tự ghép và lưu video hoàn chỉnh, báo "Xong!" kèm tên file', st.final && /Xong! Video hoàn chỉnh đã lưu vào thư mục Tải xuống: motion-demo\.mp4/.test(status), status);
  check('Có lượt tải video hoàn chỉnh', downloads.length >= 1, JSON.stringify(downloads));
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
