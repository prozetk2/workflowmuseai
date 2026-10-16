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
  let pickerResolve = null;
  const uploading = () => document.documentElement.getAttribute('data-thekey-upload') === '1';

  // Newer pages may use the File System Access picker instead of an <input type="file">.
  if (typeof window.showOpenFilePicker === 'function') {
    const originalPicker = window.showOpenFilePicker;
    window.showOpenFilePicker = function (...args) {
      if (!uploading()) return originalPicker.apply(this, args);
      return new Promise(resolve => {
        pickerResolve = resolve;
        document.dispatchEvent(new CustomEvent('thekey-flow-file-input', { detail: JSON.stringify({ accept: '', multiple: false, picker: true }) }));
      });
    };
  }

  HTMLInputElement.prototype.click = function (...args) {
    if (this.type !== 'file' || !uploading()) {
      return originalClick.apply(this, args);
    }
    captured = this;
    document.dispatchEvent(new CustomEvent('thekey-flow-file-input', { detail: JSON.stringify({ accept: this.accept || '', multiple: Boolean(this.multiple) }) }));
  };

  document.addEventListener('thekey-flow-upload', event => {
    let payload;
    try { payload = JSON.parse(String(event.detail || '{}')); } catch { payload = {}; }
    const input = captured, picker = pickerResolve;
    captured = null; pickerResolve = null;
    const report = (ok, error) => document.dispatchEvent(new CustomEvent('thekey-flow-upload-result', { detail: JSON.stringify({ ok, error: error || '' }) }));
    if (!input && !picker) { report(false, 'No captured file input.'); return; }
    try {
      const files = (payload.files || []).map(item => {
        const comma = String(item.dataUrl || '').indexOf(',');
        const binary = atob(String(item.dataUrl || '').slice(comma + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new File([bytes], item.name || 'thekey-image.png', { type: item.type || 'image/png' });
      });
      if (picker) {
        picker(files.map(file => ({ kind: 'file', name: file.name, getFile: async () => file, isSameEntry: async other => other?.name === file.name, queryPermission: async () => 'granted', requestPermission: async () => 'granted' })));
        report(true);
        return;
      }
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      report(true);
    } catch (error) {
      report(false, error?.message || String(error));
    }
  });
})();
