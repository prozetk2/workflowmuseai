// 1.7 multi-angle sheets: a model / outfit photo is turned into a sheet of several views before scenes use it.
// Auto-insert on drop / role change, manual button, "Kiểu ảnh" select, picker entry, undo, template, and a full
// Gemini API run (built-in prompts, image roles, outfit sheet without Character Lock, run order).
const { chromium } = require('playwright');
const fs = require('fs');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
const MP4 = fs.readFileSync(__dirname + '/v.mp4');
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = sw.url().split('/')[2];
  await ctx.route('https://flow.google.com/**', r => r.fulfill({ contentType: 'text/html', body: '<h1>Flow</h1>' }));
  const calls = []; let ops = 0;
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => {
    const req = route.request(), url = req.url();
    if (/:predictLongRunning/.test(url)) { const body = JSON.parse(req.postData()); ops++; calls.push({ kind: 'video', prompt: body.instances[0].prompt, refs: (body.instances[0].referenceImages || []).length, image: Boolean(body.instances[0].image) }); return route.fulfill({ json: { name: `models/veo/operations/op${ops}` } }); }
    if (/operations\/op\d+/.test(url)) return route.fulfill({ json: { name: 'x', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media' } }] } } } });
    if (/files\/f\d+:download/.test(url)) return route.fulfill({ contentType: 'video/mp4', body: MP4 });
    if (req.method() === 'POST') { const body = JSON.parse(req.postData()); if (body.generationConfig?.responseModalities) { calls.push({ kind: 'image', prompt: body.contents[0].parts[0].text, refs: body.contents[0].parts.length - 1 }); return route.fulfill({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png(180, 320, [100 + calls.length * 30, 120, 130]).toString('base64') } }] } }] } }); } }
    return route.fulfill({ json: { models: [] } });
  });
  const errors = []; const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(`chrome-extension://${id}/app.html`); await p.waitForTimeout(1800);
  await p.evaluate(() => document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => m.classList.add('hidden')));
  const photo = (rgb = [220, 170, 140]) => ({ name: 'photo.png', mimeType: 'image/png', buffer: png(60, 90, rgb) });
  // Image Input → Tạo ảnh (with a prompt), plus a node right of the input so the sheet has to find room.
  const build = role => p.evaluate(role => {
    const a = window.__cosAlphaApp, s = a.state; s.nodes = []; s.edges = [];
    const inp = a.makeNode('imageInput', 100, 200); inp.data = { role };
    const pr = a.makeNode('prompt', 100, 760); pr.data = { text: 'ảnh quảng cáo thời trang' };
    const g = a.makeNode('generateImage', 520, 200); g.data = { model: '', size: '9:16', status: 'idle' };
    s.nodes.push(inp, pr, g);
    s.edges.push({ id: a.uid('edge'), source: inp.id, sourcePort: 'image', target: g.id, targetPort: 'reference' }, { id: a.uid('edge'), source: pr.id, sourcePort: 'text', target: g.id, targetPort: 'prompt' });
    a.render(); return { inp: inp.id, g: g.id };
  }, role);
  const graph = ids => p.evaluate(({ inp, g }) => {
    const a = window.__cosAlphaApp, s = a.state, sheet = s.nodes.find(n => n.type === 'generateImage' && n.data.sheetMode);
    const has = (x, y) => s.edges.some(e => e.source === x && e.target === y);
    const boxes = s.nodes.filter(n => !n.data?.dockOnly).map(n => { const el = document.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`); return { x: n.x, y: n.y - 44, w: el.offsetWidth, h: el.offsetHeight + 44 }; });
    let overlaps = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const P = boxes[i], Q = boxes[j]; if (P.x < Q.x + Q.w - 2 && Q.x < P.x + P.w - 2 && P.y < Q.y + Q.h - 2 && Q.y < P.y + P.h - 2) overlaps++; }
    return { nodes: s.nodes.filter(n => !n.data?.dockOnly).length, mode: sheet?.data.sheetMode, size: sheet?.data.size, role: sheet?.data.outputRole, name: sheet?.data.customName, viaSheet: !!sheet && has(inp, sheet.id) && has(sheet.id, g), direct: has(inp, g), overlaps, status: document.querySelector('#runStatus')?.textContent || '' };
  }, ids);

  // 1. Drop a photo into a "Người mẫu" input: sheet node inserted between the photo and the scene.
  let ids = await build('model');
  check('Node ảnh vai trò Người mẫu có nút "Tạo ảnh nhiều góc" và ô tự tạo (đang bật)', await p.locator(`.node[data-id="${ids.inp}"] .sheet-btn`).count() === 1 && await p.locator(`.node[data-id="${ids.inp}"] .sheet-row input[type=checkbox]`).isChecked());
  await p.setInputFiles(`.node[data-id="${ids.inp}"] input[type=file]`, photo()); await p.waitForTimeout(400);
  let g1 = await graph(ids);
  check('Thả ảnh người mẫu: tự chèn node "Người mẫu nhiều góc" (9:16) giữa ảnh và cảnh', g1.nodes === 4 && g1.mode === 'model' && g1.size === '9:16' && g1.role === 'modelSheet' && g1.viaSheet && !g1.direct, JSON.stringify(g1));
  check('Node chèn vào không đè lên node khác, có báo trên thanh trạng thái', !g1.overlaps && /nhiều góc/.test(g1.status), JSON.stringify({ o: g1.overlaps, s: g1.status }));
  const card = await p.evaluate(() => { const n = window.__cosAlphaApp.state.nodes.find(x => x.data.sheetMode), el = document.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`); return { icon: !!el.querySelector('.ts-icon .ic-layout-grid'), kind: el.querySelector('.sheet-select select')?.value, prompt: el.querySelector('.ts-prompt')?.textContent || '', hint: !!el.querySelector('.sheet-hint'), inputHint: document.querySelector('.node[data-type="imageInput"] .sheet-row .hint')?.textContent || '' }; });
  check('Thẻ node nhiều góc: icon lưới, ô "Kiểu ảnh" = người mẫu, nhãn trên khung xem trước', card.icon && card.kind === 'model' && /Người mẫu nhiều góc/.test(card.prompt) && card.hint, JSON.stringify(card));
  check('Node ảnh báo đang được chuyển thành ảnh nhiều góc (không còn nút)', /nhiều góc/.test(card.inputHint) && await p.locator(`.node[data-id="${ids.inp}"] .sheet-btn`).count() === 0);
  await p.click('[data-ts-tool="undo-2"]'); await p.waitForTimeout(250);
  g1 = await graph(ids);
  check('Ctrl+Z / Hoàn tác bỏ node nhiều góc, ảnh nối thẳng lại vào cảnh', g1.nodes === 3 && g1.direct && !g1.mode, JSON.stringify(g1));

  // 2. New photo into an input whose sheet is done: the sheet is marked to run again.
  await p.setInputFiles(`.node[data-id="${ids.inp}"] input[type=file]`, photo([200, 150, 120])); await p.waitForTimeout(300);
  const again = await p.evaluate(async inp => { const a = window.__cosAlphaApp, sheet = a.state.nodes.find(n => n.data.sheetMode); sheet.data.status = 'success'; sheet.data.asset = { kind: 'image', url: 'data:image/png;base64,AAAA' }; a.render(); return sheet.id; }, ids.inp);
  await p.setInputFiles(`.node[data-id="${ids.inp}"] input[type=file]`, photo([90, 60, 50])); await p.waitForTimeout(300);
  const restale = await p.evaluate(sid => ({ status: window.__cosAlphaApp.nodeById(sid).data.status, count: window.__cosAlphaApp.state.nodes.filter(n => n.data.sheetMode).length }), again);
  check('Đổi ảnh khác: không thêm node mới, node nhiều góc chuyển về "chưa chạy" để Chạy tất cả tạo lại', restale.status === 'idle' && restale.count === 1, JSON.stringify(restale));

  // 3. Photo first, role chosen after: picking "Trang phục" inserts an outfit sheet.
  ids = await build('');
  await p.setInputFiles(`.node[data-id="${ids.inp}"] input[type=file]`, photo()); await p.waitForTimeout(300);
  check('Ảnh vai trò Tự do: không tự chèn gì', (await graph(ids)).nodes === 3);
  await p.selectOption(`.node[data-id="${ids.inp}"] .role-select select`, 'outfit'); await p.waitForTimeout(300);
  const g3 = await graph(ids);
  check('Chọn vai trò Trang phục: tự chèn "Trang phục nhiều góc"', g3.mode === 'outfit' && g3.role === 'outfitSheet' && g3.viaSheet && !g3.direct && !g3.overlaps, JSON.stringify(g3));

  // 4. Auto switched off: nothing inserted on drop, the button still works.
  ids = await build('model');
  await p.click(`.node[data-id="${ids.inp}"] .sheet-row .continuity-toggle`); await p.waitForTimeout(100);
  await p.setInputFiles(`.node[data-id="${ids.inp}"] input[type=file]`, photo()); await p.waitForTimeout(300);
  check('Tắt "Tự tạo khi thả ảnh vào": thả ảnh không chèn node', (await graph(ids)).nodes === 3);
  await p.click(`.node[data-id="${ids.inp}"] .sheet-btn`); await p.waitForTimeout(300);
  const g4 = await graph(ids);
  check('Bấm "Tạo ảnh nhiều góc" chèn node bằng tay', g4.mode === 'model' && g4.viaSheet && !g4.overlaps, JSON.stringify(g4));

  // 5. "Kiểu ảnh" on an ordinary Tạo ảnh node, and the picker entry.
  const kindSel = `.node[data-id="${ids.g}"] .sheet-select select`;
  await p.selectOption(kindSel, 'look'); await p.waitForTimeout(200);
  const look = await p.evaluate(gid => { const d = window.__cosAlphaApp.nodeById(gid).data; return { m: d.sheetMode, r: d.outputRole, s: d.size, prompt: window.__cosAlphaApp.resolvePrompt(gid) }; }, ids.g);
  check('Ô "Kiểu ảnh" đổi node thường thành "Người mẫu mặc đồ nhiều góc", câu lệnh nối vào thành ghi chú', look.m === 'look' && look.r === 'lookSheet' && look.s === '9:16' && /^Create a reference sheet of the model wearing the outfit/.test(look.prompt) && /Extra notes from the user: ảnh quảng cáo thời trang/.test(look.prompt), JSON.stringify({ ...look, prompt: look.prompt.slice(0, 60) }));
  await p.selectOption(kindSel, ''); await p.waitForTimeout(200);
  const plain = await p.evaluate(gid => { const d = window.__cosAlphaApp.nodeById(gid).data; return { m: d.sheetMode || '', r: d.outputRole || '', prompt: window.__cosAlphaApp.resolvePrompt(gid) }; }, ids.g);
  check('Đổi lại "Ảnh thường": bỏ chế độ nhiều góc, câu lệnh là câu lệnh nối vào', !plain.m && !plain.r && plain.prompt === 'ảnh quảng cáo thời trang', JSON.stringify(plain));
  await p.mouse.click(1150, 760); await p.mouse.move(1150, 760); await p.keyboard.press('n'); await p.waitForTimeout(150);
  await p.keyboard.type('nhieu goc'); await p.waitForTimeout(100);
  const pickLabel = await p.textContent('.ts-picker-item.active b');
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  const picked = await p.evaluate(() => { const n = window.__cosAlphaApp.state.nodes.at(-1); return { t: n.type, m: n.data.sheetMode, s: n.data.size }; });
  check('Phím N, gõ "nhieu goc": thêm node Ảnh nhiều góc', pickLabel === 'Ảnh nhiều góc' && picked.t === 'generateImage' && picked.m === 'model' && picked.s === '9:16', JSON.stringify({ pickLabel, picked }));

  // 6. Template + full Gemini API run.
  await p.evaluate(async () => { await chrome.storage.local.set({ thekeyGeminiApiKey: 'FAKEKEY' }); const a = window.__cosAlphaApp; a.state.settings.provider = 'api'; a.state.nodes = []; a.state.edges = []; a.render(); });
  await p.click('[data-ts-tool="layout-template"]'); await p.waitForTimeout(200);
  check('Kho mẫu có mẫu "Người mẫu mặc đồ · ảnh nhiều góc"', await p.locator('#galleryGrid [data-template="lookbook"]').count() === 1);
  await p.click('[data-use="lookbook"]'); await p.waitForTimeout(500);
  const tpl = await p.evaluate(() => { const s = window.__cosAlphaApp.state; return { sheets: s.nodes.filter(n => n.data.sheetMode).map(n => n.data.sheetMode).sort().join(','), inputs: s.nodes.filter(n => n.type === 'imageInput').map(n => n.id) }; });
  check('Mẫu thêm 3 node nhiều góc (người mẫu, trang phục, ghép)', tpl.sheets === 'look,model,outfit', tpl.sheets);
  for (const [i, inp] of tpl.inputs.entries()) { await p.setInputFiles(`.node[data-id="${inp}"] input[type=file]`, photo(i ? [30, 40, 90] : [220, 170, 140])); await p.waitForTimeout(250); }
  check('Thả ảnh vào mẫu không chèn thêm node (đã có sẵn node nhiều góc)', await p.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => n.data.sheetMode).length) === 3);
  // A locked character must not leak into the outfit sheet.
  await p.evaluate(png => { const a = window.__cosAlphaApp, c = a.makeNode('character', -400, 0); c.data = { name: 'Lan', description: 'cô gái tóc dài', enabled: true, localDataUrl: png }; a.state.nodes.push(c); a.render(); }, `data:image/png;base64,${png(40, 40, [250, 200, 180]).toString('base64')}`);
  await p.click('#runBtn');
  await p.waitForFunction(() => !window.__cosAlphaApp.state.isRunning, null, { timeout: 120000 }); await p.waitForTimeout(500);
  const run = await p.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => /generate/.test(n.type)).map(n => ({ m: n.data.sheetMode || n.type, s: n.data.status, e: (n.data.error || '').slice(0, 80) })));
  console.log(JSON.stringify(run)); console.log(JSON.stringify(calls.map(c => ({ ...c, prompt: c.prompt.replace(/\s+/g, ' ').slice(0, 120) }))));
  check('Chạy tất cả (Gemini API): 3 ảnh nhiều góc + video đều xong', run.length === 4 && run.every(n => n.s === 'success'), JSON.stringify(run));
  const img = calls.filter(c => c.kind === 'image'), ms = img.find(c => /^Create a character reference sheet/.test(c.prompt)), os = img.find(c => /^Create a product reference sheet/.test(c.prompt)), lk = img.find(c => /^Create a reference sheet of the model wearing/.test(c.prompt)), vid = calls.find(c => c.kind === 'video');
  check('Thứ tự: 2 ảnh nhiều góc trước, ảnh ghép sau, video cuối', img.length === 3 && img.indexOf(lk) === 2 && calls.indexOf(vid) === 3);
  check('Ảnh nhiều góc người mẫu: gửi ảnh người mẫu, ghi rõ vai trò', ms && ms.refs === 2 && /the model\/character: keep exactly this person/.test(ms.prompt), JSON.stringify(ms && { refs: ms.refs }));
  check('Ảnh nhiều góc trang phục: chỉ gửi ảnh trang phục, không kèm nhân vật khoá', os && os.refs === 1 && !/Character lock/.test(os.prompt) && /image 1 = the outfit/.test(os.prompt), JSON.stringify(os && { refs: os.refs }));
  check('Ảnh ghép nhận 2 ảnh nhiều góc với vai trò người mẫu / trang phục', lk && /multi-angle reference sheet of the model\/character/.test(lk.prompt) && /multi-angle reference sheet of the outfit/.test(lk.prompt), lk?.prompt.slice(-400));
  check('Video dùng ảnh ghép làm ảnh tham chiếu (không làm khung đầu)', vid && vid.refs >= 1 && !vid.image && /reference sheet of the model wearing the outfit/.test(vid.prompt) && /không chia ô/.test(vid.prompt), JSON.stringify(vid && { refs: vid.refs, image: vid.image }));

  // 7. A sheet with no photo explains what is missing.
  const lonely = await p.evaluate(async () => {
    const a = window.__cosAlphaApp; a.state.nodes = []; a.state.edges = []; const g = a.makeNode('generateImage', 200, 200); g.data = { model: '', status: 'idle' }; a.applySheet(g, 'outfit'); a.state.nodes.push(g); a.render();
    await a.executeGenerationNode(g.id)?.catch?.(() => {}); const t0 = Date.now(); while (a.state.isRunning && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 100));
    return { status: g.data.status, error: g.data.error || '' };
  });
  check('Ảnh nhiều góc chưa nối ảnh: báo lỗi rõ, không cần node Câu lệnh', lonely.status === 'error' && /hãy nối ảnh trang phục/.test(lonely.error), JSON.stringify(lonely));

  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  check('Không có lỗi JavaScript', !errors.length);
  await ctx.close();
  process.exit(summary() ? 1 : 0);
})();
