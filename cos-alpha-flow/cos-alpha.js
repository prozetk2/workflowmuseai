// cos_alpha_flow 1.0 modules on top of the canvas (app.js):
//  - Queue: run list with pause / resume / skip / stop, extra nodes queued while a run is going,
//    mirrored to a floating panel inside the Google Flow tab (flow-bridge.js draws it).
//  - Project album: every finished image/video is kept per project in IndexedDB.
//  - AI script writer: idea → scene script (Gemini API, or a prompt copied to ChatGPT / Gemini web).
// app.js calls window.__cosAlphaHooks.* and exposes window.__cosAlphaApp.
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const app = () => window.__cosAlphaApp;
  const FLOW_URLS = ['https://flow.google.com/*', 'https://labs.google/fx/*'];
  const GEN_TYPES = ['generateImage', 'generateVideo'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- Queue ----------------
  const queue = { run: null, paused: false, pauseWaiters: [], skip: new Set(), pending: [], lastStatus: { text: '', cls: '' }, finishedAt: 0 };

  function nodeLabel(node) {
    if (!node) return '?';
    const kind = node.type === 'generateVideo' ? 'Video' : 'Ảnh';
    return node.data?.customName || node.data?.sceneLabel || `${kind} ${String(node.id).replace(/^[a-zA-Z]+[-_]?/, '').slice(-5)}`;
  }
  function itemStatus(node) {
    const a = app();
    if (!node) return 'missing';
    if (a.state.activeGenerationId === node.id && node.data.status === 'running') return 'running';
    if (queue.pending.some(item => item.nodeId === node.id)) return 'queued';
    if (queue.run && node.data.runToken === queue.run.token) return node.data.status === 'running' ? 'running' : node.data.status || 'idle';
    if (queue.run && queue.run.ids.includes(node.id)) return queue.skip.has(node.id) ? 'willSkip' : 'waiting';
    return node.data.status || 'idle';
  }
  const STATUS_VI = { running: 'đang tạo', waiting: 'chờ', queued: 'xếp hàng', willSkip: 'sẽ bỏ qua', success: 'xong', error: 'lỗi', skipped: 'đã bỏ qua', stopped: 'đã dừng', idle: 'chưa chạy', missing: 'đã xoá' };

  function snapshot() {
    const a = app();
    if (!a) return null;
    const ids = queue.run ? [...queue.run.ids] : [];
    for (const item of queue.pending) if (!ids.includes(item.nodeId)) ids.push(item.nodeId);
    const items = ids.map(id => { const node = a.nodeById(id); const status = itemStatus(node); return { id, label: nodeLabel(node), kind: node?.type === 'generateVideo' ? 'video' : 'image', status, statusText: STATUS_VI[status] || status, error: status === 'error' ? String(node?.data?.error || '').slice(0, 160) : '' }; });
    const done = items.filter(item => ['success', 'error', 'skipped', 'stopped'].includes(item.status)).length;
    return { startedAt: queue.run?.startedAt || 0, running: a.state.isRunning, paused: queue.paused, items, done, total: items.length, status: queue.lastStatus.text, statusCls: queue.lastStatus.cls, finishedAt: queue.finishedAt, failed: a.state.nodes.filter(n => GEN_TYPES.includes(n.type) && n.data.status === 'error').length };
  }

  function setPaused(value) {
    queue.paused = Boolean(value);
    if (!queue.paused) { const waiters = queue.pauseWaiters.splice(0); waiters.forEach(fn => fn()); }
    app()?.setRunStatus(queue.paused ? 'Hàng đợi tạm dừng: lượt đang tạo vẫn chạy cho xong, lượt sau chờ bạn bấm Tiếp tục.' : 'Hàng đợi tiếp tục.', 'warn');
    refresh();
  }
  function stopAll() {
    const a = app();
    queue.pending = [];
    if (queue.paused) setPaused(false);
    if (a.state.isRunning) a.stopGeneration(a.state.activeGenerationId || undefined);
    // stopGeneration only aborts when a node is mid-generation; abort the run controller too.
    a.state.generationAbortController?.abort();
    refresh();
  }
  function toggleSkip(nodeId) {
    const pendingIndex = queue.pending.findIndex(item => item.nodeId === nodeId);
    if (pendingIndex >= 0) { queue.pending.splice(pendingIndex, 1); refresh(); return; }
    if (queue.skip.has(nodeId)) queue.skip.delete(nodeId); else queue.skip.add(nodeId);
    refresh();
  }
  function runOrEnqueue(nodeId) {
    const a = app();
    if (a.state.isRunning) { hooks.enqueue({ nodeId, options: {} }); return; }
    a.executeGenerationNode(nodeId);
  }
  function runAll() { const a = app(); if (!a.state.isRunning) a.execute(); }

  const hooks = window.__cosAlphaHooks = {
    webGenerate: payload => webGenerate(payload),
    webCheck: provider => webCheck(provider),
    onRunStart({ ids, token, targetId }) { queue.run = { ids, token, targetId, startedAt: Date.now() }; queue.finishedAt = 0; queue.pending = queue.pending.filter(item => item.nodeId !== targetId); refresh(); },
    onRunEnd({ aborted }) {
      queue.skip.clear(); queue.finishedAt = Date.now();
      if (queue.paused) { queue.paused = false; queue.pauseWaiters.splice(0).forEach(fn => fn()); }
      if (aborted) queue.pending = [];
      // A queued node that was already handed to execute() but never started (e.g. empty prompt) is dropped.
      queue.pending = queue.pending.filter(item => !item.started);
      // Keep the next node listed as "queued" until its run actually starts (onRunStart removes it).
      const next = queue.pending[0];
      if (next) next.started = true;
      refresh();
      if (next) setTimeout(() => app().execute(next.nodeId, next.options || {}), 300);
    },
    shouldSkip(nodeId) { return queue.skip.has(nodeId); },
    async waitIfPaused(signal) {
      // Optional rest between generations (Settings in the queue tab), never before the first one.
      if (queue.run) { if (queue.run.started && extras.pace > 0) { app().setRunStatus(`Nghỉ ${extras.pace} giây trước lượt kế tiếp…`, 'warn'); await new Promise(resolve => { const timer = setTimeout(resolve, extras.pace * 1000); signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); }); } queue.run.started = true; }
      if (!queue.paused) return;
      refresh();
      await new Promise(resolve => { queue.pauseWaiters.push(resolve); signal?.addEventListener('abort', resolve, { once: true }); });
    },
    enqueue({ nodeId, options }) {
      if (queue.pending.some(item => item.nodeId === nodeId) || (queue.run?.ids.includes(nodeId) && itemStatus(app().nodeById(nodeId)) === 'waiting')) return true;
      queue.pending.push({ nodeId, options });
      app().setRunStatus(`Đã thêm "${nodeLabel(app().nodeById(nodeId))}" vào hàng đợi (${queue.pending.length} đang chờ).`, 'warn');
      refresh();
      return true;
    },
    onResult({ node, asset, prompt }) { addToAlbum({ node, asset, prompt }).then(albumId => addHistory({ node, prompt, status: 'success', albumId })).catch(error => console.warn('[cos_alpha_flow] album', error)); },
    onError({ node, error, prompt }) { if (error?.name !== 'AbortError') addHistory({ node, prompt, status: 'error', error: error?.message || String(error) }); },
    onStatus({ text, cls }) { queue.lastStatus = { text, cls }; scheduleBroadcast(); },
    onRender() { refresh(); }
  };

  // Broadcast to the Flow tab overlay (throttled).
  let broadcastTimer = 0, lastBroadcast = '';
  function scheduleBroadcast() {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(async () => {
      broadcastTimer = 0;
      const snap = snapshot(); if (!snap) return;
      const body = JSON.stringify(snap); if (body === lastBroadcast) return; lastBroadcast = body;
      try {
        const tabs = await chrome.tabs.query({ url: FLOW_URLS });
        await Promise.allSettled(tabs.filter(tab => tab.id).map(tab => chrome.tabs.sendMessage(tab.id, { type: 'THEKEY_FLOW_QUEUE_STATE', snapshot: snap })));
      } catch { /* no Flow tab */ }
    }, 400);
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'COSALPHA_QUEUE_CMD') return false;
    const cmd = message.cmd;
    if (cmd === 'pause') setPaused(true);
    else if (cmd === 'resume') setPaused(false);
    else if (cmd === 'stop') stopAll();
    else if (cmd === 'skip' && message.nodeId) toggleSkip(message.nodeId);
    else if (cmd === 'runAll') runAll();
    else if (cmd === 'hello') { lastBroadcast = ''; scheduleBroadcast(); }
    else if (cmd === 'openApp') chrome.tabs.getCurrent().then(tab => { if (tab?.id) chrome.tabs.update(tab.id, { active: true }); if (tab?.windowId !== undefined) chrome.windows.update(tab.windowId, { focused: true }); }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  });

  // ---------------- Drawer (queue / album) ----------------
  let drawerMode = '';
  function openDrawer(mode, keep) { drawerMode = keep ? mode : drawerMode === mode ? '' : mode; document.querySelectorAll('[data-dtab]').forEach(b => b.classList.toggle('active', b.dataset.dtab === drawerMode)); document.querySelectorAll('[data-qp]').forEach(b => b.classList.toggle('active', b.dataset.qp === (drawerMode || 'gen'))); $('#cosDrawer').classList.toggle('hidden', !drawerMode); if (isPanel) { $('#qpGen')?.classList.toggle('hidden', Boolean(drawerMode)); $('#qpFooter')?.classList.toggle('hidden', Boolean(drawerMode)); } document.querySelectorAll('[data-drawer]').forEach(b => b.classList.toggle('active', b.dataset.drawer === drawerMode)); refresh(true); }
  let refreshFrame = 0;
  function refresh(force) {
    scheduleBroadcast();
    const render = () => { refreshFrame = 0; if (drawerMode === 'queue') renderQueue(); else if (force && extraRenderers[drawerMode]) extraRenderers[drawerMode](); updateBadges(); };
    // A tab switch renders at once: animation frames can lag or pause in a background side panel.
    if (force) { cancelAnimationFrame(refreshFrame); render(); return; }
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(render);
  }
  function updateBadges() {
    const snap = snapshot(); const badge = $('#cosQueueBadge'); if (!badge || !snap) return;
    const left = snap.items.filter(item => ['waiting', 'queued', 'running'].includes(item.status)).length;
    badge.textContent = left ? String(left) : ''; badge.classList.toggle('hidden', !left); const qb = $('#qpQueueBadge'); if (qb) { qb.textContent = left ? String(left) : ''; qb.classList.toggle('hidden', !left); }
  }

  function renderQueue() {
    const a = app(), body = $('#cosDrawerBody'); if (!a || !body) return;
    const snap = snapshot();
    $('#cosDrawerTitle').textContent = 'Hàng đợi';
    const allGen = a.state.nodes.filter(n => GEN_TYPES.includes(n.type) && !n.data?.dockOnly);
    const inRun = new Set(snap.items.map(item => item.id));
    const controls = snap.running
      ? `<button data-q="${snap.paused ? 'resume' : 'pause'}">${snap.paused ? '<i data-ic="play"></i>Tiếp tục' : '<i data-ic="pause"></i>Tạm dừng'}</button><button data-q="stop" class="danger"><i data-ic="square"></i>Dừng tất cả</button>`
      : `<button data-q="runAll" class="primary"><i data-ic="play"></i>Chạy tất cả</button>${snap.failed ? `<button data-q="runAll" title="Node đã xong được giữ nguyên, chỉ chạy lại node lỗi và node chưa chạy">Chạy lại ${snap.failed} mục lỗi</button>` : ''}`;
    const head = `<div class="cos-q-head"><div class="cos-q-progress"><b>${snap.running ? (snap.paused ? 'Tạm dừng' : 'Đang chạy') : 'Rảnh'}</b> · ${snap.done}/${snap.total} lượt${queue.pending.length ? ` · ${queue.pending.length} xếp hàng thêm` : ''}</div><div class="cos-q-bar"><i style="width:${snap.total ? Math.round(snap.done / snap.total * 100) : 0}%"></i></div><div class="cos-q-controls">${controls}</div><label class="cos-pace">Nghỉ giữa các lượt <select id="cosPace">${[0, 5, 10, 20, 30, 60].map(v => `<option value="${v}" ${extras.pace === v ? 'selected' : ''}>${v ? v + ' giây' : 'không nghỉ'}</option>`).join('')}</select></label><p class="cos-hint">Bảng này cũng hiện nổi ngay trên tab Google Flow. Tạm dừng có hiệu lực từ lượt kế tiếp; lượt đang tạo vẫn chạy cho xong. Bấm Chạy trên một node khi đang chạy để xếp hàng thêm.</p></div>`;
    const row = (node, status) => {
      const thumb = node.data.asset?.url ? (node.data.asset.kind === 'video' ? `<video src="${esc(node.data.asset.url)}" muted></video>` : `<img src="${esc(node.data.asset.url)}" alt="">`) : `<span class="cos-q-kind">${node.type === 'generateVideo' ? 'Video' : 'Ảnh'}</span>`;
      const action = ['waiting', 'willSkip', 'queued'].includes(status)
        ? `<button data-skip="${esc(node.id)}">${status === 'willSkip' ? 'Không bỏ' : status === 'queued' ? 'Huỷ' : 'Bỏ qua'}</button>`
        : status === 'running' ? '' : `<button data-run="${esc(node.id)}" title="${a.state.isRunning ? 'Xếp vào hàng đợi' : 'Chạy node này'}">${a.state.isRunning ? 'Xếp hàng' : (node.data.asset?.url ? 'Tạo lại' : 'Chạy')}</button>`;
      return `<li class="cos-q-item st-${status}" data-node="${esc(node.id)}">${thumb}<div class="cos-q-text"><b>${esc(nodeLabel(node))}</b><small>${esc(STATUS_VI[status] || status)}${status === 'error' && node.data.error ? ' · ' + esc(String(node.data.error).slice(0, 140)) : ''}</small></div>${action}</li>`;
    };
    const runList = snap.items.map(item => { const node = a.nodeById(item.id); return node ? row(node, item.status) : ''; }).join('');
    const others = allGen.filter(n => !inRun.has(n.id)).map(n => row(n, n.data.status || 'idle')).join('');
    body.innerHTML = head + (runList ? `<h4>Lượt chạy hiện tại</h4><ul class="cos-q-list">${runList}</ul>` : '') + (others ? `<h4>${runList ? 'Các node tạo khác' : 'Các node tạo ảnh / video'}</h4><ul class="cos-q-list">${others}</ul>` : '') + (!allGen.length ? '<p class="cos-empty">Chưa có node Tạo ảnh / Tạo video nào.</p>' : '');
  }

  // ---------------- Album ----------------
  let albumDbPromise;
  function albumDb() {
    if (!albumDbPromise) albumDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('cosalpha-album', 1);
      request.onupgradeneeded = () => { const store = request.result.createObjectStore('items', { keyPath: 'id' }); store.createIndex('project', 'project'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Không mở được kho album.'));
    });
    return albumDbPromise;
  }
  async function albumTx(mode, fn) {
    const db = await albumDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', mode), store = tx.objectStore('items');
      let result; Promise.resolve(fn(store, value => { result = value; })).catch(reject);
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  const albumState = { projects: ['Project chính'], current: 'Project chính', filter: 'all', urls: [] };
  async function loadAlbumSettings() {
    try {
      const got = await chrome.storage.local.get(['cosalphaAlbumProjects', 'cosalphaAlbumCurrent']);
      if (Array.isArray(got.cosalphaAlbumProjects) && got.cosalphaAlbumProjects.length) albumState.projects = got.cosalphaAlbumProjects;
      if (got.cosalphaAlbumCurrent && albumState.projects.includes(got.cosalphaAlbumCurrent)) albumState.current = got.cosalphaAlbumCurrent;
    } catch { /* defaults */ }
  }
  const saveAlbumSettings = () => chrome.storage.local.set({ cosalphaAlbumProjects: albumState.projects, cosalphaAlbumCurrent: albumState.current }).catch(() => {});
  async function putAlbumItem(item) { await albumTx('readwrite', store => store.put(item)); }
  async function addToAlbum({ node, asset, prompt }) {
    if (!asset?.url) return;
    const response = await fetch(asset.url); const blob = await response.blob(); if (!blob.size) return;
    const id = app().uid('album');
    await putAlbumItem({ id, project: albumState.current, kind: asset.kind === 'video' ? 'video' : 'image', blob, prompt: String(prompt || '').slice(0, 4000), label: nodeLabel(node), nodeId: node.id, createdAt: Date.now(), starred: false, width: asset.width || 0, height: asset.height || 0 });
    if (drawerMode === 'album') renderAlbum();
    return id;
  }
  async function listAlbum(project) { return albumTx('readonly', (store, done) => { const request = store.index('project').getAll(project); request.onsuccess = () => done(request.result || []); }); }
  async function renderAlbum() {
    const body = $('#cosDrawerBody'); if (!body) return;
    $('#cosDrawerTitle').textContent = 'Album project';
    albumState.urls.forEach(url => URL.revokeObjectURL(url)); albumState.urls = [];
    let items = [];
    try { items = (await listAlbum(albumState.current)).sort((a, b) => b.createdAt - a.createdAt); } catch (error) { body.innerHTML = `<p class="cos-empty error">${esc(error.message)}</p>`; return; }
    const counts = { all: items.length, image: items.filter(i => i.kind === 'image').length, video: items.filter(i => i.kind === 'video').length, star: items.filter(i => i.starred).length };
    const shown = items.filter(i => albumState.filter === 'all' || (albumState.filter === 'star' ? i.starred : i.kind === albumState.filter));
    const filters = [['all', 'Tất cả'], ['image', 'Ảnh'], ['video', 'Video'], ['star', 'Đã ghim']].map(([key, text]) => `<button data-af="${key}" class="${albumState.filter === key ? 'active' : ''}">${text} ${counts[key]}</button>`).join('');
    const cards = shown.map(item => {
      const url = URL.createObjectURL(item.blob); albumState.urls.push(url);
      const media = item.kind === 'video' ? `<video src="${url}" muted loop preload="metadata"></video><span class="cos-a-kind">Video</span>` : `<img src="${url}" alt="">`;
      return `<figure class="cos-a-card" draggable="true" data-album="${esc(item.id)}" title="${esc(item.prompt)}">${media}<figcaption><span>${esc(item.label)}</span><span class="cos-a-actions"><button data-astar="${esc(item.id)}" class="${item.starred ? 'on' : ''}" title="${item.starred ? 'Bỏ ghim' : 'Ghim'}"><i data-ic="star"></i></button><button data-ause="${esc(item.id)}" title="Dùng làm ảnh tham chiếu / đưa vào canvas"><i data-ic="plus"></i></button><button data-adl="${esc(item.id)}" title="Tải về"><i data-ic="download"></i></button><button data-adel="${esc(item.id)}" title="Xoá khỏi album"><i data-ic="trash-2"></i></button></span></figcaption></figure>`;
    }).join('');
    body.innerHTML = `<div class="cos-a-head"><select id="cosAlbumProject">${albumState.projects.map(p => `<option ${p === albumState.current ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select><button id="cosAlbumNew" title="Tạo project mới"><i data-ic="folder-plus"></i>Project mới</button><label class="cos-a-upload" title="Thêm ảnh/video từ máy vào album"><i data-ic="upload"></i>Thêm từ máy<input id="cosAlbumFile" type="file" accept="image/*,video/*" multiple hidden></label></div><div class="cos-a-filters">${filters}</div><p class="cos-hint">Mọi ảnh/video tạo xong được tự lưu vào project đang chọn. Kéo thẻ vào canvas hoặc bấm + để dùng lại làm ảnh tham chiếu / video tham chiếu.</p><div class="cos-a-grid">${cards || '<p class="cos-empty">Chưa có gì trong album này.</p>'}</div>`;
    body.querySelectorAll('.cos-a-card video').forEach(video => { video.onmouseenter = () => video.play().catch(() => {}); video.onmouseleave = () => video.pause(); });
  }
  async function albumItem(id) { return albumTx('readonly', (store, done) => { const request = store.get(id); request.onsuccess = () => done(request.result); }); }
  function itemFile(item) { const ext = item.kind === 'video' ? 'mp4' : (item.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg'); return new File([item.blob], `${albumState.current}-${item.label}-${item.id.slice(-5)}.${ext}`.replace(/[\\/:*?"<>|]+/g, '_'), { type: item.blob.type || (item.kind === 'video' ? 'video/mp4' : 'image/png') }); }
  async function useAlbumItem(id, clientX, clientY) { const item = await albumItem(id); if (!item) return; if (isPanel && item.kind === 'image' && clientX === undefined) { await addQuickRefs([itemFile(item)]); app().setRunStatus(`Đã thêm "${item.label}" vào ảnh tham chiếu của tab Tạo.`, 'ok'); return; } await app().addImageInputs([itemFile(item)], clientX, clientY); app().setRunStatus(`Đã đưa "${item.label}" từ album vào canvas.`, 'ok'); }
  async function onAlbumClick(event) {
    const t = event.target.closest('button,select'); if (!t) return;
    if (t.dataset.af) { albumState.filter = t.dataset.af; renderAlbum(); return; }
    if (t.id === 'cosAlbumNew') { const name = prompt('Tên project mới (vd: Quảng cáo áo dài tháng 11):'); if (!name?.trim()) return; const clean = name.trim().slice(0, 60); if (!albumState.projects.includes(clean)) albumState.projects.push(clean); albumState.current = clean; saveAlbumSettings(); renderAlbum(); return; }
    const id = t.dataset.astar || t.dataset.ause || t.dataset.adl || t.dataset.adel; if (!id) return;
    const item = await albumItem(id); if (!item) return;
    if (t.dataset.astar) { item.starred = !item.starred; await putAlbumItem(item); renderAlbum(); }
    else if (t.dataset.ause) await useAlbumItem(id);
    else if (t.dataset.adl) { const url = URL.createObjectURL(item.blob); const link = document.createElement('a'); link.href = url; link.download = itemFile(item).name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
    else if (t.dataset.adel) { if (!confirm(`Xoá "${item.label}" khỏi album? (Không ảnh hưởng node trên canvas.)`)) return; await albumTx('readwrite', store => store.delete(id)); renderAlbum(); }
  }
  async function addFilesToAlbum(files) {
    for (const file of files) if (/^(image|video)\//.test(file.type)) await putAlbumItem({ id: app().uid('album'), project: albumState.current, kind: file.type.startsWith('video') ? 'video' : 'image', blob: file, prompt: '', label: file.name.replace(/\.[^.]+$/, '').slice(0, 40), createdAt: Date.now(), starred: false });
    renderAlbum();
  }

  // ---------------- AI script writer ----------------
  const STYLES = {
    clay: 'Prehistoric Clay 3D: claymation / stop-motion look, handmade plasticine characters and props with visible fingerprints and soft clay texture, chunky proportions, warm cinematic lighting, miniature prehistoric world (cavemen, mammoths, volcanoes, jungles), shallow depth of field, 3D render quality',
    fashion: 'High-end fashion advertising: editorial photography, the same model and outfit in every scene, studio and city locations, elegant camera moves, glossy commercial lighting',
    cute3d: 'Cute 3D animated film look: soft rounded characters, expressive faces, vibrant colors, global illumination, family-friendly storytelling',
    cinematic: 'Photorealistic cinematic film: natural lighting, anamorphic lens, film grain, realistic people and places, motivated camera movement',
    anime: 'Japanese anime style: clean line art, cel shading, dramatic skies, expressive characters, dynamic camera angles',
    product: 'Product commercial: hero product shots, macro details, clean backgrounds, smooth slider and orbit camera moves, premium lighting'
  };
  function scriptRequest() {
    const idea = $('#aiIdea').value.trim(); if (!idea) throw new Error('Hãy nhập ý tưởng trước.');
    const styleKey = $('#aiStyle').value, style = styleKey === 'custom' ? ($('#aiStyleCustom').value.trim() || 'any style that suits the idea') : STYLES[styleKey];
    const scenes = Math.max(1, Math.min(12, Number($('#aiScenes').value) || 4)), seconds = Number($('#aiSeconds').value) || 8, aspect = $('#aiAspect').value, character = $('#aiCharacter').value.trim(), voice = $('#aiVoice').value;
    const timeOf = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const example = `CẢNH 1 (0:00–${timeOf(seconds)}): Tên cảnh ngắn\n\nPrompt ảnh: <English image prompt, ${aspect}>\n\nPrompt video: <English video prompt: action, camera move, ${seconds} seconds>\nAudio: <${voice === 'none' ? 'ambient sound and music only' : 'Vietnamese voice-over or dialogue line, plus sound effects'}>`;
    const system = `You are a film director and prompt engineer for Google Veo (video) and Nano Banana (image). You turn a short idea into a consistent ${scenes}-scene short video. Visual style for EVERY scene: ${style}. Aspect ratio ${aspect}. Each scene is ${seconds} seconds.\nRules:\n- Output ONLY the script in the exact format below, nothing before or after.\n- Scene headings and labels stay in Vietnamese exactly as shown ("CẢNH", "Prompt ảnh", "Prompt video", "Audio"); the prompt texts are in detailed English.\n- Prompt ảnh describes the first frame of the scene (subject, setting, composition, lighting, style, ${aspect}).\n- Prompt video describes motion from that frame: action, camera movement, pacing, and must fit ${seconds} seconds.\n- Repeat the main character's full appearance in every prompt so it stays identical.\n- Scenes must flow as one story with a clear hook, build-up and ending.\n${character ? '' : '- First line: "NHÂN VẬT: <name> — <one-sentence English appearance description>" for the main character (one line per main character, max 2).\n'}Format for each scene:\n${example}`;
    const user = `Idea (Vietnamese or English): ${idea}${character ? `\nMain character (keep identical): ${character}` : ''}`;
    return { system, user, character };
  }
  async function geminiText(apiKey, model, system, user) {
    const call = async m => {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.9 } }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(json?.error?.message || `HTTP ${response.status}`), { status: response.status });
      const text = (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (!text) throw new Error('Gemini không trả về chữ (có thể ý tưởng bị chặn vì chính sách). Hãy đổi cách diễn đạt.');
      return text;
    };
    try { return { text: await call(model), model }; }
    catch (error) {
      if (error.status !== 404 && !/not found|is not supported/i.test(error.message)) throw error;
      // The model name changed: pick any current Flash text model the key can use.
      const list = await (await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey } })).json();
      const pick = (list.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, '')).filter(n => /flash/i.test(n) && !/image|tts|live|audio|embedding|vision|thinking-exp/i.test(n)).sort().reverse()[0];
      if (!pick) throw error;
      return { text: await call(pick), model: pick };
    }
  }
  // Newest Gemini Pro text model the key can use (stable before preview at the same version).
  async function bestGeminiModel(apiKey) {
    try {
      const list = await (await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey } })).json();
      const score = name => { const v = /gemini-(\d+(?:\.\d+)?)/.exec(name); return v ? Number(v[1]) * 10 + (/preview|exp/.test(name) ? 0 : 1) : -1; };
      const pros = (list.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''))
        .filter(n => /-pro\b/.test(n) && !/image|tts|live|audio|embedding|vision|computer|latest/.test(n) && score(n) > 0).sort((a, b) => score(b) - score(a));
      return pros[0] || 'gemini-2.5-flash';
    } catch { return 'gemini-2.5-flash'; }
  }
  // ChatGPT / Gemini web: open the signed-in chat in a tab, let chat-bridge.js pick the strongest model,
  // send the request once and bring the answer back. The tab is shown while it writes, then focus returns.
  const CHAT_URL = { chatgpt: 'https://chatgpt.com/', 'gemini-web': 'https://gemini.google.com/app', grok: 'https://grok.com/' };
  const CHAT_NAME = { chatgpt: 'ChatGPT', 'gemini-web': 'Gemini', grok: 'Grok' };
  const waitTabLoaded = tabId => new Promise(resolve => { const done = (id, info) => { if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(done); resolve(); } }; chrome.tabs.onUpdated.addListener(done); setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); resolve(); }, 30000); });
  // A fresh chat in the tab cos_alpha_flow opened before for this site (never the user's own conversation tabs).
  async function openChatTab(target) {
    const name = CHAT_NAME[target];
    const [previous] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const saved = (await chrome.storage.session?.get?.('cosalphaChatTabs').catch(() => ({})))?.cosalphaChatTabs || {};
    let tab = saved[target] ? await chrome.tabs.get(saved[target]).catch(() => null) : null;
    if (tab) tab = await chrome.tabs.update(tab.id, { url: CHAT_URL[target], active: true });
    else tab = await chrome.tabs.create({ url: CHAT_URL[target], active: true, ...(previous?.windowId !== undefined ? { windowId: previous.windowId } : {}) });
    chrome.storage.session?.set?.({ cosalphaChatTabs: { ...saved, [target]: tab.id } }).catch(() => {});
    await waitTabLoaded(tab.id);
    const send = message => chrome.tabs.sendMessage(tab.id, message);
    let ready = await send({ type: 'COSALPHA_CHAT_PING' }).catch(() => null);
    if (!ready) { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['chat-bridge.js'] }).catch(() => {}); ready = await send({ type: 'COSALPHA_CHAT_PING' }).catch(() => null); }
    if (!ready) throw new Error(`Không gắn được vào tab ${name}. Hãy tải lại cos_alpha_flow (chrome://extensions → Reload) rồi thử lại.`);
    const back = () => { if (previous?.id && previous.id !== tab.id) chrome.tabs.update(previous.id, { active: true }).catch(() => {}); };
    return { tab, send, back, name };
  }
  // Live progress from chat-bridge.js (only for the ask this page started), so the user sees it is still working.
  let chatWatch = null;
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'COSALPHA_CHAT_PROGRESS' && chatWatch && sender.tab?.id === chatWatch.chat.tab.id) chatWatch.update(message);
    return false;
  });
  const CHAT_PHASE = { waiting: 'đã nhận lệnh, đang chờ trả lời', thinking: 'đang suy nghĩ', writing: 'đang viết', checking: 'viết xong, đang lấy câu trả lời' };
  // Default on: the chat used to write prompts is deleted after the answer is taken (setting in Prompt Assistant).
  const chatCleanupOn = async () => (await chrome.storage.local.get('cosalphaChatCleanup').catch(() => ({}))).cosalphaChatCleanup !== false;
  async function askWebChat(target, prompt, onStatus) {
    const chat = await openChatTab(target);
    onStatus?.(`${chat.name}: đang chọn model mạnh nhất và gửi lệnh…`);
    chatWatch = { chat, update: p => onStatus?.(`${chat.name} ${CHAT_PHASE[p.phase] || 'đang trả lời'}… ${p.seconds} giây${p.chars ? ` · ${Number(p.chars).toLocaleString('vi-VN')} ký tự` : ''}`) };
    let reply;
    try { reply = await chat.send({ type: 'COSALPHA_CHAT_ASK', prompt, best: true, timeoutSec: 360 }); }
    finally { chatWatch = null; }
    if (!reply?.ok) { chat.back(); throw new Error(reply?.error || `${chat.name} không trả lời.`); }
    reply.site = chat.name;
    if (await chatCleanupOn()) {
      onStatus?.(`Đã nhận câu trả lời. Đang xoá đoạn chat vừa tạo trên ${chat.name}…`);
      reply.cleanup = await chat.send({ type: 'COSALPHA_CHAT_DELETE', url: reply.conversationUrl }).catch(error => ({ ok: false, error: error.message }));
    }
    chat.back();
    return reply;
  }
  // "Lấy câu trả lời ngay": take what the chat has written so far (if the finish is not detected on its own).
  const takeChatNow = () => chatWatch?.chat.send({ type: 'COSALPHA_CHAT_TAKE' }).catch(() => {});
  const cleanupNote = reply => !reply.cleanup ? '' : reply.cleanup.ok ? ` Đã xoá đoạn chat trên ${reply.site}.` : ` Chưa xoá được đoạn chat trên ${reply.site} (${reply.cleanup.error || 'không rõ lý do'}), bạn xoá tay nhé.`;

  // Image / video generation through the user's own signed-in web accounts (ChatGPT, Grok, Gemini, Muse).
  const WEB_GEN = { chatgpt: 'chatgpt', grok: 'grok', gemini: 'gemini-web' };
  const MUSE_URLS = ['https://muse.ai/*', 'https://*.muse.ai/*'];
  async function museTab() {
    const tabs = await chrome.tabs.query({ url: MUSE_URLS });
    let tab = tabs.find(t => t.active) || tabs[0];
    if (!tab) { tab = await chrome.tabs.create({ url: 'https://muse.ai/', active: true }); await waitTabLoaded(tab.id); }
    let ok = await chrome.tabs.sendMessage(tab.id, { type: 'MUSEFLOW_CHECK_SESSION' }).catch(() => null);
    if (!ok) { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['muse-bridge.js'] }).catch(() => {}); ok = await chrome.tabs.sendMessage(tab.id, { type: 'MUSEFLOW_CHECK_SESSION' }).catch(() => null); }
    if (!ok) throw new Error('Không gắn được vào tab Muse. Hãy tải lại cos_alpha_flow rồi mở lại muse.ai.');
    return { tab, session: ok };
  }
  async function webGenerate({ provider, kind, prompt, aspect, duration, images, timeoutSec, requestId, signal, onStatus }) {
    if (provider === 'muse') {
      const { tab, session } = await museTab();
      if (!session.signedIn) throw new Error('Hãy đăng nhập muse.ai và mở một khung chat trong tab Muse rồi chạy lại.');
      onStatus?.(`Muse đang tạo ${kind === 'video' ? 'video' : 'ảnh'}…`);
      const stop = () => chrome.tabs.sendMessage(tab.id, { type: 'MUSEFLOW_STOP_GENERATION', requestId }).catch(() => {});
      signal?.addEventListener('abort', stop, { once: true });
      const ask = `${kind === 'video' ? `Create one video${duration ? `, ${duration} seconds long` : ''}, aspect ratio ${aspect}.` : `Create one image, aspect ratio ${aspect}.`}${images.length ? ' Use the attached image(s) as reference (same people, faces, outfits, products).' : ''}\n\n${prompt}`;
      try { return await chrome.tabs.sendMessage(tab.id, { type: 'MUSEFLOW_GENERATE', requestId, prompt: ask, mediaType: kind, referenceImages: images, size: aspect, timeoutSec }); }
      finally { signal?.removeEventListener('abort', stop); }
    }
    const target = WEB_GEN[provider];
    if (!target) throw new Error(`Không biết nguồn tạo "${provider}".`);
    if (kind === 'video' && provider === 'chatgpt') throw new Error('ChatGPT không tạo video. Hãy chọn Flow, Grok, Muse hoặc Gemini cho node video.');
    const chat = await openChatTab(target);
    onStatus?.(`${chat.name} đang tạo ${kind === 'video' ? 'video' : 'ảnh'}…`);
    const stop = () => chat.send({ type: 'COSALPHA_CHAT_STOP', requestId }).catch(() => {});
    signal?.addEventListener('abort', stop, { once: true });
    // Keep the chat tab in front for a moment so the site accepts the typing, then go back.
    setTimeout(chat.back, 15000);
    try { return await chat.send({ type: 'COSALPHA_CHAT_GENERATE', requestId, kind, prompt, aspect, duration, images, timeoutSec }); }
    finally { signal?.removeEventListener('abort', stop); }
  }
  async function webCheck(provider) {
    if (provider === 'muse') { const { session } = await museTab(); return { ready: Boolean(session.signedIn), text: session.signedIn ? 'Muse sẵn sàng' : 'Hãy đăng nhập muse.ai và mở khung chat' }; }
    const target = WEB_GEN[provider], tabs = await chrome.tabs.query({ url: CHAT_URL[target] + '*' });
    return { ready: true, text: tabs.length ? `${CHAT_NAME[target]}: đã có tab` : `${CHAT_NAME[target]}: sẽ tự mở tab khi chạy (hãy đăng nhập sẵn)` };
  }
  function cleanScript(text) { return text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').replace(/\*\*/g, '').trim(); }
  async function writeScript(target) {
    const status = $('#aiScriptStatus');
    try {
      const { system, user } = scriptRequest();
      if (target === 'gemini-api') {
        const apiKey = await app().getApiKey();
        if (!apiKey) throw new Error('Chưa có Gemini API key. Vào Cài đặt → Tạo bằng: Gemini API → dán key → Lưu (có thể chuyển lại về tab Flow sau, key vẫn được giữ). Hoặc bấm "Chép lệnh → ChatGPT".');
        status.className = 'warn'; status.textContent = 'Gemini đang viết kịch bản…';
        const typed = ($('#aiModel').value || '').trim();
        let result;
        if (typed) result = await geminiText(apiKey, typed, system, user);
        else {
          // No model typed: use the strongest Pro model this key can call, Flash if Pro is unavailable or out of quota.
          const best = await bestGeminiModel(apiKey);
          status.textContent = `Gemini (${best}) đang viết kịch bản…`;
          try { result = await geminiText(apiKey, best, system, user); }
          catch (error) { if (best === 'gemini-2.5-flash' || !/429|quota|exhausted|403|permission|billing/i.test(`${error.status} ${error.message}`)) throw error; result = await geminiText(apiKey, 'gemini-2.5-flash', system, user); }
        }
        $('#scriptInput').value = cleanScript(result.text);
        status.className = 'ok'; status.textContent = `Xong (${result.model}). Xem lại / sửa kịch bản bên dưới rồi bấm "Tạo node các cảnh".`;
      } else {
        const full = `${system}\n\n---\n${user}`;
        const name = target === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        status.className = 'warn'; status.textContent = `Đang mở ${name} và chọn model mạnh nhất…`;
        try {
          const reply = await askWebChat(target, full, text => { status.textContent = text; });
          $('#scriptInput').value = cleanScript(reply.text);
          status.className = 'ok'; status.textContent = `Xong (${name}${reply.model ? ` · ${reply.model}` : ''}). Xem lại / sửa kịch bản bên dưới rồi bấm "Tạo node các cảnh".${cleanupNote(reply)}${reply.warnings?.length ? ` (${reply.warnings.join(' ')})` : ''}`;
        } catch (error) {
          // Could not drive the chat tab: fall back to copy + paste by hand.
          let copied = false; try { await navigator.clipboard.writeText(full); copied = true; } catch { /* no clipboard */ }
          status.className = 'error';
          status.textContent = `${error.message || error}${copied ? ` Lệnh đã được chép sẵn: dán (Ctrl+V) vào ${name}, rồi chép câu trả lời vào ô Kịch bản bên dưới.` : ''}`;
        }
      }
    } catch (error) { status.className = 'error'; status.textContent = error.message || String(error); }
  }
  // "NHÂN VẬT: name — description" lines become Character Lock nodes before scenes are built.
  function createCharactersFromScript() {
    const a = app(), text = $('#scriptInput').value;
    const lines = [...text.matchAll(/^\s*NHÂN VẬT\s*:\s*(.+?)\s*[—–:-]\s*(.+?)\s*$/gim)];
    const typed = $('#aiCharacter')?.value.trim();
    const list = lines.map(m => ({ name: m[1].trim().slice(0, 40), description: m[2].trim() }));
    if (!list.length && typed) list.push({ name: 'Nhân vật chính', description: typed });
    let made = 0;
    list.slice(0, 3).forEach((ch, index) => {
      if (a.state.nodes.some(n => n.type === 'character' && String(n.data.name || '').trim().toLowerCase() === ch.name.toLowerCase())) return;
      const node = a.makeNode('character', -320, 40 + index * 380); node.data = { name: ch.name, description: ch.description, enabled: true }; a.state.nodes.push(node); made++;
    });
    if (made) a.setRunStatus(`Đã tạo ${made} node Khóa nhân vật từ kịch bản. Thêm ảnh nhân vật vào node để giữ mặt giống nhau.`, 'ok');
  }



  // ---------------- Prompts library, characters, history, Image → Prompt ----------------
  const extras = { pace: 0, prompts: [], characters: [], history: [], selectedChars: new Set(), promptSearch: '', historyFilter: 'all', i2p: null };
  const AI = () => window.CosAlphaAI;
  const store = { get: async key => (await chrome.storage.local.get(key))[key], set: (key, value) => chrome.storage.local.set({ [key]: value }) };
  async function loadExtras() {
    const got = await chrome.storage.local.get(['cosalphaPace', 'cosalphaPrompts', 'cosalphaCharacters', 'cosalphaHistory']).catch(() => ({}));
    extras.pace = Number(got.cosalphaPace) || 0; extras.prompts = got.cosalphaPrompts || []; extras.characters = got.cosalphaCharacters || []; extras.history = got.cosalphaHistory || [];
    renderQuickChars();
  }
  const slugOf = name => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'nv';

  // History
  async function addHistory({ node, prompt, status, error, albumId }) {
    extras.history.unshift({ id: app().uid('hist'), at: Date.now(), label: nodeLabel(node), kind: node.type === 'generateVideo' ? 'video' : 'image', prompt: String(prompt || '').slice(0, 2000), model: node.data.model || '', ratio: node.data.size || '', status, error: error ? String(error).slice(0, 300) : '', albumId: albumId || '', nodeId: node.id });
    extras.history = extras.history.slice(0, 300); await store.set('cosalphaHistory', extras.history);
    if (drawerMode === 'history') renderHistory();
  }
  async function renderHistory() {
    const body = $('#cosDrawerBody'); setDrawerTitle('Lịch sử');
    const list = extras.history.filter(h => extras.historyFilter === 'all' || h.status === extras.historyFilter);
    const day = t => new Date(t).toLocaleDateString('vi-VN'), time = t => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    let last = '';
    const rows = list.map(h => { const d = day(h.at), head = d !== last ? `<h4>${d}</h4>` : ''; last = d; return `${head}<div class="cos-h-item st-${h.status}"><div class="cos-h-thumb" data-hthumb="${esc(h.albumId)}">${h.kind === 'video' ? 'Video' : 'Ảnh'}</div><div class="cos-h-text"><b>${esc(h.label)}</b><small>${time(h.at)} · ${h.status === 'success' ? 'xong' : 'lỗi'}${h.model ? ' · ' + esc(h.model) : ''}${h.ratio ? ' · ' + esc(h.ratio) : ''}</small><p>${esc(h.prompt.slice(0, 180))}</p>${h.error ? `<small class="error">${esc(h.error)}</small>` : ''}</div><div class="cos-h-actions"><button data-hreuse="${esc(h.id)}" title="Đưa prompt này vào tab Tạo">Dùng lại</button><button data-hsave="${esc(h.id)}" title="Lưu vào thư viện Prompts">Lưu</button></div></div>`; }).join('');
    body.innerHTML = `<div class="cos-a-filters">${[['all', 'Tất cả'], ['success', 'Xong'], ['error', 'Lỗi']].map(([k, t]) => `<button data-hf="${k}" class="${extras.historyFilter === k ? 'active' : ''}">${t} ${k === 'all' ? extras.history.length : extras.history.filter(h => h.status === k).length}</button>`).join('')}<button data-hclear="1" class="danger">Xoá lịch sử</button></div><div class="cos-h-list">${rows || '<p class="cos-empty">Chưa có lượt tạo nào.</p>'}</div>`;
    for (const el of body.querySelectorAll('[data-hthumb]')) { const id = el.dataset.hthumb; if (!id) continue; albumItem(id).then(item => { if (!item) return; const url = URL.createObjectURL(item.blob); albumState.urls.push(url); el.innerHTML = item.kind === 'video' ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="">`; }).catch(() => {}); }
  }

  // Prompt library
  async function savePrompt(text, title) {
    text = String(text || '').trim(); if (!text) return false;
    extras.prompts.unshift({ id: app().uid('prompt'), title: (title || text.split('\n')[0]).slice(0, 60), text, at: Date.now() });
    await store.set('cosalphaPrompts', extras.prompts); return true;
  }
  function renderPrompts() {
    const body = $('#cosDrawerBody'); setDrawerTitle('Thư viện Prompt');
    const q = extras.promptSearch.toLowerCase();
    const list = extras.prompts.filter(p => !q || (p.title + ' ' + p.text).toLowerCase().includes(q));
    body.innerHTML = `<div class="cos-p-add"><input id="cosPromptTitle" placeholder="Tên (tuỳ chọn)"><textarea id="cosPromptText" rows="3" placeholder="Dán prompt muốn lưu…"></textarea><div class="cos-q-controls"><button data-padd="1" class="primary">Lưu prompt</button>${isPanel ? '<button data-pfromgen="1" title="Lưu nội dung đang soạn ở tab Tạo">Lưu từ tab Tạo</button>' : ''}<button data-pexport="1">Xuất</button><label class="cos-a-upload">Nhập<input id="cosPromptImport" type="file" accept=".json,.txt" hidden></label></div></div><input id="cosPromptSearch" class="cos-search" placeholder="Tìm prompt…" value="${esc(extras.promptSearch)}"><div class="cos-p-list">${list.map(p => `<div class="cos-p-item"><b>${esc(p.title)}</b><p>${esc(p.text.slice(0, 220))}</p><div class="cos-a-actions"><button data-puse="${esc(p.id)}">${isPanel ? 'Dùng' : 'Chép'}</button><button data-pedit="${esc(p.id)}"><i data-ic="pencil"></i>Sửa</button><button data-pdel="${esc(p.id)}" title="Xoá"><i data-ic="trash-2"></i></button></div></div>`).join('') || '<p class="cos-empty">Chưa có prompt nào. Lưu prompt hay dùng để chọn lại nhanh.</p>'}</div>`;
  }
  function usePromptText(text) {
    if (isPanel) { const box = $('#qpPrompts'); box.value = box.value.trim() ? `${box.value.trim()}\n\n${text}` : text; updateQuickCount(); $('[data-qp="gen"]').click(); app().setRunStatus('Đã đưa prompt vào tab Tạo.', 'ok'); }
    else { navigator.clipboard.writeText(text).catch(() => {}); app().setRunStatus('Đã chép prompt. Dán (Ctrl+V) vào node Câu lệnh.', 'ok'); }
  }

  // Character library (@mention in the quick "Tạo" tab)
  function renderCharacters() {
    const body = $('#cosDrawerBody'); setDrawerTitle('Nhân vật');
    body.innerHTML = `<p class="cos-hint">Lưu nhân vật một lần, dùng lại ở mọi project: chọn ở tab Tạo hoặc gõ <b>@tên_gọn</b> trong prompt. Ảnh nhân vật được gửi làm ảnh tham chiếu và mô tả được thêm vào prompt để giữ mặt giống nhau.</p><div class="cos-c-form"><label class="cos-c-pick" title="Chọn ảnh khuôn mặt / toàn thân"><span id="cosCharPreview">Ảnh</span><input id="cosCharImage" type="file" accept="image/*" hidden></label><div><input id="cosCharName" placeholder="Tên, vd: Lan"><textarea id="cosCharDesc" rows="2" placeholder="Ngoại hình cố định (tiếng Việt hoặc Anh): tuổi, mặt, tóc, dáng, trang phục"></textarea><button data-cadd="1" class="primary">Lưu nhân vật</button></div></div><div class="cos-c-list">${extras.characters.map(c => `<div class="cos-c-item">${c.image ? `<img src="${c.image}" alt="">` : '<span class="cos-q-kind">Chưa có ảnh</span>'}<div class="cos-q-text"><b>${esc(c.name)} <code>@${esc(c.slug)}</code></b><small>${esc(c.description || '')}</small></div><button data-cdel="${esc(c.id)}" title="Xoá"><i data-ic="trash-2"></i></button></div>`).join('') || '<p class="cos-empty">Chưa có nhân vật nào.</p>'}</div>`;
  }
  function renderQuickChars() {
    const box = $('#qpChars'); if (!box) return;
    box.innerHTML = extras.characters.length ? extras.characters.map(c => `<button type="button" class="qp-chip ${extras.selectedChars.has(c.id) ? 'on' : ''}" data-qchar="${esc(c.id)}" title="@${esc(c.slug)} · ${esc(c.description || '')}">${c.image ? `<img src="${c.image}" alt="">` : ''} ${esc(c.name)}</button>`).join('') + '<button type="button" class="qp-chip" data-qcharmanage="1">Thêm</button>' : '<button type="button" class="qp-chip" data-qcharmanage="1">Thêm nhân vật</button>';
  }
  function charactersFor(promptText) {
    const mentioned = new Set([...String(promptText).matchAll(/@([a-z0-9_]{1,24})/gi)].map(m => m[1].toLowerCase()));
    return extras.characters.filter(c => extras.selectedChars.has(c.id) || mentioned.has(c.slug));
  }

  // Image → Prompt (from the right-click menu on any web image, or a file)
  async function showI2P(item) {
    extras.i2p = { image: item.image, result: null, tab: 'en' };
    $('#i2pModal').classList.remove('hidden'); $('#i2pImage').src = item.image; $('#i2pOut').value = ''; $('#i2pStatus').className = 'warn'; $('#i2pStatus').textContent = 'Gemini đang đọc ảnh… (10–30 giây)';
    try {
      const out = await AI().text({ system: AI().I2P_SYSTEM, user: 'Describe this image.', images: [item.image], json: true, temperature: 0.4 });
      let parsed; try { parsed = JSON.parse(AI().clean(out.text)); } catch { parsed = { en: AI().clean(out.text), vi: '', short: '' }; }
      extras.i2p.result = parsed; showI2PTab('en');
      $('#i2pStatus').className = 'ok'; $('#i2pStatus').textContent = `Xong (${out.model}).`;
    } catch (error) { $('#i2pStatus').className = 'error'; $('#i2pStatus').textContent = error.message; }
  }
  function showI2PTab(tab) { extras.i2p.tab = tab; document.querySelectorAll('[data-i2ptab]').forEach(b => b.classList.toggle('active', b.dataset.i2ptab === tab)); const r = extras.i2p.result || {}; $('#i2pOut').value = tab === 'json' ? JSON.stringify(r, null, 2) : r[tab] || ''; }
  async function i2pAction(action) {
    const text = $('#i2pOut').value.trim(), image = extras.i2p?.image;
    if (action === 'copy') { await navigator.clipboard.writeText(text); $('#i2pStatus').textContent = 'Đã chép.'; return; }
    if (action === 'save') { await savePrompt(text, 'Từ ảnh ' + new Date().toLocaleTimeString('vi-VN')); $('#i2pStatus').textContent = 'Đã lưu vào thư viện Prompts.'; return; }
    if (action === 'ref' && image) {
      const blob = await (await fetch(image)).blob(), file = new File([blob], 'anh-tham-chieu.png', { type: blob.type || 'image/png' });
      if (isPanel) await addQuickRefs([file]); else await app().addImageInputs([file]);
      $('#i2pStatus').textContent = isPanel ? 'Đã thêm ảnh vào ảnh tham chiếu của tab Tạo.' : 'Đã thêm node Ảnh đầu vào.'; return;
    }
    if (action === 'use') {
      if (isPanel) usePromptText(text);
      else { const a = app(), node = a.makeNode('prompt', 120, 120); node.data = { text }; a.createUndoSnapshot('Prompt từ ảnh'); a.state.nodes.push(node); a.render(); a.saveState(); }
      $('#i2pModal').classList.add('hidden');
    }
  }
  async function checkPendingI2P() {
    const item = await store.get('cosalphaI2P').catch(() => null);
    if (!item?.image || item.consumed || Date.now() - item.at > 5 * 60000 || inactive) return;
    await store.set('cosalphaI2P', { ...item, consumed: true, image: '' });
    showI2P(item);
  }

  // "Lưu ảnh này vào Album" from the right-click menu: the side panel may open after the image was stored, so also check at start.
  let inboxBusy = false;
  async function checkPendingInbox() {
    if (inboxBusy || inactive) return;
    inboxBusy = true;
    try {
      const inbox = await store.get('cosalphaAlbumInbox').catch(() => null);
      if (!inbox?.image || inbox.consumed || Date.now() - inbox.at > 5 * 60000) return;
      await store.set('cosalphaAlbumInbox', { consumed: true });
      const blob = await (await fetch(inbox.image)).blob();
      await putAlbumItem({ id: app().uid('album'), project: albumState.current, kind: 'image', blob, prompt: '', label: (() => { try { return new URL(inbox.pageUrl).hostname; } catch { return 'web'; } })(), createdAt: Date.now(), starred: false });
      app().setRunStatus(`Đã lưu ảnh vào Album "${albumState.current}".`, 'ok');
      if (drawerMode === 'album') renderAlbum();
    } catch (error) { app().setRunStatus(`Không lưu được ảnh vào Album: ${error.message}`, 'error'); }
    finally { inboxBusy = false; }
  }

  const extraRenderers = { album: () => renderAlbum(), prompts: renderPrompts, characters: renderCharacters, history: renderHistory };
  function setDrawerTitle(text) { const el = $('#cosDrawerTitle'); if (el) el.textContent = text; }

  async function onExtrasClick(event) {
    const t = event.target.closest('button'); if (!t) return false;
    const d = t.dataset;
    if (d.hf) { extras.historyFilter = d.hf; renderHistory(); }
    else if (d.hclear) { if (confirm('Xoá toàn bộ lịch sử? (Album không bị ảnh hưởng.)')) { extras.history = []; await store.set('cosalphaHistory', []); renderHistory(); } }
    else if (d.hreuse || d.hsave) { const h = extras.history.find(x => x.id === (d.hreuse || d.hsave)); if (!h) return true; if (d.hreuse) usePromptText(h.prompt); else { await savePrompt(h.prompt, h.label); app().setRunStatus('Đã lưu vào thư viện Prompts.', 'ok'); } }
    else if (d.padd) { if (await savePrompt($('#cosPromptText').value, $('#cosPromptTitle').value)) renderPrompts(); }
    else if (d.pfromgen) { if (await savePrompt($('#qpPrompts').value)) renderPrompts(); }
    else if (d.puse) { const p = extras.prompts.find(x => x.id === d.puse); if (p) usePromptText(p.text); }
    else if (d.pedit) { const p = extras.prompts.find(x => x.id === d.pedit); if (!p) return true; const text = prompt('Sửa prompt:', p.text); if (text === null) return true; p.text = text.trim() || p.text; await store.set('cosalphaPrompts', extras.prompts); renderPrompts(); }
    else if (d.pdel) { extras.prompts = extras.prompts.filter(x => x.id !== d.pdel); await store.set('cosalphaPrompts', extras.prompts); renderPrompts(); }
    else if (d.pexport) { const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'cos_alpha_flow-prompts', prompts: extras.prompts }, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'cos_alpha_flow-prompts.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
    else if (d.cadd) {
      const name = $('#cosCharName').value.trim(); if (!name) { $('#cosCharName').focus(); return true; }
      let slug = slugOf(name); while (extras.characters.some(c => c.slug === slug)) slug += '2';
      extras.characters.push({ id: app().uid('char'), name, slug, description: $('#cosCharDesc').value.trim(), image: extras.pendingCharImage || '' });
      extras.pendingCharImage = ''; await store.set('cosalphaCharacters', extras.characters); renderCharacters(); renderQuickChars();
    }
    else if (d.cdel) { extras.characters = extras.characters.filter(c => c.id !== d.cdel); extras.selectedChars.delete(d.cdel); await store.set('cosalphaCharacters', extras.characters); renderCharacters(); renderQuickChars(); }
    else return false;
    return true;
  }
  // Small square thumbnail so character images stay light in chrome.storage.
  async function shrinkImage(file, size = 512) {
    const bitmap = await createImageBitmap(file), scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); return canvas.toDataURL('image/jpeg', 0.9);
  }
  async function onExtrasChange(event) {
    const t = event.target;
    if (t.id === 'cosPace') { extras.pace = Number(t.value) || 0; await store.set('cosalphaPace', extras.pace); }
    else if (t.id === 'cosCharImage' && t.files[0]) { extras.pendingCharImage = await shrinkImage(t.files[0]); $('#cosCharPreview').innerHTML = `<img src="${extras.pendingCharImage}" alt="">`; }
    else if (t.id === 'cosPromptImport' && t.files[0]) {
      const text = await t.files[0].text(); let added = 0;
      try { const json = JSON.parse(text); for (const p of json.prompts || []) { if (p?.text) { extras.prompts.push({ id: app().uid('prompt'), title: String(p.title || p.text).slice(0, 60), text: String(p.text), at: Date.now() }); added++; } } }
      catch { for (const block of text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)) { extras.prompts.push({ id: app().uid('prompt'), title: block.split('\n')[0].slice(0, 60), text: block, at: Date.now() }); added++; } }
      await store.set('cosalphaPrompts', extras.prompts); renderPrompts(); app().setRunStatus(`Đã nhập ${added} prompt.`, 'ok');
    }
    else return false;
    return true;
  }

  // ---------------- Two views: side panel (next to Flow) / full tab ----------------
  const isPanel = new URLSearchParams(location.search).get('view') === 'panel';
  const instanceId = Math.random().toString(36).slice(2);
  let windowId = null, inactive = false;
  chrome.windows?.getCurrent?.().then(win => { windowId = win?.id ?? null; }).catch(() => {});
  async function openFullView() {
    try { await app().saveState(); } catch { /* still switch */ }
    const fullUrl = chrome.runtime.getURL('app.html');
    const tabs = (await chrome.tabs.query({ url: fullUrl + '*' })).filter(tab => !String(tab.url).includes('view=panel'));
    if (tabs[0]?.id) { await chrome.tabs.update(tabs[0].id, { active: true }); await chrome.tabs.reload(tabs[0].id); if (tabs[0].windowId !== undefined) chrome.windows.update(tabs[0].windowId, { focused: true }); }
    else await chrome.tabs.create({ url: fullUrl });
    if (isPanel) window.close();
  }
  function openPanelView() {
    // sidePanel.open needs the click's user gesture, so call it before any await.
    if (!chrome.sidePanel?.open || windowId === null) { app().setRunStatus('Chrome này chưa hỗ trợ bảng bên (cần Chrome 116 trở lên).', 'error'); return; }
    chrome.sidePanel.open({ windowId }).then(async () => {
      try { await app().saveState(); } catch { /* ignore */ }
      inactive = true;
      const tab = await chrome.tabs.getCurrent(); if (tab?.id) chrome.tabs.remove(tab.id);
    }).catch(error => app().setRunStatus(`Không mở được bảng bên: ${error.message}`, 'error'));
  }
  // Only one place drives Flow at a time: a newly opened view claims, the idle older one steps aside.
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('cosalpha-instance') : null;
  function goInactive(text) { inactive = true; $('#instanceText').textContent = text; $('#instanceModal').classList.remove('hidden'); }
  channel?.addEventListener('message', event => {
    const msg = event.data || {}; if (msg.from === instanceId) return;
    if (msg.type === 'claim') {
      if (app()?.state.isRunning && !inactive) channel.postMessage({ type: 'busy', from: instanceId, to: msg.from });
      else { clearTimeout(window.__cosAlphaSaveGuard); goInactive(`cos_alpha_flow vừa được mở ở ${msg.panel ? 'bảng bên' : 'một tab toàn màn hình'}. Chỉ một chỗ được chạy để không gửi trùng lệnh cho Flow. Bấm "Dùng ở đây" để lấy lại (tải lại bản đã lưu mới nhất).`); }
    } else if (msg.type === 'busy' && msg.to === instanceId) goInactive('cos_alpha_flow đang chạy hàng đợi ở chỗ khác (bảng bên hoặc tab khác). Chờ chạy xong hoặc bấm Dừng ở đó, rồi bấm "Dùng ở đây".');
  });
  function claimInstance() { channel?.postMessage({ type: 'claim', from: instanceId, panel: isPanel }); }

  // Opening cos_alpha_flow also opens Google Flow (once, only when no Flow tab exists) so the user can sign in right away.
  const FLOW_HOME = 'https://flow.google.com/';
  async function setupAutoFlow() {
    const box = $('#cosAutoFlow');
    const enabled = (await store.get('cosalphaAutoOpenFlow').catch(() => undefined)) !== false;
    if (box) { box.checked = enabled; box.onchange = () => store.set('cosalphaAutoOpenFlow', box.checked); }
    if (!enabled) return;
    // Give the instance lock a moment: only the view that is actually in use opens Flow.
    setTimeout(async () => {
      if (inactive || app().providerName() !== 'flow') return;
      try {
        const tabs = await chrome.tabs.query({ url: ['https://flow.google.com/*', 'https://labs.google/fx/*'] });
        if (tabs.length) return;
        const win = await chrome.windows.getCurrent();
        // Side panel: show Flow in the main area beside it. Full tab: open Flow next to it without leaving the canvas.
        await chrome.tabs.create({ url: FLOW_HOME, active: isPanel, windowId: win.id });
        app().setRunStatus(isPanel ? 'Đã mở Google Flow. Đăng nhập rồi mở một project để bắt đầu.' : 'Đã mở Google Flow ở tab bên cạnh. Đăng nhập rồi mở một project để bắt đầu.', 'ok');
      } catch (error) { console.warn('[cos_alpha_flow] auto open Flow', error); }
    }, 900);
  }

  // ---------------- Quick generate (side panel "Tạo" tab) ----------------
  const quick = { kind: 'image', refs: [], batch: 0 };
  // Prompts are separated by a blank line or start with "1. ", "2) " …
  const splitPromptText = text => text.replace(/\r/g, '').trim().split(/\n\s*\n|\n(?=\s*\d+\s*[.)]\s)/).map(block => block.replace(/^\s*\d+\s*[.)]\s*/, '').trim()).filter(Boolean);
  function parsePrompts() {
    const text = $('#qpPrompts').value.replace(/\r/g, '').trim(); if (!text) return [];
    if (!$('#qpSplit').checked) return [text];
    return splitPromptText(text);
  }
  function updateQuickCount() { const n = parsePrompts().length, qty = Number($('#qpQty').value) || 1; $('#qpCount').textContent = `${n} prompt → ${n * qty} ${quick.kind === 'video' ? 'video' : 'ảnh'}`; const chars = $('#qpChars2'); if (chars) chars.textContent = `${$('#qpPrompts').value.length.toLocaleString('vi-VN')} ký tự`; }
  function renderQuickRefs() {
    const zone = $('#qpRefs');
    zone.innerHTML = quick.refs.length ? quick.refs.map((ref, index) => `<figure><img src="${ref.url}" alt=""><button data-qref="${index}" title="Bỏ ảnh này">×</button></figure>`).join('') + '<span class="qp-add">Thêm ảnh</span>' : '<span class="qp-drop"><i data-ic="image-up"></i>Chọn ảnh / kéo thả / dán vào đây</span>';
    const count = $('#qpRefCount'); if (count) count.textContent = `${quick.refs.length}/5`;
  }
  const fileToDataUrl = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
  async function addQuickRefs(files) {
    for (const file of files) if (/^image\//.test(file.type)) { if (quick.refs.length >= 5) { $('#qpStatus').textContent = 'Tối đa 5 ảnh tham chiếu (video dùng tối đa 3).'; break; } quick.refs.push({ url: await fileToDataUrl(file), name: file.name }); }
    renderQuickRefs();
  }
  function quickGenerate() {
    const a = app(), prompts = parsePrompts(), status = $('#qpStatus');
    if (!prompts.length) { status.className = 'cos-hint error'; status.textContent = 'Hãy nhập ít nhất một prompt.'; return; }
    const isVideo = quick.kind === 'video', qty = Number($('#qpQty').value) || 1, ratio = $('#qpRatio').value, model = $('#qpModel').value.trim(), duration = Number($('#qpDuration').value) || 8, vidMode = $('#qpVidMode').value === 'firstFrame' ? 'firstFrame' : 'ingredients', resolution = $('#qpRes').value, voice = $('#qpVoice').value.trim(), useChar = $('#qpUseChar').checked;
    a.createUndoSnapshot('Tạo nhanh');
    quick.batch++;
    const visible = a.state.nodes.filter(n => !n.data?.dockOnly), baseY = visible.length ? Math.max(...visible.map(n => n.y)) + 520 : 80, stamp = new Date().toTimeString().slice(0, 5);
    const refNodes = quick.refs.map((ref, index) => { const node = a.makeNode('imageInput', 60, baseY + index * 330); node.data = { localDataUrl: ref.url, name: ref.name }; a.state.nodes.push(node); return node; });
    const genIds = [], styleText = AI()?.STYLES[$('#qpStyle').value]?.text || '', charNodes = new Map();
    const charNode = c => { if (!charNodes.has(c.id)) { const node = a.makeNode('imageInput', 60, baseY + (refNodes.length + charNodes.size) * 330); node.data = { localDataUrl: c.image, name: c.name, role: 'model' }; a.state.nodes.push(node); charNodes.set(c.id, node); } return charNodes.get(c.id); };
    prompts.forEach((raw, i) => {
      // @mentions and selected characters: name in the prompt, appearance appended, face image attached.
      const chars = charactersFor(raw);
      let text = raw.replace(/@([a-z0-9_]{1,24})/gi, (match, slug) => extras.characters.find(c => c.slug === slug.toLowerCase())?.name || match);
      if (chars.length) text += `\n\nCharacters (keep exactly the same face, hair, body and outfit as their reference photos): ${chars.map(c => `${c.name}${c.description ? ` — ${c.description}` : ''}`).join('; ')}.`;
      if (styleText) text += `\n\nStyle: ${styleText}.`;
      const x = 420 + i * 700, prompt = a.makeNode('prompt', x, baseY); prompt.data = { text }; a.state.nodes.push(prompt);
      const promptChars = chars.filter(c => c.image).map(charNode);
      for (let q = 0; q < qty; q++) {
        const gen = a.makeNode(isVideo ? 'generateVideo' : 'generateImage', x + 330, baseY + q * 560);
        const label = `Nhanh ${stamp} · ${i + 1}${qty > 1 ? `.${q + 1}` : ''}`;
        gen.data = isVideo ? { model, size: ratio === '16:9' || ratio === '4:3' ? '16:9' : '9:16', duration, referenceMode: vidMode, resolution, voice, continuity: false, status: 'idle', useCharacters: useChar, sceneLabel: label } : { model, size: ratio, status: 'idle', useCharacters: useChar, sceneLabel: label };
        a.state.nodes.push(gen);
        a.state.edges.push({ id: a.uid('edge'), source: prompt.id, sourcePort: 'text', target: gen.id, targetPort: 'prompt' });
        [...promptChars, ...refNodes].forEach(ref => a.state.edges.push({ id: a.uid('edge'), source: ref.id, sourcePort: 'image', target: gen.id, targetPort: 'reference' }));
        genIds.push(gen.id);
      }
    });
    a.render(); a.saveState();
    genIds.forEach(id => a.executeGenerationNode(id));
    status.className = 'cos-hint ok'; status.textContent = `Đã đưa ${genIds.length} lượt vào hàng đợi. Xem tiến độ ở tab Hàng đợi hoặc bảng nổi trên Flow.`;
    refresh(true);
  }
  let assistantUndo = '';
  async function promptAssistant() {
    const box = $('#qpPrompts'), status = $('#qpStatus'), text = box.value.trim();
    if (!text) { status.className = 'cos-hint error'; status.textContent = 'Hãy nhập prompt (tiếng Việt cũng được) rồi bấm Prompt Assistant.'; return; }
    status.className = 'cos-hint warn'; status.textContent = 'Gemini đang viết lại prompt…';
    try {
      const style = AI().STYLES[$('#qpStyle').value]?.text;
      const out = await AI().text({ system: AI().ASSISTANT_SYSTEM + (quick.kind === 'video' ? ' These are VIDEO prompts: describe the action, the camera movement and the pacing for about 8 seconds.' : ''), user: text + (style ? `\n\n(Target style: ${style})` : '') });
      assistantUndo = box.value; box.value = AI().clean(out.text); updateQuickCount();
      status.className = 'cos-hint ok'; status.innerHTML = `Đã viết lại bằng ${esc(out.model)}. <button type="button" id="qpUndoAssist">Hoàn tác</button>`;
      $('#qpUndoAssist').onclick = () => { box.value = assistantUndo; updateQuickCount(); status.textContent = 'Đã hoàn tác.'; };
    } catch (error) { status.className = 'cos-hint error'; status.textContent = error.message; }
  }
  function applyPreset(key) {
    const preset = AI().PRESETS[key]; if (!preset) return;
    $('#qpPrompts').value = preset.prompts.join('\n\n'); $('#qpSplit').checked = true; updateQuickCount();
    $('#qpStatus').className = 'cos-hint'; $('#qpStatus').textContent = quick.refs.length ? `Đã điền ${preset.prompts.length} prompt từ mẫu.` : `Đã điền ${preset.prompts.length} prompt. Mẫu này cần 1 ảnh tham chiếu: thêm ảnh ở ô bên dưới.`;
  }
  // ---------------- Prompt Assistant (dialog): idea / script / SRT → a full set of prompts ----------------
  const PA_TEMPLATES = {
    'Kể chuyện': [
      ['horror', 'Kinh dị bí ẩn', 'ghost', ['#1b1b2f', '#4a1c2c'], 'dark mysterious horror atmosphere, foggy abandoned places, flickering light, desaturated cold tones, suspenseful framing'],
      ['myth', 'Thần thoại', 'landmark', ['#3a2a10', '#8a5a1c'], 'epic mythological painting look, gods and heroes, dramatic sky, golden rim light, classical oil-painting texture'],
      ['pov', 'Góc nhìn thứ nhất', 'eye', ['#1d2a33', '#3d5566'], 'first-person POV shots, hands visible in frame, immersive wide lens, natural motion'],
      ['history', 'Lịch sử cổ đại', 'swords', ['#2b2216', '#6b4b2a'], 'historically accurate ancient setting, period costumes, cinematic documentary realism, warm dusty light'],
      ['clay', 'Đất sét tiền sử', 'footprints', ['#3b2a1f', '#a0653a'], 'prehistoric claymation stop-motion look, handmade plasticine characters with fingerprints, miniature cave sets, warm firelight'],
      ['folk', 'Cổ tích Việt', 'book-open', ['#1f3326', '#c9933a'], 'Vietnamese folk tale illustration, lacquer painting and Dong Ho print influences, warm earthy colors, village scenery']
    ],
    'Hoạt hình': [
      ['cute3d', 'Hoạt hình 3D', 'smile', ['#2a1f4a', '#e36a9a'], 'cute 3D animated film look, soft rounded characters, expressive faces, vibrant colors, global illumination'],
      ['anime', 'Anime', 'drama', ['#13284a', '#5a8fd8'], 'Japanese anime style, clean line art, cel shading, dramatic skies, dynamic angles'],
      ['hand', 'Vẽ tay ấm áp', 'palette', ['#2f2a1c', '#d8b36a'], 'warm hand-painted 2D animation, watercolor backgrounds, gentle pastel palette, nostalgic mood'],
      ['pixel', 'Pixel art', 'gamepad-2', ['#1a1a33', '#6b5bd6'], 'detailed 16-bit pixel art, limited palette, crisp pixels, retro game scene']
    ],
    'Đời sống': [
      ['travel', 'Vlog du lịch', 'plane', ['#0f2c3a', '#2f9bbf'], 'bright travel vlog look, scenic destinations, handheld cinematic shots, vivid natural color'],
      ['food', 'Nấu ăn', 'utensils', ['#3a1f12', '#d9783a'], 'appetizing food photography, steam and texture close-ups, warm kitchen light, shallow depth of field'],
      ['fashion', 'Thời trang', 'shirt', ['#2a1630', '#b45fa8'], 'high-end fashion editorial, glossy commercial lighting, elegant poses, magazine quality'],
      ['product', 'Review sản phẩm', 'shopping-bag', ['#1e2430', '#7d8aa3'], 'premium product commercial, clean backgrounds, hero shots and macro details, softbox lighting'],
      ['estate', 'Bất động sản', 'building-2', ['#1c2a2a', '#5aa39a'], 'architectural real-estate photography, wide interiors, bright natural light, straight verticals']
    ],
    'Giáo dục': [
      ['science', 'Khoa học', 'flask-conical', ['#10263a', '#3fa0d8'], 'clear educational science visuals, clean 3D diagrams look, bright neutral background, labeled-free illustrations'],
      ['explain', 'Giải thích dễ hiểu', 'lightbulb', ['#2d2a12', '#e0c23a'], 'friendly explainer illustrations, simple shapes, bold colors, clear visual metaphors'],
      ['data', 'Infographic', 'chart-bar-big', ['#16213a', '#5470d6'], 'modern flat infographic style, minimal icons, clean layout, no text']
    ],
    'Thư giãn': [
      ['rain', 'Mưa lofi', 'cloud-rain', ['#1a2233', '#4a6a8a'], 'cozy lofi rainy mood, window with raindrops, warm lamp light, soft muted colors'],
      ['forest', 'Rừng yên bình', 'trees', ['#12261a', '#3f8a55'], 'peaceful forest nature scenes, morning mist, sun rays through trees, calm and slow'],
      ['ocean', 'Đại dương', 'waves', ['#0c2233', '#2a7fb0'], 'calm ocean scenes, gentle waves, soft horizon light, serene blue palette'],
      ['fire', 'Lửa trại', 'flame', ['#2a140c', '#d8622a'], 'cozy campfire at night, glowing embers, starry sky, warm orange light']
    ],
    'Thể dục': [
      ['gym', 'Tập gym', 'dumbbell', ['#1e1e1e', '#8a8a8a'], 'energetic gym fitness shots, dramatic side light, sweat and muscle detail, dynamic angles'],
      ['yoga', 'Yoga', 'heart-pulse', ['#1d2a26', '#7fbfa8'], 'calm yoga in bright natural light, minimal studio or nature, soft pastel tones'],
      ['run', 'Chạy bộ', 'mountain-snow', ['#14243a', '#e08a3a'], 'outdoor running at sunrise, motion energy, scenic trails and city parks, sporty commercial look']
    ]
  };
  const pa = { engine: 'gemini-api', cat: 'Kể chuyện', template: '', refs: [], view: 'form', result: null };
  function paRenderCats() {
    $('#paCats').innerHTML = Object.keys(PA_TEMPLATES).map(cat => `<button type="button" data-pacat="${esc(cat)}" class="${cat === pa.cat ? 'active' : ''}">${esc(cat)}</button>`).join('');
    $('#paCards').innerHTML = `<button type="button" class="pa-card pa-none ${pa.template ? '' : 'active'}" data-patpl="" title="Không dùng mẫu"><i data-ic="circle-slash" data-size="28"></i><span>Không dùng mẫu</span></button>`
      + PA_TEMPLATES[pa.cat].map(([key, name, icon, [c1, c2]]) => `<button type="button" class="pa-card ${pa.template === key ? 'active' : ''}" data-patpl="${key}" style="background:linear-gradient(160deg,${c1},${c2})"><i data-ic="${icon}" data-size="28"></i><span>${esc(name)}</span></button>`).join('');
  }
  const paTemplate = () => Object.values(PA_TEMPLATES).flat().find(t => t[0] === pa.template);
  function paRenderRefs() {
    const zone = $('#paRefs');
    zone.innerHTML = pa.refs.length ? pa.refs.map((ref, i) => `<figure><img src="${ref.url}" alt=""><button data-paref="${i}" title="Bỏ ảnh này">×</button></figure>`).join('') + '<span class="qp-add">Thêm ảnh</span>' : '<span class="qp-drop"><i data-ic="image-up"></i>Chọn ảnh / kéo thả</span>';
    $('#paRefCount').textContent = `${pa.refs.length}/5`;
  }
  async function paAddRefs(files) { for (const file of files) if (/^image\//.test(file.type) && pa.refs.length < 5) pa.refs.push({ url: await fileToDataUrl(file), name: file.name }); paRenderRefs(); }
  function parseSrt(text) {
    if (!/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text)) return null;
    return text.replace(/\r/g, '').split(/\n\s*\n/).map(block => block.split('\n').filter(line => line.trim() && !/^\d+$/.test(line.trim()) && !/-->/.test(line)).join(' ').trim()).filter(Boolean);
  }
  function paRequest() {
    const input = $('#paInput').value.trim(); if (!input) throw new Error('Hãy nhập ý tưởng, kịch bản hoặc phụ đề SRT.');
    const kind = $('#paKind').value, cues = parseSrt(input), total = Number($('#paTotal').value) || 0, per = Number($('#paPer').value) || (kind === 'video' ? 8 : 5);
    let count = parseInt($('#paCount').value, 10);
    // Default: one prompt, the best of several drafts. More only when asked (count, SRT lines, total length).
    if (!(count > 0)) count = cues ? cues.length : total ? Math.ceil(total / per) : 1;
    count = Math.max(1, Math.min(40, count));
    const ratio = $('#paRatio .active')?.dataset.ratio || '9:16', tpl = paTemplate();
    const style = $('#paStyle').value.trim() || tpl?.[4] || '';
    const detail = { short: '1–2 sentences each', medium: '3–4 sentences each', long: '5–7 detailed sentences each' }[$('#paDetail').value];
    const rules = [
      count === 1 ? `Write exactly 1 ${kind === 'video' ? 'VIDEO' : 'IMAGE'} prompt in ${$('#paLang').value}, ${detail.replace(' each', '')}. Think of several options silently and output only the single strongest one.` : `Write exactly ${count} ${kind === 'video' ? 'VIDEO' : 'IMAGE'} prompts in ${$('#paLang').value}, ${detail}.`,
      style && `Visual style for every prompt: ${style}.`,
      `Aspect ratio ${ratio}; compose every shot for ${ratio}.`,
      $('#paLight').value && `Lighting: ${$('#paLight').value}.`,
      $('#paAngle').value && `Camera: ${$('#paAngle').value}.`,
      $('#paTone').value.trim() && `Tone / genre: ${$('#paTone').value.trim()}.`,
      count > 1 && $('#paStory').checked && 'The prompts are consecutive shots of ONE continuous story (a storyboard): each shot follows from the previous one, with a hook at the start and a clear ending.',
      count > 1 && $('#paConsistent').checked && 'Keep characters, outfits, products and locations identical across all prompts: repeat their full visual description word for word in every prompt.',
      kind === 'video' && `Each video prompt is about ${Math.min(8, per)} seconds: write it as "Start: <first frame> End: <how it ends>", with one main action, the camera movement and pacing; keep faces, hands and objects stable, no cuts.`,
      cues && 'The user gave subtitles: write one prompt per subtitle line, in the same order, each illustrating that line (no text or captions in the image).',
      pa.refs.length && 'Reference images are attached: describe their subject (person, product, place) faithfully and keep it the same in every prompt.',
      $('#paNegative').value.trim() && `Avoid: ${$('#paNegative').value.trim()}.`,
      'Do not put any written text, captions or watermarks in the images.',
      count === 1 ? 'Output ONLY that one prompt: no number, no title, no notes, no markdown.' : `Output ONLY the ${count} prompts, separated by one blank line, ${$('#paNumber').checked ? 'each starting with its number ("1. ", "2. ", …)' : 'without numbering'}; no title, no notes, no markdown.`
    ].filter(Boolean);
    const system = `You are an expert prompt engineer for Google Flow (Nano Banana image model, Veo video model).\n- ${rules.join('\n- ')}`;
    const user = cues ? `Subtitles:\n${cues.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : `Idea / script (Vietnamese or English):\n${input}`;
    return { system, user, count, kind, ratio };
  }
  async function paGenerate() {
    const status = $('#paStatus'), button = $('#paGo'), take = $('#paTake');
    let req; try { req = paRequest(); } catch (error) { status.className = 'cos-hint error'; status.textContent = error.message; return; }
    button.disabled = true; status.className = 'cos-hint warn';
    try {
      let out;
      if (pa.engine === 'gemini-api') {
        const apiKey = await app().getApiKey();
        if (!apiKey) throw new Error('Chưa có Gemini API key (Cài đặt → Tạo bằng: Gemini API → dán key → Lưu). Hoặc chọn ChatGPT / Gemini web.');
        const best = await bestGeminiModel(apiKey);
        status.textContent = `Gemini (${best}) đang viết ${req.count} prompt…`;
        const call = model => AI().text({ system: req.system, user: req.user, images: pa.refs.map(r => r.url), model, apiKey, temperature: 0.9 });
        try { out = await call(best); } catch (error) { if (best === 'gemini-2.5-flash' || !/429|quota|exhausted|403|permission|billing/i.test(`${error.status} ${error.message}`)) throw error; out = await call('gemini-2.5-flash'); }
      } else {
        const name = pa.engine === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        status.textContent = `Đang mở ${name}…`;
        take.classList.remove('hidden');
        try {
          const reply = await askWebChat(pa.engine, `${req.system}\n\n---\n${req.user}`, text => { status.textContent = text; });
          out = { text: reply.text, model: `${name}${reply.model ? ` · ${reply.model}` : ''}`, note: cleanupNote(reply).trim() };
        } finally { take.classList.add('hidden'); }
      }
      const text = AI().clean(out.text).replace(/\*\*/g, '');
      // One prompt: keep it whole (a video prompt may have "Start:" and "End:" paragraphs). Several: split them.
      const prompts = req.count === 1 ? [text.replace(/^\s*(\d+\s*[.)]|prompt\s*:)\s*/i, '').trim()] : splitPromptText(text);
      if (!prompts.length || !prompts[0]) throw new Error('Câu trả lời trống, hãy bấm Tạo prompt lại.');
      pa.result = { prompts, kind: req.kind, ratio: req.ratio, model: out.model, note: out.note || '' };
      status.textContent = '';
      paShow('result');
    } catch (error) { status.className = 'cos-hint error'; status.textContent = error.message || String(error); }
    finally { button.disabled = false; }
  }
  // Result screen (like TobyFlow's): every prompt as an editable card, then "Đưa vào cos_alpha_flow", Chép or Quay lại.
  function paShow(view) {
    pa.view = view === 'result' && pa.result ? 'result' : 'form';
    const result = pa.view === 'result';
    $('#paForm').classList.toggle('hidden', result); $('#paFormActions').classList.toggle('hidden', result);
    $('#paResult').classList.toggle('hidden', !result); $('#paResultActions').classList.toggle('hidden', !result);
    if (!result) return;
    const r = pa.result, n = r.prompts.length;
    $('#paResultTitle').textContent = `Đã tạo ${n} prompt ${r.kind === 'video' ? 'video' : 'ảnh'}`;
    $('#paResultMeta').textContent = [r.model, r.ratio, r.note].filter(Boolean).join(' · ');
    $('#paResultList').innerHTML = r.prompts.map((text, i) => `<li class="pa-res"><div class="pa-res-top"><span class="pa-res-n">${n > 1 ? `Prompt ${i + 1}` : 'Prompt'}</span><button type="button" data-pacopy="${i}" title="Chép prompt này"><i data-ic="copy"></i>Chép</button></div><textarea data-pares="${i}" rows="${Math.min(9, Math.max(3, Math.ceil(text.length / 70)))}">${esc(text)}</textarea></li>`).join('');
    $('#paResult').scrollTop = 0;
  }
  const paEdited = () => [...document.querySelectorAll('#paResultList [data-pares]')].map(box => box.value.trim()).filter(Boolean);
  async function paCopy(text, button) {
    try { await navigator.clipboard.writeText(text); } catch { const box = Object.assign(document.createElement('textarea'), { value: text }); document.body.appendChild(box); box.select(); document.execCommand('copy'); box.remove(); }
    if (!button) return; const old = button.innerHTML; button.innerHTML = '<i data-ic="check"></i>Đã chép'; setTimeout(() => { button.innerHTML = old; }, 1500);
  }
  function paUse() {
    const prompts = paEdited(); if (!prompts.length) return;
    const r = pa.result;
    // A blank line separates prompts in the box, so blank lines inside one prompt are folded.
    const fold = text => text.replace(/\n\s*\n+/g, '\n');
    $('#qpPrompts').value = prompts.length === 1 ? fold(prompts[0]) : prompts.map((text, i) => `${i + 1}. ${fold(text)}`).join('\n\n');
    $('#qpSplit').checked = true;
    document.querySelector(`[data-qkind="${r.kind}"]`)?.click();
    $('#qpRatio').value = r.ratio;
    if (pa.refs.length) { quick.refs = [...quick.refs, ...pa.refs].slice(0, 5); renderQuickRefs(); }
    updateQuickCount();
    pa.result = null; paShow('form');
    $('#paModal').classList.add('hidden');
    $('#qpStatus').className = 'cos-hint ok'; $('#qpStatus').textContent = `Đã đưa ${prompts.length} prompt vào ô Prompt (${r.model}). Xem lại rồi bấm Tạo.`;
  }
  function setupAssistant() {
    chrome.storage.local.get('cosalphaPaEngine').then(got => { if (got.cosalphaPaEngine) { pa.engine = got.cosalphaPaEngine; document.querySelectorAll('[data-paeng]').forEach(b => b.classList.toggle('active', b.dataset.paeng === pa.engine)); showCleanup(); } }).catch(() => {});
    // An unused result is kept: opening the assistant again shows it until it is used or the user goes back.
    $('#qpAssistOpen').onclick = () => { paShow(pa.view); $('#paModal').classList.remove('hidden'); if (pa.view === 'result') return; $('#paKind').value = quick.kind; document.querySelectorAll('#paRatio [data-ratio]').forEach(b => b.classList.toggle('active', b.dataset.ratio === $('#qpRatio').value)); paRenderCats(); paRenderRefs(); $('#paInput').focus(); };
    $('#paClose').onclick = () => $('#paModal').classList.add('hidden');
    const showCleanup = () => $('#paCleanWrap').classList.toggle('hidden', pa.engine === 'gemini-api');
    document.querySelectorAll('[data-paeng]').forEach(b => b.onclick = () => { pa.engine = b.dataset.paeng; document.querySelectorAll('[data-paeng]').forEach(x => x.classList.toggle('active', x === b)); store.set('cosalphaPaEngine', pa.engine); showCleanup(); });
    showCleanup();
    chrome.storage.local.get('cosalphaChatCleanup').then(got => { $('#paCleanup').checked = got.cosalphaChatCleanup !== false; }).catch(() => {});
    $('#paCleanup').onchange = () => store.set('cosalphaChatCleanup', $('#paCleanup').checked);
    $('#paTake').onclick = () => { takeChatNow(); $('#paStatus').textContent = 'Đang lấy câu trả lời hiện có…'; };
    $('#paBack').onclick = () => paShow('form');
    $('#paUse').onclick = paUse;
    $('#paCopyAll').onclick = event => paCopy(paEdited().join('\n\n'), event.currentTarget);
    $('#paResultList').onclick = event => { const b = event.target.closest('[data-pacopy]'); if (b) paCopy(document.querySelector(`[data-pares="${b.dataset.pacopy}"]`).value.trim(), b); };
    $('#paCats').onclick = event => { const b = event.target.closest('[data-pacat]'); if (b) { pa.cat = b.dataset.pacat; paRenderCats(); } };
    $('#paCards').onclick = event => { const b = event.target.closest('[data-patpl]'); if (b) { pa.template = b.dataset.patpl; paRenderCats(); } };
    $('#paRatio').onclick = event => { const b = event.target.closest('[data-ratio]'); if (b) document.querySelectorAll('#paRatio [data-ratio]').forEach(x => x.classList.toggle('active', x === b)); };
    const zone = $('#paRefs');
    zone.onclick = event => { const rm = event.target.closest('[data-paref]'); if (rm) { pa.refs.splice(Number(rm.dataset.paref), 1); paRenderRefs(); return; } $('#paRefFile').click(); };
    $('#paRefFile').onchange = event => { paAddRefs([...event.target.files]); event.target.value = ''; };
    zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('over'); paAddRefs([...event.dataTransfer.files]); });
    $('#paGo').onclick = paGenerate;
  }
  // Panel header, project picker, provider switch, quantity stepper and the "…" menu.
  function setupPanelChrome() {
    $('#qpVersion').textContent = `v${chrome.runtime.getManifest().version}`;
    document.querySelectorAll('[data-proxy]').forEach(b => b.onclick = () => $(`#${b.dataset.proxy}`)?.click());
    const fillProjects = () => { $('#qpProject').innerHTML = albumState.projects.map(p => `<option ${p === albumState.current ? 'selected' : ''}>${esc(p)}</option>`).join(''); };
    loadAlbumSettings().then(fillProjects); fillProjects();
    $('#qpProject').onchange = () => { albumState.current = $('#qpProject').value; saveAlbumSettings(); if (drawerMode === 'album') renderAlbum(); };
    $('#qpProjectNew').onclick = () => { const name = prompt('Tên project mới (vd: Quảng cáo áo dài tháng 11):'); if (!name?.trim()) return; const clean = name.trim().slice(0, 60); if (!albumState.projects.includes(clean)) albumState.projects.push(clean); albumState.current = clean; saveAlbumSettings(); fillProjects(); if (drawerMode === 'album') renderAlbum(); };
    const syncProvider = () => { const p = app().providerName(); document.querySelectorAll('[data-qprov]').forEach(b => b.classList.toggle('active', b.dataset.qprov === p)); };
    document.querySelectorAll('[data-qprov]').forEach(b => b.onclick = () => {
      const a = app(); a.state.settings = { ...(a.state.settings || {}), provider: b.dataset.qprov }; a.saveState();
      const select = $('#providerSelect'); if (select) select.value = b.dataset.qprov;
      syncProvider(); const label = document.querySelector('#backendStatus'); if (label) label.textContent = label.textContent.replace(/^Tạo bằng: [^·]*/, `Tạo bằng: ${a.providerLabel(b.dataset.qprov)} `); a.setRunStatus(`Tạo bằng ${a.providerLabel(b.dataset.qprov)}.${b.dataset.qprov === 'chatgpt' ? ' ChatGPT chỉ tạo ảnh.' : b.dataset.qprov === 'flow' ? '' : ' Hãy đăng nhập sẵn trang đó trong Chrome.'}`, 'ok');
    });
    setTimeout(syncProvider, 600);
    document.querySelectorAll('.qp-stepper [data-step]').forEach(b => b.onclick = () => { const sel = $('#qpQty'); sel.selectedIndex = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + Number(b.dataset.step))); updateQuickCount(); });
    $('#qpMoreBtn').onclick = event => { event.stopPropagation(); $('#qpMoreMenu').classList.toggle('hidden'); };
    document.addEventListener('click', event => { if (!event.target.closest('.qp-more')) $('#qpMoreMenu').classList.add('hidden'); });
    $('#qpMoreMenu').addEventListener('click', event => { if (event.target.closest('button')) $('#qpMoreMenu').classList.add('hidden'); });
    // Names as shown in Flow's model menu (Oct 2026). Free text is still allowed for newer models.
    const models = { image: ['Nano Banana Pro', 'Nano Banana 2'], video: ['Omni 1.1 Flash', 'Veo 3.1 - Fast', 'Veo 3.1 - Lite', 'Veo 3.1 - Quality'] };
    const fillModels = () => { $('#qpModelList').innerHTML = models[quick.kind].map(m => `<option value="${m}"></option>`).join(''); };
    fillModels(); document.querySelectorAll('[data-qkind]').forEach(b => b.addEventListener('click', fillModels));
  }
  function setupView() {
    document.body.classList.toggle('view-panel', isPanel);
    $('#viewFullBtn').onclick = openFullView;
    $('#viewPanelBtn').onclick = openPanelView;
    $('#instanceUseHere').onclick = () => location.reload();
    claimInstance();
    if (!isPanel) return;
    $('#welcomeModal').classList.add('hidden');
    $('#qpDrawerSlot').appendChild($('#cosDrawer'));
    $('.qp-project').after($('.statusbar'));
    const tabs = document.querySelectorAll('[data-qp]');
    tabs.forEach(tab => tab.onclick = () => {
      // The workflow canvas needs room, so this tab opens the full-screen view instead of a panel page.
      if (tab.dataset.qp === 'workflow') { openFullView(); return; }
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      const mode = tab.dataset.qp; $('#qpGen').classList.toggle('hidden', mode !== 'gen'); $('#qpFooter').classList.toggle('hidden', mode !== 'gen');
      openDrawer(mode === 'gen' ? '' : mode, true);
    });
    document.querySelectorAll('[data-qkind]').forEach(button => button.onclick = () => { quick.kind = button.dataset.qkind; document.querySelectorAll('[data-qkind]').forEach(b => b.classList.toggle('active', b === button)); $('#qpGen').classList.toggle('kind-video', quick.kind === 'video'); updateQuickCount(); });
    $('#qpPrompts').addEventListener('input', updateQuickCount); $('#qpSplit').onchange = updateQuickCount; $('#qpQty').onchange = updateQuickCount;
    $('#qpImportTxt').onclick = () => $('#qpTxtFile').click();
    $('#qpTxtFile').onchange = async event => { const file = event.target.files[0]; if (!file) return; $('#qpPrompts').value = await file.text(); updateQuickCount(); event.target.value = ''; };
    $('#qpAiBtn').onclick = () => $('#aiScriptOpen').click();
    const zone = $('#qpRefs');
    zone.onclick = event => { const remove = event.target.closest('[data-qref]'); if (remove) { quick.refs.splice(Number(remove.dataset.qref), 1); renderQuickRefs(); return; } $('#qpRefFile').click(); };
    $('#qpRefFile').onchange = event => { addQuickRefs([...event.target.files]); event.target.value = ''; };
    zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', async event => {
      event.preventDefault(); zone.classList.remove('over');
      const albumId = event.dataTransfer.getData('application/x-cosalpha-album');
      if (albumId) { const item = await albumItem(albumId); if (item?.kind === 'image') addQuickRefs([itemFile(item)]); return; }
      addQuickRefs([...event.dataTransfer.files]);
    });
    // In the panel, pasted images go to the quick references, not to the hidden canvas.
    window.addEventListener('paste', event => {
      if ($('#qpGen').classList.contains('hidden') || event.target.closest?.('textarea,input')) return;
      const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
      if (!files.length) return; event.preventDefault(); event.stopImmediatePropagation(); addQuickRefs(files);
    }, true);
    $('#qpGo').onclick = quickGenerate;
    $('#qpAssist').onclick = promptAssistant;
    const styleSel = $('#qpStyle'); Object.entries(AI().STYLES).forEach(([key, value]) => styleSel.append(new Option(value.label, key)));
    const presetSel = $('#qpPreset'); Object.entries(AI().PRESETS).forEach(([key, value]) => presetSel.append(new Option(value.label, key)));
    presetSel.onchange = () => { applyPreset(presetSel.value); presetSel.value = ''; };
    $('#qpChars').onclick = event => { const chip = event.target.closest('[data-qchar],[data-qcharmanage]'); if (!chip) return; if (chip.dataset.qcharmanage) { $('[data-qp="characters"]').click(); return; } const id = chip.dataset.qchar; if (extras.selectedChars.has(id)) extras.selectedChars.delete(id); else extras.selectedChars.add(id); renderQuickChars(); };
    setupPanelChrome(); setupAssistant();
    renderQuickRefs(); updateQuickCount();
  }

  // ---------------- Wiring ----------------
  function init() {
    if (!app()) { setTimeout(init, 50); return; }
    loadAlbumSettings();
    chrome.storage.local.get('cosalphaScriptModel').then(got => { if (got.cosalphaScriptModel && !$('#aiModel').value) $('#aiModel').value = got.cosalphaScriptModel; }).catch(() => {});
    document.querySelectorAll('[data-drawer]').forEach(button => button.addEventListener('click', () => openDrawer(button.dataset.drawer)));
    $('#cosDrawerClose').onclick = () => openDrawer(drawerMode);
    const body = $('#cosDrawerBody');
    body.addEventListener('click', async event => {
      if (await onExtrasClick(event)) return;
      const t = event.target.closest('button'); if (!t) { const item = event.target.closest('[data-node]'); if (item) { const a = app(); a.state.selectedNodeId = item.dataset.node; a.state.selectedNodeIds = [item.dataset.node]; a.render(); } return; }
      if (drawerMode === 'queue') {
        if (t.dataset.q === 'pause') setPaused(true); else if (t.dataset.q === 'resume') setPaused(false); else if (t.dataset.q === 'stop') stopAll(); else if (t.dataset.q === 'runAll') runAll();
        else if (t.dataset.skip) toggleSkip(t.dataset.skip); else if (t.dataset.run) runOrEnqueue(t.dataset.run);
        refresh(true);
      } else if (drawerMode === 'album') onAlbumClick(event).catch(error => app().setRunStatus(error.message, 'error'));
    });
    body.addEventListener('change', event => { onExtrasChange(event).catch(error => app().setRunStatus(error.message, 'error'));
      if (event.target.id === 'cosAlbumProject') { albumState.current = event.target.value; saveAlbumSettings(); renderAlbum(); }
      if (event.target.id === 'cosAlbumFile') addFilesToAlbum([...event.target.files]).catch(error => app().setRunStatus(error.message, 'error'));
    });
    body.addEventListener('input', event => { if (event.target.id === 'cosPromptSearch') { extras.promptSearch = event.target.value; const pos = event.target.selectionStart; renderPrompts(); const box = $('#cosPromptSearch'); box.focus(); box.setSelectionRange(pos, pos); } });
    body.addEventListener('dragstart', event => { const card = event.target.closest('[data-album]'); if (card) { event.dataTransfer.setData('application/x-cosalpha-album', card.dataset.album); event.dataTransfer.effectAllowed = 'copy'; } });
    const viewport = $('#viewport');
    viewport.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-cosalpha-album')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    viewport.addEventListener('drop', event => { const id = event.dataTransfer.getData('application/x-cosalpha-album'); if (!id) return; event.preventDefault(); event.stopPropagation(); useAlbumItem(id, event.clientX, event.clientY).catch(error => app().setRunStatus(error.message, 'error')); }, true);
    $('#aiStyle').onchange = () => $('#aiStyleCustom').classList.toggle('hidden', $('#aiStyle').value !== 'custom');
    document.querySelectorAll('[data-ai-write]').forEach(button => button.onclick = () => writeScript(button.dataset.aiWrite));
    $('#buildScriptNodes').addEventListener('click', createCharactersFromScript, true);
    $('#aiScriptOpen').onclick = () => { $('#scriptModal').classList.remove('hidden'); $('#aiIdea').focus(); };
    setupView();
    loadExtras();
    document.querySelectorAll('[data-dtab]').forEach(tab => tab.onclick = () => openDrawer(tab.dataset.dtab, true));
    document.querySelectorAll('[data-i2ptab]').forEach(tab => tab.onclick = () => showI2PTab(tab.dataset.i2ptab));
    document.querySelectorAll('[data-i2p]').forEach(button => button.onclick = () => i2pAction(button.dataset.i2p).catch(error => { $('#i2pStatus').className = 'error'; $('#i2pStatus').textContent = error.message; }));
    document.querySelectorAll('[data-i2popen]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); $('#i2pFile').click(); }));
    $('#i2pClose').onclick = () => $('#i2pModal').classList.add('hidden');
    $('#i2pFile').onchange = async event => { const file = event.target.files[0]; if (file) showI2P({ image: await fileToDataUrl(file), at: Date.now() }); event.target.value = ''; };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || inactive) return;
      const i2p = changes.cosalphaI2P?.newValue;
      if (i2p?.image && !i2p.consumed) checkPendingI2P();
      else if (i2p?.error) app().setRunStatus(`Không đọc được ảnh: ${i2p.error}`, 'error');
      const inbox = changes.cosalphaAlbumInbox?.newValue;
      if (inbox?.image && !inbox.consumed) checkPendingInbox();
    });
    checkPendingI2P();
    checkPendingInbox();
    setupAutoFlow();
    refresh(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
