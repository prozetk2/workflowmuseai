// TheKey.studio Flow bridge: runs inside the signed-in Google Flow tab (isolated world).
// The canvas tab sends THEKEY_FLOW_* messages; this script fills Flow's prompt box, picks
// settings, attaches images, presses Generate once, and waits for the new result tile.
//
// Flow's markup changes often. Every selector lives in DEFAULT_SELECTORS so it can be fixed
// in one place, or overridden from TheKey.studio Settings → "Flow selectors (JSON)" without
// reloading the extension. THEKEY_FLOW_DIAGNOSE reports which of them still match.
(() => {
  if (window.__theKeyFlowBridgeInstalled) return;
  window.__theKeyFlowBridgeInstalled = true;

  const DEFAULT_SELECTORS = {
    editor: ['flow-base-prompt-box div[role="textbox"]', 'div[role="textbox"][contenteditable="true"]', 'flow-rich-text-editor [contenteditable="true"]', 'div[role="textbox"]', 'textarea'],
    promptScopes: ['flow-base-prompt-box', 'flow-prompt-box', 'flow-ingredient-bar', 'div.submit-controls'],
    submitScopes: ['div.submit-controls', 'flow-generate-icon-button', 'flow-base-prompt-box'],
    submitIcons: ['arrow_forward', 'send'],
    settingsIcons: ['tune', 'crop'],
    settingsPanel: ['flow-prompt-box-settings'],
    videoModeIcons: ['videocam'],
    imageModeIcons: ['image', 'photo'],
    framesModeIcons: ['crop_free'],
    ingredientsModeIcons: ['chrome_extension', 'extension'],
    aspectHints: { '16:9': ['16_9', '16:9', 'landscape'], '9:16': ['9_16', '9:16', 'portrait'], '1:1': ['1_1', '1:1', 'square'], '4:3': ['4_3', '4:3'], '3:4': ['3_4', '3:4'] },
    modelMenuIcons: ['arrow_drop_down'],
    menuItems: ['flow-menu-item button', 'flow-menu-item', '[role="menuitem"]', 'mat-option', '[role="option"]'],
    addImageButtons: ['flow-ingredient-bar button.empty-chip'],
    addIcons: ['add', 'add_2', 'add_photo_alternate'],
    uploadIcons: ['upload', 'drive_folder_upload', 'upload_file', 'file_upload'],
    popoverScopes: ['flow-add-menu-popover-content', '[popover]', '.cdk-overlay-container'],
    popoverItems: ['flow-add-menu-asset-list .cdk-virtual-scroll-content-wrapper > div'],
    agreeButtons: ['div.agree-actions-group button:last-child'],
    tiles: ['flow-grid-tile-container', '[data-tile-id]'],
    pending: ['flow-pending-tile'],
    alerts: ['mat-snack-bar-container', '[role="alert"]', '.mdc-snackbar', '[aria-live="assertive"]'],
    // Flow's agent UI (2026-10): a chat panel on the right with a "Bạn muốn tạo gì?" / "What do you want to create?" box.
    classicPromptBox: ['flow-base-prompt-box'],
    agentComposerHint: 'tạo gì|muốn tạo|what do you want|create|describe|mô tả|prompt',
    agentSubmitIcons: ['arrow_forward', 'send', 'arrow_upward', 'north'],
    agentSubmitLabel: 'gửi|send|submit|tạo|generate|run',
    agentBackIcons: ['arrow_back', 'arrow_back_ios', 'chevron_left'],
    agentOpenLabel: 'tác nhân|agent|trợ lý|assistant|gemini|chat|spark',
    // Whole button label only, so suggestion chips such as "Tạo thêm biến thể" are never pressed.
    agentAcceptText: '^(lưu|save|xong|done|chấp nhận|accept)$',
    agentConfirmText: '^(phê duyệt|approve|tạo|bắt đầu tạo|xác nhận|đồng ý|tiếp tục|có|ok|generate|create|confirm|continue|proceed|yes|run)( (ngay|video|hình ảnh|ảnh|nội dung|now|it|image))?$',
    // "Luôn phê duyệt" would change the account setting for good, so it is never pressed.
    agentCancelText: 'hủy|huỷ|cancel|không|từ chối|reject|deny|luôn|always|chỉnh sửa|edit|^no\\b',
    agentUploadText: 'tải nội dung|tải lên|upload',
    // {kind} {count} {aspect} {duration} {model} {refs} {prompt}; empty parts are dropped.
    agentTemplate: {
      image: 'Generate exactly 1 image now{aspect}{model}{refs}. Use this prompt exactly as written, do not rewrite it and do not ask me questions: {prompt}',
      video: 'Generate exactly 1 video now{aspect}{duration}{model}{refs}. Use this prompt exactly as written, do not rewrite it and do not ask me questions: {prompt}'
    }
  };
  const ICON_SELECTOR = 'mat-icon, i, .material-icons, .material-symbols-outlined, .google-symbols, [class*="symbols"]';
  const CLICKABLE = 'button, [role="button"], a, mat-list-item, mat-button-toggle, mat-option, [role="menuitem"], [role="option"], [role="radio"], [role="tab"]';
  const POLICY_RX = /(polic(y|ies)|violat|unsafe|not allowed|couldn'?t generate|could not generate|can'?t generate|unable to generate|blocked|prominent people|chính sách|vi phạm|không thể tạo)/i;
  const CREDIT_RX = /(not enough credits|insufficient credits|out of credits|no credits left|run out of credits|hết tín dụng|không đủ tín dụng)/i;
  const FAIL_RX = /(failed|error|something went wrong|try again|thất bại|đã xảy ra lỗi)/i;
  const MAX_TRANSFER_BYTES = 40 * 1024 * 1024;

  let SEL = DEFAULT_SELECTORS;
  let inputMode = 'auto';
  let usedTrustedInput = false;
  const activeGenerations = new Map();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type?.startsWith('THEKEY_FLOW_')) return false;
    SEL = { ...DEFAULT_SELECTORS, ...(message.selectors && typeof message.selectors === 'object' ? message.selectors : {}) };
    if (message.type === 'THEKEY_FLOW_CHECK_SESSION') { checkSession().then(sendResponse); return true; }
    if (message.type === 'THEKEY_FLOW_DIAGNOSE') { sendResponse(diagnose()); return false; }
    if (message.type === 'THEKEY_FLOW_GENERATE') {
      const controller = new AbortController();
      activeGenerations.set(message.requestId, controller);
      generate(message, controller.signal)
        .then(sendResponse, error => sendResponse({ ok: false, code: error.code || (error.name === 'AbortError' ? 'ABORTED' : 'FLOW_ERROR'), error: error.message || String(error) }))
        .finally(() => { activeGenerations.delete(message.requestId); releaseTrustedInput(); });
      return true;
    }
    if (message.type === 'THEKEY_FLOW_STOP_GENERATION') {
      const ids = message.requestId ? [message.requestId] : [...activeGenerations.keys()];
      let stopped = false;
      for (const id of ids) { const controller = activeGenerations.get(id); if (controller) { controller.abort(); stopped = true; } }
      sendResponse({ ok: true, stopped });
      return false;
    }
    return false;
  });

  // ---------- DOM helpers ----------
  const list = value => Array.isArray(value) ? value : value ? [value] : [];
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  }
  function query(selectors, root = document) {
    const out = [];
    for (const selector of list(selectors)) {
      try { for (const el of root.querySelectorAll(selector)) if (!out.includes(el)) out.push(el); } catch { /* invalid selector from overrides */ }
    }
    return out;
  }
  const firstVisible = (selectors, root) => query(selectors, root).find(visible) || null;
  function scopes(selectors) {
    const found = query(selectors).filter(visible);
    return found.length ? found : [];
  }
  function iconNames(el) {
    return [...el.querySelectorAll(ICON_SELECTOR)].map(icon => (icon.textContent || '').trim().toLowerCase()).filter(Boolean);
  }
  function clickables(scopeSelectors) {
    const roots = scopeSelectors ? scopes(scopeSelectors) : [document];
    const out = [];
    for (const root of roots) for (const el of root.querySelectorAll(CLICKABLE)) if (visible(el) && !out.includes(el)) out.push(el);
    return out;
  }
  function withIcon(names, scopeSelectors, { partial = false } = {}) {
    const wanted = list(names).map(name => name.toLowerCase());
    return clickables(scopeSelectors).filter(el => iconNames(el).some(icon => wanted.some(name => partial ? icon.includes(name) : icon === name)));
  }
  function withText(test, scopeSelectors) {
    return clickables(scopeSelectors).filter(el => {
      const icons = iconNames(el).join(' ');
      const text = (el.innerText || el.textContent || '').replace(icons, '').replace(/\s+/g, ' ').trim();
      return typeof test === 'function' ? test(text, el) : test.test(text);
    });
  }
  const isSelected = el => ['aria-pressed', 'aria-checked', 'aria-selected'].some(attr => el.getAttribute(attr) === 'true') || /(^|\s)(selected|active|checked|mat-button-toggle-checked)(\s|$)/.test(el.className || '') || Boolean(el.closest('.mat-button-toggle-checked'));
  const isDisabled = el => el.disabled || el.getAttribute('aria-disabled') === 'true';
  const norm = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const readEditor = editor => editor ? (editor.value ?? editor.innerText ?? editor.textContent ?? '') : '';

  const abortError = () => new DOMException('Generation stopped by user.', 'AbortError');
  const delay = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
  async function waitFor(test, timeoutMs, signal, interval = 200) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const value = test();
      if (value) return value;
      if (Date.now() >= end) return null;
      await delay(Math.min(interval, Math.max(0, end - Date.now())), signal);
    }
  }
  function flowError(message, code = 'FLOW_ERROR') { const error = new Error(message); error.code = code; return error; }
  const kindVi = kind => (kind === 'image' ? 'ảnh' : 'video');

  // ---------- input: DOM events first, trusted (DevTools protocol) input when Flow ignores them ----------
  async function trusted(op, extra = {}) {
    usedTrustedInput = true;
    const reply = await chrome.runtime.sendMessage({ type: 'THEKEY_CDP', op, ...extra });
    if (!reply?.ok) throw flowError(`Không nhập được bằng chế độ tin cậy: ${reply?.error || 'không có phản hồi'}. Hãy cho phép quyền gỡ lỗi (debugger) hoặc đổi Kiểu nhập sang "Chỉ sự kiện trang" trong Cài đặt.`);
  }
  function releaseTrustedInput() {
    if (!usedTrustedInput) return;
    usedTrustedInput = false;
    chrome.runtime.sendMessage({ type: 'THEKEY_CDP', op: 'detach' }).catch(() => {});
  }
  async function trustedClick(el, signal) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await delay(150, signal);
    const rect = el.getBoundingClientRect();
    await trusted('click', { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
  }
  function domClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const options = { bubbles: true, cancelable: true, composed: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', options));
    el.dispatchEvent(new MouseEvent('mousedown', options));
    el.dispatchEvent(new PointerEvent('pointerup', options));
    el.dispatchEvent(new MouseEvent('mouseup', options));
    el.click();
  }
  // verify: optional test that proves the click worked; in auto mode a failed check is retried once with trusted input.
  async function press(el, signal, verify, waitMs = 1500) {
    if (inputMode === 'cdp') { await trustedClick(el, signal); return true; }
    domClick(el);
    if (!verify) { await delay(250, signal); return true; }
    if (await waitFor(verify, waitMs, signal)) return true;
    if (inputMode !== 'auto') return false;
    await trustedClick(el, signal);
    return Boolean(await waitFor(verify, waitMs, signal));
  }
  // Flow's prompt box is a rich-text editor that may be re-rendered after focus, so every check
  // re-reads the current editor instead of trusting the first element found.
  const currentEditor = fallback => findEditor() || fallback;
  function selectAll(editor) {
    const range = document.createRange(); range.selectNodeContents(editor);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }
  function pasteInto(editor, text) {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
  }
  async function typePrompt(editor, text, signal) {
    const clean = String(text).replace(/\s*\n+\s*/g, ' ').trim();
    const accepted = () => norm(readEditor(currentEditor(editor)).replace(/[\u200b\ufeff]/g, '')).includes(norm(clean).slice(0, 60));
    if (inputMode !== 'cdp') {
      // A background tab has no keyboard focus, so rich-text editors ignore typing there.
      await bringToFront(signal);
      const strategies = [
        el => {
          if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
            Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, clean);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return;
          }
          selectAll(el); document.execCommand('delete'); document.execCommand('insertText', false, clean);
        },
        el => { selectAll(el); pasteInto(el, clean); },
        el => {
          selectAll(el);
          el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: clean, bubbles: true, cancelable: true, composed: true }));
        }
      ];
      for (const run of strategies) {
        const el = currentEditor(editor);
        el.scrollIntoView({ block: 'center' });
        el.focus();
        run(el);
        await delay(400, signal);
        if (accepted()) return;
      }
      if (inputMode === 'dom') throw flowError(`Flow không nhận chữ vừa nhập. Hãy chọn Kiểu nhập "Tự động (nên dùng)" trong Cài đặt. ${editorReport(editor)}`);
    }
    await bringToFront(signal);
    await trustedClick(currentEditor(editor), signal);
    const mac = /mac/i.test(navigator.platform || navigator.userAgent);
    await trusted('key', { key: 'a', code: 'KeyA', keyCode: 65, modifiers: mac ? 4 : 2 });
    await trusted('key', { key: 'Backspace', code: 'Backspace', keyCode: 8 });
    await trusted('insertText', { text: clean });
    await delay(500, signal);
    if (!accepted()) throw flowError(`Flow không nhận chữ vừa nhập, kể cả khi nhập bằng chế độ tin cậy. Chưa gửi gì cả. ${editorReport(editor)}`);
  }
  function editorReport(editor) {
    const el = currentEditor(editor);
    const tag = el ? `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.isContentEditable ? '[contenteditable]' : ''}` : 'none';
    const count = query(SEL.editor).filter(visible).length;
    return `(Prompt box: ${tag}, ${count} match(es), tab ${document.hidden ? 'hidden' : 'visible'}, focus ${document.hasFocus() ? 'yes' : 'no'}, it now reads "${norm(readEditor(el)).slice(0, 50)}". Send this line and the "Check Flow page" output to fix it.)`;
  }
  // Switches Chrome to the Flow tab for the moment Flow needs keyboard focus.
  async function bringToFront(signal) {
    if (!document.hidden && document.hasFocus()) return;
    try { await chrome.runtime.sendMessage({ type: 'THEKEY_ACTIVATE_TAB' }); } catch { return; }
    await waitFor(() => !document.hidden, 3000, signal);
    await delay(300, signal);
  }

  // ---------- page state ----------
  // Flow moved to the agent panel in Oct 2026; the old prompt-box flow only runs when the
  // selectors JSON in Settings sets "useClassicUi": true.
  const isClassicUi = () => SEL.useClassicUi === true;
  function findEditor() {
    if (!isClassicUi()) return findComposer();
    const all = query(SEL.editor).filter(visible);
    return all.find(el => el.isContentEditable || el instanceof HTMLTextAreaElement) || all[0] || null;
  }
  // ---------- agent UI ----------
  const rx = (source, flags = 'i') => { try { return new RegExp(source, flags); } catch { return /$^/; } };
  function hintText(el) {
    return [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('data-placeholder'), el.getAttribute('aria-placeholder'),
      el.parentElement?.querySelector('[class*="placeholder"], [data-placeholder]')?.textContent].filter(Boolean).join(' ');
  }
  // The agent box: never the project-name field or search at the top of the page, and a plain text
  // input only when its placeholder says it is the prompt box.
  function findComposer() {
    const editable = [...document.querySelectorAll('[contenteditable="true"], [contenteditable=""], textarea, [role="textbox"], input[type="text"]:not([readonly])')]
      .filter(el => visible(el) && !/tìm kiếm|search/i.test(hintText(el)) && el.getBoundingClientRect().top > innerHeight * 0.3);
    const hinted = editable.filter(el => rx(SEL.agentComposerHint).test(hintText(el)));
    const pool = hinted.length ? hinted : editable.filter(el => !(el instanceof HTMLInputElement));
    if (!pool.length) return null;
    // The agent box sits at the bottom of the panel: take the lowest one.
    return pool.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
  }
  function labelOf(el) {
    return [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('mattooltip'), el.getAttribute('data-tooltip')].filter(Boolean).join(' ');
  }
  function textOf(el) {
    const icons = iconNames(el).join(' ');
    // Icon fonts put their ligature name (check, close, add…) into the text; drop it from the ends.
    return (el.innerText || el.textContent || '').replace(icons, '').replace(/\s+/g, ' ').trim()
      .replace(/^(check|check_circle|done|close|add|add_2|arrow_forward)\s+/i, '').replace(/\s+(check|done|close|arrow_forward)$/i, '');
  }
  // The chat panel: the composer's nearest ancestor that is at least half the window tall.
  function agentPanel(composer = findComposer()) {
    let el = composer;
    while (el && el.parentElement && el !== document.body) {
      const rect = el.getBoundingClientRect();
      if (rect.height >= innerHeight * 0.5) return el;
      el = el.parentElement;
    }
    return document.body;
  }
  // The box around the agent input that also holds its + / settings / send buttons (smaller than the panel).
  function composerArea(composer) {
    let el = composer, best = composer.parentElement || composer;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.getBoundingClientRect().height >= innerHeight * 0.45) break;
      best = el;
    }
    return best;
  }
  function findAgentSubmit(composer) {
    const area = composerArea(composer);
    const buttons = [...area.querySelectorAll(CLICKABLE)].filter(visible);
    const wantedIcons = list(SEL.agentSubmitIcons);
    const byIcon = buttons.filter(el => iconNames(el).some(icon => wantedIcons.includes(icon)));
    const byLabel = buttons.filter(el => rx(SEL.agentSubmitLabel).test(labelOf(el)));
    const pool = byIcon.length ? byIcon : byLabel;
    return pool.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0] || null;
  }
  function panelButtons(panel) {
    return [...panel.querySelectorAll(CLICKABLE)].filter(visible);
  }
  async function openAgentComposer(signal) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (findComposer()) return findComposer();
      // Opening a project shows "Cài đặt tác nhân" first; it has to be accepted with "Lưu" before the box appears.
      const accept = clickables().find(el => el.getBoundingClientRect().left > innerWidth * 0.5 && rx(SEL.agentAcceptText).test(textOf(el)));
      if (accept) { await press(accept, signal, () => findComposer(), 2500); continue; }
      // Another page of the panel is open: go back to the chat.
      const back = clickables().find(el => iconNames(el).some(icon => list(SEL.agentBackIcons).includes(icon)) && el.getBoundingClientRect().left > innerWidth * 0.5);
      if (back) { await press(back, signal, () => findComposer(), 2000); continue; }
      // The panel is closed: open it from an agent button or the floating button on the right edge.
      const opener = clickables().find(el => rx(SEL.agentOpenLabel).test(labelOf(el)))
        || clickables().filter(el => { const r = el.getBoundingClientRect(); return r.right >= innerWidth - 8 && r.width <= 80 && r.top > innerHeight * 0.25; })[0];
      if (!opener) break;
      await press(opener, signal, () => findComposer() || clickables().some(el => rx(SEL.agentAcceptText).test(textOf(el))), 3000);
      await delay(500, signal);
    }
    return await waitFor(findComposer, 3000, signal);
  }
  function fillTemplate(kind, req, imageCount) {
    const templates = SEL.agentTemplate || DEFAULT_SELECTORS.agentTemplate;
    const template = templates[kind] || DEFAULT_SELECTORS.agentTemplate[kind];
    const refs = !imageCount ? '' : req.firstFrame ? (imageCount > 1 ? ', using the first attached image as the start frame and the others as references' : ', using the attached image as the start frame') : ', using the attached image(s) as references';
    const parts = {
      kind, count: '1',
      aspect: req.aspect ? `, aspect ratio ${req.aspect}` : '',
      duration: kind === 'video' && req.duration ? `, ${req.duration} seconds long` : '',
      model: req.model ? `, with the ${req.model} model` : '',
      refs,
      prompt: String(req.prompt || '').replace(/\s*\n+\s*/g, ' ').trim()
    };
    return template.replace(/\{(\w+)\}/g, (_, key) => parts[key] ?? '');
  }
  async function attachAgentImage(image, composer, warnings, signal) {
    const area = composerArea(composer);
    const before = new Set([...area.querySelectorAll('img')].map(mediaSrc));
    const pageBefore = allMediaSources();
    let captured = false;
    const onCaptured = () => { captured = true; };
    document.addEventListener('thekey-flow-file-input', onCaptured);
    document.documentElement.setAttribute('data-thekey-upload', '1');
    try {
      const add = [...area.querySelectorAll(CLICKABLE)].filter(visible).find(el => iconNames(el).some(icon => list(SEL.addIcons).includes(icon)) || /thêm|add|đính kèm|attach/i.test(labelOf(el)));
      if (!add) throw flowError('Không thấy nút + cạnh ô nhập của Flow để thêm ảnh. Chưa gửi gì cả.');
      await press(add, signal, () => captured || clickables().some(el => rx(SEL.agentUploadText).test(textOf(el) + ' ' + labelOf(el))), 2500);
      if (!captured) {
        const upload = clickables().find(el => rx(SEL.agentUploadText).test(textOf(el) + ' ' + labelOf(el))) || withIcon(SEL.uploadIcons)[0];
        if (!upload) throw flowError('Menu + của Flow không có mục "Tải nội dung". Chưa gửi gì cả.');
        await press(upload, signal, () => captured, 2500);
      }
      if (!(await waitFor(() => captured || domFileInput(), 4000, signal))) throw flowError('Flow không mở hộp chọn file cho ảnh. Chưa gửi gì cả.');
      if (captured) await sendFileToPage(image, signal);
      else {
        const input = domFileInput();
        const transfer = new DataTransfer(); transfer.items.add(await dataUrlToFile(image));
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const agree = firstVisible(SEL.agreeButtons);
      if (agree) await press(agree, signal);
      const attached = () => [...composerArea(findComposer() || composer).querySelectorAll('img')].some(img => { const src = mediaSrc(img); return src && !before.has(src) && visible(img); });
      // The upload lands in the asset picker; pick the new item if it is not attached by itself.
      const newItem = () => clickables().find(el => !composerArea(findComposer() || composer).contains(el) && [...el.querySelectorAll('img')].some(img => { const src = mediaSrc(img); return src && !pageBefore.has(src); }));
      const appeared = await waitFor(() => attached() || newItem(), 90000, signal, 500);
      if (!appeared) throw flowError('Tải ảnh lên Flow quá 90 giây vẫn chưa xong. Chưa gửi gì cả.');
      if (!attached()) { const item = newItem(); if (item) await press(item, signal, attached, 3000); }
      if (!(await waitFor(attached, 10000, signal, 400))) warnings.push(`Uploaded ${image.name}, but could not confirm it is attached to the agent message.`);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(300, signal);
    } finally {
      document.documentElement.removeAttribute('data-thekey-upload');
      document.removeEventListener('thekey-flow-file-input', onCaptured);
    }
  }
  function bigMedia(kind) {
    const out = [];
    for (const el of document.querySelectorAll(kind === 'video' ? 'video' : 'img')) {
      const src = mediaSrc(el);
      if (!src || /^data:image\/svg/i.test(src)) continue;
      const rect = el.getBoundingClientRect();
      const natural = kind === 'video' ? Math.max(el.videoWidth || 0, rect.width) : Math.max(el.naturalWidth || 0, rect.width);
      if (natural >= 96) out.push({ el, src });
    }
    return out;
  }
  async function generateAgent(req, kind, signal) {
    const warnings = [];
    let composer = await openAgentComposer(signal);
    if (!composer) throw flowError(`Không thấy ô nhập "Bạn muốn tạo gì?" của Flow. Hãy mở một dự án trong Flow và mở khung trợ lý bên phải rồi thử lại. (Trang: ${location.pathname})`, 'FLOW_NOT_READY');
    const images = [];
    if (req.firstFrame) images.push({ image: req.firstFrame, role: 'firstFrame' });
    for (const reference of req.references || []) images.push({ image: reference, role: 'reference' });
    for (const [index, item] of images.entries()) {
      const match = /^data:([^;,]+)/.exec(item.image) || [];
      const type = match[1] || 'image/png';
      await attachAgentImage({ dataUrl: item.image, type, name: `thekey-${item.role}-${index + 1}.${(type.split('/')[1] || 'png').replace('jpeg', 'jpg')}` }, findComposer() || composer, warnings, signal);
    }
    composer = findComposer() || composer;
    const message = fillTemplate(kind, req, images.length);
    await typePrompt(composer, message, signal);

    const panel = agentPanel(composer);
    const baselineMedia = new Set(bigMedia(kind).map(item => item.src));
    const baselineButtons = new Set(panelButtons(panel));
    const baselineText = (panel.innerText || '').length;
    const baselineAlerts = new Set(alertTexts());
    // What the agent wrote after our message: panel text after the end of what we sent, minus the input box itself.
    const newPanelText = () => {
      const current = findComposer() || composer;
      let text = norm(agentPanel(current).innerText);
      const area = norm(composerArea(current).innerText);
      if (area && text.endsWith(area)) text = text.slice(0, -area.length);
      const tail = norm(message).slice(-40);
      const at = tail ? text.lastIndexOf(tail) : -1;
      return at >= 0 ? text.slice(at + tail.length) : text.slice(Math.max(0, baselineText));
    };

    let submit = findAgentSubmit(composer);
    if (submit && isDisabled(submit)) submit = await waitFor(() => { const b = findAgentSubmit(findComposer() || composer); return b && !isDisabled(b) ? b : null; }, 8000, signal);
    const sent = () => !norm(readEditor(findComposer() || composer)) || (agentPanel(findComposer() || composer).innerText || '').length > baselineText + 20;
    let ok = false;
    if (submit) ok = await press(submit, signal, sent, 4000);
    if (!ok) {
      // No send button found, or it did nothing: press Enter in the box once.
      const target = findComposer() || composer;
      target.focus();
      if (inputMode === 'dom') target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      else await trusted('key', { key: 'Enter', code: 'Enter', keyCode: 13 });
      ok = Boolean(await waitFor(sent, 4000, signal));
    }
    if (!ok) throw flowError(`Trợ lý Flow không nhận tin nhắn (nút gửi: ${submit ? 'đã bấm' : 'không thấy'}). Chưa tạo gì cả. Hãy bấm "Kiểm tra trang Flow" trong Cài đặt và gửi kết quả.`);

    const timeoutMs = Math.min(1800, Math.max(60, Number(req.timeoutSec) || 900)) * 1000;
    const deadline = Date.now() + timeoutMs;
    const clicked = new Set();
    let confirmations = 0, refusalText = '', refusalSince = 0, panelMediaSince = 0;
    while (Date.now() < deadline) {
      if (signal.aborted) throw abortError();
      // Prefer the new result in the main grid; something new only inside the chat (for example the
      // attached image echoed back) is taken only if nothing shows up in the grid for 20 s.
      const currentPanelForMedia = agentPanel(findComposer() || composer);
      const newMedia = bigMedia(kind).filter(item => !baselineMedia.has(item.src));
      let fresh = newMedia.find(item => !currentPanelForMedia.contains(item.el));
      if (!fresh && newMedia.length) {
        panelMediaSince = panelMediaSince || Date.now();
        if (Date.now() - panelMediaSince > 20000) fresh = newMedia[0];
      }
      if (fresh) {
        await delay(kind === 'video' ? 1500 : 800, signal);
        const url = mediaSrc(fresh.el) || fresh.src;
        const copied = await copyLocally(url, kind);
        if (copied.error) warnings.push(copied.error);
        const size = await mediaSize(copied.url, kind);
        return { ok: true, url: copied.url, remoteUrl: url, width: size.width, height: size.height, warnings, trustedInput: usedTrustedInput };
      }
      const currentPanel = agentPanel(findComposer() || composer);
      // "Xác nhận trước khi tạo: Luôn luôn" makes the agent ask first; accept its new Generate/Confirm button once.
      if (confirmations < 2) {
        const confirm = panelButtons(currentPanel).find(el => !baselineButtons.has(el) && !clicked.has(el) && rx(SEL.agentConfirmText).test(textOf(el) || labelOf(el)) && !rx(SEL.agentCancelText).test(textOf(el) || labelOf(el)) && !isDisabled(el));
        if (confirm) { clicked.add(confirm); confirmations++; await press(confirm, signal); await delay(1000, signal); continue; }
      }
      const reply = newPanelText().trim();
      const alert = alertTexts().find(text => !baselineAlerts.has(text)) || '';
      if (CREDIT_RX.test(reply) || CREDIT_RX.test(alert)) throw flowError(`Flow: ${(alert || reply).slice(-300)}`, 'NO_CREDITS');
      if (POLICY_RX.test(alert)) throw flowError(`Flow từ chối câu lệnh này: ${alert}`, 'SCENE_REFUSED');
      // The agent answered in words that it cannot make this; wait until its reply stops changing.
      if (POLICY_RX.test(reply)) {
        if (reply !== refusalText) { refusalText = reply; refusalSince = Date.now(); }
        else if (Date.now() - refusalSince > 10000) throw flowError(`Trợ lý Flow không tạo ${kindVi(kind)} này: "${reply.slice(-300)}"`, 'SCENE_REFUSED');
      }
      await delay(1000, signal);
    }
    const last = newPanelText().trim().slice(-300);
    throw flowError(`Đã chờ ${Math.round(timeoutMs / 1000)} giây mà Flow chưa trả ${kindVi(kind)} mới. Tin nhắn chỉ gửi một lần. Lời cuối của trợ lý Flow: "${last}"`, POLICY_RX.test(last) ? 'SCENE_REFUSED' : 'TIMEOUT');
  }
  function findSubmit() {
    return firstVisible(SEL.submitButtons || []) || withIcon(SEL.submitIcons, SEL.submitScopes)[0] || null;
  }
  function mediaSrc(el) {
    if (!el) return '';
    return el.currentSrc || el.src || el.querySelector?.('source')?.src || '';
  }
  function tiles() {
    const found = query(SEL.tiles);
    return found.map(tile => {
      const video = [...tile.querySelectorAll('video')].map(mediaSrc).find(Boolean) || '';
      const image = [...tile.querySelectorAll('img')].map(mediaSrc).find(src => src && !/^data:image\/svg/i.test(src)) || '';
      const text = (tile.innerText || '').replace(/\s+/g, ' ').trim();
      return { el: tile, id: tile.getAttribute('data-tile-id') || '', video, image, text, percent: /(^|\s)\d{1,3}%(\s|$)/.test(text), pending: Boolean(tile.matches?.(list(SEL.pending).join(',')) || query(SEL.pending, tile).length) };
    });
  }
  function pendingCount() {
    return query(SEL.pending).length + tiles().filter(tile => tile.percent).length;
  }
  function allMediaSources() {
    const set = new Set();
    for (const el of document.querySelectorAll('video, img')) { const src = mediaSrc(el); if (src) set.add(src); }
    return set;
  }
  function alertTexts() {
    return query(SEL.alerts).filter(visible).map(el => (el.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  function promptAreaImages() {
    const roots = scopes(SEL.promptScopes);
    const editor = findEditor();
    if (!roots.length && editor) { let root = editor; for (let i = 0; i < 5 && root.parentElement; i++) root = root.parentElement; roots.push(root); }
    const set = new Set();
    for (const root of roots) for (const img of root.querySelectorAll('img')) { const src = mediaSrc(img); if (src && visible(img)) set.add(src); }
    return set;
  }

  async function checkSession() {
    const editor = await waitFor(findEditor, 5000).catch(() => null);
    const bodyText = document.body?.innerText || '';
    const loginRequired = !editor && (/sign in|đăng nhập/i.test(bodyText) || Boolean(document.querySelector('a[href*="accounts.google.com"]')));
    return { ok: true, ready: Boolean(editor), loginRequired, inProject: Boolean(editor), url: location.href, title: document.title };
  }

  function diagnose() {
    const editor = findEditor();
    const icons = new Set(), flowTags = new Set();
    for (const el of clickables()) iconNames(el).forEach(name => icons.add(name));
    for (const el of document.querySelectorAll('*')) { const tag = el.tagName.toLowerCase(); if (tag.startsWith('flow-')) flowTags.add(tag); }
    return {
      ok: true, url: location.href,
      editor: Boolean(editor), editorTag: editor ? `${editor.tagName.toLowerCase()}${editor.getAttribute('role') ? `[role=${editor.getAttribute('role')}]` : ''}` : '',
      submitButton: Boolean(findSubmit()),
      settingsButton: withIcon(SEL.settingsIcons, SEL.submitScopes).length,
      settingsPanelOpen: scopes(SEL.settingsPanel).length > 0,
      addImageButton: Boolean(firstVisible(SEL.addImageButtons) || withIcon(SEL.addIcons, SEL.promptScopes)[0]),
      tiles: query(SEL.tiles).length, pending: pendingCount(), videos: document.querySelectorAll('video').length,
      buttonIcons: [...icons].slice(0, 120), flowTags: [...flowTags].slice(0, 120),
      agent: agentReport()
    };
  }
  function describe(el) {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    return [`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`, iconNames(el).length ? `icon=${iconNames(el).join('/')}` : '', labelOf(el) ? `label="${labelOf(el).slice(0, 40)}"` : '', textOf(el) ? `text="${textOf(el).slice(0, 30)}"` : ''].filter(Boolean).join(' ');
  }
  function agentReport() {
    const composer = findComposer();
    if (!composer) {
      return { classicUi: isClassicUi(), composer: false, rightEdgeButtons: clickables().filter(el => el.getBoundingClientRect().right >= innerWidth - 8).map(describe).slice(0, 10) };
    }
    const panel = agentPanel(composer), area = composerArea(composer), submit = findAgentSubmit(composer);
    return {
      classicUi: isClassicUi(), composer: describe(composer), composerHint: hintText(composer).slice(0, 60),
      submit: submit ? describe(submit) : false,
      composerButtons: [...area.querySelectorAll(CLICKABLE)].filter(visible).map(describe).slice(0, 15),
      panelButtons: panelButtons(panel).map(describe).slice(0, 40),
      newestPanelText: (panel.innerText || '').replace(/\s+/g, ' ').trim().slice(-300),
      gridImages: bigMedia('image').filter(item => !panel.contains(item.el)).length, gridVideos: bigMedia('video').filter(item => !panel.contains(item.el)).length
    };
  }

  // ---------- Flow settings ----------
  async function pick(candidates, label, warnings, signal) {
    const el = candidates[0];
    if (!el) { warnings.push(`Could not find "${label}" in Flow settings; kept Flow's current choice.`); return false; }
    if (isSelected(el)) return true;
    await press(el, signal, () => isSelected(el) || !el.isConnected, 900);
    await delay(300, signal);
    return true;
  }
  async function configure(req, warnings, signal) {
    const panelOpen = () => scopes(SEL.settingsPanel).length > 0;
    let openedHere = false;
    if (!panelOpen()) {
      const button = withIcon(SEL.settingsIcons, SEL.submitScopes)[0];
      if (!button) { warnings.push('Could not find the Flow settings button; used the settings already chosen in Flow.'); return; }
      if (!(await press(button, signal, panelOpen))) { warnings.push('Flow settings did not open; used the settings already chosen in Flow.'); return; }
      openedHere = true;
    }
    const panel = SEL.settingsPanel;
    await pick(withIcon(req.kind === 'video' ? SEL.videoModeIcons : SEL.imageModeIcons, panel), req.kind === 'video' ? 'Video' : 'Image', warnings, signal);
    if (req.kind === 'video') {
      const frames = Boolean(req.firstFrame);
      if (frames || req.references?.length) await pick(withIcon(frames ? SEL.framesModeIcons : SEL.ingredientsModeIcons, panel), frames ? 'Frames to Video' : 'Ingredients to Video', warnings, signal);
    }
    if (req.aspect) {
      const hints = (SEL.aspectHints || {})[req.aspect] || [req.aspect];
      const byIcon = withIcon(hints, panel, { partial: true });
      const byText = withText(text => hints.some(hint => text.toLowerCase().includes(hint.toLowerCase())), panel);
      await pick([...byIcon, ...byText], `aspect ${req.aspect}`, warnings, signal);
    }
    await pick(withText(text => /^(x\s?1|1\s?x)$/i.test(text), panel), 'outputs x1', warnings, signal);
    if (req.kind === 'video' && req.duration) {
      const seconds = String(req.duration);
      await pick(withText(text => new RegExp(`^${seconds}\\s?s?$`, 'i').test(text), panel), `${seconds}s`, warnings, signal);
    }
    if (req.model) {
      const opener = withIcon(SEL.modelMenuIcons, panel)[0];
      if (!opener) warnings.push('Could not find the Flow model menu; kept Flow\'s current model.');
      else {
        const wanted = norm(req.model);
        const findItem = () => query(SEL.menuItems).filter(visible).find(el => norm(el.innerText).includes(wanted));
        await press(opener, signal, () => query(SEL.menuItems).some(visible));
        const item = await waitFor(findItem, 1500, signal);
        if (item) { await press(item, signal); await delay(300, signal); }
        else { warnings.push(`Model "${req.model}" was not in Flow's model menu; kept Flow's current model.`); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
      }
    }
    if (openedHere && panelOpen()) {
      const button = withIcon(SEL.settingsIcons, SEL.submitScopes)[0];
      if (button) await press(button, signal, () => !panelOpen());
    }
  }

  // ---------- image upload ----------
  function domFileInput() {
    return [...document.querySelectorAll('input[type="file"]')].filter(input => !input.disabled && (!input.accept || /image|\*|png|jpe?g|webp/i.test(input.accept))).pop() || null;
  }
  async function sendFileToPage(image, signal) {
    const resultPromise = new Promise(resolve => {
      const done = event => { document.removeEventListener('thekey-flow-upload-result', done); let data = {}; try { data = JSON.parse(String(event.detail || '{}')); } catch {} resolve(data); };
      document.addEventListener('thekey-flow-upload-result', done);
      setTimeout(() => { document.removeEventListener('thekey-flow-upload-result', done); resolve({ ok: false, error: 'Phần gắn vào trang Flow không phản hồi.' }); }, 5000);
    });
    document.dispatchEvent(new CustomEvent('thekey-flow-upload', { detail: JSON.stringify({ files: [image] }) }));
    const result = await resultPromise;
    if (signal?.aborted) throw abortError();
    if (!result.ok) throw flowError(`Không đưa được ảnh vào Flow: ${result.error}`);
  }
  async function dataUrlToFile(image) {
    const blob = await (await fetch(image.dataUrl)).blob();
    return new File([blob], image.name, { type: blob.type || image.type || 'image/png' });
  }
  async function attachImage(image, role, warnings, signal) {
    const before = promptAreaImages();
    const pageImagesBefore = allMediaSources();
    let captured = false;
    const onCaptured = () => { captured = true; };
    document.addEventListener('thekey-flow-file-input', onCaptured);
    document.documentElement.setAttribute('data-thekey-upload', '1');
    try {
      const add = firstVisible(SEL.addImageButtons) || withIcon(SEL.addIcons, SEL.promptScopes)[0];
      if (!add) throw flowError(`Không thấy nút thêm ${role === 'firstFrame' ? 'khung đầu' : 'ảnh tham chiếu'} trong Flow.`);
      const inputBefore = domFileInput();
      await press(add, signal);
      await delay(700, signal);
      if (!captured) {
        const upload = withIcon(SEL.uploadIcons, SEL.popoverScopes)[0] || withIcon(SEL.uploadIcons)[0];
        if (upload) await press(upload, signal, () => captured || (domFileInput() && domFileInput() !== inputBefore), 2500);
      }
      await waitFor(() => captured || (domFileInput() && domFileInput() !== inputBefore), 4000, signal);
      if (captured) await sendFileToPage(image, signal);
      else {
        const input = domFileInput();
        if (!input) throw flowError('Flow không mở hộp chọn file cho ảnh. Hãy thử tải ảnh lên bằng tay một lần, hoặc bấm "Kiểm tra trang Flow" trong Cài đặt.');
        const transfer = new DataTransfer(); transfer.items.add(await dataUrlToFile(image));
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await delay(900, signal);
      const agree = firstVisible(SEL.agreeButtons);
      if (agree) await press(agree, signal);
      // Flow uploads into its asset picker; once the new image shows there, select it.
      const newInPicker = () => query(SEL.popoverItems).filter(visible).find(item => [...item.querySelectorAll('img')].some(img => { const src = mediaSrc(img); return src && !pageImagesBefore.has(src); }));
      const attached = () => [...promptAreaImages()].some(src => !before.has(src));
      const appeared = await waitFor(() => attached() || newInPicker(), 90000, signal, 500);
      if (!appeared) throw flowError('Tải ảnh lên Flow quá 90 giây vẫn chưa xong. Chưa gửi gì cả.');
      if (!attached()) {
        const item = newInPicker();
        if (item) await press(item, signal, attached, 3000);
      }
      if (!(await waitFor(attached, 15000, signal, 400))) warnings.push(`Uploaded ${image.name}, but could not confirm it is attached to the prompt.`);
      if (query(SEL.popoverScopes).some(visible)) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } finally {
      document.documentElement.removeAttribute('data-thekey-upload');
      document.removeEventListener('thekey-flow-file-input', onCaptured);
    }
  }

  // ---------- results ----------
  function blobToDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error || new Error('Không chuyển đổi được ảnh/video.')); reader.readAsDataURL(blob); }); }
  async function copyLocally(url, kind) {
    if (url.startsWith('data:')) return { url };
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('empty file');
      if (blob.size > MAX_TRANSFER_BYTES) return { url, error: `${kindVi(kind)} lớn hơn 40 MB nên TheKey.studio sẽ tải từ đường link.` };
      return { url: await blobToDataUrl(blob) };
    } catch (error) {
      return { url, error: `Đã thấy ${kindVi(kind)} mới nhưng không chép được từ tab Flow (${error.message}); đang thử tải từ đường link.` };
    }
  }
  function mediaSize(url, kind) {
    return new Promise(resolve => {
      const el = document.createElement(kind === 'video' ? 'video' : 'img');
      const done = () => resolve({ width: el.videoWidth || el.naturalWidth || 0, height: el.videoHeight || el.naturalHeight || 0 });
      el.onerror = () => resolve({ width: 0, height: 0 });
      if (kind === 'video') { el.preload = 'metadata'; el.muted = true; el.onloadedmetadata = done; } else el.onload = done;
      setTimeout(() => resolve({ width: 0, height: 0 }), 8000);
      el.src = url;
    });
  }

  async function generate(req, signal) {
    inputMode = ['auto', 'dom', 'cdp'].includes(req.inputMode) ? req.inputMode : 'auto';
    const kind = req.kind === 'image' ? 'image' : 'video';
    const warnings = [];
    if (!String(req.prompt || '').trim()) throw flowError('Câu lệnh đang trống.');
    // Chrome pauses drawing in background tabs, so Flow may not show its prompt box until the tab is in front.
    if (inputMode !== 'dom') await bringToFront(signal);
    // Wait for either the classic prompt box or the agent page to be drawn.
    let editor = await waitFor(() => findEditor() || (location.pathname.includes('/project/') && document.readyState === 'complete' && document.body.innerText.length > 50 ? 'page' : null), 15000, signal);
    if (editor === 'page') editor = findEditor();
    if (!isClassicUi()) return generateAgent(req, kind, signal);
    if (!editor) {
      const any = query(SEL.editor).length, editable = document.querySelectorAll('[contenteditable="true"], textarea').length;
      throw flowError(`Không thấy ô nhập câu lệnh của Flow. Hãy mở một dự án trong Google Flow rồi thử lại. (Trang: ${location.pathname}, ô lệnh khớp ${any}, ô nhập được ${editable}, tab ${document.hidden ? 'đang ẩn' : 'đang hiện'}.)`, 'FLOW_NOT_READY');
    }

    await configure({ ...req, kind }, warnings, signal);
    const images = [];
    if (req.firstFrame) images.push({ image: req.firstFrame, role: 'firstFrame' });
    for (const reference of req.references || []) images.push({ image: reference, role: 'reference' });
    for (const [index, item] of images.entries()) {
      const match = /^data:([^;,]+)/.exec(item.image) || [];
      const type = match[1] || 'image/png';
      await attachImage({ dataUrl: item.image, type, name: `thekey-${item.role}-${index + 1}.${(type.split('/')[1] || 'png').replace('jpeg', 'jpg')}` }, item.role, warnings, signal);
    }

    const target = findEditor() || editor;
    await typePrompt(target, req.prompt, signal);

    const baselineMedia = allMediaSources();
    const baselineIds = new Set(tiles().map(tile => tile.id).filter(Boolean));
    const baselineAlerts = new Set(alertTexts());
    const basePending = pendingCount();
    const newAlert = () => alertTexts().find(text => !baselineAlerts.has(text)) || '';

    let submit = findSubmit();
    if (!submit) throw flowError('Không thấy nút Tạo của Flow. Chưa gửi gì cả.');
    if (isDisabled(submit)) submit = await waitFor(() => { const button = findSubmit(); return button && !isDisabled(button) ? button : null; }, 8000, signal);
    if (!submit) throw flowError('Nút Tạo của Flow vẫn bị khoá (có thể ảnh còn đang tải lên hoặc đã hết credit). Chưa gửi gì cả.');
    const accepted = () => pendingCount() > basePending || tiles().some(tile => tile.id && !baselineIds.has(tile.id)) || !norm(readEditor(findEditor() || target)) || Boolean(newAlert());
    // One submission only: the trusted retry fires only if nothing at all changed after the first click.
    const confirmed = await press(submit, signal, accepted, 4000);
    if (!confirmed) throw flowError('Flow không xác nhận đã nhận lệnh. Hãy xem tab Flow; TheKey.studio không gửi lại.');

    const timeoutMs = Math.min(1800, Math.max(60, Number(req.timeoutSec) || 900)) * 1000;
    const deadline = Date.now() + timeoutMs;
    const failingSince = new Map();
    let alertSince = 0;
    while (Date.now() < deadline) {
      if (signal.aborted) throw abortError();
      const alert = newAlert();
      if (alert && CREDIT_RX.test(alert)) throw flowError(`Flow: ${alert}`, 'NO_CREDITS');
      if (alert && POLICY_RX.test(alert)) throw flowError(`Flow từ chối câu lệnh này: ${alert}`, 'SCENE_REFUSED');
      const current = tiles();
      const fresh = current.find(tile => kind === 'video' ? tile.video && !baselineMedia.has(tile.video) : tile.image && !tile.video && !tile.pending && !tile.percent && !baselineMedia.has(tile.image));
      if (fresh) {
        const url = kind === 'video' ? fresh.video : fresh.image;
        const copied = await copyLocally(url, kind);
        if (copied.error) warnings.push(copied.error);
        const size = await mediaSize(copied.url, kind);
        return { ok: true, url: copied.url, remoteUrl: url, width: size.width, height: size.height, warnings, trustedInput: usedTrustedInput };
      }
      for (const tile of current) {
        const isNew = tile.id ? !baselineIds.has(tile.id) : false;
        if (!isNew || tile.video || tile.percent || tile.pending || !tile.text) continue;
        if (!(POLICY_RX.test(tile.text) || CREDIT_RX.test(tile.text) || FAIL_RX.test(tile.text))) continue;
        const since = failingSince.get(tile.id) || Date.now();
        failingSince.set(tile.id, since);
        if (Date.now() - since > 3000) {
          if (CREDIT_RX.test(tile.text)) throw flowError(`Flow: ${tile.text}`, 'NO_CREDITS');
          throw flowError(`Flow không tạo được ${kindVi(kind)} này: ${tile.text.slice(0, 400)}`, POLICY_RX.test(tile.text) ? 'SCENE_REFUSED' : 'FLOW_ERROR');
        }
      }
      // A generic error toast only counts once nothing is generating any more.
      if (alert && FAIL_RX.test(alert) && pendingCount() <= basePending) {
        alertSince = alertSince || Date.now();
        if (Date.now() - alertSince > 5000) throw flowError(`Flow báo lỗi: ${alert}`);
      } else alertSince = 0;
      await delay(1000, signal);
    }
    throw flowError(`Đã chờ ${Math.round(timeoutMs / 1000)} giây mà Flow chưa trả ${kindVi(kind)} mới. Câu lệnh chỉ gửi một lần, không gửi lại.`, 'TIMEOUT');
  }
})();
