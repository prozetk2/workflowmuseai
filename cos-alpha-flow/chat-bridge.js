// cos_alpha_flow chat bridge: runs in the user's own signed-in ChatGPT / Gemini / Grok tab (isolated world).
// COSALPHA_CHAT_ASK: picks the strongest model the account offers (best effort), types the prompt into a
// new chat, sends it once and returns the reply text.
// COSALPHA_CHAT_GENERATE: attaches reference images, asks for one image or video, sends once, waits for
// the new picture/clip in the reply and returns it as a data: URL.
(() => {
  if (window.__cosAlphaChatBridge) return;
  window.__cosAlphaChatBridge = true;

  const SITE = /chatgpt\.com|chat\.openai\.com/.test(location.host) ? 'chatgpt' : /grok\.com/.test(location.host) ? 'grok' : 'gemini';
  const SITE_NAME = { chatgpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok' }[SITE];
  const S = {
    chatgpt: {
      composer: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]'],
      send: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label*="Send" i]', 'button[aria-label*="Gửi" i]'],
      stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]', 'button[aria-label*="Dừng" i]'],
      reply: ['[data-message-author-role="assistant"]', 'article[data-turn="assistant"]'],
      modelButton: ['button[data-testid="model-switcher-dropdown-button"]', 'button[aria-label*="Model selector" i]', 'button[aria-label*="Bộ chọn mô hình" i]'],
      // Strongest first. "Pro" only works on plans that include it; locked entries are skipped.
      bestModels: [/\bpro\b/i, /thinking|suy nghĩ|tư duy/i, /\bo3\b|gpt-5/i],
      turn: 'article, [data-testid^="conversation-turn"]',
      done: ['button[data-testid="copy-turn-action-button"]', 'button[aria-label*="Copy" i]', 'button[aria-label*="Sao chép" i]'],
      // Delete this conversation: header options (…) → Delete → confirm.
      options: ['button[data-testid="conversation-options-button"]', 'header button[aria-label*="option" i]', 'header button[aria-label*="tùy chọn" i]', 'header button[aria-haspopup="menu"]'],
      deleteItem: ['[data-testid="delete-chat-menu-item"]'],
      confirm: ['button[data-testid="delete-conversation-confirm-button"]']
    },
    gemini: {
      composer: ['rich-textarea .ql-editor[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]', '[contenteditable="true"][role="textbox"]'],
      send: ['button.send-button', 'button[aria-label*="Send" i]', 'button[aria-label*="Gửi" i]'],
      stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="Dừng" i]', 'button.stop'],
      reply: ['model-response', '.model-response-text', 'message-content'],
      modelButton: ['[data-test-id="bard-mode-menu-button"]', 'button[aria-label*="mode picker" i]', 'button[aria-label*="bộ chọn chế độ" i]', 'button[aria-label*="model" i]'],
      bestModels: [/\bpro\b/i, /thinking|suy nghĩ|tư duy/i],
      turn: 'model-response, .conversation-container',
      done: ['message-actions', 'copy-button', '[data-test-id="copy-button"]', 'button[aria-label*="Copy" i]', 'button[aria-label*="Sao chép" i]'],
      options: ['[data-test-id="conversation-actions-button"]', 'conversations-list [aria-current="true"] button[aria-haspopup="menu"]', '.selected [data-test-id="actions-menu-button"]', 'button[aria-label*="Mở menu cho cuộc trò chuyện" i]', 'button[aria-label*="conversation actions" i]'],
      deleteItem: ['[data-test-id="delete-button"]'],
      confirm: ['[data-test-id="confirm-button"]']
    },
    grok: {
      composer: ['textarea[aria-label*="Grok" i]', 'div.ProseMirror[contenteditable="true"]', 'div.tiptap[contenteditable="true"]', 'form textarea'],
      send: ['button[type="submit"][aria-label*="Submit" i]', 'button[aria-label*="Submit" i]', 'button[type="submit"]', 'button[aria-label*="Send" i]', 'button[aria-label*="Gửi" i]'],
      stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="Dừng" i]'],
      reply: ['[id^="response-"]', 'div.message-bubble', '[class*="message-bubble"]'],
      modelButton: ['#model-select-trigger', 'button[aria-label*="Model" i]', 'button[aria-label*="mô hình" i]'],
      bestModels: [/heavy/i, /expert|thinking|suy nghĩ/i, /grok\s?4/i],
      turn: '[id^="response-"], .message-row, [class*="message-row"]',
      done: ['button[aria-label*="Copy" i]', 'button[aria-label*="Sao chép" i]'],
      options: ['header button[aria-haspopup="menu"]', 'header button[aria-label*="option" i]', 'header button[aria-label*="more" i]'],
      deleteItem: [],
      confirm: []
    }
  }[SITE];
  const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="option"], button[mat-menu-item]';
  const LOCKED = /upgrade|nâng cấp|try (pro|plus)|get (pro|plus)|subscribe|đăng ký gói/i;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const first = list => { for (const sel of list) { for (const el of document.querySelectorAll(sel)) if (visible(el)) return el; } return null; };
  const all = list => { const out = []; for (const sel of list) for (const el of document.querySelectorAll(sel)) if (!out.includes(el)) out.push(el); return out; };
  async function waitFor(test, ms, step = 250) { const end = Date.now() + ms; for (;;) { const v = test(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } }
  const fail = (message, code = 'CHAT_ERROR') => Object.assign(new Error(message), { code });
  const textOf = el => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const isDisabled = el => el.disabled || el.getAttribute('aria-disabled') === 'true';
  function click(el) {
    el.scrollIntoView({ block: 'center' });
    const o = { bubbles: true, cancelable: true, composed: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('mouseup', o)); el.click();
  }
  const escape = () => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));

  function findComposer() {
    const known = first(S.composer);
    if (known) return known;
    // Fallback: the lowest editable box on the page.
    const boxes = [...document.querySelectorAll('[contenteditable="true"], textarea')].filter(visible);
    return boxes.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
  }
  function loginNeeded() {
    if (findComposer()) return false;
    return [...document.querySelectorAll('a, button')].some(el => visible(el) && /^(sign in|log in|đăng nhập)$/i.test(textOf(el)));
  }

  // Opens the model menu and picks the strongest unlocked entry. Never fails the request.
  async function pickBestModel() {
    const button = first(S.modelButton);
    if (!button) return { model: '', note: 'Không thấy nút chọn model, dùng model đang chọn.' };
    const current = textOf(button);
    click(button);
    const items = await waitFor(() => { const list = all([MENU_ITEMS]).filter(visible); return list.length ? list : null; }, 3000);
    if (!items) { escape(); return { model: current, note: 'Menu model không mở, dùng model đang chọn.' }; }
    for (const pattern of S.bestModels) {
      const item = items.find(el => pattern.test(textOf(el)) && !LOCKED.test(textOf(el)) && !isDisabled(el));
      if (!item) continue;
      const label = textOf(item).slice(0, 60);
      if (item.getAttribute('aria-checked') === 'true' || item.getAttribute('aria-selected') === 'true') { escape(); return { model: label }; }
      click(item);
      await sleep(800);
      // A plan/upsell dialog means this model is not available: close it and keep looking.
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(el => visible(el) && LOCKED.test(textOf(el)));
      if (dialog) { escape(); await sleep(400); click(button); await sleep(600); continue; }
      if (all([MENU_ITEMS]).some(visible)) escape();
      return { model: label };
    }
    escape();
    return { model: current, note: 'Không có model mạnh hơn để chọn, dùng model đang chọn.' };
  }

  async function typeInto(box, text) {
    box.focus();
    const ok = () => { const el = findComposer() || box; const now = el instanceof HTMLTextAreaElement ? el.value.replace(/\s+/g, ' ') : textOf(el); return now.includes(text.replace(/\s+/g, ' ').trim().slice(0, 40)); };
    if (box instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const range = document.createRange(); range.selectNodeContents(box); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('insertText', false, text);
      if (!ok()) { const data = new DataTransfer(); data.setData('text/plain', text); box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }
    }
    await sleep(500);
    if (!ok()) throw fail('Không nhập được lệnh vào ô chat. Hãy bấm vào ô chat một lần rồi thử lại.');
  }

  const THINKING = /^(thinking|đang suy nghĩ|suy nghĩ|reasoning|đang suy luận|thought for|đã suy nghĩ)[\s.…]*$/i;
  const turnOf = node => node.closest(S.turn) || node;
  const turnFinished = node => S.done.some(sel => { try { return [...turnOf(node).querySelectorAll(sel)].some(visible); } catch { return false; } });
  const progress = data => { try { chrome.runtime.sendMessage({ type: 'COSALPHA_CHAT_PROGRESS', site: SITE, ...data }).catch(() => {}); } catch { /* extension reloaded */ } };

  // Deletes the conversation cos_alpha_flow just created (only if the tab is still on that conversation).
  async function deleteConversation(expectedUrl) {
    if (!expectedUrl || location.href !== expectedUrl) return { ok: false, error: 'Tab đã sang cuộc trò chuyện khác, không xoá.' };
    // Only a saved conversation (…/c/<id>, …/app/<id>, …/chat/<id>) can be deleted; never the empty start page.
    if (!/\/(c|app|chat)\/[\w-]{6,}/.test(new URL(expectedUrl).pathname)) return { ok: false, error: 'Chưa có địa chỉ cuộc trò chuyện để xoá.' };
    const DELETE_TEXT = /^(xóa|xoá|delete|xóa cuộc trò chuyện|delete chat)$/i;
    const opener = first(S.options);
    if (!opener) return { ok: false, error: 'Không thấy nút tuỳ chọn của cuộc trò chuyện.' };
    click(opener);
    const item = await waitFor(() => first(S.deleteItem) || all([MENU_ITEMS]).filter(visible).find(el => DELETE_TEXT.test(textOf(el))), 3000);
    if (!item) { escape(); return { ok: false, error: 'Menu không có mục Xoá.' }; }
    click(item);
    const confirm = await waitFor(() => first(S.confirm) || [...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button, mat-dialog-container button')].filter(visible).find(el => DELETE_TEXT.test(textOf(el))), 3000);
    if (!confirm) { escape(); return { ok: false, error: 'Không thấy nút xác nhận xoá.' }; }
    click(confirm);
    const gone = await waitFor(() => location.href !== expectedUrl || !all(S.reply).length, 5000);
    return { ok: Boolean(gone) };
  }
  const stillTyped = text => { const el = findComposer(); if (!el) return false; const now = el instanceof HTMLTextAreaElement ? el.value : textOf(el); return now.replace(/\s+/g, ' ').includes(String(text).replace(/\s+/g, ' ').trim().slice(0, 30)); };
  function replyText(node) {
    // Prefer the code block that holds the script (ChatGPT/Gemini often wrap it), else the whole answer.
    // Use the <code> element itself: its <pre> also holds the language label and the "Copy code" button.
    const blocks = node.querySelectorAll('pre code').length ? node.querySelectorAll('pre code') : node.querySelectorAll('pre');
    const codes = [...blocks].map(el => el.innerText || el.textContent || '').filter(t => /CẢNH|Prompt/i.test(t));
    if (codes.length) return codes.sort((a, b) => b.length - a.length)[0].trim();
    const body = [...node.querySelectorAll('.markdown, .model-response-text, message-content')].at(-1) || node;
    return (body.innerText || '').split('\n').filter(line => !/^(copy code|sao chép mã|chép mã|plaintext|text|markdown)$/i.test(line.trim())).join('\n').trim();
  }

  // "Lấy câu trả lời ngay" in cos_alpha_flow: take whatever the reply says now instead of waiting.
  let takeNow = false;
  // Files (a video or audio clip for Motion Studio's speech agent) go into the chat box before the prompt.
  async function attachFiles(box, items) {
    const files = await Promise.all(items.map(async (item, index) => { const blob = await (await fetch(item.dataUrl)).blob(); return new File([blob], item.name || `cosalpha-file-${index + 1}.${(blob.type.split('/')[1] || 'bin')}`, { type: blob.type || item.type || 'application/octet-stream' }); }));
    const zone = () => composerZone(findComposer() || box);
    const beforeText = zone().innerText || '', beforePreviews = previews(zone()).length;
    const shown = () => files.every(file => (zone().innerText || '').includes(file.name.slice(0, 14)) && !beforeText.includes(file.name.slice(0, 14))) || previews(zone()).length > beforePreviews || zone().querySelectorAll('video, audio, [class*="file" i], [class*="attachment" i], [class*="upload" i]').length > 0;
    box.focus();
    const data = new DataTransfer(); files.forEach(file => data.items.add(file));
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    if (!(await waitFor(shown, 8000))) {
      const input = [...document.querySelectorAll('input[type="file"]')].filter(el => !el.disabled).sort((a, b) => Number(zone().contains(b)) - Number(zone().contains(a)))[0];
      if (!input) throw fail(`${SITE_NAME} không nhận file. Chưa gửi gì cả.`);
      const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      if (!(await waitFor(shown, 15000))) throw fail(`${SITE_NAME} chưa nhận file video. Chưa gửi gì cả.`);
    }
    // The send button stays disabled while the file uploads.
    await sleep(1500);
    await waitFor(() => { const b = first(S.send); return b && !isDisabled(b) ? b : null; }, 180000);
  }
  async function ask({ prompt, best = true, timeoutSec = 360, files = [] }) {
    takeNow = false;
    const box = await waitFor(findComposer, 15000);
    if (!box) {
      if (loginNeeded()) throw fail(`Hãy đăng nhập ${SITE_NAME} trong tab vừa mở rồi bấm viết lại.`, 'NEED_LOGIN');
      throw fail('Không thấy ô chat trên trang. Hãy tải lại tab rồi thử lại.');
    }
    const warnings = [];
    let model = '';
    if (best) { try { const picked = await pickBestModel(); model = picked.model; if (picked.note) warnings.push(picked.note); } catch (error) { warnings.push(`Chọn model: ${error.message}`); } }
    const baseline = all(S.reply).length;
    if (files.length) await attachFiles(findComposer() || box, files);
    await typeInto(findComposer() || box, prompt);
    const send = await waitFor(() => { const b = first(S.send); return b && !isDisabled(b) ? b : null; }, 8000);
    if (send) click(send);
    else (findComposer() || box).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    // Sent once the box is empty (or a reply / stop button shows). Thinking models can stay silent for minutes,
    // so after that only the overall timeout applies.
    const sent = await waitFor(() => all(S.reply).length > baseline || first(S.stop) || !stillTyped(prompt), 15000);
    if (!sent) throw fail(`${SITE_NAME} chưa nhận lệnh (chữ vẫn nằm trong ô chat). Xem tab ${SITE_NAME}; cos_alpha_flow không gửi lại.`);
    // Done when the stop button is gone and the answer has not changed for 3 s.
    const startedAt = Date.now(), end = startedAt + timeoutSec * 1000;
    let last = '', stableSince = 0;
    while (Date.now() < end) {
      await sleep(1000);
      const node = all(S.reply).length > baseline ? all(S.reply).at(-1) : null;
      const text = node ? replyText(node) : '';
      const busy = Boolean(first(S.stop)), finished = node ? turnFinished(node) : false;
      progress({ phase: !node ? 'waiting' : THINKING.test(text) ? 'thinking' : busy && !finished ? 'writing' : 'checking', seconds: Math.round((Date.now() - startedAt) / 1000), chars: text.length });
      if (takeNow && text && !THINKING.test(text)) return { ok: true, text, model, warnings, conversationUrl: location.href };
      if (text !== last) { last = text; stableSince = Date.now(); continue; }
      if (!text || THINKING.test(text)) continue;
      const still = Date.now() - stableSince;
      // Done: the turn shows its copy button, or nothing is generating; a wrongly matched "stop" button
      // cannot keep us waiting forever because 15 s of unchanged text also counts as done.
      if ((finished && still >= 2000) || (!busy && still >= 3000) || still >= 15000) return { ok: true, text, model, warnings, conversationUrl: location.href };
    }
    throw fail(`Chờ ${timeoutSec} giây mà ${SITE_NAME} chưa trả lời xong.`, 'TIMEOUT');
  }

  // ---------- image / video generation ----------
  const REFUSAL = /(can'?t|cannot|unable to|not able to|won'?t) (help|create|generate|make|produce)|against (our|my) (policy|policies|guidelines)|violat|not allowed|không thể (tạo|giúp)|vi phạm|chính sách/i;
  const LIMIT = /(reached|hit) (your|the) (daily |usage )?limit|limit (resets|reached)|out of (credits|quota)|upgrade to (plus|pro|premium|supergrok)|hết lượt|đạt giới hạn|vượt quá giới hạn/i;
  const generations = new Map();
  const checkStop = signal => { if (signal.aborted) throw fail('Đã dừng theo yêu cầu.', 'ABORTED'); };
  async function pause(ms, signal) { await sleep(ms); checkStop(signal); }
  function composerZone(box) { let zone = box; for (let i = 0; i < 6 && zone.parentElement; i++) { zone = zone.parentElement; if (zone.matches('form, fieldset, [class*="composer" i], [class*="input-area" i], [class*="query-box" i]')) break; } return zone; }

  async function dataUrlToFile(dataUrl, index) {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return new File([blob], `cosalpha-ref-${index + 1}.${ext}`, { type: blob.type || 'image/png' });
  }
  function previews(zone) { return [...zone.querySelectorAll('img')].filter(visible).map(img => img.currentSrc || img.src).filter(Boolean); }
  async function attachImages(box, images, signal) {
    if (!images.length) return;
    const files = await Promise.all(images.map(dataUrlToFile));
    const zone = composerZone(box), before = new Set(previews(zone));
    const added = () => previews(composerZone(findComposer() || box)).filter(src => !before.has(src)).length;
    // 1) paste, as a person would with Ctrl+V; 2) the page's own file input.
    box.focus();
    const data = new DataTransfer(); files.forEach(file => data.items.add(file));
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    if (await waitFor(() => added() >= files.length, 6000)) return;
    const input = [...document.querySelectorAll('input[type="file"]')].filter(el => !el.disabled && (!el.accept || /image|\*/.test(el.accept))).sort((a, b) => Number(zone.contains(b)) - Number(zone.contains(a)))[0];
    if (input) {
      const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
      if (files.length > 1) input.multiple = true;
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      if (await waitFor(() => added() >= 1, 15000)) { await pause(1500, signal); return; }
    }
    checkStop(signal);
    throw fail(`${SITE_NAME} chưa nhận ảnh tham chiếu. Chưa gửi gì cả. Hãy thử kéo một ảnh vào ô chat bằng tay một lần rồi chạy lại.`);
  }

  // Generated pictures/clips: big media that were not on the page before sending and are not in the composer.
  // The user's own message (with the uploaded reference pictures) is never the result.
  const USER_MESSAGE = '[data-message-author-role="user"], user-query, [class*="user-query" i], [data-testid*="user-message" i], [class*="user-message" i]';
  function mediaCandidates(kind, baseline, box, skipSrc = new Set()) {
    const zone = box ? composerZone(box) : null;
    return [...document.querySelectorAll(kind === 'video' ? 'video' : 'img')].filter(el => {
      if (baseline.has(el) || !visible(el) || zone?.contains(el) || el.closest(USER_MESSAGE) || skipSrc.has(mediaUrl(el))) return false;
      const r = el.getBoundingClientRect();
      if (kind === 'video') return Boolean(el.currentSrc || el.src || el.querySelector('source')?.src) && r.width >= 120;
      return el.complete && el.naturalWidth >= 256 && el.naturalHeight >= 256 && r.width >= 120 && !/^data:image\/svg/i.test(el.src);
    });
  }
  const mediaUrl = el => el.currentSrc || el.src || el.querySelector?.('source')?.src || '';
  function blobToDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
  async function copyMedia(url) {
    if (url.startsWith('data:')) return url;
    if (url.startsWith('blob:') || new URL(url, location.href).origin === location.origin) {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return blobToDataUrl(await response.blob());
    }
    const reply = await chrome.runtime.sendMessage({ type: 'THEKEY_FETCH_MEDIA', url, maxBytes: 80 * 1024 * 1024 });
    if (!reply?.ok) throw new Error(reply?.error || 'không tải được');
    if (reply.tooLarge || !reply.url) throw new Error('file quá lớn');
    return reply.url;
  }

  function generationText({ kind, prompt, aspect, duration, imageCount }) {
    const refs = imageCount ? ` Use the ${imageCount > 1 ? `${imageCount} attached images` : 'attached image'} as reference (keep the same people, faces, outfits and products).` : '';
    const what = kind === 'video' ? `Create one video${duration ? `, ${duration} seconds long` : ''}${aspect ? `, aspect ratio ${aspect}` : ''}.` : `Create one image${aspect ? `, aspect ratio ${aspect}` : ''}.`;
    return `${what}${refs} Generate it right away, do not ask me questions and do not rewrite the description.\n\n${String(prompt || '').trim()}`;
  }

  async function generate({ requestId, kind = 'image', prompt, images = [], aspect, duration, timeoutSec = 600 }, signal) {
    if (kind === 'video' && SITE === 'chatgpt') throw fail('ChatGPT không tạo video. Hãy chọn Flow, Grok, Muse hoặc Gemini cho node video.', 'UNSUPPORTED');
    const box = await waitFor(findComposer, 15000);
    if (!box) throw fail(loginNeeded() ? `Hãy đăng nhập ${SITE_NAME} trong tab vừa mở rồi chạy lại.` : `Không thấy ô chat ${SITE_NAME}. Hãy tải lại tab rồi chạy lại.`, loginNeeded() ? 'NEED_LOGIN' : 'CHAT_ERROR');
    checkStop(signal);
    await attachImages(box, images, signal);
    const baseline = new Set(document.querySelectorAll('img, video'));
    const refSrc = new Set(previews(composerZone(findComposer() || box)));
    const firstSeen = new Map(), sentAt = Date.now();
    const replyBaseline = all(S.reply).length;
    await typeInto(findComposer() || box, generationText({ kind, prompt, aspect, duration, imageCount: images.length }));
    checkStop(signal);
    const send = await waitFor(() => { const b = first(S.send); return b && !isDisabled(b) ? b : null; }, 60000);
    if (!send) throw fail(`Nút gửi của ${SITE_NAME} vẫn bị khoá (có thể ảnh còn đang tải lên). Chưa gửi gì cả.`);
    click(send);
    const sent = await waitFor(() => all(S.reply).length > replyBaseline || first(S.stop) || mediaCandidates(kind, baseline).length || !stillTyped(String(prompt || '').trim()), 15000);
    if (!sent) throw fail(`${SITE_NAME} chưa nhận lệnh (chữ vẫn nằm trong ô chat). Xem tab ${SITE_NAME}; cos_alpha_flow không gửi lại.`);
    const end = Date.now() + Math.max(60, Number(timeoutSec) || 600) * 1000;
    let lastKey = '', stableSince = 0, quietSince = 0, lastText = '';
    while (Date.now() < end) {
      await pause(1000, signal);
      // With uploads, anything that shows up within 4 s of sending is the echo of our own pictures, not a result.
      for (const el of document.querySelectorAll('img, video')) if (!baseline.has(el) && !firstSeen.has(el)) firstSeen.set(el, Date.now());
      const found = mediaCandidates(kind, baseline, findComposer(), refSrc).filter(el => !images.length || firstSeen.get(el) - sentAt > 4000);
      const busy = Boolean(first(S.stop));
      if (found.length) {
        const el = found[found.length - 1], url = mediaUrl(el), key = `${url}|${el.naturalWidth || el.videoWidth || 0}`;
        if (key !== lastKey) { lastKey = key; stableSince = Date.now(); continue; }
        // Pictures are drawn progressively: wait until the stop button is gone and nothing changed for 4 s.
        if (!busy && Date.now() - stableSince >= 4000) {
          try { return { ok: true, url: await copyMedia(url), remoteUrl: url, width: el.naturalWidth || el.videoWidth || 0, height: el.naturalHeight || el.videoHeight || 0, found: found.length }; }
          catch (error) { return { ok: true, url, remoteUrl: url, warnings: [`${SITE_NAME}: đã có ${kind === 'video' ? 'video' : 'ảnh'} nhưng không chép về máy được (${error.message}).`] }; }
        }
        continue;
      }
      const node = all(S.reply).at(-1), text = node && all(S.reply).length > replyBaseline ? textOf(node) : '';
      if (text !== lastText) { lastText = text; quietSince = Date.now(); continue; }
      // Finished talking without a picture: a refusal, a limit, or a question back.
      if (!busy && text && Date.now() - quietSince >= 8000) {
        if (LIMIT.test(text)) throw fail(`${SITE_NAME}: ${text.slice(0, 300)}`, 'NO_CREDITS');
        if (REFUSAL.test(text)) throw fail(`${SITE_NAME} không tạo được nội dung này: ${text.slice(0, 300)}`, 'SCENE_REFUSED');
        if (Date.now() - quietSince >= 25000) throw fail(`${SITE_NAME} trả lời nhưng không có ${kind === 'video' ? 'video' : 'ảnh'}: ${text.slice(0, 300)}`, 'NO_MEDIA');
      }
    }
    throw fail(`Đã chờ ${timeoutSec} giây mà ${SITE_NAME} chưa trả ${kind === 'video' ? 'video' : 'ảnh'}. Câu lệnh chỉ gửi một lần, không gửi lại.`, 'TIMEOUT');
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'COSALPHA_CHAT_GENERATE') {
      const controller = new AbortController(); generations.set(message.requestId, controller);
      generate(message, controller.signal).then(sendResponse, error => sendResponse({ ok: false, code: error.code || 'CHAT_ERROR', error: error.message || String(error) })).finally(() => generations.delete(message.requestId));
      return true;
    }
    if (message?.type === 'COSALPHA_CHAT_TAKE') { takeNow = true; sendResponse({ ok: true }); return false; }
    if (message?.type === 'COSALPHA_CHAT_DELETE') { deleteConversation(message.url).then(sendResponse, error => sendResponse({ ok: false, error: error.message })); return true; }
    if (message?.type === 'COSALPHA_CHAT_STOP') {
      for (const [id, controller] of generations) if (!message.requestId || id === message.requestId) controller.abort();
      const stop = first(S.stop); if (stop) click(stop);
      sendResponse({ ok: true }); return false;
    }
    return false;
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'COSALPHA_CHAT_PING') { sendResponse({ ok: true, site: SITE, ready: Boolean(findComposer()), loginNeeded: loginNeeded() }); return false; }
    if (message?.type !== 'COSALPHA_CHAT_ASK') return false;
    ask(message).then(sendResponse, error => sendResponse({ ok: false, code: error.code || 'CHAT_ERROR', error: error.message || String(error) }));
    return true;
  });
})();
