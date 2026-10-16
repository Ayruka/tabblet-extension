importScripts('radio-core.js');
const Core = TabbletCore;
const PREFS_KEY = 'radioPreferences';
const TABS_KEY = 'activeRadioTabs';
const STATUS_URL = 'https://tabblet.net/api/public/status';
const THEME_URL = 'https://tabblet.net/api/public/theme';
let queue = Promise.resolve();
let creatingOffscreen;
let statusFetchedAt = 0;
let themeFetchedAt = 0;
let status;
let themeId = 'default';
let prefs;
let error = '';
let playback = { state: 'paused', src: '', paused: true };
const avatarCache = new Map();
const ready = (async () => {
  const [local, session] = await Promise.all([chrome.storage.local.get(PREFS_KEY), chrome.storage.session.get(['radioStatus', 'radioTheme'])]);
  prefs = Core.preferences(local[PREFS_KEY]);
  status = session.radioStatus;
  themeId = Core.theme({ id: session.radioTheme });
})();
function serial(work) {
  const result = queue.then(() => ready).then(work);
  queue = result.catch(() => {});
  return result;
}
async function tabIds() { return (await chrome.storage.session.get(TABS_KEY))[TABS_KEY] || []; }
function hotelUrl(url) { return /^https:\/\/(www\.)?habblet\.city\/hotel(?:[/?#]|$)/i.test(url || ''); }
async function register(tab) {
  if (!tab || !hotelUrl(tab.url)) throw new Error('Abra o hotel para usar a rádio.');
  const ids = await tabIds();
  if (!ids.includes(tab.id)) await chrome.storage.session.set({ [TABS_KEY]: [...ids, tab.id] });
  if (!(await chrome.alarms.get('radio-refresh'))) await chrome.alarms.create('radio-refresh', { periodInMinutes: 0.5 });
}
async function hasOffscreen() {
  return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] })).length > 0;
}
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creatingOffscreen) creatingOffscreen = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Reproduzir a Tabblet e os canais PluZ com um único player compartilhado entre abas.' });
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}
async function json(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Serviço indisponível (HTTP ${response.status}).`);
  return response.json();
}
async function refresh(force = false) {
  const now = Date.now();
  await Promise.all([
    (async () => {
      if (!force && now - statusFetchedAt < 12_000) return;
      try {
        status = Core.normalizeStatus(await json(STATUS_URL));
        statusFetchedAt = now;
        error = '';
        await chrome.storage.session.set({ radioStatus: status });
      } catch (e) {
        error = 'Não foi possível atualizar a rádio. Tentaremos novamente.';
        console.warn('Tabblet: status', e);
        // A failed request must never be mistaken for the end of a live show.
      }
    })(),
    (async () => {
      if (!force && now - themeFetchedAt < 60_000) return;
      try {
        const next = await json(THEME_URL);
        themeId = next.next_change_at && next.server_time >= next.next_change_at ? 'default' : Core.theme(next);
        themeFetchedAt = now;
        await chrome.storage.session.set({ radioTheme: themeId });
      } catch (e) { console.warn('Tabblet: tema', e); }
    })()
  ]);
}
function snapshot() {
  return { prefs, status, themeId, playback, error };
}
async function broadcast() {
  const value = snapshot();
  await Promise.all((await tabIds()).map(id => chrome.tabs.sendMessage(id, { target: 'content', type: 'radio-snapshot', value }).catch(() => {})));
  return value;
}
async function reconcile(restart = false) {
  if (!status) return;
  const ids = await tabIds();
  if (!ids.length) return;
  if (prefs.paused && !(await hasOffscreen())) {
    playback = { state: 'paused', paused: true, src: '', volume: prefs.volume };
    return;
  }
  await ensureOffscreen();
  const tabs = (await Promise.all(ids.map(id => chrome.tabs.get(id).catch(() => null)))).filter(tab => tab && hotelUrl(tab.url));
  if (!tabs.length) { await cleanupTabs(); return; }
  const source = Core.source(status, prefs);
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'radio-apply', source: source.url, paused: prefs.paused, volume: prefs.volume, muted: tabs.every(tab => tab.mutedInfo?.muted), restart });
  if (!response?.ok) throw new Error(response?.error || 'O player não respondeu.');
  playback = response.playback;
}
async function synchronize(force = false) {
  await refresh(force);
  try { await reconcile(); } catch (e) {
    playback = { ...playback, state: 'error', error: e.message };
    console.warn('Tabblet: reprodução', e);
  }
  return broadcast();
}
async function command(message, tab) {
  await register(tab);
  if (message.action === 'volume') {
    if (typeof message.value !== 'number' || !Number.isFinite(message.value) || message.value < 0 || message.value > 1) throw new Error('Volume inválido.');
    prefs.volume = message.value;
  } else if (message.action === 'channel') {
    if (!status?.channels.some(c => c.id === message.value)) throw new Error('Canal indisponível.');
    prefs.channelId = message.value;
  } else if (message.action === 'pause') prefs.paused = true;
  else if (message.action === 'play') prefs.paused = false;
  else if (message.action !== 'restart') throw new Error('Comando inválido.');
  await chrome.storage.local.set({ [PREFS_KEY]: prefs });
  if (message.action === 'play' || message.action === 'restart') await refresh();
  try { await reconcile(message.action === 'restart'); }
  catch (e) { playback = { ...playback, state: 'error', error: e.message }; }
  return broadcast();
}
async function cleanupTabs() {
  const ids = await tabIds();
  const tabs = await Promise.all(ids.map(id => chrome.tabs.get(id).catch(() => null)));
  const remaining = tabs.filter(tab => tab && hotelUrl(tab.url)).map(tab => tab.id);
  await chrome.storage.session.set({ [TABS_KEY]: remaining });
  if (!remaining.length) {
    await chrome.alarms.clear('radio-refresh');
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
    playback = { state: 'paused', paused: true, src: '' };
  } else await reconcile();
}
async function avatar(figure) {
  if (typeof figure !== 'string' || !/^[a-z0-9.-]{1,600}$/i.test(figure)) return '';
  if (avatarCache.has(figure)) return avatarCache.get(figure);
  try {
    const url = new URL('https://tabblet.net/api/public/avatar-image');
    url.search = new URLSearchParams({ figure, headonly: '1', direction: '2', head_direction: '2', size: 'b', gesture: 'sml' });
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const type = (response.headers.get('content-type') || '').split(';')[0];
    if (!response.ok || !/^image\/(png|webp|gif|jpeg)$/.test(type)) return '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 1024 * 1024) return '';
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const result = `data:${type};base64,${btoa(binary)}`;
    if (avatarCache.size >= 12) avatarCache.clear();
    avatarCache.set(figure, result);
    return result;
  } catch { return ''; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'background') return false;
  if (message.type === 'radio-state') {
    if (sender.url !== chrome.runtime.getURL('offscreen.html')) return false;
    void serial(async () => {
      if (!status || message.playback?.src !== Core.source(status, prefs).url || message.playback.paused !== prefs.paused) return;
      playback = message.playback;
      await broadcast();
    });
    return false;
  }
  if (!sender.tab || !hotelUrl(sender.tab.url)) return false;
  if (message.type === 'radio-avatar') {
    avatar(message.figure).then(value => respond({ ok: true, value }));
    return true;
  }
  serial(async () => {
    if (message.type === 'radio-command') return command(message, sender.tab);
    if (message.type === 'radio-sync') {
      await register(sender.tab);
      return synchronize(message.force === true);
    }
    throw new Error('Mensagem inválida.');
  }).then(value => respond({ ok: true, value })).catch(e => respond({ ok: false, error: e.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'radio-refresh') void serial(async () => { await cleanupTabs(); if ((await tabIds()).length) await synchronize(); });
});
chrome.tabs.onRemoved.addListener(() => { void serial(cleanupTabs); });
chrome.tabs.onUpdated.addListener((id, changes) => {
  if (changes.url || changes.mutedInfo) void serial(cleanupTabs);
});
