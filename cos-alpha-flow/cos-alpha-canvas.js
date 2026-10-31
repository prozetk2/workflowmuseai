// cos_alpha_flow canvas look and tools (1.6). Ideas studied in TobyFlow's workflow editor, written fresh for our
// canvas: node cards with the title floating above, run-order badges, a preview box in the output's aspect ratio,
// a hover toolbar, a searchable node picker (N / double-click), a left tool rail, auto-layout by levels,
// a port legend and a gallery of ready-made workflows. Loaded after app.js and cos-alpha.js.
(() => {
  'use strict';
  const app = () => window.__cosAlphaApp;
  const hooks = window.__cosAlphaHooks || (window.__cosAlphaHooks = {});
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GEN = ['generateImage', 'generateVideo'];
  const RUNNABLE = [...GEN, 'aiAgent'];
  const ICON = { prompt: 'type', negativePrompt: 'ban', textAppend: 'text-cursor-input', textConcat: 'merge', imageInput: 'image', character: 'lock', videoReference: 'film', references: 'layers', generateImage: 'image-up', generateVideo: 'clapperboard', timeline: 'audio-lines', imageResize: 'crop', preview: 'eye', aiAgent: 'bot', textExtract: 'scissors', download: 'download' };
  const PROVIDER_ICON = { flow: 'sparkles', chatgpt: 'message-circle', grok: 'zap', muse: 'audio-lines', gemini: 'sparkle', api: 'key-round' };
  const RATIO_CLASS = { '9:16': 'r-9-16', '3:4': 'r-3-4', '1:1': 'r-1-1', '4:3': 'r-4-3', '16:9': 'r-16-9' };
  const isTyping = target => target?.closest?.('input, textarea, select, [contenteditable="true"]');
  const viewport = () => $('#viewport');
  // Screen point → canvas coordinates (the canvas is translated by pan and scaled by zoom).
  function toCanvas(clientX, clientY) {
    const s = app().state, rect = viewport().getBoundingClientRect();
    return { x: (clientX - rect.left - s.panX) / s.zoom, y: (clientY - rect.top - s.panY) / s.zoom };
  }
  const nodeEl = id => document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
  const shortProvider = provider => String(app().providerLabel?.(provider) || 'Flow').replace(/^tab /, '').replace(/ \(Veo\)$/, '');

  // ---------- node cards ----------
  // Run order shown on each node that does work (generate / AI), in the order "Chạy tất cả" uses.
  function runOrder() {
    try { return app().topoOrder().filter(id => { const n = app().nodeById(id); return RUNNABLE.includes(n?.type) && !n.data?.disabled; }); } catch { return []; }
  }
  function promptPreview(n) {
    const a = app();
    let text = ''; try { text = a.getIncoming(n.id, 'prompt').map(edge => a.resolveText(edge.source)).filter(t => String(t).trim()).join(' · ').replace(/\s+/g, ' ').slice(0, 220); } catch {}
    const sheet = n.type === 'generateImage' && a.sheetModes?.[n.data?.sheetMode];
    return sheet ? `${sheet.label}${text ? ` · ${text}` : ''}` : text;
  }
  function decorate() {
    const a = app(); if (!a) return;
    const order = runOrder(), provider = a.providerName?.() || 'flow';
    for (const el of document.querySelectorAll('#canvas > .node')) {
      const n = a.nodeById(el.dataset.id); if (!n || el.dataset.ts === '1') continue;
      el.dataset.ts = '1'; el.dataset.type = n.type; el.classList.add('ts-node');
      const off = RUNNABLE.includes(n.type) && n.data?.disabled === true, scale = GEN.includes(n.type) ? Number(n.data?.cardScale) || 1 : 1;
      el.classList.toggle('ts-off', off);
      if (scale > 1) el.classList.add(scale >= 2 ? 'ts-z2' : 'ts-z15');
      const head = el.querySelector(':scope > .node-header');
      if (head) {
        const icon = document.createElement('span'); icon.className = 'ts-icon'; icon.innerHTML = `<i data-ic="${n.type === 'generateImage' && n.data?.sheetMode ? 'layout-grid' : ICON[n.type] || 'square'}" data-size="15"></i>`;
        head.prepend(icon);
        const step = order.indexOf(n.id);
        if (step >= 0) { const badge = document.createElement('span'); badge.className = 'ts-order'; badge.textContent = String(step + 1); badge.title = `Bước ${step + 1} khi bấm Chạy tất cả`; head.prepend(badge); }
        if (GEN.includes(n.type)) {
          const pill = document.createElement('span'); pill.className = `ts-provider ts-provider-${provider}`;
          pill.innerHTML = `<i data-ic="${PROVIDER_ICON[provider] || 'sparkles'}" data-size="12"></i>${esc(shortProvider(provider))}`;
          pill.title = 'Nguồn tạo (đổi ở hàng tab trên bảng bên hoặc Cài đặt)';
          head.querySelector('.node-close')?.before(pill);
        }
        if (RUNNABLE.includes(n.type)) head.querySelector('.node-close')?.before(powerSwitch(n, off));
      }
      if (GEN.includes(n.type)) decorateGenerate(el, n);
      el.appendChild(toolbar(n));
    }
    // With several nodes selected, show each node's toolbar only on hover.
    document.body.classList.toggle('ts-multi', (a.state.selectedNodeIds?.length || 0) > 1);
  }
  function decorateGenerate(el, n) {
    const body = el.querySelector(':scope > .node-body'); if (!body) return;
    const video = n.type === 'generateVideo', ratio = video ? (n.data.size === '9:16' ? '9:16' : '16:9') : (RATIO_CLASS[n.data.size] ? n.data.size : '1:1');
    const box = document.createElement('div'); box.className = `ts-preview ${RATIO_CLASS[ratio]}${n.data.status === 'running' ? ' is-running' : ''}`;
    const media = body.querySelector(':scope > a.image-link, :scope > video');
    if (media) box.appendChild(media);
    else box.innerHTML = `<span class="ts-placeholder"><i data-ic="${video ? 'clapperboard' : 'image'}" data-size="44"></i></span>`;
    if (n.data.status === 'running') box.insertAdjacentHTML('beforeend', '<span class="ts-running"><span class="ts-spin"></span>Đang tạo…</span>');
    if (n.data.disabled === true) box.insertAdjacentHTML('beforeend', '<span class="ts-offnote"><i data-ic="power" data-size="12"></i>Đã tắt · bỏ qua khi Chạy tất cả</span>');
    const text = promptPreview(n);
    if (text) box.insertAdjacentHTML('beforeend', `<span class="ts-prompt" title="${esc(text)}">${esc(text)}</span>`);
    box.insertAdjacentHTML('beforeend', `<span class="ts-ratio">${ratio}${video ? ` · ${Number(n.data.duration) || 8}s` : ''}</span>`);
    body.prepend(box);
    collapseExtras(el, n, body);
  }
  // Keep only ratio (and duration) on the card; model, image role, reference mode, resolution, voice and the
  // continuity / character switches go into a "Tuỳ chọn thêm" fold that remembers being open across renders.
  const openExtras = new Set();
  function collapseExtras(el, n, body) {
    const controls = body.querySelector(':scope > .gen-controls'); if (!controls) return;
    const keep = n.type === 'generateVideo' ? 2 : 1;
    const moved = [...controls.children].slice(keep);
    moved.push(...body.querySelectorAll(':scope > .role-select, :scope > .continuity-toggle'));
    if (!moved.length) return;
    const fold = document.createElement('details'); fold.className = 'ts-more'; fold.open = openExtras.has(n.id);
    const changed = [n.data.model, !n.data.sheetMode && n.data.outputRole, n.data.resolution, n.data.voice, n.data.continuity, n.data.referenceMode === 'ingredients', n.data.useCharacters === false].filter(Boolean).length;
    fold.innerHTML = `<summary><i data-ic="sliders-horizontal" data-size="13"></i>Tuỳ chọn thêm${changed ? `<span class="ts-more-count">${changed} đã chỉnh</span>` : ''}</summary>`;
    const inner = document.createElement('div'); inner.className = 'ts-more-body'; inner.append(...moved); fold.appendChild(inner);
    fold.onpointerdown = e => e.stopPropagation(); fold.onmousedown = e => e.stopPropagation();
    // Remember the choice at click time (the toggle event comes later, possibly after a re-render).
    fold.querySelector('summary').onclick = () => { if (fold.open) openExtras.delete(n.id); else openExtras.add(n.id); };
    fold.ontoggle = () => app().scheduleDrawEdges();
    controls.after(fold);
  }
  // On/off switch for nodes that do work: a switched-off node keeps its result but "Chạy tất cả" skips it.
  function powerSwitch(n, off) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ts-switch'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!off));
    b.title = off ? 'Node đang tắt: bấm để bật lại' : 'Tắt node này (Chạy tất cả sẽ bỏ qua)';
    b.onpointerdown = e => e.stopPropagation(); b.onmousedown = e => e.stopPropagation();
    b.onclick = e => { e.stopPropagation(); setOff(n.id, !off); };
    return b;
  }
  function setOff(id, off) {
    const a = app(), n = a.nodeById(id); if (!n) return;
    a.createUndoSnapshot(off ? 'Tắt node' : 'Bật node');
    if (off) n.data.disabled = true; else delete n.data.disabled;
    a.render(); a.scheduleAutoSave();
    a.setRunStatus(off ? `Đã tắt "${n.data.customName || a.nodeDefs[n.type]?.title || n.type}": Chạy tất cả sẽ bỏ qua node này.` : 'Đã bật lại node.', 'ok');
  }
  const SCALES = [1, 1.5, 2];
  function cycleScale(id) {
    const a = app(), n = a.nodeById(id); if (!n) return;
    const next = SCALES[(SCALES.indexOf(Number(n.data.cardScale) || 1) + 1) % SCALES.length];
    if (next === 1) delete n.data.cardScale; else n.data.cardScale = next;
    a.render(); a.scheduleAutoSave();
  }
  function toolbar(n) {
    const a = app(), bar = document.createElement('div'); bar.className = 'ts-toolbar';
    const button = (icon, title, action, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.title = title; b.innerHTML = `<i data-ic="${icon}" data-size="15"></i>`; b.onpointerdown = e => e.stopPropagation(); b.onmousedown = e => e.stopPropagation(); b.onclick = e => { e.stopPropagation(); action(); }; bar.appendChild(b); };
    if (GEN.includes(n.type)) button('play', n.type === 'generateVideo' ? 'Tạo video này' : 'Tạo ảnh này', () => a.executeGenerationNode(n.id), 'ts-run');
    if (n.type === 'aiAgent') button('play', 'Chạy AI', () => a.plugApi().executeNode(n.id), 'ts-run');
    if (GEN.includes(n.type)) { const scale = Number(n.data.cardScale) || 1; button('zoom-in', `Phóng to thẻ để xem kết quả (đang ${scale}x, bấm để đổi 1x / 1.5x / 2x)`, () => cycleScale(n.id), 'ts-zoom'); bar.lastChild.insertAdjacentHTML('beforeend', `<small>${scale}x</small>`); }
    button('copy', 'Nhân bản (hoặc giữ Alt rồi kéo)', () => duplicate(n.id));
    button('trash-2', 'Xoá node', () => a.removeNode(n.id), 'danger');
    return bar;
  }
  function duplicate(id) {
    const a = app(); a.createUndoSnapshot('Nhân bản node');
    const ids = a.duplicateNodesForDrag([id]);
    for (const copyId of ids) { const copy = a.nodeById(copyId); copy.x += 40; copy.y += 40; if (copy.data) { delete copy.data.asset; delete copy.data.endFrame; copy.data.status = 'idle'; delete copy.data.error; } }
    a.render(); a.setRunStatus('Đã nhân bản node.', 'ok');
  }

  // ---------- node picker (N or double-click on empty canvas) ----------
  let picker = null, pickerCancel = null;
  function pickerItems() {
    const items = [];
    let group = '';
    for (const el of document.querySelectorAll('#nodeSidebar .ns-title, #nodeSidebar [data-add]')) {
      if (el.classList.contains('ns-title')) { group = el.textContent.trim(); continue; }
      items.push({ type: el.dataset.add, sheet: el.dataset.sheet || '', label: el.querySelector('.ns-label')?.textContent.trim() || el.dataset.add, desc: el.title || '', icon: el.querySelector('.ns-icon')?.innerHTML || '', group });
    }
    return items;
  }
  function closePicker() { picker?.remove(); picker = null; const cancel = pickerCancel; pickerCancel = null; cancel?.(); }
  // A wire dropped on empty canvas: only node types (and existing nodes) that can take that wire, connected on pick.
  function wireItems(wire) {
    const a = app(), base = pickerItems().filter(item => item.type !== 'text' && item.type !== 'timeline'), items = [];
    const title = n => n.data?.customName || a.nodeDefs[n.type]?.title || n.type;
    const iconOf = type => `<i data-ic="${ICON[type] || 'square'}" data-size="16"></i>`;
    if (wire.direction === 'out') {
      const src = a.nodeById(wire.from.nodeId), out = a.nodeDefs[src?.type]?.outputs?.find(p => p.id === wire.from.portId); if (!out) return { items, caption: '' };
      for (const item of base) { const input = a.nodeDefs[item.type]?.inputs?.find(p => a.canConnectTypes(out.type, p.type)); if (input) items.push({ ...item, group: 'Tạo node mới và nối', port: input.id, desc: `Nối vào cổng "${input.label}". ${item.desc}` }); }
      // One entry per existing node (its first free matching input), so a Timeline is listed once, not once per clip slot.
      const seen = new Set();
      for (const choice of a.connectionChoices(wire.from).existing) { if (seen.has(choice.targetId)) continue; seen.add(choice.targetId); const target = a.nodeById(choice.targetId); items.push({ existing: true, targetId: choice.targetId, port: choice.targetPort, type: target?.type, label: target?.type === 'timeline' ? `Timeline · thêm clip${target.data?.dockOnly ? ' (thanh Timeline)' : ''}` : `${title(target)} · ${a.nodeDefs[target?.type]?.inputs?.find(p => p.id === choice.targetPort)?.label || choice.targetPort}`, desc: 'Nối vào node đang có trên canvas', icon: iconOf(target?.type), group: 'Nối vào node có sẵn' }); }
      return { items, caption: `Nối "${out.label}" của ${title(src)} vào…` };
    }
    const dst = a.nodeById(wire.to.nodeId), input = a.nodeDefs[dst?.type]?.inputs?.find(p => p.id === wire.to.portId); if (!input) return { items, caption: '' };
    for (const item of base) { const output = a.nodeDefs[item.type]?.outputs?.find(p => a.canConnectTypes(p.type, input.type)); if (output) items.push({ ...item, group: 'Tạo node mới và nối', port: output.id, desc: `Lấy cổng "${output.label}". ${item.desc}` }); }
    for (const n of a.state.nodes) {
      if (n.id === dst.id || n.data?.dockOnly) continue;
      for (const output of a.nodeDefs[n.type]?.outputs || []) if (a.portCompatible({ nodeId: n.id, portId: output.id }, dst.id, input.id)) items.push({ existing: true, sourceId: n.id, port: output.id, type: n.type, label: `${title(n)} · ${output.label}`, desc: 'Lấy từ node đang có trên canvas', icon: iconOf(n.type), group: 'Nối từ node có sẵn' });
    }
    return { items, caption: `Chọn node cấp "${input.label}" cho ${title(dst)}` };
  }
  // A picker entry such as "Ảnh nhiều góc" is a Tạo ảnh node with a preset.
  function applyPreset(item, node) { if (item.sheet && node) { app().applySheet(node, item.sheet); app().render(); } }
  function addFromWire(item, wire, at) {
    const a = app(), s = a.state;
    if (item.existing) {
      if (wire.direction === 'out') { s.connectingFrom = { ...wire.from }; a.connect(item.targetId, item.port); }
      else { s.connectingFrom = { nodeId: item.sourceId, portId: item.port }; a.connect(wire.to.nodeId, wire.to.portId); }
    } else {
      const before = new Set(s.nodes.map(n => n.id));
      a.addNode(item.type, wire.direction === 'out' ? at.x + 16 : at.x - 300, at.y - 60);
      const made = s.nodes.find(n => !before.has(n.id)); if (!made) { s.connectingFrom = null; a.setRunStatus('Không tạo được node đã chọn.', 'error'); return; }
      applyPreset(item, made);
      if (wire.direction === 'out') { s.connectingFrom = { ...wire.from }; a.connect(made.id, item.port); }
      else { s.connectingFrom = { nodeId: made.id, portId: item.port }; a.connect(wire.to.nodeId, wire.to.portId); }
    }
    a.scheduleAutoSave(); a.setRunStatus(`Đã nối: ${item.label}.`, 'ok');
  }
  function openPicker(clientX, clientY, wire = null) {
    closePicker();
    const vp = viewport(), rect = vp.getBoundingClientRect(), at = toCanvas(clientX, clientY), fromWire = wire ? wireItems(wire) : null, items = fromWire ? fromWire.items : pickerItems();
    picker = document.createElement('div'); picker.className = `ts-picker${wire ? ' ts-picker-wire' : ''}`;
    picker.innerHTML = `${fromWire ? `<div class="ts-picker-caption"><i data-ic="link" data-size="13"></i>${esc(fromWire.caption)}</div>` : ''}<div class="ts-picker-search"><i data-ic="search" data-size="15"></i><input type="text" placeholder="Tìm node… (vd: ảnh, video, AI)" aria-label="Tìm node"></div><div class="ts-picker-list" role="listbox"></div><div class="ts-picker-foot"><kbd>↑</kbd><kbd>↓</kbd> chọn · <kbd>Enter</kbd> thêm · <kbd>Esc</kbd> đóng</div>`;
    picker.onpointerdown = e => e.stopPropagation(); picker.onmousedown = e => e.stopPropagation(); picker.ondblclick = e => e.stopPropagation();
    vp.appendChild(picker);
    const left = Math.max(8, Math.min(clientX - rect.left, rect.width - 330)), top = Math.max(8, Math.min(clientY - rect.top, rect.height - 420));
    picker.style.left = `${left}px`; picker.style.top = `${top}px`;
    const input = picker.querySelector('input'), list = picker.querySelector('.ts-picker-list');
    let active = 0, shown = items, picked = false;
    // Closing without a pick drops the half-made wire.
    if (wire) pickerCancel = () => { if (!picked) app().state.connectingFrom = null; };
    const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
    const draw = () => {
      const q = fold(input.value.trim());
      // Name matches first, then matches in the group or description.
      const rank = item => { const label = fold(item.label); return label.startsWith(q) ? 0 : label.includes(q) ? 1 : fold(`${item.type} ${item.group}`).includes(q) ? 2 : fold(item.desc).includes(q) ? 3 : 9; };
      shown = q ? items.map(item => [rank(item), item]).filter(([r]) => r < 9).sort((x, y) => x[0] - y[0]).map(([, item]) => item) : items;
      active = Math.min(active, Math.max(0, shown.length - 1));
      let lastGroup = '';
      list.innerHTML = shown.length ? shown.map((item, i) => {
        const head = !q && item.group !== lastGroup ? `<div class="ts-picker-group">${esc(item.group)}</div>` : ''; lastGroup = item.group;
        return `${head}<button type="button" class="ts-picker-item${i === active ? ' active' : ''}" data-i="${i}"><span class="ts-picker-icon">${item.icon}</span><span><b>${esc(item.label)}</b><small>${esc(item.desc)}</small></span></button>`;
      }).join('') : '<div class="ts-picker-empty">Không có node nào khớp.</div>';
      list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    };
    const add = item => {
      if (!item) return; picked = true; closePicker();
      if (wire) addFromWire(item, wire, at);
      else if (item.type === 'text') app().addTextNote(at.x, at.y); else { app().addNode(item.type, at.x, at.y); applyPreset(item, app().state.nodes.at(-1)); app().scheduleAutoSave(); }
    };
    input.oninput = () => { active = 0; draw(); };
    input.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); add(shown[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
      e.stopPropagation();
    };
    list.onclick = e => { const b = e.target.closest('[data-i]'); if (b) add(shown[Number(b.dataset.i)]); };
    draw(); input.focus();
  }
  const centerPoint = () => { const r = viewport().getBoundingClientRect(); return [r.left + r.width / 2 - 160, r.top + r.height / 2 - 200]; };

  // ---------- auto-layout ----------
  // Each independent chain (one scene, one product shot…) is laid out on its own: columns by dependency level,
  // rows ordered to follow their inputs. The chains are then packed into a grid sized to fit the screen.
  function layoutBlock(block, parents, children, size) {
    const a = app(), depth = new Map(block.map(id => [id, 0])), waiting = new Map(block.map(id => [id, parents.get(id).size])), queue = block.filter(id => !waiting.get(id));
    for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i])) { depth.set(child, Math.max(depth.get(child), depth.get(queue[i]) + 1)); waiting.set(child, waiting.get(child) - 1); if (!waiting.get(child)) queue.push(child); }
    // A node fed by nothing (a prompt, an input image) sits right before the first node it feeds.
    for (const id of [...block].reverse()) { if (parents.get(id).size || !children.get(id).size) continue; depth.set(id, Math.max(0, Math.min(...[...children.get(id)].map(c => depth.get(c))) - 1)); }
    const levels = []; for (const id of block) (levels[depth.get(id)] ||= []).push(id);
    const GAP_X = 110, GAP_Y = 48, pos = new Map(); let x = 0;
    const center = id => pos.get(id).y + size(id).h / 2;
    const bary = near => { const placed = [...near].filter(n => pos.has(n)); return placed.length ? placed.reduce((sum, n) => sum + center(n), 0) / placed.length : null; };
    const settle = level => { level.sort((p, q) => pos.get(p).y - pos.get(q).y); for (let i = 1; i < level.length; i++) { const prev = level[i - 1], min = pos.get(prev).y + size(prev).h + GAP_Y; if (pos.get(level[i]).y < min) pos.get(level[i]).y = min; } };
    levels.forEach(level => {
      if (!level) return;
      level.sort((p, q) => (bary(parents.get(p)) ?? a.nodeById(p).y) - (bary(parents.get(q)) ?? a.nodeById(q).y));
      let y = 0; for (const id of level) { pos.set(id, { x, y }); y += size(id).h + GAP_Y; }
      x += Math.max(...level.map(id => size(id).w)) + GAP_X;
    });
    // Two passes: line nodes up with their inputs, then with their outputs, without overlaps.
    for (const pass of [0, 1]) (pass ? [...levels].reverse() : levels).forEach(level => { if (!level) return; for (const id of level) { const c = bary(pass ? children.get(id) : parents.get(id)); if (c != null) pos.get(id).y = c - size(id).h / 2; } settle(level); });
    const minY = Math.min(...[...pos.values()].map(p => p.y));
    for (const p of pos.values()) p.y -= minY;
    return { pos, w: Math.max(...block.map(id => pos.get(id).x + size(id).w)), h: Math.max(...block.map(id => pos.get(id).y + size(id).h)) };
  }
  function autoLayout(ids) {
    const a = app(), s = a.state;
    ids = ids || s.nodes.filter(n => !n.data?.dockOnly).map(n => n.id);
    if (!ids.length) return;
    const set = new Set(ids), parents = new Map(ids.map(id => [id, new Set()])), children = new Map(ids.map(id => [id, new Set()]));
    for (const e of s.edges) if (set.has(e.source) && set.has(e.target) && e.source !== e.target) { parents.get(e.target).add(e.source); children.get(e.source).add(e.target); }
    const size = id => { const el = nodeEl(id); return { w: el?.offsetWidth || 280, h: (el?.offsetHeight || 240) + 44 }; };
    const startX = Math.min(...ids.map(id => a.nodeById(id).x)), startY = Math.min(...ids.map(id => a.nodeById(id).y));
    // Connected groups, in the order their first node appears; single unconnected nodes share one block placed first.
    const seen = new Set(), groups = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const group = [], stack = [id]; seen.add(id);
      while (stack.length) { const cur = stack.pop(); group.push(cur); for (const next of [...parents.get(cur), ...children.get(cur)]) if (!seen.has(next)) { seen.add(next); stack.push(next); } }
      groups.push(group.sort((p, q) => ids.indexOf(p) - ids.indexOf(q)));
    }
    const lone = groups.filter(g => g.length === 1).flat(), blocks = groups.filter(g => g.length > 1);
    if (lone.length) blocks.unshift(lone);
    const laid = blocks.map(block => layoutBlock(block, parents, children, size));
    // Try 1…n blocks per row and keep the arrangement that fits the visible canvas at the largest zoom.
    const rect = viewport()?.getBoundingClientRect() || { width: 1200, height: 800 }, vw = Math.max(400, rect.width - 160), vh = Math.max(300, rect.height - 100), GAP = 150;
    let best = null;
    for (let perRow = 1; perRow <= laid.length; perRow++) {
      const cells = []; let width = 0, height = 0, rowX = 0, rowH = 0;
      laid.forEach((block, i) => {
        if (i && i % perRow === 0) { height += rowH + GAP; rowX = 0; rowH = 0; }
        cells.push({ x: rowX, y: height }); rowX += block.w + GAP; rowH = Math.max(rowH, block.h); width = Math.max(width, rowX - GAP);
      });
      height += rowH;
      const zoom = Math.min(vw / width, vh / height);
      if (!best || zoom > best.zoom * 1.04) best = { zoom, cells };
    }
    laid.forEach((block, i) => { for (const [id, p] of block.pos) { const n = a.nodeById(id); n.x = Math.round(startX + best.cells[i].x + p.x); n.y = Math.round(startY + best.cells[i].y + p.y); } });
    a.render();
  }
  function layoutAll() { const a = app(); if (!a.state.nodes.length) return; a.createUndoSnapshot('Tự sắp xếp node'); autoLayout(); setTimeout(() => a.fitCanvas(), 30); a.setRunStatus('Đã tự sắp xếp các node theo thứ tự chạy (Ctrl+Z để hoàn tác).', 'ok'); }

  // ---------- left tool rail + port legend ----------
  function setupRail() {
    const vp = viewport(); if (!vp || $('#tsRail')) return;
    const rail = document.createElement('div'); rail.id = 'tsRail'; rail.className = 'ts-rail'; rail.setAttribute('aria-label', 'Công cụ workflow');
    const tools = [
      ['plus', 'Thêm node (N, hoặc nháy đúp lên canvas)', () => openPicker(...centerPoint())],
      ['layout-template', 'Kho mẫu workflow', () => openGallery()],
      ['sticky-note', 'Thêm ghi chú (T)', () => { const [cx, cy] = centerPoint(), p = toCanvas(cx, cy); app().addTextNote(p.x, p.y); }],
      'sep',
      ['play', 'Chạy tất cả', () => $('#runBtn')?.click(), 'ts-rail-run'],
      ['undo-2', 'Hoàn tác (Ctrl+Z)', () => app().undoLastChange()],
      'sep',
      ['workflow', 'Tự sắp xếp node theo thứ tự chạy', layoutAll],
      ['maximize-2', 'Vừa khít mọi node', () => { app().fitCanvas(); app().scheduleDrawEdges(); }]
    ];
    for (const tool of tools) {
      if (tool === 'sep') { rail.insertAdjacentHTML('beforeend', '<span class="ts-rail-sep"></span>'); continue; }
      const [icon, title, action, cls] = tool, b = document.createElement('button');
      b.type = 'button'; b.title = title; b.className = cls || ''; b.dataset.tsTool = icon; b.innerHTML = `<i data-ic="${icon}" data-size="18"></i>`;
      b.onpointerdown = e => e.stopPropagation(); b.onmousedown = e => e.stopPropagation(); b.onclick = e => { e.stopPropagation(); action(); };
      rail.appendChild(b);
    }
    vp.appendChild(rail);
    const legend = document.createElement('div'); legend.id = 'tsLegend'; legend.className = 'ts-legend collapsed';
    legend.innerHTML = '<button type="button" title="Màu các cổng nối"><i data-ic="info" data-size="14"></i></button><div><b>Màu cổng nối</b><span><i class="d text"></i>Chữ / câu lệnh</span><span><i class="d image"></i>Ảnh</span><span><i class="d video"></i>Video</span><span><i class="d negative"></i>Tránh (negative)</span><span><i class="d media"></i>Ảnh hoặc video</span></div>';
    legend.querySelector('button').onclick = e => { e.stopPropagation(); legend.classList.toggle('collapsed'); };
    legend.onpointerdown = e => e.stopPropagation(); legend.onmousedown = e => e.stopPropagation();
    vp.appendChild(legend);
    vp.addEventListener('dblclick', e => { if (e.target.closest('.node, .canvas-note, .canvas-tools, .ts-rail, .ts-legend, .ts-picker, .canvas-group')) return; e.preventDefault(); openPicker(e.clientX, e.clientY); });
    document.addEventListener('pointerdown', e => { if (picker && !e.target.closest('.ts-picker')) closePicker(); }, true);
    let last = null; vp.addEventListener('pointermove', e => { last = [e.clientX, e.clientY]; });
    document.addEventListener('keydown', e => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('.modal-backdrop:not(.hidden)')) return;
      if (e.key.toLowerCase() === 'n' && vp.offsetParent !== null) { e.preventDefault(); openPicker(...(last || centerPoint())); }
    });
  }

  // ---------- ready-made workflows (our own templates) ----------
  // Each template is a small graph: nodes { k, type, data } placed in columns by auto-layout, edges [from, port, to, port].
  const P = (k, text, extra = {}) => ({ k, type: 'prompt', data: { text, ...extra } });
  const IMG = (k, data = {}) => ({ k, type: 'generateImage', data: { model: '', size: '9:16', status: 'idle', ...data } });
  const VID = (k, data = {}) => ({ k, type: 'generateVideo', data: { model: '', size: '9:16', duration: 8, continuity: false, status: 'idle', referenceMode: 'firstFrame', ...data } });
  const IN = (k, role = '', extra = {}) => ({ k, type: 'imageInput', data: { role, ...extra } });
  const TEMPLATES = [
    { id: 'fashion', cat: 'Thời trang', name: 'Quảng cáo thời trang', desc: 'Ảnh người mẫu + ảnh trang phục → ảnh người mẫu mặc đồ → video 8 giây khoe trang phục.', how: 'Thả ảnh người mẫu và ảnh trang phục vào 2 node Ảnh đầu vào, rồi bấm Chạy tất cả.',
      nodes: [IN('m', 'model'), IN('o', 'outfit'), P('p1', 'Ảnh quảng cáo thời trang: người mẫu mặc đúng bộ trang phục này, tạo dáng toàn thân trong studio nền sáng, ánh sáng mềm, chi tiết vải rõ nét, phong cách tạp chí thời trang.'), IMG('g', { outputRole: 'startFrame', customName: 'Người mẫu mặc đồ' }), P('p2', 'Người mẫu bước chậm về phía máy quay rồi xoay người khoe trọn bộ trang phục, vải chuyển động tự nhiên, máy quay lia nhẹ, ánh sáng studio, phong cách quảng cáo thời trang cao cấp.'), VID('v', { customName: 'Video quảng cáo' })],
      edges: [['m', 'image', 'g', 'reference'], ['o', 'image', 'g', 'reference'], ['p1', 'text', 'g', 'prompt'], ['g', 'image', 'v', 'reference'], ['p2', 'text', 'v', 'prompt']] },
    { id: 'lookbook', cat: 'Thời trang', name: 'Người mẫu mặc đồ · ảnh nhiều góc', desc: 'Ảnh người mẫu và ảnh trang phục thành ảnh nhiều góc, ghép thành ảnh 4 góc người mẫu mặc đồ, rồi thành video 8 giây giữ đúng mặt và đồ.', how: 'Thả ảnh người mẫu và ảnh trang phục vào 2 node Ảnh đầu vào, rồi bấm Chạy tất cả. Mỗi ảnh nhiều góc là một lượt tạo ảnh.',
      nodes: [IN('m', 'model'), IN('o', 'outfit'), IMG('ms', { sheetMode: 'model', outputRole: 'modelSheet', customName: 'Người mẫu nhiều góc' }), IMG('os', { sheetMode: 'outfit', outputRole: 'outfitSheet', customName: 'Trang phục nhiều góc' }), IMG('look', { sheetMode: 'look', outputRole: 'lookSheet', customName: 'Người mẫu mặc đồ nhiều góc' }),
        P('p', 'Người mẫu trong ảnh tham chiếu bước chậm trên sàn studio về phía máy quay, dừng lại xoay nửa vòng khoe trọn bộ trang phục rồi mỉm cười nhìn ống kính. Giữ đúng gương mặt, kiểu tóc và từng chi tiết của trang phục. Máy quay lia nhẹ theo, ánh sáng studio mềm, phong cách quảng cáo thời trang. Một khung hình liền mạch, không chia ô, không chữ trên hình.'),
        VID('v', { referenceMode: 'ingredients', customName: 'Video người mẫu mặc đồ' })],
      edges: [['m', 'image', 'ms', 'reference'], ['o', 'image', 'os', 'reference'], ['ms', 'image', 'look', 'reference'], ['os', 'image', 'look', 'reference'], ['look', 'image', 'v', 'reference'], ['p', 'text', 'v', 'prompt']] },
    { id: 'product-ad', cat: 'Sản phẩm', name: 'Sản phẩm → ảnh studio → video', desc: 'Một ảnh sản phẩm thành ảnh studio sang trọng, rồi thành video xoay quanh sản phẩm.', how: 'Thả ảnh sản phẩm vào node Ảnh đầu vào, sửa câu lệnh nếu muốn, bấm Chạy tất cả.',
      nodes: [IN('s', 'product'), P('p1', 'Ảnh quảng cáo sản phẩm trên bục đá cẩm thạch, nền gradient sang trọng, ánh sáng studio ba điểm, phản chiếu nhẹ, sản phẩm giữ đúng hình dáng, màu sắc và logo.'), IMG('g', { outputRole: 'startFrame', customName: 'Ảnh studio' }), P('p2', 'Máy quay chậm rãi xoay quanh sản phẩm 180 độ, ánh sáng lướt qua bề mặt, vài hạt bụi sáng bay trong không khí, kết thúc cận cảnh logo.'), VID('v', { customName: 'Video sản phẩm' }), { k: 'd', type: 'download', data: {} }],
      edges: [['s', 'image', 'g', 'reference'], ['p1', 'text', 'g', 'prompt'], ['g', 'image', 'v', 'reference'], ['p2', 'text', 'v', 'prompt'], ['v', 'video', 'd', 'media']] },
    { id: 'product-angles', cat: 'Sản phẩm', name: '4 góc chụp cho 1 sản phẩm', desc: 'Một ảnh sản phẩm thành 4 ảnh vuông: chính diện, góc 45°, từ trên xuống, ảnh đời thường.', how: 'Thả ảnh sản phẩm vào node Ảnh đầu vào rồi bấm Chạy tất cả; 4 ảnh tự tải về máy.',
      nodes: [IN('s', 'product'), P('a', 'Ảnh sản phẩm chụp chính diện trên nền trắng tinh, ánh sáng softbox đều, bóng đổ mềm, độ nét cao.'), P('b', 'Ảnh sản phẩm chụp góc 45 độ trên nền xám nhạt, ánh sáng bên hông làm nổi khối, độ nét cao.'), P('c', 'Ảnh sản phẩm chụp từ trên xuống (flat lay) trên mặt gỗ sáng, vài đạo cụ nhỏ hài hoà xung quanh.'), P('e', 'Ảnh đời thường: sản phẩm đang được sử dụng trong không gian sống hiện đại, ánh nắng tự nhiên, cảm giác ấm áp.'),
        IMG('ga', { size: '1:1', customName: 'Chính diện' }), IMG('gb', { size: '1:1', customName: 'Góc 45°' }), IMG('gc', { size: '1:1', customName: 'Từ trên xuống' }), IMG('ge', { size: '1:1', customName: 'Đời thường' }), { k: 'd', type: 'download', data: {} }],
      edges: [['s', 'image', 'ga', 'reference'], ['s', 'image', 'gb', 'reference'], ['s', 'image', 'gc', 'reference'], ['s', 'image', 'ge', 'reference'], ['a', 'text', 'ga', 'prompt'], ['b', 'text', 'gb', 'prompt'], ['c', 'text', 'gc', 'prompt'], ['e', 'text', 'ge', 'prompt'], ['ga', 'image', 'd', 'media'], ['gb', 'image', 'd', 'media'], ['gc', 'image', 'd', 'media'], ['ge', 'image', 'd', 'media']] },
    { id: 'story-3', cat: 'Kể chuyện', name: 'Truyện 3 cảnh, nhân vật nhất quán', desc: 'Khóa nhân vật + 3 cảnh: mỗi cảnh một ảnh làm khung đầu rồi thành video 8 giây, cùng một gương mặt.', how: 'Điền tên + ngoại hình nhân vật (thêm ảnh nếu có), sửa 3 câu lệnh cảnh, bấm Chạy tất cả.',
      nodes: [{ k: 'ch', type: 'character', data: { name: 'Lan', description: 'Cô gái Việt 25 tuổi, tóc đen dài buộc nửa, áo dài trắng, nụ cười hiền', enabled: true } },
        P('i1', 'Cảnh 1: Lan đứng bên cửa sổ lúc bình minh, nhìn ra phố cổ, ánh nắng vàng nhẹ, phong cách điện ảnh.'), IMG('g1', { outputRole: 'startFrame', customName: 'Cảnh 1' }), P('m1', 'Lan quay đầu nhìn về máy quay và mỉm cười, tóc khẽ bay, máy quay đẩy chậm vào.'), VID('v1', { customName: 'Video cảnh 1' }),
        P('i2', 'Cảnh 2: Lan đạp xe qua con phố đầy hoa giấy, buổi sáng trong trẻo, phong cách điện ảnh.'), IMG('g2', { outputRole: 'startFrame', customName: 'Cảnh 2' }), P('m2', 'Lan đạp xe chậm qua khung hình từ trái sang phải, cánh hoa rơi, máy quay lia theo.'), VID('v2', { customName: 'Video cảnh 2' }),
        P('i3', 'Cảnh 3: Lan ngồi bên bờ hồ lúc hoàng hôn, mặt nước lấp lánh, phong cách điện ảnh.'), IMG('g3', { outputRole: 'startFrame', customName: 'Cảnh 3' }), P('m3', 'Lan nhắm mắt hít thở, gió nhẹ lay áo dài, máy quay lùi xa dần để lộ toàn cảnh hồ.'), VID('v3', { customName: 'Video cảnh 3' })],
      edges: [['i1', 'text', 'g1', 'prompt'], ['g1', 'image', 'v1', 'reference'], ['m1', 'text', 'v1', 'prompt'], ['i2', 'text', 'g2', 'prompt'], ['g2', 'image', 'v2', 'reference'], ['m2', 'text', 'v2', 'prompt'], ['i3', 'text', 'g3', 'prompt'], ['g3', 'image', 'v3', 'reference'], ['m3', 'text', 'v3', 'prompt']] },
    { id: 'video-chain', cat: 'Video', name: 'Video nối tiếp bằng khung cuối', desc: 'Video 1 xong, app lấy khung cuối làm khung đầu cho video 2 để hai đoạn nối liền mạch.', how: 'Sửa 2 câu lệnh rồi bấm Chạy tất cả; kéo 2 video vào Timeline để xuất một file.',
      nodes: [P('a', 'Một chú mèo cam nhảy lên bậu cửa sổ đầy nắng, máy quay ngang tầm mắt, phong cách điện ảnh.'), VID('v1', { customName: 'Đoạn 1', referenceMode: 'firstFrame' }), P('b', 'Chú mèo cam nằm xuống bậu cửa, duỗi người rồi lim dim ngủ, máy quay đẩy chậm vào.'), VID('v2', { customName: 'Đoạn 2 (nối khung cuối)' }), { k: 'd', type: 'download', data: {} }],
      edges: [['a', 'text', 'v1', 'prompt'], ['v1', 'endFrame', 'v2', 'reference'], ['b', 'text', 'v2', 'prompt'], ['v1', 'video', 'd', 'media'], ['v2', 'video', 'd', 'media']] },
    { id: 'ai-multi', cat: 'AI viết prompt', name: 'Ý tưởng → AI viết 3 prompt → 3 ảnh', desc: 'Gõ một ý tưởng, AI Agent viết 3 prompt khác nhau, Tách chữ chia ra, mỗi prompt thành một ảnh.', how: 'Cần Gemini API key trong Cài đặt. Sửa ý tưởng rồi bấm Chạy tất cả.',
      nodes: [P('idea', '5 lợi ích của việc chạy bộ buổi sáng, phong cách minh hoạ 3D tươi sáng'), { k: 'ai', type: 'aiAgent', data: { mode: 'list', count: 3, instruction: '', resultText: '', inputHash: '' } },
        { k: 'x1', type: 'textExtract', data: { mode: 'item', index: 1, pattern: '', end: '' } }, { k: 'x2', type: 'textExtract', data: { mode: 'item', index: 2, pattern: '', end: '' } }, { k: 'x3', type: 'textExtract', data: { mode: 'item', index: 3, pattern: '', end: '' } },
        IMG('g1', { customName: 'Ảnh 1' }), IMG('g2', { customName: 'Ảnh 2' }), IMG('g3', { customName: 'Ảnh 3' })],
      edges: [['idea', 'text', 'ai', 'text'], ['ai', 'text', 'x1', 'text'], ['ai', 'text', 'x2', 'text'], ['ai', 'text', 'x3', 'text'], ['x1', 'text', 'g1', 'prompt'], ['x2', 'text', 'g2', 'prompt'], ['x3', 'text', 'g3', 'prompt']] },
    { id: 'restyle', cat: 'AI viết prompt', name: 'Ảnh mẫu → đổi phong cách', desc: 'AI mô tả ảnh mẫu thành prompt, nối thêm phong cách mới (đất sét 3D, anime…), tạo lại ảnh.', how: 'Cần Gemini API key. Thả ảnh mẫu, đổi chữ trong node Nối thêm chữ thành phong cách bạn muốn.',
      nodes: [IN('s', 'style'), { k: 'ai', type: 'aiAgent', data: { mode: 'describe', count: 4, instruction: '', resultText: '', inputHash: '' } }, { k: 'ap', type: 'textAppend', data: { text: 'Re-imagine it as a cute claymation 3D scene, soft studio light, handmade texture.' } }, IMG('g', { size: '1:1', customName: 'Phong cách mới' })],
      edges: [['s', 'image', 'ai', 'image'], ['ai', 'text', 'ap', 'text'], ['ap', 'text', 'g', 'prompt']] },
    { id: 'thumbnail', cat: 'Mạng xã hội', name: 'Ảnh bìa YouTube 16:9', desc: 'Ảnh khuôn mặt của bạn + chủ đề → ảnh bìa YouTube ngang, biểu cảm mạnh, bố cục chừa chỗ chữ.', how: 'Thả ảnh khuôn mặt, sửa chủ đề trong câu lệnh, bấm Chạy tất cả (thêm chữ bằng app chỉnh ảnh sau).',
      nodes: [IN('f', 'model'), P('p', 'Ảnh bìa YouTube: người này biểu cảm ngạc nhiên mạnh ở bên phải khung hình, bên trái là một chiếc laptop phát sáng, nền xanh tím rực rỡ, ánh sáng viền, chừa khoảng trống phía trên bên trái để đặt chữ, không có chữ trong ảnh.'), IMG('g', { size: '16:9', customName: 'Ảnh bìa' }), { k: 'pv', type: 'preview', data: {} }],
      edges: [['f', 'image', 'g', 'reference'], ['p', 'text', 'g', 'prompt'], ['g', 'image', 'pv', 'media']] },
    { id: 'red-carpet', cat: 'Mạng xã hội', name: 'Idol lên thảm đỏ (đu trend)', desc: 'Ảnh của bạn + ảnh trang phục → character sheet 4 góc → video 8 giây bạn bước trên thảm đỏ, theo bối cảnh và chuyển động của một video mẫu.', how: 'Thả ảnh của bạn, ảnh trang phục và một video thảm đỏ mẫu vào 3 node đầu vào, rồi bấm Chạy tất cả.',
      nodes: [IN('face', 'model'), IN('outfit', 'outfit'),
        P('sheet', 'Character sheet 4 ô trên nền xám trơn, ánh sáng studio đều. Ô 1: cận mặt chính diện. Ô 2: cận mặt nghiêng 3/4. Ô 3: toàn thân chính diện. Ô 4: toàn thân nhìn từ phía sau. Giữ đúng gương mặt, kiểu tóc và vóc dáng của người trong ảnh người mẫu, mặc đúng bộ trang phục trong ảnh trang phục. Ảnh chụp thật, chi tiết rõ nét, không chữ, không logo.'),
        IMG('g', { size: '16:9', outputRole: 'model', customName: 'Character sheet 4 góc' }),
        { k: 'ref', type: 'videoReference', data: { use: 'references', frameCount: 3, motion: '' } },
        P('scene', 'Video thảm đỏ: người trong character sheet thay cho nhân vật chính của video mẫu, giữ nguyên gương mặt, kiểu tóc và trang phục trong character sheet. Bám theo bối cảnh, dáng đi và chuyển động máy quay của video mẫu: bước chậm trên thảm đỏ, quay sang mỉm cười với ống kính, đèn flash nháy liên tục, phóng viên đứng hai bên. Sự kiện ban đêm, phong cách điện ảnh, không chữ trên hình.'),
        VID('v', { referenceMode: 'ingredients', customName: 'Video thảm đỏ' })],
      edges: [['face', 'image', 'g', 'reference'], ['outfit', 'image', 'g', 'reference'], ['sheet', 'text', 'g', 'prompt'], ['g', 'image', 'v', 'reference'], ['ref', 'image', 'v', 'reference'], ['scene', 'text', 'v', 'prompt']] },
    { id: 'tiktok-hook', cat: 'Mạng xã hội', name: 'Video TikTok 3 nhịp (hook – nội dung – kết)', desc: 'Ba video dọc 9:16 nối khung cuối với nhau: mở đầu gây chú ý, phần chính, kết kêu gọi.', how: 'Sửa 3 câu lệnh theo sản phẩm/chủ đề của bạn, bấm Chạy tất cả, rồi xuất bằng Timeline.',
      nodes: [P('h', 'Hook: cận cảnh bàn tay mở hộp quà, ánh sáng loé ra, máy quay đẩy nhanh vào, nhịp dồn dập.'), VID('v1', { customName: 'Hook' }), P('b', 'Nội dung: sản phẩm xoay chậm giữa không trung, các chi tiết nổi bật lần lượt sáng lên.'), VID('v2', { customName: 'Nội dung' }), P('e', 'Kết: người dùng cầm sản phẩm mỉm cười nhìn máy quay, nền ấm áp, máy quay lùi nhẹ.'), VID('v3', { customName: 'Kết' })],
      edges: [['h', 'text', 'v1', 'prompt'], ['v1', 'endFrame', 'v2', 'reference'], ['b', 'text', 'v2', 'prompt'], ['v2', 'endFrame', 'v3', 'reference'], ['e', 'text', 'v3', 'prompt']] }
  ];
  const TYPE_COLOR = { prompt: '#9177e1', negativePrompt: '#f87171', textAppend: '#9177e1', textConcat: '#9177e1', aiAgent: '#6f8bf7', textExtract: '#6f8bf7', imageInput: '#ec4899', videoReference: '#f472b6', character: '#f59e0b', references: '#ec4899', generateImage: '#3b82f6', generateVideo: '#a855f7', download: '#0ea5e9', preview: '#8b8b92', timeline: '#22c55e' };
  // Column / row of each template node, the same leveling auto-layout uses, for the mini diagram.
  function templateLevels(t) {
    const depth = Object.fromEntries(t.nodes.map(n => [n.k, 0]));
    for (let i = 0; i < t.nodes.length; i++) for (const [a, , b] of t.edges) depth[b] = Math.max(depth[b], depth[a] + 1);
    for (const n of t.nodes) { const outs = t.edges.filter(e => e[0] === n.k).map(e => depth[e[2]]); if (!t.edges.some(e => e[2] === n.k) && outs.length) depth[n.k] = Math.max(0, Math.min(...outs) - 1); }
    const rows = {}; const place = {};
    for (const n of t.nodes) { const d = depth[n.k]; rows[d] = (rows[d] || 0) + 1; place[n.k] = { col: d, row: rows[d] - 1 }; }
    return { place, cols: Math.max(...Object.values(depth)) + 1, rows: Math.max(...Object.values(rows)) };
  }
  function miniDiagram(t) {
    const { place, cols, rows } = templateLevels(t), W = 280, H = 132, cw = W / cols, rh = H / Math.max(rows, 1), bw = Math.min(46, cw * .62), bh = Math.min(22, rh * .6);
    const at = k => { const p = place[k], colCount = t.nodes.filter(n => place[n.k].col === p.col).length, offset = (H - colCount * rh) / 2; return { x: p.col * cw + (cw - bw) / 2, y: offset + p.row * rh + (rh - bh) / 2 }; };
    const lines = t.edges.map(([a, , b]) => { const p = at(a), q = at(b), x1 = p.x + bw, y1 = p.y + bh / 2, x2 = q.x, y2 = q.y + bh / 2, mx = (x1 + x2) / 2; return `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" />`; }).join('');
    const boxes = t.nodes.map(n => { const p = at(n.k); return `<rect x="${p.x}" y="${p.y}" width="${bw}" height="${bh}" rx="5" fill="${TYPE_COLOR[n.type] || '#71717a'}" fill-opacity=".22" stroke="${TYPE_COLOR[n.type] || '#71717a'}" />`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g fill="none" stroke="#4b4d55" stroke-width="1.6">${lines}</g>${boxes}</svg>`;
  }
  function insertTemplate(t) {
    const a = app(), s = a.state;
    a.createUndoSnapshot(`Mẫu: ${t.name}`);
    const live = s.nodes.filter(n => !n.data?.dockOnly);
    const bottom = live.length ? Math.max(...live.map(n => n.y + (nodeEl(n.id)?.offsetHeight || 420))) + 160 : 80;
    const left = live.length ? Math.min(...live.map(n => n.x)) : 80;
    const ids = {}, { place } = templateLevels(t);
    for (const spec of t.nodes) {
      const node = a.makeNode(spec.type, left + place[spec.k].col * 380, bottom + place[spec.k].row * 420);
      node.data = { ...(node.data || {}), ...structuredClone(spec.data || {}) };
      s.nodes.push(node); ids[spec.k] = node.id;
    }
    for (const [from, fromPort, to, toPort] of t.edges) s.edges.push({ id: a.uid('edge'), source: ids[from], sourcePort: fromPort, target: ids[to], targetPort: toPort });
    a.render();
    // Real node sizes are known after render, so lay out the new nodes then fit them on screen.
    autoLayout(Object.values(ids));
    s.selectedNodeIds = Object.values(ids); s.selectedNodeId = s.selectedNodeIds.at(-1);
    a.render(); a.saveState();
    setTimeout(() => a.fitCanvas(Object.values(ids)), 30);
    a.setRunStatus(`Đã thêm mẫu "${t.name}". ${t.how}`, 'ok');
  }
  let galleryCat = 'Tất cả';
  function openGallery() {
    let modal = $('#galleryModal');
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'galleryModal'; modal.className = 'modal-backdrop hidden';
      modal.innerHTML = `<section class="modal ts-gallery" role="dialog" aria-modal="true" aria-labelledby="galleryTitle">
        <header><i data-ic="layout-template" data-size="20"></i><h2 id="galleryTitle">Kho mẫu workflow</h2><button type="button" class="ts-gallery-close" aria-label="Đóng"><i data-ic="x"></i></button></header>
        <div class="ts-gallery-tools"><label class="ts-gallery-search"><i data-ic="search" data-size="14"></i><input id="gallerySearch" placeholder="Tìm mẫu… (vd: sản phẩm, video, nhân vật)"></label><nav id="galleryCats"></nav></div>
        <div id="galleryGrid" class="ts-gallery-grid"></div>
        <p class="ts-gallery-note">Bấm "Dùng mẫu" để thêm vào canvas (không xoá node đang có). Ctrl+Z để hoàn tác.</p></section>`;
      document.body.appendChild(modal);
      modal.onclick = e => { if (e.target === modal || e.target.closest('.ts-gallery-close')) modal.classList.add('hidden'); };
      modal.querySelector('#gallerySearch').oninput = drawGallery;
      modal.querySelector('#galleryCats').onclick = e => { const b = e.target.closest('[data-cat]'); if (b) { galleryCat = b.dataset.cat; drawGallery(); } };
      modal.querySelector('#galleryGrid').onclick = e => { const b = e.target.closest('[data-use]'); if (!b) return; const t = TEMPLATES.find(x => x.id === b.dataset.use); modal.classList.add('hidden'); if (t) insertTemplate(t); };
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) modal.classList.add('hidden'); });
    }
    drawGallery(); modal.classList.remove('hidden'); modal.querySelector('#gallerySearch').focus();
  }
  function drawGallery() {
    const cats = ['Tất cả', ...new Set(TEMPLATES.map(t => t.cat))], q = ($('#gallerySearch')?.value || '').trim().toLowerCase();
    $('#galleryCats').innerHTML = cats.map(c => `<button type="button" data-cat="${esc(c)}" class="${c === galleryCat ? 'active' : ''}">${esc(c)}</button>`).join('');
    const list = TEMPLATES.filter(t => (galleryCat === 'Tất cả' || t.cat === galleryCat) && (!q || `${t.name} ${t.desc} ${t.cat}`.toLowerCase().includes(q)));
    $('#galleryGrid').innerHTML = list.length ? list.map(t => `<article class="ts-card" data-template="${t.id}">
      <div class="ts-card-thumb">${miniDiagram(t)}<span class="ts-card-cat">${esc(t.cat)}</span><span class="ts-card-count"><i data-ic="workflow" data-size="12"></i>${t.nodes.length} node</span></div>
      <div class="ts-card-body"><h3>${esc(t.name)}</h3><p>${esc(t.desc)}</p><button type="button" data-use="${t.id}"><i data-ic="sparkles" data-size="14"></i>Dùng mẫu</button></div></article>`).join('') : '<p class="ts-gallery-empty">Không có mẫu nào khớp.</p>';
  }

  // ---------- wiring ----------
  hooks.openWirePicker = ({ direction, from, to, x, y }) => { if (!app()) return false; openPicker(x, y, { direction, from, to }); return Boolean(picker); };
  const previous = hooks.onRender;
  hooks.onRender = payload => { try { previous?.(payload); } finally { try { decorate(); } catch (error) { console.warn('[cos_alpha_flow] canvas', error); } } };
  function init() {
    if (!app()) { setTimeout(init, 100); return; }
    document.body.classList.add('ts-canvas');
    setupRail();
    $('#galleryOpenBtn')?.addEventListener('click', openGallery);
    decorate();
    app().scheduleDrawEdges();
  }
  window.CosAlphaCanvas = { openPicker, closePicker, autoLayout, layoutAll, openGallery, insertTemplate, setOff, cycleScale, TEMPLATES };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
