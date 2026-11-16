// Keyboard, mouse and pointer lock. Gameplay reads `state.keys` and `state.firing`; the
// one-shot verbs (buy, grenade, weapon slots, scoreboard) go out through handlers.onKey,
// so main.js owns what a key means and this module only owns how keys arrive.
export function createInput(canvas, handlers = {}) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };

  function press(event, down) {
    if (down) {
      if (event.repeat) return;
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
    if (down && handlers.onKey) handlers.onKey(event.code);
  }

  window.addEventListener('keydown', (event) => press(event, true));
  window.addEventListener('keyup', (event) => press(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  window.addEventListener('contextmenu', (event) => {
    if (state.locked) event.preventDefault();
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    if (handlers.onLockChange) handlers.onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      if (document.pointerLockElement === canvas) return;
      try {
        const request = canvas.requestPointerLock();
        // Chrome returns a promise and rejects when the gesture is not trusted (headless,
        // or a click that arrived while the browser was still settling). Swallow it: losing
        // the mouse is not a reason to throw away the round.
        if (request && typeof request.catch === 'function') request.catch(() => {});
      } catch {
        /* pointer lock unavailable: the game still runs on the keyboard */
      }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
  };
}
