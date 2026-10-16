# TheKey.studio Flow

[Tiếng Việt](README-vi.md)

TheKey.studio's node canvas, Script → Nodes, Timeline and local FFmpeg MP4 export, generating through **Google Flow (Veo)** in your signed-in browser tab, or through the **Gemini API**.

Install: `chrome://extensions` → Developer mode → Load unpacked → this folder. Then open a Flow project at flow.google.com (or add a Gemini API key in Settings) and run a workflow.

Veo limits: 16:9 or 9:16 video, 4/6/8-second clips. Images: up to 5 references per scene on Flow. Video: either one start frame or up to 3 reference images (Reference-to-Video), never both; through the Gemini API, clips with references are always 8 seconds. Each Image Input can be tagged with a role (model, outfit, product, background, style, start frame); the sidebar preset "👗 Quảng cáo thời trang" builds a model + outfit fashion ad. Settings → "Kiểm tra trang Flow" reports which parts of Flow's page the bridge can still find.

Automating Flow's web page may conflict with Google's terms, and every generation spends real credits. License: GPL-2.0-or-later.
