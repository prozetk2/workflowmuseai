// Motion Studio: replace the person in a source video with your character, clip by clip, on Google Flow.
// The source video is cut into short clips (FFmpeg, on this computer); each clip goes to Flow in
// Video · Thành phần (ingredients) mode together with the character pictures; the results are merged back.
(() => {
  const $ = selector => document.querySelector(selector);
  const FLOW_TAB_URLS = ['https://flow.google.com/*', 'https://labs.google/fx/*'];
  const DURATIONS = [4, 6, 8, 10];
  // Written like TobyFlow's request (character = "image 1", the clip is the motion reference), not as "replace the person".
  // Image 1 = who; the reference video = only how they move. The sound line is added per clip (see composePrompt).
  const DEFAULT_PROMPT = 'Image 1 is the character. The reference video is only a guide for motion and timing. Recreate the reference video shot for shot with the character from image 1 as the only person in it: the same body movement, gestures, head turns, facial expressions and mouth movement, the same timing and rhythm, the same camera position, framing and camera moves, the same room, props and lighting. In every frame the character keeps the face, hairstyle, body shape and outfit from image 1; nothing of the appearance of the person in the reference video (face, hair, clothes) carries over. Natural, realistic motion, no extra people, no on-screen text.';
  const OLD_PROMPTS = ['Animate the character in image 1 so that they perform exactly the same movement as in the reference video: the same body motion, gestures, facial expressions and lip movement, the same timing, the same camera movement and framing, the same location and lighting. The character keeps their own face, hairstyle and outfit from image 1 in every frame. Keep the sound of the reference video.', 'Replace the person in the attached video with the character from the attached reference image(s). Keep exactly the same motion, body movement, gestures, facial expressions, lip movement and timing, and the same camera movement, framing, lighting and background as the video. The character must look exactly like the reference (same face, hair and outfit). Do not add or remove people or objects. Keep the original speech and sound.'];
  const state = {
    project: null, sourceUrl: '', clipUrls: new Map(), resultUrls: new Map(), finalUrl: '',
    running: false, abort: null, requestId: '', ffmpeg: null, ffmpegLogs: []
  };

  // ---------- storage (IndexedDB: project JSON + media blobs) ----------
  let dbPromise;
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('cosalpha-motion', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('meta'); request.result.createObjectStore('blobs'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Không mở được kho lưu Motion Studio.'));
    });
    return dbPromise;
  }
  async function idb(store, mode, run) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(store, mode), request = run(tx.objectStore(store));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Lưu bị huỷ.'));
    });
  }
  const putBlob = (key, blob) => idb('blobs', 'readwrite', store => store.put(blob, key));
  const getBlob = key => idb('blobs', 'readonly', store => store.get(key));
  const delBlob = key => idb('blobs', 'readwrite', store => store.delete(key));
  let saveTimer = 0;
  function saveNow() { clearTimeout(saveTimer); return idb('meta', 'readwrite', store => store.put(state.project, 'project')).catch(error => status(`Không lưu được dự án: ${error.message}`, 'error')); }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => idb('meta', 'readwrite', store => store.put(state.project, 'project')).catch(error => status(`Không lưu được dự án: ${error.message}`, 'error')), 300); }
  function newProject() {
    return { source: null, chars: [], clips: [], final: null, settings: { aspect: '9:16', resolution: '720p', model: 'Omni 1.1 Flash', clipLen: 8, prompt: DEFAULT_PROMPT, keepAudio: false, audioMode: 'auto', silentFallback: true, pace: 5, sync: false, voiceDesc: '', flowVoice: '', subtitles: false, translate: '', speechAgent: 'gemini-web' } };
  }

  // ---------- small helpers ----------
  function status(text, cls = '') { const el = $('#msStatus'); el.textContent = text; el.className = `ms-status ${cls}`; }
  const sleep = (ms, signal) => new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Đã dừng.', 'AbortError')); }, { once: true }); });
  const fmt = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
  const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  const blobToDataUrl = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  function objectUrl(map, key, blob) { if (map.has(key)) URL.revokeObjectURL(map.get(key)); const url = URL.createObjectURL(blob); map.set(key, url); return url; }
  function videoMeta(url) {
    return new Promise(resolve => {
      const video = document.createElement('video'); video.preload = 'metadata'; video.muted = true;
      const timer = setTimeout(() => resolve({ duration: 0, width: 0, height: 0 }), 15000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }); };
      video.onerror = () => { clearTimeout(timer); resolve({ duration: 0, width: 0, height: 0 }); };
      video.src = url;
    });
  }
  function frameAt(url, time) {
    return new Promise(resolve => {
      const video = document.createElement('video'); video.preload = 'auto'; video.muted = true; video.playsInline = true;
      const timer = setTimeout(() => resolve(''), 15000);
      video.onloadedmetadata = () => { video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05)); };
      video.onseeked = () => {
        try {
          const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight)), canvas = document.createElement('canvas');
          canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          clearTimeout(timer); resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch { clearTimeout(timer); resolve(''); }
      };
      video.onerror = () => { clearTimeout(timer); resolve(''); };
      video.src = url;
    });
  }
  async function shrinkImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Không đọc được ảnh ${file.name}.`)); img.src = url; });
      const scale = Math.min(1, 1536 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.92);
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- FFmpeg ----------
  async function ffmpeg() {
    if (state.ffmpeg) return state.ffmpeg;
    if (!window.FFmpegWASM?.FFmpeg) throw new Error('Chưa tải được FFmpeg của app. Hãy tải lại trang Motion Studio.');
    const instance = new window.FFmpegWASM.FFmpeg();
    instance.on('log', event => { if (event?.message) { state.ffmpegLogs.push(event.message); if (state.ffmpegLogs.length > 30) state.ffmpegLogs.shift(); } });
    status('Đang tải bộ xử lý video FFmpeg…', 'warn');
    await instance.load({ coreURL: chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.js'), wasmURL: chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.wasm') });
    state.ffmpeg = instance;
    return instance;
  }
  async function run(ff, args) {
    state.ffmpegLogs = [];
    const code = await ff.exec(args);
    if (code !== 0) throw new Error(state.ffmpegLogs.slice(-4).map(line => line.trim()).filter(Boolean).join(' ') || `FFmpeg dừng với mã lỗi ${code}.`);
  }
  async function hasAudio(ff, path) {
    try {
      await ff.ffprobe(['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', path, '-o', '/probe.json']);
      const raw = await ff.readFile('/probe.json', 'utf8'), probe = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      return Boolean(probe.streams?.some(stream => stream.codec_type === 'audio'));
    } catch { return false; }
  }
  // A silent stereo 48 kHz WAV, used where a clip has no sound.
  function silentWav(seconds) {
    const rate = 48000, frames = Math.ceil(rate * seconds), data = frames * 4, buffer = new ArrayBuffer(44 + data), view = new DataView(buffer);
    const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + data, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, data, true);
    return new Uint8Array(buffer);
  }

  // ---------- Flow tab ----------
  function sendToTab(tabId, message, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('Đã dừng.', 'AbortError')); return; }
      let done = false;
      const onAbort = () => { if (done) return; done = true; reject(new DOMException('Đã dừng.', 'AbortError')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      chrome.tabs.sendMessage(tabId, message).then(value => { if (!done) { done = true; signal?.removeEventListener('abort', onAbort); resolve(value); } }, error => { if (!done) { done = true; signal?.removeEventListener('abort', onAbort); reject(error); } });
    });
  }
  async function flowTab() {
    const tabs = await chrome.tabs.query({ url: FLOW_TAB_URLS });
    tabs.sort((a, b) => (/\/project\//.test(b.url || '') - /\/project\//.test(a.url || '')) || (b.active - a.active));
    return tabs[0] || null;
  }
  async function flowMessage(message, signal) {
    const tab = await flowTab();
    if (!tab?.id) throw new Error('Hãy mở Google Flow (flow.google.com), đăng nhập và mở một dự án rồi thử lại.');
    const settings = (await chrome.storage.local.get('museflow')).museflow?.settings || {};
    let selectors; try { selectors = settings.flowSelectors ? JSON.parse(settings.flowSelectors) : undefined; } catch { selectors = undefined; }
    const outgoing = { ...message, selectors, inputMode: settings.inputMode || 'auto' };
    try { return await sendToTab(tab.id, outgoing, signal); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      // Only when the message never reached the page: inject the bridge and send once more.
      if (!/receiving end does not exist|could not establish connection/i.test(error?.message || '')) {
        return { ok: false, code: 'FLOW_DISCONNECTED', error: `Mất kết nối với tab Flow giữa chừng (${error?.message || error}). Không gửi lại để tránh tạo trùng.` };
      }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['flow-page-hook.js'], world: 'MAIN' }).catch(() => {});
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['flow-bridge.js'] });
      return sendToTab(tab.id, outgoing, signal);
    }
  }
  async function checkFlow() {
    const pill = $('#msFlow');
    try {
      const reply = await flowMessage({ type: 'THEKEY_FLOW_CHECK_SESSION' });
      pill.textContent = reply?.ready ? 'Flow sẵn sàng' : 'Mở một dự án trong Flow'; pill.className = `ms-pill ${reply?.ready ? 'ok' : 'warn'}`;
    } catch (error) { pill.textContent = 'Chưa có tab Flow'; pill.className = 'ms-pill warn'; pill.title = error.message; }
  }

  // ---------- source & characters ----------
  async function loadSource(file) {
    if (!file || !/^video\//.test(file.type)) { status('Hãy chọn một file video (MP4/MOV/WebM).', 'warn'); return; }
    if (file.size > 500 * 1024 * 1024) { status('Video lớn hơn 500 MB. Hãy cắt ngắn trước (vài chục giây là hợp lý).', 'warn'); return; }
    if (state.project.clips.some(clip => clip.result) && !confirm('Thay video gốc sẽ xoá các đoạn và kết quả hiện có. Tiếp tục?')) return;
    await clearClips();
    await putBlob('source', file);
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    const url = state.sourceUrl = URL.createObjectURL(file);
    const meta = await videoMeta(url);
    if (!meta.duration) { status('Trình duyệt không mở được video này. Hãy dùng MP4 (H.264) hoặc WebM.', 'error'); return; }
    state.project.source = { name: file.name, type: file.type, size: file.size, ...meta };
    if (meta.width && meta.height) state.project.settings.aspect = meta.width >= meta.height ? '16:9' : '9:16';
    saveSoon(); renderAll();
    status(`Đã nạp ${file.name} (${fmt(meta.duration)}). Chọn độ dài đoạn rồi bấm "Cắt thành đoạn".`, 'ok');
  }
  async function addChars(files) {
    // One character picture, as TobyFlow does: it is "image 1" in the prompt.
    const room = 1 - state.project.chars.length;
    if (room <= 0) { status('Chỉ dùng 1 ảnh nhân vật. Xoá ảnh hiện tại trước khi thêm ảnh khác.', 'warn'); return; }
    for (const file of [...files].filter(item => /^image\//.test(item.type)).slice(0, room)) {
      try { state.project.chars.push({ id: uid('char'), name: file.name, dataUrl: await shrinkImage(file) }); }
      catch (error) { status(error.message, 'error'); }
    }
    saveSoon(); renderChars();
  }

  // ---------- clips ----------
  async function clearClips() {
    for (const clip of state.project.clips) { await delBlob(`clip:${clip.id}`).catch(() => {}); await delBlob(`result:${clip.id}`).catch(() => {}); }
    for (const url of [...state.clipUrls.values(), ...state.resultUrls.values()]) URL.revokeObjectURL(url);
    state.clipUrls.clear(); state.resultUrls.clear();
    state.project.clips = []; await clearFinal();
  }
  async function clearFinal() {
    state.project.final = null; await delBlob('final').catch(() => {});
    if (state.finalUrl) URL.revokeObjectURL(state.finalUrl); state.finalUrl = '';
  }
  function plan(duration, length) {
    const cuts = [];
    for (let start = 0; start < duration - 0.05; start += length) cuts.push([start, Math.min(duration, start + length)]);
    // A last piece under 1.5 s is too short to animate on its own: give it to the clip before.
    if (cuts.length > 1 && cuts.at(-1)[1] - cuts.at(-1)[0] < 1.5) { const last = cuts.pop(); cuts.at(-1)[1] = last[1]; }
    return cuts;
  }
  async function splitSource() {
    const source = state.project.source; if (!source) return;
    if (state.project.clips.some(clip => clip.result) && !confirm('Cắt lại sẽ xoá các kết quả Flow hiện có. Tiếp tục?')) return;
    const length = Number(state.project.settings.clipLen) || 8;
    const cuts = plan(source.duration, length);
    if (cuts.length > 40) { status(`Video dài ${fmt(source.duration)} sẽ thành ${cuts.length} đoạn. Hãy chọn đoạn dài hơn hoặc cắt ngắn video.`, 'warn'); return; }
    setBusy(true);
    try {
      await clearClips();
      const ff = await ffmpeg();
      const blob = await getBlob('source'); if (!blob) throw new Error('Không thấy video gốc đã lưu. Hãy chọn lại video.');
      await ff.writeFile('/source', new Uint8Array(await blob.arrayBuffer()));
      for (const [index, [start, end]] of cuts.entries()) {
        status(`Đang cắt đoạn ${index + 1}/${cuts.length} (${fmt(start)}–${fmt(end)})…`, 'warn');
        const out = `/clip-${index}.mp4`;
        // Re-encoded (not stream-copied) so every clip starts on a real frame; at most 1280 px to keep uploads small.
        await run(ff, ['-ss', start.toFixed(3), '-i', '/source', '-t', (end - start).toFixed(3), '-vf', 'scale=w=1280:h=1280:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', out]);
        const data = await ff.readFile(out); await ff.deleteFile(out).catch(() => {});
        const clip = { id: uid('clip'), index, start, end, status: 'idle', error: '', result: false, thumb: '' };
        const clipBlob = new Blob([data], { type: 'video/mp4' });
        await putBlob(`clip:${clip.id}`, clipBlob);
        clip.thumb = await frameAt(objectUrl(state.clipUrls, clip.id, clipBlob), 0.1);
        state.project.clips.push(clip); renderClips();
      }
      await ff.deleteFile('/source').catch(() => {});
      await saveNow();
      status(`Đã cắt thành ${cuts.length} đoạn. Thêm ảnh nhân vật rồi bấm "Tạo tất cả đoạn".`, 'ok');
    } catch (error) { status(`Cắt video thất bại: ${error.message}`, 'error'); }
    finally { setBusy(false); renderAll(); }
  }
  async function clipUrl(clip, kind = 'clip') {
    const map = kind === 'clip' ? state.clipUrls : state.resultUrls;
    if (map.has(clip.id)) return map.get(clip.id);
    const blob = await getBlob(`${kind}:${clip.id}`);
    return blob ? objectUrl(map, clip.id, blob) : '';
  }

  // ---------- dialogue (speech agent: ChatGPT / Gemini tab, or the Gemini API) ----------
  // As in TobyFlow: each clip's sound is taken out as a small WAV file and sent to the user's own signed-in
  // ChatGPT or Gemini tab (no API key), which writes down what is said, with a timeline of who speaks when.
  const TRANSCRIBE_SYSTEM = 'You transcribe speech in a short audio clip for lip-synced dubbing. Return JSON only: {"has_speech": true|false, "language": "language of the speech in English, e.g. Vietnamese", "text": "exactly what is said, verbatim, in the original language; numbers written as spoken words; no speaker names, no descriptions of sounds or music", "translation": "the whole line translated as asked, or an empty string", "segments": [{"start": seconds from the start of the clip, "end": seconds, "text": "the words said in this part", "translation": "this part translated as asked, or an empty string"}]}. Split segments at pauses; times to 0.1 s. If nobody speaks (music or silence only), return has_speech false, empty strings and an empty segments list.';
  const AGENT_NAME = { chatgpt: 'ChatGPT', 'gemini-web': 'Gemini', 'gemini-api': 'Gemini API' };
  const CHAT_URL = { chatgpt: 'https://chatgpt.com/', 'gemini-web': 'https://gemini.google.com/app' };
  const needsDialogue = () => Boolean(state.project.settings.sync || state.project.settings.subtitles || state.project.settings.translate);
  const waitTabLoaded = tabId => new Promise(resolve => { const done = (id, info) => { if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(done); resolve(); } }; chrome.tabs.onUpdated.addListener(done); setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); resolve(); }, 30000); });
  async function chatWebAsk(target, prompt, files, signal) {
    const name = AGENT_NAME[target] || target;
    const [previous] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const saved = (await chrome.storage.session?.get?.('cosalphaChatTabs').catch(() => ({})))?.cosalphaChatTabs || {};
    let tab = saved[target] ? await chrome.tabs.get(saved[target]).catch(() => null) : null;
    if (tab) tab = await chrome.tabs.update(tab.id, { url: CHAT_URL[target], active: true });
    else tab = await chrome.tabs.create({ url: CHAT_URL[target], active: true, ...(previous?.windowId !== undefined ? { windowId: previous.windowId } : {}) });
    chrome.storage.session?.set?.({ cosalphaChatTabs: { ...saved, [target]: tab.id } }).catch(() => {});
    const back = () => { if (previous?.id && previous.id !== tab.id) chrome.tabs.update(previous.id, { active: true }).catch(() => {}); };
    try {
      await waitTabLoaded(tab.id);
      let ready = await chrome.tabs.sendMessage(tab.id, { type: 'COSALPHA_CHAT_PING' }).catch(() => null);
      if (!ready) { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['chat-bridge.js'] }).catch(() => {}); ready = await chrome.tabs.sendMessage(tab.id, { type: 'COSALPHA_CHAT_PING' }).catch(() => null); }
      if (!ready) throw new Error(`Không gắn được vào tab ${name}. Hãy tải lại cos_alpha_flow rồi thử lại.`);
      if (ready.loginNeeded) throw new Error(`Hãy đăng nhập ${name} trong tab vừa mở rồi lấy lời thoại lại.`);
      const reply = await sendToTab(tab.id, { type: 'COSALPHA_CHAT_ASK', prompt, best: false, files, timeoutSec: 300 }, signal);
      if (!reply?.ok) throw new Error(reply?.error || `${name} không trả lời.`);
      if ((await chrome.storage.local.get('cosalphaChatCleanup').catch(() => ({}))).cosalphaChatCleanup !== false) await chrome.tabs.sendMessage(tab.id, { type: 'COSALPHA_CHAT_DELETE', url: reply.conversationUrl }).catch(() => {});
      return reply.text || '';
    } finally { back(); }
  }
  function parseJsonReply(text) {
    const raw = String(text || ''), match = raw.match(/\{[\s\S]*\}/);
    try { return JSON.parse(match ? match[0] : raw); } catch { throw new Error('Câu trả lời khi chép lời thoại không đúng dạng. Hãy thử lại.'); }
  }
  async function blobHasAudio(blob) {
    try { const ff = await ffmpeg(); await ff.writeFile('/probe-in.mp4', new Uint8Array(await blob.arrayBuffer())); const yes = await hasAudio(ff, '/probe-in.mp4'); await ff.deleteFile('/probe-in.mp4').catch(() => {}); return yes; } catch { return true; }
  }
  // The clip's sound as a mono 16 kHz WAV (small, and both ChatGPT and Gemini accept it); null when the clip has none.
  async function clipWav(clip) {
    const blob = await getBlob(`clip:${clip.id}`); if (!blob) throw new Error('Đoạn này mất file gốc. Hãy cắt lại video.');
    const ff = await ffmpeg();
    await ff.writeFile('/speech-in.mp4', new Uint8Array(await blob.arrayBuffer()));
    try {
      if (!(await hasAudio(ff, '/speech-in.mp4'))) return null;
      await run(ff, ['-i', '/speech-in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', '/speech.wav']);
      return new Blob([await ff.readFile('/speech.wav')], { type: 'audio/wav' });
    } finally { await ff.deleteFile('/speech-in.mp4').catch(() => {}); await ff.deleteFile('/speech.wav').catch(() => {}); }
  }
  async function transcribe(clip, signal) {
    const target = state.project.settings.translate || '';
    const wav = await clipWav(clip);
    if (!wav) { clip.transcript = { has_speech: false, language: '', text: '', translation: '', segments: [], target }; saveSoon(); return clip.transcript; }
    const user = `Transcribe exactly what is spoken in this ${(clip.end - clip.start).toFixed(1)}-second audio clip, with its timeline.${target ? ` Also translate it into ${target} ("translation" for the whole line and for each segment), natural and about the same length so it fits the same timing.` : ' Leave every "translation" empty.'}`;
    const audio = await blobToDataUrl(wav);
    const agent = state.project.settings.speechAgent || 'gemini-web';
    let replyText;
    if (agent === 'gemini-api') {
      if (!window.CosAlphaAI?.text) throw new Error('Chưa tải được phần Gemini của app. Hãy tải lại trang Motion Studio.');
      replyText = (await window.CosAlphaAI.text({ system: TRANSCRIBE_SYSTEM, user, images: [audio], json: true, temperature: 0.1, signal })).text;
    } else {
      replyText = await chatWebAsk(agent, `${TRANSCRIBE_SYSTEM}\n\n${user} Listen to the attached audio file. Reply with the JSON object only.`, [{ dataUrl: audio, name: `motion-doan-${clip.index + 1}.wav`, type: 'audio/wav' }], signal);
    }
    const data = parseJsonReply(replyText);
    const segments = (Array.isArray(data.segments) ? data.segments : []).map(item => ({ start: Math.max(0, Number(item.start) || 0), end: Math.max(0, Number(item.end) || 0), text: String(item.text || '').trim(), translation: String(item.translation || '').trim() })).filter(item => item.text);
    clip.transcript = { has_speech: Boolean(data.has_speech && String(data.text || '').trim()), language: String(data.language || ''), text: String(data.text || '').trim(), translation: String(data.translation || '').trim(), segments, target, agent };
    saveSoon();
    return clip.transcript;
  }
  async function ensureTranscript(clip, signal) {
    const t = clip.transcript;
    if (t && (t.manual || (t.target || '') === (state.project.settings.translate || ''))) return t;
    status(`Đang lấy lời thoại đoạn ${clip.index + 1} bằng ${AGENT_NAME[state.project.settings.speechAgent] || 'Gemini'}…`, 'warn');
    return transcribe(clip, signal);
  }
  // The clip's prompt: the motion prompt, then exactly one line about sound: the dialogue to speak (with its
  // timeline and the new voice), or plain ambience when the source sound is put back at merge.
  const SOUND_LINE = /\s*(Keep the (original speech and )?sound of the reference video\.?|Sound: [^\n]*)/gi;
  function timelineText(t, translated) {
    const segments = (t.segments || []).filter(item => String(translated ? item.translation || '' : item.text || '').trim());
    if (!segments.length) return '';
    return segments.map(item => `${Number(item.start).toFixed(1)}–${Number(item.end).toFixed(1)} s: "${String(translated ? item.translation : item.text).replace(/"/g, "'").trim()}"`).join('; ');
  }
  function composePrompt(clip) {
    const settings = state.project.settings, t = clip.transcript;
    const parts = [String(settings.prompt || DEFAULT_PROMPT).replace(SOUND_LINE, '').trim()];
    const speech = t?.has_speech && (settings.sync || settings.subtitles || settings.translate);
    const translated = Boolean(settings.translate && t?.translation);
    const line = speech ? (translated ? t.translation : t.text).replace(/"/g, "'") : '';
    const language = translated ? settings.translate : t?.language;
    const timeline = speech ? timelineText(t, translated) : '';
    if (speech && (settings.sync || translated)) {
      parts.push(`Dialogue: the character speaks${language ? ` in ${language}` : ''}, mouth movement exactly in sync with the words, starting and pausing exactly when the person in the reference video does${timeline ? `. Timeline (seconds from the start of the clip): ${timeline}` : `: "${line}"`}.`);
      parts.push(`Voice: ${settings.voiceDesc?.trim() || 'a natural voice that suits the character'}; a new voice, not the voice of the reference video. Sound: only this dialogue over quiet room ambience, no music.`);
    } else if (settings.audioMode === 'original') {
      parts.push('Sound: quiet room ambience only, no music and no speech (the original soundtrack is added afterwards).');
    } else {
      parts.push('Sound: natural sound for the action and the room, in the same mood as the reference video; no copyrighted music.');
    }
    if (speech && settings.subtitles) parts.push(`Subtitles: burned-in at the bottom of the frame, exactly this text, each part shown while it is spoken: "${line}".`);
    return parts.join('\n\n');
  }
  async function transcribeAll() {
    if (state.running || !state.project.clips.length) return;
    state.running = true; state.abort = new AbortController(); setBusy(true);
    let done = 0;
    try {
      for (const clip of state.project.clips) {
        status(`Đang lấy lời thoại đoạn ${clip.index + 1}/${state.project.clips.length} bằng ${AGENT_NAME[state.project.settings.speechAgent] || 'Gemini'}…`, 'warn');
        try { await transcribe(clip, state.abort.signal); done++; renderClips(); }
        catch (error) { if (error?.name === 'AbortError') throw error; status(error.message, 'error'); if (error.code === 'NO_API_KEY') return; }
      }
      status(`Đã lấy lời thoại ${done} đoạn. Bấm vào một đoạn để xem / sửa.`, 'ok');
    } catch { status('Đã dừng.', 'warn'); }
    finally { state.running = false; state.abort = null; setBusy(false); renderAll(); await saveNow(); }
  }

  // ---------- generation ----------
  function flowDuration(seconds) { return DURATIONS.find(value => value >= seconds - 0.05) || 10; }
  async function generateClip(clip, signal) {
    const settings = state.project.settings;
    const blob = await getBlob(`clip:${clip.id}`); if (!blob) throw new Error('Đoạn này mất file gốc. Hãy cắt lại video.');
    clip.status = 'running'; clip.error = ''; renderClips(); saveSoon();
    if (needsDialogue()) await ensureTranscript(clip, signal);
    state.requestId = uid('motion');
    const reply = await flowMessage({
      type: 'THEKEY_FLOW_GENERATE', requestId: state.requestId, kind: 'video', prompt: composePrompt(clip), voice: settings.sync ? (settings.flowVoice || '').trim() : '',
      aspect: settings.aspect, duration: flowDuration(clip.end - clip.start), resolution: settings.resolution, model: settings.model || '', inputType: 'ingredients',
      sourceVideo: await blobToDataUrl(blob), references: state.project.chars.map(item => item.dataUrl), firstFrame: '', uiMode: 'agent', timeoutSec: 1200
    }, signal);
    if (!reply?.ok) throw Object.assign(new Error(reply?.error || 'Flow không trả video.'), { code: reply?.code || '' });
    await keepResult(clip, reply);
  }
  async function keepResult(clip, reply) {
    // The same Flow video for two clips means the result of an earlier clip was picked up again: stop, never merge it.
    const key = String(reply.remoteUrl || '').split(/[?#]/)[0];
    const twin = key && !key.startsWith('blob:') ? state.project.clips.find(other => other !== clip && other.resultKey === key) : null;
    if (twin) throw Object.assign(new Error(`Flow trả lại đúng video của đoạn ${state.project.clips.indexOf(twin) + 1}, không phải video mới của đoạn này. Hãy mở tab Flow xem đoạn này đã tạo xong chưa rồi bấm tạo lại.`), { code: 'DUPLICATE_RESULT' });
    const result = await (await fetch(reply.url)).blob();
    if (!result.size) throw new Error('Video Flow trả về bị rỗng.');
    await putBlob(`result:${clip.id}`, result.type ? result : new Blob([result], { type: 'video/mp4' }));
    objectUrl(state.resultUrls, clip.id, result);
    clip.result = true; clip.status = 'success'; clip.error = (reply.warnings || []).join(' '); clip.resultKey = key;
    clip.resultThumb = await frameAt(state.resultUrls.get(clip.id), 0.1);
    clip.resultSilent = !(await blobHasAudio(result));
  }
  // Flow could make the picture but not its sound: with the user's OK, switch on Flow's "return the video without
  // sound" setting and send the clip once more; the source clip's sound is used for it at merge.
  async function generateWithFallback(clip, signal) {
    try { await generateClip(clip, signal); }
    catch (error) {
      if (error.code !== 'AUDIO_FAILED' || !state.project.settings.silentFallback) throw error;
      status(`Flow không tạo được âm thanh cho đoạn ${clip.index + 1} (được hoàn credit). Bật "Trả về video không có âm thanh" trong Flow rồi tạo lại…`, 'warn');
      const set = await flowMessage({ type: 'THEKEY_FLOW_SILENT_FALLBACK', on: true }, signal).catch(problem => ({ ok: false, error: problem.message }));
      if (!set?.ok) throw Object.assign(new Error(`${error.message} (Không tự bật được "Trả về video không có âm thanh": ${set?.error || 'không rõ lý do'}. Hãy bật trong Cài đặt của Flow rồi tạo lại.)`), { code: 'AUDIO_FAILED' });
      await generateClip(clip, signal);
      clip.error = [clip.error, 'Flow trả video không tiếng; khi ghép sẽ dùng âm thanh của video gốc.'].filter(Boolean).join(' ');
    }
  }
  async function generate(clips) {
    if (state.running) return;
    if (!state.project.chars.length) { status('Hãy thêm ít nhất một ảnh nhân vật trước.', 'warn'); return; }
    const todo = clips.filter(clip => clip.status !== 'skipped');
    if (!todo.length) { status('Không còn đoạn nào cần tạo.', 'ok'); return; }
    state.running = true; state.abort = new AbortController(); const signal = state.abort.signal; setBusy(true);
    let done = 0, failed = 0;
    try {
      for (const [index, clip] of todo.entries()) {
        if (index > 0 && Number(state.project.settings.pace) > 0) { status(`Nghỉ ${state.project.settings.pace} giây trước đoạn kế tiếp…`, 'warn'); await sleep(Number(state.project.settings.pace) * 1000, signal); }
        status(`Đang tạo đoạn ${clip.index + 1} (${index + 1}/${todo.length}) trên Flow…`, 'warn');
        try { await generateWithFallback(clip, signal); done++; }
        catch (error) {
          if (error?.name === 'AbortError' || signal.aborted) throw error;
          clip.status = 'error'; clip.error = error.message; failed++;
          // Google's "unusual activity" notice or no credits: stop instead of sending more.
          if (['FLOW_BLOCKED', 'NO_CREDITS', 'FLOW_NOT_READY', 'DUPLICATE_RESULT'].includes(error.code)) { status(error.message, 'error'); break; }
          // Flow refused the content (for example a real or well-known person): the other clips use the same video
          // and pictures, so stop instead of sending them all to be refused too.
          if (error.code === 'SCENE_REFUSED') { status(`Flow từ chối nội dung đoạn ${clip.index + 1}, nên Motion Studio dừng các đoạn còn lại. Hãy dùng video bạn tự quay và ảnh nhân vật do AI tạo, rồi bấm tạo lại. (${error.message.slice(0, 200)})`, 'error'); break; }
        } finally { renderClips(); await saveNow(); }
      }
      if (!signal.aborted) status(failed ? `Xong ${done} đoạn, ${failed} đoạn lỗi. Bấm vào đoạn lỗi để xem và tạo lại.` : `Đã tạo xong ${done} đoạn. Bấm "Ghép video" để ra video hoàn chỉnh.`, failed ? 'warn' : 'ok');
    } catch (error) {
      const active = state.project.clips.find(clip => clip.status === 'running'); if (active) { active.status = 'idle'; active.error = 'Đã dừng.'; }
      status('Đã dừng.', 'warn');
    } finally { state.running = false; state.abort = null; setBusy(false); renderAll(); saveSoon(); }
  }
  async function stop() {
    if (!state.running) return;
    state.abort?.abort();
    const tab = await flowTab(); if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'THEKEY_FLOW_STOP_GENERATION', requestId: state.requestId }).catch(() => {});
  }

  // ---------- merge ----------
  async function merge({ originalAudio = false } = {}) {
    const clips = state.project.clips.filter(clip => clip.status !== 'skipped');
    const missing = clips.filter(clip => !clip.result);
    if (!clips.length) return;
    if (missing.length) { status(`Còn ${missing.length} đoạn chưa có kết quả Flow (${missing.map(clip => clip.index + 1).join(', ')}). Tạo xong hoặc bấm "Bỏ qua đoạn" trước khi ghép.`, 'warn'); return; }
    setBusy(true);
    try {
      const ff = await ffmpeg(), mode = originalAudio ? 'original' : state.project.settings.audioMode || (state.project.settings.keepAudio ? 'original' : 'auto');
      const inputs = [], info = [];
      for (const [index, clip] of clips.entries()) {
        status(`Đang nạp đoạn ${index + 1}/${clips.length} vào FFmpeg…`, 'warn');
        const result = await getBlob(`result:${clip.id}`); const path = `/r${index}.mp4`;
        await ff.writeFile(path, new Uint8Array(await result.arrayBuffer())); inputs.push(path);
        // Sound of each clip: the source clip's when asked for, or when Flow's result came back without sound.
        const resultAudio = await hasAudio(ff, path);
        const useSource = mode === 'original' || (mode === 'auto' && !resultAudio);
        let audioFrom = path, audio = resultAudio;
        if (useSource) { audioFrom = `/s${index}.mp4`; const source = await getBlob(`clip:${clip.id}`); await ff.writeFile(audioFrom, new Uint8Array(await source.arrayBuffer())); audio = await hasAudio(ff, audioFrom); }
        info.push({ duration: clip.end - clip.start, audioPath: audioFrom, audio, separate: useSource });
      }
      const first = await videoMeta(state.resultUrls.get(clips[0].id) || await clipUrl(clips[0], 'result'));
      const scale = Math.min(1, 1920 / Math.max(first.width || 1280, first.height || 720));
      const width = Math.max(2, Math.floor((first.width || 720) * scale / 2) * 2), height = Math.max(2, Math.floor((first.height || 1280) * scale / 2) * 2);
      const args = [], filters = [], labels = [];
      inputs.forEach(path => args.push('-i', path));
      const audioInputs = new Map(); let next = inputs.length;
      info.forEach((item, index) => { if (item.separate && item.audio) { args.push('-i', item.audioPath); audioInputs.set(index, next++); } });
      const silentIndex = next; await ff.writeFile('/silence.wav', silentWav(12)); args.push('-stream_loop', '-1', '-i', '/silence.wav');
      info.forEach((item, index) => {
        const d = item.duration.toFixed(3);
        filters.push(`[${index}:v:0]trim=duration=${d},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=24,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d}[v${index}]`);
        const audio = !item.audio ? `${silentIndex}:a:0` : item.separate ? `${audioInputs.get(index)}:a:0` : `${index}:a:0`;
        filters.push(`[${audio}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad=pad_dur=${d},atrim=duration=${d}[a${index}]`);
        labels.push(`[v${index}][a${index}]`);
      });
      filters.push(`${labels.join('')}concat=n=${info.length}:v=1:a=1[outv][outa]`);
      args.push('-filter_complex', filters.join(';'), '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', '/final.mp4');
      status('FFmpeg đang ghép các đoạn thành video hoàn chỉnh…', 'warn');
      await run(ff, args);
      const data = await ff.readFile('/final.mp4');
      for (const path of new Set([...inputs, ...info.map(item => item.audioPath), '/final.mp4', '/silence.wav'])) await ff.deleteFile(path).catch(() => {});
      const finalBlob = new Blob([data], { type: 'video/mp4' });
      await clearFinal(); await putBlob('final', finalBlob);
      state.finalUrl = URL.createObjectURL(finalBlob);
      state.project.final = { size: finalBlob.size, duration: info.reduce((sum, item) => sum + item.duration, 0), at: Date.now() };
      state.project.final.audio = mode;
      await saveNow(); status(originalAudio ? 'Đã làm lại âm thanh: video hoàn chỉnh giờ dùng âm thanh của video gốc.' : 'Đã ghép xong video hoàn chỉnh. Bấm "Tải video" để lưu về máy.', 'ok');
    } catch (error) { status(`Ghép video thất bại: ${error.message}`, 'error'); }
    finally { setBusy(false); renderAll(); }
  }
  async function download(url, name) {
    if (!url) return;
    try { await chrome.downloads.download({ url, filename: name, saveAs: false }); }
    catch { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
  }

  // ---------- rendering ----------
  function setBusy(busy) {
    $('#msGenerate').disabled = busy || !state.project.clips.length;
    $('#msStop').classList.toggle('hidden', !state.running);
    for (const id of ['#msSplit', '#msMerge', '#msRedoAudio', '#msSourcePick', '#msClear', '#msTranscribeAll']) $(id).disabled = busy;
    if (!busy) renderButtons();
  }
  function renderButtons() {
    const project = state.project, clips = project.clips;
    $('#msSplit').disabled = state.running || !project.source;
    const left = clips.filter(clip => !clip.result && clip.status !== 'skipped').length;
    $('#msGenerate').disabled = state.running || !left;
    $('#msGenerate').lastChild.textContent = !clips.length || left === clips.length ? 'Tạo tất cả đoạn' : left ? `Tạo tiếp ${left} đoạn chưa xong` : 'Đã tạo hết các đoạn';
    $('#msMerge').disabled = state.running || !clips.some(clip => clip.result);
    $('#msDownload').disabled = !state.finalUrl;
    $('#msRedoAudio').disabled = state.running || !clips.some(clip => clip.result);
    $('#stepSource').classList.toggle('on', Boolean(project.source));
    $('#stepGenerate').classList.toggle('on', clips.some(clip => clip.result));
    $('#stepExport').classList.toggle('on', Boolean(project.final));
  }
  function renderSettings() {
    const settings = state.project.settings;
    $('#msAspect').value = settings.aspect; $('#msResolution').value = settings.resolution; $('#msModel').value = settings.model; $('#msClipLen').value = String(settings.clipLen);
    $('#msSpeechAgent').value = settings.speechAgent || 'gemini-web';
    $('#msSync').checked = Boolean(settings.sync); $('#msVoiceDesc').value = settings.voiceDesc || ''; $('#msFlowVoice').value = settings.flowVoice || '';
    $('#msSubtitles').checked = Boolean(settings.subtitles); $('#msTranslate').value = settings.translate || ''; $('#msVoiceBox').classList.toggle('hidden', !settings.sync);
    $('#msPrompt').value = settings.prompt; $('#msAudioMode').value = settings.audioMode || 'auto'; $('#msSilentFallback').checked = settings.silentFallback !== false; $('#msPace').value = String(settings.pace);
  }
  function renderSource() {
    const source = state.project.source, video = $('#msSourceVideo');
    $('#msSourceDrop').classList.toggle('hidden', Boolean(source && state.sourceUrl));
    video.classList.toggle('hidden', !(source && state.sourceUrl));
    if (state.sourceUrl && video.getAttribute('src') !== state.sourceUrl) video.src = state.sourceUrl;
    $('#msSourceInfo').textContent = source ? `${source.name} · ${fmt(source.duration)}${source.width ? ` · ${source.width}×${source.height}` : ''}` : '';
  }
  function renderFinal() {
    const video = $('#msFinalVideo');
    $('#msFinalEmpty').classList.toggle('hidden', Boolean(state.finalUrl));
    video.classList.toggle('hidden', !state.finalUrl);
    if (state.finalUrl && video.getAttribute('src') !== state.finalUrl) video.src = state.finalUrl;
    const final = state.project.final;
    $('#msFinalInfo').textContent = final ? `${fmt(final.duration)} · ${(final.size / 1048576).toFixed(1)} MB` : '';
  }
  function renderChars() {
    const box = $('#msChars'); box.innerHTML = '';
    for (const char of state.project.chars) {
      const card = document.createElement('div'); card.className = 'ms-char';
      const img = document.createElement('img'); img.src = char.dataUrl; img.alt = '';
      const name = document.createElement('span'); name.textContent = char.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Bỏ ảnh này';
      remove.onclick = () => { state.project.chars = state.project.chars.filter(item => item.id !== char.id); saveSoon(); renderChars(); };
      card.append(img, name, remove); box.appendChild(card);
    }
    $('#msCharDrop').classList.toggle('hidden', state.project.chars.length >= 1);
  }
  const STATUS_VI = { idle: 'Chưa tạo', running: 'Đang tạo trên Flow…', success: 'Xong', error: 'Lỗi', skipped: 'Bỏ qua khi ghép' };
  function renderClips() {
    const box = $('#msClips'), clips = state.project.clips;
    $('#msClipCount').textContent = clips.length ? `${clips.length} đoạn · ${clips.filter(clip => clip.result).length} đã có kết quả` : '';
    if (!clips.length) { box.innerHTML = '<p class="ms-hint">Bấm "Cắt thành đoạn" để chia video gốc theo độ dài đã chọn.</p>'; return; }
    box.innerHTML = '';
    for (const clip of clips) {
      const card = document.createElement('button'); card.type = 'button'; card.className = `ms-clip ${clip.status}`; card.dataset.clip = clip.id;
      const thumbs = document.createElement('div'); thumbs.className = 'thumbs';
      for (const src of [clip.thumb, clip.resultThumb].filter(Boolean)) { const img = document.createElement('img'); img.src = src; img.alt = ''; thumbs.appendChild(img); }
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.innerHTML = `<b>Đoạn ${clip.index + 1}</b><span>${fmt(clip.start)} – ${fmt(clip.end)}</span><span class="st"></span>`;
      meta.querySelector('.st').textContent = STATUS_VI[clip.status] || clip.status;
      if (clip.transcript) { const talk = document.createElement('span'); talk.className = 'talk'; talk.textContent = clip.transcript.has_speech ? `Lời thoại: ${clip.transcript.text.slice(0, 40)}${clip.transcript.text.length > 40 ? '…' : ''}` : 'Không có lời thoại'; meta.appendChild(talk); }
      if (clip.error) card.title = clip.error;
      card.append(thumbs, meta); card.onclick = () => openClip(clip.id); box.appendChild(card);
    }
  }
  function renderAll() { renderSettings(); renderSource(); renderChars(); renderClips(); renderFinal(); renderButtons(); }

  let modalClip = null;
  async function openClip(id) {
    const clip = state.project.clips.find(item => item.id === id); if (!clip) return;
    modalClip = clip;
    $('#msModalTitle').textContent = `Đoạn ${clip.index + 1}`;
    $('#msModalInfo').textContent = `${fmt(clip.start)} – ${fmt(clip.end)} · ${STATUS_VI[clip.status] || clip.status}`;
    $('#msModalSource').src = await clipUrl(clip, 'clip');
    const result = clip.result ? await clipUrl(clip, 'result') : '';
    $('#msModalResult').classList.toggle('hidden', !result); $('#msModalNoResult').classList.toggle('hidden', Boolean(result));
    if (result) $('#msModalResult').src = result; else $('#msModalResult').removeAttribute('src');
    $('#msModalError').textContent = clip.status === 'error' || clip.error ? clip.error : '';
    $('#msModalTranscript').value = clip.transcript?.text || ''; $('#msModalTranslation').value = clip.transcript?.translation || '';
    $('#msModalTranscribe').disabled = state.running;
    $('#msModalRegen').disabled = state.running;
    $('#msModalRegen').lastChild.textContent = clip.result ? 'Tạo lại đoạn này' : 'Tạo đoạn này';
    $('#msModalSkip').textContent = clip.status === 'skipped' ? 'Dùng lại khi ghép' : 'Bỏ qua khi ghép';
    $('#msModalDownload').disabled = !result;
    $('#msModal').classList.remove('hidden');
  }
  function closeModal() { for (const id of ['#msModalSource', '#msModalResult']) $(id).pause(); $('#msModal').classList.add('hidden'); modalClip = null; }

  // ---------- events ----------
  function dropZone(el, onFiles) {
    el.addEventListener('dragover', event => { event.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', event => { event.preventDefault(); el.classList.remove('over'); onFiles(event.dataTransfer.files); });
  }
  function wire() {
    $('#msSourceInput').onchange = event => { loadSource(event.target.files[0]); event.target.value = ''; };
    $('#msSourcePick').onclick = () => $('#msSourceInput').click();
    dropZone($('#msSourceDrop'), files => loadSource(files[0]));
    dropZone($('#msSourceBox'), files => loadSource(files[0]));
    $('#msCharInput').onchange = event => { addChars(event.target.files); event.target.value = ''; };
    dropZone($('#msCharDrop'), addChars);
    $('#msSplit').onclick = splitSource;
    $('#msGenerate').onclick = () => generate(state.project.clips.filter(clip => !clip.result));
    $('#msStop').onclick = stop;
    $('#msMerge').onclick = () => merge();
    $('#msRedoAudio').onclick = () => merge({ originalAudio: true });
    $('#msDownload').onclick = () => download(state.finalUrl, `motion-studio-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4`);
    $('#msClear').onclick = async () => {
      if (!confirm('Xoá video gốc, các đoạn và kết quả của dự án Motion Studio này? (Video trong dự án Flow vẫn còn.)')) return;
      await clearClips(); await delBlob('source').catch(() => {});
      if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl); state.sourceUrl = '';
      const settings = state.project.settings; state.project = newProject(); state.project.settings = settings;
      saveSoon(); renderAll(); status('Đã làm mới dự án.', 'ok');
    };
    const bind = (id, key, parse = value => value) => { $(id).onchange = () => { state.project.settings[key] = parse($(id).type === 'checkbox' ? $(id).checked : $(id).value); saveSoon(); }; };
    bind('#msAspect', 'aspect'); bind('#msResolution', 'resolution'); bind('#msModel', 'model'); bind('#msClipLen', 'clipLen', Number); bind('#msAudioMode', 'audioMode'); bind('#msSilentFallback', 'silentFallback', Boolean); bind('#msPace', 'pace', Number);
    bind('#msSpeechAgent', 'speechAgent');
    bind('#msSync', 'sync', Boolean); bind('#msSubtitles', 'subtitles', Boolean); bind('#msTranslate', 'translate');
    $('#msSync').addEventListener('change', () => $('#msVoiceBox').classList.toggle('hidden', !$('#msSync').checked));
    for (const [id, key] of [['#msVoiceDesc', 'voiceDesc'], ['#msFlowVoice', 'flowVoice']]) $(id).oninput = () => { state.project.settings[key] = $(id).value; saveSoon(); };
    $('#msTranscribeAll').onclick = transcribeAll;
    $('#msModalTranscribe').onclick = async () => {
      const clip = modalClip; if (!clip || state.running) return;
      $('#msModalTranscribe').disabled = true;
      try { const t = await transcribe(clip); $('#msModalTranscript').value = t.text; $('#msModalTranslation').value = t.translation; $('#msModalError').textContent = t.has_speech ? '' : 'Gemini không nghe thấy lời thoại trong đoạn này.'; renderClips(); }
      catch (error) { $('#msModalError').textContent = error.message; }
      finally { $('#msModalTranscribe').disabled = false; }
    };
    $('#msModalSaveDialogue').onclick = () => {
      const clip = modalClip; if (!clip) return;
      const text = $('#msModalTranscript').value.trim(), translation = $('#msModalTranslation').value.trim();
      clip.transcript = { has_speech: Boolean(text), language: clip.transcript?.language || '', text, translation, target: state.project.settings.translate || '', manual: true };
      saveSoon(); renderClips(); $('#msModalError').textContent = 'Đã lưu lời thoại cho đoạn này.';
    };
    $('#msPrompt').oninput = () => { state.project.settings.prompt = $('#msPrompt').value; saveSoon(); };
    $('#msPromptReset').onclick = () => { state.project.settings.prompt = DEFAULT_PROMPT; $('#msPrompt').value = DEFAULT_PROMPT; saveSoon(); };
    $('#msModalClose').onclick = closeModal;
    $('#msModal').onclick = event => { if (event.target === $('#msModal')) closeModal(); };
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && modalClip) closeModal(); });
    $('#msModalRegen').onclick = () => { const clip = modalClip; closeModal(); if (clip.status === 'skipped') clip.status = 'idle'; generate([clip]); };
    $('#msModalSkip').onclick = () => { const clip = modalClip; clip.status = clip.status === 'skipped' ? (clip.result ? 'success' : 'idle') : 'skipped'; saveSoon(); renderClips(); renderButtons(); closeModal(); };
    $('#msModalDownload').onclick = async () => { const clip = modalClip; download(await clipUrl(clip, 'result'), `motion-doan-${clip.index + 1}.mp4`); };
  }

  async function init() {
    $('#msVersion').textContent = chrome.runtime.getManifest().version;
    try { state.project = await idb('meta', 'readonly', store => store.get('project')) || newProject(); } catch { state.project = newProject(); }
    state.project.settings = { ...newProject().settings, ...(state.project.settings || {}) };
    // Only Omni takes the source clip as an ingredient; Veo ignores it (1.8.3 offered Veo here by mistake).
    state.project.settings.model = 'Omni 1.1 Flash';
    if (OLD_PROMPTS.includes(state.project.settings.prompt)) state.project.settings.prompt = DEFAULT_PROMPT;
    // 1.9 "Giữ âm thanh của video gốc" becomes the "original" sound mode (once).
    if (state.project.settings.keepAudio) { state.project.settings.audioMode = 'original'; state.project.settings.keepAudio = false; }
    if (state.project.chars.length > 1) state.project.chars = state.project.chars.slice(0, 1);
    // A clip left "running" by a closed page never finished.
    for (const clip of state.project.clips) if (clip.status === 'running') { clip.status = clip.result ? 'success' : 'idle'; clip.error = 'Lần tạo trước bị ngắt.'; }
    const source = state.project.source ? await getBlob('source').catch(() => null) : null;
    if (source) state.sourceUrl = URL.createObjectURL(source); else state.project.source = null;
    const final = state.project.final ? await getBlob('final').catch(() => null) : null;
    if (final) state.finalUrl = URL.createObjectURL(final); else state.project.final = null;
    wire(); renderAll();
    status(state.project.clips.length ? `Đã mở lại dự án: ${state.project.clips.length} đoạn.` : state.project.source ? 'Bấm "Cắt thành đoạn" để chia video gốc.' : 'Bắt đầu bằng việc chọn video gốc.', 'ok');
    checkFlow(); setInterval(() => { if (!state.running) checkFlow(); }, 20000);
    window.__cosAlphaMotion = { state, plan, generate, merge, splitSource, loadSource, addChars };
  }
  init();
})();
