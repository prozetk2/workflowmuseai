// cos_alpha_flow bridge: runs inside the signed-in Google Flow tab (isolated world).
// The canvas tab sends THEKEY_FLOW_* messages; this script fills Flow's prompt box, picks
// settings, attaches images, presses Generate once, and waits for the new result tile.
//
// Flow's markup changes often. Every selector lives in DEFAULT_SELECTORS so it can be fixed
// in one place, or overridden from cos_alpha_flow Settings → "Flow selectors (JSON)" without
// reloading the extension. THEKEY_FLOW_DIAGNOSE reports which of them still match.
(() => {
  if (window.__theKeyFlowBridgeInstalled) return;
  window.__theKeyFlowBridgeInstalled = true;

  const DEFAULT_SELECTORS = {
    editor: ['flow-base-prompt-box div[role="textbox"]', '[data-slate-editor="true"]', 'div[role="textbox"][contenteditable="true"]', 'flow-rich-text-editor [contenteditable="true"]', 'div[role="textbox"]', 'textarea'],
    promptScopes: ['flow-base-prompt-box', 'flow-prompt-box', 'flow-ingredient-bar', 'div.submit-controls'],
    submitScopes: ['div.submit-controls', 'flow-generate-icon-button', 'flow-base-prompt-box'],
    submitIcons: ['arrow_forward', 'send'],
    settingsIcons: ['tune', 'crop'],
    // Flow 2026-11: the chip at the right of the prompt box ("Nano Banana 2.1 · 9:16 · x1" / "Video · 720p · 6 giây").
    settingsButtons: ['button.settings-trigger-button'],
    // The "Tác nhân" chip in the prompt box: aria-pressed="false" means prompts go straight to the chosen model.
    agentModeChip: ['flow-agent-mode-toggle-chip button', 'button.agent-mode-chip'],
    settingsPanel: ['flow-prompt-box-settings'],
    videoModeIcons: ['videocam'],
    imageModeIcons: ['image', 'photo'],
    framesModeIcons: ['crop_free'],
    ingredientsModeIcons: ['chrome_extension', 'extension'],
    aspectHints: { '16:9': ['16_9', '16:9', 'landscape'], '9:16': ['9_16', '9:16', 'portrait'], '1:1': ['1_1', '1:1', 'square'], '4:3': ['4_3', '4:3'], '3:4': ['3_4', '3:4'] },
    modelMenuIcons: ['arrow_drop_down'],
    resolutionHints: { '720p': ['720p', '720'], '1080p': ['1080p', '1080'] },
    // Flow model families, used to find the model button when it has no dropdown icon.
    modelNameHint: 'veo|omni|nano banana|imagen',
    // Agent off (classic mode): the agent switch is a pressed button labelled Agent / Tác nhân;
    // the agent chat panel has a close (X) button next to its "new chat" (edit_square) button.
    agentToggleLabel: 'agent|tác nhân',
    agentPanelCloseIcons: ['close'],
    agentPanelSiblingIcons: ['edit_square', 'add_comment'],
    voiceIcons: ['record_voice_over', 'voice_selection', 'graphic_eq', 'mic', 'spatial_audio'],
    voiceLabel: 'giọng|voice',
    searchInputs: ['input[type="search"]', 'input[placeholder*="Tìm" i]', 'input[placeholder*="Search" i]'],
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
    agentCancelText: 'hủy|huỷ|cancel|không|từ chối|reject|deny|luôn|always|chỉnh sửa|edit|thử lại|try again|retry|^no\\b',
    // The add menu's upload button ("Tải nội dung ..."). Its "Tệp tải lên" entry is only a filter
    // of past uploads, so a loose "tải lên|upload" match is used only when nothing better is there.
    agentUploadText: 'tải nội dung|tải tệp lên|upload media|upload content|upload file',
    agentUploadLoose: 'tải lên|upload',
    agentUploadSkip: '^(tệp tải lên|tệp đã tải lên|đã tải lên|uploads?|uploaded( files?)?|my uploads)$',
    // {kind} {count} {aspect} {duration} {model} {refs} {prompt}; empty parts are dropped.
    agentTemplate: {
      image: 'Generate exactly 1 image now{aspect}{model}{refs}. Use this prompt exactly as written, do not rewrite it and do not ask me questions: {prompt}',
      video: 'Generate exactly 1 video now{aspect}{duration}{resolution}{model}{voice}{refs}. Use this prompt exactly as written, do not rewrite it and do not ask me questions: {prompt}'
    }
  };
  const ICON_SELECTOR = 'mat-icon, i, .material-icons, .material-symbols-outlined, .google-symbols, [class*="symbols"]';
  const CLICKABLE = 'button, [role="button"], a, mat-list-item, mat-button-toggle, mat-option, [role="menuitem"], [role="option"], [role="radio"], [role="tab"]';
  const POLICY_RX = /(polic(y|ies)|violat|unsafe|not allowed|couldn'?t generate|could not generate|can'?t generate|unable to generate|blocked|prominent people|chính sách|vi phạm|không thể tạo)/i;
  // Google's own "unusual activity" notice: this request was blocked, so stop instead of trying again.
  const BLOCKED_RX = /(hoạt động bất thường|unusual activity|unusual traffic|lưu lượng truy cập bất thường)/i;
  const CREDIT_RX = /(not enough credits|insufficient credits|out of credits|no credits left|run out of credits|hết tín dụng|không đủ tín dụng)/i;
  const FAIL_RX = /(failed|error|something went wrong|try again|unsuccessful|thất bại|đã xảy ra lỗi|không thành công|không tạo được)/i;
  // Flow made the picture but could not make its sound ("Không tạo được âm thanh"); credits are refunded.
  const AUDIO_FAIL_RX = /(không tạo được âm thanh|could ?n[o']t generate (the )?audio|unable to generate (the )?audio|audio generation failed)/i;
  const MAX_TRANSFER_BYTES = 40 * 1024 * 1024;

  let SEL = DEFAULT_SELECTORS;
  let inputMode = 'auto';
  let usedTrustedInput = false;
  const activeGenerations = new Map();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type?.startsWith('THEKEY_FLOW_')) return false;
    // Queue state from the cos_alpha_flow app: draw the floating panel; must not touch SEL.
    if (message.type === 'THEKEY_FLOW_QUEUE_STATE') { try { renderQueueOverlay(message.snapshot); } catch (error) { console.warn('[cos_alpha_flow] overlay', error); } sendResponse({ ok: true }); return false; }
    SEL = { ...DEFAULT_SELECTORS, ...(message.selectors && typeof message.selectors === 'object' ? message.selectors : {}) };
    if (message.type === 'THEKEY_FLOW_CHECK_SESSION') { checkSession().then(sendResponse); return true; }
    if (message.type === 'THEKEY_FLOW_DIAGNOSE') { sendResponse(diagnose()); return false; }
    if (message.type === 'THEKEY_FLOW_SILENT_FALLBACK') { setSilentFallback(message.on !== false).then(sendResponse, error => sendResponse({ ok: false, error: error.message || String(error) })); return true; }
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


  // ---------- cos_alpha_flow queue overlay ----------
  // A small panel (in a shadow root, so the bridge's own DOM queries never see it) that mirrors the
  // app's queue and lets the user pause / resume / stop / skip without leaving Flow.
  let overlayHost = null, overlayRoot = null, overlayClosedAt = 0, overlayExpanded = false, lastSnapshot = null;
  const overlayPos = { left: 12, top: 76 };
  try { const saved = JSON.parse(sessionStorage.getItem('cosalpha-overlay-pos') || 'null'); if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) Object.assign(overlayPos, saved); } catch { /* default */ }
  const sendQueueCmd = (cmd, extra = {}) => { try { chrome.runtime.sendMessage({ type: 'COSALPHA_QUEUE_CMD', cmd, ...extra }).catch(() => {}); } catch { /* extension reloaded */ } };
  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ensureOverlay() {
    if (overlayHost?.isConnected) return;
    overlayHost = document.createElement('div');
    overlayHost.id = 'cosalpha-queue-overlay';
    overlayHost.style.cssText = 'position:fixed;z-index:2147483000;';
    overlayRoot = overlayHost.attachShadow({ mode: 'open' });
    overlayRoot.innerHTML = `<style>
      :host{all:initial}
      .p{font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#eee;background:#14151cee;border:1px solid #4b3c86;border-radius:12px;box-shadow:0 12px 40px #0009;width:290px;overflow:hidden;backdrop-filter:blur(6px)}
      .h{display:flex;align-items:center;gap:6px;padding:7px 8px;cursor:move;background:linear-gradient(90deg,#2a1d55,#3b2312);user-select:none}
      .logo{font-weight:900;color:#ff9a4a}.t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      button{all:unset;cursor:pointer;padding:2px 6px;border-radius:6px;background:#ffffff14;font-size:12px}button:hover{background:#ffffff2a}
      .bar{height:4px;background:#2a2c36}.bar i{display:block;height:100%;background:linear-gradient(90deg,#ff8a3d,#7d61ff)}
      .s{padding:6px 9px;color:#b9bbc6;font-size:11px;max-height:44px;overflow:hidden}
      ul{list-style:none;margin:0;padding:4px 6px 8px;max-height:260px;overflow:auto}li{display:flex;align-items:center;gap:6px;padding:4px 3px;border-top:1px solid #ffffff10}
      li .n{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}li small{color:#9da0ad}
      .running small{color:#f1c75b}.success small{color:#65d894}.error small{color:#ff7979}.queued small{color:#b3a6ff}.willSkip,.skipped{opacity:.55}
      .f{display:flex;gap:6px;padding:0 8px 8px}.btns{display:flex;gap:6px;padding:6px 8px 0}.btns:empty{display:none}
    </style><div class="p"><div class="h"><span class="logo">α</span><span class="t"></span><button data-c="toggle" title="Mở rộng / thu gọn">Chi tiết</button><button data-c="close" title="Ẩn đến lượt chạy sau">Ẩn</button></div><div class="bar"><i></i></div><div class="btns"></div><div class="body"></div></div>`;
    document.documentElement.appendChild(overlayHost);
    placeOverlay();
    overlayRoot.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      const c = button.dataset.c;
      if (c === 'toggle') { overlayExpanded = !overlayExpanded; renderQueueOverlay(lastSnapshot); }
      else if (c === 'close') { overlayClosedAt = Date.now(); overlayHost.remove(); }
      else if (c === 'skip') sendQueueCmd('skip', { nodeId: button.dataset.id });
      else sendQueueCmd(c);
    });
    const header = overlayRoot.querySelector('.h');
    header.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      const start = { x: event.clientX, y: event.clientY, left: overlayPos.left, top: overlayPos.top };
      const move = e => { overlayPos.left = Math.max(0, Math.min(innerWidth - 80, start.left + e.clientX - start.x)); overlayPos.top = Math.max(0, Math.min(innerHeight - 40, start.top + e.clientY - start.y)); placeOverlay(); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); try { sessionStorage.setItem('cosalpha-overlay-pos', JSON.stringify(overlayPos)); } catch { /* ignore */ } };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
  }
  function placeOverlay() { if (overlayHost) { overlayHost.style.left = `${overlayPos.left}px`; overlayHost.style.top = `${overlayPos.top}px`; } }
  function renderQueueOverlay(snap) {
    lastSnapshot = snap;
    if (!snap) return;
    const active = snap.running || snap.items.some(item => item.status === 'queued');
    const recent = snap.finishedAt && Date.now() - snap.finishedAt < 60000;
    if (!active && !recent) { overlayHost?.remove(); return; }
    // Closed by the user: stay hidden until the next run starts.
    if (overlayClosedAt && (snap.startedAt || 0) < overlayClosedAt) return;
    ensureOverlay();
    const current = snap.items.find(item => item.status === 'running');
    const title = snap.running ? `${snap.paused ? 'Tạm dừng' : current ? `Đang tạo ${current.kind === 'video' ? 'video' : 'ảnh'}` : 'Đang chạy'} · ${snap.done}/${snap.total}` : `Xong ${snap.done}/${snap.total}${snap.failed ? ` · ${snap.failed} lỗi` : ''}`;
    overlayRoot.querySelector('.t').textContent = `cos_alpha_flow · ${title}`;
    overlayRoot.querySelector('.btns').innerHTML = snap.running ? `${snap.paused ? '<button data-c="resume" title="Tiếp tục">Tiếp tục</button>' : '<button data-c="pause" title="Tạm dừng sau lượt này">Tạm dừng</button>'}<button data-c="stop" title="Dừng tất cả">Dừng tất cả</button>` : '';
    overlayRoot.querySelector('.bar i').style.width = `${snap.total ? Math.round(snap.done / snap.total * 100) : 0}%`;
    overlayRoot.querySelector('[data-c="toggle"]').textContent = overlayExpanded ? 'Thu gọn' : 'Chi tiết';
    const body = overlayRoot.querySelector('.body');
    if (!overlayExpanded) { body.innerHTML = current ? `<div class="s">${escHtml(current.label)}</div>` : ''; return; }
    body.innerHTML = `<div class="s">${escHtml(snap.status || '')}</div><ul>${snap.items.map(item => `<li class="${escHtml(item.status)}"><span class="n">${item.kind === 'video' ? 'Video' : 'Ảnh'} · ${escHtml(item.label)}<br><small>${escHtml(item.statusText)}${item.error ? ' · ' + escHtml(item.error) : ''}</small></span>${['waiting', 'willSkip', 'queued'].includes(item.status) ? `<button data-c="skip" data-id="${escHtml(item.id)}">${item.status === 'willSkip' ? 'Không bỏ' : item.status === 'queued' ? 'Huỷ' : 'Bỏ qua'}</button>` : ''}</li>`).join('')}</ul><div class="f"><button data-c="openApp">Mở cos_alpha_flow</button>${!snap.running && snap.failed ? '<button data-c="runAll">Chạy lại mục lỗi</button>' : ''}</div>`;
  }
  sendQueueCmd('hello');

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
    await waitFor(() => canType(currentEditor(editor)), 15000, signal, 300);
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
    const tag = el ? `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.isContentEditable ? '[contenteditable]' : ''}${canType(el) ? '' : ' (đang khoá)'}` : 'none';
    const count = query(SEL.editor).filter(visible).length;
    return `(Ô nhập: ${tag}, khớp ${count}, tab ${document.hidden ? 'đang ẩn' : 'đang hiện'}, ${document.hasFocus() ? 'đang được chọn' : 'không được chọn'}, hiện ghi "${norm(readEditor(el)).slice(0, 50)}". Gửi dòng này cho người hỗ trợ để sửa.)`;
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
  // Settings → "Chế độ Flow" = classic sends uiMode 'classic' for users who switched Flow's agent off.
  let uiMode = 'agent';
  const isClassicUi = () => SEL.useClassicUi === true || uiMode === 'classic';
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
    const pool = (hinted.length ? hinted : editable.filter(el => !(el instanceof HTMLInputElement)))
      // A role="textbox" wrapper may hold the real editable element inside it.
      .map(el => (canType(el) ? el : el.querySelector('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], textarea') || el));
    if (!pool.length) return null;
    // The agent box sits at the bottom of the panel: take the lowest one.
    return pool.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
  }
  // Flow locks its box (contenteditable="false", aria-disabled) while an attached picture is still uploading.
  function canType(el) {
    if (!el || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true') return false;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return !el.disabled && !el.readOnly;
    return el.isContentEditable;
  }
  // Closes the add menu / asset picker; Angular overlays listen for Escape on the focused element's path.
  async function closePopups(signal, popup) {
    const open = () => Boolean(popup && popup.isConnected && visible(popup));
    // Nothing open: send no key, since Escape could also close the agent panel.
    if (!open()) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true }));
      await delay(300, signal);
      if (!open()) return;
      if (inputMode !== 'dom') { await trusted('key', { key: 'Escape', code: 'Escape', keyCode: 27 }).catch(() => {}); await delay(400, signal); }
      if (!open()) return;
    }
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
    // Say which Veo tool to use, so the agent does not stop to ask (it cannot mix a start frame with references).
    const refs = !imageCount ? '' : req.firstFrame
      ? (imageCount > 1 ? ', using the first attached image as the start frame and the others as references' : ', animating the attached image as the start frame')
      : kind === 'video' ? ', with Reference-to-Video (R2V) using all attached images as references' : ', using the attached image(s) as references';
    const parts = {
      kind, count: '1',
      aspect: req.aspect ? `, aspect ratio ${req.aspect}` : '',
      duration: kind === 'video' && req.duration ? `, ${req.duration} seconds long` : '',
      model: req.model ? `, with the ${req.model} model` : '',
      resolution: kind === 'video' && req.resolution ? `, in ${req.resolution}` : '',
      voice: kind === 'video' && req.voice ? `, using the voice "${req.voice}" for any speech` : '',
      refs,
      prompt: String(req.prompt || '').replace(/\s*\n+\s*/g, ' ').trim()
    };
    return template.replace(/\{(\w+)\}/g, (_, key) => parts[key] ?? '');
  }
  function findUploadButton() {
    const all = clickables();
    const words = el => `${textOf(el)} ${labelOf(el)}`.trim();
    const skip = el => rx(SEL.agentUploadSkip || DEFAULT_SELECTORS.agentUploadSkip).test(textOf(el));
    return all.find(el => rx(SEL.agentUploadText).test(words(el)))
      || all.find(el => !skip(el) && iconNames(el).some(icon => ['upload', 'upload_file', 'file_upload'].includes(icon)))
      || all.find(el => !skip(el) && rx(SEL.agentUploadLoose || DEFAULT_SELECTORS.agentUploadLoose).test(words(el)))
      || null;
  }
  // The asset picker that the upload button sits in (a large box around it).
  function pickerOf(el, composer) {
    for (let node = el?.parentElement; node && node !== document.body; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      // Never the whole page or the agent panel itself.
      if ((composer && node.contains(composer)) || rect.width * rect.height > innerWidth * innerHeight * 0.85) return null;
      if (rect.height >= 250 && rect.width >= 300) return node;
    }
    return null;
  }
  async function attachAgentImage(image, composer, warnings, signal, opener = null) {
    let pickerRoot = null;
    const area = () => composerArea(findComposer() || composer);
    // Pictures already in the message box (earlier attachments) and on the page before this upload.
    // A video ingredient (Motion Studio) may show as a <video> or a still in the box.
    const shownImgs = root => [...root.querySelectorAll('img, video')].filter(img => (mediaSrc(img) || img.poster) && visible(img));
    const isVideoFile = /^video\//i.test(image.type || '');
    const boxBefore = new Set(shownImgs(area())), boxSrcBefore = new Set([...boxBefore].map(mediaSrc));
    let srcBefore = new Set(), elsBefore = new Set();
    const inputsBefore = new Set(document.querySelectorAll('input[type="file"]'));
    let captured = false;
    const onCaptured = () => { captured = true; };
    document.addEventListener('cosalpha-flow-file-input', onCaptured);
    document.documentElement.setAttribute('data-cosalpha-upload', '1');
    try {
      const add = opener?.() || [...area().querySelectorAll(CLICKABLE)].filter(visible).find(el => iconNames(el).some(icon => list(SEL.addIcons).includes(icon)) || /thêm|add|đính kèm|attach/i.test(labelOf(el)));
      if (!add) throw flowError('Không thấy nút + cạnh ô nhập của Flow để thêm ảnh. Chưa gửi gì cả.');
      await press(add, signal, () => captured || findUploadButton(), 2500);
      if (!captured) {
        const upload = findUploadButton();
        if (!upload) throw flowError('Menu + của Flow không có mục "Tải nội dung". Chưa gửi gì cả.');
        pickerRoot = pickerOf(upload, composer);
        await press(upload, signal, () => captured, 2500);
      }
      const freshInput = () => { const inputs = [...document.querySelectorAll('input[type="file"]')].filter(input => !inputsBefore.has(input) && !input.disabled && (!input.accept || (isVideoFile ? /video|\*|mp4/i : /image|\*|png/i).test(input.accept) || /image|\*|png|jpe?g|webp/i.test(input.accept))); return inputs.pop() || null; };
      if (!(await waitFor(() => captured || freshInput() || domFileInput(), 4000, signal))) throw flowError('Flow không mở hộp chọn file cho ảnh. Chưa gửi gì cả.');
      // The picker also lists earlier uploads (such as the previous reference image): those are not this upload.
      // Let its list finish loading first; Flow waits for the file, so holding it a moment changes nothing.
      const pickerList = () => (pickerRoot?.isConnected ? [...pickerRoot.querySelectorAll('img')].map(mediaSrc).join('|') : '');
      for (let last = pickerList(), stable = 0, waited = 0; stable < 1200 && waited < 6000; waited += 300) {
        await delay(300, signal);
        const now = pickerList();
        stable = now === last ? stable + 300 : 0; last = now;
      }
      srcBefore = allMediaSources(); elsBefore = new Set(document.querySelectorAll('img, video'));
      if (captured) await sendFileToPage(image, signal);
      else {
        const input = freshInput() || domFileInput();
        const transfer = new DataTransfer(); transfer.items.add(await dataUrlToFile(image));
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const agree = firstVisible(SEL.agreeButtons);
      if (agree) await press(agree, signal);
      // Attached = the message box shows one more picture than before (earlier attachments stay).
      const attached = () => shownImgs(area()).some(img => !boxBefore.has(img) && !boxSrcBefore.has(mediaSrc(img)));
      // The upload lands in the asset picker; only a picture that is new both as an element and as a link is this upload.
      const isNew = img => { const src = mediaSrc(img); return src && !srcBefore.has(src) && !elsBefore.has(img) && visible(img) && !area().contains(img); };
      const named = el => { const words = `${el.getAttribute('alt') || ''} ${labelOf(el)} ${textOf(el.closest(CLICKABLE) || el)}`; return words.includes(image.name); };
      const newItem = () => {
        if (pickerRoot?.isConnected) {
          // Inside the picker any new picture is the upload, even when its tile is a plain <div>.
          const fresh = [...pickerRoot.querySelectorAll('img')].filter(isNew);
          const pick = fresh.find(named) || fresh.find(img => /^(blob|data):/.test(mediaSrc(img))) || fresh[0];
          return pick ? pick.closest(CLICKABLE) || pick : null;
        }
        return clickables().find(el => !area().contains(el) && [...el.querySelectorAll('img')].some(isNew));
      };
      const appeared = await waitFor(() => attached() || newItem(), isVideoFile ? 300000 : 90000, signal, 500);
      if (!appeared) throw flowError(`Tải ${isVideoFile ? 'video' : 'ảnh'} ${image.name} lên Flow quá ${isVideoFile ? 5 : 1.5} phút vẫn chưa xong. Chưa gửi gì cả.`);
      if (!attached()) {
        // Give Flow a moment to attach the upload by itself before picking it, so it is not picked twice.
        if (!(await waitFor(attached, 1500, signal, 300))) { const item = newItem(); if (item) await press(item, signal, attached, 3000); }
      }
      if (!(await waitFor(attached, 10000, signal, 400))) warnings.push(`Đã tải ${image.name} lên Flow nhưng chưa chắc ảnh đã được gắn vào tin nhắn.`);
      await closePopups(signal, pickerRoot);
    } finally {
      document.documentElement.removeAttribute('data-cosalpha-upload');
      document.removeEventListener('cosalpha-flow-file-input', onCaptured);
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
  // Flow may show a finished video as a still picture and only load its <video> when the mouse is over it.
  async function hoverOver(el, signal) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await delay(150, signal);
    const rect = el.getBoundingClientRect(), x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
    const options = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y };
    for (let node = el, depth = 0; node && node !== document.body && depth < 5; node = node.parentElement, depth++) {
      node.dispatchEvent(new PointerEvent('pointerover', options));
      node.dispatchEvent(new PointerEvent('pointerenter', { ...options, bubbles: false }));
      node.dispatchEvent(new MouseEvent('mouseover', options));
      node.dispatchEvent(new MouseEvent('mouseenter', { ...options, bubbles: false }));
    }
    el.dispatchEvent(new MouseEvent('mousemove', options));
    if (inputMode !== 'dom') await trusted('move', { x, y }).catch(() => {});
    await delay(1200, signal);
  }
  // A real file link next to a video that plays from a stream (blob:), such as its download link.
  function videoLinkNear(el) {
    for (let node = el, depth = 0; node && node !== document.body && depth < 6; node = node.parentElement, depth++) {
      const link = [...node.querySelectorAll('a[href], source[src]')].map(item => item.href || item.src)
        .find(href => href && !href.startsWith('blob:') && /\.mp4|video|download|googleusercontent|storage\.googleapis/i.test(href));
      if (link) return link;
    }
    return '';
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
    if (images.length) {
      if (!findComposer()) await openAgentComposer(signal);
      // Wait until Flow has finished processing the pictures and unlocks its box.
      const busy = () => { const c = findComposer(); return !c || !canType(c) || [...composerArea(c).querySelectorAll('[role="progressbar"], mat-progress-spinner, mat-spinner, [class*="spinner"]')].some(visible); };
      if (!(await waitFor(() => !busy(), 180000, signal, 500))) {
        const c = findComposer();
        throw flowError(`Flow vẫn đang xử lý ảnh vừa tải lên sau 3 phút, ô nhập chưa mở lại. Chưa gửi gì cả. ${editorReport(c)}`);
      }
      await delay(500, signal);
    }
    composer = findComposer() || composer;
    const message = fillTemplate(kind, req, images.length);
    await typePrompt(composer, message, signal);

    const panel = agentPanel(composer);
    const baselineKeys = mediaSnapshot();
    const baselineEls = new Set(document.querySelectorAll('video, img'));
    const hovered = new WeakSet();
    // What appeared on the page since sending; added to timeout and refusal errors so they can be fixed.
    const diagnosis = () => {
      const videos = [...document.querySelectorAll('video')].filter(el => !baselineEls.has(el));
      const pictures = bigMedia('image').filter(item => !baselineEls.has(item.el));
      return ` [Chẩn đoán: ${videos.length} video mới (${videos.filter(el => mediaSrc(el)).length} có link${videos.some(el => mediaSrc(el).startsWith('blob:')) ? ', dạng blob' : ''}), ${pictures.length} ảnh mới, đã bấm xác nhận ${confirmations} lần]`;
    };
    // Something is being made outside the chat: a progress indicator or any new picture/video on the page.
    const workingElsewhere = currentPanel => [...document.querySelectorAll('[role="progressbar"], mat-progress-spinner, mat-spinner, [class*="spinner"], [class*="progress"]')].some(el => visible(el) && !currentPanel.contains(el))
      || [...document.querySelectorAll('video, img')].some(el => !baselineEls.has(el) && visible(el) && !currentPanel.contains(el));
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
    let confirmations = 0, refusalText = '', refusalSince = 0, panelMediaSince = 0, questionText = '', questionSince = 0;
    while (Date.now() < deadline) {
      if (signal.aborted) throw abortError();
      // Prefer the new result in the main grid; something new only inside the chat (for example the
      // attached image echoed back) is taken only if nothing shows up in the grid for 20 s.
      const currentPanelForMedia = agentPanel(findComposer() || composer);
      const newMedia = bigMedia(kind).filter(item => !isOldMedia(item.el, item.src, baselineKeys));
      let fresh = newMedia.find(item => !currentPanelForMedia.contains(item.el));
      if (!fresh && newMedia.length) {
        panelMediaSince = panelMediaSince || Date.now();
        if (Date.now() - panelMediaSince > 20000) fresh = newMedia[0];
      }
      if (!fresh && kind === 'video') {
        const stills = [...document.querySelectorAll('video, img')].filter(el => !baselineEls.has(el) && !hovered.has(el) && visible(el)
          && !currentPanelForMedia.contains(el) && el.getBoundingClientRect().width >= 96 && (el.tagName === 'IMG' || !mediaSrc(el)));
        for (const el of stills.slice(0, 3)) { hovered.add(el); await hoverOver(el, signal); }
        if (stills.length) continue;
      }
      if (fresh) {
        await delay(kind === 'video' ? 1500 : 800, signal);
        let url = mediaSrc(fresh.el) || fresh.src;
        let copied = await copyLocally(url, kind);
        if (copied.error && url.startsWith('blob:')) {
          const link = videoLinkNear(fresh.el);
          if (link) { url = link; copied = await copyLocally(link, kind); }
        }
        if (copied.url.startsWith('blob:')) throw flowError(`Flow đã tạo xong ${kindVi(kind)} nhưng phát nó theo dạng luồng nên cos_alpha_flow chưa chép ra được. ${kindVi(kind)} vẫn nằm trong dự án Flow của bạn.${diagnosis()}`);
        if (copied.error) warnings.push(copied.error);
        const size = kind === 'video' ? await videoInfo(copied.url) : await mediaSize(copied.url, kind);
        return { ok: true, url: copied.url, remoteUrl: url, width: size.width, height: size.height, endFrame: size.endFrame || '', warnings, trustedInput: usedTrustedInput };
      }
      const currentPanel = agentPanel(findComposer() || composer);
      // "Xác nhận trước khi tạo: Luôn luôn" makes the agent ask first; accept its new Generate/Confirm button once.
      if (confirmations < 2) {
        const confirm = panelButtons(currentPanel).find(el => !baselineButtons.has(el) && !clicked.has(el) && rx(SEL.agentConfirmText).test(textOf(el) || labelOf(el)) && !rx(SEL.agentCancelText).test(textOf(el) || labelOf(el)) && !isDisabled(el));
        if (confirm) { clicked.add(confirm); confirmations++; await press(confirm, signal); await delay(1000, signal); continue; }
      }
      const reply = newPanelText().trim();
      const alert = alertTexts().find(text => !baselineAlerts.has(text)) || '';
      if (BLOCKED_RX.test(reply) || BLOCKED_RX.test(alert)) throw flowError('Google Flow đã chặn lượt này vì phát hiện "hoạt động bất thường" (tiện ích điều khiển trang). cos_alpha_flow đã dừng cả lượt chạy và không thử lại. Đừng bấm chạy liên tục; nếu Flow vẫn báo như vậy, hãy tạm nghỉ hoặc chuyển sang Gemini API trong Cài đặt.', 'FLOW_BLOCKED');
      if (CREDIT_RX.test(reply) || CREDIT_RX.test(alert)) throw flowError(`Flow: ${(alert || reply).slice(-300)}`, 'NO_CREDITS');
      if (POLICY_RX.test(alert)) throw flowError(`Flow từ chối câu lệnh này: ${alert}`, 'SCENE_REFUSED');
      // The agent answered in words that it cannot make this; wait until its reply stops changing.
      if (POLICY_RX.test(reply)) {
        if (reply !== refusalText) { refusalText = reply; refusalSince = Date.now(); }
        else if (Date.now() - refusalSince > (kind === 'video' ? 45000 : 10000)) throw flowError(`Trợ lý Flow không tạo ${kindVi(kind)} này: "${reply.slice(-300)}"${diagnosis()}`, 'SCENE_REFUSED');
      }
      // The agent asked something back (no approve button to press) and is waiting: say so instead of waiting out the timeout.
      else if (!confirmations && reply.slice(-400).includes('?') && !workingElsewhere(currentPanel)) {
        if (reply !== questionText) { questionText = reply; questionSince = Date.now(); }
        else if (Date.now() - questionSince > 60000) throw flowError(`Trợ lý Flow hỏi lại thay vì tạo ${kindVi(kind)}: "${reply.slice(-300)}". cos_alpha_flow không tự trả lời. Bạn có thể trả lời ngay trong tab Flow (kết quả sẽ nằm trong dự án Flow), hoặc sửa node rồi chạy lại.`, 'AGENT_QUESTION');
      }
      await delay(1000, signal);
    }
    const last = newPanelText().trim().slice(-300);
    throw flowError(`Đã chờ ${Math.round(timeoutMs / 1000)} giây mà Flow chưa trả ${kindVi(kind)} mới. Tin nhắn chỉ gửi một lần. Lời cuối của trợ lý Flow: "${last}"${diagnosis()}`, POLICY_RX.test(last) ? 'SCENE_REFUSED' : 'TIMEOUT');
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
  // Flow signs its media links (Expires/Signature) and swaps them when a tile is shown again or hovered, so
  // "is this media new?" compares the link without its query, and also asks whether the media sits in a tile
  // that was already on the page before the send (the previous result's tile loads its <video> on hover).
  function mediaKey(src) { return String(src || '').split(/[?#]/)[0]; }
  function mediaSnapshot() {
    const keys = new Set();
    for (const el of document.querySelectorAll('video, img')) { const src = mediaSrc(el); if (src) keys.add(mediaKey(src)); }
    keys.tiles = new Set(query(SEL.tiles));
    return keys;
  }
  function isOldMedia(el, src, keys) {
    if (keys.has(mediaKey(src))) return true;
    const tile = el?.closest?.(list(SEL.tiles).join(','));
    return Boolean(tile && keys.tiles?.has(tile));
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
    // A signed-in Flow page also has accounts.google.com links (the avatar menu) and the words
    // "sign in" in help text, so only a visible Sign in button counts as logged out.
    const signInButton = [...document.querySelectorAll('a, button, [role="button"]')].some(el => visible(el) && /^\s*(sign in|đăng nhập)\s*$/i.test(el.innerText || el.textContent || ''));
    const loginRequired = !editor && (/accounts\.google\.com$/i.test(location.host) || signInButton);
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
  // Voice picker (Veo 3.1 / Omni): opens Flow's voice list, searches the name and picks it.
  async function pickVoice(name, panel, warnings, signal) {
    const wanted = norm(name), voiceRx = rx(SEL.voiceLabel);
    const opener = withIcon(SEL.voiceIcons, panel)[0] || withText(text => voiceRx.test(text), panel)[0];
    if (!opener) { warnings.push(`Could not find Flow's voice picker; kept Flow's current voice (wanted "${name}").`); return; }
    if (norm(opener.innerText).includes(wanted)) return;
    await press(opener, signal, () => query([...SEL.menuItems, ...SEL.searchInputs]).some(visible));
    const search = query(SEL.searchInputs).filter(visible)[0];
    if (search) { search.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, name); search.dispatchEvent(new Event('input', { bubbles: true })); await delay(400, signal); }
    const find = () => [...query(SEL.menuItems), ...clickables()].filter(el => visible(el) && !el.contains(search || null) && el !== opener).find(el => norm(el.innerText).split(/\s+/).includes(wanted) || norm(el.innerText) === wanted);
    const item = await waitFor(find, 2000, signal);
    if (item) { await press(item, signal); await delay(300, signal); }
    else warnings.push(`Voice "${name}" was not in Flow's voice list; kept Flow's current voice.`);
    if (query([...SEL.menuItems, ...SEL.searchInputs]).some(visible)) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  async function configure(req, warnings, signal) {
    const panelOpen = () => scopes(SEL.settingsPanel).length > 0;
    let openedHere = false;
    if (!panelOpen()) {
      const submit = findSubmit(), beside = submit?.previousElementSibling;
      const button = settingsButton() || (beside?.matches?.('button') && visible(beside) ? beside : null);
      if (!button) { warnings.push('Could not find the Flow settings button; used the settings already chosen in Flow.'); return; }
      if (!(await press(button, signal, panelOpen))) { warnings.push('Flow settings did not open; used the settings already chosen in Flow.'); return; }
      openedHere = true;
    }
    const panel = SEL.settingsPanel;
    await pick(withIcon(req.kind === 'video' ? SEL.videoModeIcons : SEL.imageModeIcons, panel), req.kind === 'video' ? 'Video' : 'Image', warnings, signal);
    if (req.kind === 'video') {
      const type = req.inputType || (req.firstFrame ? 'frames' : req.references?.length ? 'ingredients' : '');
      if (type) {
        const frames = type === 'frames', label = frames ? 'Frames' : 'Ingredients';
        const byText = withText(text => new RegExp(`^${label}( to video)?$`, 'i').test(text) || (frames ? /^(khung hình|khung)$/i : /^(thành phần|nguyên liệu)$/i).test(text), panel);
        await pick([...withIcon(frames ? SEL.framesModeIcons : SEL.ingredientsModeIcons, panel), ...byText], `${label} to Video`, warnings, signal);
      }
    }
    // The model first: Veo and Omni offer different lengths and resolutions.
    if (req.model) {
      const opener = withIcon(SEL.modelMenuIcons, panel)[0] || withText(text => rx(SEL.modelNameHint).test(text), panel)[0];
      if (!opener) warnings.push('Could not find the Flow model menu; kept Flow\'s current model.');
      else if (norm(opener.innerText).replace(/arrow_drop_down/g, '').trim() === norm(req.model)) { /* already chosen */ }
      else {
        const wanted = norm(req.model);
        const findItem = () => query(SEL.menuItems).filter(visible).find(el => norm(el.innerText).includes(wanted));
        await press(opener, signal, () => query(SEL.menuItems).some(visible));
        const item = await waitFor(findItem, 1500, signal);
        if (item) { await press(item, signal); await delay(300, signal); }
        else { warnings.push(`Model "${req.model}" was not in Flow's model menu; kept Flow's current model.`); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
      }
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
      await pick(withText(text => new RegExp(`^${seconds}[\\p{L}.]*$`, 'iu').test(text.replace(/\s+/g, '')), panel), `${seconds}s`, [], signal);
    }
    if (req.kind === 'video' && req.resolution) {
      const hints = (SEL.resolutionHints || {})[req.resolution] || [req.resolution];
      await pick(withText(text => hints.some(hint => text.toLowerCase() === hint.toLowerCase()), panel), req.resolution, [], signal);
    }
    if (req.kind === 'video' && req.voice) await pickVoice(req.voice, panel, warnings, signal);
    if (openedHere && panelOpen()) {
      const button = settingsButton();
      if (button) await press(button, signal, () => !panelOpen());
      if (panelOpen()) await closePopups(signal, scopes(SEL.settingsPanel)[0]);
    }
  }
  function settingsButton() {
    return firstVisible(SEL.settingsButtons || []) || withIcon(SEL.settingsIcons, SEL.submitScopes)[0]
      || withIcon(['crop_'], SEL.promptScopes, { partial: true })[0] || null;
  }

  // Classic mode: close Flow's agent chat and switch the agent toggle off, then wait for the prompt box.
  async function switchAgentOff(signal) {
    const closeIcons = list(SEL.agentPanelCloseIcons), siblingIcons = list(SEL.agentPanelSiblingIcons);
    const close = withIcon(closeIcons).find(button => { const row = button.parentElement; return row && [...row.querySelectorAll(CLICKABLE)].some(other => other !== button && iconNames(other).some(icon => siblingIcons.includes(icon))); });
    if (close) { await press(close, signal); await delay(500, signal); }
    const toggleRx = rx(SEL.agentToggleLabel);
    const toggle = clickables().find(el => el.getAttribute('aria-pressed') === 'true' && toggleRx.test(`${labelOf(el)} ${el.innerText || ''}`));
    if (toggle) { await press(toggle, signal, () => toggle.getAttribute('aria-pressed') !== 'true'); await delay(500, signal); }
    if (close || toggle) await waitFor(() => findEditor(), 5000, signal);
    return Boolean(close || toggle);
  }

  // ---------- image upload ----------
  function domFileInput() {
    return [...document.querySelectorAll('input[type="file"]')].filter(input => !input.disabled && (!input.accept || /image|\*|png|jpe?g|webp/i.test(input.accept))).pop() || null;
  }
  async function sendFileToPage(image, signal) {
    const resultPromise = new Promise(resolve => {
      const done = event => { document.removeEventListener('cosalpha-flow-upload-result', done); let data = {}; try { data = JSON.parse(String(event.detail || '{}')); } catch {} resolve(data); };
      document.addEventListener('cosalpha-flow-upload-result', done);
      setTimeout(() => { document.removeEventListener('cosalpha-flow-upload-result', done); resolve({ ok: false, error: 'Phần gắn vào trang Flow không phản hồi.' }); }, 5000);
    });
    document.dispatchEvent(new CustomEvent('cosalpha-flow-upload', { detail: JSON.stringify({ files: [image] }) }));
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
    document.addEventListener('cosalpha-flow-file-input', onCaptured);
    document.documentElement.setAttribute('data-cosalpha-upload', '1');
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
      document.documentElement.removeAttribute('data-cosalpha-upload');
      document.removeEventListener('cosalpha-flow-file-input', onCaptured);
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
      if (blob.size > MAX_TRANSFER_BYTES) return { url, error: `${kindVi(kind)} lớn hơn 40 MB nên cos_alpha_flow sẽ tải từ đường link.` };
      return { url: await blobToDataUrl(blob) };
    } catch (error) {
      // Flow serves results from another Google host, which this page may not read (CORS); let the extension download it.
      if (/^https:/i.test(url)) {
        try {
          const reply = await chrome.runtime.sendMessage({ type: 'THEKEY_FETCH_MEDIA', url, maxBytes: MAX_TRANSFER_BYTES });
          if (reply?.ok && reply.url) return { url: reply.url };
          if (reply?.ok && reply.tooLarge) return { url, error: `${kindVi(kind)} lớn hơn 40 MB nên cos_alpha_flow sẽ tải từ đường link.` };
          if (reply?.error) error = new Error(reply.error);
        } catch {}
      }
      let host = '';
      try { host = new URL(url).host; } catch {}
      return { url, error: `Đã thấy ${kindVi(kind)} mới nhưng không chép được từ tab Flow (${error.message}${host ? `, ${host}` : ''}); đang thử tải từ đường link.` };
    }
  }
  // Size and last frame of a finished video, read here because this tab is in front: the app tab is
  // usually hidden during a run and Chrome may not decode video there, which broke "Nối khung cuối".
  function videoInfo(url) {
    return new Promise(resolve => {
      const video = document.createElement('video');
      let finished = false, size = { width: 0, height: 0 };
      const done = endFrame => { if (finished) return; finished = true; clearTimeout(timer); video.removeAttribute('src'); video.load(); resolve({ ...size, endFrame }); };
      const timer = setTimeout(() => done(''), 15000);
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      if (/^https?:/i.test(url)) video.crossOrigin = 'anonymous';
      video.onloadedmetadata = () => {
        size = { width: video.videoWidth || 0, height: video.videoHeight || 0 };
        if (!Number.isFinite(video.duration) || !size.width) { done(''); return; }
        video.currentTime = Math.max(0, video.duration - Math.min(0.04, video.duration / 100));
      };
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size.width; canvas.height = size.height;
          canvas.getContext('2d').drawImage(video, 0, 0, size.width, size.height);
          done(canvas.toDataURL('image/png'));
        } catch { done(''); }
      };
      video.onerror = () => done('');
      video.src = url;
    });
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

  // Flow's own setting (gear menu at the top): "Trả về video không có âm thanh" / return the video without sound
  // when its audio cannot be made. Motion Studio turns it on (when the user allows it) and adds the source sound back.
  async function setSilentFallback(on) {
    const gear = clickables().find(el => /^(cài đặt|settings)$/i.test(labelOf(el)) || iconNames(el).some(icon => /^settings(_2)?$/.test(icon)) && el.getBoundingClientRect().top < 120);
    if (!gear) return { ok: false, error: 'Không thấy nút Cài đặt (bánh răng) của Flow.' };
    await press(gear, null);
    // The smallest box holding both the label and its switch is the row.
    const LABEL = /trả về video không có âm thanh|return videos? without (audio|sound)/i;
    const row = await waitFor(() => [...document.querySelectorAll('div, li, label, mat-list-item, [role="menuitem"], [role="menuitemcheckbox"]')]
      .filter(el => visible(el) && LABEL.test(el.textContent || '') && el.querySelector('[role="switch"], input[type="checkbox"], button'))
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0], 3000);
    if (!row) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return { ok: false, error: 'Không thấy mục "Trả về video không có âm thanh" trong Cài đặt của Flow.' }; }
    const toggle = row.querySelector('[role="switch"], input[type="checkbox"], button');
    const isOn = () => toggle.getAttribute('aria-checked') === 'true' || toggle.checked === true || /checked|selected/.test(toggle.className || '');
    const before = isOn();
    if (before !== on) { await press(toggle, null, () => isOn() === on, 1500); }
    const after = isOn();
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await delay(300);
    return { ok: after === on, changed: before !== after, on: after };
  }

  // ---------- Flow with "Tác nhân" off (2026-11) ----------
  // The prompt box sends straight to the model chosen in its settings chip. Without switching that chip
  // to Video first, a video prompt was made into a picture and the run waited forever for a video.
  function directModelMode() {
    const chip = firstVisible(SEL.agentModeChip || []);
    return Boolean(chip && chip.getAttribute('aria-pressed') === 'false');
  }
  const settingsSummary = () => norm(settingsButton()?.innerText || '');
  async function generateDirect(req, kind, signal) {
    const warnings = [];
    let composer = findComposer();
    if (!composer) throw flowError(`Không thấy ô nhập "Bạn muốn tạo những gì?" của Flow. Hãy mở một dự án trong Flow rồi thử lại. (Trang: ${location.pathname})`, 'FLOW_NOT_READY');
    // Motion Studio sends a source clip: it only goes in as an ingredient, next to the character pictures.
    const inputType = kind === 'video' ? (req.sourceVideo ? 'ingredients' : req.firstFrame ? 'frames' : 'ingredients') : '';
    await configure({ ...req, kind, inputType }, warnings, signal);
    // Never send a video prompt while Flow is still set to pictures (or the other way round): it spends credits on the wrong thing.
    const isVideoSet = () => /\bvideo\b/i.test(settingsSummary());
    if (kind === 'video' ? !(await waitFor(isVideoSet, 3000, signal)) : isVideoSet()) {
      throw flowError(`Không chuyển được Flow sang chế độ ${kind === 'video' ? 'Video' : 'Hình ảnh'} (nút cài đặt đang ghi "${settingsSummary() || 'không thấy'}"). Chưa gửi gì cả.`, 'FLOW_NOT_READY');
    }
    composer = findComposer() || composer;
    // The prompt box itself (with its slots and chips); never a page-sized ancestor, or new results would look like part of it.
    const area = () => { const c = findComposer() || composer; return c.closest('flow-prompt-box') || c.closest('flow-base-prompt-box') || composerArea(c); };
    // "Khung hình": the start frame goes into the "Bắt đầu" slot; otherwise pictures go in with the + button.
    const startSlot = () => [...area().querySelectorAll(CLICKABLE)].filter(visible).find(el => /^(bắt đầu|start|first frame|khung đầu)$/i.test(textOf(el)));
    const images = [];
    if (req.firstFrame && !req.sourceVideo) images.push({ image: req.firstFrame, role: 'firstFrame' });
    if (!(kind === 'video' && req.firstFrame && !req.sourceVideo)) for (const reference of req.references || []) images.push({ image: reference, role: 'reference' });
    // The Motion Studio clip goes in after the pictures (as TobyFlow sends it), so the character is "image 1".
    if (kind === 'video' && req.sourceVideo) images.push({ image: req.sourceVideo, role: 'source' });
    else if (req.references?.length) warnings.push('Video bắt đầu từ khung đầu nên ảnh tham chiếu không được gửi kèm.');
    for (const [index, item] of images.entries()) {
      const match = /^data:([^;,]+)/.exec(item.image) || [];
      const type = match[1] || 'image/png';
      const opener = kind === 'video' && item.role === 'firstFrame' ? startSlot : null;
      const extension = (type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('quicktime', 'mov');
      if (opener && !opener()) throw flowError('Flow đang ở chế độ Khung hình nhưng không thấy ô "Bắt đầu" để gắn khung đầu. Chưa gửi gì cả.');
      await attachAgentImage({ dataUrl: item.image, type, name: `thekey-${item.role}-${index + 1}.${extension}` }, findComposer() || composer, warnings, signal, opener);
    }
    if (images.length) {
      const busy = () => { const c = findComposer(); return !c || !canType(c) || [...composerArea(c).querySelectorAll('[role="progressbar"], mat-progress-spinner, mat-spinner, [class*="spinner"]')].some(visible); };
      if (!(await waitFor(() => !busy(), 180000, signal, 500))) throw flowError('Flow vẫn đang xử lý ảnh vừa tải lên sau 3 phút. Chưa gửi gì cả.');
      await delay(500, signal);
    }
    composer = findComposer() || composer;
    // The model gets the scene prompt itself; the agent's "Generate exactly 1 …" wording is only for the agent.
    await typePrompt(composer, String(req.prompt || '').trim(), signal);

    const uploadName = /thekey-(firstFrame|reference|source)-\d/i;
    const tileOf = el => el.closest?.(list(SEL.tiles).join(',')) || null;
    const isUpload = el => uploadName.test(`${el.getAttribute?.('alt') || ''} ${tileOf(el)?.innerText || ''}`);
    const baselineKeys = mediaSnapshot();
    const baselineEls = new Set(document.querySelectorAll('video, img'));
    const baselineTiles = new Set(query(SEL.tiles));
    const baselineAlerts = new Set(alertTexts());
    const hovered = new WeakSet();

    let submit = findAgentSubmit(composer);
    if (submit && isDisabled(submit)) submit = await waitFor(() => { const b = findAgentSubmit(findComposer() || composer); return b && !isDisabled(b) ? b : null; }, 8000, signal);
    if (!submit) throw flowError('Nút "Bắt đầu tạo" của Flow vẫn bị khoá (ảnh còn đang tải lên hoặc đã hết credit). Chưa gửi gì cả.');
    const sent = () => !norm(readEditor(findComposer() || composer)) || query(SEL.tiles).some(tile => !baselineTiles.has(tile)) || query(SEL.pending).length > 0;
    // One submission only: the trusted retry inside press() fires only if nothing changed after the first click.
    if (!(await press(submit, signal, sent, 4000))) throw flowError('Flow không xác nhận đã nhận lệnh. Hãy xem tab Flow; cos_alpha_flow không gửi lại.');

    const timeoutMs = Math.min(1800, Math.max(60, Number(req.timeoutSec) || 900)) * 1000;
    const deadline = Date.now() + timeoutMs;
    const failingSince = new Map();
    while (Date.now() < deadline) {
      if (signal.aborted) throw abortError();
      const alert = alertTexts().find(text => !baselineAlerts.has(text)) || '';
      const newTiles = query(SEL.tiles).filter(tile => !baselineTiles.has(tile) && visible(tile));
      const tileText = newTiles.map(tile => (tile.innerText || '').replace(/\s+/g, ' ').trim()).join(' · ');
      if (BLOCKED_RX.test(alert) || BLOCKED_RX.test(tileText)) throw flowError('Google Flow đã chặn lượt này vì phát hiện "hoạt động bất thường" (tiện ích điều khiển trang). cos_alpha_flow đã dừng cả lượt chạy và không thử lại. Đừng bấm chạy liên tục; nếu Flow vẫn báo như vậy, hãy tạm nghỉ hoặc chuyển sang Gemini API trong Cài đặt.', 'FLOW_BLOCKED');
      if (CREDIT_RX.test(alert)) throw flowError(`Flow: ${alert}`, 'NO_CREDITS');
      if (POLICY_RX.test(alert)) throw flowError(`Flow từ chối câu lệnh này: ${alert}`, 'SCENE_REFUSED');
      const currentArea = area();
      const fresh = bigMedia(kind).find(item => !isOldMedia(item.el, item.src, baselineKeys) && !currentArea.contains(item.el) && !isUpload(item.el));
      if (!fresh && kind === 'video') {
        // A finished video may show only its still until the mouse is over it.
        const stills = newTiles.flatMap(tile => [...tile.querySelectorAll('img, video')]).filter(el => !baselineEls.has(el) && !hovered.has(el) && visible(el) && (el.tagName === 'IMG' || !mediaSrc(el)));
        for (const el of stills.slice(0, 3)) { hovered.add(el); await hoverOver(el, signal); }
      }
      if (fresh) {
        await delay(kind === 'video' ? 1500 : 800, signal);
        let url = mediaSrc(fresh.el) || fresh.src;
        let copied = await copyLocally(url, kind);
        if (copied.error && url.startsWith('blob:')) { const link = videoLinkNear(fresh.el); if (link) { url = link; copied = await copyLocally(link, kind); } }
        if (copied.url.startsWith('blob:')) throw flowError(`Flow đã tạo xong ${kindVi(kind)} nhưng phát nó theo dạng luồng nên cos_alpha_flow chưa chép ra được. ${kindVi(kind)} vẫn nằm trong dự án Flow của bạn.`);
        if (copied.error) warnings.push(copied.error);
        const size = kind === 'video' ? await videoInfo(copied.url) : await mediaSize(copied.url, kind);
        return { ok: true, url: copied.url, remoteUrl: url, width: size.width, height: size.height, endFrame: size.endFrame || '', warnings, trustedInput: usedTrustedInput };
      }
      // A new tile that says it failed (policy, credits, error) and stays that way for 3 s.
      for (const tile of newTiles) {
        const text = (tile.innerText || '').replace(/\s+/g, ' ').trim();
        if (!text || /(^|\s)\d{1,3}%(\s|$)/.test(text) || !(POLICY_RX.test(text) || CREDIT_RX.test(text) || FAIL_RX.test(text))) { failingSince.delete(tile); continue; }
        const since = failingSince.get(tile) || Date.now(); failingSince.set(tile, since);
        if (Date.now() - since > 3000) {
          if (CREDIT_RX.test(text)) throw flowError(`Flow: ${text.slice(0, 300)}`, 'NO_CREDITS');
          throw flowError(`Flow không tạo được ${kindVi(kind)} này: ${text.slice(0, 300)}`, AUDIO_FAIL_RX.test(text) ? 'AUDIO_FAILED' : POLICY_RX.test(text) ? 'SCENE_REFUSED' : 'FLOW_ERROR');
        }
      }
      await delay(1000, signal);
    }
    throw flowError(`Đã chờ ${Math.round(timeoutMs / 1000)} giây mà Flow chưa trả ${kindVi(kind)} mới. Câu lệnh chỉ gửi một lần, không gửi lại.`, 'TIMEOUT');
  }

  async function generate(req, signal) {
    inputMode = ['auto', 'dom', 'cdp'].includes(req.inputMode) ? req.inputMode : 'auto';
    uiMode = req.uiMode === 'classic' ? 'classic' : 'agent';
    const kind = req.kind === 'image' ? 'image' : 'video';
    const warnings = [];
    if (!String(req.prompt || '').trim()) throw flowError('Câu lệnh đang trống.');
    // Chrome pauses drawing in background tabs, so Flow may not show its prompt box until the tab is in front.
    if (inputMode !== 'dom') await bringToFront(signal);
    // Wait for either the classic prompt box or the agent page to be drawn.
    let editor = await waitFor(() => findEditor() || (location.pathname.includes('/project/') && document.readyState === 'complete' && document.body.innerText.length > 50 ? 'page' : null), 15000, signal);
    if (editor === 'page') editor = findEditor();
    if (!isClassicUi() && directModelMode()) return generateDirect(req, kind, signal);
    if (req.sourceVideo) throw flowError('Motion Studio cần Flow ở chế độ gửi thẳng: trong ô nhập của Flow, tắt nút "Tác nhân" rồi chạy lại. Chưa gửi gì cả.', 'FLOW_NOT_READY');
    if (!isClassicUi()) return generateAgent(req, kind, signal);
    // The agent chat has its own text box; switch the agent off first so the prompt goes to Flow's own box.
    if (await switchAgentOff(signal)) editor = findEditor();
    if (!editor) {
      const any = query(SEL.editor).length, editable = document.querySelectorAll('[contenteditable="true"], textarea').length;
      throw flowError(`Không thấy ô nhập câu lệnh của Flow. Hãy mở một dự án trong Google Flow${uiMode === 'classic' ? ' và tắt Agent (hoặc đổi Cài đặt → Chế độ Flow về Agent)' : ''} rồi thử lại. (Trang: ${location.pathname}, ô lệnh khớp ${any}, ô nhập được ${editable}, tab ${document.hidden ? 'đang ẩn' : 'đang hiện'}.)`, 'FLOW_NOT_READY');
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

    const baselineKeys = mediaSnapshot();
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
    if (!confirmed) throw flowError('Flow không xác nhận đã nhận lệnh. Hãy xem tab Flow; cos_alpha_flow không gửi lại.');

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
      const fresh = current.find(tile => kind === 'video' ? tile.video && !baselineKeys.has(mediaKey(tile.video)) && !baselineKeys.has(mediaKey(tile.image)) : tile.image && !tile.video && !tile.pending && !tile.percent && !baselineKeys.has(mediaKey(tile.image)));
      if (fresh) {
        const url = kind === 'video' ? fresh.video : fresh.image;
        const copied = await copyLocally(url, kind);
        if (copied.error) warnings.push(copied.error);
        const size = kind === 'video' ? await videoInfo(copied.url) : await mediaSize(copied.url, kind);
        return { ok: true, url: copied.url, remoteUrl: url, width: size.width, height: size.height, endFrame: size.endFrame || '', warnings, trustedInput: usedTrustedInput };
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
