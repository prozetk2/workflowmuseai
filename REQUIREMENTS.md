# TheKey.studio MVP — Requirements

## Required

1. Google Chrome or Chromium
2. A Muse.ai account
3. A signed-in Muse chat tab in the same Chrome profile

TheKey.studio itself has **zero npm/pip dependencies**. The supplied folder is already a loadable Chrome extension. After replacing files, open `chrome://extensions` and click Reload on TheKey.studio. The Muse session check runs automatically on canvas open and when a Muse tab finishes loading.

TheKey.studio uses the signed-in Muse.ai tab directly and no longer requires `muse2api`, an API key, or a local backend. Keep the Muse chat tab open while generating. Text-to-image, text-to-video and reference-image upload are supported. The integration follows Muse's current page UI and may need updating if Muse changes its interface.
