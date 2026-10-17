import {
  BAMBOO,
  GARDEN_RADIUS,
  MOON_BRIDGE,
  PAVILION_ROT,
  PINES,
  PLATFORM,
  PLUMS,
  POIS,
  ROCKERY,
  SCREEN_WALL,
  STONES,
  ZIGZAG,
  pathPolylines,
  pondPoint,
} from '../garden/layout.js';
import { G } from './state.js';
import type { ViewPlacement } from '../components/point-of-interest.js';

export interface HudCallbacks {
  onEnter: () => void;
  onEnterVR: () => void;
  onResume: () => void;
  onTime: (mode: 'cycle' | 'day' | 'dusk' | 'night') => void;
  onMute: (muted: boolean) => void;
  onSensitivity: (v: number) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

const MAP_R = GARDEN_RADIUS + 1;

export class Hud {
  private root = document.getElementById('ui-root')!;
  private intro!: HTMLDivElement;
  private enterBtn!: HTMLButtonElement;
  private vrBtn!: HTMLButtonElement;
  private loading!: HTMLDivElement;
  private hud!: HTMLDivElement;
  private dots: HTMLElement[] = [];
  private subLabel!: HTMLDivElement;
  private promptEl!: HTMLDivElement;
  private promptText!: HTMLSpanElement;
  private toastEl!: HTMLDivElement;
  private noteEl!: HTMLDivElement;
  private hints!: HTMLDivElement;
  private cross!: HTMLDivElement;
  private pauseEl!: HTMLDivElement;
  private viewsEl!: HTMLDivElement;
  private map!: HTMLCanvasElement;
  private mapBase!: HTMLCanvasElement;
  private toastTimer = 0;
  private noteTimer = 0;
  private hintTimer = 0;
  private timeBtns: HTMLButtonElement[] = [];
  private soundBtns: HTMLButtonElement[] = [];

  constructor(private cb: HudCallbacks) {
    this.buildIntro();
    this.buildHud();
    this.buildPause();
    this.drawMapBase();
  }

  private buildIntro() {
    this.intro = el('div', { id: 'intro' });
    this.intro.innerHTML = `
      <div class="card paper">
        <div class="vtitle">留云园<span class="seal">游园</span></div>
        <div>
          <h1>The Garden of<br/>Lingering Clouds</h1>
          <p class="tag">Wander a classical Chinese garden — moon bridge, pavilion, rockery and bamboo.</p>
          <div class="rule"></div>
          <div class="controls desk-only">
            <span class="keys"><span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span></span><span>Walk</span>
            <span class="keys"><span class="key">Mouse</span></span><span>Look around</span>
            <span class="keys"><span class="key">Shift</span></span><span>Stroll faster</span>
            <span class="keys"><span class="key">E</span></span><span>Interact</span>
            <span class="keys"><span class="key">T</span></span><span>Time of day</span>
            <span class="keys"><span class="key">M</span></span><span>Sound on / off</span>
            <span class="keys"><span class="key">Esc</span></span><span>Pause &amp; settings</span>
          </div>
          <div class="controls touch-only">
            <span class="keys"><span class="key">◐</span></span><span>Left thumb — move</span>
            <span class="keys"><span class="key">✋</span></span><span>Right thumb — look</span>
            <span class="keys"><span class="key">E</span></span><span>Tap the red seal button</span>
            <span class="keys"><span class="key">⟲</span></span><span>Best held sideways</span>
          </div>
          <div class="actions">
            <button class="btn" id="enter-btn" disabled><span class="zh">入园</span>Enter the garden</button>
            <button class="btn ghost" id="vr-btn" style="display:none"><span class="zh">沉浸</span>Enter VR</button>
            <div class="loading" id="loading"><div class="bar"><i></i></div><span>Preparing the garden…</span></div>
          </div>
          <div class="foot">Find all seven scenic views. Best with sound on.</div>
        </div>
      </div>`;
    this.root.appendChild(this.intro);
    this.enterBtn = this.intro.querySelector('#enter-btn')!;
    this.vrBtn = this.intro.querySelector('#vr-btn')!;
    this.loading = this.intro.querySelector('#loading')!;
    this.enterBtn.addEventListener('click', () => this.cb.onEnter());
    this.vrBtn.addEventListener('click', () => this.cb.onEnterVR());
  }

  private buildHud() {
    this.hud = el('div', { id: 'hud' });
    const brand = el('div', { id: 'brand', class: 'paper' });
    brand.innerHTML = `<span class="seal">留云</span><div><div class="name">留云园</div><div class="sub">Views <b>0</b>/${POIS.length} · Rituals <b>0</b>/${POIS.length}</div><div class="dots"></div></div>`;
    const dotsWrap = brand.querySelector('.dots')!;
    for (let i = 0; i < POIS.length; i++) {
      const d = el('i');
      dotsWrap.appendChild(d);
      this.dots.push(d);
    }
    this.subLabel = brand.querySelector('.sub') as HTMLDivElement;
    const mapWrap = el('div', { id: 'minimap-wrap', class: 'paper' });
    this.map = el('canvas', { id: 'minimap', width: '472', height: '472' });
    mapWrap.appendChild(this.map);
    mapWrap.appendChild(el('div', { class: 'north' }, 'N'));
    const legend = el('div', { id: 'map-legend', class: 'paper' }, '<span><i class="lg-ring"></i>unfound</span><span><i class="lg-found"></i>found</span><span><i class="lg-done"></i>ritual done</span>');
    this.promptEl = el('div', { id: 'prompt', class: 'paper' });
    this.promptEl.innerHTML = `<span class="key">E</span><span class="txt"></span>`;
    this.promptText = this.promptEl.querySelector('.txt')!;
    this.toastEl = el('div', { id: 'toast', class: 'paper' });
    this.noteEl = el('div', { id: 'note' });
    this.hints = el('div', { id: 'hints', class: 'paper' });
    this.hints.innerHTML = `<span><span class="key">WASD</span>walk</span><span><span class="key">Shift</span>faster</span><span><span class="key">T</span><span id="hint-time">time</span></span><span><span class="key">M</span>sound</span><span><span class="key">Esc</span>menu</span>`;
    this.cross = el('div', { id: 'cross' });
    this.hud.append(brand, mapWrap, legend, this.promptEl, this.toastEl, this.noteEl, this.hints, this.cross);
    this.root.appendChild(this.hud);
  }

  private buildPause() {
    this.pauseEl = el('div', { id: 'pause' });
    this.pauseEl.innerHTML = `
      <div class="card paper">
        <h2><span class="zh">小憩</span>Paused</h2>
        <div class="row"><span>Time of day</span><div class="seg" id="seg-time"><button data-v="cycle" class="on">Cycle</button><button data-v="day">Day</button><button data-v="dusk">Dusk</button><button data-v="night">Night</button></div></div>
        <div class="row"><span>Sound</span><div class="seg" id="seg-sound"><button data-v="1" class="on">On</button><button data-v="0">Off</button></div></div>
        <div class="row"><span>Look sensitivity</span><input type="range" id="sens" min="0.3" max="2" step="0.05" value="1"/></div>
        <div class="views-title">Scenic views</div><div class="views" id="views"></div>
        <div class="actions"><button class="btn" id="resume-btn"><span class="zh">续游</span>Resume</button></div>
      </div>`;
    this.root.appendChild(this.pauseEl);
    this.viewsEl = this.pauseEl.querySelector('#views')!;
    this.timeBtns = Array.from(this.pauseEl.querySelectorAll('#seg-time button'));
    this.soundBtns = Array.from(this.pauseEl.querySelectorAll('#seg-sound button'));
    this.timeBtns.forEach((b) => b.addEventListener('click', () => this.cb.onTime(b.dataset.v as 'cycle' | 'day' | 'dusk' | 'night')));
    this.soundBtns.forEach((b) => b.addEventListener('click', () => this.cb.onMute(b.dataset.v === '0')));
    (this.pauseEl.querySelector('#sens') as HTMLInputElement).addEventListener('input', (e) =>
      this.cb.onSensitivity(parseFloat((e.target as HTMLInputElement).value)),
    );
    this.pauseEl.querySelector('#resume-btn')!.addEventListener('click', () => this.cb.onResume());
  }

  setReady() {
    this.enterBtn.disabled = false;
    this.loading.style.display = 'none';
  }

  showVrButton() {
    this.vrBtn.style.display = '';
  }

  hideIntro() {
    this.intro.classList.add('hidden');
    this.hud.classList.add('on');
    this.hints.classList.remove('dim');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hints.classList.add('dim'), 9000);
  }

  setHudVisible(v: boolean) {
    this.hud.classList.toggle('on', v);
  }

  setPaused(p: boolean) {
    this.pauseEl.classList.toggle('on', p);
    if (p) this.renderViews();
  }

  setPointerLocked(v: boolean) {
    this.cross.classList.toggle('on', v);
  }

  syncSettings() {
    const ht = document.getElementById('hint-time');
    if (ht) ht.textContent = 'time';
    this.timeBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === G.todMode));
    this.soundBtns.forEach((b) => b.classList.toggle('on', (b.dataset.v === '0') === G.muted));
  }

  showHints() {
    this.hints.classList.remove('dim');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hints.classList.add('dim'), 6000);
  }

  private renderViews() {
    this.viewsEl.innerHTML = POIS.map((p) => {
      const on = G.discovered.has(p.id);
      const done = G.completed.has(p.id);
      const sub = !on ? `<em>${p.hint ?? ''}</em>` : done ? '<em>Ritual completed</em>' : `<em>${document.body.classList.contains('touch') ? 'Tap' : 'Press E'} · ${p.action ?? ''}</em>`;
      return `<div class="${on ? 'on' : ''}"><b class="${on ? '' : 'unk'}">${on ? p.zh : '未访'}</b><span>${on ? p.en : 'Not yet found'}${sub}</span><i>${done ? '✓' : ''}</i></div>`;
    }).join('');
    this.syncSettings();
  }

  updateProgress() {
    const n = G.discovered.size;
    const r = G.completed.size;
    this.subLabel.innerHTML = `Views <b>${n}</b>/${POIS.length} · Rituals <b>${r}</b>/${POIS.length}`;
    POIS.forEach((p, i) => {
      this.dots[i].classList.toggle('found', G.discovered.has(p.id));
      this.dots[i].classList.toggle('on', G.completed.has(p.id));
    });
  }

  toast(kicker: string, zh: string, en: string, verse: string, ms = 5000) {
    this.toastEl.innerHTML = `<div class="zh">${zh}</div><div><div class="kicker">${kicker}</div><div class="en">${en}</div><div class="verse">${verse}</div></div>`;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  private toastPoi: string | null = null;
  toastFor(id: string | null) {
    this.toastPoi = id;
  }
  dropToastIfNot(id: string) {
    if (this.toastPoi && this.toastPoi !== id && this.toastEl.classList.contains('on') && !this.toastEl.classList.contains('final')) {
      this.toastEl.classList.remove('on');
      this.toastPoi = null;
    }
  }
  pulseMap() {
    const w = document.getElementById('minimap-wrap');
    if (!w) return;
    w.classList.remove('pulse');
    void w.offsetWidth;
    w.classList.add('pulse');
  }

  ritual(poi: { zh: string; en: string }, n: number, total: number) {
    this.toastPoi = null;
    this.toast(`Ritual complete · ${n} of ${total}`, poi.zh, poi.en, n < total ? `A lantern on the pavilion now glows for this view. ${total - n} remain.` : 'The last ritual — the garden begins to awaken…', 4200);
  }

  finale() {
    this.toastEl.innerHTML = `<div class="zh">圆满</div><div><div class="kicker">All seven rituals complete</div><div class="en">The garden is complete</div><div class="verse">Night falls, every lantern is lit, and lotus lights drift across the pond. Linger — press T when you want the day to turn again.</div></div><div class="stamp">留云<br/>园主</div>`;
    this.toastEl.classList.add('on', 'final');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on', 'final'), 11000);
  }

  note(text: string, ms = 3200) {
    this.noteEl.textContent = text;
    this.noteEl.classList.add('on');
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => this.noteEl.classList.remove('on'), ms);
  }

  flash() {
    let f = document.getElementById('flash');
    if (!f) {
      f = el('div', { id: 'flash' });
      this.root.appendChild(f);
    }
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  setPrompt(text: string | null) {
    if (text) this.promptText.textContent = text;
    this.promptEl.classList.toggle('on', !!text);
  }

  // ------------------------------------------------------------------ minimap
  private w2m(x: number, z: number, size: number): [number, number] {
    const s = size / 2 / MAP_R;
    return [size / 2 + x * s, size / 2 + z * s];
  }

  private drawMapBase() {
    const size = 472;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
    g.addColorStop(0, '#f6f1e4');
    g.addColorStop(1, '#e6dcc6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const P = (x: number, z: number) => this.w2m(x, z, size);
    // lawn
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (size / 2) * (GARDEN_RADIUS / MAP_R), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(168, 180, 112, 0.35)';
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(70, 76, 78, 0.65)';
    ctx.stroke();
    // pond
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const [x, z] = pondPoint((i / 96) * Math.PI * 2, 0);
      const [mx, my] = P(x, z);
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.fillStyle = 'rgba(111, 148, 140, 0.75)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(150, 128, 90, 0.8)';
    ctx.stroke();
    // paths
    ctx.strokeStyle = 'rgba(190, 165, 120, 0.9)';
    ctx.lineWidth = 5.5;
    ctx.setLineDash([3, 3]);
    for (const line of pathPolylines()) {
      ctx.beginPath();
      line.forEach(([x, z], i) => {
        const [mx, my] = P(x, z);
        if (i === 0) ctx.moveTo(mx, my);
        else ctx.lineTo(mx, my);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // bridges
    ctx.strokeStyle = '#c9b48c';
    ctx.lineWidth = 9;
    ctx.beginPath();
    let [ax, ay] = P(MOON_BRIDGE.start[0], MOON_BRIDGE.start[1] + 0.3);
    ctx.moveTo(ax, ay);
    [ax, ay] = P(MOON_BRIDGE.end[0], MOON_BRIDGE.end[1]);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.beginPath();
    ZIGZAG.forEach(([x, z], i) => {
      const [mx, my] = P(x, z);
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    });
    ctx.stroke();
    // pavilion
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const a = PAVILION_ROT + (k * Math.PI) / 3;
      const [mx, my] = P(PLATFORM.x + Math.sin(a) * PLATFORM.r, PLATFORM.z + Math.cos(a) * PLATFORM.r);
      if (k === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.fillStyle = '#d8c8a6';
    ctx.fill();
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const a = PAVILION_ROT + (k * Math.PI) / 3;
      const [mx, my] = P(PLATFORM.x + Math.sin(a) * 2.3, PLATFORM.z + Math.cos(a) * 2.3);
      if (k === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.fillStyle = '#3f6a55';
    ctx.fill();
    // screen wall
    ctx.strokeStyle = 'rgba(70,76,78,0.8)';
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    let [sx, sy] = P(-SCREEN_WALL.halfLen, SCREEN_WALL.z);
    ctx.moveTo(sx, sy);
    [sx, sy] = P(-0.9, SCREEN_WALL.z);
    ctx.lineTo(sx, sy);
    [sx, sy] = P(0.9, SCREEN_WALL.z);
    ctx.moveTo(sx, sy);
    [sx, sy] = P(SCREEN_WALL.halfLen, SCREEN_WALL.z);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    // flora & rocks
    const dot = (x: number, z: number, r: number, col: string) => {
      const [mx, my] = P(x, z);
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    };
    for (const b of BAMBOO) dot(b.x, b.z, 9, 'rgba(120, 150, 70, 0.6)');
    for (const t of PINES) dot(t.x, t.z, 12, 'rgba(110, 140, 70, 0.75)');
    for (const t of PLUMS) dot(t.x, t.z, 11, 'rgba(225, 150, 170, 0.8)');
    for (const s of STONES) dot(s.x, s.z, 5, 'rgba(150, 135, 110, 0.9)');
    dot(ROCKERY.x - 0.4, ROCKERY.z - 0.5, 13, 'rgba(140, 125, 100, 0.85)');
    this.mapBase = c;
  }

  drawMap(px: number, pz: number, yaw: number, time: number, views: readonly ViewPlacement[]) {
    const ctx = this.map.getContext('2d')!;
    const size = this.map.width;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.mapBase, 0, 0);
    // POIs
    for (const v of views) {
      const p = v.def;
      const [mx, my] = this.w2m(v.x, v.z, size);
      const found = G.discovered.has(p.id);
      const done = G.completed.has(p.id);
      ctx.beginPath();
      if (found && !done) {
        ctx.fillStyle = '#f4efe3';
        ctx.fillRect(mx - 10, my - 10, 20, 20);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#b03a2a';
        ctx.strokeRect(mx - 10, my - 10, 20, 20);
        ctx.fillStyle = '#b03a2a';
        ctx.font = '15px "Garden Kai", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.zh[0], mx, my + 0.5);
      } else if (done) {
        ctx.fillStyle = '#b03a2a';
        ctx.fillRect(mx - 10, my - 10, 20, 20);
        ctx.fillStyle = '#f7e9dc';
        ctx.font = '15px "Garden Kai", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.zh[0], mx, my + 0.5);
      } else {
        const pulse = 10 + Math.sin(time * 3) * 2;
        ctx.arc(mx, my, pulse, 0, Math.PI * 2);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(176, 58, 42, 0.8)';
        ctx.stroke();
      }
    }
    // player
    const [mx, my] = this.w2m(px, pz, size);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-yaw);
    // view cone
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
    grad.addColorStop(0, 'rgba(42,40,36,0.28)');
    grad.addColorStop(1, 'rgba(42,40,36,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 70, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(11, 12);
    ctx.lineTo(0, 6);
    ctx.lineTo(-11, 12);
    ctx.closePath();
    ctx.fillStyle = '#2a2824';
    ctx.fill();
    ctx.strokeStyle = '#f4efe3';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }
}
