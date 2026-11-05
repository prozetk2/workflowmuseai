// Runs in the Flow page's own JavaScript world (manifest "world": "MAIN").
// Flow opens its file picker by calling click() on an <input type="file"> that is often
// not attached to the document, so the bridge (isolated world) cannot reach it. While the
// bridge is uploading (html[data-cosalpha-upload="1"]) this hook keeps that input instead of
// opening the system dialog, then fills it with the file the bridge sends.
(() => {
  if (window.__cosAlphaFlowPageHook) return;
  window.__cosAlphaFlowPageHook = true;
  const originalClick = HTMLInputElement.prototype.click;
  let captured = null;
  let pickerResolve = null;
  const uploading = () => document.documentElement.getAttribute('data-cosalpha-upload') === '1';

  // Newer pages may use the File System Access picker instead of an <input type="file">.
  if (typeof window.showOpenFilePicker === 'function') {
    const originalPicker = window.showOpenFilePicker;
    window.showOpenFilePicker = function (...args) {
      if (!uploading()) return originalPicker.apply(this, args);
      return new Promise(resolve => {
        pickerResolve = resolve;
        document.dispatchEvent(new CustomEvent('cosalpha-flow-file-input', { detail: JSON.stringify({ accept: '', multiple: false, picker: true }) }));
      });
    };
  }

  HTMLInputElement.prototype.click = function (...args) {
    if (this.type !== 'file' || !uploading()) {
      return originalClick.apply(this, args);
    }
    captured = this;
    document.dispatchEvent(new CustomEvent('cosalpha-flow-file-input', { detail: JSON.stringify({ accept: this.accept || '', multiple: Boolean(this.multiple) }) }));
  };

  document.addEventListener('cosalpha-flow-upload', event => {
    let payload;
    try { payload = JSON.parse(String(event.detail || '{}')); } catch { payload = {}; }
    const input = captured, picker = pickerResolve;
    captured = null; pickerResolve = null;
    const report = (ok, error) => document.dispatchEvent(new CustomEvent('cosalpha-flow-upload-result', { detail: JSON.stringify({ ok, error: error || '' }) }));
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
  // ---------- Flow's own replies (read only) ----------
  // Flow learns about each generation from its own batchexecute replies: the new item's id, the prompt it was made
  // from, its state, its thumbnail and, once opened, its signed video link. This only reads those replies (it sends
  // nothing and changes nothing) and hands a short summary to the bridge, so the bridge can tell exactly which item
  // belongs to which send instead of guessing from the grid.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ERROR_CODE = /^(?:PUBLIC_ERROR(?:_[A-Z0-9]+)*|SEXUALLY_EXPLICIT|CHILD_SAFETY|[A-Z][A-Z0-9_]*(?:_ERROR|_FAILED|_FAILURE|_VIOLATION|_BLOCKED))$/;
  const VIDEO_LINK = /^https:\/\/flow-content\.google\/video\/([0-9a-f-]{36})(?:[/?]|$)/i;
  const isBatch = url => /\/data\/batchexecute/.test(String(url || ''));
  function walk(node, visit, depth = 0) {
    if (!Array.isArray(node) || depth > 40) return;
    visit(node);
    for (const child of node) if (Array.isArray(child)) walk(child, visit, depth + 1);
  }
  function errorsIn(node, out = new Set(), depth = 0) {
    if (depth > 30) return out;
    if (typeof node === 'string') { if (ERROR_CODE.test(node)) out.add(node); }
    else if (Array.isArray(node)) for (const child of node) errorsIn(child, out, depth + 1);
    return out;
  }
  function summarize(text) {
    const items = new Map();
    const get = id => { const key = id.toLowerCase(); if (!items.has(key)) items.set(key, { id: key }); return items.get(key); };
    for (const line of String(text).split('\n')) {
      if (!line.includes('wrb.fr')) continue;
      let frames; try { frames = JSON.parse(line); } catch { continue; }
      for (const frame of frames) {
        if (!Array.isArray(frame) || frame[0] !== 'wrb.fr' || typeof frame[2] !== 'string') continue;
        let data; try { data = JSON.parse(frame[2]); } catch { continue; }
        walk(data, node => {
          for (const value of node) { const link = typeof value === 'string' && value.match(VIDEO_LINK); if (link) get(link[1]).video = value; }
          // [id, projectId, entryId, _, _, [time, prompt, …, [state], 1, thumbnail, …], …]
          if (typeof node[0] === 'string' && UUID.test(node[0]) && typeof node[1] === 'string' && UUID.test(node[1]) && Array.isArray(node[5]) && typeof node[5][1] === 'string') {
            const item = get(node[0]); const info = node[5];
            item.prompt = info[1];
            const state = info.find((value, index) => index > 1 && Array.isArray(value) && value.length === 1 && Number.isInteger(value[0]));
            if (state) item.state = state[0];
            const thumb = info.find(value => typeof value === 'string' && /^https:\/\//.test(value));
            if (thumb) item.thumb = thumb;
            const model = JSON.stringify(info[6] || '').match(/"([a-z0-9]+_[a-z0-9_]+)"/i);
            if (model) item.model = model[1];
            const errors = [...errorsIn(node)];
            if (errors.length) item.errors = errors;
          }
          // [entryId, _, _, [title, time, _, _, mediaId, …], projectId]
          if (typeof node[0] === 'string' && UUID.test(node[0]) && Array.isArray(node[3]) && typeof node[3][0] === 'string' && typeof node[3][4] === 'string' && UUID.test(node[3][4])) {
            get(node[3][4]).title = node[3][0];
          }
        });
      }
    }
    return [...items.values()];
  }
  function report(url, text) {
    if (!isBatch(url) || !text) return;
    let list; try { list = summarize(text); } catch { return; }
    if (list.length) document.dispatchEvent(new CustomEvent('cosalpha-flow-net', { detail: JSON.stringify({ at: Date.now(), items: list }) }));
  }
  const xhrOpen = XMLHttpRequest.prototype.open, xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__cosAlphaUrl = url; return xhrOpen.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (...args) {
    if (isBatch(this.__cosAlphaUrl)) this.addEventListener('load', () => { try { if (!this.responseType || this.responseType === 'text') report(this.__cosAlphaUrl, this.responseText); } catch {} });
    return xhrSend.apply(this, args);
  };
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const promise = originalFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input?.url;
        if (isBatch(url)) promise.then(response => response.clone().text().then(text => report(url, text))).catch(() => {});
      } catch {}
      return promise;
    };
  }
})();
