// Polished 1-minute preview capture (1920x1080 @ 24 fps, one full day-night cycle).
// Playwright's fake clock advances exactly 1/24 s per frame; locomotion runs inline,
// so walking speed is true-to-life. A page-side autopilot walks smooth curved paths
// through the same analog stick the mobile joystick uses, while gaze is steered
// independently with a critically damped spring for natural head motion.
// Usage: node tools/video2.mjs <framesDir> [maxFrames]
// Env: FPS (default 24), WIDTH x HEIGHT (default 1920x1080), e.g. WIDTH=1080 HEIGHT=1440 for 3:4.
// RESUME=1 keeps frames already in <framesDir>: the run is deterministic (fake clock, seeded
// Math.random), so it replays up to the last saved frame at a tiny viewport and carries on.
import fs from 'node:fs';
import { installFakeClock, launch, openGardenOnFakeClock } from './lib.mjs';

const FPS = +(process.env.FPS || 24);
const WIDTH = +(process.env.WIDTH || 1920);
const HEIGHT = +(process.env.HEIGHT || 1080);
const out = process.argv[2] || 'video/frames2';
const maxFrames = +(process.argv[3] || 1e9);
if (!process.env.RESUME) fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
// frames 0..resumeAt-1 already exist; the newest may be truncated by an interrupted run, so redo it
const saved = fs.readdirSync(out).filter((f) => f.endsWith('.png')).length;
const resumeAt = Math.max(0, saved - 1);

const browser = await launch();
// catching up renders at a tiny size; nothing the tour does depends on the viewport
const catchUp = { width: Math.round(WIDTH / 12), height: Math.round(HEIGHT / 12) };
const page = await browser.newPage({ viewport: resumeAt > 0 ? catchUp : { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
if (resumeAt > 0) console.log(`resuming: replaying ${resumeAt} saved frames`);
// frames are paced by the fake clock, so a slow frame (software GL, a busy machine) must not abort the capture
page.setDefaultTimeout(300_000);
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
// live audio is unused here: tools/soundtrack.mjs renders the track offline from events.json
await installFakeClock(page);
// seeded Math.random so effects (sparkles, the finale's lanterns) are identical on every run
await page.addInitScript(() => {
  let seed = 20261016;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
await openGardenOnFakeClock(page, '?capture');

// ---------------------------------------------------------------- autopilot
await page.evaluate(() => {
  const g = window.__garden;
  g.G.walkOverride = 1.45; // an unhurried stroll
  g.G.todMode = 'cycle';
  g.G.tod = 0.9; // start at dawn; 60 s later the day has come full circle
  const A = (window.__auto = {
    path: null,
    s: 0,
    mag: 0,
    look: 1.6,
    gaze: null,
    gazePitch: -0.03,
    yawVel: 0,
    pitchVel: 0,
    done: true,
    t: 0,
  });
  const lenAt = (path) => {
    const L = [0];
    for (let i = 1; i < path.length; i++) L.push(L[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    return L;
  };
  const pointAt = (path, L, s) => {
    s = Math.max(0, Math.min(L[L.length - 1], s));
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const u = (s - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
    return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * u, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * u];
  };
  window.__walk = (path, look = 1.6) => {
    A.path = path;
    A.L = lenAt(path);
    A.s = 0;
    A.look = look;
    A.done = false;
  };
  window.__gaze = (target, pitchBias = 0) => {
    A.gaze = target;
    A.gazePitch = pitchBias;
  };
  window.__autoStep = (dt) => {
    A.t += dt;
    const pl = g.player();
    const p = g.world.player.position;
    let dir = null;
    let remain = 0;
    if (A.path && !A.done) {
      // progress = closest point on the path ahead of the current progress
      let best = A.s;
      let bestD = Infinity;
      for (let s = A.s; s < Math.min(A.L[A.L.length - 1], A.s + 3); s += 0.05) {
        const q = pointAt(A.path, A.L, s);
        const d = Math.hypot(q[0] - p.x, q[1] - p.z);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      A.s = best;
      remain = A.L[A.L.length - 1] - A.s;
      const tgt = pointAt(A.path, A.L, A.s + A.look);
      const dx = tgt[0] - p.x;
      const dz = tgt[1] - p.z;
      const dl = Math.hypot(dx, dz) || 1;
      dir = [dx / dl, dz / dl];
      if (remain < 0.25) A.done = true;
    }
    // ease into and out of each walk
    const want = A.done ? 0 : Math.min(1, remain / 1.4 + 0.15);
    A.mag += (want - A.mag) * Math.min(1, dt * (want > A.mag ? 1.6 : 3.0));
    if (A.mag < 0.02) A.mag = 0;
    const yaw = pl.yaw;
    const fwd = [-Math.sin(yaw), -Math.cos(yaw)];
    const right = [Math.cos(yaw), -Math.sin(yaw)];
    if (dir && A.mag > 0) g.move((dir[0] * right[0] + dir[1] * right[1]) * A.mag, -(dir[0] * fwd[0] + dir[1] * fwd[1]) * A.mag);
    else g.move(0, 0);
    // gaze: look where we walk, or at a point of interest; spring-damped head motion
    const cam = g.world.camera.getWorldPosition(new g.world.camera.position.constructor());
    let wantYaw = yaw;
    let wantPitch = -0.035 + Math.sin(A.t * 0.37) * 0.012;
    if (A.gaze) {
      const [x, y, z] = A.gaze;
      wantYaw = Math.atan2(-(x - cam.x), -(z - cam.z));
      wantPitch = Math.atan2(y - cam.y, Math.hypot(x - cam.x, z - cam.z)) + A.gazePitch;
    } else if (dir) {
      wantYaw = Math.atan2(-dir[0], -dir[1]);
    }
    wantYaw += Math.sin(A.t * 0.23) * 0.02; // tiny idle drift so it never feels robotic
    let err = wantYaw - yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const w = 2.1;
    A.yawVel += (err * w * w - 2 * w * A.yawVel) * dt;
    pl.yaw += A.yawVel * dt;
    const pe = wantPitch - pl.pitch;
    A.pitchVel += (pe * w * w - 2 * w * A.pitchVel) * dt;
    pl.pitch += A.pitchVel * dt;
    const G = g.G;
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      speed: G.playerSpeed,
      steps: G.steps,
      bell: G.bellStrikeAt,
      disc: G.discovered.size,
      comp: G.completed.size,
      dusk: G.dusk,
      tod: G.tod,
      walking: !A.done,
    };
  };
});

let frame = 0;
const events = [];
const step = async (n = 1) => {
  for (let i = 0; i < n && frame < maxFrames; i++) {
    const st = await page.evaluate((dt) => window.__autoStep(dt), 1 / FPS);
    if (frame === resumeAt && resumeAt > 0) await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.clock.runFor(1000 / FPS);
    if (!process.env.DRY && frame >= resumeAt) await page.screenshot({ path: `${out}/${String(frame).padStart(5, '0')}.png`, animations: 'allow' });
    events.push({ f: frame, t: frame / FPS, ...st });
    frame++;
  }
};
const sec = (s) => Math.round(s * FPS);
const walk = async (path, { look = 1.6, gaze = null, max = 30 } = {}) => {
  await page.evaluate(([path, look]) => window.__walk(path, look), [path, look]);
  await page.evaluate(([g]) => window.__gaze(g), [gaze]);
  for (let i = 0; i < sec(max) && frame < maxFrames; i++) {
    await step(1);
    const last = events[events.length - 1];
    if (!last.walking && last.speed < 0.08) break;
  }
};
const mark = (m) => console.log(m, (frame / FPS).toFixed(1) + 's');
const gaze = (target, bias = 0) => page.evaluate(([t, b]) => window.__gaze(t, b), [target, bias]);
const press = async (code) => {
  await page.keyboard.down(code);
  await step(2);
  await page.keyboard.up(code);
};

// ------------------------------------------------------------------ script
// intro card over the slowly orbiting overview
await step(sec(3.8));
// a DOM click: Playwright's actionability checks wait on rendered frames, which a paused clock never produces
await page.evaluate(() => document.getElementById('enter-btn').click());
events.push({ f: frame, t: frame / FPS, mark: 'enter' });
await step(sec(3.0));
// stroll through the moon gate toward the south shore, glancing at the blossom tree
await walk([[0, 17.2], [0.25, 15.4], [0, 13.6], [0, 12.2], [-0.2, 10.6], [-0.9, 8.6], [-1.8, 6.6], [-2.6, 5.5]]);
// the moon bridge and its full-circle reflection
mark('the moon bridge a');
await gaze([-6.68, 0.2, -4.3]);
await step(sec(2.6));
await gaze([-1.2, 2.0, -4.3]);
await step(sec(1.6));
// over the zig-zag bridge to the pavilion
mark('over the zig-zag ');
await walk([[-2.6, 5.5], [-1.1, 5.0], [0.2, 4.6], [0.35, 4.0], [1.0, 2.45], [-1.1, 0.95], [1.3, -0.6], [0.15, -1.95], [-0.45, -3.0]], { look: 1.1 });
// strike the bronze bell twice for the harmony
mark('strike the bronze');
await gaze([-1.2, 2.6, -4.3], 0.05);
await step(sec(0.8));
await press('KeyE');
await step(sec(1.7));
await press('KeyE');
await step(sec(2.2));
// out across the moon bridge, glancing at the cascade from the crest
mark('out across the mo');
await walk([[-0.45, -3.0], [-2.3, -4.3], [-4.1, -4.3], [-6.7, -4.3], [-9.0, -4.3], [-10.4, -4.0]], {
  gaze: null,
});
// round the west shore to the moon-viewing spot as dusk gathers
mark('round the west sh');
await walk([[-10.4, -4.0], [-11.7, -2.2], [-11.4, 0.2], [-9.7, 2.3], [-7.7, 3.4], [-6.6, 3.6]]);
// night falls over the full moon bridge; stars, lanterns and fireflies
mark('night falls');
await gaze([-6.68, 0.1, -4.3]);
await step(sec(5.0));
await gaze([-2.2, 1.6, -4.6]);
await step(sec(4.0));
await gaze([-6.68, 0.25, -4.3]);
const remaining = Math.max(0, 60 * FPS - frame);
await step(remaining);

fs.writeFileSync(`${out}/../events.json`, JSON.stringify(events));
console.log('frames', frame, 'seconds', (frame / FPS).toFixed(1), 'errors', logs);
await browser.close();
