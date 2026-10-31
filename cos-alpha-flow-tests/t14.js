// 1.6 canvas: node cards (order badge, provider pill, preview, folded extra options), node picker (N / double-click),
// tool rail, template gallery (every template inserts with working wires, no overlaps, fits on screen), auto-layout,
// hover toolbar duplicate, active wire while a node runs.
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
  const count = () => p.evaluate(() => window.__cosAlphaApp.state.nodes.filter(n => !n.data?.dockOnly).length);

  // Node cards
  const card = await p.evaluate(() => {
    const el = document.querySelector('.node.ts-node[data-type="generateImage"]');
    return el && { order: el.querySelector('.ts-order')?.textContent, pill: el.querySelector('.ts-provider')?.textContent, preview: !!el.querySelector('.ts-preview.r-1-1'), prompt: el.querySelector('.ts-prompt')?.textContent || '',
      foldClosed: el.querySelector('details.ts-more')?.open === false, modelInFold: !!el.querySelector('.ts-more input'), roleInFold: !!el.querySelector('.ts-more .role-select'), sizeOutside: !!el.querySelector(':scope .node-body > .gen-controls > select'),
      icons: document.querySelectorAll('.ts-node .ts-icon').length, nodes: document.querySelectorAll('#canvas > .node').length };
  });
  check('Node Tạo ảnh có badge thứ tự 1, nhãn nguồn ngắn "Google Flow", khung xem trước 1:1 và câu lệnh nối vào', card && card.order === '1' && card.pill === 'Google Flow' && card.preview && /cinematic portrait/i.test(card.prompt), JSON.stringify(card));
  check('Tuỳ chọn phụ (model, vai trò ảnh) được gom vào "Tuỳ chọn thêm", tỉ lệ vẫn ở ngoài', card && card.foldClosed && card.modelInFold && card.roleInFold && card.sizeOutside);
  check('Mọi node có icon loại node', card && card.icons === card.nodes, `${card?.icons}/${card?.nodes}`);
  await p.click('.node[data-type="generateImage"] .ts-more > summary');
  await p.evaluate(() => window.__cosAlphaApp.render());
  check('"Tuỳ chọn thêm" vẫn mở sau khi canvas vẽ lại', await p.evaluate(() => document.querySelector('.node[data-type="generateImage"] .ts-more').open));

  // Rail + picker
  check('Thanh công cụ bên trái có đủ nút', await p.locator('#tsRail button').count() === 7);
  const before = await count();
  await p.mouse.move(1100, 700); await p.keyboard.press('n'); await p.waitForTimeout(200);
  check('Phím N mở hộp tìm node', await p.locator('.ts-picker').isVisible());
  await p.keyboard.type('anh dau vao'); await p.waitForTimeout(100);
  check('Tìm không dấu vẫn ra "Ảnh đầu vào"', /Ảnh đầu vào/.test(await p.textContent('.ts-picker-item.active')));
  await p.fill('.ts-picker input', 'tao video'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const added = await p.evaluate(() => window.__cosAlphaApp.state.nodes.at(-1).type);
  check('Enter thêm node đã chọn vào canvas, hộp tìm đóng lại', (await count()) === before + 1 && added === 'generateVideo' && !(await p.locator('.ts-picker').count()), added);
  // An empty spot of the canvas (cards grow as features are added, so look for one).
  const spot = await p.evaluate(() => { const r = document.querySelector('#viewport').getBoundingClientRect(); for (let y = r.bottom - 60; y > r.top + 60; y -= 40) for (let x = r.left + 300; x < r.right - 60; x += 40) { const e = document.elementFromPoint(x, y); if (e && (e.id === 'viewport' || e.id === 'canvas' || e.id === 'edges' || e.closest('#edges'))) return [x, y]; } return [700, 770]; });
  await p.mouse.dblclick(spot[0], spot[1]); await p.waitForTimeout(200);
  check('Nháy đúp chỗ trống mở hộp tìm node', await p.locator('.ts-picker').isVisible());
  await p.keyboard.press('Escape');
  check('Esc đóng hộp tìm node', !(await p.locator('.ts-picker').count()));

  // Hover toolbar: duplicate
  const n0 = await count();
  await p.hover('.node[data-type="generateImage"]'); await p.click('.node[data-type="generateImage"] .ts-toolbar button[title^="Nhân bản"]'); await p.waitForTimeout(200);
  check('Nút nhân bản trên thanh nổi tạo bản sao chưa chạy', (await count()) === n0 + 1 && await p.evaluate(() => { const n = window.__cosAlphaApp.state.nodes.at(-1); return n.type === 'generateImage' && n.data.status === 'idle' && !n.data.asset; }));

  // Active wire while running
  const active = await p.evaluate(async () => { const a = window.__cosAlphaApp, g = a.state.nodes.find(n => n.type === 'generateImage'); g.data.status = 'running'; a.render(); await new Promise(r => setTimeout(r, 120)); const r = { edge: document.querySelectorAll('#edges .edge-active').length, spinner: !!document.querySelector(`.node[data-id="${g.id}"] .ts-running`) }; g.data.status = 'idle'; a.render(); return r; });
  check('Đang tạo: dây nối vào node chạy sáng lên, node hiện "Đang tạo…"', active.edge > 0 && active.spinner, JSON.stringify(active));

  // Gallery UI
  await p.click('[data-ts-tool="layout-template"]'); await p.waitForTimeout(200);
  const total = await p.locator('#galleryGrid .ts-card').count();
  check('Kho mẫu mở từ thanh công cụ, có 11 mẫu', await p.locator('#galleryModal').isVisible() && total === 11, String(total));
  await p.click('#galleryCats [data-cat="Sản phẩm"]');
  check('Lọc theo nhóm "Sản phẩm" còn 2 mẫu', await p.locator('#galleryGrid .ts-card').count() === 2);
  await p.click('#galleryCats [data-cat="Tất cả"]'); await p.fill('#gallerySearch', 'khung cuối');
  check('Tìm "khung cuối" ra mẫu video nối tiếp', await p.locator('#galleryGrid [data-template="video-chain"]').count() === 1);
  await p.fill('#gallerySearch', '');
  const n1 = await count();
  await p.click('[data-use="story-3"]'); await p.waitForTimeout(500);
  check('Bấm "Dùng mẫu" đóng kho và thêm 13 node', await p.locator('#galleryModal').isHidden() && (await count()) === n1 + 13);
  await p.click('[data-ts-tool="undo-2"]'); await p.waitForTimeout(300);
  check('Hoàn tác bỏ mẫu vừa thêm', (await count()) === n1);
  await p.click('#galleryOpenBtn'); await p.waitForTimeout(150);
  check('Nút "Kho mẫu workflow" ở thanh bên cũng mở kho', await p.locator('#galleryModal').isVisible());
  await p.keyboard.press('Escape');

  // Every template on an empty canvas: wires kept, ports exist, no overlaps, on screen, run order computes.
  const reports = await p.evaluate(async () => {
    const a = window.__cosAlphaApp, C = window.CosAlphaCanvas, out = [];
    const boxes = ids => ids.map(id => { const n = a.nodeById(id), el = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`); return { id, x: n.x, y: n.y - 44, w: el.offsetWidth, h: el.offsetHeight + 44 }; });
    for (const t of C.TEMPLATES) {
      a.state.nodes = []; a.state.edges = []; a.render();
      C.insertTemplate(t); await new Promise(r => setTimeout(r, 150));
      const ids = a.state.nodes.filter(n => !n.data?.dockOnly).map(n => n.id), b = boxes(ids);
      let overlaps = 0; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const p = b[i], q = b[j]; if (p.x < q.x + q.w - 2 && q.x < p.x + p.w - 2 && p.y < q.y + q.h - 2 && q.y < p.y + p.h - 2) overlaps++; }
      const ports = a.state.edges.every(e => document.querySelector(`.node[data-id="${CSS.escape(e.source)}"] .port.out[data-port="${e.sourcePort}"]`) && document.querySelector(`.node[data-id="${CSS.escape(e.target)}"] .port.in[data-port="${e.targetPort}"]`));
      const vp = document.querySelector('#viewport').getBoundingClientRect(), s = a.state;
      const onScreen = b.every(r => r.x * s.zoom + s.panX >= -2 && (r.x + r.w) * s.zoom + s.panX <= vp.width + 2 && r.y * s.zoom + s.panY >= -2 && (r.y + r.h) * s.zoom + s.panY <= vp.height + 2);
      let order = 0; try { order = a.topoOrder().length; } catch { order = -1; }
      out.push({ id: t.id, nodes: ids.length === t.nodes.length, edges: a.state.edges.length === t.edges.length, ports: !!ports, overlaps, onScreen, zoom: Math.round(s.zoom * 100), order, badges: document.querySelectorAll('.ts-order').length });
    }
    return out;
  });
  for (const r of reports) check(`Mẫu ${r.id}: đủ node + dây, cổng đúng, không chồng nhau, vừa màn hình (${r.zoom}%)`, r.nodes && r.edges && r.ports && !r.overlaps && r.onScreen && r.order > 0 && r.badges > 0, JSON.stringify(r));

  // Auto-layout untangles a pile of nodes
  const pile = await p.evaluate(async () => {
    const a = window.__cosAlphaApp, C = window.CosAlphaCanvas;
    a.state.nodes = []; a.state.edges = []; a.render(); C.insertTemplate(C.TEMPLATES.find(t => t.id === 'product-angles')); await new Promise(r => setTimeout(r, 100));
    for (const n of a.state.nodes) if (!n.data?.dockOnly) { n.x = 500; n.y = 300; } a.render();
    C.layoutAll(); await new Promise(r => setTimeout(r, 100));
    const b = a.state.nodes.filter(n => !n.data?.dockOnly).map(n => { const el = document.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`); return { x: n.x, y: n.y - 44, w: el.offsetWidth, h: el.offsetHeight + 44, type: n.type }; });
    let overlaps = 0; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const p = b[i], q = b[j]; if (p.x < q.x + q.w - 2 && q.x < p.x + p.w - 2 && p.y < q.y + q.h - 2 && q.y < p.y + p.h - 2) overlaps++; }
    const x = type => b.filter(r => r.type === type).map(r => r.x);
    return { overlaps, leftToRight: Math.max(...x('imageInput')) < Math.min(...x('generateImage')) && Math.max(...x('generateImage')) < Math.min(...x('download')) };
  });
  check('Tự sắp xếp gỡ đống node chồng lên nhau, xếp trái → phải theo thứ tự chạy', !pile.overlaps && pile.leftToRight, JSON.stringify(pile));

  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  check('Không có lỗi JavaScript', !errors.length);
  await ctx.close();
  process.exit(summary() ? 1 : 0);
})();
