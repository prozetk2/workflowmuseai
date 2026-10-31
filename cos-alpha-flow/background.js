// Clicking the toolbar icon opens cos_alpha_flow in Chrome's side panel (next to the Flow tab).
// The panel has a "Toàn màn hình" button for the full canvas tab. If the side panel API is
// missing (old Chrome), the click falls back to opening the full tab below.
const enablePanelOnClick = () => chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(enablePanelOnClick);
chrome.runtime.onStartup.addListener(enablePanelOnClick);
enablePanelOnClick();

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length && tabs[0].id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
});

// Trusted input for the Flow tab. Flow's prompt editor and buttons may ignore synthetic DOM
// events, so flow-bridge.js can ask for real mouse clicks and typing through the Chrome
// DevTools protocol. Chrome shows a "is debugging this browser" bar while it is attached;
// the bridge detaches when a generation finishes.
const attachedTabs = new Set();
chrome.debugger.onDetach.addListener(source => { if (source.tabId !== undefined) attachedTabs.delete(source.tabId); });
chrome.tabs.onRemoved.addListener(tabId => attachedTabs.delete(tabId));

async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  try { await chrome.debugger.attach({ tabId }, '1.3'); }
  catch (error) { if (!/already attached/i.test(error?.message || '')) throw error; }
  attachedTabs.add(tabId);
  // Lets the page behave as focused even when another window is in front.
  await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
}

async function runCdp(tabId, message) {
  const target = { tabId };
  if (message.op === 'detach') {
    if (attachedTabs.has(tabId)) { attachedTabs.delete(tabId); await chrome.debugger.detach(target).catch(() => {}); }
    return;
  }
  await ensureAttached(tabId);
  if (message.op === 'click') {
    const base = { x: message.x, y: message.y, modifiers: 0 };
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, button: 'none' });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base, button: 'left', buttons: 1, clickCount: 1 });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, button: 'left', buttons: 0, clickCount: 1 });
    return;
  }
  if (message.op === 'move') {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: message.x, y: message.y, modifiers: 0, button: 'none' });
    return;
  }
  if (message.op === 'insertText') {
    await chrome.debugger.sendCommand(target, 'Input.insertText', { text: String(message.text || '') });
    return;
  }
  if (message.op === 'key') {
    const key = { key: message.key, code: message.code, windowsVirtualKeyCode: message.keyCode, nativeVirtualKeyCode: message.keyCode, modifiers: message.modifiers || 0 };
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    return;
  }
  throw new Error(`Unknown input operation: ${message.op}`);
}

// The Flow tab's content script cannot read media from other Google hosts (CORS), so it asks
// here: the extension's host permissions allow the download.
async function fetchMediaAsDataUrl(url, maxBytes) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('empty file');
  if (blob.size > maxBytes) return { ok: true, tooLarge: true };
  return { ok: true, url: await blobAsDataUrl(blob) };
}
async function blobAsDataUrl(blob, type = blob.type) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

// Last resort for Flow results: Flow's media links need the tab's Google sign-in and can redirect to hosts this
// extension may not list. DevTools' loader fetches them inside the Flow tab (its cookies, any redirect, no CORS)
// and the body is read back through the protocol's IO stream. Only for Flow tabs.
const FLOW_TAB = /^https:\/\/(?:flow\.google\.com|labs\.google)\//i;
async function fetchMediaViaFlowTab(tabId, url, maxBytes) {
  const tab = await chrome.tabs.get(tabId);
  if (!FLOW_TAB.test(tab?.url || '')) throw new Error('not a Flow tab');
  const target = { tabId }, wasAttached = attachedTabs.has(tabId);
  await ensureAttached(tabId);
  let stream = '';
  try {
    const { frameTree } = await chrome.debugger.sendCommand(target, 'Page.getFrameTree');
    const { resource } = await chrome.debugger.sendCommand(target, 'Network.loadNetworkResource', { frameId: frameTree.frame.id, url, options: { disableCache: false, includeCredentials: true } });
    if (!resource?.success || !resource.stream) throw new Error(resource?.httpStatusCode ? `HTTP ${resource.httpStatusCode}` : resource?.netErrorName || 'load failed');
    stream = resource.stream;
    const chunks = []; let total = 0;
    for (;;) {
      const part = await chrome.debugger.sendCommand(target, 'IO.read', { handle: stream, size: 1 << 20 });
      const bytes = part.base64Encoded ? Uint8Array.from(atob(part.data || ''), c => c.charCodeAt(0)) : new TextEncoder().encode(part.data || '');
      total += bytes.length;
      if (total > maxBytes) return { ok: true, tooLarge: true };
      chunks.push(bytes);
      if (part.eof) break;
    }
    if (!total) throw new Error('empty file');
    const type = Object.entries(resource.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.split(';')[0] || '';
    return { ok: true, url: await blobAsDataUrl(new Blob(chunks), type), via: 'flow-tab' };
  } finally {
    if (stream) await chrome.debugger.sendCommand(target, 'IO.close', { handle: stream }).catch(() => {});
    if (!wasAttached) { attachedTabs.delete(tabId); await chrome.debugger.detach(target).catch(() => {}); }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'THEKEY_FETCH_MEDIA') {
    if (!/^https:/i.test(String(message.url || ''))) { sendResponse({ ok: false, error: 'Bad media request.' }); return false; }
    // The Flow tab asking for its own result, or the app naming the Flow tab to load through.
    const viaTabId = Number(message.viaTabId) || (FLOW_TAB.test(sender.tab?.url || '') ? sender.tab.id : 0);
    const maxBytes = Number(message.maxBytes) || 40 * 1024 * 1024;
    fetchMediaAsDataUrl(message.url, maxBytes)
      .catch(async error => {
        if (!viaTabId) throw error;
        try { return await fetchMediaViaFlowTab(viaTabId, message.url, maxBytes); }
        catch (second) { throw new Error(`${error?.message || error}; qua tab Flow: ${second?.message || second}`); }
      })
      .then(sendResponse, error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === 'THEKEY_ACTIVATE_TAB') {
    const tab = sender.tab;
    if (!tab?.id) { sendResponse({ ok: false }); return false; }
    chrome.tabs.update(tab.id, { active: true })
      .then(() => tab.windowId !== undefined ? chrome.windows.update(tab.windowId, { focused: true }) : null)
      .then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type !== 'THEKEY_CDP') return false;
  const tabId = sender.tab?.id;
  if (!tabId) { sendResponse({ ok: false, error: 'No tab for trusted input.' }); return false; }
  runCdp(tabId, message).then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

// ---------- Image → Prompt from the right-click menu ----------
// Right-click any image (or the page) → the image is read, stored for the app, and the side panel
// opens with Gemini's description. Reading uses the click's activeTab grant: first a direct
// download, else a screenshot of the visible tab cropped to the image. No access to other sites.
function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'cosalpha-i2p-image', title: 'cos_alpha_flow: Tạo prompt từ ảnh này', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'cosalpha-i2p-page', title: 'cos_alpha_flow: Tạo prompt từ màn hình đang xem', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'cosalpha-ref-image', title: 'cos_alpha_flow: Lưu ảnh này vào Album', contexts: ['image'] });
  });
}
chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

function bytesToDataUrl(bytes, type) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}
async function shrinkBlob(blob, crop) {
  const bitmap = await createImageBitmap(blob);
  const sx = crop ? crop.x : 0, sy = crop ? crop.y : 0, sw = crop ? crop.w : bitmap.width, sh = crop ? crop.h : bitmap.height;
  const scale = Math.min(1, 1536 / Math.max(sw, sh));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return bytesToDataUrl(new Uint8Array(await out.arrayBuffer()), 'image/jpeg');
}
async function readClickedImage(info, tab) {
  if (info.srcUrl && /^data:image\//.test(info.srcUrl)) return shrinkBlob(await (await fetch(info.srcUrl)).blob());
  if (info.srcUrl) {
    try { const response = await fetch(info.srcUrl, { credentials: 'omit' }); if (response.ok) { const blob = await response.blob(); if (blob.type.startsWith('image/')) return shrinkBlob(blob); } } catch { /* CORS: fall back to a screenshot */ }
  }
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const blob = await (await fetch(shot)).blob();
  if (!info.srcUrl || info.frameId) return shrinkBlob(blob);
  const [{ result: rect } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [info.srcUrl], func: src => {
    const img = [...document.images].find(el => el.currentSrc === src || el.src === src); if (!img) return null;
    const r = img.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight };
  } }).catch(() => [{}]);
  if (!rect || rect.w < 4 || rect.h < 4) return shrinkBlob(blob);
  const bitmap = await createImageBitmap(blob), ratio = bitmap.width / rect.vw;
  const x = Math.max(0, rect.x * ratio), y = Math.max(0, rect.y * ratio);
  return shrinkBlob(blob, { x, y, w: Math.min(bitmap.width - x, rect.w * ratio), h: Math.min(bitmap.height - y, rect.h * ratio) });
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!String(info.menuItemId).startsWith('cosalpha-') || !tab) return;
  // Must be called right away, while the click still counts as a user gesture.
  chrome.sidePanel?.open?.({ windowId: tab.windowId }).catch(() => {});
  readClickedImage(info, tab).then(image => {
    const key = info.menuItemId === 'cosalpha-ref-image' ? 'cosalphaAlbumInbox' : 'cosalphaI2P';
    return chrome.storage.local.set({ [key]: { image, at: Date.now(), pageUrl: tab.url || '', consumed: false } });
  }).catch(error => chrome.storage.local.set({ cosalphaI2P: { error: error?.message || String(error), at: Date.now() } }));
});
