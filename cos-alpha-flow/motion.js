// Motion Studio: replace the person in a source video with your character, clip by clip, on Google Flow.
// The source video is cut into short clips (FFmpeg, on this computer); each clip goes to Flow in
// Video · Thành phần (ingredients) mode together with the character pictures; the results are merged back.
(() => {
  const $ = selector => document.querySelector(selector);
  const FLOW_TAB_URLS = ['https://flow.google.com/*', 'https://labs.google/fx/*'];
  const DURATIONS = [4, 6, 8, 10];
  // Written like TobyFlow's request (character = "image 1", the clip is the motion reference), not as "replace the person".
  // Image 1 = who; the reference video = only how they move. The sound line is added per clip (see composePrompt).
  // The prompt keeps the scene, the objects and the hand actions of the source clip; only the person changes.
  // {{scene}} is where each clip's own notes go (scene, objects, camera cuts and the action timeline).
  const DEFAULT_PROMPT = [
    'Image 1 is the character. Recreate the reference video shot for shot (same length, cuts, camera, room, lighting and objects) with the character from image 1 as the only person in it. Only the person changes.',
    'Copy the action beat by beat, at the same moments and speed: steps, body position, gestures, head turns, gaze and expressions, and exactly how the hands grip, lift, cut, open, unwrap, turn, show and put down each object.',
    '{{scene}}',
    'Real-world physics in every frame: each object keeps the same shape, size, colour and number of parts; nothing appears, disappears, melts, bends, merges or duplicates. Hands hold objects from the outside with five fingers and never pass through them, the box or each other. Objects move only when the hands move them, fall with gravity and stay where they are put; anything taken out stays visible (in a hand, on the box or on the floor) until it leaves the frame. Plastic wrap crumples and falls naturally.',
    'Keep exactly as in the reference video: background, furniture and their positions, every object and product with the same printing and logos, lighting, colours, framing and camera moves.',
    'The character keeps the face, hairstyle, skin tone, body shape and outfit from image 1 in every frame; nothing of the appearance of the person in the reference video carries over. Same realism and image quality as the reference video.',
    'Avoid: morphing or flickering objects, objects popping in or out, hands going through objects, extra or missing fingers, floating objects, extra people or hands, skipped or extra actions, on-screen text, watermark.'
  ].join('\n\n');
  const PROMPT_1131 = [
    'Image 1 is the character. The reference video is the scene and the action to recreate. Recreate the reference video shot for shot, with the same length, cuts and timing, with the character from image 1 as the only person in it.',
    'Copy the action second by second: every step, body position, gesture, head turn, gaze, facial expression and mouth movement happens at the same moment and speed as in the reference video. The hands hold, lift, cut, open, unwrap, pull, turn, show, put down and use each object exactly where, when and how the reference video shows it. Every object changes state (taped, opened, in its bag, unwrapped, held, put aside) at the same moment as in the reference video, and nothing moves unless the hands move it.',
    '{{scene}}',
    'Keep exactly as in the reference video: the room and background, every piece of furniture and decoration in the same place, every object and product with the same shape, colours, size, printing and logos, the lighting and colours, and the camera position, framing, zoom, camera moves and cuts.',
    'The character keeps the face, hairstyle, skin tone, body shape and outfit from image 1 in every frame; nothing of the appearance of the person in the reference video (face, hair, clothes) carries over. Match the realism and image quality of the reference video.',
    'No extra people or hands, no added, missing or changed objects, no skipped or extra actions, no on-screen text or watermark.'
  ].join('\n\n');
  const PROMPT_113 = [
    'Image 1 is the character. The reference video is the scene and the action to recreate. Recreate the reference video shot for shot with the character from image 1 as the only person in it.',
    'Keep exactly as in the reference video: the room and background, every piece of furniture and decoration in the same place, every object and product with the same shape, colours, size, printing and logos, the lighting and colours, and the camera position, framing, zoom and camera moves.',
    'Same action at the same moment: every step, gesture, head turn, facial expression and mouth movement; the hands hold, lift, open, turn, place and use each object exactly where, when and how it happens in the reference video, and objects move only when the hands move them.',
    'The character keeps the face, hairstyle, skin tone, body shape and outfit from image 1 in every frame; nothing of the appearance of the person in the reference video (face, hair, clothes) carries over. Match the realism and image quality of the reference video.',
    'No extra people or hands, no added, missing or changed objects, no on-screen text or watermark.'
  ].join('\n\n');
  const OLD_PROMPTS = [PROMPT_1131, PROMPT_113, 'Image 1 is the character. The reference video is only a guide for motion and timing. Recreate the reference video shot for shot with the character from image 1 as the only person in it: the same body movement, gestures, head turns, facial expressions and mouth movement, the same timing and rhythm, the same camera position, framing and camera moves, the same room, props and lighting. In every frame the character keeps the face, hairstyle, body shape and outfit from image 1; nothing of the appearance of the person in the reference video (face, hair, clothes) carries over. Natural, realistic motion, no extra people, no on-screen text.', 'Animate the character in image 1 so that they perform exactly the same movement as in the reference video: the same body motion, gestures, facial expressions and lip movement, the same timing, the same camera movement and framing, the same location and lighting. The character keeps their own face, hairstyle and outfit from image 1 in every frame. Keep the sound of the reference video.', 'Replace the person in the attached video with the character from the attached reference image(s). Keep exactly the same motion, body movement, gestures, facial expressions, lip movement and timing, and the same camera movement, framing, lighting and background as the video. The character must look exactly like the reference (same face, hair and outfit). Do not add or remove people or objects. Keep the original speech and sound.'];
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
    return { source: null, chars: [], bgs: [], clips: [], final: null, settings: { aspect: '9:16', resolution: '720p', model: 'Omni 1.1 Flash', clipLen: 8, prompt: DEFAULT_PROMPT, keepAudio: false, audioMode: 'auto', silentFallback: true, pace: 5, parallel: 2, sceneAI: true, reviewNotes: false, continuity: false, voiceMode: 'character', sync: false, voiceDesc: '', flowVoice: '', subtitles: false, translate: '', speechAgent: 'gemini-web' } };
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
  function frameAt(url, time, size = 320) {
    return new Promise(resolve => {
      const video = document.createElement('video'); video.preload = 'auto'; video.muted = true; video.playsInline = true;
      const timer = setTimeout(() => resolve(''), 15000);
      video.onloadedmetadata = () => { video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05)); };
      video.onseeked = () => {
        try {
          const scale = Math.min(1, size / Math.max(video.videoWidth, video.videoHeight)), canvas = document.createElement('canvas');
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
  async function loadSource(file, { force = false } = {}) {
    if (!file || !/^video\//.test(file.type)) { status('Hãy chọn một file video (MP4/MOV/WebM).', 'warn'); return; }
    if (file.size > 500 * 1024 * 1024) { status('Video lớn hơn 500 MB. Hãy cắt ngắn trước (vài chục giây là hợp lý).', 'warn'); return; }
    if (!force && state.project.clips.some(clip => clip.result) && !confirm('Thay video gốc sẽ xoá các đoạn và kết quả hiện có. Tiếp tục?')) return false;
    await clearClips();
    await putBlob('source', file);
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    const url = state.sourceUrl = URL.createObjectURL(file);
    const meta = await videoMeta(url);
    if (!meta.duration) { status('Trình duyệt không mở được video này. Hãy dùng MP4 (H.264) hoặc WebM.', 'error'); return false; }
    state.project.source = { name: file.name, type: file.type, size: file.size, ...meta };
    if (meta.width && meta.height) state.project.settings.aspect = meta.width >= meta.height ? '16:9' : '9:16';
    saveSoon(); renderAll();
    status(`Đã nạp ${file.name} (${fmt(meta.duration)}). Chọn độ dài đoạn rồi bấm "Cắt thành đoạn".`, 'ok');
    return true;
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

  // A picture of the place (like TobyFlow's background reference): the clip happens there instead of the source room.
  async function addBgs(files) {
    if (state.project.bgs.length >= 1) { status('Chỉ dùng 1 ảnh bối cảnh. Xoá ảnh hiện tại trước khi thêm ảnh khác.', 'warn'); return; }
    const file = [...files].find(item => /^image\//.test(item.type)); if (!file) return;
    try { state.project.bgs.push({ id: uid('bg'), name: file.name, dataUrl: await shrinkImage(file) }); }
    catch (error) { status(error.message, 'error'); }
    saveSoon(); renderBgs();
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
  async function splitSource({ force = false } = {}) {
    const source = state.project.source; if (!source) return false;
    if (!force && state.project.clips.some(clip => clip.result) && !confirm('Cắt lại sẽ xoá các kết quả Flow hiện có. Tiếp tục?')) return false;
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
        clip.thumbEnd = await frameAt(state.clipUrls.get(clip.id), Math.max(0.1, end - start - 0.1));
        state.project.clips.push(clip); renderClips();
      }
      await ff.deleteFile('/source').catch(() => {});
      await saveNow();
      status(`Đã cắt thành ${cuts.length} đoạn. Thêm ảnh nhân vật rồi bấm "Tạo tất cả đoạn".`, 'ok');
      return true;
    } catch (error) { status(`Cắt video thất bại: ${error.message}`, 'error'); return false; }
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
  // ---------- what must stay the same (scene, objects, camera, actions) ----------
  // ChatGPT / Gemini looks at four frames of the clip and writes down the place, the objects, the camera and a
  // timeline of what the hands do. It never describes the person, so nothing of their looks reaches the prompt.
  const SCENE_SYSTEM = 'You help remake a short video clip with a different actor while everything else stays exactly the same. The image is a grid of frames from one clip in time order (left to right, then the next row), each labelled with its time in seconds. Describe only what has to stay the same. Never describe the person\'s face, hair, skin, body or clothes and never guess who they are: call them "the person". Return JSON only: {"setting": "one sentence: the place, its layout, the main furniture and the lighting", "objects": ["up to 10 short items: each object or product the person touches or that stands out, with its colour, printing or logo, where it is and its state at the start (closed, taped, in a plastic bag, wrapped)"], "camera": "shot size, angle and movement of each shot, with the time of every cut, e.g. wide shot 0.0-0.6 s, cut to a static medium shot of the box 0.6-8.0 s", "actions": [{"start": seconds, "end": seconds, "text": "one beat of about one second: where the person stands and looks, which hand does what to which object, how the object changes (cut, opened, pulled out, unwrapped, bag pulled off, turned, put down) and where it ends up"}], "end_state": ["where each object the person moved is at the end of the clip, e.g. blue plastic bag: dropped on the floor right of the box"]}. 4 to 10 beats in time order covering the whole clip without gaps, times from the start of the clip; describe only what you see, never invent steps. English, short and concrete.';
  async function clipFrameGrid(clip) {
    const url = await clipUrl(clip, 'clip'), length = Math.max(0.4, clip.end - clip.start);
    // 8 frames (4 per row) spread over the clip, so short beats and cuts show up.
    const count = length >= 3 ? 8 : 4, cols = 4, step = length / count;
    const times = Array.from({ length: count }, (_, index) => Math.min(length - 0.05, step * (index + 0.5)));
    const frames = [];
    for (const time of times) frames.push({ time, src: await frameAt(url, time, 400) });
    const images = await Promise.all(frames.map(frame => new Promise(resolve => { if (!frame.src) return resolve(null); const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = frame.src; })));
    const first = images.find(Boolean); if (!first) throw new Error('Không lấy được khung hình của đoạn này.');
    const w = first.naturalWidth, h = first.naturalHeight, canvas = document.createElement('canvas');
    const rows = Math.ceil(frames.length / cols);
    canvas.width = w * cols; canvas.height = h * rows;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((img, index) => {
      const x = (index % cols) * w, y = Math.floor(index / cols) * h;
      if (img) ctx.drawImage(img, x, y, w, h);
      const label = `${frames[index].time.toFixed(1)} s`; ctx.font = `bold ${Math.round(h / 16)}px sans-serif`;
      const pad = Math.round(h / 60), tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(x + pad, y + pad, tw + pad * 2, Math.round(h / 16) + pad * 2);
      ctx.fillStyle = '#fff'; ctx.fillText(label, x + pad * 2, y + pad + Math.round(h / 16));
    });
    return canvas.toDataURL('image/jpeg', 0.85);
  }
  // What is still missing in the AI's notes for a clip of this length (empty = good enough).
  function sceneProblems(scene, length) {
    const problems = [], actions = scene.actions || [];
    const want = Math.min(4, Math.max(2, Math.round(length / 2)));
    if (actions.length < want) problems.push(`there are only ${actions.length} beats; give 4 to 10 beats of about one second each`);
    const last = actions.reduce((max, item) => Math.max(max, item.end), 0);
    if (actions.length && last < length - 1) problems.push(`the timeline stops at ${last.toFixed(1)} s but the clip is ${length.toFixed(1)} s long; cover it to the end`);
    if (actions.length && actions[0].start > 1) problems.push(`the timeline starts at ${actions[0].start.toFixed(1)} s; start at 0 s`);
    if (actions.some((item, index) => index && item.start - actions[index - 1].end > 1.2)) problems.push('there are gaps between beats; leave no gaps');
    if (!(scene.objects || []).length) problems.push('list the objects the person touches or that stand out');
    if (!scene.camera) problems.push('describe the camera and the time of every cut');
    return problems;
  }
  function readScene(data, agent) {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    return {
      setting: clean(data.setting), camera: clean(data.camera),
      objects: (Array.isArray(data.objects) ? data.objects : []).map(clean).filter(Boolean).slice(0, 10),
      actions: (Array.isArray(data.actions) ? data.actions : []).map(item => ({ start: Math.max(0, Number(item.start) || 0), end: Math.max(0, Number(item.end) || 0), text: clean(item.text) })).filter(item => item.text).sort((a, b) => a.start - b.start).slice(0, 12),
      endState: (Array.isArray(data.end_state) ? data.end_state : []).map(clean).filter(Boolean).slice(0, 10),
      agent
    };
  }
  async function askScene(agent, grid, user, clip, signal) {
    if (agent === 'gemini-api') {
      if (!window.CosAlphaAI?.text) throw new Error('Chưa tải được phần Gemini của app. Hãy tải lại trang Motion Studio.');
      return (await window.CosAlphaAI.text({ system: SCENE_SYSTEM, user, images: [grid], json: true, temperature: 0.2, signal })).text;
    }
    return chatWebAsk(agent, `${SCENE_SYSTEM}\n\n${user} Look at the attached image. Reply with the JSON object only.`, [{ dataUrl: grid, name: `motion-canh-${clip.index + 1}.jpg`, type: 'image/jpeg' }], signal);
  }
  // Motion Studio → ChatGPT / Gemini → back: the answer is checked (whole clip covered, enough beats, objects and
  // camera); if something is missing the AI is asked once more with exactly what to fix. If the chosen web assistant
  // does not answer at all, the other one is tried once. The best answer is kept, with what is still missing.
  async function analyzeScene(clip, signal) {
    const grid = await clipFrameGrid(clip);
    const length = Math.max(0.4, clip.end - clip.start);
    const user = `Frames of a ${length.toFixed(1)}-second clip.`;
    const chosen = state.project.settings.speechAgent || 'gemini-web';
    const agents = chosen === 'gemini-api' ? [chosen] : [chosen, chosen === 'chatgpt' ? 'gemini-web' : 'chatgpt'];
    let best = null, lastError = null;
    for (const agent of agents) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) throw new DOMException('Đã dừng.', 'AbortError');
        const fix = attempt && best ? ` Your previous answer for this clip had problems: ${best.problems.join('; ')}. Look at the frames again and answer again with the corrected, complete JSON.` : '';
        let scene;
        try { scene = readScene(parseJsonReply(await askScene(agent, grid, user + fix, clip, signal)), agent); }
        catch (error) {
          if (error?.name === 'AbortError') throw error;
          lastError = error;
          if (/đăng nhập|gắn vào tab|không trả lời|login/i.test(error.message)) break;
          continue;
        }
        const problems = sceneProblems(scene, length);
        if (!best || problems.length < best.problems.length) best = { scene, problems };
        if (!problems.length) break;
        status(`${AGENT_NAME[agent] || agent} ghi đoạn ${clip.index + 1} còn thiếu (${problems[0]}); hỏi lại một lần…`, 'warn');
      }
      if (best) break;
      if (agents.length > 1 && agent === chosen) status(`${AGENT_NAME[agent] || agent} không trả lời được (${(lastError?.message || '').slice(0, 120)}); thử ${AGENT_NAME[agents[1]]}…`, 'warn');
    }
    if (!best) throw lastError || new Error('Trợ lý AI không trả lời được.');
    clip.scene = { ...best.scene, missing: best.problems };
    saveSoon();
    return clip.scene;
  }
  function sceneText(scene, { newPlace = false } = {}) {
    if (!scene) return '';
    if (scene.manual) return String(scene.text || '').trim();
    const lines = [];
    if (scene.setting && !newPlace) lines.push(`Scene (keep exactly): ${scene.setting.replace(/\.$/, '')}.`);
    if (scene.objects?.length) lines.push(`Objects (keep exactly, same look, place and starting state): ${scene.objects.map(item => item.replace(/\.$/, '')).join('; ')}.`);
    if (scene.camera) lines.push(`Camera and cuts (keep, same times): ${scene.camera.replace(/\.$/, '')}.`);
    if (scene.actions?.length) lines.push(`Action timeline, follow it beat by beat (seconds from the start of the clip): ${scene.actions.map(item => `${item.start.toFixed(1)}–${item.end.toFixed(1)} s: ${item.text.replace(/\.$/, '')}`).join('; ')}.`);
    if (scene.endState?.length) lines.push(`Where things are at the end (they stay there once put down): ${scene.endState.map(item => item.replace(/\.$/, '')).join('; ')}.`);
    return lines.join('\n');
  }
  async function ensureScene(clip, signal) {
    if (!state.project.settings.sceneAI || clip.scene) return clip.scene || null;
    status(`${AGENT_NAME[state.project.settings.speechAgent] || 'Gemini'} đang ghi lại hành động, đồ vật của đoạn ${clip.index + 1} để Flow làm đúng như video gốc…`, 'warn');
    return analyzeScene(clip, signal);
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
  const continuityLine = n => `Image ${n} is the last frame of the previous clip: this clip continues straight on from it, so at the start the character, every object, its state and its position, the lighting and the framing match image ${n} exactly; the action then follows the reference video. The character still looks exactly like image 1.`;
  const backgroundLine = n => `Image ${n} is the new location: the whole clip takes place there. Its walls, floor, furniture, windows and light replace the room of the reference video, seen from the same camera angle and framing; the objects the person handles keep their look, size and action from the reference video.`;
  // Images in the order they are sent: 1 = character, then the location picture, then the previous clip's last frame.
  function imageSlots({ continuity = false } = {}) {
    const background = state.project.bgs?.length ? 2 : 0;
    return { background, continuity: continuity ? (background ? 3 : 2) : 0 };
  }
  function composePrompt(clip, { continuity = false } = {}) {
    const settings = state.project.settings, t = clip.transcript;
    const slots = imageSlots({ continuity });
    const notes = settings.sceneAI !== false || clip.scene?.manual ? sceneText(clip.scene, { newPlace: Boolean(slots.background) }) : '';
    const scene = [slots.background ? backgroundLine(slots.background) : '', slots.continuity ? continuityLine(slots.continuity) : '', notes].filter(Boolean).join('\n');
    // The clip's notes go where the prompt has {{scene}} (right after the action rules); otherwise after the prompt.
    let base = String(settings.prompt || DEFAULT_PROMPT).replace(SOUND_LINE, '').trim();
    // With a new location the source room is not kept, only the objects, light direction and camera.
    if (slots.background) base = base.replace('Keep exactly as in the reference video: background, furniture and their positions, ', 'Keep exactly as in the reference video: ').replace('(same length, cuts, camera, room, lighting and objects)', '(same length, cuts, camera and objects, in the location of image ' + slots.background + ')');
    const placed = base.includes('{{scene}}');
    base = base.replace(/\{\{scene\}\}/g, scene).replace(/\n{3,}/g, '\n\n').trim();
    const parts = [base];
    if (scene && !placed) parts.push(scene);
    const speech = t?.has_speech && (settings.sync || settings.subtitles || settings.translate);
    const translated = Boolean(settings.translate && t?.translation);
    const line = speech ? (translated ? t.translation : t.text).replace(/"/g, "'") : '';
    const language = translated ? settings.translate : t?.language;
    const timeline = speech ? timelineText(t, translated) : '';
    const mode = settings.voiceMode || 'character';
    const said = timeline ? `Timeline (seconds from the start of the clip): ${timeline}` : `"${line}"`;
    if (speech && settings.sync && mode === 'lipsync') {
      // Lip sync: the character mouths the original words; the original voice is put back at merge.
      const original = timelineText(t, false);
      parts.push(`Lip sync: the character says exactly the original words of the reference video${t?.language ? ` in ${t.language}` : ''}, mouth, jaw and breathing in sync with every word and pause, starting and stopping exactly when the person in the reference video does${original ? `. Timeline (seconds from the start of the clip): ${original}` : `: "${String(t.text || '').replace(/"/g, "'")}"`}.`);
      parts.push('Sound: quiet room ambience only, no music and no speech (the original voice is added afterwards).');
    } else if (speech && settings.sync && mode === 'narration') {
      parts.push(`Voice-over: a narrator${language ? ` speaking ${language}` : ''} says: ${said}. The character does not talk: mouth closed or natural expressions only, no lip movement for these words.`);
      parts.push(`Voice: ${settings.voiceDesc?.trim() || 'a warm, clear narrator voice'}. Sound: only this narration over quiet room ambience, no music.`);
    } else if (speech && (settings.sync || translated)) {
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
    // Continuity (like TobyFlow): the last frame of the previous clip's result goes in as image 2, so the character,
    // the objects and where they are carry straight on from one clip to the next.
    const previous = settings.continuity ? state.project.clips.filter(other => other.index < clip.index && other.status !== 'skipped').sort((a, b) => b.index - a.index)[0] : null;
    let lastFrame = '';
    if (previous?.result) { const url = await clipUrl(previous, 'result'); lastFrame = await frameAt(url, Math.max(0, (previous.end - previous.start) - 0.08), 720); }
    const requestId = uid('motion');
    const reply = await flowMessage({
      type: 'THEKEY_FLOW_GENERATE', requestId, remoteOk: true, kind: 'video', prompt: composePrompt(clip, { continuity: Boolean(lastFrame) }), voice: settings.sync ? (settings.flowVoice || '').trim() : '',
      aspect: settings.aspect, duration: flowDuration(clip.end - clip.start), resolution: settings.resolution, model: settings.model || '', inputType: 'ingredients',
      sourceVideo: await blobToDataUrl(blob), references: [...state.project.chars.map(item => item.dataUrl), ...(state.project.bgs || []).map(item => item.dataUrl), ...(lastFrame ? [lastFrame] : [])], firstFrame: '', uiMode: 'agent', timeoutSec: 1200
    }, signal);
    if (!reply?.ok) throw Object.assign(new Error(reply?.error || 'Flow không trả video.'), { code: reply?.code || '' });
    await keepResult(clip, reply);
  }
  async function keepResult(clip, reply) {
    // The same Flow video for two clips means the result of an earlier clip was picked up again: stop, never merge it.
    const key = reply.mediaId ? `flow:${reply.mediaId}` : String(reply.remoteUrl || '').split(/[?#]/)[0];
    const twin = key && !key.startsWith('blob:') ? state.project.clips.find(other => other !== clip && other.resultKey === key) : null;
    if (twin) throw Object.assign(new Error(`Flow trả lại đúng video của đoạn ${state.project.clips.indexOf(twin) + 1}, không phải video mới của đoạn này. Hãy mở tab Flow xem đoạn này đã tạo xong chưa rồi bấm tạo lại.`), { code: 'DUPLICATE_RESULT' });
    // A signed Flow link is fetched here directly (the extension may read flow-content.google), not passed as text.
    const response = await fetch(reply.url);
    if (!response.ok) throw new Error(`Không tải được video từ Flow (HTTP ${response.status}). Video vẫn nằm trong dự án Flow.`);
    const result = await response.blob();
    if (!result.size) throw new Error('Video Flow trả về bị rỗng.');
    await putBlob(`result:${clip.id}`, result.type ? result : new Blob([result], { type: 'video/mp4' }));
    objectUrl(state.resultUrls, clip.id, result);
    clip.result = true; clip.status = 'success'; clip.error = (reply.warnings || []).join(' '); clip.resultKey = key;
    clip.resultThumb = await frameAt(state.resultUrls.get(clip.id), 0.1);
    clip.resultThumbEnd = await frameAt(state.resultUrls.get(clip.id), Math.max(0.1, clip.end - clip.start - 0.1));
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
    let done = 0, failed = 0, next = 0, stopped = '';
    // Several clips in flight: Flow's prompt box takes one send at a time (the bridge holds it until Flow has named
    // the new item), and each clip then waits for its own item, so the next clip goes in while the first is made.
    // Continuity needs each clip's result before the next one starts, so it runs one clip at a time.
    const limit = state.project.settings.continuity ? 1 : Math.max(1, Math.min(3, Number(state.project.settings.parallel) || 1));
    const running = new Set();
    const showProgress = () => { if (!stopped && running.size) status(`Đang tạo ${[...running].map(clip => `đoạn ${clip.index + 1}`).join(', ')} trên Flow (xong ${done}/${todo.length})…`, 'warn'); };
    const worker = async () => {
      while (!stopped && !signal.aborted) {
        const index = next++;
        if (index >= todo.length) return;
        const clip = todo[index];
        if (index > 0 && Number(state.project.settings.pace) > 0) await sleep(Number(state.project.settings.pace) * 1000, signal);
        if (stopped) return;
        running.add(clip); showProgress();
        try { await generateWithFallback(clip, signal); done++; }
        catch (error) {
          if (error?.name === 'AbortError' || signal.aborted) throw error;
          clip.status = 'error'; clip.error = error.message; failed++;
          // Google's "unusual activity" notice or no credits: stop instead of sending more.
          if (['FLOW_BLOCKED', 'NO_CREDITS', 'FLOW_NOT_READY', 'DUPLICATE_RESULT'].includes(error.code)) stopped = stopped || error.message;
          // Flow refused the content (for example a real or well-known person): the other clips use the same video
          // and pictures, so stop instead of sending them all to be refused too.
          if (error.code === 'SCENE_REFUSED') stopped = stopped || `Flow từ chối nội dung đoạn ${clip.index + 1}, nên Motion Studio dừng các đoạn còn lại. Hãy dùng video bạn tự quay và ảnh nhân vật do AI tạo, rồi bấm tạo lại. (${error.message.slice(0, 200)})`;
        } finally { running.delete(clip); renderClips(); await saveNow(); showProgress(); }
      }
    };
    try {
      // ChatGPT / Gemini work first, one clip at a time (one chat tab), so the parallel sends below never wait on it.
      let sceneWarned = false;
      for (const clip of todo) {
        if (signal.aborted) break;
        if (state.project.settings.sceneAI && !clip.scene) {
          try {
            clip.phase = 'ai'; renderClips();
            await ensureScene(clip, signal); clip.sceneError = ''; clip.phase = '';
            const sc = clip.scene || {};
            status(`${AGENT_NAME[state.project.settings.speechAgent] || 'Gemini'} đã xem đoạn ${clip.index + 1}: ${sc.actions?.length || 0} nhịp hành động, ${sc.objects?.length || 0} đồ vật${sc.camera ? ', có góc máy / cắt cảnh' : ''}. Bấm vào ô đoạn để xem chi tiết.`, 'ok');
            renderClips(); await sleep(800, signal);
          }
          catch (error) {
            clip.phase = '';
            if (error?.name === 'AbortError' || signal.aborted) throw error;
            clip.sceneError = error.message; renderClips();
            if (!sceneWarned) { sceneWarned = true; status(`${AGENT_NAME[state.project.settings.speechAgent] || 'Gemini'} không xem được đoạn ${clip.index + 1}: ${error.message.slice(0, 160)}. Đoạn này vẫn tạo bằng câu lệnh chung.`, 'warn'); await sleep(2500, signal); }
          }
        }
        if (needsDialogue()) { try { clip.phase = 'talk'; renderClips(); await ensureTranscript(clip, signal); } catch (error) { if (error?.name === 'AbortError' || signal.aborted) throw error; } finally { clip.phase = ''; } }
      }
      // Optional stop: the user reads (and may fix) each clip's notes, then sends everything to Flow.
      if (state.project.settings.reviewNotes && !signal.aborted && todo.some(clip => clip.scene)) {
        for (const clip of todo) clip.phase = 'review';
        renderClips();
        status(`Trợ lý AI đã ghi xong ${todo.filter(clip => clip.scene).length}/${todo.length} đoạn. Bấm vào từng đoạn để xem câu lệnh và sửa phần mô tả, rồi bấm "Gửi Flow" để tạo video.`, 'ok');
        $('#msContinue').classList.remove('hidden');
        await new Promise((resolve, reject) => {
          state.reviewResolve = resolve;
          signal.addEventListener('abort', () => reject(new DOMException('Đã dừng.', 'AbortError')), { once: true });
        }).finally(() => { state.reviewResolve = null; $('#msContinue').classList.add('hidden'); for (const clip of todo) if (clip.phase === 'review') clip.phase = ''; });
      }
      // Workers start a little apart so the first send reaches Flow before the second one asks for the prompt box.
      await Promise.all(Array.from({ length: Math.min(limit, todo.length) }, (_, slot) => sleep(slot * 1500, signal).then(worker)));
      state.lastRun = { done, failed, stopped, aborted: signal.aborted };
      ensureEdgeFrames(todo).catch(() => {});
      if (stopped) status(stopped, 'error');
      else if (!signal.aborted) status(failed ? `Xong ${done} đoạn, ${failed} đoạn lỗi. Bấm vào đoạn lỗi để xem và tạo lại.` : `Đã tạo xong ${done} đoạn. Bấm "Ghép video" để ra video hoàn chỉnh.`, failed ? 'warn' : 'ok');
    } catch (error) {
      state.lastRun = { done, failed, stopped: stopped || 'Đã dừng.', aborted: true };
      for (const active of state.project.clips.filter(clip => clip.status === 'running')) { active.status = 'idle'; active.error = 'Đã dừng.'; }
      status('Đã dừng.', 'warn');
    } finally { state.running = false; state.abort = null; setBusy(false); renderAll(); saveSoon(); }
  }
  async function stop() {
    if (!state.running) return;
    state.abort?.abort();
    const tab = await flowTab(); if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'THEKEY_FLOW_STOP_GENERATION' }).catch(() => {});
  }

  // ---------- merge ----------
  async function merge({ originalAudio = false } = {}) {
    const clips = state.project.clips.filter(clip => clip.status !== 'skipped');
    const missing = clips.filter(clip => !clip.result);
    if (!clips.length) return;
    if (missing.length) { status(`Còn ${missing.length} đoạn chưa có kết quả Flow (${missing.map(clip => clip.index + 1).join(', ')}). Tạo xong hoặc bấm "Bỏ qua đoạn" trước khi ghép.`, 'warn'); return; }
    setBusy(true);
    try {
      const lipsync = state.project.settings.sync && state.project.settings.voiceMode === 'lipsync';
      const ff = await ffmpeg(), mode = originalAudio || lipsync ? 'original' : state.project.settings.audioMode || (state.project.settings.keepAudio ? 'original' : 'auto');
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
      await saveNow(); state.lastMerge = finalBlob; status(originalAudio ? 'Đã làm lại âm thanh: video hoàn chỉnh giờ dùng âm thanh của video gốc.' : 'Đã ghép xong video hoàn chỉnh. Bấm "Tải video" để lưu về máy.', 'ok');
    } catch (error) { state.lastMerge = null; status(`Ghép video thất bại: ${error.message}`, 'error'); }
    finally { setBusy(false); renderAll(); }
  }

  // ---------- many videos in one go (like TobyFlow's bulk Motion) ----------
  // Same character, location, prompt and settings for every video: each one is cut, made on Flow, merged and saved to
  // the Downloads folder, then the next one starts. Google's "unusual activity" or no credits stops the whole batch.
  const batch = { items: [], running: false };
  function addBatch(files) {
    for (const file of [...files].filter(item => /^video\//.test(item.type))) batch.items.push({ id: uid('batch'), file, name: file.name, status: 'waiting', note: '' });
    renderBatch();
  }
  function renderBatch() {
    const box = $('#msBatchList'); if (!box) return;
    box.innerHTML = '';
    const label = { waiting: 'Chờ', running: 'Đang làm', done: 'Xong', error: 'Lỗi', stopped: 'Đã dừng' };
    for (const item of batch.items) {
      const row = document.createElement('div'); row.className = `ms-batch-row ${item.status}`;
      const name = document.createElement('span'); name.textContent = item.name;
      const st = document.createElement('small'); st.textContent = `${label[item.status] || item.status}${item.note ? ` · ${item.note}` : ''}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Bỏ khỏi danh sách'; remove.disabled = batch.running;
      remove.onclick = () => { batch.items = batch.items.filter(other => other !== item); renderBatch(); };
      row.append(name, st, remove); box.appendChild(row);
    }
    $('#msBatchRun').disabled = batch.running || state.running || !batch.items.some(item => item.status === 'waiting');
    $('#msBatchInfo').textContent = batch.items.length ? `${batch.items.filter(item => item.status === 'done').length}/${batch.items.length} video xong` : '';
  }
  async function runBatch() {
    if (batch.running || state.running) return;
    if (!state.project.chars.length) { status('Hãy thêm ảnh nhân vật trước khi chạy nhiều video.', 'warn'); return; }
    batch.running = true; batch.stop = false; renderBatch();
    try {
      for (const item of batch.items.filter(entry => entry.status === 'waiting')) {
        if (batch.stop) break;
        item.status = 'running'; item.note = 'đang cắt'; renderBatch();
        if (!(await loadSource(item.file, { force: true })) || !(await splitSource({ force: true }))) { item.status = 'error'; item.note = 'không mở / cắt được video'; renderBatch(); continue; }
        item.note = 'đang tạo trên Flow'; renderBatch();
        await generate(state.project.clips.filter(clip => !clip.result));
        const run = state.lastRun || {};
        if (run.aborted || batch.stop) { item.status = 'stopped'; item.note = ''; renderBatch(); break; }
        const missing = state.project.clips.filter(clip => clip.status !== 'skipped' && !clip.result).length;
        if (missing) {
          item.status = 'error'; item.note = `${missing} đoạn lỗi; mở lại video này để tạo nốt`; renderBatch();
          if (run.stopped) { batch.stop = true; status(`Dừng cả lượt nhiều video: ${run.stopped}`, 'error'); break; }
          continue;
        }
        item.note = 'đang ghép'; renderBatch();
        state.lastMerge = null; await merge();
        if (!state.lastMerge) { item.status = 'error'; item.note = 'ghép video thất bại'; renderBatch(); continue; }
        const out = `motion-${item.name.replace(/\.[a-z0-9]+$/i, '')}.mp4`;
        await download(URL.createObjectURL(state.lastMerge), out);
        item.status = 'done'; item.note = `đã lưu ${out}`; renderBatch();
      }
    } finally { batch.running = false; renderBatch(); }
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
    // About 20 credits per clip (Omni with a video ingredient).
    $('#msCost').textContent = left ? `${left} đoạn cần tạo · khoảng ${left * 20} tín dụng` : clips.length ? 'Đã tạo hết các đoạn' : 'Chọn video gốc rồi bấm Cắt thành đoạn';
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
    $('#msPrompt').value = settings.prompt; $('#msAudioMode').value = settings.audioMode || 'auto'; $('#msSilentFallback').checked = settings.silentFallback !== false; $('#msPace').value = String(settings.pace); $('#msSceneAI').checked = settings.sceneAI !== false; $('#msReview').checked = Boolean(settings.reviewNotes); $('#msContinuity').checked = Boolean(settings.continuity); $('#msVoiceMode').value = settings.voiceMode || 'character'; $('#msParallel').value = String(settings.parallel || 2);
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
  function renderBgs() {
    const box = $('#msBgs'); if (!box) return; box.innerHTML = '';
    for (const bg of state.project.bgs || []) {
      const card = document.createElement('div'); card.className = 'ms-char';
      const img = document.createElement('img'); img.src = bg.dataUrl; img.alt = '';
      const name = document.createElement('span'); name.textContent = bg.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Bỏ ảnh bối cảnh';
      remove.onclick = () => { state.project.bgs = state.project.bgs.filter(item => item.id !== bg.id); saveSoon(); renderBgs(); };
      card.append(img, name, remove); box.appendChild(card);
    }
    $('#msBgDrop').classList.toggle('hidden', (state.project.bgs || []).length >= 1);
  }
  const STATUS_VI = { idle: 'Chưa tạo', running: 'Đang tạo trên Flow…', success: 'Xong', error: 'Lỗi', skipped: 'Bỏ qua khi ghép' };
  function renderClips() {
    const box = $('#msClips'), clips = state.project.clips;
    $('#msClipCount').textContent = clips.length ? `${clips.length} đoạn · ${clips.filter(clip => clip.result).length} đã có kết quả` : '';
    if (!clips.length) { box.innerHTML = '<p class="ms-hint">Bấm "Cắt thành đoạn" để chia video gốc theo độ dài đã chọn.</p>'; return; }
    box.innerHTML = '';
    for (const clip of clips) {
      const card = document.createElement('button'); card.type = 'button'; card.className = `ms-clip ${clip.status}`; card.dataset.clip = clip.id;
      // First and last frame of the source next to Flow's, so a clip that drifts from the source shows at once.
      const thumbs = document.createElement('div'); thumbs.className = 'thumbs edges';
      for (const [src, label] of [[clip.thumb, 'Gốc đầu'], [clip.thumbEnd, 'Gốc cuối'], [clip.resultThumb, 'Mới đầu'], [clip.resultThumbEnd, 'Mới cuối']]) {
        const cell = document.createElement('figure'); cell.className = src ? '' : 'empty';
        if (src) { const img = document.createElement('img'); img.src = src; img.alt = label; cell.appendChild(img); }
        const cap = document.createElement('figcaption'); cap.textContent = label; cell.appendChild(cap); thumbs.appendChild(cell);
      }
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.innerHTML = `<b>Đoạn ${clip.index + 1}</b><span>${fmt(clip.start)} – ${fmt(clip.end)}</span><span class="st"></span>`;
      meta.querySelector('.st').textContent = STATUS_VI[clip.status] || clip.status;
      // Where this clip is: cut → AI notes → dialogue → Flow → done.
      const steps = document.createElement('span'); steps.className = 'steps';
      const s = state.project.settings, mark = (label, state) => `<i class="${state}">${label}</i>`;
      const ai = !s.sceneAI && !clip.scene?.manual ? 'skip' : clip.phase === 'ai' ? 'run' : clip.scene ? (clip.scene.missing?.length ? 'warn' : 'ok') : clip.sceneError ? 'err' : 'wait';
      const talk = !needsDialogue() ? 'skip' : clip.phase === 'talk' ? 'run' : clip.transcript ? 'ok' : 'wait';
      const flow = clip.status === 'running' ? 'run' : clip.result ? 'ok' : clip.status === 'error' ? 'err' : clip.phase === 'review' ? 'hold' : 'wait';
      steps.innerHTML = [mark('Cắt', 'ok'), mark('AI', ai), mark('Lời', talk), mark('Flow', flow)].join('<b>›</b>');
      steps.title = 'Cắt đoạn › Trợ lý AI ghi hành động › Lời thoại › Flow tạo video';
      meta.appendChild(steps);
      // What the AI wrote for this clip (or why it could not).
      if (clip.scene || clip.sceneError) { const ai = document.createElement('span'); ai.className = clip.sceneError && !clip.scene ? 'talk ai-err' : 'talk ai'; ai.textContent = clip.scene ? (clip.scene.manual ? 'AI: mô tả cảnh sửa tay' : `AI: ${clip.scene.actions?.length || 0} nhịp hành động, ${clip.scene.objects?.length || 0} đồ vật${clip.scene.missing?.length ? ' (còn thiếu, bấm để sửa)' : ''}`) : `AI lỗi: ${clip.sceneError.slice(0, 40)}`; ai.title = clip.scene ? sceneText(clip.scene) : clip.sceneError; meta.appendChild(ai); }
      if (clip.transcript) { const talk = document.createElement('span'); talk.className = 'talk'; talk.textContent = clip.transcript.has_speech ? `Lời thoại: ${clip.transcript.text.slice(0, 40)}${clip.transcript.text.length > 40 ? '…' : ''}` : 'Không có lời thoại'; meta.appendChild(talk); }
      if (clip.error) card.title = clip.error;
      card.append(thumbs, meta); card.onclick = () => openClip(clip.id); box.appendChild(card);
    }
  }
  function renderAll() { renderSettings(); renderSource(); renderChars(); renderBgs(); renderBatch(); renderClips(); renderFinal(); renderButtons(); }

  let modalClip = null;
  // Older projects have no last frames yet: fill them in once (source and Flow result).
  async function ensureEdgeFrames(clips = state.project.clips) {
    let changed = false;
    for (const clip of clips) {
      const length = Math.max(0.2, clip.end - clip.start);
      if (!clip.thumbEnd) { const url = await clipUrl(clip, 'clip').catch(() => ''); if (url) { clip.thumbEnd = await frameAt(url, length - 0.1); changed = true; } }
      if (clip.result && !clip.resultThumbEnd) { const url = await clipUrl(clip, 'result').catch(() => ''); if (url) { clip.resultThumbEnd = await frameAt(url, length - 0.1); changed = true; } }
    }
    if (changed) { renderClips(); saveSoon(); }
  }
  function showEdges(clip) {
    const box = $('#msModalEdges'); box.innerHTML = '';
    for (const [src, label] of [[clip.thumb, 'Gốc · khung đầu'], [clip.resultThumb, 'Mới · khung đầu'], [clip.thumbEnd, 'Gốc · khung cuối'], [clip.resultThumbEnd, 'Mới · khung cuối']]) {
      const cell = document.createElement('figure');
      if (src) { const img = document.createElement('img'); img.src = src; img.alt = label; cell.appendChild(img); } else { const none = document.createElement('div'); none.className = 'ms-empty'; none.textContent = 'Chưa có'; cell.appendChild(none); }
      const cap = document.createElement('figcaption'); cap.textContent = label; cell.appendChild(cap); box.appendChild(cell);
    }
  }
  // The exact prompt this clip will send to Flow (the AI notes are inside it).
  function showPromptPreview(clip) {
    const continuity = Boolean(state.project.settings.continuity && state.project.clips.some(other => other.index < clip.index && other.result));
    $('#msModalPrompt').value = composePrompt(clip, { continuity });
  }
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
    $('#msModalScene').value = sceneText(clip.scene); $('#msModalAnalyze').disabled = state.running && !state.reviewResolve;
    $('#msModalMissing').textContent = clip.scene?.missing?.length ? `AI còn thiếu: ${clip.scene.missing.join('; ')}.` : '';
    showPromptPreview(clip); showEdges(clip);
    ensureEdgeFrames([clip]).then(() => { if (modalClip === clip) showEdges(clip); });
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
    $('#msBgInput').onchange = event => { addBgs(event.target.files); event.target.value = ''; };
    dropZone($('#msBgDrop'), addBgs);
    $('#msBatchInput').onchange = event => { addBatch(event.target.files); event.target.value = ''; };
    dropZone($('#msBatchDrop'), addBatch);
    $('#msBatchRun').onclick = runBatch;
    $('#msSplit').onclick = splitSource;
    $('#msGenerate').onclick = () => generate(state.project.clips.filter(clip => !clip.result));
    $('#msStop').onclick = () => { batch.stop = true; stop(); };
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
    bind('#msAspect', 'aspect'); bind('#msResolution', 'resolution'); bind('#msModel', 'model'); bind('#msClipLen', 'clipLen', Number); bind('#msAudioMode', 'audioMode'); bind('#msSilentFallback', 'silentFallback', Boolean); bind('#msPace', 'pace', Number); bind('#msSceneAI', 'sceneAI', Boolean); bind('#msReview', 'reviewNotes', Boolean);
    $('#msContinue').onclick = () => { state.reviewResolve?.(); }; bind('#msContinuity', 'continuity', Boolean); bind('#msVoiceMode', 'voiceMode'); bind('#msParallel', 'parallel', Number);
    bind('#msSpeechAgent', 'speechAgent');
    bind('#msSync', 'sync', Boolean); bind('#msSubtitles', 'subtitles', Boolean); bind('#msTranslate', 'translate');
    for (const box of document.querySelectorAll('.ms-side details')) { try { if (localStorage.getItem(`ms-open-${box.id}`) === '1') box.open = true; } catch {} box.addEventListener('toggle', () => { try { localStorage.setItem(`ms-open-${box.id}`, box.open ? '1' : '0'); } catch {} }); }
    // Turning on dialogue opens its section.
    $('#msSync').addEventListener('change', () => { if ($('#msSync').checked) $('#msMoreVoice').open = true; });
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
    $('#msModalAnalyze').onclick = async () => {
      const clip = modalClip; if (!clip || state.running) return;
      $('#msModalAnalyze').disabled = true; $('#msModalError').textContent = '';
      try { await analyzeScene(clip); $('#msModalScene').value = sceneText(clip.scene); $('#msModalMissing').textContent = clip.scene?.missing?.length ? `AI còn thiếu: ${clip.scene.missing.join('; ')}.` : ''; showPromptPreview(clip); renderClips(); }
      catch (error) { $('#msModalError').textContent = error.message; }
      finally { $('#msModalAnalyze').disabled = false; }
    };
    $('#msModalSaveScene').onclick = () => {
      const clip = modalClip; if (!clip) return;
      const text = $('#msModalScene').value.trim();
      clip.scene = text ? { manual: true, text } : null;
      saveSoon(); showPromptPreview(clip); renderClips(); $('#msModalError').textContent = text ? 'Đã lưu mô tả cảnh cho đoạn này.' : 'Đã xoá mô tả cảnh; đoạn này sẽ được xem lại khi tạo.';
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
    if (!Array.isArray(state.project.bgs)) state.project.bgs = [];
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
