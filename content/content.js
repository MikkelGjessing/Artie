'use strict';

/**
 * Artie – Content Script
 *
 * Injects and manages a floating Shadow DOM overlay on the current page.
 * Listens for TOGGLE_OVERLAY messages from the background service worker.
 *
 * Dependencies (loaded before this file via manifest content_scripts array):
 *   window.ArticleExtractor  – modules/extractor.js
 *   window.ArticleExporter   – modules/exporter.js
 */
(() => {
  const HOST_ID = '__artie_overlay_host__';

  // -----------------------------------------------------------------------
  // Overlay CSS (injected into the Shadow DOM – fully isolated)
  // -----------------------------------------------------------------------
  const OVERLAY_CSS = `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    #artie-overlay {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      width: 230px;
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 14px;
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.16),
        0 2px 8px rgba(0, 0, 0, 0.08);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 13px;
      color: #1a1a1a;
      user-select: none;
      transition: opacity 0.18s ease, transform 0.18s ease;
      overflow: hidden;
    }

    #artie-overlay.artie-hidden {
      opacity: 0;
      transform: scale(0.94) translateY(6px);
      pointer-events: none;
    }

    /* ── Title bar ──────────────────────────────────────────────────────── */
    #artie-titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 10px 9px 13px;
      background: #f2f2f2;
      border-bottom: 1px solid rgba(0, 0, 0, 0.07);
      cursor: grab;
    }
    #artie-titlebar:active { cursor: grabbing; }
    #artie-title {
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.01em;
      pointer-events: none;
    }

    /* ── Close button ───────────────────────────────────────────────────── */
    #artie-close {
      appearance: none;
      background: none;
      border: none;
      cursor: pointer;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: #666;
      font-size: 15px;
      line-height: 1;
      padding: 0;
      flex-shrink: 0;
      transition: background 0.12s ease;
    }
    #artie-close:hover { background: rgba(0, 0, 0, 0.1); color: #111; }
    #artie-close:focus-visible { outline: 2px solid #0066ff; outline-offset: 1px; }

    /* ── Body ───────────────────────────────────────────────────────────── */
    #artie-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* ── Save button ────────────────────────────────────────────────────── */
    #artie-save {
      appearance: none;
      width: 100%;
      padding: 9px 14px;
      background: #0066ff;
      color: #ffffff;
      border: none;
      border-radius: 9px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.14s ease, transform 0.1s ease;
      letter-spacing: 0.01em;
    }
    #artie-save:hover:not(:disabled) { background: #0052cc; }
    #artie-save:active:not(:disabled) { background: #0041a3; transform: scale(0.98); }
    #artie-save:disabled { background: #b0b0b0; cursor: not-allowed; }
    #artie-save:focus-visible { outline: 2px solid #0066ff; outline-offset: 2px; }

    /* ── Status text ────────────────────────────────────────────────────── */
    #artie-status {
      font-size: 11.5px;
      color: #666;
      min-height: 16px;
      line-height: 1.45;
      word-break: break-word;
      transition: color 0.15s ease;
    }
    #artie-status.artie-error   { color: #cc2200; }
    #artie-status.artie-success { color: #007a33; }
  `;

  // -----------------------------------------------------------------------
  // Create & attach the overlay
  // -----------------------------------------------------------------------

  function createOverlay() {
    const host = document.createElement('div');
    host.id = HOST_ID;

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${OVERLAY_CSS}</style>
      <div id="artie-overlay" role="dialog" aria-label="Artie Save Page" aria-modal="false">
        <div id="artie-titlebar">
          <span id="artie-title">📄 Artie</span>
          <button id="artie-close" title="Close Artie" aria-label="Close">✕</button>
        </div>
        <div id="artie-body">
          <button id="artie-save">Export PDF</button>
          <div id="artie-status" aria-live="polite"></div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(host);

    wireEvents(shadow);
    makeDraggable(
      shadow.getElementById('artie-overlay'),
      shadow.getElementById('artie-titlebar')
    );

    return host;
  }

  // -----------------------------------------------------------------------
  // Wire button events
  // -----------------------------------------------------------------------

  function wireEvents(shadow) {
    const overlay  = shadow.getElementById('artie-overlay');
    const closeBtn = shadow.getElementById('artie-close');
    const saveBtn  = shadow.getElementById('artie-save');
    const statusEl = shadow.getElementById('artie-status');

    // Close button --------------------------------------------------------
    closeBtn.addEventListener('click', () => dismissOverlay(overlay));

    // Export PDF button ---------------------------------------------------
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      setStatus(statusEl, 'Extracting content…', '');

      try {
        if (!window.ArticleExtractor || !window.ArticleExporter) {
          throw new Error('Helper modules not loaded – please reload the page.');
        }

        const extracted = window.ArticleExtractor.extract(document);

        const { filename: suggestedFilename, imageStats } = await window.ArticleExporter.exportPdf(
          extracted,
          (stage) => {
            if (stage === 'images') {
              setStatus(statusEl, 'Embedding images…', '');
            } else if (stage === 'building') {
              setStatus(statusEl, 'Building printable page…', '');
            } else if (stage === 'printing') {
              setStatus(statusEl, 'Opening print dialog…', '');
            }
          }
        );

        const { embedded, failed } = imageStats;
        const imgNote = embedded > 0
          ? ` · ${embedded} image${embedded !== 1 ? 's' : ''} embedded`
          : '';
        const failNote = failed > 0
          ? ` (${failed} image${failed !== 1 ? 's' : ''} not embedded)`
          : '';

        setStatus(statusEl, `✓ PDF ready as "${suggestedFilename}"${imgNote}${failNote}`, 'artie-success');
      } catch (err) {
        console.error('[Artie] Save error:', err);
        setStatus(statusEl, `Error: ${err.message || 'Unknown error'}`, 'artie-error');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  function setStatus(el, text, cls) {
    el.textContent = text;
    el.className = cls || '';
  }

  // -----------------------------------------------------------------------
  // Dismiss (animated hide → remove)
  // -----------------------------------------------------------------------

  function dismissOverlay(overlayEl) {
    overlayEl.classList.add('artie-hidden');
    setTimeout(() => {
      const host = document.getElementById(HOST_ID);
      if (host) host.remove();
    }, 200);
  }

  // -----------------------------------------------------------------------
  // Draggable title bar
  // -----------------------------------------------------------------------

  function makeDraggable(overlay, handle) {
    let dragging = false;
    let startX, startY, origLeft, origTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // left button only
      e.preventDefault();
      dragging = true;

      const rect = overlay.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop  = rect.top;

      // Switch from right/bottom anchored to explicit left/top positioning.
      overlay.style.right  = 'auto';
      overlay.style.bottom = 'auto';
      overlay.style.left   = `${origLeft}px`;
      overlay.style.top    = `${origTop}px`;

      const onMove = (ev) => {
        if (!dragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w  = overlay.offsetWidth;
        const h  = overlay.offsetHeight;
        overlay.style.left = `${Math.max(0, Math.min(vw - w, origLeft + dx))}px`;
        overlay.style.top  = `${Math.max(0, Math.min(vh - h, origTop  + dy))}px`;
      };

      const onUp = () => {
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // -----------------------------------------------------------------------
  // Toggle logic – idempotent
  // -----------------------------------------------------------------------

  function toggleOverlay() {
    const existingHost = document.getElementById(HOST_ID);

    if (existingHost) {
      const shadow = existingHost.shadowRoot;
      if (shadow) {
        const overlay = shadow.getElementById('artie-overlay');
        if (overlay) {
          if (overlay.classList.contains('artie-hidden')) {
            // Re-show a previously dismissed overlay.
            overlay.classList.remove('artie-hidden');
          } else {
            // Currently visible – dismiss it.
            dismissOverlay(overlay);
          }
          return;
        }
      }
      existingHost.remove();
    }

    createOverlay();
  }

  // -----------------------------------------------------------------------
  // Message listener (from background service worker)
  // -----------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'TOGGLE_OVERLAY') {
      toggleOverlay();
      sendResponse({ ok: true });
    }
  });
})();
