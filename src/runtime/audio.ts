/**
 * Procedural ambience: water, wind in bamboo, birds, a sparse pentatonic
 * zither line, footsteps and interaction sounds. No audio files needed.
 */
const PENTA = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0];

export class GardenAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private waterGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private nextBird = 0;
  private nextPhrase = 0;
  private nextCricket = 0;
  private stepSide = 0;
  muted = false;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp);
    // reverb-ish space
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.8);
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.35;
    verb.connect(verbGain).connect(this.master);

    const noise = this.noiseBuffer(4);
    // water bed (brown noise, low-passed)
    const w = ctx.createBufferSource();
    w.buffer = noise.brown;
    w.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 1100;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0.05;
    w.connect(wf).connect(this.waterGain).connect(this.master);
    w.start();
    // wind (pink-ish noise band-passed, slowly modulated)
    const wi = ctx.createBufferSource();
    wi.buffer = noise.white;
    wi.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.018;
    wi.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wi.start();

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.22;
    this.musicGain.connect(this.master);
    this.musicGain.connect(verb);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(this.master);
    this.sfxGain.connect(verb);
    this.nextBird = ctx.currentTime + 2;
    this.nextPhrase = ctx.currentTime + 1.5;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.2);
  }

  private noiseBuffer(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = white.getChannelData(0);
    const bd = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      wd[i] = r;
      last = (last + 0.02 * r) / 1.02;
      bd[i] = last * 3.5;
    }
    return { white, brown };
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  private pluck(freq: number, when: number, vel = 1, pan = 0) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 8, when);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, when + 1.2);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.16 * vel, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 2.6);
    for (const [mul, type, amp] of [
      [1, 'triangle', 1],
      [2, 'sine', 0.35],
      [3.01, 'sine', 0.12],
    ] as [number, OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq * mul * 1.004, when);
      o.frequency.exponentialRampToValueAtTime(freq * mul, when + 0.08);
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(f);
      o.start(when);
      o.stop(when + 2.7);
    }
    f.connect(g).connect(p).connect(this.musicGain);
  }

  private bird(when: number) {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    p.connect(this.sfxGain);
    g.connect(p);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.connect(g);
    const base = 2600 + Math.random() * 1400;
    const notes = 2 + Math.floor(Math.random() * 4);
    let t = when;
    for (let i = 0; i < notes; i++) {
      const dur = 0.06 + Math.random() * 0.08;
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.1 + Math.random() * 0.4), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + dur);
      t += dur + 0.04 + Math.random() * 0.08;
    }
    o.start(when);
    o.stop(t + 0.1);
  }

  private cricket(when: number, pan: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.value = 4200 + Math.random() * 500;
    const g = ctx.createGain();
    g.gain.value = 0;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    for (let i = 0; i < 3; i++) {
      const t0 = when + i * 0.06;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.012, t0 + 0.012);
      g.gain.linearRampToValueAtTime(0, t0 + 0.04);
    }
    o.connect(g).connect(p).connect(this.sfxGain);
    o.start(when);
    o.stop(when + 0.25);
  }

  bell(gain = 1, ratio = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const f0 = 880 * ratio;
    for (const [m, a, d] of [
      [1, 0.25, 4.5],
      [2.76, 0.12, 2.6],
      [5.4, 0.07, 1.4],
      [8.93, 0.04, 0.8],
    ]) {
      const o = ctx.createOscillator();
      o.frequency.value = f0 * m;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a * gain, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0005, t + d);
      o.connect(g).connect(this.sfxGain);
      o.start(t);
      o.stop(t + d + 0.1);
    }
  }

  gust() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuffer(4).white;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1400, t + 1.2);
    f.frequency.linearRampToValueAtTime(700, t + 3.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 1.0);
    g.gain.linearRampToValueAtTime(0, t + 3.9);
    s.connect(f).connect(g).connect(this.sfxGain);
    s.start(t);
  }

  chime() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [4, 5, 7, 8].forEach((n, i) => this.pluck(PENTA[n], t + i * 0.14, 0.9, -0.3 + i * 0.2));
  }

  splash() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer(0.3).white;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900 + Math.random() * 1200;
      const g = ctx.createGain();
      const w = t + i * 0.12 + Math.random() * 0.1;
      g.gain.setValueAtTime(0, w);
      g.gain.linearRampToValueAtTime(0.12, w + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, w + 0.25);
      s.connect(f).connect(g).connect(this.sfxGain);
      s.start(w);
    }
  }

  footstep(onStone: boolean, side = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.stepSide = side;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.stepBuf ?? (this.stepBuf = this.noiseBuffer(0.15).white);
    const f = ctx.createBiquadFilter();
    f.type = onStone ? 'bandpass' : 'lowpass';
    f.frequency.value = onStone ? 1500 + Math.random() * 300 : 500 + Math.random() * 200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(onStone ? 0.07 : 0.05, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + (onStone ? 0.09 : 0.14));
    const p = ctx.createStereoPanner();
    p.pan.value = this.stepSide ? 0.12 : -0.12;
    s.connect(f).connect(g).connect(p).connect(this.master);
    s.start(t);
  }
  private stepBuf: AudioBuffer | null = null;

  /** Called every frame with proximity values in 0..1 and player speed. */
  update(cascadeNear: number, bambooNear: number, speed: number, onStone: boolean, dusk: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.waterGain.gain.setTargetAtTime(0.04 + cascadeNear * 0.32, t, 0.3);
    this.windGain.gain.setTargetAtTime(0.014 + bambooNear * 0.05 + Math.max(0, Math.sin(t * 0.13)) * 0.01, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(600 + Math.sin(t * 0.21) * 220 + bambooNear * 500, t, 0.5);
    if (t > this.nextBird) {
      if (dusk < 0.7) this.bird(t + 0.05);
      this.nextBird = t + 3 + Math.random() * 7 + dusk * 6;
    }
    if (t > this.nextPhrase) {
      const n = 3 + Math.floor(Math.random() * 4);
      let idx = Math.floor(Math.random() * 5);
      let w = t + 0.1;
      for (let i = 0; i < n; i++) {
        idx = Math.max(0, Math.min(PENTA.length - 1, idx + Math.floor(Math.random() * 5) - 2));
        this.pluck(PENTA[idx] * (dusk > 0.5 ? 0.5 : 1), w, 0.6 + Math.random() * 0.4, Math.random() * 0.6 - 0.3);
        w += 0.35 + Math.random() * 0.6;
      }
      this.nextPhrase = w + 5 + Math.random() * 8;
    }
    void speed;
    void onStone;
    // crickets after dark
    if (dusk > 0.6 && t > this.nextCricket) {
      this.cricket(t + 0.02, Math.random() * 1.4 - 0.7);
      this.nextCricket = t + 0.25 + Math.random() * 0.9;
    }
  }
}
