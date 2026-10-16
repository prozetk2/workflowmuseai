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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
