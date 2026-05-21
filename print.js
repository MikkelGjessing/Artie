'use strict';

(async () => {
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

  const readyScript = `<script src="${chrome.runtime.getURL('print-ready.js')}"><\/script>`;
  const html = job.html.includes('</body>')
    ? job.html.replace('</body>', `${readyScript}</body>`)
    : `${job.html}${readyScript}`;

  document.open();
  document.write(html);
  document.close();
})();
