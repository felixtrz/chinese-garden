// Shared Playwright helpers for the scripts in tools/.
// They drive the app through the `window.__garden` debug hooks installed in src/index.ts.
import { chromium } from 'playwright';

/** Defaults to `npm run preview` (production build); set GARDEN_URL=https://localhost:8642/ for `npm run dev`. */
export const GARDEN_URL = process.env.GARDEN_URL || 'https://localhost:8643/';

/** Hardware GL via Metal on macOS; SwiftShader (software) elsewhere, e.g. GPU-less Linux CI. */
export const GL_ARGS =
  process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export function launch(extraArgs = []) {
  return chromium.launch({ headless: true, args: ['--ignore-certificate-errors', ...GL_ARGS, ...extraArgs] });
}

/** Collects page errors (and console errors/warnings with `console: true`) into an array. */
export function collectErrors(page, { console: withConsole = false } = {}) {
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  if (withConsole) {
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
  }
  return logs;
}

/** Loads the garden (with `?debug` so production builds expose the hooks) and waits until it is ready. */
export async function openGarden(page, query = '?debug') {
  await page.goto(GARDEN_URL + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden?.G?.ready === true, null, { timeout: 180_000 });
}

/** Returns `tp(x, z, yaw, pitch, waitMs)`, which teleports the player and lets the view settle. */
export function teleporter(page, defaultWait = 2000) {
  return async (x, z, yaw = 0, pitch = 0, wait = defaultWait) => {
    await page.evaluate(([x, z, yaw, pitch]) => window.__garden.teleport(x, z, yaw, pitch), [x, z, yaw, pitch]);
    await page.waitForTimeout(wait);
  };
}

/**
 * Puts the page on Playwright's fake clock so the app advances in fixed steps no matter how
 * slowly frames render (e.g. SwiftShader): physics, timers and animations stay deterministic.
 * Call before `openGardenOnFakeClock`, which then loads the page.
 */
export async function installFakeClock(page, time = new Date('2026-10-16T09:00:00')) {
  // The fake clock can hand three's AudioListener a negative frame delta, and WebAudio throws
  // on negative ramp times, killing the render loop. Clamp scheduled times instead.
  await page.addInitScript(() => {
    const P = AudioParam.prototype;
    for (const k of ['linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setValueAtTime', 'setTargetAtTime']) {
      const f = P[k];
      P[k] = function (v, t, ...rest) {
        return f.call(this, v, Number.isFinite(t) ? Math.max(0, t) : 0, ...rest);
      };
    }
  });
  await page.clock.install({ time });
}

/** Loads the garden on the fake clock, then freezes time so only `stepFrames` advances it. */
export async function openGardenOnFakeClock(page, query = '?debug') {
  await page.goto(GARDEN_URL + query);
  // loading is bounded by real time (fetches, shader compiles), so poll on the wall clock
  // while nudging the fake clock forward until the garden reports ready
  const deadline = Date.now() + 300_000;
  while (!(await page.evaluate(() => window.__garden?.G?.ready === true))) {
    if (Date.now() > deadline) throw new Error('garden never became ready');
    await page.clock.runFor(50);
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.clock.runFor(1200);
  // margin: a slow GPU can let more than a few ms of fake time pass before pausing
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

/** Advances the fake clock one frame at a time until `predicate(arg)` holds in the page. */
export async function stepUntil(page, predicate, arg, { fps = 30, seconds = 10 } = {}) {
  for (let i = 0; i < seconds * fps; i++) {
    if (await page.evaluate(predicate, arg)) return true;
    await page.clock.runFor(1000 / fps);
  }
  return page.evaluate(predicate, arg);
}
