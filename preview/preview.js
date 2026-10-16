const Core = TabbletCore;
const widgets = [];
let live = new URLSearchParams(location.search).get('live') === '1';
let presenter = { username: 'Locutor Tabblet', title: 'Ao vivo na Tabblet', figure: '' };
let presenterAvatar = '';
function liveButton() {
 const button = document.querySelector('#live');
 button.setAttribute('aria-pressed', String(live));
 button.lastChild.textContent = live ? `${presenter.username} ao vivo` : 'Locutor fora do ar';
}
liveButton();
let themeId = localStorage.getItem('concept-theme') || 'halloween-construction-2026';
if (!Core.themes[themeId]) themeId = 'halloween-construction-2026';
document.querySelector('#theme').value = themeId;
const channels = Core.fallbackChannels();
channels[6].song = 'Seu Jorge · Amiga da Minha Mulher';
for (const variant of ['compact']) {
  let prefs;
  try { prefs = Core.preferences(JSON.parse(localStorage.getItem(`concept-${variant}`) || '{}')); } catch { prefs = Core.preferences(); }
  if (!localStorage.getItem(`concept-${variant}`)) prefs.channelId = 7;
  let playback = { state: prefs.paused ? 'paused' : 'playing' };
  const widget = TabbletPlayer.create({
    styleUrl: '../player.css', floating: false,
    assetUrl: (theme, kind) => `../assets/themes/${theme}/${kind}.webp`,
    onCommand: async (action, value) => {
      if (action === 'volume') prefs.volume = value;
      if (action === 'channel') prefs.channelId = value;
      if (action === 'play') prefs.paused = false;
      if (action === 'pause') prefs.paused = true;
      playback = { state: prefs.paused ? 'paused' : 'playing' };
      localStorage.setItem(`concept-${variant}`, JSON.stringify(prefs));
      render();
    },
    onFollow: async () => widget.announce('No hotel, este botão envia :follow para o locutor.')
  });
  function render() {
    widget.update({ prefs, themeId, playback, status: { isLive: live, broadcastId: live ? 'demo' : null, username: presenter.username, title: presenter.title, listeners: 49, song: '', channels, liveStreamUrl: 'https://audio.tabblet.net/listen/tabblet/stream.aac' }, error: '' });
    widget.setAvatar(live ? presenterAvatar : '');
  }
  document.querySelector(`#${variant}`).append(widget.host);
  widgets.push(render);
  render();
}
document.querySelector('#theme').addEventListener('change', e => { themeId = e.target.value; localStorage.setItem('concept-theme', themeId); widgets.forEach(render => render()); });
document.querySelector('#live').addEventListener('click', () => { live = !live; liveButton(); widgets.forEach(render => render()); });
async function refreshPresenter() {
 try {
  const response = await fetch('/preview/api/status', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) return;
  const data = await response.json();
  const current = data.broadcast || data.default_presenter;
  if (!current?.figure) return;
  presenter = { username: current.username || current.streamer_name || 'Locutor Tabblet', title: current.title || 'Ao vivo na Tabblet', figure: current.figure };
  const url = new URL('https://tabblet.net/api/public/avatar-image');
  url.search = new URLSearchParams({ figure: presenter.figure, headonly: '1', direction: '2', head_direction: '2', size: 'b', gesture: 'sml' });
  presenterAvatar = url.href;
  liveButton(); widgets.forEach(render => render());
 } catch { /* Keep the brand icon if the API is unavailable. */ }
}
void refreshPresenter();
setInterval(refreshPresenter, 60000);
