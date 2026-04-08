'use strict';

/**
 * ArticleExtractor – lightweight Readability-style DOM content extractor.
 *
 * Exported as `window.ArticleExtractor` so it can be consumed by the
 * content script that is loaded after this file in the manifest
 * content_scripts array.
 *
 * Usage:
 *   const { title, byline, content } = window.ArticleExtractor.extract(document);
 *   // `content` is a cloned HTMLElement ready for serialisation.
 */
window.ArticleExtractor = (() => {
  // -----------------------------------------------------------------------
  // Constants / pattern lists
  // -----------------------------------------------------------------------

  /** Class/id patterns that strongly suggest non-content (nav, ads, etc.). */
  const UNLIKELY = /banner|breadcrumb|combx|comment(?!ary)|community|cover-?wrap|disqus|extra|foot(?:er|note)|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad[_-]?break|agegate|pagina|popup|yom-remote|cookie|subscri|newsletter|promo|share.?button|masthead|^nav$|navigation|widget|toc|table.of.contents/i;

  /** Class/id patterns that lean toward main content. */
  const POSITIVE = /article|body|content|entry|hentry|h-entry|main|page|post|text|blog|story|readable|prose|chapter|section/i;

  /** Block-level elements that carry text weight. */
  const BLOCK = new Set([
    'blockquote', 'dl', 'figure', 'ol', 'p', 'table', 'ul',
    'div', 'article', 'section', 'main', 'pre',
  ]);

  /** Elements stripped entirely (with their subtrees). */
  const STRIP = new Set([
    'script', 'noscript', 'style', 'iframe', 'frame', 'frameset',
    'object', 'embed', 'applet', 'link', 'meta', 'form', 'input',
    'button', 'select', 'textarea', 'canvas', 'video', 'audio',
    'svg', 'math', 'template', 'aside',
  ]);

  /** ARIA roles that indicate non-content regions. */
  const CLUTTER_ROLE = /^(banner|navigation|complementary|contentinfo|search|form)$/;

  /** Only these attributes are preserved on cloned nodes. */
  const KEEP_ATTRS = new Set([
    'src', 'srcset', 'href', 'alt', 'title', 'width', 'height',
    'colspan', 'rowspan', 'scope', 'start', 'type',
  ]);

  // -----------------------------------------------------------------------
  // Scoring helpers
  // -----------------------------------------------------------------------

  function classWeight(el) {
    const s = `${el.className || ''} ${el.id || ''}`;
    let w = 0;
    if (UNLIKELY.test(s)) w -= 25;
    if (POSITIVE.test(s)) w += 25;
    return w;
  }

  function linkDensity(el) {
    const total = (el.textContent || '').length;
    if (!total) return 0;
    const linked = [...el.querySelectorAll('a')]
      .reduce((n, a) => n + (a.textContent || '').length, 0);
    return linked / total;
  }

  /**
   * Walk the element tree, scoring candidate ancestors for each
   * text-bearing leaf (p, td, pre).
   */
  function scoreTree(root) {
    const scores = new Map();

    root.querySelectorAll('p, td, pre').forEach((leaf) => {
      const text = (leaf.textContent || '').trim();
      if (text.length < 20) return;

      let ancestor = leaf.parentElement;
      let level = 0;
      while (ancestor && ancestor !== root && level < 4) {
        if (!scores.has(ancestor)) scores.set(ancestor, classWeight(ancestor));
        const pts = [1, 0.5, 0.25, 0.1][level] * (1 + text.length / 120);
        scores.set(ancestor, scores.get(ancestor) + pts);
        ancestor = ancestor.parentElement;
        level++;
      }
    });

    return scores;
  }

  // -----------------------------------------------------------------------
  // DOM clean-up
  // -----------------------------------------------------------------------

  function removeClutter(root) {
    // Strip entirely-unwanted tags.
    STRIP.forEach((tag) => root.querySelectorAll(tag).forEach((el) => el.remove()));

    // Strip by ARIA role.
    root.querySelectorAll('[role]').forEach((el) => {
      if (CLUTTER_ROLE.test(el.getAttribute('role') || '')) el.remove();
    });

    // Strip likely-clutter elements that contain minimal text.
    root.querySelectorAll('*').forEach((el) => {
      if (el.isConnected === false) return; // already removed
      const combined = `${el.className || ''} ${el.id || ''}`;
      if (UNLIKELY.test(combined) && (el.textContent || '').trim().length < 150) {
        el.remove();
      }
    });

    // Strip visually-hidden elements.
    root.querySelectorAll('[hidden], [aria-hidden="true"]').forEach((el) => el.remove());
  }

  /** Keep only safe attributes on every element in the subtree. */
  function stripAttributes(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const attr of [...node.attributes]) {
      if (!KEEP_ATTRS.has(attr.name)) node.removeAttribute(attr.name);
    }
    for (const child of node.children) stripAttributes(child);
  }

  /**
   * Normalise lazy-loaded image attributes and resolve relative URLs
   * so that src values are absolute before cloning.
   */

  /** Resolve `url` relative to `base`; return the original string on failure. */
  function safeResolveURL(url, base) {
    if (!url) return url;
    try { return new URL(url, base).href; } catch { return url; }
  }

  function resolveImages(root, base) {
    root.querySelectorAll('img').forEach((img) => {
      // Pick the best available source attribute (handles lazy-loading patterns).
      const lazySrc =
        img.getAttribute('data-src') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy') ||
        img.getAttribute('data-image') ||
        img.currentSrc ||
        '';

      if (lazySrc && (!img.src || img.src === base)) {
        img.src = safeResolveURL(lazySrc, base);
      }

      if (img.src) {
        img.src = safeResolveURL(img.src, base);
      }

      // Resolve srcset entries.
      const srcset = img.getAttribute('srcset') || '';
      if (srcset) {
        const resolved = srcset.split(',').map((entry) => {
          const parts = entry.trim().split(/\s+/);
          parts[0] = safeResolveURL(parts[0], base);
          return parts.join(' ');
        }).join(', ');
        img.setAttribute('srcset', resolved);
      }
    });

    root.querySelectorAll('a[href]').forEach((a) => {
      a.href = safeResolveURL(a.getAttribute('href'), base);
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Extract the main readable content from a document.
   *
   * @param {Document} doc  The document to extract from (defaults to `document`).
   * @returns {{ title: string, byline: string, content: HTMLElement }}
   */
  function extract(doc = document) {
    const base = doc.location?.href ?? doc.baseURI ?? '';
    const title = doc.title || '';

    // Resolve images / links in the live DOM *before* cloning so we capture
    // the correct absolute URLs (the clone won't have `baseURI`).
    resolveImages(doc.body || doc.documentElement, base);

    // ------------------------------------------------------------------
    // Fast path: semantic landmark elements.
    // ------------------------------------------------------------------
    const landmark =
      doc.querySelector('article') ||
      doc.querySelector('main') ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector('[role="article"]');

    let contentEl;

    if (landmark) {
      contentEl = landmark.cloneNode(true);
    } else {
      // ------------------------------------------------------------------
      // Scoring-based fallback.
      // ------------------------------------------------------------------
      const bodyClone = (doc.body || doc.documentElement).cloneNode(true);
      removeClutter(bodyClone);

      const scores = scoreTree(bodyClone);
      let best = null;
      let bestScore = -Infinity;

      scores.forEach((score, el) => {
        const adjusted = score * (1 - linkDensity(el));
        if (adjusted > bestScore) {
          bestScore = adjusted;
          best = el;
        }
      });

      contentEl = best || bodyClone;
    }

    // Final clean-up on the chosen (cloned) element.
    removeClutter(contentEl);
    stripAttributes(contentEl);

    // Extract byline if one is visible in the page.
    const bylineEl = doc.querySelector(
      '[rel="author"], .author, .byline, [itemprop="author"], .post-author, .article-author'
    );
    const byline = bylineEl ? bylineEl.textContent.trim() : '';

    return { title, byline, content: contentEl };
  }

  return { extract };
})();
