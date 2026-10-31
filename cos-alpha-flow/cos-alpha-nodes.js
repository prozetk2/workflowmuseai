// cos_alpha_flow extra node types, registered before app.js loads.
// Each entry: def (ports, like nodeDefs in app.js), defaults, render(node, body, api),
// resolveText(node, {upstream}) for text outputs, run(node, api) during a workflow run.
(() => {
  'use strict';
  const stop = el => { el.onpointerdown = event => event.stopPropagation(); return el; };
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const hint = text => make('div', { className: 'hint', textContent: text });
  const hash = value => { let h = 0; const s = String(value); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
  const upstreamText = (node, api, port = 'text') => api.getIncoming(node.id, port).map(api.sourceFor).filter(Boolean).map(src => api.resolveText(src.id)).filter(s => String(s).trim()).join('\n\n');
  function mediaOf(edge, api) {
    const src = api.sourceFor(edge); if (!src) return null;
    if (edge.sourcePort === 'endFrame' && src.data.endFrame?.url) return { ...src.data.endFrame, kind: 'image', label: src.data.customName || src.data.sceneLabel || src.id };
    if (src.data.asset?.url) return { ...src.data.asset, label: src.data.customName || src.data.sceneLabel || src.id };
    if (src.data.localDataUrl) return { url: src.data.localDataUrl, kind: 'image', id: src.id, label: src.data.name || src.id };
    return null;
  }

  const AGENT_MODES = {
    enhance: { label: 'Viết lại prompt chi tiết (tiếng Anh)', system: () => window.CosAlphaAI.ASSISTANT_SYSTEM },
    translate: { label: 'Dịch sang tiếng Anh', system: () => 'Translate the user text into natural English for an image/video generation prompt. Keep @names and numbers. Return only the translation.' },
    list: { label: 'Viết N prompt (mỗi đoạn 1 prompt)', system: n => `Write ${n.data.count || 4} different, detailed English image/video prompts for the user's idea, consistent in style and characters. Separate prompts with one blank line. No numbering, no commentary.` },
    script: { label: 'Viết kịch bản chia cảnh', system: n => `Write a ${n.data.count || 4}-scene short video script for the user's idea. For each scene output exactly:\nCẢNH <n> (<m:ss>–<m:ss>): <short Vietnamese title>\n\nPrompt ảnh: <detailed English image prompt>\n\nPrompt video: <English motion + camera prompt, 8 seconds>\nAudio: <Vietnamese voice-over or sound>\nNo other text.` },
    describe: { label: 'Mô tả ảnh thành prompt', system: () => 'Describe the attached image as one detailed English generation prompt (subject, appearance, clothing, pose, setting, composition, lens, lighting, palette, style). Return only the prompt.' },
    custom: { label: 'Tự ra lệnh', system: n => n.data.instruction || 'Follow the user instruction.' }
  };

  const nodes = {
    aiAgent: {
      def: { title: 'AI Agent', inputs: [{ id: 'text', label: 'chữ vào', type: 'text', multiple: true }, { id: 'image', label: 'ảnh', type: 'image', multiple: true }], outputs: [{ id: 'text', label: 'kết quả', type: 'text' }] },
      defaults: { mode: 'enhance', instruction: '', count: 4, resultText: '', inputHash: '' },
      resolveText: node => node.data.resultText || '',
      render(n, body, api) {
        const mode = stop(make('select'));
        Object.entries(AGENT_MODES).forEach(([key, value]) => mode.append(make('option', { value: key, textContent: value.label, selected: n.data.mode === key })));
        mode.onchange = () => { n.data.mode = mode.value; n.data.inputHash = ''; api.render(); api.scheduleAutoSave(); };
        body.append(mode);
        if (['list', 'script'].includes(n.data.mode)) {
          const count = stop(make('input', { type: 'number', min: 1, max: 12, value: n.data.count || 4, title: 'Số prompt / số cảnh' }));
          count.oninput = () => { n.data.count = Math.max(1, Math.min(12, Number(count.value) || 4)); n.data.inputHash = ''; api.scheduleAutoSave(); };
          body.append(count);
        }
        const instruction = stop(make('textarea', { className: 'agent-instruction', value: n.data.instruction || '', placeholder: n.data.mode === 'custom' ? 'Lệnh cho AI, vd: Viết 5 caption TikTok vui cho video này' : 'Yêu cầu thêm (tuỳ chọn), vd: giữ phong cách đất sét 3D' }));
        instruction.oninput = () => { n.data.instruction = instruction.value; n.data.inputHash = ''; api.scheduleAutoSave(); };
        body.append(instruction);
        const result = stop(make('textarea', { className: 'agent-result', value: n.data.resultText || '', placeholder: 'Kết quả của AI hiện ở đây (sửa tay được).' }));
        result.oninput = () => { n.data.resultText = result.value; api.scheduleAutoSave(); };
        body.append(result);
        const run = stop(make('button', { className: 'small-btn', type: 'button', textContent: n.data.status === 'running' ? 'AI đang viết…' : 'Chạy AI' }));
        run.disabled = n.data.status === 'running' || api.state.isRunning;
        run.onclick = () => api.executeNode(n.id);
        body.append(run, make('div', { className: `status ${n.data.status || ''}`, textContent: n.data.error || (n.data.model ? `Gemini · ${n.data.model}` : 'Dùng Gemini API key trong Cài đặt. Nối ra node Câu lệnh / Tạo ảnh / Tách chữ.') }));
      },
      async run(n, api) {
        const input = upstreamText(n, api), images = [];
        for (const edge of api.getIncoming(n.id, 'image')) { const media = mediaOf(edge, api); if (media?.url && media.kind !== 'video') images.push(await api.toDataUrl(media.url)); }
        if (!input.trim() && !images.length && n.data.mode !== 'custom') throw new Error('AI Agent chưa có chữ hoặc ảnh đi vào.');
        const key = hash([n.data.mode, n.data.instruction, n.data.count, input, images.map(i => i.length).join(',')].join('|'));
        if (n.data.resultText && n.data.inputHash === key && api.targetId !== n.id) return;
        const modeDef = AGENT_MODES[n.data.mode] || AGENT_MODES.enhance;
        const extra = n.data.mode !== 'custom' && n.data.instruction ? `\n\nExtra requirements: ${n.data.instruction}` : '';
        api.setRunStatus('AI Agent đang viết…', 'warn');
        const out = await window.CosAlphaAI.text({ system: modeDef.system(n), user: (input || '(see the attached image)') + extra, images, signal: api.signal });
        n.data.resultText = window.CosAlphaAI.clean(out.text); n.data.model = out.model; n.data.inputHash = key;
      }
    },

    textExtract: {
      def: { title: 'Tách chữ', inputs: [{ id: 'text', label: 'chữ vào', type: 'text' }], outputs: [{ id: 'text', label: 'phần tách', type: 'text' }] },
      defaults: { mode: 'item', index: 1, pattern: '', end: '' },
      resolveText(node, { upstream }) {
        const text = upstream('text').join('\n\n'), index = Math.max(1, Number(node.data.index) || 1), d = node.data;
        try {
          if (d.mode === 'item') { const items = text.replace(/\r/g, '').split(/\n\s*\n|\n(?=\s*(?:\d+\s*[.)]|CẢNH\s+\d+)\s)/i).map(s => s.replace(/^\s*\d+\s*[.)]\s*/, '').trim()).filter(Boolean); return items[index - 1] || ''; }
          if (d.mode === 'line') return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[index - 1] || '';
          if (d.mode === 'json') { const json = JSON.parse(window.CosAlphaAI.clean(text)); return String((d.pattern || '').split('.').filter(Boolean).reduce((value, key) => value?.[/^\d+$/.test(key) ? Number(key) : key], json) ?? ''); }
          if (d.mode === 'regex') { const match = new RegExp(d.pattern || '(.*)', 'is').exec(text); return match ? (match[1] ?? match[0]).trim() : ''; }
          if (d.mode === 'between') { const start = text.indexOf(d.pattern); if (start < 0) return ''; const from = start + d.pattern.length, stopAt = d.end ? text.indexOf(d.end, from) : -1; return text.slice(from, stopAt < 0 ? undefined : stopAt).trim(); }
        } catch { return ''; }
        return text;
      },
      render(n, body, api) {
        const mode = stop(make('select'));
        [['item', 'Lấy mục số… (đoạn / mục đánh số / CẢNH)'], ['line', 'Lấy dòng số…'], ['between', 'Lấy chữ nằm giữa 2 mốc'], ['json', 'Lấy trường JSON (vd: scenes.0.prompt)'], ['regex', 'Biểu thức regex (nâng cao)']].forEach(([value, text]) => mode.append(make('option', { value, textContent: text, selected: n.data.mode === value })));
        mode.onchange = () => { n.data.mode = mode.value; api.render(); api.scheduleAutoSave(); };
        body.append(mode);
        if (['item', 'line'].includes(n.data.mode)) { const index = stop(make('input', { type: 'number', min: 1, value: n.data.index || 1 })); index.oninput = () => { n.data.index = Number(index.value) || 1; api.scheduleAutoSave(); }; index.onchange = () => api.render(); body.append(index); }
        else {
          const pattern = stop(make('input', { value: n.data.pattern || '', placeholder: n.data.mode === 'between' ? 'Mốc đầu, vd: Prompt ảnh:' : n.data.mode === 'json' ? 'scenes.0.prompt' : 'Prompt:\\s*(.+)' }));
          pattern.oninput = () => { n.data.pattern = pattern.value; api.scheduleAutoSave(); }; pattern.onchange = () => api.render(); body.append(pattern);
          if (n.data.mode === 'between') { const end = stop(make('input', { value: n.data.end || '', placeholder: 'Mốc cuối (tuỳ chọn), vd: Prompt video:' })); end.oninput = () => { n.data.end = end.value; api.scheduleAutoSave(); }; end.onchange = () => api.render(); body.append(end); }
        }
        const preview = api.resolveText(n.id);
        body.append(make('div', { className: 'extract-preview', textContent: preview ? preview.slice(0, 300) : '(chưa có — chạy node phía trước hoặc đổi số mục)' }), hint('Mẹo: AI Agent "Viết N prompt" → nhiều node Tách chữ (mục 1, 2, 3…) → mỗi node Tạo ảnh một prompt.'));
      }
    },

    download: {
      def: { title: 'Tải về máy', inputs: [{ id: 'media', label: 'ảnh/video', type: 'media', multiple: true }], outputs: [] },
      defaults: { folder: 'cos_alpha_flow', downloaded: [] },
      render(n, body, api) {
        const folder = stop(make('input', { value: n.data.folder || 'cos_alpha_flow', placeholder: 'Thư mục trong Downloads' }));
        folder.oninput = () => { n.data.folder = folder.value.replace(/[\\:*?"<>|]+/g, '').replace(/^\/+|\/+$/g, ''); api.scheduleAutoSave(); };
        const count = api.getIncoming(n.id, 'media').length;
        const now = stop(make('button', { className: 'small-btn', type: 'button', textContent: 'Tải ngay' }));
        now.onclick = () => { n.data.downloaded = []; api.executeNode(n.id); };
        body.append(make('div', { className: 'hint', textContent: 'Thư mục trong Downloads:' }), folder, now, make('div', { className: `status ${n.data.status || ''}`, textContent: n.data.error || `${count} nguồn nối vào · đã tải ${n.data.downloaded?.length || 0} file. Chạy workflow sẽ tự tải kết quả mới.` }));
      },
      async run(n, api) {
        if (!chrome.downloads?.download) throw new Error('Chrome chưa cho quyền tải file. Hãy tải lại extension.');
        const done = new Set(n.data.downloaded || []); let saved = 0;
        const edges = api.getIncoming(n.id, 'media');
        for (const [i, edge] of edges.entries()) {
          const media = mediaOf(edge, api); if (!media?.url) continue;
          const key = media.id || media.url.slice(0, 80); if (done.has(key)) continue;
          const ext = media.kind === 'video' ? 'mp4' : (/^data:image\/(\w+)/.exec(media.url)?.[1] || 'png').replace('jpeg', 'jpg');
          const name = `${String(media.label || 'ket-qua').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)}-${i + 1}.${ext}`;
          await chrome.downloads.download({ url: media.url, filename: `${n.data.folder || 'cos_alpha_flow'}/${name}`, conflictAction: 'uniquify' });
          done.add(key); saved++;
        }
        n.data.downloaded = [...done];
        api.setRunStatus(saved ? `Đã tải ${saved} file vào Downloads/${n.data.folder || 'cos_alpha_flow'}.` : 'Node Tải về: không có kết quả mới để tải.', saved ? 'ok' : 'warn');
      }
    }
  };
  window.__cosAlphaNodes = nodes;
})();
