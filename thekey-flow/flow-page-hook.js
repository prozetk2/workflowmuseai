// Runs in the Flow page's own JavaScript world (manifest "world": "MAIN").
// Flow opens its file picker by calling click() on an <input type="file"> that is often
// not attached to the document, so the bridge (isolated world) cannot reach it. While the
// bridge is uploading (html[data-thekey-upload="1"]) this hook keeps that input instead of
// opening the system dialog, then fills it with the file the bridge sends.
(() => {
  if (window.__theKeyFlowPageHook) return;
  window.__theKeyFlowPageHook = true;
  const originalClick = HTMLInputElement.prototype.click;
  let captured = null;

  HTMLInputElement.prototype.click = function (...args) {
    if (this.type !== 'file' || document.documentElement.getAttribute('data-thekey-upload') !== '1') {
      return originalClick.apply(this, args);
    }
    captured = this;
    document.dispatchEvent(new CustomEvent('thekey-flow-file-input', { detail: JSON.stringify({ accept: this.accept || '', multiple: Boolean(this.multiple) }) }));
  };

  document.addEventListener('thekey-flow-upload', event => {
    let payload;
    try { payload = JSON.parse(String(event.detail || '{}')); } catch { payload = {}; }
    const input = captured;
    captured = null;
    const report = (ok, error) => document.dispatchEvent(new CustomEvent('thekey-flow-upload-result', { detail: JSON.stringify({ ok, error: error || '' }) }));
    if (!input) { report(false, 'No captured file input.'); return; }
    try {
      const transfer = new DataTransfer();
      for (const item of payload.files || []) {
        const comma = String(item.dataUrl || '').indexOf(',');
        const binary = atob(String(item.dataUrl || '').slice(comma + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        transfer.items.add(new File([bytes], item.name || 'thekey-image.png', { type: item.type || 'image/png' }));
      }
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      report(true);
    } catch (error) {
      report(false, error?.message || String(error));
    }
  });
})();
