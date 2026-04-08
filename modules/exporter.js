'use strict';

/**
 * ArticleExporter – builds a print-friendly HTML page from extracted article
 * data and opens it in a new tab, then triggers window.print() so the user
 * can save it as a PDF via Chrome's built-in print dialog.
 *
 * Exported as `window.ArticleExporter` so it can be consumed by the
 * content script that is loaded after this file.
 *
 * Usage:
 *   await window.ArticleExporter.exportPage(extracted, onProgress);
 */
window.ArticleExporter = (() => {
  // -----------------------------------------------------------------------
  // Decorative-image filter (kept from original to remove noise images)
  // -----------------------------------------------------------------------

  /**
   * Decide whether an image is decorative / UI chrome rather than content.
   * Returns true  → drop the image.
   * Returns false → keep it.
   */
  function isDecorative(img) {
    const src = img.getAttribute('src') || img.src || '';

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

  /** Remove decorative images from the content subtree. */
  function stripDecorativeImages(root) {
    for (const img of [...root.querySelectorAll('img')]) {
      if (isDecorative(img)) img.remove();
    }
  }

  // -----------------------------------------------------------------------
  // Print CSS – optimised for PDF output via Chrome's print dialog
  // -----------------------------------------------------------------------

  const PRINT_CSS = `
    :root {
      --fg: #1a1a1a;
      --link: #0055cc;
      --border: #d0d0d0;
      --code-bg: #f3f3f3;
      --caption: #555;
      --max-w: 720px;
      --serif: Georgia, 'Times New Roman', Times, serif;
      --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 17px; }
    body {
      color: var(--fg);
      font-family: var(--serif);
      line-height: 1.72;
      padding: 2rem 1.5rem 4rem;
      max-width: var(--max-w);
      margin: 0 auto;
    }
    header {
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid var(--border);
    }
    header h1 { font-size: 1.8rem; line-height: 1.2; margin-bottom: 0.5rem; }
    .artie-meta {
      font-family: var(--sans);
      font-size: 0.78rem;
      color: var(--caption);
      margin-top: 0.25rem;
    }
    .artie-meta a { color: inherit; }
    h1, h2, h3, h4, h5, h6 { font-family: var(--serif); line-height: 1.25; }
    h1 { font-size: 1.8rem; margin: 1.8rem 0 0.7rem; }
    h2 { font-size: 1.4rem; margin: 1.6rem 0 0.55rem; }
    h3 { font-size: 1.15rem; margin: 1.4rem 0 0.45rem; }
    h4, h5, h6 { font-size: 1rem; margin: 1.1rem 0 0.35rem; }
    p { margin: 0 0 1rem; }
    a { color: var(--link); word-break: break-word; }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1.4rem auto;
    }
    figure { margin: 1.75rem 0; }
    figcaption {
      font-family: var(--sans);
      font-size: 0.78rem;
      color: var(--caption);
      text-align: center;
      margin-top: 0.35rem;
    }
    blockquote {
      border-left: 4px solid var(--border);
      padding: 0.2rem 0 0.2rem 1.1rem;
      margin: 1.4rem 0;
      font-style: italic;
      color: var(--caption);
    }
    pre {
      background: var(--code-bg);
      padding: 0.9rem 1.1rem;
      border-radius: 4px;
      font-size: 0.8rem;
      margin: 1.1rem 0;
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }
    code {
      background: var(--code-bg);
      padding: 0.1em 0.3em;
      border-radius: 3px;
      font-size: 0.83em;
    }
    pre code { background: none; padding: 0; }
    ul, ol { margin: 0 0 1rem 1.6rem; }
    li { margin-bottom: 0.25rem; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1.4rem 0;
      font-size: 0.85rem;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.45rem 0.7rem;
      text-align: left;
      vertical-align: top;
    }
    th { background: var(--code-bg); font-weight: 600; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
    .artie-footer {
      font-family: var(--sans);
      font-size: 0.72rem;
      color: var(--caption);
      text-align: center;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      margin-top: 3rem;
    }

    /* ── Print / PDF rules ─────────────────────────────────────────────── */
    @media print {
      @page { margin: 1.5cm 1.8cm; }
      body { max-width: 100%; padding: 0; font-size: 11pt; }
      a { color: inherit; text-decoration: underline; }
      h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
      p, li { orphans: 3; widows: 3; }
      img { page-break-inside: avoid; max-width: 100%; }
      figure { page-break-inside: avoid; }
      table { page-break-inside: avoid; }
      pre { page-break-inside: avoid; white-space: pre-wrap; }
      blockquote { page-break-inside: avoid; }
      .artie-footer { page-break-before: avoid; }
      header { page-break-after: avoid; }
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
   * Build a complete standalone print-friendly HTML string.
   */
  function buildPrintHTML({ title, byline, content, savedAt, sourceURL }) {
    const safeTitle = escapeHTML(title || 'Saved Page');
    const bylineHtml = byline
      ? `\n  <p class="artie-meta">By ${escapeHTML(byline)}</p>`
      : '';
    const metaDate = savedAt
      ? `\n  <p class="artie-meta">Saved on ${escapeHTML(savedAt)}</p>`
      : '';
    const metaURL = sourceURL
      ? `\n  <p class="artie-meta">Source: <a href="${encodeURI(sourceURL)}">${escapeHTML(sourceURL)}</a></p>`
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
  <meta name="generator" content="Artie Save as PDF v1.1">
  <title>${safeTitle}</title>
  <style>
${PRINT_CSS}
  </style>
</head>
<body>
  <header>
    <h1>${safeTitle}</h1>${bylineHtml}${metaDate}${metaURL}
  </header>
  <main>
    ${bodyHTML}
  </main>
  <footer class="artie-footer">Prepared by Artie &middot; ${escapeHTML(savedAt || '')}</footer>
  <script>
    window.addEventListener('load', function () {
      // Brief delay lets the browser finish laying out the page before the
      // print dialog opens, preventing blank or partially-rendered output.
      setTimeout(function () { window.print(); }, 350);
    });
  </script>
</body>
</html>`;
  }

  // -----------------------------------------------------------------------
  // Open the print view in a new tab
  // -----------------------------------------------------------------------

  /**
   * Serialise `html` to a blob URL and open it in a new tab.
   * The page auto-triggers window.print() on load.
   */
  function openPrintTab(html) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, '_blank');
    // Revoke the blob URL once the new tab has had time to load the document.
    // We listen for the tab's beforeunload as the ideal cleanup point, but
    // fall back to a 30-second timeout for cases where cross-origin security
    // prevents attaching a listener to the new window.
    const revoke = () => URL.revokeObjectURL(url);
    if (tab) {
      tab.addEventListener('beforeunload', revoke, { once: true });
    }
    setTimeout(revoke, 30_000);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Full pipeline: strip decorative images → build print HTML → open print tab.
   *
   * @param {{ title: string, byline: string, content: HTMLElement }} extracted
   * @param {Function|undefined} onProgress  (stage: string) => void
   * @returns {Promise<void>}
   */
  async function exportPage(extracted, onProgress) {
    const { title, byline, content } = extracted;
    const sourceURL = window.location.href;
    const savedAt = new Date().toLocaleString();

    onProgress && onProgress('building');
    stripDecorativeImages(content);
    const html = buildPrintHTML({ title, byline, content, savedAt, sourceURL });

    onProgress && onProgress('opening');
    openPrintTab(html);
  }

  return { exportPage };
})();
