(() => {
  const PLAYER_MARKER = "data-tabblet-radio-player";
  const ORIGINAL_PLAYER_MARKER = "data-tabblet-radio-original-player";
  const LIVE_NOTIFICATION_DURATION_MS = 10_000;
  const RADIO_LABEL = /rádio\s*habblet|radio\s*habblet/i;
  let presenterRefreshTimer;
  let previousPresenterLive = null;
  const presenterRequests = new WeakMap();
  const followButtons = new Map();
  const programTickerObservers = new WeakMap();
  const radioPlayers = new Map();
  const collapseAttempts = new WeakSet();

  function showLiveBroadcastNotification(broadcast) {
    const notification = document.createElement("div");
    notification.className = "nitro-notification-bubble default-bubble rounded p-2 tabblet-live-announcement";
    notification.dataset.tabbletLiveAnnouncement = "";
    notification.setAttribute("aria-live", "polite");

    const avatar = document.createElement("div");
    avatar.className = "tabblet-live-announcement-avatar";
    avatar.setAttribute("aria-hidden", "true");
    if (broadcast.avatarDataUrl) {
      avatar.style.backgroundImage = `url("${broadcast.avatarDataUrl}")`;
    }

    const content = document.createElement("div");
    content.className = "tabblet-live-announcement-content";
    const message = document.createElement("div");
    message.className = "tabblet-live-announcement-message";
    const username = document.createElement("strong");
    username.textContent = broadcast.username;
    const programTitle = document.createElement("strong");
    programTitle.textContent = broadcast.programTitle || "As melhores da Tabblet";
    message.append(username, document.createTextNode(" está ao vivo!"));
    const program = document.createElement("div");
    program.className = "tabblet-live-announcement-program";
    program.append(document.createTextNode("Programação: "), programTitle);

    const followButton = document.createElement("button");
    followButton.className = "tabblet-live-announcement-follow";
    followButton.type = "button";
    followButton.textContent = "Clique aqui para seguir";
    followButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void sendFollowCommand(broadcast.username, followButton);
    });
    content.append(message, program, followButton);
    notification.append(avatar, content);

    const existingBubbles = Array.from(document.querySelectorAll(
      ".nitro-notification-bubble:not([data-tabblet-radio-player]):not([data-tabblet-live-announcement])"
    )).filter((bubble) => bubble.parentElement);
    const anchor = existingBubbles[existingBubbles.length - 1];
    if (anchor) {
      const stack = anchor.parentElement;
      const stackBubbles = existingBubbles.filter((bubble) => bubble.parentElement === stack);
      if (getComputedStyle(stack).flexDirection === "column-reverse") {
        const firstBubble = stackBubbles[0];
        stack.insertBefore(notification, firstBubble || stack.firstChild);
      } else {
        const lastBubble = stackBubbles[stackBubbles.length - 1];
        (lastBubble || anchor).after(notification);
      }
    } else {
      console.warn("Rádio Tabblet: não foi encontrado o contêiner de notificações; o alerta será adicionado à página.");
      document.body.append(notification);
    }
    window.setTimeout(() => notification.remove(), LIVE_NOTIFICATION_DURATION_MS);
  }

  function muteOriginalPlayer(bubble) {
    bubble.querySelectorAll("audio, video").forEach((media) => {
      media.muted = true;
      media.volume = 0;
    });
  }

  function collapseOriginalPlayer(bubble) {
    if (collapseAttempts.has(bubble) || !bubble.querySelector("audio, .radio-item")) {
      return;
    }

    const chevron = Array.from(bubble.querySelectorAll("svg path"))
      .find((path) => path.getAttribute("d")?.startsWith("M240.971 130.524"));
    const collapseControl = chevron?.closest(".cursor-pointer")
      || chevron?.closest("button")
      || chevron?.parentElement?.parentElement;
    if (collapseControl) {
      collapseAttempts.add(bubble);
      collapseControl.click();
    }
  }

  function updateProgramTicker(element) {
    const firstCopy = element.querySelector(".tabblet-radio-program-copy");
    if (firstCopy) {
      element.style.setProperty(
        "--tabblet-radio-program-duration",
        `${Math.max(8, firstCopy.getBoundingClientRect().width / 18)}s`
      );
    }
  }

  function setProgramTitle(element, title) {
    const value = String(title);
    if (element.dataset.programTitle === value) {
      return;
    }
    element.dataset.programTitle = value;

    let observer = programTickerObservers.get(element);
    if (!observer) {
      observer = new ResizeObserver(() => updateProgramTicker(element));
      observer.observe(element);
      programTickerObservers.set(element, observer);
    }
    element.querySelectorAll(".tabblet-radio-program-copy").forEach((copy) => {
      observer.unobserve(copy);
    });

    const track = document.createElement("span");
    track.className = "tabblet-radio-program-track";

    for (let index = 0; index < 2; index += 1) {
      const copy = document.createElement("span");
      copy.className = "tabblet-radio-program-copy";
      copy.textContent = `Programação: ${value}`;
      if (index > 0) {
        copy.setAttribute("aria-hidden", "true");
      }
      track.append(copy);
      if (index === 0) {
        observer.observe(copy);
      }
    }

    element.replaceChildren(track);
    requestAnimationFrame(() => updateProgramTicker(element));
  }

  function positionFollowButton(bubble, container) {
    if (!bubble.isConnected || container.hidden) {
      return;
    }
    const rect = bubble.getBoundingClientRect();
    const gap = 8;
    const width = container.offsetWidth || 72;
    const left = rect.right + gap + width <= window.innerWidth
      ? rect.right + gap
      : Math.max(gap, rect.left - width - gap);
    container.style.left = `${left}px`;
    container.style.top = `${Math.max(gap, Math.min(window.innerHeight - container.offsetHeight - gap, rect.top + rect.height / 2 - container.offsetHeight / 2))}px`;
  }

  function waitForChatInput(button) {
    const findInput = () => document.querySelector('input.chat-input[name="chat"]');
    const input = findInput();
    const followGroup = button.closest(".tabblet-radio-follow-group");
    if (input || !button.isConnected || (followGroup && followGroup.hidden)) {
      return Promise.resolve(input);
    }

    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const chatInput = findInput();
        const container = button.closest(".tabblet-radio-follow-group");
        if (chatInput || !button.isConnected || (container && container.hidden)) {
          observer.disconnect();
          resolve(chatInput);
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["hidden"],
        childList: true,
        subtree: true
      });
    });
  }

  async function sendFollowCommand(username, button) {
    if (!username) {
      return;
    }
    button.disabled = true;
    try {
      const chatInput = await waitForChatInput(button);
      if (!chatInput) {
        return;
      }
      if (chatInput.disabled || chatInput.readOnly) {
        console.error("Rádio Tabblet: o campo de chat está indisponível.");
        return;
      }
      if (chatInput.value.trim()) {
        console.warn("Rádio Tabblet: limpe a mensagem atual do chat antes de usar Seguir.");
        return;
      }
      const command = `:follow ${username}`;
      if (command.length > chatInput.maxLength) {
        console.error("Rádio Tabblet: o nome do locutor excede o limite de caracteres do chat.");
        return;
      }

      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set;
      valueSetter.call(chatInput, command);
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      chatInput.focus();
      chatInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      chatInput.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
    } finally {
      if (button.isConnected) {
        button.disabled = false;
      }
    }
  }

  function createFollowButton(bubble) {
    const container = document.createElement("div");
    container.className = "tabblet-radio-follow-group";
    container.hidden = true;
    const indicator = document.createElement("div");
    indicator.className = "tabblet-radio-live-indicator";
    indicator.innerHTML = '<span class="tabblet-radio-live-dot" aria-hidden="true"></span><span>Ao vivo</span>';
    const button = document.createElement("button");
    button.className = "tabblet-radio-follow";
    button.type = "button";
    button.textContent = "Seguir";
    button.title = "Seguir o locutor ao vivo no Habblet";
    const onFollowClick = async () => {
      await sendFollowCommand(button.dataset.username, button);
    };
    button.addEventListener("click", onFollowClick);
    container.append(indicator, button);
    document.body.append(container);

    const updatePosition = () => positionFollowButton(bubble, container);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(bubble);
    followButtons.set(bubble, {
      container,
      indicator,
      button,
      onFollowClick,
      updatePosition,
      resizeObserver
    });

    return button;
  }

  async function refreshPresenterDetails(bubble) {
    const requestId = (presenterRequests.get(bubble) || 0) + 1;
    presenterRequests.set(bubble, requestId);

    try {
      const response = await chrome.runtime.sendMessage({
        target: "background",
        type: "presenter-info"
      });
      if (!response || !response.ok) {
        throw new Error(response && response.error
          ? response.error
          : "A extensão não respondeu com os dados do locutor.");
      }
      if (presenterRequests.get(bubble) !== requestId || !bubble.isConnected) {
        return;
      }

      const presenterInfo = response.presenter;
      if (presenterInfo.isLive && previousPresenterLive !== true) {
        showLiveBroadcastNotification(presenterInfo);
      }
      previousPresenterLive = presenterInfo.isLive === true;

      const avatar = bubble.querySelector(".tabblet-radio-avatar-image");
      if (!avatar) {
        return;
      }
      const presenter = bubble.querySelector(".tabblet-radio-presenter");
      const program = bubble.querySelector(".tabblet-radio-program");
      const listeners = bubble.querySelector(".tabblet-radio-listeners");
      const avatarUsername = response.presenter.avatarUsername;
      if (avatar.dataset.username !== avatarUsername) {
        avatar.style.backgroundImage = "";
        avatar.dataset.username = avatarUsername;
      }
      if (response.presenter.avatarDataUrl) {
        avatar.style.backgroundImage = `url("${response.presenter.avatarDataUrl}")`;
      }
      avatar.title = response.presenter.isLive
        ? `No ar: ${response.presenter.username}`
        : `Apresentador: ${response.presenter.username}`;
      if (presenter) {
        presenter.textContent = `Ao vivo agora: ${response.presenter.username}`;
      }
      if (program) {
        program.hidden = false;
        setProgramTitle(program, response.presenter.programTitle);
      }
      if (listeners) {
        listeners.textContent = `${response.presenter.listeners} ${response.presenter.listeners === 1 ? "ouvinte" : "ouvintes"}`;
      }
      const followBinding = followButtons.get(bubble);
      if (followBinding) {
        followBinding.button.dataset.username = response.presenter.username;
        followBinding.container.hidden = !response.presenter.isLive;
        positionFollowButton(bubble, followBinding.container);
      }
    } catch (error) {
      console.error("Rádio Tabblet: não foi possível atualizar a imagem do locutor.", error);
    }
  }

  function hasRadioPlayer(bubble) {
    if (bubble.hasAttribute(PLAYER_MARKER) || bubble.hasAttribute(ORIGINAL_PLAYER_MARKER)) {
      return false;
    }

    const text = bubble.textContent || "";
    const audio = bubble.querySelector("audio");
    const oldRadioStream = audio && (
      audio.src.includes("dedicado.stream") ||
      Boolean(bubble.querySelector('audio source[src*="dedicado.stream"]'))
    );

    return RADIO_LABEL.test(text) || Boolean(oldRadioStream);
  }

  function createPlayer(originalBubble) {
    const originalAvatar = originalBubble.querySelector(".avatar-image");
    const avatarBackground = originalAvatar
      ? getComputedStyle(originalAvatar).backgroundImage
      : "";

    const bubble = document.createElement(originalBubble.tagName);
    bubble.className = originalBubble.className;
    bubble.classList.add("tabblet-radio-player-bubble");
    bubble.setAttribute(PLAYER_MARKER, "");
    bubble.classList.add("tabblet-radio-bubble");
    const radioBackground = "rgba(105, 45, 170, 0.82)";
    bubble.style.setProperty("--tabblet-radio-background", radioBackground);
    bubble.style.backgroundColor = radioBackground;
    bubble.style.color = "#fff";
    originalBubble.parentElement.insertBefore(bubble, originalBubble);

    originalBubble.setAttribute(ORIGINAL_PLAYER_MARKER, "");
    const muteOnPlay = (event) => {
      if (event.target instanceof HTMLMediaElement) {
        event.target.muted = true;
        event.target.volume = 0;
      }
    };
    originalBubble.addEventListener("play", muteOnPlay, true);
    const originalObserver = new MutationObserver(() => {
      muteOriginalPlayer(originalBubble);
      collapseOriginalPlayer(originalBubble);
    });
    originalObserver.observe(originalBubble, {
      attributes: true,
      attributeFilter: ["aria-expanded", "muted", "src"],
      childList: true,
      subtree: true
    });
    muteOriginalPlayer(originalBubble);
    collapseOriginalPlayer(originalBubble);
    radioPlayers.set(originalBubble, {
      bubble,
      originalObserver,
      muteOnPlay
    });

    createFollowButton(bubble);

    bubble.innerHTML = `
      <section class="tabblet-radio" aria-label="Player Rádio Tabblet">
        <button class="tabblet-radio-header" type="button" aria-expanded="true">
          <span class="tabblet-radio-heading">— Rádio Tabblet</span>
          <span class="tabblet-radio-listeners">Carregando ouvintes…</span>
          <svg class="tabblet-radio-chevron" viewBox="0 0 448 512" aria-hidden="true">
            <path d="M240.971 130.524l194.343 194.343c9.373 9.373 9.373 24.569 0 33.941l-22.667 22.667c-9.357 9.357-24.522 9.375-33.901.04L224 227.495 69.255 381.516c-9.379 9.335-24.544 9.317-33.901-.04l-22.667-22.667c-9.373-9.373-9.373-24.569 0-33.941L207.03 130.525c9.372-9.373 24.568-9.373 33.941-.001z"></path>
          </svg>
        </button>
        <div class="tabblet-radio-content">
          <div class="tabblet-radio-main">
            <div class="tabblet-radio-avatar" aria-hidden="true">
              <div class="tabblet-radio-avatar-image"></div>
            </div>
            <div class="tabblet-radio-controls">
              <div class="tabblet-radio-control-row">
                <button class="tabblet-radio-play" type="button" aria-label="Tocar rádio" title="Tocar rádio">
                  <svg class="tabblet-radio-play-icon" viewBox="0 0 384 512" aria-hidden="true">
                    <path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.8S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.8s33.7 8.3 48.5-.8l288-176c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"></path>
                  </svg>
                  <svg class="tabblet-radio-pause-icon" viewBox="0 0 448 512" aria-hidden="true">
                    <path d="M144 479H48c-26.5 0-48-21.5-48-48V79c0-26.5 21.5-48 48-48h96c26.5 0 48 21.5 48 48v352c0 26.5-21.5 48-48 48zm304-48V79c0-26.5-21.5-48-48-48h-96c-26.5 0-48 21.5-48 48v352c0 26.5 21.5 48 48 48h96c26.5 0 48-21.5 48-48z"></path>
                  </svg>
                </button>
                <input class="tabblet-radio-volume" type="range" min="0" max="1" step="0.01" value="0.5" aria-label="Volume">
              </div>
              <div class="tabblet-radio-meta" aria-live="polite">
                <div class="tabblet-radio-presenter">Carregando locutor…</div>
                <div class="tabblet-radio-program" hidden></div>
              </div>
            </div>
          </div>
          <div class="tabblet-radio-status" role="status" aria-live="polite"></div>
        </div>
        <button class="tabblet-radio-restart" type="button" aria-label="Reiniciar rádio" title="Reiniciar rádio">
          <svg viewBox="0 0 512 512" aria-hidden="true">
            <path d="M463.5 224H472c13.3 0 24-10.7 24-24V72c0-9.7-5.8-18.5-14.8-22.2s-19.3-1.7-26.2 5.2l-42.4 42.4C372.7 59.8 316.8 32 256 32 132.3 32 32 132.3 32 256s100.3 224 224 224c94.8 0 175.8-58.8 208.7-142 5.1-12.9-1.3-27.4-14.2-32.5s-27.4 1.3-32.5 14.2C392.3 384.5 329.8 432 256 432c-97.2 0-176-78.8-176-176S158.8 80 256 80c47.4 0 90.3 18.7 121.9 49.1l-43.5 43.5c-6.9 6.9-8.9 17.2-5.2 26.2s12.5 14.8 22.2 14.8h112.1z"></path>
          </svg>
        </button>
      </section>
    `;

    const avatarImage = bubble.querySelector(".tabblet-radio-avatar-image");
    if (avatarBackground && avatarBackground !== "none") {
      avatarImage.style.backgroundImage = avatarBackground;
    }

    const playButton = bubble.querySelector(".tabblet-radio-play");
    const volume = bubble.querySelector(".tabblet-radio-volume");
    const header = bubble.querySelector(".tabblet-radio-header");
    const content = bubble.querySelector(".tabblet-radio-content");
    const status = bubble.querySelector(".tabblet-radio-status");
    const restartButton = bubble.querySelector(".tabblet-radio-restart");
    volume.value = "0.5";
    void refreshPresenterDetails(bubble);
    if (!presenterRefreshTimer) {
      presenterRefreshTimer = setInterval(() => {
        document.querySelectorAll(`.nitro-notification-bubble[${PLAYER_MARKER}]`).forEach((playerBubble) => {
          void refreshPresenterDetails(playerBubble);
        });
      }, 60_000);
    }

    async function sendCommand(action, value) {
      try {
        const response = await chrome.runtime.sendMessage({
          target: "background",
          type: "radio-command",
          action,
          value
        });
        if (!response || !response.ok) {
          throw new Error(response && response.error
            ? response.error
            : "A extensão não respondeu ao comando.");
        }
        return true;
      } catch (error) {
        status.textContent = "Não foi possível controlar a transmissão.";
        console.error("Rádio Tabblet: falha ao enviar comando para o player.", error);
        return false;
      }
    }

    playButton.disabled = true;
    void sendCommand("play", Number(volume.value)).then((ok) => {
      if (!ok && playButton.isConnected) {
        playButton.disabled = false;
      }
    });

    playButton.addEventListener("click", async () => {
      if (playButton.disabled) {
        return;
      }

      playButton.disabled = true;
      const action = bubble.classList.contains("tabblet-radio-playing") ? "pause" : "play";
      if (action === "play") {
        status.textContent = "";
      }
      const ok = await sendCommand(action, Number(volume.value));
      if (!ok) {
        playButton.disabled = false;
      }
    });

    restartButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (restartButton.disabled) {
        return;
      }

      restartButton.disabled = true;
      playButton.disabled = true;
      bubble.classList.add("tabblet-radio-restarting");
      status.textContent = "";
      const restarted = await sendCommand("restart", Number(volume.value));
      bubble.classList.remove("tabblet-radio-restarting");
      restartButton.disabled = false;
      playButton.disabled = false;
      if (restarted) {
        bubble.classList.add("tabblet-radio-playing");
        playButton.setAttribute("aria-label", "Pausar rádio");
        playButton.title = "Pausar rádio";
        void refreshPresenterDetails(bubble);
      } else {
        bubble.classList.remove("tabblet-radio-playing");
        playButton.setAttribute("aria-label", "Tocar rádio");
        playButton.title = "Tocar rádio";
        status.textContent = "Não foi possível reiniciar a transmissão.";
      }
    });

    volume.addEventListener("input", () => {
      void sendCommand("volume", Number(volume.value));
    });

    header.addEventListener("click", () => {
      const expanded = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", String(!expanded));
      content.hidden = expanded;
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.target !== "content" || message.type !== "radio-state") {
      return;
    }

    document.querySelectorAll(`.nitro-notification-bubble[${PLAYER_MARKER}]`).forEach((bubble) => {
      const playButton = bubble.querySelector(".tabblet-radio-play");
      const status = bubble.querySelector(".tabblet-radio-status");
      if (!playButton || !status) {
        return;
      }

      if (message.state === "playing") {
        status.textContent = "";
        playButton.disabled = false;
        playButton.setAttribute("aria-label", "Pausar rádio");
        playButton.title = "Pausar rádio";
        bubble.classList.add("tabblet-radio-playing");
      } else if (message.state === "paused") {
        status.textContent = "";
        playButton.disabled = false;
        playButton.setAttribute("aria-label", "Tocar rádio");
        playButton.title = "Tocar rádio";
        bubble.classList.remove("tabblet-radio-playing");
      } else if (message.state === "error") {
        status.textContent = "A transmissão está indisponível no momento.";
        playButton.disabled = false;
        playButton.setAttribute("aria-label", "Tocar rádio");
        playButton.title = "Tocar rádio";
        bubble.classList.remove("tabblet-radio-playing");
      }
    });
  });

  function scanForPlayer() {
    radioPlayers.forEach((player, originalBubble) => {
      if (!originalBubble.isConnected) {
        player.originalObserver.disconnect();
        originalBubble.removeEventListener("play", player.muteOnPlay, true);
        player.bubble.remove();
        radioPlayers.delete(originalBubble);
      }
    });

    followButtons.forEach((binding, bubble) => {
      if (!bubble.isConnected) {
        binding.button.removeEventListener("click", binding.onFollowClick);
        binding.container.remove();
        binding.resizeObserver.disconnect();
        window.removeEventListener("resize", binding.updatePosition);
        window.removeEventListener("scroll", binding.updatePosition, true);
        followButtons.delete(bubble);
      }
    });

    document.querySelectorAll(".nitro-notification-bubble").forEach((bubble) => {
      if (hasRadioPlayer(bubble)) {
        createPlayer(bubble);
      }
    });
  }

  scanForPlayer();
  new MutationObserver(scanForPlayer).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
