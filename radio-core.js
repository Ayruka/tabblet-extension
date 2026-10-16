/* Shared, data-only rules. No dependency on the Habblet DOM. */
(() => {
  const themes = {
    default: { label: 'Rádio Tabblet', bg: '#131921', surface: '#1d2732', border: '#465567', text: '#f5f7fa', muted: '#b4c1cf', accent: '#85ddd3' },
    'under-construction': { label: 'Tabblet em obras', bg: '#13191e', surface: '#26373d', border: '#516169', text: '#fff3dc', muted: '#b7c7c8', accent: '#ffbd59' },
    'halloween-construction-2026': { label: 'Beta assombrado', bg: '#14131b', surface: '#25232c', border: '#51474a', text: '#fff4de', muted: '#c4b7af', accent: '#ffab36' },
    'election-2026': { label: 'Edição especial', bg: '#071b16', surface: '#1d3b30', border: '#426557', text: '#fff7de', muted: '#bad2cd', accent: '#f6d365' },
    'election-runoff-2026': { label: 'Arena Tabblet', bg: '#10131e', surface: '#242b3d', border: '#4b5976', text: '#fff4de', muted: '#b7c7dc', accent: '#ffbf54' }
  };
  const defaults = { volume: 0.5, channelId: 1, paused: false };
  const channelNames = ['Mix', 'Pop Internacional', 'Túnel do Tempo', 'K-POP', 'Urban Beats', 'Nordeste Hits', 'Brasil Vibes', 'Funk Hits', 'Gospel', 'Resenha & Churrasco', 'Paredão Sertanejo', 'Eletro & Dance', 'Lo-Fi & Foco', 'Modão Sertanejo', 'Rock'];
  const channelSlugs = ['pluz_mix', 'pluz_pop_internacional', 'canal_tunel_do_tempo', 'canal_k-pop', 'canal_urban_beats', 'canal_nordeste_hits', 'canal_brasil_vibes', 'canal_funk_hits', 'canal_gospel', 'canal_resenha__churrasco', 'canal_paredao_sertanejo', 'canal_eletro__dance', 'canal_lo-fi__foco', 'canal_modao_sertanejo', 'canal_rock'];
  const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : fallback;
  function safeStream(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['audio.tabblet.net', 'streaming.pluz.fm'].includes(url.hostname)
        && !url.username && !url.password && !url.port
        && /^\/listen\/[a-z0-9_-]+\/[a-z0-9_.-]+\.(mp3|aac)$/.test(url.pathname) && !url.search && !url.hash ? url.href : null;
    } catch { return null; }
  }
  function preferences(raw = {}) {
    return {
      volume: typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : defaults.volume,
      channelId: Number.isInteger(raw.channelId) && raw.channelId > 0 ? raw.channelId : defaults.channelId,
      paused: typeof raw.paused === 'boolean' ? raw.paused : defaults.paused
    };
  }
  function normalizeStatus(raw) {
    if (!raw || typeof raw.streaming?.is_live !== 'boolean') throw new Error('Resposta de status inválida.');
    const channels = Array.isArray(raw.network?.stations) ? raw.network.stations.flatMap(station => {
      const streamUrl = safeStream(station.stream_url);
      return Number.isInteger(station.id) && station.id > 0 && streamUrl ? [{ id: station.id, name: text(station.name, `Canal ${station.id}`).replace(/^Canal\s+/i, ''), streamUrl, online: station.online !== false, song: text(station.song) }] : [];
    }) : [];
    const presenter = raw.streaming.is_live ? raw.broadcast : null;
    return {
      isLive: raw.streaming.is_live,
      broadcastId: presenter?.id ?? null,
      username: text(presenter?.username || presenter?.streamer_name, 'Tabblet DJ'),
      figure: text(presenter?.figure || raw.default_presenter?.figure),
      title: text(presenter?.title || (raw.streaming.is_live ? raw.slot?.title : ''), raw.streaming.is_live ? 'Ao vivo na Tabblet' : 'Você escolhe a trilha'),
      listeners: Math.max(0, Number(raw.streaming.listeners) || 0),
      song: text(raw.streaming.song),
      liveStreamUrl: safeStream(raw.streaming.stream_url) || 'https://audio.tabblet.net/listen/tabblet/stream.aac',
      channels: channels.length ? [...new Map(channels.map(c => [c.id, c])).values()] : fallbackChannels()
    };
  }
  function fallbackChannels() { return channelNames.map((name, i) => ({ id: i + 1, name, streamUrl: `https://audio.tabblet.net/listen/${channelSlugs[i]}/radio.mp3`, online: true, song: '' })); }
  function source(status, prefs) {
    const channel = status.channels.find(c => c.id === prefs.channelId) || status.channels.find(c => c.online) || status.channels[0];
    return status.isLive ? { url: status.liveStreamUrl, name: status.username, song: status.song, channel } : { url: channel.streamUrl, name: channel.name, song: channel.song, channel };
  }
  function theme(raw = {}) { return Object.hasOwn(themes, raw.id) ? raw.id : 'default'; }
  globalThis.TabbletCore = { themes, defaults, preferences, normalizeStatus, source, safeStream, theme, fallbackChannels };
})();
