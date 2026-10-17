import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  BoxGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { CASCADE, MOON_CENTER, PLATFORM, PLUMS, POND, WATER_Y, pondField, pondScale } from '../garden/layout.js';
import { GardenEffects } from './effects.js';
import { groundHeight } from '../garden/terrain.js';
import { makeRandom, windUniforms } from '../garden/util.js';
import type { Env } from './environment.js';
import { CYCLE_SECONDS, G, TOD_TARGETS } from './state.js';

let env: Env | null = null;
export let effects: GardenEffects | null = null;
export let life: GardenLifeSystem | null = null;
export function setEnv(e: Env) {
  env = e;
}

const rand = makeRandom(2024);

interface Koi {
  root: Group;
  tail: Object3D;
  x: number;
  z: number;
  heading: number;
  speed: number;
  tx: number;
  tz: number;
  phase: number;
  depth: number;
}

function validWater(x: number, z: number): boolean {
  if (pondField(x, z) > 0.8) return false;
  if (Math.hypot(x - PLATFORM.x, z - PLATFORM.z) < PLATFORM.r + 0.4) return false;
  return true;
}

function pickTarget(k: Koi) {
  // most koi linger near the bridges where visitors stand
  const school = k.phase % 1 < 0.65;
  const hubs: [number, number][] = [
    [MOON_CENTER[0], MOON_CENTER[1] + 2.2],
    [MOON_CENTER[0], MOON_CENTER[1] - 1.8],
    [2.4, 0.6],
    [-2.0, 1.4],
  ];
  const hub = hubs[Math.floor(rand() * hubs.length)];
  for (let i = 0; i < 30; i++) {
    const x = school ? hub[0] + (rand() - 0.5) * 5 : POND.cx + (rand() - 0.5) * POND.rx * 2;
    const z = school ? hub[1] + (rand() - 0.5) * 3.5 : POND.cz + (rand() - 0.5) * POND.rz * 2;
    if (validWater(x, z)) {
      k.tx = x;
      k.tz = z;
      return;
    }
  }
}

function makeKoi(colors: string[]): Koi {
  const root = new Group();
  const body = new Mesh(new SphereGeometry(1, 8, 6), new MeshStandardMaterial({ color: colors[0], roughness: 0.5, flatShading: true }));
  body.scale.set(0.075, 0.05, 0.24);
  root.add(body);
  if (colors[1]) {
    const patch = new Mesh(new SphereGeometry(1, 6, 4), new MeshStandardMaterial({ color: colors[1], roughness: 0.5, flatShading: true }));
    patch.scale.set(0.06, 0.035, 0.11);
    patch.position.set(0, 0.022, 0.06);
    root.add(patch);
  }
  const tail = new Object3D();
  tail.position.z = -0.2;
  const fin = new Mesh(new ConeGeometry(0.07, 0.16, 4), new MeshStandardMaterial({ color: colors[0], roughness: 0.6, side: DoubleSide, flatShading: true }));
  fin.rotation.x = Math.PI / 2;
  fin.scale.set(1, 1, 0.25);
  fin.position.z = -0.06;
  tail.add(fin);
  root.add(tail);
  root.scale.setScalar(1.55 + rand() * 0.35);
  const k: Koi = { root, tail, x: 0, z: 0, heading: rand() * 6, speed: 0.3, tx: 0, tz: 0, phase: rand() * 10, depth: 0.09 + rand() * 0.08 };
  for (let i = 0; i < 50; i++) {
    const x = POND.cx + (rand() - 0.5) * POND.rx * 1.6;
    const z = POND.cz + (rand() - 0.5) * POND.rz * 1.6;
    if (validWater(x, z)) {
      k.x = x;
      k.z = z;
      break;
    }
  }
  pickTarget(k);
  return k;
}

interface Ripple {
  mesh: Mesh;
  age: number;
  life: number;
  size: number;
}

/**
 * Ambient life: koi, petals, ripples, fireflies, the day/night cycle and lantern glow.
 *
 * Everything it animates is either part of the single static garden scene asset or a pooled
 * effect mesh, so it keeps plain arrays of instances rather than ECS queries, and shares
 * state with PlayerSystem and the HUD through `G` (src/runtime/state.ts).
 */
export class GardenLifeSystem extends createSystem({}) {
  private koi: Koi[] = [];
  private ripples: Ripple[] = [];
  private rippleTimer = 0;
  private petals!: InstancedMesh;
  private petalState!: Float32Array;
  private petalGround!: Float32Array;
  private dummy = new Object3D();
  private fireflies!: Points;
  private fireMat!: ShaderMaterial;
  private fireBase!: Float32Array;
  private dragon: { g: Group; wings: Object3D[]; x: number; y: number; z: number; tx: number; ty: number; tz: number; wait: number }[] = [];
  private inited = false;
  private pellets: { m: Mesh; x: number; z: number; t: number; tx: number; tz: number; landed: boolean; active: boolean }[] = [];
  private lastFeed = -100;
  private pp = new Vector3();

  init() {}

  private throwPellets() {
    const [ox, oy, oz] = G.feedOrigin;
    for (const p of this.pellets) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 0.9;
      p.tx = G.feedPoint[0] + Math.cos(a) * r;
      p.tz = G.feedPoint[1] + Math.sin(a) * r;
      p.x = ox;
      p.z = oz;
      p.t = -rand() * 0.25;
      p.landed = false;
      p.active = true;
      p.m.visible = false;
      p.m.userData.oy = oy;
    }
  }

  private setup() {
    const scene = this.scene;
    const palettes = [
      ['#ff6418', '#fff7ec'],
      ['#fff7ec', '#ff4a12'],
      ['#ffb318'],
      ['#ff5a14'],
      ['#fff7ec', '#262626'],
      ['#ff7a1e', '#fff7ec'],
      ['#e8401a', '#fff2dc'],
      ['#ffc93a', '#fff7ec'],
      ['#ff6418'],
      ['#ff8a2a', '#fff7ec'],
      ['#fff7ec', '#ff6418'],
      ['#ff5a14', '#fff7ec'],
      ['#ffd24a'],
      ['#fff7ec', '#e8401a'],
    ];
    for (const p of palettes) {
      const k = makeKoi(p);
      scene.add(k.root);
      G.reflectSkip.push(k.root);
      this.koi.push(k);
    }
    const ringGeo = new RingGeometry(0.86, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 40; i++) {
      const mesh = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#f7fbf8', transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      G.reflectSkip.push(mesh);
      this.ripples.push({ mesh, age: 0, life: 1, size: 1 });
    }
    // plum petals
    const petalGeo = new PlaneGeometry(0.06, 0.045);
    const petalMat = new MeshStandardMaterial({ color: '#f2b8c6', side: DoubleSide, roughness: 0.8 });
    const N = 260;
    this.petals = new InstancedMesh(petalGeo, petalMat, N);
    this.petals.frustumCulled = false;
    this.petalState = new Float32Array(N * 6);
    this.petalGround = new Float32Array(N);
    for (let i = 0; i < N; i++) this.respawnPetal(i, true);
    scene.add(this.petals);
    // fireflies
    const F = 110;
    const pos = new Float32Array(F * 3);
    this.fireBase = new Float32Array(F * 4);
    for (let i = 0; i < F; i++) {
      let x = 0;
      let z = 0;
      for (let t = 0; t < 20; t++) {
        const a = rand() * Math.PI * 2;
        const r = 3 + rand() * 16;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        if (pondField(x, z) > 0.9) break;
      }
      this.fireBase[i * 4] = x;
      this.fireBase[i * 4 + 1] = Math.max(groundHeight(x, z), WATER_Y) + 0.4 + rand() * 1.6;
      this.fireBase[i * 4 + 2] = z;
      this.fireBase[i * 4 + 3] = rand() * 100;
    }
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(pos, 3));
    const seeds = new Float32Array(F);
    for (let i = 0; i < F; i++) seeds[i] = rand();
    fg.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    this.fireMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uScale: { value: window.innerHeight * 0.5 } },
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uScale; varying float vTw;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        vTw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 40.0);
        gl_PointSize = (0.09 * uScale) / -mv.z * (0.6 + vTw * 0.6); }`,
      fragmentShader: `uniform float uAlpha; varying float vTw;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(vec3(1.0, 0.86, 0.45) * (0.6 + a), a * a * uAlpha * vTw); }`,
    });
    this.fireflies = new Points(fg, this.fireMat);
    this.fireflies.frustumCulled = false;
    scene.add(this.fireflies);
    // dragonflies
    const bodyMat = new MeshStandardMaterial({ color: '#2f6f7a', roughness: 0.4, metalness: 0.3 });
    const wingMat = new MeshBasicMaterial({ color: '#e8f4f4', transparent: true, opacity: 0.45, side: DoubleSide, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const g = new Group();
      const body = new Mesh(new BoxGeometry(0.018, 0.018, 0.16), bodyMat);
      g.add(body);
      const wings: Object3D[] = [];
      for (const sx of [-1, 1])
        for (const zz of [0.02, -0.02]) {
          const w = new Mesh(new PlaneGeometry(0.12, 0.03), wingMat);
          w.position.set(sx * 0.06, 0.008, zz);
          w.rotation.x = -Math.PI / 2;
          g.add(w);
          wings.push(w);
        }
      g.scale.setScalar(1.3);
      scene.add(g);
      const x = (rand() - 0.5) * 12;
      const z = POND.cz + (rand() - 0.5) * 8;
      this.dragon.push({ g, wings, x, y: 0.6, z, tx: x, ty: 0.6, tz: z, wait: rand() * 2 });
    }
    const pelletGeo = new SphereGeometry(0.024, 6, 4);
    const pelletMat = new MeshStandardMaterial({ color: '#f0cf86', roughness: 0.7, flatShading: true });
    for (let i = 0; i < 18; i++) {
      const m = new Mesh(pelletGeo, pelletMat);
      m.visible = false;
      scene.add(m);
      G.reflectSkip.push(m);
      this.pellets.push({ m, x: 0, z: 0, t: 0, tx: 0, tz: 0, landed: false, active: false });
    }
    effects = new GardenEffects(scene);
    life = this;
    effects.setStriker(scene.getObjectByName('BellStriker') ?? null);
    this.inited = true;
  }

  private respawnPetal(i: number, initial: boolean) {
    const s = this.petalState;
    const tree = PLUMS[i % PLUMS.length];
    const a = rand() * Math.PI * 2;
    const r = rand() * 2.0;
    s[i * 6] = tree.x + Math.cos(a) * r;
    s[i * 6 + 2] = tree.z + Math.sin(a) * r;
    s[i * 6 + 1] = initial ? 0.2 + rand() * 3.2 : 2.6 + rand() * 1.0;
    s[i * 6 + 3] = rand() * 10; // phase
    s[i * 6 + 4] = 0.18 + rand() * 0.18; // fall speed
    s[i * 6 + 5] = 0; // resting timer
    if (this.petalGround) this.petalGround[i] = groundHeight(s[i * 6], s[i * 6 + 2]);
  }

  koiNear(x: number, z: number, r: number): number {
    return this.koi.filter((k) => Math.hypot(k.x - x, k.z - z) < r).length;
  }

  /** Celebration: scatter every petal high over the whole garden. */
  shower() {
    const ps = this.petalState;
    for (let i = 0; i < this.petals.count; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 12;
      ps[i * 6] = Math.cos(a) * r;
      ps[i * 6 + 2] = -2 + Math.sin(a) * r;
      ps[i * 6 + 1] = 3 + rand() * 5;
      ps[i * 6 + 5] = 0;
      this.petalGround[i] = groundHeight(ps[i * 6], ps[i * 6 + 2]);
    }
  }

  spawnRipple(x: number, z: number, size = 1, life = 2.2) {
    let best = this.ripples[0];
    for (const r of this.ripples) {
      if (!r.mesh.visible) {
        best = r;
        break;
      }
      if (r.age / r.life > best.age / best.life) best = r;
    }
    best.mesh.visible = true;
    best.mesh.position.set(x, WATER_Y + 0.012, z);
    best.age = 0;
    best.life = life;
    best.size = size;
  }

  update(delta: number, time: number) {
    if (!G.ready) return;
    if (!this.inited) this.setup();
    const dt = Math.min(delta, 0.05);
    G.time = time;
    windUniforms.uWindTime.value = time;
    // time of day
    // day-night cycle: loops every CYCLE_SECONDS; held modes ease forward to their time
    if (G.todRush >= 0) {
      const d = (G.todRush - G.tod + 1) % 1;
      if (d < 0.004) G.todRush = -1;
      else G.tod = (G.tod + Math.min(d, dt * 0.09)) % 1;
    } else if (G.todMode === 'cycle') {
      G.tod = (G.tod + dt / CYCLE_SECONDS) % 1;
    } else {
      const target = TOD_TARGETS[G.todMode];
      const d = (target - G.tod + 1) % 1;
      if (d > 0.002) G.tod = (G.tod + Math.min(d, dt * 0.09)) % 1;
    }
    env?.apply(G.tod);
    if (env) {
      env.waterMat.uniforms.uTime.value = time;
      env.cascadeMat.uniforms.uTime.value = time;
    }

    effects?.update(dt, time);
    if (G.feedUntil !== this.lastFeed && G.feedUntil > time) {
      this.lastFeed = G.feedUntil;
      this.throwPellets();
    }
    for (const p of this.pellets) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t < 0) continue;
      p.m.visible = true;
      const dur = 0.65;
      if (!p.landed) {
        const u = Math.min(1, p.t / dur);
        const oy = p.m.userData.oy as number;
        const x = G.feedOrigin[0] + (p.tx - G.feedOrigin[0]) * u;
        const z = G.feedOrigin[2] + (p.tz - G.feedOrigin[2]) * u;
        const y = oy + (WATER_Y - oy) * u + Math.sin(u * Math.PI) * 0.45;
        p.m.position.set(x, y, z);
        if (u >= 1) {
          p.landed = true;
          p.x = p.tx;
          p.z = p.tz;
          this.spawnRipple(p.x, p.z, 0.45, 1.4);
          effects?.splash(p.x, p.z, 3, 0.6);
        }
      } else {
        p.m.position.set(p.x, WATER_Y + 0.01 + Math.sin(time * 3 + p.tx * 9) * 0.004, p.z);
        for (const k of this.koi) {
          if (Math.hypot(k.x - p.x, k.z - p.z) < 0.28) {
            p.active = false;
            p.m.visible = false;
            this.spawnRipple(p.x, p.z, 0.3, 0.8);
            break;
          }
        }
        if (p.t > 16) {
          p.active = false;
          p.m.visible = false;
        }
      }
    }

    // koi
    const feeding = time < G.feedUntil;
    // after feeding, a few koi trail the visitor along the shore
    let fx = 0;
    let fz = 0;
    const follow = !feeding && (time < G.koiFollowUntil || G.feeds >= 3);
    if (follow) {
      this.player.getWorldPosition(this.pp);
      const a = Math.atan2((this.pp.z - POND.cz) / POND.rz, (this.pp.x - POND.cx) / POND.rx);
      const s = pondScale(a) * 0.8;
      fx = POND.cx + Math.cos(a) * POND.rx * s;
      fz = POND.cz + Math.sin(a) * POND.rz * s;
      if (!validWater(fx, fz)) fx = NaN;
    }
    for (const k of this.koi) {
      if (follow && !Number.isNaN(fx) && k.phase % 1 < 0.5) {
        k.tx = fx + Math.sin(time * 0.7 + k.phase * 6) * 0.8;
        k.tz = fz + Math.cos(time * 0.6 + k.phase * 4) * 0.6;
      }
      if (feeding) {
        k.tx = G.feedPoint[0] + Math.sin(time * 0.8 + k.phase * 7) * 0.45;
        k.tz = G.feedPoint[1] + Math.cos(time * 0.9 + k.phase * 5) * 0.35;
      }
      const dx = k.tx - k.x;
      const dz = k.tz - k.z;
      const dist = Math.hypot(dx, dz);
      if (!feeding && !follow && dist < 0.4) pickTarget(k);
      const want = Math.atan2(dx, dz);
      let diff = want - k.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      k.heading += Math.max(-(feeding ? 4.5 : 1.6) * dt, Math.min((feeding ? 4.5 : 1.6) * dt, diff));
      const target = feeding ? (dist > 0.8 ? 2.4 : 0.35) : 0.22 + 0.12 * Math.sin(time * 0.3 + k.phase);
      k.speed += (target - k.speed) * Math.min(1, dt * (feeding ? 4 : 1.5));
      const nx = k.x + Math.sin(k.heading) * k.speed * dt;
      const nz = k.z + Math.cos(k.heading) * k.speed * dt;
      if (validWater(nx, nz)) {
        k.x = nx;
        k.z = nz;
      } else {
        k.heading += Math.PI * 0.5 * dt * 4;
        if (!feeding) pickTarget(k);
      }
      const nearFood = feeding && Math.hypot(k.x - G.feedPoint[0], k.z - G.feedPoint[1]) < 1.4;
      const y = (nearFood ? WATER_Y - 0.035 : WATER_Y - k.depth) + Math.sin(time * 1.3 + k.phase) * 0.015;
      k.root.position.set(k.x, y, k.z);
      k.root.rotation.set(0, k.heading, Math.sin(time * 6 + k.phase) * 0.05);
      k.tail.rotation.y = Math.sin(time * (5 + k.speed * 14) + k.phase) * 0.5;
      if (nearFood && rand() < dt * 2.2) {
        this.spawnRipple(k.x, k.z, 0.4, 1.2);
        if (rand() < 0.3) effects?.splash(k.x, k.z, 2, 0.5);
      }
    }
    if (feeding && rand() < dt * 3) this.spawnRipple(G.feedPoint[0] + (rand() - 0.5) * 0.8, G.feedPoint[1] + (rand() - 0.5) * 0.8, 0.25, 1.0);

    // ambient ripples + cascade
    this.rippleTimer -= dt;
    if (this.rippleTimer <= 0) {
      this.rippleTimer = 0.7 + rand() * 1.4;
      for (let t = 0; t < 10; t++) {
        const x = POND.cx + (rand() - 0.5) * POND.rx * 1.8;
        const z = POND.cz + (rand() - 0.5) * POND.rz * 1.8;
        if (validWater(x, z) && Math.hypot(x - MOON_CENTER[0], z - MOON_CENTER[1]) > 3.4) {
          this.spawnRipple(x, z, 0.4 + rand() * 0.5, 2.4);
          break;
        }
      }
    }
    if (rand() < dt * 2.5) this.spawnRipple(CASCADE.bottom[0] + (rand() - 0.5) * 0.5, CASCADE.bottom[2] + (rand() - 0.5) * 0.4, 0.5 + rand() * 0.3, 1.4);
    for (const r of this.ripples) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const u = r.age / r.life;
      if (u >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const s = r.size * (0.1 + u * 1.1);
      r.mesh.scale.set(s, 1, s);
      (r.mesh.material as MeshBasicMaterial).opacity = (1 - u) * (1 - u) * 0.5;
    }

    // petals (shrink away near the camera so none smear across the view)
    this.camera.getWorldPosition(this.pp);
    const ps = this.petalState;
    const n = this.petals.count;
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      const gy = this.petalGround[i];
      if (ps[o + 1] <= gy + 0.01) {
        ps[o + 5] += dt;
        if (ps[o + 5] > 6) this.respawnPetal(i, false);
      } else {
        const ph = ps[o + 3];
        ps[o] += (0.18 + Math.sin(time * 0.7 + ph) * 0.25) * dt;
        ps[o + 2] += Math.cos(time * 0.9 + ph * 1.3) * 0.2 * dt;
        ps[o + 1] -= ps[o + 4] * dt;
      }
      this.dummy.position.set(ps[o], Math.max(ps[o + 1], gy + 0.01), ps[o + 2]);
      if (ps[o + 1] > gy + 0.01) this.dummy.rotation.set(time * 2 + ps[o + 3], time * 1.3 + ps[o + 3], 0);
      else this.dummy.rotation.set(-Math.PI / 2, 0, ps[o + 3]);
      const dc = this.dummy.position.distanceTo(this.pp);
      this.dummy.scale.setScalar(Math.min(1, Math.max(0, (dc - 0.5) / 1.0)));
      this.dummy.updateMatrix();
      this.petals.setMatrixAt(i, this.dummy.matrix);
    }
    this.petals.instanceMatrix.needsUpdate = true;

    // fireflies
    const fa = smooth01((G.dusk - 0.45) / 0.5);
    this.fireMat.uniforms.uAlpha.value = fa;
    this.fireMat.uniforms.uTime.value = time;
    this.fireflies.visible = fa > 0.01;
    if (this.fireflies.visible) {
      const arr = this.fireflies.geometry.getAttribute('position') as BufferAttribute;
      const fb = this.fireBase;
      for (let i = 0; i < arr.count; i++) {
        const ph = fb[i * 4 + 3];
        arr.setXYZ(
          i,
          fb[i * 4] + Math.sin(time * 0.31 + ph) * 0.9 + Math.sin(time * 0.77 + ph * 2) * 0.3,
          fb[i * 4 + 1] + Math.sin(time * 0.53 + ph * 3) * 0.35,
          fb[i * 4 + 2] + Math.cos(time * 0.27 + ph) * 0.9,
        );
      }
      arr.needsUpdate = true;
    }

    // dragonflies (daytime)
    const dv = 1 - smooth01((G.dusk - 0.3) / 0.4);
    for (const d of this.dragon) {
      d.g.visible = dv > 0.05;
      if (!d.g.visible) continue;
      d.wait -= dt;
      if (d.wait <= 0) {
        for (let t = 0; t < 10; t++) {
          const x = POND.cx + (rand() - 0.5) * POND.rx * 1.6;
          const z = POND.cz + (rand() - 0.5) * POND.rz * 1.6;
          if (pondField(x, z) < 0.9) {
            d.tx = x;
            d.tz = z;
            d.ty = 0.25 + rand() * 0.9;
            break;
          }
        }
        d.wait = 1.2 + rand() * 2.5;
      }
      const k = 1 - Math.exp(-dt * 3.2);
      const px = d.x;
      const pz = d.z;
      d.x += (d.tx - d.x) * k;
      d.y += (d.ty - d.y) * k;
      d.z += (d.tz - d.z) * k;
      const hover = Math.sin(time * 9 + d.tx) * 0.01;
      d.g.position.set(d.x, d.y + hover, d.z);
      if (Math.hypot(d.x - px, d.z - pz) > 0.001) d.g.rotation.y = Math.atan2(d.x - px, d.z - pz);
      for (let i = 0; i < d.wings.length; i++) d.wings[i].rotation.y = Math.sin(time * 60 + i) * 0.5;
    }

    // wind bell
    if (G.windBell) {
      const since = time - G.bellStrikeAt - 0.5;
      const strike = since > 0 && since < 8 ? Math.sin(since * 4.2) * 0.38 * Math.exp(-since * 0.55) : 0;
      G.windBell.rotation.z = -strike + Math.sin(time * 1.1) * 0.006;
      G.windBell.rotation.x = strike * 0.2;
      if (since > 0 && since < dt * 1.5) {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.spawnRipple(PLATFORM.x + Math.sin(a) * (PLATFORM.r + 0.6), PLATFORM.z + Math.cos(a) * (PLATFORM.r + 0.6), 1.2, 3.2);
        }
        effects?.flock(PLATFORM.x, PLATFORM.y + 6.5, PLATFORM.z, 7, 1);
        effects?.pulse(PLATFORM.x, PLATFORM.y + 2.0, PLATFORM.z);
      }
    }
  }
}

function smooth01(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

void Color;
