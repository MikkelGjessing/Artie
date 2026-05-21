'use strict';

/**
 * ArticleExporter – builds a self-contained offline HTML file from
 * extracted article data and can either download HTML or prepare clean HTML
 * for automatic PDF generation.
 *
 * Exported as `window.ArticleExporter` so it can be consumed by the
 * content script that is loaded after this file.
 *
 * Usage:
 *   const { filename, imageStats } = await window.ArticleExporter.exportPage(extracted, onProgress);
 */
window.ArticleExporter = (() => {
  // -----------------------------------------------------------------------
  // Image embedding
  // -----------------------------------------------------------------------

  /** Convert a Blob to a base64 data URL via FileReader. */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(/** @type {string} */ (reader.result));
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Fetch a URL and return a base64 data URI.
   * Returns null on any failure so the caller can degrade gracefully.
   */
  async function fetchAsDataURL(url) {
    try {
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      if (!blob.size) return null;
      return await blobToDataURL(blob);
    } catch {
      return null;
    }
  }

  /**
   * Decide whether an image is decorative / UI chrome rather than content.
   * Returns true  → drop the image.
   * Returns false → keep and try to embed.
   */
  function isDecorative(img) {
    const src = img.getAttribute('src') || img.src || '';

    // Data URLs are already embedded – never decorative by this heuristic.
    if (src.startsWith('data:')) return false;

    // Tiny images (tracking pixels, spacers, 1×1 GIFs …).
    const w = parseInt(img.getAttribute('width') || '0', 10);
    const h = parseInt(img.getAttribute('height') || '0', 10);
    if ((w > 0 && w <= 4) || (h > 0 && h <= 4)) return true;

    // Common decorative / tracking URL patterns.
    if (/\/(icon[s]?|logo|avatar|button|pixel|badge|banner|sprite|rating|star[s]?|arrow|spacer|blank|tracking|tracker|analytics|metric|1x1|impression|beacon)\b/i.test(src)) {
      return true;
    }

    // Inline SVG or SVG icons without meaningful alt text.
    if (src.endsWith('.svg') && !(img.getAttribute('alt') || '').trim()) return true;

    return false;
  }

  /**
   * Walk all <img> elements in `root`, embed them as base64 data URLs, and
   * report progress via the `onProgress` callback.
   *
   * @param {HTMLElement} root
   * @param {Function|undefined} onProgress  (stage: string, detail: string) => void
   * @returns {Promise<{ embedded: number, skipped: number, failed: number }>}
   */
  async function embedImages(root, onProgress) {
    const imgs = [...root.querySelectorAll('img')];
    let embedded = 0, skipped = 0, failed = 0;

    for (const img of imgs) {
      if (isDecorative(img)) {
        img.remove();
        skipped++;
        continue;
      }

      // Use src (already resolved to absolute by extractor).
      const src = img.getAttribute('src') || img.src || '';

      if (!src) {
        img.remove();
        skipped++;
        continue;
      }

      if (src.startsWith('data:')) {
        // Already a data URL – nothing to do.
        embedded++;
        continue;
      }

      onProgress && onProgress('embedding', src);

      const dataURL = await fetchAsDataURL(src);
      if (dataURL) {
        img.src = dataURL;
        img.removeAttribute('srcset');
        img.removeAttribute('data-src');
        img.removeAttribute('data-lazy-src');
        embedded++;
      } else {
        // Keep the original URL (best effort for offline viewing).
        console.warn('[Artie] Could not embed image (CORS or network error):', src);
        img.removeAttribute('srcset'); // avoid broken srcset entries
        failed++;
      }
    }

    return { embedded, skipped, failed };
  }

  // -----------------------------------------------------------------------
  // Reader CSS – embedded in the exported HTML <style> block
  // -----------------------------------------------------------------------

  const READER_CSS = `
    :root {
      --bg: #fafaf8;
      --fg: #1a1a1a;
      --link: #0055cc;
      --link-visited: #7952b3;
      --border: #e0e0e0;
      --code-bg: #f3f3f3;
      --caption: #666;
      --max-w: 740px;
      --serif: Georgia, 'Times New Roman', Times, serif;
      --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1c1c1e;
        --fg: #e5e5ea;
        --link: #4da3ff;
        --link-visited: #bf9ffc;
        --border: #3a3a3c;
        --code-bg: #2c2c2e;
        --caption: #aaa;
      }
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 18px; scroll-behavior: smooth; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--serif);
      line-height: 1.75;
      padding: 2.5rem 1.25rem 5rem;
      max-width: var(--max-w);
      margin: 0 auto;
    }
    header {
      margin-bottom: 2.5rem;
      padding-bottom: 1.25rem;
      border-bottom: 2px solid var(--border);
    }
    header h1 { font-size: 1.9rem; line-height: 1.2; margin-bottom: 0.5rem; }
    .meta {
      font-family: var(--sans);
      font-size: 0.8rem;
      color: var(--caption);
      margin-top: 0.3rem;
    }
    .meta a { color: inherit; }
    h1, h2, h3, h4, h5, h6 { font-family: var(--serif); line-height: 1.25; }
    h1 { font-size: 1.9rem; margin: 2rem 0 0.8rem; }
    h2 { font-size: 1.45rem; margin: 1.8rem 0 0.6rem; }
    h3 { font-size: 1.2rem; margin: 1.5rem 0 0.5rem; }
    h4, h5, h6 { font-size: 1rem; margin: 1.2rem 0 0.4rem; }
    p { margin: 0 0 1.1rem; }
    a { color: var(--link); }
    a:visited { color: var(--link-visited); }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1.5rem auto;
      border-radius: 6px;
    }
    figure { margin: 2rem 0; }
    figcaption {
      font-family: var(--sans);
      font-size: 0.8rem;
      color: var(--caption);
      text-align: center;
      margin-top: 0.4rem;
    }
    blockquote {
      border-left: 4px solid var(--border);
      padding: 0.25rem 0 0.25rem 1.25rem;
      margin: 1.5rem 0;
      font-style: italic;
      color: var(--caption);
    }
    pre {
      background: var(--code-bg);
      padding: 1rem 1.25rem;
      overflow-x: auto;
      border-radius: 6px;
      font-size: 0.82rem;
      margin: 1.25rem 0;
      white-space: pre-wrap;
    }
    code {
      background: var(--code-bg);
      padding: 0.1em 0.35em;
      border-radius: 3px;
      font-size: 0.85em;
    }
    pre code { background: none; padding: 0; }
    ul, ol { margin: 0 0 1.1rem 1.75rem; }
    li { margin-bottom: 0.3rem; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1.5rem 0;
      font-size: 0.88rem;
      display: block;
      overflow-x: auto;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.5rem 0.75rem;
      text-align: left;
      vertical-align: top;
    }
    th { background: var(--code-bg); font-weight: 600; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2.5rem 0; }
    .artie-footer {
      font-family: var(--sans);
      font-size: 0.75rem;
      color: var(--caption);
      text-align: center;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
      margin-top: 4rem;
    }
  `.trim();

  // -----------------------------------------------------------------------
  // HTML template builder
  // -----------------------------------------------------------------------

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Build a complete standalone HTML string from the extracted data.
   */
  function buildHTML({ title, byline, content, savedAt, sourceURL }) {
    const safeTitle = escapeHTML(title || 'Saved Page');
    const bylineHtml = byline
      ? `\n  <p class="meta">By ${escapeHTML(byline)}</p>`
      : '';
    const metaDate = savedAt
      ? `\n  <p class="meta">Saved on ${escapeHTML(savedAt)}</p>`
      : '';
    const metaURL = sourceURL
      ? `\n  <p class="meta">Source: <a href="${encodeURI(sourceURL)}">${escapeHTML(sourceURL)}</a></p>`
      : '';

    // Serialise the content node.
    let bodyHTML = '';
    if (content) {
      bodyHTML = content.tagName === 'BODY'
        ? content.innerHTML
        : content.outerHTML;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="Artie Save Page v1.0">
  <title>${safeTitle}</title>
  <style>
${READER_CSS}
  </style>
</head>
<body>
  <header>
    <h1>${safeTitle}</h1>${bylineHtml}${metaDate}${metaURL}
  </header>
  <main>
    ${bodyHTML}
  </main>
  <footer class="artie-footer">Saved with Artie &middot; ${escapeHTML(savedAt || '')}</footer>
</body>
</html>`;
  }

  // -----------------------------------------------------------------------
  // Filename helpers
  // -----------------------------------------------------------------------

  function sanitiseFilename(str) {
    return String(str)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'saved-page';
  }

  function buildFilename(title) {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${sanitiseFilename(title || 'saved-page')}_${date}.html`;
  }

  function buildPdfFilename(title) {
    // Used for UI feedback; the browser may further sanitise the final filename.
    return `${sanitiseFilename(title || 'saved-page')}.pdf`;
  }

  function deriveArticleTitle(title, content) {
    const heading = content?.querySelector('h1, h2')?.textContent?.trim();
    return heading || title || 'saved-page';
  }

  // -----------------------------------------------------------------------
  // Download trigger
  // -----------------------------------------------------------------------

  /** Trigger a browser download of `html` with the given `filename`. */
  function triggerDownload(html, filename) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    // Clean up asynchronously to give the browser time to start the download.
    requestAnimationFrame(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Full pipeline: embed images → build HTML → trigger download.
   *
   * @param {{ title: string, byline: string, content: HTMLElement }} extracted
   * @param {Function|undefined} onProgress  (stage: string, detail: string) => void
   * @returns {Promise<{ filename: string, imageStats: object }>}
   */
  async function exportPage(extracted, onProgress) {
    const { title, byline, content } = extracted;
    const sourceURL = window.location.href;
    const savedAt = new Date().toLocaleString();

    onProgress && onProgress('images', 'Starting image embedding…');
    const imageStats = await embedImages(content, onProgress);

    onProgress && onProgress('building', 'Building HTML…');
    const html = buildHTML({ title, byline, content, savedAt, sourceURL });

    const filename = buildFilename(title);
    onProgress && onProgress('downloading', filename);
    triggerDownload(html, filename);

    return { filename, imageStats };
  }

  /**
   * Full pipeline for PDF: embed images → build HTML → return PDF payload.
   *
   * @param {{ title: string, byline: string, content: HTMLElement }} extracted
   * @param {Function|undefined} onProgress  (stage: string, detail: string) => void
   * @returns {Promise<{ filename: string, imageStats: object }>}
   */
  async function exportPdf(extracted, onProgress) {
    const { title, byline, content } = extracted;
    const sourceURL = window.location.href;
    const savedAt = new Date().toLocaleString();
    const articleHeader = deriveArticleTitle(title, content);

    onProgress && onProgress('images', 'Starting image embedding…');
    const imageStats = await embedImages(content, onProgress);

    onProgress && onProgress('building', 'Building printable page…');
    const html = buildHTML({ title: articleHeader, byline, content, savedAt, sourceURL });

    const filename = buildPdfFilename(articleHeader);
    onProgress && onProgress('saving', filename);

    return { filename, html, imageStats };
  }

  return { exportPage, exportPdf, buildFilename, buildPdfFilename };
})();
