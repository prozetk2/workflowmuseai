// cos_alpha_flow: shared text/vision calls to the official Gemini API and prompt presets.
// Used by the AI Agent node, the AI script writer, Prompt Assistant and Image → Prompt.
// The API key stays in chrome.storage.local (same key as the Gemini API generation mode).
(() => {
  'use strict';
  const BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const DEFAULT_MODEL = 'gemini-2.5-flash';

  async function getKey() { try { return (await chrome.storage.local.get('thekeyGeminiApiKey')).thekeyGeminiApiKey || ''; } catch { return ''; } }
  async function getModel() { try { return (await chrome.storage.local.get('cosalphaScriptModel')).cosalphaScriptModel || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; } }
  function inline(dataUrl) {
    const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(String(dataUrl || ''));
    return match ? { inlineData: { mimeType: match[1], data: match[2] } } : null;
  }

  // text({system, user, images:[dataUrl], json:false}) → { text, model }
  async function text({ system = '', user = '', images = [], json = false, temperature = 0.8, signal, apiKey, model } = {}) {
    apiKey = apiKey || await getKey();
    if (!apiKey) throw Object.assign(new Error('Chưa có Gemini API key. Vào Cài đặt → Tạo bằng: Gemini API → dán key → Lưu (sau đó có thể chuyển lại về tab Flow, key vẫn được giữ).'), { code: 'NO_API_KEY' });
    model = (model || await getModel()).trim();
    const parts = [{ text: user }, ...images.map(inline).filter(Boolean)];
    const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const call = async m => {
      const response = await fetch(`${BASE}/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', signal, headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(`Gemini: ${data?.error?.message || `HTTP ${response.status}`}`), { status: response.status });
      const out = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (!out) throw new Error(`Gemini không trả về chữ${data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ''}. Hãy đổi cách diễn đạt.`);
      return out;
    };
    try { return { text: await call(model), model }; }
    catch (error) {
      if (error.status !== 404 && !/not found|is not supported/i.test(error.message)) throw error;
      // The model name was retired: pick a current Flash text model this key can use.
      const list = await (await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey }, signal })).json();
      const pick = (list.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, '')).filter(n => /flash/i.test(n) && !/image|tts|live|audio|embedding|thinking-exp/i.test(n)).sort().reverse()[0];
      if (!pick) throw error;
      chrome.storage.local.set({ cosalphaScriptModel: pick }).catch(() => {});
      return { text: await call(pick), model: pick };
    }
  }
  const clean = value => String(value || '').replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();

  const STYLES = {
    '': { label: 'Không thêm phong cách', text: '' },
    clay: { label: 'Đất sét 3D (claymation)', text: 'claymation stop-motion look, handmade plasticine characters with visible fingerprints, soft clay textures, chunky proportions, warm cinematic lighting, miniature set' },
    cute3d: { label: 'Hoạt hình 3D dễ thương', text: 'cute 3D animated film look, soft rounded shapes, expressive faces, vibrant colors, global illumination' },
    handdrawn: { label: 'Hoạt hình vẽ tay ấm áp', text: 'warm hand-painted 2D animation look, soft watercolor backgrounds, gentle pastel palette, nostalgic mood' },
    anime: { label: 'Anime', text: 'Japanese anime style, clean line art, cel shading, dramatic sky, dynamic angle' },
    cinematic: { label: 'Điện ảnh chân thực', text: 'photorealistic cinematic still, natural motivated lighting, anamorphic lens, shallow depth of field, subtle film grain' },
    fashion: { label: 'Quảng cáo thời trang', text: 'high-end fashion editorial, glossy commercial lighting, elegant pose, magazine quality' },
    product: { label: 'Ảnh sản phẩm', text: 'premium product photography, clean seamless background, softbox lighting, crisp reflections, macro detail' },
    film35: { label: 'Phim 35mm cổ điển', text: 'vintage 35mm film photo, Kodak Portra colors, natural grain, soft halation' },
    neon: { label: 'Neon cyberpunk', text: 'neon cyberpunk night, rain-soaked streets, magenta and cyan rim light, reflective surfaces' },
    watercolor: { label: 'Màu nước', text: 'delicate watercolor illustration, paper texture, soft bleeding edges' },
    kdrama: { label: 'Chân dung Hàn Quốc trong trẻo', text: 'bright airy Korean beauty portrait, soft pastel tones, dewy skin, clean natural light' }
  };
  // Preset prompt sets for the quick "Tạo" tab (one prompt per line). Work best with a reference image.
  const PRESETS = {
    angles: { label: 'Góc máy (6)', prompts: ['Same subject as the reference image, front view, eye level, medium shot', 'Same subject, three-quarter view from the left, medium close-up', 'Same subject, side profile view, medium shot', 'Same subject, low angle hero shot looking up', 'Same subject, high angle shot looking down', 'Same subject, full body wide shot showing the whole scene'] },
    expressions: { label: 'Biểu cảm (6)', prompts: ['Same person as the reference image, big genuine smile, close-up portrait', 'Same person, laughing with eyes closed, close-up', 'Same person, surprised expression, close-up', 'Same person, thoughtful calm expression looking away, close-up', 'Same person, confident smirk, close-up', 'Same person, gentle shy smile looking down, close-up'] },
    product360: { label: 'Sản phẩm 360° (4)', prompts: ['Exactly the product in the reference image, front view, centered, studio lighting', 'Exactly the same product, rotated 90 degrees, side view', 'Exactly the same product, back view', 'Exactly the same product, top-down view'] },
    lighting: { label: 'Ánh sáng (5)', prompts: ['Same scene as the reference image, golden hour warm sunlight', 'Same scene, soft overcast daylight', 'Same scene, blue hour twilight with city lights', 'Same scene, dramatic low-key studio lighting', 'Same scene, neon night lighting'] },
    outfits: { label: 'Đổi trang phục (4)', prompts: ['Same person as the reference image wearing an elegant evening dress', 'Same person wearing casual streetwear', 'Same person wearing a traditional Vietnamese áo dài', 'Same person wearing a business suit'] },
    seasons: { label: 'Bốn mùa (4)', prompts: ['Same scene as the reference image in spring with blossoms', 'Same scene in summer, bright sun', 'Same scene in autumn with falling leaves', 'Same scene in winter with snow'] }
  };
  const ASSISTANT_SYSTEM = 'You are a prompt engineer for Google Flow (Veo video, Nano Banana images). Rewrite each user prompt into one detailed, vivid English prompt: subject, action, setting, composition, camera, lighting, style. Keep the user\'s intent, keep any @names unchanged, do not add text overlays. If several prompts are given (numbered or separated by blank lines), return the same number of prompts in the same order, separated by one blank line, without numbering or commentary.';
  const I2P_SYSTEM = 'You describe images as generation prompts. Return JSON: {"en": detailed English prompt to recreate this image (subject, appearance, clothing, pose, setting, composition, camera/lens, lighting, color palette, style), "vi": the same description in natural Vietnamese for reading, "short": a one-sentence English prompt}.';

  window.CosAlphaAI = { text, clean, getKey, STYLES, PRESETS, ASSISTANT_SYSTEM, I2P_SYSTEM, DEFAULT_MODEL };
})();
