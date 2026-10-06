const audio = document.querySelector("#radio");

function reportState(state, error) {
  chrome.runtime.sendMessage({
    target: "background",
    type: "radio-state",
    state,
    error
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "offscreen" || message.type !== "radio-command") {
    return false;
  }

  if (message.action === "volume") {
    audio.volume = Number(message.value);
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === "mute") {
    audio.muted = message.value === true;
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === "pause") {
    audio.pause();
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === "play" || message.action === "restart") {
    if (message.streamUrl !== "https://streaming.pluz.fm/listen/pluz_mix/radio.mp3"
      && message.streamUrl !== "https://streaming.pluz.fm/listen/tabblet/stream.aac") {
      sendResponse({ ok: false, error: "Endereço de transmissão inválido." });
      return false;
    }

    if (message.action === "restart") {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.src = message.streamUrl;
      audio.load();
    } else if (audio.src !== message.streamUrl) {
      audio.src = message.streamUrl;
      audio.load();
    }
    audio.volume = Number(message.value);
    audio.play()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        reportState("error", error.message);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  sendResponse({ ok: false, error: `Comando de áudio inválido: ${message.action}` });
  return false;
});

audio.addEventListener("playing", () => reportState("playing"));
audio.addEventListener("pause", () => reportState("paused"));
audio.addEventListener("error", () => {
  const error = audio.error;
  console.error("Rádio Tabblet: erro ao carregar o stream.", error);
  reportState("error", error ? error.message || `MediaError ${error.code}` : "Erro desconhecido");
});
