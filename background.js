'use strict';

/**
 * Artie – Background Service Worker
 *
 * Listens for the browser-action click and tells the active tab to
 * toggle the floating overlay.  If the content script has not yet been
 * injected (e.g. the tab was already open when the extension was
 * installed/enabled), the scripts are injected programmatically first.
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Try sending the toggle message to an already-running content script.
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
  } catch {
    // Content script not yet present in this tab – inject it, then toggle.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [
          'modules/extractor.js',
          'modules/exporter.js',
          'content/content.js',
        ],
      });
      // Small delay to let the scripts initialise before toggling.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
    } catch (err) {
      console.error('[Artie] Failed to inject content scripts:', err);
    }
  }
});
