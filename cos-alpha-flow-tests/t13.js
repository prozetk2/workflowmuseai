// Prompt Assistant + ChatGPT web, 1.5: finish detected by the turn's copy button even when a "Stop" button never goes away,
// live progress, result screen (Đưa vào / Chép / Quay lại), the chat is deleted afterwards (can be turned off),
// and "Lấy câu trả lời ngay" when the reply never settles.
const { chromium } = require('playwright');
const fs = require('fs');
const { check, summary } = require('./common');
const EXT = process.argv[2];
const CHAT = fs.readFileSync(__dirname + '/fake-chat.html', 'utf8');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1200, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = sw.url().split('/')[2];
  await ctx.route(/https:\/\/(chatgpt\.com|gemini\.google\.com)\/.*/, r => r.fulfill({ contentType: 'text/html', body: CHAT }));
  await ctx.route('https://flow.google.com/**', r => r.fulfill({ contentType: 'text/html', body: '<h1>Flow</h1>' }));
  const chat = await ctx.newPage(); await chat.goto('https://chatgpt.com/');
  const errors = []; const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.setViewportSize({ width: 430, height: 940 }); await p.goto(`chrome-extension://${id}/panel.html`); await p.waitForTimeout(1200);
  await p.evaluate(async () => { const t = await chrome.tabs.query({ url: 'https://chatgpt.com/*' }); await chrome.storage.session.set({ cosalphaChatTabs: { chatgpt: t[0].id } }); });
  await p.click('#qpAssistOpen'); await p.waitForTimeout(300);
  check('Ô "Xoá đoạn chat" ẩn khi dùng Gemini API', await p.locator('#paCleanWrap').isHidden());
  await p.click('[data-paeng="chatgpt"]');
  check('Ô "Xoá đoạn chat" hiện và bật sẵn khi chọn ChatGPT', await p.locator('#paCleanWrap').isVisible() && await p.isChecked('#paCleanup'));
  // 1) A "Stop" button that never disappears: finished by the copy button of the reply turn, well before the 15 s fallback.
  await p.fill('#paInput', 'STUCKSTOP con cáo trong tuyết');
  const t0 = Date.now(); await p.click('#paGo');
  await p.waitForSelector('#paResult:not(.hidden)', { timeout: 60000 }).catch(() => {});
  const took = (Date.now() - t0) / 1000;
  const r1 = await p.evaluate(() => ({ title: document.querySelector('#paResultTitle').textContent, meta: document.querySelector('#paResultMeta').textContent, cards: [...document.querySelectorAll('#paResultList [data-pares]')].map(t => t.value), status: document.querySelector('#paStatus').textContent }));
  check('Nút Stop kẹt: vẫn nhận xong nhờ nút sao chép của lượt trả lời (< 14 giây)', r1.cards.length === 1 && /red fox/.test(r1.cards[0]) && took < 14, `${took}s ${JSON.stringify(r1)}`);
  const deleted = await chat.evaluate(() => window.__chat?.deleted || null).catch(() => null);
  check('Tự xoá đúng đoạn chat vừa tạo trên ChatGPT', deleted === '/c/68f1a2b3-test' && /Đã xoá đoạn chat trên ChatGPT/.test(r1.meta), `${deleted} | ${r1.meta}`);
  await p.screenshot({ path: 'pa-result-1.png' });
  // Edit the card, copy, go back and forth, then put it into the prompt box.
  await p.fill('[data-pares="0"]', 'A red fox sits in fresh snow at dawn, edited.');
  await p.click('[data-pacopy="0"]'); await p.waitForTimeout(200);
  check('Nút Chép đổi thành "Đã chép"', /Đã chép/.test(await p.textContent('[data-pacopy="0"]')));
  await p.click('#paBack'); await p.waitForTimeout(200);
  check('Quay lại: về form, ý tưởng vẫn còn', await p.locator('#paForm').isVisible() && await p.inputValue('#paInput') === 'STUCKSTOP con cáo trong tuyết' && await p.locator('#paResult').isHidden());
  await p.click('#paGo'); await p.waitForSelector('#paResult:not(.hidden)', { timeout: 60000 }).catch(() => {});
  await p.click('#paClose'); await p.click('#qpAssistOpen'); await p.waitForTimeout(200);
  check('Đóng rồi mở lại: kết quả chưa dùng vẫn còn', await p.locator('#paResult').isVisible());
  await p.fill('[data-pares="0"]', 'A red fox sits in fresh snow at dawn, edited.\n\nEnd: it trots away.');
  await p.click('#paUse'); await p.waitForTimeout(300);
  const q = await p.evaluate(() => ({ hidden: document.querySelector('#paModal').classList.contains('hidden'), text: document.querySelector('#qpPrompts').value, count: document.querySelector('#qpCount').textContent, status: document.querySelector('#qpStatus').textContent }));
  check('"Đưa vào cos_alpha_flow": prompt đã sửa vào ô Prompt, tính là 1 prompt, đóng hộp thoại', q.hidden && q.text === 'A red fox sits in fresh snow at dawn, edited.\nEnd: it trots away.' && /^1 prompt/.test(q.count) && /Đã đưa 1 prompt/.test(q.status), JSON.stringify(q));
  // 2) Cleanup off + a reply that never settles: "Lấy câu trả lời ngay" takes it.
  await p.click('#qpAssistOpen'); await p.waitForTimeout(200);
  check('Mở lại sau khi đưa vào: về form', await p.locator('#paForm').isVisible());
  await p.uncheck('#paCleanup'); await p.waitForTimeout(200);
  check('Tắt xoá đoạn chat được lưu lại', (await p.evaluate(() => chrome.storage.local.get('cosalphaChatCleanup'))).cosalphaChatCleanup === false);
  await chat.waitForTimeout(100);
  await p.fill('#paInput', 'NEVERDONE ngọn hải đăng');
  await p.click('#paGo');
  await p.waitForSelector('#paTake:not(.hidden)', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(9000);
  const writing = await p.textContent('#paStatus');
  check('Đang viết: báo "ChatGPT đang viết… N giây · N ký tự", có nút "Lấy câu trả lời ngay"', /ChatGPT đang viết… \d+ giây · \d+ ký tự/.test(writing) && await p.locator('#paTake').isVisible(), writing);
  await p.click('#paTake');
  await p.waitForSelector('#paResult:not(.hidden)', { timeout: 10000 }).catch(() => {});
  const r2 = await p.evaluate(() => ({ cards: [...document.querySelectorAll('#paResultList [data-pares]')].map(t => t.value), meta: document.querySelector('#paResultMeta').textContent, take: document.querySelector('#paTake').classList.contains('hidden') }));
  const chat2 = ctx.pages().find(x => x.url().startsWith('https://chatgpt.com'));
  const deleted2 = await chat2.evaluate(() => window.__chat?.deleted || null).catch(() => 'err');
  check('Lấy câu trả lời ngay: có kết quả, không xoá chat khi đã tắt', r2.cards.length === 1 && /lighthouse/.test(r2.cards[0]) && !deleted2 && !/xoá/.test(r2.meta) && r2.take, `${deleted2} ${JSON.stringify(r2)}`);
  await p.setViewportSize({ width: 1280, height: 720 }); await p.waitForTimeout(200); await p.screenshot({ path: 'pa-result-wide.png' });
  check('Không có lỗi JS', !errors.length, errors.join(' | '));
  const failed = summary(); await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
