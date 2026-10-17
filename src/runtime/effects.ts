import {
  BufferGeometry,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  CylinderGeometry,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  AdditiveBlending,
  IcosahedronGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import { BAMBOO, CASCADE, MOON_BRIDGE, PLATFORM, POND, WATER_Y, ZIGZAG, ZIGZAG_WIDTH, pondField } from '../garden/layout.js';
import { groundHeight } from '../garden/terrain.js';
import { makeRandom, windUniforms } from '../garden/util.js';
import { G } from './state.js';

const rand = makeRandom(77);

function segDist(px: number, pz: number, a: [number, number], e: [number, number]): number {
  const vx = e[0] - a[0];
  const vz = e[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t));
}

/** Open water: inside the pond, clear of the platform and both bridges. */
function inWater(x: number, z: number, margin = 0.78): boolean {
  if (pondField(x, z) > margin) return false;
  if (Math.hypot(x - PLATFORM.x, z - PLATFORM.z) < PLATFORM.r + 0.5) return false;
  if (segDist(x, z, MOON_BRIDGE.start, MOON_BRIDGE.end) < MOON_BRIDGE.width / 2 + 0.5) return false;
  for (let i = 0; i < ZIGZAG.length - 1; i++) if (segDist(x, z, ZIGZAG[i], ZIGZAG[i + 1]) < ZIGZAG_WIDTH / 2 + 0.45) return false;
  return true;
}

interface Bird {
  g: Group;
  wings: Object3D[];
  active: boolean;
  t: number;
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  phase: number;
}

function haloTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,220,150,1)');
  g.addColorStop(0.25, 'rgba(255,190,110,0.55)');
  g.addColorStop(1, 'rgba(255,160,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

interface Lantern {
  halo: Sprite;
  g: Group;
  glow: MeshStandardMaterial;
  active: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  phase: number;
  age: number;
}

/** Event-driven visual effects: birds, lotus lanterns, bamboo gusts, bell. */
export class GardenEffects {
  private birds: Bird[] = [];
  private lanterns: Lantern[] = [];
  private leaves: InstancedMesh;
  private leafState: Float32Array;
  private dummy = new Object3D();
  private nextAmbientFlock = 25;
  private lanternIndex = 0;
  private striker: Object3D | null = null;
  private drops!: InstancedMesh;
  private dropState = new Float32Array(120 * 7);
  private dropIdx = 0;
  private dropAcc = 0;
  private rings: { m: Mesh; t: number; active: boolean }[] = [];
  private coin!: Mesh;
  private coinT = -1;
  private coinFrom = [0, 0, 0];
  private coinTo = [0, 0, 0];
  onCoinLand: (() => void) | null = null;
  private aim!: Mesh;
  private target!: Mesh;
  private sparkles: { s: Sprite; t: number; life: number; size: number; active: boolean; vy: number }[] = [];
  private sparkleIdx = 0;
  private trailAcc = 0;
  private mistAcc = 0;

  constructor(private scene: Scene) {
    const bodyMat = new MeshStandardMaterial({ color: '#3b3a36', roughness: 0.8, flatShading: true });
    const wingMat = new MeshStandardMaterial({ color: '#4a4842', roughness: 0.8, side: DoubleSide, flatShading: true });
    const wingGeo = new BufferGeometry();
    wingGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0.06, 0, 0, -0.06, 0.28, 0, -0.05], 3));
    wingGeo.computeVertexNormals();
    for (let i = 0; i < 9; i++) {
      const g = new Group();
      const body = new Mesh(new ConeGeometry(0.04, 0.24, 5), bodyMat);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const wings: Object3D[] = [];
      for (const s of [1, -1]) {
        const w = new Mesh(wingGeo, wingMat);
        w.scale.x = s;
        g.add(w);
        wings.push(w);
      }
      g.visible = false;
      scene.add(g);
      this.birds.push({ g, wings, active: false, t: 0, ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0, phase: rand() * 6 });
    }
    // lotus lanterns
    const petalGeo = new ConeGeometry(0.07, 0.2, 4);
    petalGeo.translate(0, 0.1, 0);
    const padGeo = new CylinderGeometry(0.2, 0.22, 0.03, 10);
    const haloTex = haloTexture();
    for (let i = 0; i < 12; i++) {
      const g = new Group();
      const petalMat = new MeshStandardMaterial({ color: '#f7bccb', emissive: '#ff8fa8', emissiveIntensity: 0.35, roughness: 0.6, flatShading: true });
      const glow = new MeshStandardMaterial({ color: '#fff1c0', emissive: '#ffcf6a', emissiveIntensity: 0.6, roughness: 0.4 });
      g.add(new Mesh(padGeo, new MeshStandardMaterial({ color: '#6f9a50', roughness: 0.7, flatShading: true })));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const p = new Mesh(petalGeo, petalMat);
        p.position.set(Math.cos(a) * 0.06, 0.02, Math.sin(a) * 0.06);
        p.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
        g.add(p);
      }
      const candle = new Mesh(new SphereGeometry(0.05, 8, 6), glow);
      candle.position.y = 0.08;
      candle.scale.y = 1.4;
      g.add(candle);
      const halo = new Sprite(new SpriteMaterial({ map: haloTex, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 }));
      halo.scale.setScalar(0.62);
      halo.position.y = 0.12;
      g.add(halo);
      g.visible = false;
      scene.add(g);
      this.lanterns.push({ halo, g, glow, active: false, x: 0, z: 0, vx: 0, vz: 0, phase: rand() * 6, age: 0 });
    }
    // bamboo leaves for gusts
    const N = 170;
    this.leaves = new InstancedMesh(new PlaneGeometry(0.16, 0.035), new MeshStandardMaterial({ color: '#8fae55', side: DoubleSide, roughness: 0.8 }), N);
    this.leaves.frustumCulled = false;
    this.leafState = new Float32Array(N * 5).fill(-100);
    for (let i = 0; i < N; i++) {
      this.dummy.position.set(0, -50, 0);
      this.dummy.updateMatrix();
      this.leaves.setMatrixAt(i, this.dummy.matrix);
    }
    scene.add(this.leaves);
    this.drops = new InstancedMesh(new IcosahedronGeometry(0.028, 0), new MeshBasicMaterial({ color: '#f4faf8', transparent: true, opacity: 0.85 }), 120);
    this.drops.frustumCulled = false;
    for (let i = 0; i < 120; i++) {
      this.dummy.position.set(0, -50, 0);
      this.dummy.updateMatrix();
      this.drops.setMatrixAt(i, this.dummy.matrix);
    }
    scene.add(this.drops);
    const ringGeo = new TorusGeometry(1, 0.025, 4, 64);
    ringGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#ffd889', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, t: 0, active: false });
    }
    this.coin = new Mesh(new CylinderGeometry(0.05, 0.05, 0.01, 14), new MeshStandardMaterial({ color: '#e2b552', metalness: 0.9, roughness: 0.25, emissive: '#7a5200', emissiveIntensity: 0.6 }));
    this.coin.visible = false;
    scene.add(this.coin);
    const aimGeo = new TorusGeometry(0.2, 0.03, 4, 32);
    aimGeo.rotateX(Math.PI / 2);
    this.aim = new Mesh(aimGeo, new MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }));
    this.target = new Mesh(new TorusGeometry(0.75, 0.04, 4, 48).rotateX(Math.PI / 2), new MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    this.target.position.set(CASCADE.bottom[0], WATER_Y + 0.02, CASCADE.bottom[2]);
    this.target.renderOrder = 3;
    scene.add(this.target);
    this.aim.visible = false;
    this.aim.renderOrder = 3;
    scene.add(this.aim);
    const sparkTex = haloTexture();
    for (let i = 0; i < 40; i++) {
      const sp = new Sprite(new SpriteMaterial({ map: sparkTex, color: '#ffe7a8', blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      sp.visible = false;
      scene.add(sp);
      this.sparkles.push({ s: sp, t: 0, life: 1, size: 1, active: false, vy: 0 });
    }
    void MeshBasicMaterial;
  }

  splash(x: number, z: number, n: number, power = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.dropIdx++ % 120;
      const o = i * 7;
      const a = rand() * Math.PI * 2;
      const sp = (0.4 + rand() * 0.8) * power;
      this.dropState[o] = x + Math.cos(a) * 0.1;
      this.dropState[o + 1] = WATER_Y + 0.02;
      this.dropState[o + 2] = z + Math.sin(a) * 0.1;
      this.dropState[o + 3] = Math.cos(a) * sp;
      this.dropState[o + 4] = (1.2 + rand() * 1.4) * power;
      this.dropState[o + 5] = Math.sin(a) * sp;
      this.dropState[o + 6] = 1;
    }
  }

  /** Coins left on the pool floor; the oldest is recycled past MAX_RESTING_COINS. */
  private restingCoins: Object3D[] = [];
  /** Leave a coin glinting on the pool floor (persists). */
  restCoin(x: number, z: number) {
    const MAX_RESTING_COINS = 24;
    let c: Object3D;
    if (this.restingCoins.length >= MAX_RESTING_COINS) c = this.restingCoins.shift()!;
    else {
      // clones share the coin's geometry and material, so each one costs no GPU memory
      c = this.coin.clone();
      (c as Mesh).material = this.coin.material;
      c.visible = true;
      this.scene.add(c);
    }
    this.restingCoins.push(c);
    const near = Math.hypot(x - CASCADE.bottom[0], z - CASCADE.bottom[2]) < 1.0;
    c.position.set(x + (rand() - 0.5) * 0.3, near ? -0.47 : groundHeight(x, z) + 0.02, z + (rand() - 0.5) * 0.3);
    c.rotation.set((rand() - 0.5) * 0.3, rand() * 6, 0);
    c.scale.setScalar(1.7);
    this.sparkle(c.position.x, c.position.y + 0.05, c.position.z, 0.5, 2.5);
  }

  setStriker(o: Object3D | null) {
    this.striker = o;
  }

  flock(x: number, y: number, z: number, count = 7, spread = 1) {
    let n = 0;
    for (const b of this.birds) {
      if (b.active || n >= count) continue;
      n++;
      const a = rand() * Math.PI * 2;
      b.active = true;
      b.t = -n * 0.12;
      b.ox = x + Math.cos(a) * 0.6 * spread;
      b.oy = y + rand() * 0.4;
      b.oz = z + Math.sin(a) * 0.6 * spread;
      const sp = 3 + rand() * 1.5;
      const dir = a + (rand() - 0.5) * 0.6;
      b.vx = Math.cos(dir) * sp;
      b.vz = Math.sin(dir) * sp;
      b.vy = 1.2 + rand() * 0.8;
    }
  }

  /** Show where a tossed coin would land (null hides it). */
  setAim(x: number | null, z = 0, lucky = false, time = 0, lantern = false) {
    const tm = this.target.material as MeshBasicMaterial;
    if (x === null) {
      this.aim.visible = false;
      tm.opacity = Math.max(0, tm.opacity - 0.05);
      return;
    }
    // while aiming the coin, outline the lucky ring of stones (seen through obstacles)
    tm.opacity = lantern ? 0 : 0.45 + Math.sin(time * 3) * 0.15;
    this.aim.visible = true;
    this.aim.position.set(x, WATER_Y + 0.015, z);
    const s = 1 + Math.sin(time * 5) * 0.12;
    this.aim.scale.set(s, 1, s);
    (this.aim.material as MeshBasicMaterial).color.set(lantern ? '#ff8fae' : lucky ? '#ffe066' : '#e8b45a');
    (this.aim.material as MeshBasicMaterial).opacity = lucky ? 1 : 0.85;
  }

  /** Additive glint that swells and fades. */
  sparkle(x: number, y: number, z: number, size = 1, life = 1.4, vy = 0) {
    const sp = this.sparkles[this.sparkleIdx++ % this.sparkles.length];
    sp.active = true;
    sp.t = 0;
    sp.life = life;
    sp.size = size;
    sp.vy = vy;
    sp.s.position.set(x, y, z);
    (sp.s.material as SpriteMaterial).color.set('#ffe7a8');
    sp.s.visible = true;
  }

  /** Expanding golden sound rings from the bell. */
  pulse(x: number, y: number, z: number, scale = 1) {
    this.ringScale = scale;
    this.rings.forEach((r, i) => {
      r.active = true;
      r.t = -i * 0.35;
      r.m.position.set(x, y - (scale < 1 ? 0 : i * 0.5), z);
    });
  }
  private ringScale = 1;

  tossCoin(from: [number, number, number], to: [number, number, number]) {
    this.coinFrom = from;
    this.coinTo = to;
    this.coinT = 0;
    this.coin.visible = true;
  }

  floatLantern(x: number, z: number, dx = 0, dz = 0) {
    const l = this.lanterns[this.lanternIndex++ % this.lanterns.length];
    l.active = true;
    l.x = x;
    l.z = z;
    const a = dx || dz ? Math.atan2(dz, dx) + (rand() - 0.5) * 0.5 : rand() * Math.PI * 2;
    l.vx = Math.cos(a) * 0.14;
    l.vz = Math.sin(a) * 0.14;
    l.age = 0;
    l.g.visible = true;
  }

  gust(px: number, pz: number) {
    let spawned = 0;
    const clumps = BAMBOO.filter((c) => Math.hypot(c.x - px, c.z - pz) < 12);
    const s = this.leafState;
    for (let i = 0; i < this.leaves.count && spawned < 140; i++) {
      if (s[i * 5 + 1] > -50) continue;
      const near = spawned % 2 === 0 || !clumps.length;
      const c = near ? { x: px - 2.5, z: pz } : clumps[spawned % clumps.length];
      const spread = near ? 6 : 1.8;
      s[i * 5] = c.x + (rand() - 0.5) * spread;
      s[i * 5 + 1] = groundHeight(c.x, c.z) + 2.2 + rand() * 3.5;
      s[i * 5 + 2] = c.z + (rand() - 0.5) * spread;
      s[i * 5 + 3] = rand() * 10;
      s[i * 5 + 4] = 0;
      spawned++;
    }
  }

  update(dt: number, time: number) {
    // gust wind strength
    const since = time - G.gustAt;
    windUniforms.uWindStrength.value = 1 + (since >= 0 && since < 8 ? 8 * Math.exp(-since * 0.55) * Math.min(1, since * 3) : 0);

    // bell striker: pull back, then strike
    if (this.striker) {
      const t = time - G.bellStrikeAt;
      let r = Math.sin(time * 0.9) * 0.02;
      if (t >= 0 && t < 6) {
        if (t < 0.35) r = -0.5 * (t / 0.35);
        else if (t < 0.5) r = -0.5 + ((t - 0.35) / 0.15) * 0.55;
        else r = 0.05 * Math.cos((t - 0.5) * 6) * Math.exp(-(t - 0.5) * 1.5);
      }
      this.striker.rotation.z = r;
    }

    // birds
    let anyActive = false;
    for (const b of this.birds) {
      if (!b.active) continue;
      anyActive = true;
      b.t += dt;
      if (b.t < 0) continue;
      b.g.visible = true;
      const t = b.t;
      b.g.position.set(b.ox + b.vx * t, b.oy + b.vy * t + 0.15 * t * t, b.oz + b.vz * t);
      b.g.rotation.set(-0.25, Math.atan2(b.vx, b.vz), Math.sin(t * 2 + b.phase) * 0.2);
      const flap = Math.sin(t * 18 + b.phase) * 0.7;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
      if (t > 9) {
        b.active = false;
        b.g.visible = false;
      }
    }
    this.nextAmbientFlock -= dt;
    if (this.nextAmbientFlock <= 0 && !anyActive && G.dusk < 0.6) {
      this.nextAmbientFlock = 40 + rand() * 40;
      const a = rand() * Math.PI * 2;
      this.flock(Math.cos(a) * 18, 8 + rand() * 4, Math.sin(a) * 18, 5, 2);
      for (const b of this.birds) {
        if (!b.active) continue;
        b.vx = -Math.cos(a) * 4;
        b.vz = -Math.sin(a) * 4;
        b.vy = 0.2;
      }
    }

    // lanterns
    const glowK = 1.0 + G.dusk * 1.3;
    for (const l of this.lanterns) {
      if (!l.active) continue;
      l.age += dt;
      const nx = l.x + l.vx * dt;
      const nz = l.z + l.vz * dt;
      if (inWater(nx, nz, 0.86)) {
        l.x = nx;
        l.z = nz;
      } else {
        const a = Math.atan2(POND.cz - l.z, POND.cx - l.x) + (rand() - 0.5) * 1.2;
        l.vx = Math.cos(a) * 0.12;
        l.vz = Math.sin(a) * 0.12;
      }
      const intro = Math.min(1, l.age * 1.5);
      l.g.position.set(l.x, WATER_Y + 0.01 + Math.sin(time * 1.4 + l.phase) * 0.012, l.z);
      l.g.rotation.y += dt * 0.15;
      l.g.scale.setScalar(intro * 2.4);
      (l.halo.material as SpriteMaterial).opacity = 0.3 + G.dusk * 0.35;
      l.glow.emissiveIntensity = glowK * (0.85 + 0.15 * Math.sin(time * 9 + l.phase));
    }

    // sparkles
    for (const sp of this.sparkles) {
      if (!sp.active) continue;
      sp.t += dt;
      const u = sp.t / sp.life;
      if (u >= 1) {
        sp.active = false;
        sp.s.visible = false;
        continue;
      }
      sp.s.position.y += sp.vy * dt;
      const tw = 0.75 + 0.25 * Math.sin(sp.t * 30);
      sp.s.scale.setScalar(sp.size * (0.4 + Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) * 0.8));
      (sp.s.material as SpriteMaterial).opacity = (1 - u) * tw;
    }
    // bell rings
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      if (r.t < 0) continue;
      const u = r.t / 2.6;
      if (u >= 1) {
        r.active = false;
        r.m.visible = false;
        continue;
      }
      r.m.visible = true;
      const sc = (0.6 + u * 10) * this.ringScale;
      r.m.scale.set(sc, this.ringScale < 1 ? 1 : 1 + u * 6, sc);
      (r.m.material as MeshBasicMaterial).opacity = (1 - u) * 0.8;
    }
    // coin toss
    if (this.coinT >= 0) {
      this.coinT += dt;
      const u = Math.min(1, this.coinT / 1.0);
      const [fx, fy, fz] = this.coinFrom;
      const [tx, ty, tz] = this.coinTo;
      this.coin.position.set(fx + (tx - fx) * u, fy + (ty - fy) * u + Math.sin(u * Math.PI) * 1.2, fz + (tz - fz) * u);
      this.coin.rotation.set(this.coinT * 14, this.coinT * 5, 0);
      this.trailAcc += dt;
      if (this.trailAcc > 0.04) {
        this.trailAcc = 0;
        this.sparkle(this.coin.position.x, this.coin.position.y, this.coin.position.z, 0.25, 0.5);
      }
      if (u >= 1) {
        this.coinT = -1;
        this.coin.visible = false;
        this.splash(tx, tz, 16, 1.0);
        this.sparkle(tx, ty + 0.05, tz, 1.4, 1.6);
        this.sparkle(tx, ty - 0.1, tz, 0.6, 2.4, -0.12);
        this.onCoinLand?.();
      }
    }

    // cascade mist puffs
    this.mistAcc += dt;
    if (this.mistAcc > 0.35) {
      this.mistAcc = 0;
      const sp = this.sparkles[this.sparkleIdx++ % this.sparkles.length];
      sp.active = true;
      sp.t = 0;
      sp.life = 2.2;
      sp.size = 0.9;
      sp.vy = 0.3;
      sp.s.position.set(CASCADE.bottom[0] + (rand() - 0.5) * 0.8, WATER_Y + 0.15, CASCADE.bottom[2] + (rand() - 0.5) * 0.5);
      (sp.s.material as SpriteMaterial).color.set('#7f908d');
      sp.s.visible = true;
    }
    // cascade spray + droplets
    this.dropAcc += dt * 22;
    while (this.dropAcc > 1) {
      this.dropAcc -= 1;
      this.splash(CASCADE.bottom[0] + (rand() - 0.5) * 0.6, CASCADE.bottom[2] + (rand() - 0.5) * 0.25, 1, 0.8);
    }
    const ds = this.dropState;
    let dropsDirty = false;
    for (let i = 0; i < 120; i++) {
      const o = i * 7;
      if (ds[o + 6] <= 0) {
        if (ds[o + 6] === 0) {
          // park a finished droplet once, then skip it until reused
          ds[o + 6] = -1;
          this.dummy.position.set(0, -50, 0);
          this.dummy.updateMatrix();
          this.drops.setMatrixAt(i, this.dummy.matrix);
          dropsDirty = true;
        }
        continue;
      }
      dropsDirty = true;
      ds[o + 4] -= 9.8 * dt;
      ds[o] += ds[o + 3] * dt;
      ds[o + 1] += ds[o + 4] * dt;
      ds[o + 2] += ds[o + 5] * dt;
      if (ds[o + 1] < WATER_Y) ds[o + 6] = 0;
      this.dummy.position.set(ds[o], ds[o + 6] > 0 ? ds[o + 1] : -50, ds[o + 2]);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.drops.setMatrixAt(i, this.dummy.matrix);
    }
    if (dropsDirty) this.drops.instanceMatrix.needsUpdate = true;

    // gust leaves
    const s = this.leafState;
    let dirty = false;
    for (let i = 0; i < this.leaves.count; i++) {
      const o = i * 5;
      if (s[o + 1] < -50) continue;
      dirty = true;
      const gy = groundHeight(s[o], s[o + 2]);
      if (s[o + 1] > gy + 0.01) {
        s[o] += (1.6 + Math.sin(time + s[o + 3]) * 0.5) * dt;
        s[o + 2] += Math.cos(time * 1.3 + s[o + 3]) * 0.4 * dt;
        s[o + 1] -= 0.5 * dt;
      } else {
        s[o + 4] += dt;
        if (s[o + 4] > 5) s[o + 1] = -100;
      }
      this.dummy.position.set(s[o], Math.max(s[o + 1], gy + 0.01), s[o + 2]);
      this.dummy.rotation.set(time * 3 + s[o + 3], time * 2 + s[o + 3], 0);
      if (s[o + 1] < -50) this.dummy.position.y = -50;
      this.dummy.updateMatrix();
      this.leaves.setMatrixAt(i, this.dummy.matrix);
    }
    if (dirty) this.leaves.instanceMatrix.needsUpdate = true;
  }
}

export { inWater };
