'use strict';

(async () => {
  const STRIP_SELECTOR = 'script, iframe, frame, frameset, object, embed';
  const READY_SCRIPT_PATH = 'print-ready.js';
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get('jobId');

  if (!jobId) {
    document.body.textContent = 'Missing PDF job ID.';
    return;
  }

  const storageKey = `artiePrintJob:${jobId}`;
  const stored = await chrome.storage.session.get(storageKey);
  const job = stored[storageKey];

  if (!job?.html) {
    document.body.textContent = 'Could not load PDF job.';
    return;
  }

  const parsed = new DOMParser().parseFromString(job.html, 'text/html');
  parsed.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());
  parsed.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  if (!parsed.body) {
    document.body.textContent = 'Could not prepare PDF job.';
    return;
  }

  // Safe extension-owned script used only to signal the background worker
  // once the rendered page is fully ready for PDF capture.
  const readyScriptUrl = chrome.runtime.getURL(READY_SCRIPT_PATH);
  const readyScript = parsed.createElement('script');
  readyScript.src = readyScriptUrl;
  parsed.body.appendChild(readyScript);

  const html = `<!DOCTYPE html>\n${parsed.documentElement.outerHTML}`;

  document.open();
  document.write(html);
  document.close();
})();
