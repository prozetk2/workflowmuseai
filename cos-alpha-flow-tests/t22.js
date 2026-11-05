// 1.9.0 Motion Studio dialogue: Gemini transcribes each clip (and translates), the clip prompt asks Flow to say
// the line with a new described voice and to show subtitles; lines can be edited by hand.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const FAKE = fs.readFileSync(__dirname + '/fake-flow-direct.html', 'utf8');
const MP4 = fs.readFileSync(__dirname + '/v.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  await ctx.route('https://flow.google.com/**', route => {
    const url = route.request().url();
    if (/\/media\/clip\d+\.mp4/.test(url)) return route.fulfill({ contentType: 'video/mp4', body: MP4 });
    return route.fulfill({ contentType: 'text/html', body: FAKE });
  });
  const geminiCalls = [];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const parts = body.contents?.[0]?.parts || [];
    geminiCalls.push({ user: parts[0]?.text || '', media: parts.slice(1).map(p => p.inlineData?.mimeType) });
    const wantsTranslation = /translate it into Vietnamese/.test(parts[0]?.text || '');
    const json = { has_speech: true, language: 'English', text: 'This speaker has two hundred watts.', translation: wantsTranslation ? 'Chiếc loa này có công suất hai trăm oát.' : '' };
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] } });
  });
  await ctx.route(/https:\/\/gemini\.google\.com\/.*/, r => r.fulfill({ contentType: 'text/html', body: fs.readFileSync(__dirname + '/fake-chat.html', 'utf8') }));
  const errors = [];
  const flow = await ctx.newPage(); flow.on('pageerror', e => errors.push('flow:' + e.message));
  await flow.goto('https://flow.google.com/project/abc'); await flow.waitForTimeout(1000);
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('motion:' + e.message)); page.on('dialog', d => d.accept());
  await page.goto(`chrome-extension://${id}/motion.html`); await page.waitForTimeout(1000); await page.evaluate(() => document.querySelectorAll(".ms-side details").forEach(d => { d.open = true; }));
  await page.evaluate(() => chrome.storage.local.set({ thekeyGeminiApiKey: 'test-key' }));
  // The signed-in Gemini tab (fake page); Motion Studio reuses the tab it knows, as the canvas does.
  const gemini = await ctx.newPage(); await gemini.goto('https://gemini.google.com/app'); await gemini.waitForTimeout(800);
  await page.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://gemini.google.com/*' }); await chrome.storage.session.set({ cosalphaChatTabs: { 'gemini-web': tab.id } }); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
  const videoFile = path.join(tmp, 'source.mp4'), charFile = path.join(tmp, 'character.png');
  fs.writeFileSync(videoFile, MP4); fs.writeFileSync(charFile, png(120, 160, [200, 60, 60]));
  await page.setInputFiles('#msSourceInput', videoFile);
  await page.waitForFunction(() => window.__cosAlphaMotion?.state.project.source, null, { timeout: 20000 });
  await page.setInputFiles('#msCharInput', charFile);
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.chars.length === 1);
  await page.evaluate(() => { const s = window.__cosAlphaMotion.state.project.settings; s.clipLen = 8; s.pace = 0; s.autoFinish = false; s.sceneAI = false; });
  await page.click('#msSplit');
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.clips.length && !document.querySelector('#msSplit').disabled, null, { timeout: 120000 });
  // Dialogue settings through the page controls.
  await page.check('#msSync'); await page.fill('#msVoiceDesc', 'giọng cô gái 24 tuổi'); await page.check('#msSubtitles'); await page.selectOption('#msTranslate', 'Vietnamese');
  check('Ô mô tả giọng hiện khi bật đồng bộ lời thoại', await page.isVisible('#msVoiceDesc'));
  await page.click('#msTranscribeAll');
  await page.waitForFunction(() => window.__cosAlphaMotion.state.project.clips.every(c => c.transcript), null, { timeout: 30000 });
  const t = await page.evaluate(() => window.__cosAlphaMotion.state.project.clips[0].transcript);
  console.log(JSON.stringify(t), JSON.stringify(geminiCalls[0]));
  const chatTab = ctx.pages().find(p => /gemini\.google\.com/.test(p.url()));
  const chat = chatTab ? await chatTab.evaluate(() => ({ files: window.__chat.files, sent: window.__chat.sent.length })) : null;
  console.log('chat', JSON.stringify(chat));
  check('Mặc định chép lời qua tab Gemini (không cần API key): gửi âm thanh .wav của đoạn vào ô chat', chat?.files?.length >= 1 && chat.files[0].type === 'audio/wav' && /\.wav$/.test(chat.files[0].name) && geminiCalls.length === 0, JSON.stringify(chat));
  check('Nhận lời thoại + bản dịch từ câu trả lời của Gemini', t.has_speech && /two hundred watts/.test(t.text) && /hai trăm oát/.test(t.translation), JSON.stringify(t));
  check('Thẻ đoạn hiện lời thoại', /Lời thoại: This speaker/.test(await page.textContent('#msClips')));
  await page.click('#msGenerate');
  await page.waitForFunction(() => { const s = window.__cosAlphaMotion.state; return !s.running && s.project.clips.every(c => !['idle', 'running'].includes(c.status)); }, null, { timeout: 120000 });
  const sent = await flow.evaluate(() => window.__flowState.sent);
  const prompt = sent[0]?.text || '';
  console.log(prompt);
  check('Câu lệnh có lời thoại đã dịch, giọng mới theo mô tả', /speaks in Vietnamese/.test(prompt) && /Timeline \(seconds[^)]*\): 0\.2–1\.6 s: "Chiếc loa này có công suất hai trăm oát\."/.test(prompt) && /giọng cô gái 24 tuổi/.test(prompt) && /not the voice of the reference video/.test(prompt), prompt.slice(-300));
  check('Câu lệnh có phụ đề đúng dòng thoại', /Subtitles: burned-in[^"]*"Chiếc loa này/.test(prompt));
  const chatAsks = await chatTab.evaluate(() => window.__chat.sent.length);
  check('Không hỏi Gemini lại khi đã có lời thoại cùng ngôn ngữ dịch', chatAsks === chat.sent, `${chatAsks} lần hỏi`);
  // Edit the line by hand in the clip dialog, then regenerate: the edited line is used.
  await page.click('.ms-clip');
  await page.fill('#msModalTranslation', 'Loa này mạnh lắm nha.');
  await page.click('#msModalSaveDialogue');
  await page.click('#msModalRegen');
  await page.waitForFunction(n => window.__flowState === undefined || true, sent.length);
  await page.waitForFunction(() => { const s = window.__cosAlphaMotion.state; return !s.running; }, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const sent2 = await flow.evaluate(() => window.__flowState.sent);
  check('Sửa tay lời thoại rồi tạo lại: dùng đúng dòng đã sửa, không hỏi Gemini nữa', /Loa này mạnh lắm nha/.test(sent2.at(-1)?.text || '') && (await chatTab.evaluate(() => window.__chat.sent.length)) === chat.sent, sent2.at(-1)?.text.slice(-200));
  // The other choice: the Gemini API (with a key).
  await page.selectOption('#msSpeechAgent', 'gemini-api');
  await page.click('.ms-clip'); await page.click('#msModalTranscribe');
  for (let i = 0; i < 40 && !geminiCalls.length; i++) await page.waitForTimeout(500);
  check('Chọn Gemini API: gửi âm thanh .wav của đoạn tới API', geminiCalls.length === 1 && geminiCalls[0].media[0] === 'audio/wav', JSON.stringify(geminiCalls));
  check('Không có lỗi JavaScript trên trang', !errors.length, errors.join(' | '));
  const failed = summary();
  await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
