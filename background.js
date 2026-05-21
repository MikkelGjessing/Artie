'use strict';

/**
 * Artie – Background Service Worker
 *
 * Manages the global overlay state and handles automatic PDF generation
 * via a temporary extension tab rendered through the Chrome DevTools
 * Protocol's Page.printToPDF command.
 */
const OVERLAY_ENABLED_KEY = 'artieOverlayEnabled';
const PRINT_JOB_PREFIX = 'artiePrintJob:';
const PRINT_READY_PREFIX = 'artiePrintReady:';
const CONTENT_SCRIPT_FILES = [
  'modules/extractor.js',
  'modules/exporter.js',
  'content/content.js',
];
const PRINT_TIMEOUT_MS = 15000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOverlayEnabled() {
  const stored = await chrome.storage.local.get(OVERLAY_ENABLED_KEY);
  return Boolean(stored[OVERLAY_ENABLED_KEY]);
}

async function setOverlayEnabled(enabled) {
  await chrome.storage.local.set({ [OVERLAY_ENABLED_KEY]: enabled });
}

async function sendOverlayState(tabId, enabled) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SET_OVERLAY_ENABLED', enabled });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: CONTENT_SCRIPT_FILES,
      });
      await delay(100);
      await chrome.tabs.sendMessage(tabId, { type: 'SET_OVERLAY_ENABLED', enabled });
    } catch (err) {
      console.error('[Artie] Failed to inject content scripts:', err);
    }
  }
}

function waitForPrintReady(jobId) {
  const key = `${PRINT_READY_PREFIX}${jobId}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      await chrome.storage.session.remove(key).catch(() => {});
      reject(new Error('Timed out while preparing the PDF renderer.'));
    }, PRINT_TIMEOUT_MS);

    const poll = async () => {
      try {
        const stored = await chrome.storage.session.get(key);
        if (stored[key]) {
          clearTimeout(timer);
          await chrome.storage.session.remove(key).catch(() => {});
          resolve();
          return;
        }
      } catch {
        clearTimeout(timer);
        reject(new Error('Failed to read PDF renderer status.'));
        return;
      }

      setTimeout(poll, 100);
    };

    poll();
  });
}

async function renderTabToPdf(tabId) {
  const debuggee = { tabId };
  await chrome.debugger.attach(debuggee, '1.3');

  try {
    await chrome.debugger.sendCommand(debuggee, 'Page.enable');
    const result = await chrome.debugger.sendCommand(debuggee, 'Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
    });

    if (!result?.data) {
      throw new Error('Chrome did not return PDF data.');
    }

    return result.data;
  } finally {
    await chrome.debugger.detach(debuggee).catch(() => {});
  }
}

async function handleExportPdf({ html, filename }) {
  if (!html || !filename) {
    throw new Error('Missing PDF export payload.');
  }

  const jobId = crypto.randomUUID();
  const jobKey = `${PRINT_JOB_PREFIX}${jobId}`;
  let tabId = null;

  await chrome.storage.session.set({
    [jobKey]: { html },
  });

  try {
    const readyPromise = waitForPrintReady(jobId);
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`print.html?jobId=${encodeURIComponent(jobId)}`),
      active: false,
    });

    tabId = tab.id ?? null;
    if (!tabId) {
      throw new Error('Failed to open the PDF renderer tab.');
    }

    await readyPromise;
    const data = await renderTabToPdf(tabId);

    await chrome.downloads.download({
      url: `data:application/pdf;base64,${data}`,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });

    return { filename };
  } finally {
    await chrome.storage.session.remove(jobKey).catch(() => {});
    if (tabId) {
      await chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const enabled = !(await getOverlayEnabled());
  await setOverlayEnabled(enabled);
  await sendOverlayState(tab.id, enabled);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SET_OVERLAY_ENABLED') {
    setOverlayEnabled(Boolean(message.enabled))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message || 'Failed to update overlay state.' }));
    return true;
  }

  if (message?.type === 'PRINT_PAGE_READY') {
    const key = `${PRINT_READY_PREFIX}${message.jobId}`;
    chrome.storage.session.set({ [key]: true })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message || 'Failed to mark PDF renderer ready.' }));
    return true;
  }

  if (message?.type === 'EXPORT_PDF') {
    handleExportPdf(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || 'PDF export failed.' }));
    return true;
  }
});
