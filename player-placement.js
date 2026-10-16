/* Start in the hotel's notification column; allow a saved floating position. */
(() => {
  const KEY = 'radioPlayerPlacement';
  const GAP = 8;
  function mount(widget) {
    const host = widget.host;
    const handle = widget.root.querySelector('.now');
    let saved;
    let slot;
    let anchor;
    let observedStack;
    let interacted = false;
    let drag;
    let frame;
    let destroyed = false;
    const clamp = (value, max) => Math.max(GAP, Math.min(Math.max(GAP, max), value));
    function position(left, top) {
      const rect = host.getBoundingClientRect();
      host.style.left = `${clamp(left, innerWidth - rect.width - GAP)}px`;
      host.style.top = `${clamp(top, innerHeight - rect.height - GAP)}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    }
    function removeSlot() {
      if (observedStack) resize.unobserve(observedStack);
      observedStack = null; slot?.remove(); slot = null; anchor = null;
    }
    function layout() {
      frame = null;
      if (destroyed || drag?.moved) return;
      if (saved) { removeSlot(); position(saved.left, saved.top); return; }
      const native = [...document.querySelectorAll('.nitro-notification-bubble')].find(bubble => {
        const rect = bubble.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && /r[aá]dio\s*habblet/i.test(bubble.textContent);
      });
      if (native?.parentElement) {
        if (anchor !== native || !slot?.isConnected) {
          removeSlot();
          anchor = native;
          slot = document.createElement('div');
          slot.dataset.tabbletRadioSlot = '';
          slot.setAttribute('aria-hidden', 'true');
          slot.style.cssText = 'box-sizing:border-box;flex:0 0 auto;pointer-events:none;width:100%;';
          native.after(slot);
          observedStack = native.parentElement;
          resize.observe(observedStack);
        }
        const rect = native.getBoundingClientRect();
        host.style.width = `${Math.min(Math.max(180, rect.width), 240, innerWidth - GAP * 2)}px`;
        slot.style.height = `${host.getBoundingClientRect().height}px`;
        const target = slot.getBoundingClientRect();
        position(rect.left, target.top);
      } else {
        removeSlot();
        const width = host.getBoundingClientRect().width;
        position(innerWidth - width - GAP, 80);
      }
    }
    function schedule() { if (!destroyed && !frame) frame = requestAnimationFrame(layout); }
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    const observer = new MutationObserver(records => {
      if (saved) return;
      if (!slot?.isConnected || !anchor?.isConnected || records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('.nitro-notification-bubble') || node.querySelector('.nitro-notification-bubble'))))) schedule();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    handle.style.cursor = 'grab';
    handle.style.touchAction = 'none';
    handle.title = 'Arraste para mover o player';
    const start = event => {
      if (event.button !== 0 || event.target.closest('button,a,input,select,textarea')) return;
      interacted = true;
      const rect = host.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false, previous: saved };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const move = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      removeSlot();
      handle.style.cursor = 'grabbing';
      position(drag.left + dx, drag.top + dy);
    };
    const finish = event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (event.type === 'pointercancel') saved = drag.previous;
      else if (drag.moved) {
        const rect = host.getBoundingClientRect();
        saved = { left: rect.left, top: rect.top };
        chrome.storage.local.set({ [KEY]: saved }).catch(() => widget.announce('Não foi possível salvar a posição do player.'));
      }
      drag = null;
      handle.style.cursor = 'grab';
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      schedule();
    };
    const preventImageDrag = event => event.preventDefault();
    handle.addEventListener('pointerdown', start);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('dragstart', preventImageDrag);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    chrome.storage.local.get(KEY).then(data => {
      const value = data[KEY];
      if (!destroyed && !interacted && Number.isFinite(value?.left) && Number.isFinite(value?.top)) saved = value;
      schedule();
    }).catch(schedule);
    layout();
    return () => {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect(); resize.disconnect(); removeSlot();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      handle.removeEventListener('pointerdown', start);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      handle.removeEventListener('dragstart', preventImageDrag);
    };
  }
  globalThis.TabbletPlacement = { mount };
})();
