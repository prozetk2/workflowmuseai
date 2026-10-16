// TheKey.studio provider for Google's official Gemini API (Veo for video, Gemini image models for images).
// Docs: https://ai.google.dev/gemini-api/docs/veo and https://ai.google.dev/gemini-api/docs/image-generation
// Used when Settings → Generation is "Gemini API". The API key stays in chrome.storage.local and
// is never written into saved or exported workflows.
(() => {
  'use strict';
  const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
  const POLL_MS = 10000;

  const abortError = () => new DOMException('Generation stopped by user.', 'AbortError');
  const delay = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
  function apiError(message, code = 'API_ERROR') { const error = new Error(message); error.code = code; return error; }

  function inlineData(dataUrl) {
    const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!match) throw apiError('Không đọc được một ảnh đầu vào (dữ liệu base64).');
    return { mimeType: match[1], data: match[2] };
  }

  async function call(apiKey, path, { method = 'GET', body, signal } = {}) {
    if (!apiKey) throw apiError('Hãy nhập Gemini API key trong Cài đặt trước.', 'NO_API_KEY');
    const response = await fetch(`${BASE_URL}/${path}`, {
      method, signal,
      headers: { 'x-goog-api-key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!response.ok) {
      const message = json?.error?.message || text.slice(0, 400) || `HTTP ${response.status}`;
      throw apiError(`Gemini API: ${message}`, response.status === 429 ? 'RATE_LIMIT' : response.status === 400 && /safety|policy|blocked/i.test(message) ? 'SCENE_REFUSED' : 'API_ERROR');
    }
    return json;
  }

  // Builds the predictLongRunning request. Exposed for tests.
  function buildVideoRequest({ prompt, negativePrompt, aspect, duration, resolution, firstFrame, lastFrame, references = [], personGeneration }) {
    const instance = { prompt: String(prompt || '') };
    if (firstFrame) instance.image = { inlineData: inlineData(firstFrame) };
    if (lastFrame) {
      if (!firstFrame) throw apiError('Có khung cuối thì cần có cả khung đầu.');
      instance.lastFrame = { inlineData: inlineData(lastFrame) };
    }
    if (references.length) instance.referenceImages = references.slice(0, 3).map(url => ({ image: { inlineData: inlineData(url) }, referenceType: 'asset' }));
    const parameters = { aspectRatio: aspect === '9:16' ? '9:16' : '16:9' };
    const seconds = [4, 6, 8].includes(Number(duration)) ? Number(duration) : 8;
    // Veo 3.1 requires 8-second clips with reference images, 1080p and 4k.
    parameters.durationSeconds = references.length || ['1080p', '4k'].includes(resolution) ? 8 : seconds;
    if (resolution) parameters.resolution = resolution;
    if (negativePrompt) parameters.negativePrompt = String(negativePrompt);
    if (personGeneration) parameters.personGeneration = personGeneration;
    return { instances: [instance], parameters };
  }

  async function generateVideo(options, signal, onStatus = () => {}) {
    const model = options.model || 'veo-3.1-fast-generate-preview';
    const body = buildVideoRequest(options);
    onStatus(`Sending to ${model}…`);
    let operation = await call(options.apiKey, `models/${encodeURIComponent(model)}:predictLongRunning`, { method: 'POST', body, signal });
    if (!operation?.name) throw apiError('Gemini API không trả về tác vụ để chờ.');
    const operationName = operation.name;
    const started = Date.now();
    const timeoutMs = Math.max(60, Number(options.timeoutSec) || 900) * 1000;
    while (!operation.done) {
      if (Date.now() - started > timeoutMs) throw apiError(`Veo chưa xong sau ${Math.round(timeoutMs / 1000)} giây.`, 'TIMEOUT');
      onStatus(`Veo is generating… ${Math.round((Date.now() - started) / 1000)} s`);
      await delay(POLL_MS, signal);
      operation = await call(options.apiKey, operationName, { signal });
    }
    if (operation.error) throw apiError(`Veo: ${operation.error.message || JSON.stringify(operation.error)}`, /safety|policy|blocked|filtered/i.test(operation.error.message || '') ? 'SCENE_REFUSED' : 'API_ERROR');
    const result = operation.response?.generateVideoResponse || operation.response || {};
    const sample = (result.generatedSamples || result.videos || [])[0];
    const uri = sample?.video?.uri || sample?.uri;
    if (!uri) {
      const reasons = (result.raiMediaFilteredReasons || []).join(' ') || (result.raiMediaFilteredCount ? 'safety filter' : '');
      throw apiError(reasons ? `Veo đã lọc bỏ video này: ${reasons}` : 'Veo chạy xong nhưng không có video.', reasons ? 'SCENE_REFUSED' : 'API_ERROR');
    }
    onStatus('Downloading the video…');
    const response = await fetch(uri, { headers: { 'x-goog-api-key': options.apiKey }, signal });
    if (!response.ok) throw apiError(`Không tải được video Veo (HTTP ${response.status}). Google chỉ giữ video 2 ngày.`);
    const blob = await response.blob();
    return { ok: true, url: URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'video/mp4' })), remoteUrl: uri, warnings: [] };
  }

  function buildImageRequest({ prompt, aspect, references = [] }) {
    const parts = [{ text: String(prompt || '') }, ...references.map(url => ({ inlineData: inlineData(url) }))];
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    if (aspect) generationConfig.imageConfig = { aspectRatio: aspect };
    return { contents: [{ role: 'user', parts }], generationConfig };
  }

  async function generateImage(options, signal, onStatus = () => {}) {
    const model = options.model || 'gemini-nano-banana-2.1';
    onStatus(`Sending to ${model}…`);
    const json = await call(options.apiKey, `models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', body: buildImageRequest(options), signal });
    const parts = json.candidates?.[0]?.content?.parts || [];
    const image = parts.map(part => part.inlineData || part.inline_data).find(data => data?.data);
    if (!image) {
      const reason = json.promptFeedback?.blockReason || json.candidates?.[0]?.finishReason || '';
      const text = parts.map(part => part.text).filter(Boolean).join(' ').slice(0, 300);
      throw apiError(`Không có ảnh trả về${reason ? ` (${reason})` : ''}${text ? `: ${text}` : '.'}`, /SAFETY|PROHIBITED|BLOCK/i.test(reason) ? 'SCENE_REFUSED' : 'API_ERROR');
    }
    return { ok: true, url: `data:${image.mimeType || image.mime_type || 'image/png'};base64,${image.data}`, warnings: [] };
  }

  async function checkKey(apiKey, signal) {
    const json = await call(apiKey, 'models?pageSize=200', { signal });
    const names = (json.models || []).map(model => String(model.name || '').replace(/^models\//, ''));
    return { ok: true, veo: names.filter(name => name.startsWith('veo')), image: names.filter(name => /image/.test(name)) };
  }

  const api = { generateVideo, generateImage, checkKey, buildVideoRequest, buildImageRequest };
  if (typeof window !== 'undefined') window.TheKeyGeminiApi = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
