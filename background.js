const OFFSCREEN_PATH = "offscreen.html";
const STATUS_API_URL = "https://tabblet.net/api/public/status";
const AVATAR_API_URL = "https://api.radiohabblet.com.br/imager";
const MIX_STREAM_URL = "https://streaming.pluz.fm/listen/pluz_mix/radio.mp3";
const LIVE_STREAM_URL = "https://streaming.pluz.fm/listen/tabblet/stream.aac";
const MAX_AVATAR_BYTES = 1024 * 1024;
const ACTIVE_TABS_KEY = "activeRadioTabs";
let creatingOffscreenDocument;
let activeTabsQueue = Promise.resolve();
const contentTabIds = new Set();

function isBroadcastLive(status) {
  return status.streaming?.is_live === true;
}

function serializeActiveTabChange(change) {
  const result = activeTabsQueue.then(change);
  activeTabsQueue = result.catch(() => {});
  return result;
}

async function getActiveTabIds() {
  const stored = await chrome.storage.session.get(ACTIVE_TABS_KEY);
  return Array.isArray(stored[ACTIVE_TABS_KEY]) ? stored[ACTIVE_TABS_KEY] : [];
}

async function registerActiveTab(tabId) {
  await serializeActiveTabChange(async () => {
    const activeTabs = await getActiveTabIds();
    if (!activeTabs.includes(tabId)) {
      activeTabs.push(tabId);
      await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: activeTabs });
    }
  });
  contentTabIds.add(tabId);
  await syncPlayerMute();
}

async function syncPlayerMute() {
  if (!(await hasOffscreenDocument())) {
    return;
  }

  const tabIds = await getActiveTabIds();
  const tabs = await Promise.all(tabIds.map(async (tabId) => {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      contentTabIds.delete(tabId);
      return null;
    }
  }));
  const validTabs = tabs.filter(Boolean);
  const validIds = validTabs.map((tab) => tab.id);
  await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: validIds });
  const muted = validTabs.length > 0 && validTabs.every((tab) => tab.mutedInfo?.muted === true);
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "radio-command",
    action: "mute",
    value: muted
  });
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Reproduzir a rádio fora da CSP da página do Habblet."
    });
  }

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = undefined;
  }
}

async function handleCommand(message, tabId) {
  if (message.action !== "play" && message.action !== "pause"
    && message.action !== "volume" && message.action !== "restart") {
    throw new Error(`Comando de áudio inválido: ${message.action}`);
  }

  if (Number.isInteger(tabId)) {
    await registerActiveTab(tabId);
  }

  if (message.action !== "play" && message.action !== "restart"
    && !(await hasOffscreenDocument())) {
    return;
  }

  const streamUrl = message.action === "play" || message.action === "restart"
    ? await getCurrentStreamUrl()
    : undefined;
  if (Number.isInteger(tabId) && !contentTabIds.has(tabId)) {
    return;
  }

  await ensureOffscreenDocument();
  await syncPlayerMute();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "radio-command",
    action: message.action,
    streamUrl,
    value: message.value
  });
  if (response && response.ok === false) {
    throw new Error(response.error || "O player não conseguiu executar o comando.");
  }
}

async function getCurrentStreamUrl() {
  const response = await fetch(STATUS_API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`A API de status respondeu HTTP ${response.status}.`);
  }

  const status = await response.json();
  return isBroadcastLive(status)
    ? LIVE_STREAM_URL
    : MIX_STREAM_URL;
}

async function fetchPresenterInfo() {
  const statusResponse = await fetch(STATUS_API_URL, { cache: "no-store" });
  if (!statusResponse.ok) {
    throw new Error(`A API de status respondeu HTTP ${statusResponse.status}.`);
  }

  const status = await statusResponse.json();
  const isLive = isBroadcastLive(status);
  const broadcast = status.broadcast && typeof status.broadcast === "object"
    ? status.broadcast
    : null;
  const livePresenter = isLive && broadcast
    ? broadcast
    : null;
  const username = livePresenter
    ? livePresenter?.username
      || livePresenter?.streamer_name
      || "Tabblet DJ"
    : "Tabblet DJ";
  const avatarUsername = livePresenter
    ? livePresenter.username || livePresenter.streamer_name || status.default_presenter?.username || "RadioTabblet"
    : status.default_presenter?.username || "RadioTabblet";
  const programTitle = livePresenter
    ? livePresenter.title || status.slot?.title || "As melhores da Tabblet"
    : "As melhores da Tabblet";
  const listeners = Number(status.streaming?.listeners);

  if (typeof username !== "string" || !username.trim()) {
    throw new Error("A API de status não informou o usuário do locutor.");
  }

  let avatarDataUrl = "";
  try {
    const avatarUrl = new URL(AVATAR_API_URL);
    avatarUrl.search = new URLSearchParams({
      user: avatarUsername.trim(),
      action: "std,crr=",
      gesture: "sml",
      direction: "4",
      head_direction: "4",
      headonly: "true",
      size: "b",
      img_format: "",
      dance: "",
      effect: "",
      frame_num: "30"
    });

    const avatarResponse = await fetch(avatarUrl, {
      cache: "force-cache",
      signal: AbortSignal.timeout(8000)
    });
    if (!avatarResponse.ok) {
      throw new Error(`A API de imagem respondeu HTTP ${avatarResponse.status} para ${avatarUsername}.`);
    }

    const contentType = avatarResponse.headers.get("content-type") || "";
    if (!/^image\/(?:png|jpeg|gif|webp)$/i.test(contentType)) {
      throw new Error(`A API de imagem retornou um tipo inesperado: ${contentType || "desconhecido"}.`);
    }

    const avatarBlob = await avatarResponse.blob();
    if (avatarBlob.size === 0 || avatarBlob.size > MAX_AVATAR_BYTES) {
      throw new Error(`A imagem de ${avatarUsername} está vazia ou excede o limite permitido.`);
    }

    const bytes = new Uint8Array(await avatarBlob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    avatarDataUrl = `data:${contentType};base64,${btoa(binary)}`;
  } catch (error) {
    console.warn("Rádio Tabblet: não foi possível carregar a imagem do locutor.", error);
  }

  return {
    username: username.trim(),
    avatarUsername: avatarUsername.trim(),
    isLive,
    programTitle,
    listeners: Number.isFinite(listeners) && listeners >= 0 ? listeners : 0,
    avatarDataUrl
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "background" && message.type === "radio-state") {
    getActiveTabIds().then((tabIds) => tabIds.forEach((tabId) => {
      chrome.tabs.sendMessage(tabId, {
        target: "content",
        type: "radio-state",
        state: message.state,
        error: message.error
      }).catch(() => contentTabIds.delete(tabId));
    })).catch((error) => console.error("Rádio Tabblet: falha ao encaminhar estado do áudio.", error));
    return false;
  }

  if (message?.target === "background" && message.type === "presenter-info") {
    fetchPresenterInfo()
      .then((presenter) => sendResponse({ ok: true, presenter }))
      .catch((error) => {
        console.error("Rádio Tabblet: falha ao carregar os dados do locutor.", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (!message || message.target !== "background" || message.type !== "radio-command") {
    return false;
  }

  handleCommand(message, sender.tab && sender.tab.id)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("Rádio Tabblet: falha ao controlar o player.", error);
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

async function unregisterActiveTab(tabId) {
  contentTabIds.delete(tabId);
  await serializeActiveTabChange(async () => {
    const activeTabs = await getActiveTabIds();
    if (!activeTabs.includes(tabId)) {
      return;
    }
    const remainingTabs = activeTabs.filter((activeTabId) => activeTabId !== tabId);
    await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: remainingTabs });
    if (remainingTabs.length > 0 || !(await hasOffscreenDocument())) {
      await syncPlayerMute();
      return;
    }

    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "radio-command",
      action: "pause"
    });
    await chrome.offscreen.closeDocument();
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  unregisterActiveTab(tabId).catch((error) => {
    console.error("Rádio Tabblet: falha ao parar o áudio após fechar a aba.", error);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.mutedInfo) {
    syncPlayerMute().catch((error) => {
      console.error("Rádio Tabblet: falha ao sincronizar o áudio com o mudo da aba.", error);
    });
  }
  if (changeInfo.url && !/^https:\/\/(?:www\.)?habblet\.city\/hotel(?:\/|$|\?|#)/i.test(changeInfo.url)) {
    getActiveTabIds()
      .then((tabIds) => tabIds.includes(tabId) ? unregisterActiveTab(tabId) : undefined)
      .catch((error) => console.error("Rádio Tabblet: falha ao acompanhar a navegação da aba.", error));
  }
});
