// Pointer-lock mouse look and the key state the simulation reads once per fixed step. Raw mouse
// deltas accumulate between frames and are taken (and cleared) by the render loop; keys live in a
// Set of KeyboardEvent.code values so bindings never depend on layout.

const GAME_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyR', 'KeyB', 'KeyE', 'KeyG', 'KeyT', 'KeyC',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Digit1', 'Digit2', 'Digit3',
]);

export function createInput(dom, handlers = {}) {
  const keys = new Set();
  const state = { keys, firing: false, aiming: false };
  let lookX = 0;
  let lookY = 0;
  let locked = false;

  const setKey = (code, down) => {
    if (down) keys.add(code);
    else keys.delete(code);
    if (handlers.onKey) handlers.onKey(code, down);
  };

  window.addEventListener('keydown', (event) => {
    if (GAME_CODES.has(event.code)) event.preventDefault();
    if (event.repeat) return;
    setKey(event.code, true);
  });
  window.addEventListener('keyup', (event) => setKey(event.code, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    state.aiming = false;
  });

  dom.addEventListener('mousemove', (event) => {
    if (!locked) return;
    lookX += event.movementX;
    lookY += event.movementY;
  });
  dom.addEventListener('mousedown', (event) => {
    if (!locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  dom.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === dom;
    if (!locked) {
      state.firing = false;
      state.aiming = false;
    }
    if (handlers.onLockChange) handlers.onLockChange(locked);
  });

  return {
    state,
    isLocked: () => locked,
    requestLock: () => dom.requestPointerLock(),
    /** Mouse deltas since the last take, then cleared. */
    takeLook: () => {
      const x = lookX;
      const y = lookY;
      lookX = 0;
      lookY = 0;
      return { x, y };
    },
  };
}
