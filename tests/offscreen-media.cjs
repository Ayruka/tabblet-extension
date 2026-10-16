// Playwright page routes do not intercept Chrome offscreen-document requests.
// Use a separate, flattened CDP connection to intercept that target directly.
async function installOffscreenMedia(endpoint, wave) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map();
  let commandId = 0;
  let requests = 0;
  function send(method, params = {}, sessionId) {
    const id = ++commandId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) {
      const item = pending.get(value.id);
      if (item) { pending.delete(value.id); value.error ? item.reject(new Error(value.error.message)) : item.resolve(value.result); }
    } else if (value.method === 'Fetch.requestPaused') {
      requests++;
      void send('Fetch.fulfillRequest', { requestId: value.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'audio/wav' }, { name: 'Content-Length', value: String(wave.length) }], body: wave.toString('base64') }, value.sessionId);
    } else if (value.method === 'Target.attachedToTarget') {
      void (async () => {
        await send('Fetch.enable', { patterns: [{ urlPattern: 'https://audio.tabblet.net/*', requestStage: 'Request' }] }, value.params.sessionId);
        await send('Runtime.runIfWaitingForDebugger', {}, value.params.sessionId);
      })();
    }
  });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'other', exclude: false }, { exclude: true }] });
  return { get requests() { return requests; } };
}
module.exports = { installOffscreenMedia };
