'use strict';

(async () => {
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get('jobId');

  if (!jobId) return;

  async function waitForImages() {
    const pending = [...document.images]
      .filter((img) => !img.complete)
      .map((img) => new Promise((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 5000);
      }));

    await Promise.allSettled(pending);
  }

  if (document.readyState !== 'complete') {
    await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  }

  await waitForImages();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  chrome.runtime.sendMessage({
    type: 'PRINT_PAGE_READY',
    jobId,
  });
})();
