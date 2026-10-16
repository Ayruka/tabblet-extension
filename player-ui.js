/* The same component is used by the extension and the concept preview. */
(() => {
  const icons = {
    play: '<path d="m9 5 11 7-11 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
    volume: '<path d="m11 4-6 5H2v6h3l6 5zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
    reload: '<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 6M20 7l-3-3"/>',
    music: '<path d="M9 18V5l11-2v13M9 9l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18"/>',
    follow: '<path d="M14 3h7v7M21 3l-9 9M10 5H4v15h15v-6"/>'
  };
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  function create({ assetUrl, styleUrl, onCommand, onFollow, onRequest, floating = true }) {
    const host = document.createElement('div');
    host.dataset.tabbletPlayer = '';
    host.className = 'tabblet-extension-host';
    if (floating) {
      host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:76px;z-index:2147483000;display:block;width:min(200px,calc(100vw - 16px));max-height:calc(100dvh - 96px);';
    }
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <link rel="stylesheet" href="${styleUrl}">
      <section class="player compact" aria-label="Rádio Tabblet">
        <div class="body">
          <div class="eyebrow"><span class="dot"></span><span class="mode">Conectando</span><span class="audience"></span></div><div class="now"><div class="avatar-wrap"><img class="avatar" alt="" width="52" height="52"></div><div class="now-copy"><div class="presenter-row"><h2 class="title" hidden></h2><button class="follow icon-button" type="button" hidden aria-label="Seguir locutor no hotel" title="Seguir locutor no hotel">${svg('follow')}</button></div><div class="channel-picker"><select id="channel" aria-label="Canal PluZ FM" disabled><option>Carregando…</option></select><svg class="channel-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></div><p class="subtitle">Carregando programação…</p></div></div>
          <div class="transport"><button class="play" type="button" aria-label="Tocar rádio">${svg('play')}</button><div class="volume-group"><label class="volume-label"><span>${svg('volume')} Volume</span><output>50%</output></label><input class="volume" type="range" min="0" max="1" step="0.01" value="0.5" aria-label="Volume"></div><div class="quick-actions"><button class="restart icon-button" type="button" aria-label="Reconectar transmissão" title="Reconectar transmissão">${svg('reload')}</button><a class="request icon-button" href="https://tabblet.net/#request-dialog" target="_blank" rel="noopener noreferrer" aria-label="Pedir música" title="Pedir música">${svg('music')}</a><a class="site icon-button" href="https://tabblet.net/" target="_blank" rel="noopener noreferrer" aria-label="Abrir site da Tabblet" title="Abrir site da Tabblet">${svg('site')}</a></div></div>
          <p class="notice" role="status" hidden></p>
        </div>
      </section>`;
    const el = selector => root.querySelector(selector);
    if (onRequest) el('.request').addEventListener('click', event => {
      event.preventDefault();
      onRequest();
    });
    let current;
    let lastTheme;
    let lastAvatar = '';
    let channelsSignature;
    let noticeTimer;
    let transientNotice = '';
    let volumeTimer;
    let volumeDraft = null;
    let pendingPlay = false;
    const guarded = async (action, value) => {
      try { await onCommand(action, value); }
      catch (e) { announce(e.message || 'Não foi possível salvar. Tente novamente.'); }
    };
    const announce = message => {
      transientNotice = message;
      clearTimeout(noticeTimer);
      el('.notice').textContent = message;
      el('.notice').hidden = false;
      noticeTimer = setTimeout(() => { transientNotice = ''; if (current) update(current); }, 10_000);
    };
    el('.play').addEventListener('click', async () => {
      if (!current || pendingPlay) return;
      pendingPlay = true;
      el('.play').disabled = true;
      try { await guarded(current.prefs.paused ? 'play' : 'pause'); }
      finally { pendingPlay = false; el('.play').disabled = !current; }
    });
    el('.volume').addEventListener('input', event => {
      const value = Number(event.target.value);
      volumeDraft = value;
      el('output').textContent = `${Math.round(value * 100)}%`;
      el('.volume').style.setProperty('--level', `${value * 100}%`);
      clearTimeout(volumeTimer);
      volumeTimer = setTimeout(async () => { await guarded('volume', value); if (volumeDraft === value) volumeDraft = null; }, 100);
    });
    el('#channel').addEventListener('change', event => { void guarded('channel', Number(event.target.value)); });
    el('.restart').addEventListener('click', async () => {
      el('.restart').disabled = true;
      try { await guarded('restart'); } finally { el('.restart').disabled = false; }
    });
    el('.follow').addEventListener('click', async () => {
      if (!current?.status?.isLive) return;
      el('.follow').disabled = true;
      try { await onFollow(current.status.username); }
      catch (e) { announce(e.message); }
      finally { el('.follow').disabled = false; }
    });
    function update(value) {
      current = value;
      const { prefs, status, playback, themeId = 'default', error } = value;
      const palette = TabbletCore.themes[themeId] || TabbletCore.themes.default;
      const validTheme = Object.hasOwn(TabbletCore.themes, themeId) ? themeId : 'default';
      for (const key of ['bg', 'surface', 'border', 'text', 'muted', 'accent']) el('.player').style.setProperty(`--${key}`, palette[key]);
      if (validTheme !== lastTheme) {
        el('.avatar').src = lastAvatar || assetUrl(validTheme, 'icon');
        lastTheme = validTheme;
      }
      el('.player').dataset.theme = validTheme;
      const volume = volumeDraft ?? prefs.volume;
      el('.volume').value = String(volume);
      el('output').textContent = `${Math.round(volume * 100)}%`;
      el('.volume').style.setProperty('--level', `${volume * 100}%`);
      el('.play').disabled = pendingPlay;
      el('.play').innerHTML = svg(prefs.paused ? 'play' : 'pause');
      el('.play').setAttribute('aria-label', prefs.paused ? 'Tocar rádio' : 'Pausar rádio');
      el('.player').dataset.playing = String(!prefs.paused && playback.state === 'playing');
      el('.player').dataset.state = prefs.paused ? 'paused' : playback.state;
      el('.play').setAttribute('aria-busy', String(!prefs.paused && playback.state === 'buffering'));
      if (!status) {
        el('.notice').textContent = error || 'Conectando à Tabblet…';
        el('.notice').hidden = false;
        return;
      }
      const source = TabbletCore.source(status, prefs);
      el('.mode').textContent = status.isLive ? 'AO VIVO' : '';
      el('.mode').hidden = !status.isLive;
      el('.dot').hidden = !status.isLive;
      el('.player').dataset.live = String(status.isLive);
      el('.audience').textContent = status.isLive ? `${status.listeners} ${status.listeners === 1 ? 'ouvinte' : 'ouvintes'}` : 'PLUZ FM';
      el('.title').textContent = status.isLive ? status.username : '';
      el('.title').hidden = !status.isLive;
      el('.channel-picker').hidden = status.isLive;
      el('.eyebrow').hidden = !status.isLive;
      el('#channel').disabled = false;
      el('.subtitle').textContent = status.isLive ? status.title : source.song || 'Música boa, do seu jeito.';
      const signature = JSON.stringify(status.channels.map(c => [c.id, c.name, c.online]));
      if (signature !== channelsSignature) {
        el('#channel').replaceChildren(...status.channels.map(c => {
          const option = document.createElement('option'); option.value = c.id; option.textContent = c.name + (c.online ? '' : ' · indisponível'); option.disabled = !c.online; return option;
        }));
        channelsSignature = signature;
      }
      el('#channel').value = String(source.channel.id);
      el('.follow').hidden = !status.isLive;
      el('.avatar').alt = status.isLive ? `Cabeça de ${status.username}` : '';
      el('.avatar-wrap').title = status.isLive ? `No ar: ${status.username}` : 'Rádio Tabblet';
      el('.notice').textContent = transientNotice || (playback.state === 'error' ? playback.error || 'A transmissão caiu. Tentaremos reconectar.' : error || '');
      el('.notice').hidden = !el('.notice').textContent;
    }
    el('.avatar').addEventListener('error', () => {
      if (lastAvatar) { lastAvatar = ''; el('.avatar').src = assetUrl(lastTheme || 'default', 'icon'); }
    });
    function setAvatar(src) { lastAvatar = src; el('.avatar').src = src || assetUrl(lastTheme || 'default', 'icon'); }
    return { host, root, update, announce, setAvatar, destroy() { clearTimeout(noticeTimer); clearTimeout(volumeTimer); host.remove(); } };
  }
  globalThis.TabbletPlayer = { create };
})();
