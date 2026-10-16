(() => {
  if (document.querySelector('[data-tabblet-player]')) return;
  const Core = TabbletCore;
  let disposed = false;
  let latest;
  let avatarFigure;
  let avatarGeneration = 0;
  let syncPending;
  const originalMedia = new Map();
  const widget = TabbletPlayer.create({
    assetUrl: (theme, kind) => chrome.runtime.getURL(`assets/themes/${theme}/${kind}.webp`),
    styleUrl: chrome.runtime.getURL('player.css'),
    onCommand: async (action, value) => {
      const response = await chrome.runtime.sendMessage({ target: 'background', type: 'radio-command', action, value });
      if (!response?.ok) throw new Error(response?.error || 'A extensão não respondeu. Recarregue a página.');
      accept(response.value);
    },
    onFollow: async username => {
      const input = document.querySelector('input.chat-input[name="chat"]');
      if (!input || input.disabled || input.readOnly) throw new Error('Entre em um quarto para seguir o locutor.');
      if (input.value.trim()) throw new Error('Envie ou apague sua mensagem antes de seguir o locutor.');
      const command = `:follow ${username}`;
      if (input.maxLength >= 0 && command.length > input.maxLength) throw new Error('O nick ultrapassa o limite do chat.');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, command);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      for (const type of ['keydown', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  });
  document.body.append(widget.host);
  const disposePlacement = TabbletPlacement.mount(widget);
  function muteHotelRadio() {
    if (!latest || latest.prefs.paused || latest.playback.state !== 'playing') return;
    for (const media of document.querySelectorAll('audio,video')) {
      const bubble = media.closest('.nitro-notification-bubble');
      const sources = [media.src, ...[...media.querySelectorAll('source')].map(s => s.src)].join(' ');
      if (!/dedicado\.stream/i.test(sources) && !(bubble && /r[aá]dio\s*habblet/i.test(bubble.textContent))) continue;
      if (!originalMedia.has(media)) originalMedia.set(media, media.muted);
      media.muted = true;
    }
    for (const media of originalMedia.keys()) if (!media.isConnected) originalMedia.delete(media);
  }
  function accept(value) {
    if (disposed || !value) return;
    latest = value;
    widget.update(value);
    muteHotelRadio();
    const figure = value.status?.isLive ? value.status.figure || '' : '';
    if (figure !== avatarFigure) {
      avatarFigure = figure;
      const generation = ++avatarGeneration;
      widget.setAvatar('');
      if (figure) chrome.runtime.sendMessage({ target: 'background', type: 'radio-avatar', figure }).then(response => {
        if (disposed || generation !== avatarGeneration) return;
        if (response?.value) widget.setAvatar(response.value);
        else avatarFigure = undefined;
      }).catch(() => { if (generation === avatarGeneration) avatarFigure = undefined; });
    }
  }
  function sync() {
    if (disposed || syncPending) return syncPending;
    syncPending = chrome.runtime.sendMessage({ target: 'background', type: 'radio-sync' }).then(response => {
      if (!response?.ok) throw new Error(response?.error || 'Sem resposta da extensão.');
      accept(response.value);
    }).catch(e => widget.announce(e.message)).finally(() => { syncPending = null; });
    return syncPending;
  }
  const onMessage = message => { if (message?.target === 'content' && message.type === 'radio-snapshot') accept(message.value); };
  chrome.runtime.onMessage.addListener(onMessage);
  // Only media insertions matter here; the interface never searches for a native SVG.
  const mediaObserver = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('audio,video,source') || node.querySelector('audio,video'))))) muteHotelRadio();
  });
  mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('play', muteHotelRadio, true);
  const timer = setInterval(sync, 15_000);
  const onVisibility = () => { if (!document.hidden) void sync(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onVisibility);
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    disposed = true;
    clearInterval(timer);
    mediaObserver.disconnect();
    chrome.runtime.onMessage.removeListener(onMessage);
    document.removeEventListener('play', muteHotelRadio, true);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const [media, muted] of originalMedia) media.muted = muted;
    disposePlacement();
    widget.destroy();
  });
  void sync();
})();
