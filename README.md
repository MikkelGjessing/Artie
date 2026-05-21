# Artie – Export Article PDF

A Chrome extension (Manifest V3) that injects a small floating overlay into any webpage and saves a PDF automatically using the article header as the filename.

---

## What it does

- Clicking the Artie toolbar icon injects (or toggles) a compact floating panel on the current page.
- Clicking **Export PDF** inside the panel:
  1. Extracts the main readable content using a Readability-style heuristic.
  2. Embeds images as base64 data URLs (where CORS allows).
  3. Generates a clean, styled printable page.
  4. Renders the page in a temporary extension tab and downloads the PDF automatically.
- Clicking the toolbar icon turns the floating overlay on or off globally.
- While enabled, the overlay follows you across pages and reappears after tab switches or navigation.
- Works entirely in-page — no browser popup, no external server, no tracking.

---

## Project structure

```
artie/
├── manifest.json          # Manifest V3 extension manifest
├── background.js          # Service worker – handles toolbar click, injects scripts
├── content/
│   └── content.js         # Content script – Shadow DOM overlay, save flow
├── modules/
│   ├── extractor.js       # Readability-style DOM extraction
│   └── exporter.js        # Printable HTML builder + image embedding
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── README.md
└── TESTS.md               # Manual test cases
```

---

## How to install (load unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this project's root folder (the one containing `manifest.json`).
5. The **Artie** extension icon appears in your toolbar.

> **Tip:** Pin it for easy access via the puzzle-piece icon → pin Artie.

---

## How to use

1. Navigate to any article, documentation page, or blog post.
2. Click the **Artie** toolbar icon.  
   A small floating panel appears in the bottom-right corner of the page and stays enabled as you move between pages.
3. Click **Save PDF**.  
   - Status updates: *Extracting content…* → *Embedding images…* → *Building printable page…* → *Saving PDF…* → *✓ Saved PDF as "…"*
4. Chrome downloads the PDF automatically.
5. The default PDF filename uses the article header (spaces/special characters are sanitised by browser rules).
6. Open the saved file in any browser – it works completely offline.
7. Click **✕** or the toolbar icon again to turn the overlay off.
8. The overlay is draggable — grab the title bar and move it anywhere.

---

## Architecture

### Background service worker (`background.js`)

- Listens for `chrome.action.onClicked`.
- Persists whether the overlay is enabled and sends that state to the active tab's content script.
- Falls back to programmatic injection via `chrome.scripting.executeScript` when the content script isn't yet present (e.g. tabs open before the extension was installed).
- Receives PDF export requests, renders the saved article in a temporary extension tab, then uses `Page.printToPDF` plus `chrome.downloads.download` to save the PDF automatically.

### Content script (`content/content.js`)

- Declared in `manifest.json`; auto-injected into every page on `document_idle`.
- Reads the persisted overlay state on load and when the tab becomes visible.
- Listens for `SET_OVERLAY_ENABLED` messages and updates the overlay accordingly.
- Creates a `<div>` host element appended to `<html>`, then attaches a **Shadow DOM** (`mode: 'open'`) to it for full CSS isolation.
- Manages the overlay lifecycle: show / hide / drag / close.
- Calls `ArticleExtractor.extract()` and `ArticleExporter.exportPdf()` when the user clicks **Save PDF**.

### Extractor (`modules/extractor.js`)

- Exported as `window.ArticleExtractor` (shared isolated-world global).
- Fast path: looks for `<article>`, `<main>`, `[role="main"]`, `[role="article"]`.
- Scoring fallback: clones `<body>`, strips clutter, scores block ancestors by text density, picks the highest-scoring node.
- Removes scripts, forms, ads, navbars, hidden elements, and other noise.
- Normalises lazy-loaded image `data-src` / `data-lazy-src` / `srcset` attributes into absolute `src` values before cloning.

### Exporter (`modules/exporter.js`)

- Exported as `window.ArticleExporter`.
- Iterates `<img>` elements in the extracted clone, fetching each via `fetch()` with CORS mode and converting to a base64 data URL via `FileReader`.
- Skips decorative images (tracking pixels, icons, tiny images, SVGs without alt text).
- Falls back gracefully: if an image can't be fetched, the original URL is kept and the failure count is reported in the status text.
- Builds a complete `<!DOCTYPE html>` document with an embedded reader stylesheet (dark-mode aware, responsive, serif typography).
- Triggers HTML downloads using a `Blob` object URL and a hidden `<a download>` click.
- Returns PDF-ready HTML payloads to the background worker for automatic PDF saving.

### Shadow DOM overlay

The overlay host (`<div id="__artie_overlay_host__">`) is appended directly to `<html>` (not `<body>`) to reduce interference. A Shadow DOM is attached so that:
- Page CSS cannot leak into the overlay.
- Overlay CSS cannot leak into the page.
- The overlay's `z-index: 2147483647` (maximum) ensures it stays on top.

---

## Permissions

| Permission    | Why                                                          |
|---------------|--------------------------------------------------------------|
| `activeTab`   | Lets the service worker send messages and inject scripts into the currently active tab without broad host permissions. |
| `scripting`   | Used by `chrome.scripting.executeScript` to programmatically inject the content scripts into tabs that were open before the extension was installed. |
| `storage`     | Persists whether the overlay is enabled and temporarily stores the PDF render payload. |
| `downloads`   | Saves the generated PDF automatically without opening the browser print dialog. |
| `debugger`    | Uses `Page.printToPDF` in a temporary extension tab to generate the PDF bytes. |

No host permissions, no `tabs`, no `cookies` — Artie requests the minimum needed.

---

## Known limitations

- **CORS-blocked images**: Many sites restrict cross-origin image fetches. Images blocked by CORS are kept as external URLs in the saved file; they will only display when the device is online. The status text reports how many images could not be embedded.
- **Paywalled / login-required content**: The extension reads the page as it appears in the browser, so it saves only what is already visible.
- **Very large pages with many images**: Embedding many high-resolution images can take tens of seconds and produce very large files (10 MB+). The status text keeps you informed.
- **Chrome extension restricted pages**: The extension cannot run on `chrome://`, `chrome-extension://`, `about:`, or Chrome Web Store pages — this is a platform restriction.
- **SPAs / dynamic content**: Content loaded asynchronously after `document_idle` may not be captured. Try scrolling the page to trigger lazy loading before saving.
- **Authenticated images**: Images served behind authentication (e.g. private S3 URLs) may not embed because `fetch` won't send cookies with `credentials: 'omit'`.

---

## Future improvements

- **Reader mode preview** inside the overlay before downloading.
- **Configurable output** (font choice, colour scheme, include/exclude images toggle).
- **Progress bar** for image embedding on image-heavy pages.
- **Clipboard support** – copy clean Markdown instead of/in addition to HTML.
- **Auto-retry** for transiently failing image fetches.
- **Page-specific extraction rules** for popular sites (Wikipedia, GitHub, MDN…).
- **Keyboard shortcut** to trigger save without clicking the toolbar icon.
- **Options page** to customise default save folder, filename template, etc.
