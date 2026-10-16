const audio = document.querySelector('#radio');
let state = 'paused';
let mediaError = '';
function snapshot() { return { state, error: mediaError, src: audio.src, paused: audio.paused, volume: audio.volume }; }
function report() { chrome.runtime.sendMessage({ target: 'background', type: 'radio-state', playback: snapshot() }).catch(() => {}); }
for (const [event, next] of Object.entries({ playing: 'playing', pause: 'paused', waiting: 'buffering', ended: 'error', error: 'error' })) {
  audio.addEventListener(event, () => { state = next; mediaError = next === 'error' ? 'A transmissão caiu. Tentaremos reconectar.' : ''; report(); });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'offscreen' || message.type !== 'radio-apply') return false;
  (async () => {
    if (!TabbletCore.safeStream(message.source)) throw new Error('Endereço de transmissão inválido.');
    if (!Number.isFinite(message.volume) || message.volume < 0 || message.volume > 1) throw new Error('Volume inválido.');
    // The slider is a listening-level preference, not a linear amplitude control.
    // A quadratic curve gives the low end enough attenuation (1% -> 0.0001).
    audio.volume = message.volume ** 2;
    audio.muted = message.muted === true;
    if (message.paused) {
      audio.pause();
      state = 'paused';
      return;
    }
    const changed = audio.src !== message.source || message.restart || state === 'error';
    if (changed) {
      audio.src = message.source;
      audio.load();
    }
    if (changed || audio.paused) {
      state = 'buffering';
      mediaError = '';
      let timer;
      try {
        await Promise.race([audio.play(), new Promise((_, reject) => { timer = setTimeout(() => { audio.pause(); reject(new Error('A conexão de áudio demorou demais.')); }, 12_000); })]);
        state = 'playing';
      } finally { clearTimeout(timer); }
    }
  })().then(() => respond({ ok: true, playback: snapshot() })).catch(e => {
    state = 'error'; mediaError = e.message;
    respond({ ok: false, error: e.message }); report();
  });
  return true;
});
