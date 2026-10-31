// 1.6.1 canvas: node on/off switch (skipped by Chạy tất cả), card zoom 1x / 1.5x / 2x, wire dropped on empty canvas
// opens the node picker with only the nodes that fit that port, and connects the pick.
const { chromium } = require('playwright');
const { check, summary } = require('./common');
const EXT = process.argv[2];
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = sw.url().split('/')[2];
  await ctx.route('https://flow.google.com/**', r => r.fulfill({ contentType: 'text/html', body: '<h1>Flow</h1>' }));
  const errors = []; const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(`chrome-extension://${id}/app.html`); await p.waitForTimeout(1800);
  await p.evaluate(() => document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => m.classList.add('hidden')));
  const gen = '.node[data-type="generateImage"]';
  const genData = () => p.evaluate(() => { const n = window.__cosAlphaApp.state.nodes.find(x => x.type === 'generateImage'); return { ...n.data, asset: undefined }; });

  // On/off switch
  check('Node Tạo ảnh có công tắc bật/tắt, đang bật', await p.getAttribute(`${gen} .ts-switch`, 'aria-checked') === 'true');
  await p.click(`${gen} .ts-switch`); await p.waitForTimeout(150);
  const off = await p.evaluate(sel => { const el = document.querySelector(sel); return { cls: el.classList.contains('ts-off'), sw: el.querySelector('.ts-switch').getAttribute('aria-checked'), note: !!el.querySelector('.ts-offnote'), badge: !!el.querySelector('.ts-order') }; }, gen);
  check('Tắt node: thẻ mờ, hiện "Đã tắt", mất số thứ tự chạy', off.cls && off.sw === 'false' && off.note && !off.badge, JSON.stringify(off));
  check('Trạng thái tắt được lưu vào node', (await genData()).disabled === true);
  const run = await p.evaluate(async () => {
    const a = window.__cosAlphaApp, hooks = window.__cosAlphaHooks, prev = hooks.onRunStart; let ids = null;
    hooks.onRunStart = payload => { ids = payload.ids; return prev?.(payload); };
    const t0 = Date.now(); a.execute(); while (a.state.isRunning && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100));
    hooks.onRunStart = prev; const g = a.state.nodes.find(x => x.type === 'generateImage');
    return { ids, done: !a.state.isRunning, status: g.data.status || 'idle', error: g.data.error || '' };
  });
  check('Chạy tất cả bỏ qua node đang tắt (không tạo, không báo lỗi)', run.done && Array.isArray(run.ids) && run.ids.length === 0 && run.status !== 'running' && !run.error, JSON.stringify(run));
  await p.click('[data-ts-tool="undo-2"]'); await p.waitForTimeout(150);
  check('Ctrl+Z / Hoàn tác bật lại node', (await genData()).disabled !== true && await p.getAttribute(`${gen} .ts-switch`, 'aria-checked') === 'true');
  await p.click(`${gen} .ts-switch`); await p.click(`${gen} .ts-switch`); await p.waitForTimeout(100);
  check('Bấm công tắc lần nữa bật lại, số thứ tự quay lại', (await genData()).disabled !== true && await p.locator(`${gen} .ts-order`).count() === 1);

  // Card zoom
  const widths = [];
  for (let i = 0; i < 3; i++) { await p.hover(gen); await p.click(`${gen} .ts-toolbar .ts-zoom`); await p.waitForTimeout(120); widths.push(await p.evaluate(sel => [document.querySelector(sel).offsetWidth, document.querySelector(`${sel} .ts-preview`).offsetHeight, document.querySelector(`${sel} .ts-zoom small`).textContent], gen)); }
  check('Nút phóng to đổi thẻ 1.5x → 2x → 1x (rộng 450 → 600 → 300)', widths[0][0] === 450 && widths[1][0] === 600 && widths[2][0] === 300 && widths[0][1] > 270 && widths[1][1] > widths[0][1] && widths[2][2] === '1x', JSON.stringify(widths));

  // Wire from an output dropped on empty canvas
  const drag = async (sel, x, y) => { const b = await p.locator(sel).boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(b.x + (x - b.x) * i / 8, b.y + (y - b.y) * i / 8); await p.mouse.up(); await p.waitForTimeout(200); };
  const nodesBefore = await p.evaluate(() => window.__cosAlphaApp.state.nodes.length);
  await drag(`${gen} .port.out[data-port="image"]`, 1200, 760);
  const outPick = await p.evaluate(() => { const el = document.querySelector('.ts-picker.ts-picker-wire'); return el && { caption: el.querySelector('.ts-picker-caption')?.textContent, items: [...el.querySelectorAll('.ts-picker-item b')].map(b => b.textContent), groups: [...el.querySelectorAll('.ts-picker-group')].map(g => g.textContent) }; });
  check('Thả dây "ảnh" ra chỗ trống mở hộp chọn node kèm chú thích', outPick && /ảnh/.test(outPick.caption), JSON.stringify(outPick?.caption));
  check('Hộp chỉ có node nhận được ảnh (có Xem trước, Tạo video; không có Câu lệnh)', outPick && outPick.items.includes('Xem trước') && outPick.items.includes('Tạo video') && !outPick.items.includes('Câu lệnh (Prompt)') && outPick.groups.includes('Nối vào node có sẵn'), JSON.stringify(outPick?.items));
  await p.keyboard.type('tao video'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  const outEdge = await p.evaluate(() => { const a = window.__cosAlphaApp, v = a.state.nodes.at(-1), g = a.state.nodes.find(x => x.type === 'generateImage'); return { type: v.type, edge: a.state.edges.some(e => e.source === g.id && e.sourcePort === 'image' && e.target === v.id && e.targetPort === 'reference'), wire: a.state.connectingFrom }; });
  check('Chọn "Tạo video": tạo node và tự nối ảnh → ảnh tham chiếu', outEdge.type === 'generateVideo' && outEdge.edge && !outEdge.wire && (await p.evaluate(() => window.__cosAlphaApp.state.nodes.length)) === nodesBefore + 1, JSON.stringify(outEdge));

  // Wire from an input dropped on empty canvas
  await drag(`${gen} .port.in[data-port="reference"]`, 260, 700);
  const inPick = await p.evaluate(() => { const el = document.querySelector('.ts-picker.ts-picker-wire'); return el && [...el.querySelectorAll('.ts-picker-item b')].map(b => b.textContent); });
  check('Kéo từ cổng "ảnh tham chiếu" ra chỗ trống: chỉ hiện node cho ra ảnh', inPick && inPick.includes('Ảnh đầu vào') && inPick.includes('Gom ảnh tham chiếu') && !inPick.includes('Câu lệnh (Prompt)') && !inPick.includes('Xem trước'), JSON.stringify(inPick));
  await p.keyboard.type('anh dau vao'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  const inEdge = await p.evaluate(() => { const a = window.__cosAlphaApp, i = a.state.nodes.at(-1), g = a.state.nodes.find(x => x.type === 'generateImage'); return { type: i.type, edge: a.state.edges.some(e => e.source === i.id && e.sourcePort === 'image' && e.target === g.id && e.targetPort === 'reference'), leftOf: i.x < g.x }; });
  check('Chọn "Ảnh đầu vào": tạo node bên trái và nối vào ảnh tham chiếu', inEdge.type === 'imageInput' && inEdge.edge && inEdge.leftOf, JSON.stringify(inEdge));

  // Cancel leaves no half-made wire; connecting to an existing node works
  await drag(`${gen} .port.out[data-port="image"]`, 1200, 760);
  await p.keyboard.press('Escape');
  check('Esc đóng hộp, không để lại dây dở', !(await p.locator('.ts-picker').count()) && await p.evaluate(() => !window.__cosAlphaApp.state.connectingFrom));
  const edgesBefore = await p.evaluate(() => window.__cosAlphaApp.state.edges.length);
  await drag('.node[data-type="prompt"] .port.out[data-port="text"]', 760, 790);
  await p.keyboard.type('tao video'); await p.waitForTimeout(100);
  const pickedExisting = await p.evaluate(() => [...document.querySelectorAll('.ts-picker-item b')].map(b => b.textContent));
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  const ex = await p.evaluate(() => { const a = window.__cosAlphaApp, v = a.state.nodes.at(-1), pr = a.state.nodes.find(x => x.type === 'prompt'); return { n: a.state.nodes.length, edge: a.state.edges.some(e => e.source === pr.id && e.target === v.id && e.targetPort === 'prompt') }; });
  check('Dây chữ thả ra chỗ trống: chọn được node có sẵn hoặc node mới, nối đúng cổng câu lệnh', (await p.evaluate(() => window.__cosAlphaApp.state.edges.length)) === edgesBefore + 1 && pickedExisting.includes('Tạo video') && pickedExisting.includes('Tạo video · câu lệnh') && ex.edge, JSON.stringify({ pickedExisting, ex }));

  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  check('Không có lỗi JavaScript', !errors.length);
  await ctx.close();
  process.exit(summary() ? 1 : 0);
})();
