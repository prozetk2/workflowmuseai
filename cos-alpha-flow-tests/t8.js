// Auto-open Flow, ChatGPT / Gemini web script writing with best-model pick, Gemini API best (Pro) model.
const { chromium } = require('playwright');
const fs = require('fs');
const { check, summary } = require('./common');
const EXT = process.argv[2];
const CHAT = fs.readFileSync(__dirname + '/fake-chat.html', 'utf8');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1300, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = sw.url().split('/')[2];
  await ctx.route('https://flow.google.com/**', r => r.fulfill({ contentType: 'text/html', body: '<h1>Flow home</h1><button>Đăng nhập</button>' }));
  await ctx.route(/https:\/\/(chatgpt\.com|gemini\.google\.com)\/.*/, r => r.fulfill({ contentType: 'text/html', body: CHAT }));
  const used = [];
  await ctx.route('https://generativelanguage.googleapis.com/**', r => {
    const url = r.request().url();
    if (r.request().method() === 'GET') return r.fulfill({ json: { models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-pro-preview', 'gemini-3-pro-image-preview', 'gemini-pro-latest'].map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) } });
    used.push(/models\/([^:]+)/.exec(url)[1]);
    return r.fulfill({ json: { candidates: [{ content: { parts: [{ text: 'CẢNH 1 (0:00–0:08): A\n\nPrompt ảnh: x' }] } }] } });
  });
  const errors = [];
  const app = await ctx.newPage(); app.on('pageerror', e => errors.push(e.message));
  await app.goto(`chrome-extension://${id}/app.html`); await app.waitForTimeout(2500);
  // Tabs opened by the extension load before Playwright can route them, so count them through chrome.tabs.
  const flowCount = () => app.evaluate(async () => (await chrome.tabs.query({})).filter(t => /^https:\/\/flow\.google\.com/.test(t.url || t.pendingUrl || '')).length);
  check('Mở app → tự mở Google Flow (1 tab)', await flowCount() === 1, String(await flowCount()));
  await app.reload(); await app.waitForTimeout(2500);
  check('Mở lại app khi Flow đã mở: không mở thêm', await flowCount() === 1, String(await flowCount()));
  // Pre-open the chat tabs from the test so routing applies, and let the app reuse them.
  for (const u of ['https://chatgpt.com/', 'https://gemini.google.com/app']) { const p = await ctx.newPage(); await p.goto(u); }
  await app.evaluate(async () => { const t = await chrome.tabs.query({}); const id = rx => t.find(x => rx.test(x.url)).id; await chrome.storage.session.set({ cosalphaChatTabs: { chatgpt: id(/chatgpt/), 'gemini-web': id(/gemini/) } }); });
  await app.click('#closeWelcomeBtn').catch(() => {});
  await app.evaluate(async () => { await chrome.storage.local.set({ thekeyGeminiApiKey: 'K' }); });
  await app.click('#aiScriptOpen'); await app.fill('#aiIdea', 'người tiền sử phát hiện lửa');
  for (const [target, expectModel] of [['chatgpt', 'Thinking'], ['gemini-web', 'Pro']]) {
    await app.bringToFront();
    await app.evaluate(() => { document.querySelector('#scriptInput').value = ''; });
    await app.click(`[data-ai-write="${target}"]`);
    await app.waitForFunction(() => /ok|error/.test(document.querySelector('#aiScriptStatus').className), null, { timeout: 60000 }).catch(() => {});
    const status = await app.textContent('#aiScriptStatus'), script = await app.inputValue('#scriptInput');
    const chat = ctx.pages().find(p => p.url().includes(target === 'chatgpt' ? 'chatgpt.com' : 'gemini.google.com'));
    const log = chat ? await chat.evaluate(() => window.__chat) : {};
    check(`${target}: gửi đúng 1 lệnh, chọn model "${expectModel}" (bỏ qua gói phải nâng cấp)`, log.sent?.length === 1 && log.model === expectModel && /Prompt video/.test(log.sent[0]), `model=${log.model} sent=${log.sent?.length}`);
    check(`${target}: kịch bản về ô Kịch bản, sạch (không có "Copy code")`, /^NHÂN VẬT: Ugg/.test(script) && /CẢNH 2/.test(script) && !/Copy code|plaintext/.test(script), status.slice(0, 120));
  }
  // Run ChatGPT again: reuses the same tab with a fresh chat.
  const before = ctx.pages().length;
  await app.bringToFront(); await app.click('[data-ai-write="chatgpt"]');
  await app.waitForFunction(() => /ok|error/.test(document.querySelector('#aiScriptStatus').className) && /Xong|lỗi|Không/.test(document.querySelector('#aiScriptStatus').textContent), null, { timeout: 60000 }).catch(() => {});
  check('Viết lại: dùng lại tab ChatGPT cũ, không mở thêm tab', ctx.pages().length === before, `${before} → ${ctx.pages().length}`);
  // Gemini API: strongest Pro model when the box is empty.
  await app.click('[data-ai-write="gemini-api"]');
  await app.waitForFunction(() => /^Xong/.test(document.querySelector('#aiScriptStatus').textContent), null, { timeout: 20000 }).catch(() => {});
  check('Gemini API: tự chọn Pro mới nhất (gemini-3-pro-preview)', used.at(-1) === 'gemini-3-pro-preview', `${used.join(',')} | ${await app.textContent('#aiScriptStatus')}`);
  // Setting off: no auto open.
  await app.evaluate(() => chrome.storage.local.set({ cosalphaAutoOpenFlow: false }));
  await app.evaluate(async () => { for (const t of await chrome.tabs.query({})) if (/flow\.google/.test(t.url || t.pendingUrl || '')) await chrome.tabs.remove(t.id); });
  await app.reload(); await app.waitForTimeout(2500);
  check('Tắt "Tự mở Google Flow" thì không mở', await flowCount() === 0);
  await app.screenshot({ path: 'f8-app.png' });
  check('Không có lỗi JavaScript', !errors.length, errors.join(' | '));
  const failed = summary(); await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
