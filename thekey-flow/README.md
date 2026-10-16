# TheKey.studio Flow

[Tiếng Việt](README-vi.md)

TheKey.studio's node canvas, Script → Nodes, Timeline and local FFmpeg MP4 export, generating through **Google Flow (Veo)** in your signed-in browser tab, or through the **Gemini API**.

Install: `chrome://extensions` → Developer mode → Load unpacked → this folder. Then open a Flow project at flow.google.com (or add a Gemini API key in Settings) and run a workflow.

Veo limits: 16:9 or 9:16 video, 4/6/8-second clips. Up to 5 images per scene through the Flow tab, up to 3 through the Gemini API (8-second clips when used). Each Image Input can be tagged with a role (model, outfit, product, background, style, start frame); the sidebar preset "👗 Quảng cáo thời trang" builds a model + outfit fashion ad. Settings → "Kiểm tra trang Flow" reports which parts of Flow's page the bridge can still find.

Automating Flow's web page may conflict with Google's terms, and every generation spends real credits. License: GPL-2.0-or-later.
