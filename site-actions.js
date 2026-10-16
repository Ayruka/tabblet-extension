// Keep requests on tabblet.net, using the site's own form and validation.
(() => {
  let timer;
  function openRequest() {
    clearTimeout(timer);
    if (location.hash !== '#request-dialog') return;
    const deadline = Date.now() + 10_000;
    const attempt = () => {
      if (location.hash !== '#request-dialog') return;
      const dialog = document.getElementById('request-dialog');
      if (dialog?.open) return;
      document.querySelector('[data-open="request-dialog"], [data-go-request]')?.click();
      if (!dialog?.open && Date.now() < deadline) timer = setTimeout(attempt, 250);
    };
    attempt();
  }
  window.addEventListener('hashchange', openRequest);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  openRequest();
})();
