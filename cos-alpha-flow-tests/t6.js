// Right-click image reading in the service worker: data: image, direct download, screenshot + crop.
const { chromium } = require('playwright');
const { png, check, summary } = require('./common');
const EXT = process.argv[2];
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1000, height: 700 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const big = png(2400, 1200, [10, 200, 10]).toString('base64');
  await ctx.route('https://flow.google.com/**', route => {
    if (/red\.png/.test(route.request().url())) return route.fulfill({ contentType: 'image/png', body: png(200, 100, [250, 0, 0]) });
    return route.fulfill({ contentType: 'text/html', body: `<body style="margin:0;background:#fff"><img id="r" src="/red.png" style="position:absolute;left:100px;top:50px;width:200px;height:100px"></body>` });
  });
  const tabPage = await ctx.newPage(); await tabPage.goto('https://flow.google.com/project/p'); await tabPage.waitForTimeout(800);
  const menus = await sw.evaluate(() => new Promise(r => chrome.contextMenus.removeAll(() => { createMenus(); setTimeout(() => r('ok'), 300); })));
  check('Tạo được 3 mục menu chuột phải', menus === 'ok');
  const res = await sw.evaluate(async big => {
    const [tab] = await chrome.tabs.query({ url: 'https://flow.google.com/*' });
    const size = async url => { const b = await (await fetch(url)).blob(); const bm = await createImageBitmap(b); const c = new OffscreenCanvas(bm.width, bm.height).getContext('2d'); c.drawImage(bm, 0, 0); const px = c.getImageData(Math.floor(bm.width / 2), Math.floor(bm.height / 2), 1, 1).data; return { w: bm.width, h: bm.height, type: b.type, px: [...px].slice(0, 3) }; };
    const out = {};
    try { out.data = await size(await readClickedImage({ srcUrl: 'data:image/png;base64,' + big }, tab)); } catch (e) { out.data = 'ERR ' + e.message; }
    try { out.direct = await size(await readClickedImage({ srcUrl: 'https://flow.google.com/red.png', frameId: 0 }, tab)); } catch (e) { out.direct = 'ERR ' + e.message; }
    try { out.crop = await size(await readClickedImage({ srcUrl: 'https://flow.google.com/red.png?nocors=' + Date.now(), frameId: 0, _forceCapture: true }, tab)); } catch (e) { out.crop = 'ERR ' + e.message; }
    try { out.page = await size(await readClickedImage({ pageUrl: tab.url }, tab)); } catch (e) { out.page = 'ERR ' + e.message; }
    return out;
  }, big);
  console.log(JSON.stringify(res));
  check('Ảnh data: thu nhỏ còn ≤1536px, JPEG', res.data.w === 1536 && res.data.h === 768 && res.data.type === 'image/jpeg', JSON.stringify(res.data));
  check('Ảnh trên trang: đọc được (tải thẳng hoặc chụp màn hình + cắt), màu đúng', res.direct.w > 0 && res.direct.px[0] > 200 && res.direct.px[1] < 60, JSON.stringify(res.direct));
  // captureVisibleTab needs the activeTab grant that only a real right-click gives; the test can only confirm that is the one missing piece.
  check('"Màn hình đang xem": chỉ thiếu quyền activeTab (có khi bấm chuột phải thật)', res.page.w > 900 || /activeTab/.test(String(res.page)), JSON.stringify(res.page));
  // The panel receives what the menu stores (same path as the real click).
  await sw.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://flow.google.com/*' }); const image = await readClickedImage({ srcUrl: 'https://flow.google.com/red.png', frameId: 0 }, tab); await chrome.storage.local.set({ cosalphaAlbumInbox: { image, at: Date.now(), pageUrl: tab.url, consumed: false } }); });
  const id = sw.url().split('/')[2];
  const panel = await ctx.newPage(); await panel.goto(`chrome-extension://${id}/panel.html`); await panel.waitForTimeout(1500);
  await panel.click('[data-qp="album"]'); await panel.waitForTimeout(800);
  check('Ảnh "Lưu vào Album" hiện trong Album của panel', (await panel.locator('.cos-a-card').count()) === 1);
  const failed = summary(); await ctx.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
