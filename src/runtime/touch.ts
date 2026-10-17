/**
 * Mobile controls: a floating left-thumb joystick (fed to IWSDK locomotion as a
 * virtual analog gamepad, so collision and speed behave exactly like a real
 * stick), right-thumb drag to look, and large tap targets for actions.
 */
import { G } from './state.js';

export const isTouch =
  typeof window !== 'undefined' && (!!window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

export interface TouchHooks {
  look: (dx: number, dy: number) => void;
  act: () => void;
  time: () => void;
  menu: () => void;
  canAct: () => string | null;
}

// ---- virtual gamepad -------------------------------------------------------
const axes = [0, 0, 0, 0];
const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
const virtualPad = {
  id: 'garden-virtual-joystick',
  index: 0,
  connected: true,
  mapping: 'standard' as GamepadMappingType,
  timestamp: 0,
  axes,
  buttons,
  hapticActuators: [],
  vibrationActuator: null,
};

let installed = false;
/** Analog movement input (used by the touch joystick and by scripted capture). */
export function setVirtualStick(x: number, y: number) {
  axes[0] = x;
  axes[1] = y;
}

export function installVirtualGamepad() {
  if (installed) return;
  installed = true;
  const real = navigator.getGamepads?.bind(navigator);
  (navigator as unknown as { getGamepads: () => (Gamepad | null)[] }).getGamepads = () => {
    const list = real ? Array.from(real()) : [];
    virtualPad.timestamp = performance.now();
    return [virtualPad as unknown as Gamepad, ...list.filter(Boolean)];
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function setupTouch(hooks: TouchHooks) {
  if (!isTouch) return;
  document.body.classList.add('touch');
  installVirtualGamepad();
  const root = document.getElementById('ui-root')!;

  // layer that captures all gameplay touches
  const layer = el('div', 'touch-layer');
  const ghost = el('div', 'joy-ghost', '<div class="joy-ghost-knob"></div><span>Move</span>');
  const base = el('div', 'joy-base', '<div class="joy-ring"></div><div class="joy-knob"></div>');
  const knob = base.querySelector('.joy-knob') as HTMLDivElement;
  const lookHint = el('div', 'look-ghost', '<span>Drag to look</span>');
  const act = el('button', 'touch-act', '<span class="touch-act-e">✦</span><span class="touch-act-label"></span>');
  const actLabel = act.querySelector('.touch-act-label') as HTMLSpanElement;
  const timeBtn = el('button', 'touch-btn touch-time', '<span>☾</span>');
  const menuBtn = el('button', 'touch-btn touch-menu', '<span>☰</span>');
  const rotate = el(
    'div',
    'rotate-hint',
    '<div class="rotate-card paper"><div class="rotate-phone"></div><div class="rotate-zh">横屏</div><div class="rotate-en">Turn your phone sideways</div><div class="rotate-sub">Left thumb moves · right thumb looks</div><button class="btn ghost rotate-skip">Continue anyway</button></div>',
  );
  root.append(layer, ghost, lookHint, base, act, timeBtn, menuBtn, rotate);

  const R = 58; // joystick radius in CSS px
  let joyId: number | null = null;
  let joyX = 0;
  let joyY = 0;
  let lookId: number | null = null;
  let lookX = 0;
  let lookY = 0;

  const setStick = (dx: number, dy: number) => {
    const d = Math.hypot(dx, dy);
    const clamped = Math.min(d, R);
    const nx = d > 0 ? (dx / d) * clamped : 0;
    const ny = d > 0 ? (dy / d) * clamped : 0;
    knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    // dead zone + smooth response curve so small thumb drift doesn't creep
    // small dead zone, then a near-linear ramp: ~60% deflection is a relaxed walk,
    // the last few percent (red ring) breaks into a stroll-faster pace
    const raw = clamped / R;
    let m = raw < 0.06 ? 0 : (raw - 0.06) / 0.88;
    m = Math.min(1, Math.pow(m, 1.1));
    axes[0] = d > 0 ? (dx / d) * m : 0;
    axes[1] = d > 0 ? (dy / d) * m : 0;
    G.touchRun = raw > 0.97;
    base.classList.toggle('run', G.touchRun);
  };

  const onStart = (e: TouchEvent) => {
    e.preventDefault();
    if (!G.started || G.paused) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.45 && joyId === null) {
        joyId = t.identifier;
        // the stick is centred exactly under the thumb (the ring may overhang the
        // screen edge) so the first touch is always neutral, never a pull
        joyX = t.clientX;
        joyY = t.clientY;
        base.style.left = `${joyX}px`;
        base.style.top = `${joyY}px`;
        base.classList.add('on');
        setStick(t.clientX - joyX, t.clientY - joyY);
        ghost.classList.add('gone');
      } else if (lookId === null) {
        lookId = t.identifier;
        lookX = t.clientX;
        lookY = t.clientY;
        lookHint.classList.add('gone');
      }
    }
  };
  const onMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === joyId) setStick(t.clientX - joyX, t.clientY - joyY);
      else if (t.identifier === lookId) {
        const dx = t.clientX - lookX;
        const dy = t.clientY - lookY;
        lookX = t.clientX;
        lookY = t.clientY;
        // scale by screen width so the same swipe turns the same amount on any phone
        const k = (Math.PI * 1.1) / Math.max(window.innerWidth, 320);
        hooks.look(dx * k, dy * k * 0.85);
      }
    }
  };
  const onEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === joyId) {
        joyId = null;
        setStick(0, 0);
        base.classList.remove('on');
      } else if (t.identifier === lookId) lookId = null;
    }
  };
  layer.addEventListener('touchstart', onStart, { passive: false });
  layer.addEventListener('touchmove', onMove, { passive: false });
  layer.addEventListener('touchend', onEnd);
  layer.addEventListener('touchcancel', onEnd);

  const tap = (b: HTMLElement, fn: () => void) =>
    b.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('down');
        navigator.vibrate?.(8);
        fn();
        setTimeout(() => b.classList.remove('down'), 160);
      },
      { passive: false },
    );
  tap(act, hooks.act);
  tap(timeBtn, hooks.time);
  tap(menuBtn, hooks.menu);
  rotate.querySelector('.rotate-skip')!.addEventListener('click', () => rotate.classList.add('dismissed'));

  // keep labels/visibility in sync without per-frame DOM churn
  let lastLabel: string | null = '';
  let lastPlaying = false;
  const tick = () => {
    const playing = G.started && !G.paused;
    const label = playing ? hooks.canAct() : null;
    if (label !== lastLabel) {
      lastLabel = label;
      if (label) actLabel.textContent = label;
      act.classList.toggle('on', !!label);
    }
    timeBtn.firstElementChild!.textContent = { cycle: '◐', day: '☀', dusk: '☼', night: '☾' }[G.todMode];
    if (playing !== lastPlaying) {
      lastPlaying = playing;
      for (const b of [layer, timeBtn, menuBtn, ghost, lookHint]) b.classList.toggle('live', playing);
      if (!playing) {
        joyId = null;
        lookId = null;
        setStick(0, 0);
        base.classList.remove('on');
      }
    }
    rotate.classList.toggle('on', window.innerHeight > window.innerWidth * 1.05);
    requestAnimationFrame(tick);
  };
  tick();
}
