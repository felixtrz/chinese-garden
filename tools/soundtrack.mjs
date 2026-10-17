// Offline soundtrack for the preview video, rendered with the same procedural
// recipes the garden uses live (WebAudio OfflineAudioContext in headless Chromium),
// driven by the per-frame event log from tools/video2.mjs so every footstep, bell
// and chime lands on the exact frame.
// Usage: node tools/soundtrack.mjs <events.json> <out.wav> [seconds]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [eventsPath, outPath, secondsArg] = process.argv.slice(2);
const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const seconds = +(secondsArg || 60);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const b64 = await page.evaluate(
  async ({ events, seconds }) => {
    const SR = 48000;
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
    let seed = 12345;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const noise = (sec, brown) => {
      const len = Math.floor(SR * sec);
      const b = ctx.createBuffer(1, len, SR);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const r = rnd() * 2 - 1;
        if (brown) {
          last = (last + 0.02 * r) / 1.02;
          d[i] = last * 3.5;
        } else d[i] = r;
      }
      return b;
    };
    const white = noise(4, false);
    const brown = noise(6, true);
    const impulse = (() => {
      const len = Math.floor(SR * 3.2);
      const b = ctx.createBuffer(2, len, SR);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      return b;
    })();

    // master chain
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, 0);
    master.gain.linearRampToValueAtTime(0.95, 0.8);
    master.gain.setValueAtTime(0.95, seconds - 1.6);
    master.gain.linearRampToValueAtTime(0, seconds - 0.05);
    master.connect(comp);
    const verb = ctx.createConvolver();
    verb.buffer = impulse;
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.38;
    verb.connect(verbGain).connect(master);
    const music = ctx.createGain();
    music.gain.value = 0.24;
    music.connect(master);
    music.connect(verb);
    const sfx = ctx.createGain();
    sfx.gain.value = 0.55;
    sfx.connect(master);
    sfx.connect(verb);

    const at = (t) => {
      // interpolate event state at time t
      let i = 0;
      while (i < events.length - 1 && (events[i + 1].t ?? 0) <= t) i++;
      return events[i];
    };
    const frames = events.filter((e) => e.x !== undefined);

    // ---- ambient beds with automation from the walk
    const bed = (buffer, filterType, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      if (q) f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(master);
      src.start(0);
      return { g, f };
    };
    const water = bed(brown, 'lowpass', 1050);
    const wind = bed(white, 'bandpass', 650, 0.7);
    const cascade = [-4.75, -7.25];
    for (let t = 0; t < seconds; t += 0.25) {
      const e = frames.find((f) => f.t >= t) || frames[frames.length - 1];
      const dc = Math.hypot(e.x - cascade[0], e.z - cascade[1]);
      const pondNear = Math.max(0, 1 - Math.hypot(e.x, e.z + 3) / 14);
      water.g.gain.linearRampToValueAtTime(0.03 + pondNear * 0.03 + Math.max(0, 1 - dc / 10) * 0.28, t);
      wind.g.gain.linearRampToValueAtTime(0.012 + Math.max(0, Math.sin(t * 0.21)) * 0.012, t);
      wind.f.frequency.linearRampToValueAtTime(580 + Math.sin(t * 0.17) * 200, t);
    }

    // ---- soft drone pad for warmth (D / A)
    for (const [f, a] of [
      [73.42, 0.035],
      [110.0, 0.022],
      [146.83, 0.012],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 1.004;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(a, 4);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + rnd() * 0.05;
      const lg = ctx.createGain();
      lg.gain.value = a * 0.4;
      lfo.connect(lg).connect(g.gain);
      o.connect(g);
      o2.connect(g);
      g.connect(music);
      o.start(0);
      o2.start(0);
      lfo.start(0);
    }

    // ---- zither plucks (pentatonic D), sparser and lower at night
    const PENTA = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0];
    const pluck = (freq, when, vel = 1, pan = 0) => {
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(freq * 8, when);
      f.frequency.exponentialRampToValueAtTime(freq * 1.5, when + 1.2);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.16 * vel, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0008, when + 2.8);
      for (const [mul, type, amp] of [
        [1, 'triangle', 1],
        [2, 'sine', 0.35],
        [3.01, 'sine', 0.12],
      ]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq * mul * 1.004, when);
        o.frequency.exponentialRampToValueAtTime(freq * mul, when + 0.08);
        const og = ctx.createGain();
        og.gain.value = amp;
        o.connect(og).connect(f);
        o.start(when);
        o.stop(when + 2.9);
      }
      f.connect(g).connect(p).connect(music);
    };
    // opening phrase over the title card
    [3, 4, 5, 7].forEach((n, i) => pluck(PENTA[n], 0.6 + i * 0.42, 0.75, -0.3 + i * 0.2));
    let tm = 3.4;
    while (tm < seconds - 3) {
      const night = at(tm).dusk ?? 0;
      const n = 3 + Math.floor(rnd() * 4);
      let idx = Math.floor(rnd() * 5);
      let w = tm;
      for (let i = 0; i < n; i++) {
        idx = Math.max(0, Math.min(PENTA.length - 1, idx + Math.floor(rnd() * 5) - 2));
        pluck(PENTA[idx] * (night > 0.55 ? 0.5 : 1), w, 0.55 + rnd() * 0.4, rnd() * 0.6 - 0.3);
        w += 0.38 + rnd() * 0.55;
      }
      tm = w + 3.5 + rnd() * 5;
    }
    // final cadence as dawn returns
    [5, 4, 2, 0].forEach((n, i) => pluck(PENTA[n] * 0.5, seconds - 5.2 + i * 0.55, 0.7, 0.2 - i * 0.12));

    // ---- birds by day, crickets by night
    let bt = 1.5;
    while (bt < seconds - 1) {
      const dusk = at(bt).dusk ?? 0;
      if (dusk < 0.5) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const p = ctx.createStereoPanner();
        p.pan.value = rnd() * 1.6 - 0.8;
        g.gain.value = 0;
        o.connect(g).connect(p).connect(sfx);
        const base = 2600 + rnd() * 1400;
        let t = bt;
        const notes = 2 + Math.floor(rnd() * 4);
        for (let i = 0; i < notes; i++) {
          const d = 0.06 + rnd() * 0.08;
          o.frequency.setValueAtTime(base * (0.9 + rnd() * 0.3), t);
          o.frequency.exponentialRampToValueAtTime(base * (1.1 + rnd() * 0.4), t + d);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.03, t + 0.01);
          g.gain.linearRampToValueAtTime(0, t + d);
          t += d + 0.04 + rnd() * 0.08;
        }
        o.start(bt);
        o.stop(t + 0.1);
      }
      bt += 2.5 + rnd() * 5;
    }
    let ct = 0;
    while (ct < seconds - 0.5) {
      if ((at(ct).dusk ?? 0) > 0.6) {
        const o = ctx.createOscillator();
        o.frequency.value = 4200 + rnd() * 500;
        const g = ctx.createGain();
        g.gain.value = 0;
        const p = ctx.createStereoPanner();
        p.pan.value = rnd() * 1.4 - 0.7;
        for (let i = 0; i < 3; i++) {
          const t0 = ct + i * 0.06;
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.011, t0 + 0.012);
          g.gain.linearRampToValueAtTime(0, t0 + 0.04);
        }
        o.connect(g).connect(p).connect(sfx);
        o.start(ct);
        o.stop(ct + 0.25);
        ct += 0.22 + rnd() * 0.7;
      } else ct += 0.5;
    }

    // ---- footsteps on the exact footfall frames
    const footstep = (when, stone, side) => {
      const s = ctx.createBufferSource();
      s.buffer = white;
      const f = ctx.createBiquadFilter();
      f.type = stone ? 'bandpass' : 'lowpass';
      f.frequency.value = stone ? 1400 + rnd() * 400 : 520 + rnd() * 220;
      f.Q.value = stone ? 1.2 : 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(stone ? 0.085 : 0.06, when + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, when + (stone ? 0.1 : 0.16));
      const p = ctx.createStereoPanner();
      p.pan.value = side ? 0.12 : -0.12;
      s.connect(f).connect(g).connect(p).connect(master);
      s.start(when, rnd() * 3, 0.2);
      // a soft low thump for body
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(stone ? 140 : 90, when);
      o.frequency.exponentialRampToValueAtTime(50, when + 0.08);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, when);
      og.gain.linearRampToValueAtTime(0.05, when + 0.005);
      og.gain.exponentialRampToValueAtTime(0.001, when + 0.1);
      o.connect(og).connect(master);
      o.start(when);
      o.stop(when + 0.12);
    };
    let side = 0;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].steps > frames[i - 1].steps) {
        side ^= 1;
        footstep(frames[i].t, frames[i].y > 0.25, side);
      }
    }

    // ---- bell (struck ~0.48 s after the key, as in the live garden), chimes
    const bell = (when, gain, ratio = 1) => {
      for (const [m, a, d] of [
        [1, 0.25, 5],
        [2.76, 0.12, 2.8],
        [5.4, 0.07, 1.5],
        [8.93, 0.04, 0.9],
      ]) {
        const o = ctx.createOscillator();
        o.frequency.value = 880 * ratio * m * 0.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(a * gain, when + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0005, when + d);
        o.connect(g).connect(sfx);
        o.start(when);
        o.stop(when + d + 0.1);
      }
    };
    const chime = (when) => [4, 5, 7, 8].forEach((n, i) => pluck(PENTA[n], when + i * 0.14, 0.85, -0.3 + i * 0.2));
    let lastBell = null;
    let bells = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const e = frames[i];
      if (lastBell === null) lastBell = a.bell;
      if (e.bell !== lastBell) {
        bell(e.t + 0.48, 1);
        if (bells > 0) bell(e.t + 0.52, 0.8, 1.5);
        bells++;
        lastBell = e.bell;
      }
      if (e.disc > a.disc) chime(e.t);
      if (e.comp > a.comp) chime(e.t + 2.4);
    }
    const enter = events.find((e) => e.mark === 'enter');
    if (enter) [2, 4, 6].forEach((n, i) => pluck(PENTA[n], enter.t + i * 0.12, 0.6, 0));

    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const pcm = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) {
      pcm[i * 2] = Math.max(-1, Math.min(1, L[i])) * 32767;
      pcm[i * 2 + 1] = Math.max(-1, Math.min(1, R[i])) * 32767;
    }
    let bin = '';
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  { events, seconds },
);
await browser.close();
const data = Buffer.from(b64, 'base64');
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(48000, 24);
header.writeUInt32LE(48000 * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
fs.writeFileSync(outPath, Buffer.concat([header, data]));
console.log('wrote', outPath, (data.length / 1e6).toFixed(1), 'MB');
