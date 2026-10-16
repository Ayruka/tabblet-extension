const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const core = vm.createContext({ URL }); vm.runInContext(read('radio-core.js'), core); const Core = core.TabbletCore;
const raw = live => ({ streaming: { is_live: live, stream_url: 'https://audio.tabblet.net/listen/tabblet/stream.aac', listeners: 49 }, broadcast: live ? { id: 119, username: 'Blacky..', title: 'Beta assombrado' } : null, network: { stations: Core.fallbackChannels().map(c => ({ id: c.id, name: c.name, stream_url: c.streamUrl, online: true })) } });
test('Brasil Vibes → live → Brasil Vibes preserves the saved channel and volume', () => {
  const prefs = Core.preferences({ channelId: 7, volume: 0.12 });
  for (const live of [false, true, false]) {
    const source = Core.source(Core.normalizeStatus(raw(live)), prefs);
    assert.equal(source.url, live ? 'https://audio.tabblet.net/listen/tabblet/stream.aac' : 'https://audio.tabblet.net/listen/canal_brasil_vibes/radio.mp3');
    assert.equal(prefs.channelId, 7); assert.equal(prefs.volume, 0.12);
  }
});
test('invalid status never becomes an offline transition; URLs are constrained', () => {
  assert.throws(() => Core.normalizeStatus({ streaming: {} }));
  for (const url of ['http://audio.tabblet.net/listen/tabblet/stream.aac', 'https://evil.test/a.mp3', 'https://audio.tabblet.net.evil.test/listen/x/a.mp3', 'https://user@audio.tabblet.net/listen/x/a.mp3', 'https://audio.tabblet.net/listen/x/a.mp3?token=secret', 'javascript:alert(1)']) assert.equal(Core.safeStream(url), null);
  assert(Core.safeStream('https://streaming.pluz.fm/listen/tabblet/stream.aac'));
});
test('preferences preserve zero volume and pause; unknown theme has a neutral fallback', () => {
  const prefs = Core.preferences({ volume: 0, paused: true, collapsed: true, channelId: 7 });
  assert.equal(prefs.volume, 0); assert.equal(prefs.paused, true); assert.equal('collapsed' in prefs, false, 'legacy collapsed state is ignored');
  assert.equal(Core.preferences({ volume: NaN }).volume, 0.5);
  assert.equal(Core.theme({ id: 'halloween-construction-2026' }), 'halloween-construction-2026');
  assert.equal(Core.theme({ id: 'future-theme' }), 'default');
});
function harness(saved = {}) {
  const local = { radioPreferences: saved }, session = {};
  const tabs = new Map([[1, { id: 1, url: 'https://www.habblet.city/hotel', mutedInfo: { muted: false } }]]);
  const events = {};
  const listener = name => ({ addListener(fn) { events[name] = fn; } });
  let hasDocument = false, starts = 0, current = null, calls = [], network = raw(false), fail = false;
  const alarms = new Map();
  const storage = store => ({ async get(keys) { return typeof keys === 'string' ? { [keys]: store[keys] } : { ...store }; }, async set(value) { Object.assign(store, structuredClone(value)); } });
  const chrome = {
    storage: { local: storage(local), session: storage(session) },
    runtime: { getURL: file => `chrome-extension://test/${file}`, getContexts: async () => hasDocument ? [{}] : [], onMessage: listener('message'), sendMessage: async message => {
      calls.push(message);
      if (message.target === 'offscreen') {
        if (message.source !== current?.src || (current.paused && !message.paused)) starts++;
        current = { state: message.paused ? 'paused' : 'playing', src: message.source, paused: message.paused, volume: message.volume };
        return { ok: true, playback: structuredClone(current) };
      }
    } },
    offscreen: { async createDocument() { hasDocument = true; }, async closeDocument() { hasDocument = false; } },
    alarms: { onAlarm: listener('alarm'), get: async key => alarms.get(key), create: async (key, value) => alarms.set(key, value), clear: async key => alarms.delete(key) },
    tabs: { async get(id) { if (!tabs.has(id)) throw Error('missing'); return tabs.get(id); }, sendMessage: async () => {}, onRemoved: listener('removed'), onUpdated: listener('updated') }
  };
  const ctx = vm.createContext({ chrome, URL, AbortSignal, console: { warn() {} }, Date, btoa, setTimeout, clearTimeout, fetch: async url => {
    if (fail && url.includes('/status')) throw Error('offline');
    return { ok: true, json: async () => url.includes('/theme') ? { id: 'halloween-construction-2026' } : structuredClone(network) };
  } });
  ctx.importScripts = file => vm.runInContext(read(file), ctx);
  vm.runInContext(read('background.js'), ctx);
  async function send(message, id = 1) {
    return new Promise(resolve => events.message({ target: 'background', ...message }, { tab: tabs.get(id) }, resolve));
  }
  return { send, local, session, tabs, calls, get starts() { return starts; }, get current() { return current; }, setNetwork(value) { network = value; }, fail(value) { fail = value; }, ctx, events, get hasDocument() { return hasDocument; } };
}
test('controller persists channel/volume across reload, switches on live and restores after live', async () => {
  const h = harness({ volume: 0.12, channelId: 7 });
  let reply = await h.send({ type: 'radio-sync' }); assert.equal(reply.ok, true);
  assert.equal(h.current.volume, 0.12); assert.match(h.current.src, /canal_brasil_vibes/);
  const starts = h.starts; await h.send({ type: 'radio-sync' }); assert.equal(h.starts, starts, 'a reload must not restart a healthy stream');
  h.setNetwork(raw(true)); await h.send({ type: 'radio-sync', force: true }); assert.match(h.current.src, /tabblet/);
  h.setNetwork(raw(false)); await h.send({ type: 'radio-sync', force: true }); assert.match(h.current.src, /canal_brasil_vibes/);
  await h.send({ type: 'radio-command', action: 'volume', value: 0 });
  assert.equal(h.local.radioPreferences.volume, 0); assert.equal(h.local.radioPreferences.channelId, 7);
});
test('manual pause survives live transitions and another tab, without autoplay', async () => {
  const h = harness({ volume: 0.1, channelId: 7 });
  await h.send({ type: 'radio-sync' }); await h.send({ type: 'radio-command', action: 'pause' });
  const starts = h.starts;
  h.setNetwork(raw(true)); await h.send({ type: 'radio-sync', force: true });
  h.tabs.set(2, { id: 2, url: 'https://habblet.city/hotel' });
  await h.send({ type: 'radio-sync' }, 2);
  assert.equal(h.current.paused, true); assert.equal(h.starts, starts + 1, 'only the source configuration changed; remains paused');
  assert.equal(h.local.radioPreferences.paused, true);
});
test('status failure retains live playback and never switches to a fallback channel', async () => {
  const h = harness({ channelId: 7 }); h.setNetwork(raw(true)); await h.send({ type: 'radio-sync' });
  h.fail(true); const reply = await h.send({ type: 'radio-sync', force: true });
  assert.equal(reply.value.status.isLive, true); assert.match(h.current.src, /tabblet/); assert(reply.value.error);
});
test('muting all hotel tabs mutes shared audio; closing last tab closes the offscreen document', async () => {
  const h = harness(); await h.send({ type: 'radio-sync' });
  h.tabs.get(1).mutedInfo.muted = true;
  await h.send({ type: 'radio-sync' }); assert.equal(h.calls.at(-1).muted, true);
  h.tabs.delete(1); await vm.runInContext('serial(cleanupTabs)', h.ctx);
  assert.equal(h.hasDocument, false); assert.equal(h.session.activeRadioTabs.length, 0);
});
test('controller validates commands and a channel choice during live only changes the saved return channel', async () => {
  const h = harness(); h.setNetwork(raw(true)); await h.send({ type: 'radio-sync' });
  const result = await h.send({ type: 'radio-command', action: 'channel', value: 7 });
  assert.equal(result.ok, true); assert.match(h.current.src, /tabblet/); assert.equal(h.local.radioPreferences.channelId, 7);
  for (const [action, value] of [['channel', 999], ['volume', -1], ['volume', Infinity], ['arbitrary', 1]]) assert.equal((await h.send({ type: 'radio-command', action, value })).ok, false);
});
