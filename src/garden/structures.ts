import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  MeshStandardMaterial,
  Shape,
  Vector3,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import {
  CASCADE,
  GARDEN_RADIUS,
  LAMP_ANGLES,
  LAMP_OFFSET,
  LOOP,
  ROCKERY,
  SPUR_BASE,
  SCREEN_WALL,
  STONES,
  TERRACE as TERRACE_POS,
  PENJING as PENJING_POS,
  loopPoint,
} from './layout.js';

export const GATE_CY = 1.2;
import { Mats } from './palette.js';
import { groundHeight } from './terrain.js';
import { jitter } from './flora.js';
import { Batch, beam, makeMat, makeRandom } from './util.js';

const UNIT = new BoxGeometry(1, 1, 1);

function scholarStone(b: Batch, mats: Mats, x: number, z: number, h: number, seed: number) {
  const rand = makeRandom(seed);
  const y0 = groundHeight(x, z) - 0.1;
  let y = y0;
  let cx = x;
  let cz = z;
  const parts = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < parts; i++) {
    const u = i / parts;
    const w = (0.55 - u * 0.25) * (0.8 + rand() * 0.4) * (h / 2);
    const ph = (h / parts) * (1.1 + rand() * 0.5);
    const g = jitter(new IcosahedronGeometry(1, 1), 0.35, seed + i * 7);
    b.put(g, i % 2 ? mats.rock : mats.rock2, [cx, y + ph * 0.45, cz], [rand() * 0.5, rand() * 6, rand() * 0.5], [w, ph * 0.62, w * 0.75]);
    y += ph * 0.72;
    cx += (rand() - 0.5) * 0.25;
    cz += (rand() - 0.5) * 0.25;
  }
  // companion boulders
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2;
    const d = 0.6 + rand() * 0.5;
    const s = 0.2 + rand() * 0.25;
    const bx = x + Math.cos(a) * d;
    const bz = z + Math.sin(a) * d;
    b.put(new DodecahedronGeometry(1, 0), mats.rock2, [bx, groundHeight(bx, bz) + s * 0.3, bz], [rand() * 3, rand() * 3, rand() * 3], [s * 1.3, s * 0.85, s]);
  }
}

function rockery(b: Batch, mats: Mats) {
  const rand = makeRandom(555);
  const { x, z } = ROCKERY;
  // big stacked mass, highest at the back (away from the pond)
  const blocks: [number, number, number, number, number][] = [
    // dx, dz, y, w, h
    [0, 0, 0.2, 1.7, 1.1],
    [-0.9, -0.8, 0.5, 1.5, 1.6],
    [0.7, -0.9, 0.4, 1.2, 1.2],
    [-0.3, -0.4, 1.3, 1.25, 1.3],
    [-1.2, -1.4, 1.4, 1.0, 1.4],
    [0.4, -1.5, 1.2, 0.9, 1.1],
    [-0.6, -1.0, 2.2, 0.9, 1.0],
    [0.9, 0.3, 0.1, 0.9, 0.8],
    [-1.6, 0.2, 0.1, 1.0, 0.9],
    [-0.2, -1.2, 3.0, 0.6, 0.9],
  ];
  // the cascade spur stands apart, east of the moon-bridge sightline
  const spur: [number, number, number, number, number][] = [
    [1.3, -0.1, 0.4, 0.9, 1.3],
    [1.75, 0.42, 0.2, 0.9, 1.9],
    [1.65, 0.27, 1.2, 0.75, 1.3],
    [1.55, 0.12, 1.95, 0.62, 1.1],
  ];
  const place = (list: [number, number, number, number, number][], ox: number, oz: number) => {
    for (const [bdx, bdz, y, w, h] of list) {
      const dx = bdx * 0.85;
      const dz = bdz * 0.85;
      const g = jitter(new IcosahedronGeometry(1, 1), 0.4, Math.floor(rand() * 9999));
      b.put(g, rand() < 0.4 ? mats.rockDark : rand() < 0.5 ? mats.rock2 : mats.rock, [ox + dx, groundHeight(ox + dx, oz + dz) + y, oz + dz], [rand() * 0.6, rand() * 6, rand() * 0.6], [w, h * 0.6, w * 0.85]);
    }
  };
  place(blocks, x, z);
  place(
    spur.map(([dx, dz, y, w, h]) => [dx, dz, y, w * 0.82, h] as [number, number, number, number, number]),
    SPUR_BASE.x,
    SPUR_BASE.z,
  );
  // cascade lip and basin stones
  const [tx, ty, tz] = CASCADE.top;
  b.put(new BoxGeometry(1.1, 0.16, 0.7), mats.rockDark, [tx - 0.14, ty - 0.1, tz + 0.04], [0, 1.88, 0.04]);
  // shallow stone basin under the falls where coins stay visible
  const [bx0, , bz0] = CASCADE.bottom;
  b.put(new CylinderGeometry(0.95, 1.0, 0.5, 12), mats.rim2, [bx0, -0.73, bz0], [0, 0, 0], 1, { cast: false });
  const [bx, , bz] = CASCADE.bottom;
  // a ring of dark stepping stones beneath the falls: the "luck" target for coins
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const s = 0.12 + rand() * 0.05;
    b.put(new DodecahedronGeometry(1, 0), mats.rockDark, [bx + Math.cos(a) * 0.75, -0.3, bz + Math.sin(a) * 0.75], [rand(), rand(), rand()], [s * 1.3, s * 0.9, s]);
  }
  // shrubs on the rockery
  const shrub = makeMat('#86a352', { wind: 0.02 });
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const sx = x - 0.6 + Math.cos(a) * 1.2;
    const sz = z - 1 + Math.sin(a) * 1.0;
    const s = 0.3 + rand() * 0.25;
    b.put(jitter(new IcosahedronGeometry(1, 0), 0.3, i), shrub, [sx, groundHeight(sx, sz) + 1.2 + rand() * 1.4, sz], [0, rand() * 6, 0], [s, s * 0.7, s]);
  }
}

function tileCap(b: Batch, mats: Mats, p0: Vector3, p1: Vector3, thick: number) {
  // gabled coping: ridge + two sloped tile slabs + eave line
  const up = new Vector3(0, 1, 0);
  const dir = p1.clone().sub(p0).normalize();
  const side = new Vector3().crossVectors(up, dir).normalize();
  const half = thick / 2 + 0.16;
  for (const sgn of [-1, 1]) {
    const off = side.clone().multiplyScalar(sgn * half * 0.5).add(new Vector3(0, 0.08, 0));
    const a = p0.clone().add(off);
    const e = p1.clone().add(off);
    const len = a.distanceTo(e);
    const o = new Group();
    o.position.copy(a).add(e).multiplyScalar(0.5);
    o.lookAt(e);
    o.rotateZ(sgn * 0.42);
    o.scale.set(half * 1.1, 0.06, len);
    b.addObject(UNIT, mats.tile, o);
    // individual tile ribs running down the slope
    const n = Math.floor(len / 0.24);
    const up = new Vector3(0, 1, 0).applyQuaternion(o.quaternion);
    for (let k = 0; k < n; k++) {
      const r = new Group();
      r.quaternion.copy(o.quaternion);
      r.position.copy(o.position).add(dir.clone().multiplyScalar((k + 0.5) * (len / n) - len / 2)).add(up.clone().multiplyScalar(0.045));
      r.scale.set(half * 1.12, 0.05, 0.075);
      b.addObject(UNIT, mats.tileLight, r, { cast: false });
    }
  }
  beam(b, UNIT, mats.tileLight, p0.clone().add(new Vector3(0, 0.22, 0)), p1.clone().add(new Vector3(0, 0.22, 0)), 0.14, 0.12);
}

const wallStain = makeMat('#e3ddcf', { rough: 1 });
const latticeBg = makeMat('#cfdcc9', { rough: 1, emissive: '#b9cbb4', emissiveIntensity: 0.35 });
const latticeFg = makeMat('#5f676b', { rough: 0.9 });

function perimeterWall(b: Batch, mats: Mats) {
  const N = 112;
  const R = GARDEN_RADIUS + 0.2;
  const H = 2.6;
  const T = 0.36;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const p0 = new Vector3(Math.cos(a0) * R, 0, Math.sin(a0) * R);
    const p1 = new Vector3(Math.cos(a1) * R, 0, Math.sin(a1) * R);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const gy = Math.min(groundHeight(p0.x * 0.97, p0.z * 0.97), groundHeight(p1.x * 0.97, p1.z * 0.97)) - 0.1;
    const len = p0.distanceTo(p1) * 1.02;
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    b.put(UNIT, mats.plaster, [mid.x, gy + H / 2, mid.z], [0, yaw, 0], [T, H, len]);
    b.put(UNIT, mats.tileLight, [mid.x, gy + 0.18, mid.z], [0, yaw, 0], [T + 0.06, 0.36, len]);
    tileCap(b, mats, p0.clone().setY(gy + H), p1.clone().setY(gy + H), T);
    // painted frieze band under the coping + faint plaster weathering near the foot
    b.put(UNIT, mats.tileLight, [mid.x, gy + H - 0.16, mid.z], [0, yaw, 0], [T + 0.03, 0.09, len], { cast: false });
    b.put(UNIT, wallStain, [mid.x, gy + 0.55, mid.z], [0, yaw, 0], [T + 0.012, 0.36, len], { cast: false });
    // leak windows (lattice openings) every 7 segments
    if (i % 7 === 3) {
      const inwardDir = mid.clone().setY(0).normalize().multiplyScalar(-1);
      leakWindow(b, mats, mid.clone().add(inwardDir.clone().multiplyScalar(T / 2)).setY(gy + 1.5), yaw, inwardDir, Math.floor(i / 7) % 3);
    }
  }
}


function leakWindow(b: Batch, mats: Mats, c: Vector3, yaw: number, faceDir: Vector3, kind = 0) {
  const side = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const at = (u: number, v: number, depth: number) =>
    c.clone().add(side.clone().multiplyScalar(u)).add(new Vector3(0, v, 0)).add(faceDir.clone().multiplyScalar(depth));
  if (kind === 1) {
    // round window with radial spokes and an inner ring
    const bg = at(0, 0, 0.005);
    const disc = new CylinderGeometry(0.46, 0.46, 0.02, 24);
    disc.rotateZ(Math.PI / 2);
    b.put(disc, latticeBg, [bg.x, bg.y, bg.z], [0, yaw, 0], 1, { cast: false });
    const fr = at(0, 0, 0.03);
    const ring = new TorusGeometry(0.48, 0.06, 4, 28);
    ring.rotateY(Math.PI / 2);
    b.put(ring, mats.tileLight, [fr.x, fr.y, fr.z], [0, yaw, 0], 1, { cast: false });
    const inner = new TorusGeometry(0.2, 0.02, 4, 20);
    inner.rotateY(Math.PI / 2);
    b.put(inner, latticeFg, [fr.x, fr.y, fr.z], [0, yaw, 0], 1, { cast: false });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      beam(b, UNIT, latticeFg, at(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.025), at(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0.025), 0.03, 0.03, { cast: false });
    }
    return;
  }
  if (kind === 2) {
    // hexagonal window with a plum-blossom fret
    const bg = at(0, 0, 0.005);
    const hex = new CylinderGeometry(0.46, 0.46, 0.02, 6);
    hex.rotateZ(Math.PI / 2);
    b.put(hex, latticeBg, [bg.x, bg.y, bg.z], [0, yaw, 0], 1, { cast: false });
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const a1 = ((k + 1) / 6) * Math.PI * 2 + Math.PI / 6;
      beam(b, UNIT, mats.tileLight, at(Math.cos(a0) * 0.5, Math.sin(a0) * 0.5, 0.03), at(Math.cos(a1) * 0.5, Math.sin(a1) * 0.5, 0.03), 0.06, 0.09, { cast: false });
      beam(b, UNIT, latticeFg, at(0, 0, 0.025), at(Math.cos(a0) * 0.45, Math.sin(a0) * 0.45, 0.025), 0.03, 0.03, { cast: false });
      const m = at(Math.cos(a0 + Math.PI / 6) * 0.22, Math.sin(a0 + Math.PI / 6) * 0.22, 0.025);
      b.put(new CylinderGeometry(0.06, 0.06, 0.02, 5).rotateZ(Math.PI / 2), latticeFg, [m.x, m.y, m.z], [0, yaw, 0], 1, { cast: false });
    }
    return;
  }
  const bg = at(0, 0, 0.005);
  b.put(UNIT, latticeBg, [bg.x, bg.y, bg.z], [0, yaw, 0], [0.02, 0.9, 0.9], { cast: false });
  for (const [u, v, w, h] of [
    [0, 0.48, 1.06, 0.1],
    [0, -0.48, 1.06, 0.1],
    [0.48, 0, 0.1, 1.06],
    [-0.48, 0, 0.1, 1.06],
  ]) {
    const p = at(u, v, 0.03);
    b.put(UNIT, mats.tileLight, [p.x, p.y, p.z], [0, yaw, 0], [0.06, h, w], { cast: false });
  }
  const H = 0.43;
  for (let ci = -3; ci <= 3; ci++) {
    const cval = ci * 0.21;
    for (const sgn of [1, -1]) {
      const pts: [number, number][] = [];
      for (const u of [-H, H]) {
        const v = sgn * u + cval;
        if (v >= -H && v <= H) pts.push([u, v]);
      }
      for (const v of [-H, H]) {
        const u = (v - cval) * sgn;
        if (u > -H && u < H) pts.push([u, v]);
      }
      if (pts.length < 2) continue;
      beam(b, UNIT, latticeFg, at(pts[0][0], pts[0][1], 0.025), at(pts[1][0], pts[1][1], 0.025), 0.035, 0.03, { cast: false });
    }
  }
}

function screenWall(b: Batch, mats: Mats) {
  const { z, halfLen, height, gateR } = SCREEN_WALL;
  const T = 0.42;
  const y0 = groundHeight(0, z) - 0.05;
  const cy = GATE_CY; // circle center above the wall base; the ground cuts the circle
  const steps = 40;
  const bottomX = Math.sqrt(gateR * gateR - cy * cy);
  const a0 = Math.PI + Math.asin(cy / gateR);
  const a1 = -Math.asin(cy / gateR);
  const outline = new Shape();
  outline.moveTo(-halfLen, 0);
  outline.lineTo(-bottomX, 0);
  for (let i = 1; i < steps; i++) {
    const a = a0 - ((a0 - a1) * i) / steps;
    outline.lineTo(Math.cos(a) * gateR, cy + Math.sin(a) * gateR);
  }
  outline.lineTo(bottomX, 0);
  outline.lineTo(halfLen, 0);
  outline.lineTo(halfLen, height);
  outline.lineTo(-halfLen, height);
  outline.closePath();
  const g = new ExtrudeGeometry(outline, { depth: T, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, y0, -T / 2 + z);
  b.add(g, mats.plaster);
  // grey brick ring around the gate, both faces
  for (const side of [-1, 1]) {
    const R = gateR + 0.09;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const aa = a0 - ((a0 - a1) * (i + 0.5)) / n;
      const px = Math.cos(aa) * R;
      const py = y0 + cy + Math.sin(aa) * R;
      if (py < y0 + 0.12) continue;
      const len = ((a0 - a1) / n) * R;
      const o = new Group();
      o.position.set(px, py, z + side * (T / 2 + 0.02));
      o.rotation.set(0, 0, aa + Math.PI / 2);
      o.scale.set(len * 1.02, 0.18, 0.05);
      b.addObject(UNIT, mats.tileLight, o);
    }
  }
  // plinth and coping
  const plW = halfLen - gateR - 0.1;
  b.put(UNIT, mats.tileLight, [-(halfLen - plW / 2), y0 - 0.05, z], [0, 0, 0], [plW, 0.74, T + 0.06]);
  b.put(UNIT, mats.tileLight, [halfLen - plW / 2, y0 - 0.05, z], [0, 0, 0], [plW, 0.74, T + 0.06]);
  tileCap(b, mats, new Vector3(-halfLen - 0.25, y0 + height, z), new Vector3(halfLen + 0.25, y0 + height, z), T);
  // upturned ends of the ridge
  for (const sx of [-1, 1]) {
    b.put(new ConeGeometry(0.08, 0.45, 5), mats.tile, [sx * (halfLen + 0.3), y0 + height + 0.37, z], [0, 0, sx * -0.7]);
  }
  b.put(UNIT, mats.tileLight, [0, y0 + height - 0.16, z], [0, 0, 0], [halfLen * 2, 0.09, T + 0.03], { cast: false });
  // leak windows along the long screen wall, both faces
  for (const wx of [-14.5, -10.5, -6.0, 6.0, 10.5, 14.5]) {
    for (const f of [1, -1]) {
      leakWindow(b, mats, new Vector3(wx, y0 + 1.55, z + f * (T / 2)), Math.PI / 2, new Vector3(0, 0, f), Math.abs(Math.round(wx)) % 3);
    }
  }
  // plaque frame above the gate (text added at runtime)
  b.put(UNIT, mats.tile, [0, y0 + cy + gateR + 0.42, z + T / 2 + 0.03], [0, 0, 0], [1.3, 0.46, 0.04]);
  b.put(UNIT, mats.tile, [0, y0 + cy + gateR + 0.42, z - T / 2 - 0.03], [0, 0, 0], [1.3, 0.46, 0.04]);
}

const lampAnchors: Vector3[] = [];

function stoneLantern(b: Batch, mats: Mats, glow: MeshStandardMaterial, x: number, z: number, yaw: number) {
  const y = groundHeight(x, z);
  b.put(new CylinderGeometry(0.26, 0.3, 0.14, 6), mats.rim2, [x, y + 0.07, z], [0, yaw, 0]);
  b.put(new CylinderGeometry(0.08, 0.1, 0.62, 6), mats.rim, [x, y + 0.45, z], [0, yaw, 0]);
  b.put(new CylinderGeometry(0.24, 0.18, 0.1, 6), mats.rim2, [x, y + 0.8, z], [0, yaw, 0]);
  b.put(new CylinderGeometry(0.15, 0.15, 0.28, 6), glow, [x, y + 0.99, z], [0, yaw, 0]);
  lampAnchors.push(new Vector3(x, y + 0.99, z));
  for (let k = 0; k < 6; k++) {
    const a = yaw + (k / 6) * Math.PI * 2 + Math.PI / 6;
    b.put(UNIT, mats.rim, [x + Math.sin(a) * 0.16, y + 0.99, z + Math.cos(a) * 0.16], [0, a, 0], [0.05, 0.3, 0.05]);
  }
  b.put(new ConeGeometry(0.34, 0.24, 6), mats.rim2, [x, y + 1.25, z], [0, yaw, 0]);
  b.put(new IcosahedronGeometry(0.07, 0), mats.rim, [x, y + 1.41, z]);
}

export function createLampMaterial(): MeshStandardMaterial {
  const m = makeMat('#efe2c4', { rough: 0.8, emissive: '#ffcf7a', emissiveIntensity: 0 });
  m.name = 'LampGlow';
  return m;
}

function horizon(mats: Mats): Group {
  const b = new Batch();
  const rand = makeRandom(909);
  const far = makeMat('#b9c9be', { rough: 1 });
  const mid = makeMat('#a5b9ab', { rough: 1 });
  const near = makeMat('#93ab98', { rough: 1 });
  const rings: [number, number, MeshStandardMaterial, number][] = [
    [130, 18, far, 34],
    [95, 16, mid, 24],
    [62, 14, near, 15],
  ];
  for (const [R, n, mat, hBase] of rings) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.3;
      const r = R * (0.9 + rand() * 0.2);
      const h = hBase * (0.6 + rand() * 0.7);
      const w = h * (1.4 + rand() * 0.8);
      const g = jitter(new ConeGeometry(1, 1, 7, 2), 0.25, i * 13 + R);
      b.put(g, mat, [Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r], [0, rand() * 6, 0], [w, h, w * (0.7 + rand() * 0.4)], { cast: false, receive: false });
    }
  }
  // borrowed scenery: tree crowns just beyond the wall
  const crown = makeMat('#7e9a62', { rough: 1, wind: 0.002 });
  const crown2 = makeMat('#93ad70', { rough: 1, wind: 0.002 });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.15;
    const r = GARDEN_RADIUS + 3 + rand() * 6;
    const s = 1.6 + rand() * 1.6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    b.put(new CylinderGeometry(0.16, 0.26, 3.2, 6), mats.trunk, [x, 2.0, z], [0, 0, 0], 1, { cast: false, receive: false });
    for (let k = 0; k < 3; k++) {
      // flat layered cloud pads, matching the garden pines
      const pad = jitter(new CylinderGeometry(0.7, 1, 0.38, 8), 0.12, i * 3 + k);
      b.put(pad, k % 2 ? crown : crown2, [x + (rand() - 0.5) * 1.5, 2.8 + k * 0.85 + rand() * 0.5, z + (rand() - 0.5) * 1.5], [0, rand() * 6, 0], [s * (1 - k * 0.18), s * 0.8, s * (1 - k * 0.18)], { cast: false, receive: false });
    }
  }
  // ground beyond the wall, fading into the fog
  const ring = new RingGeometry(21.6, 175, 72, 3);
  ring.rotateX(-Math.PI / 2);
  b.put(ring, makeMat('#a7b27a', { rough: 1 }), [0, 0.42, 0], [0, 0, 0], 1, { cast: false, receive: false });
  const g = b.build('Horizon');
  return g;
}

export function buildStructures(mats: Mats, lampMat: MeshStandardMaterial): Group {
  const group = new Group();
  group.name = 'Structures';
  const b = new Batch();
  for (const s of STONES) scholarStone(b, mats, s.x, s.z, s.h, s.seed);
  rockery(b, mats);
  perimeterWall(b, mats);
  screenWall(b, mats);
  for (const a of LAMP_ANGLES) {
    const [lx, lz] = loopPoint(a);
    const nx = Math.cos(a) / LOOP.rx;
    const nz = Math.sin(a) / LOOP.rz;
    const nl = Math.hypot(nx, nz);
    stoneLantern(b, mats, lampMat, lx + (nx / nl) * LAMP_OFFSET, lz + (nz / nl) * LAMP_OFFSET, a);
  }
  group.add(b.build('Stone'));
  for (const a of lampAnchors.splice(0)) {
    const o = new Group();
    o.name = 'LampAnchor';
    o.position.copy(a);
    group.add(o);
  }
  group.add(horizon(mats));
  return group;
}

export function buildPenjing(mats: Mats): Group {
  const b = new Batch();
  const { x, z, w, d } = PENJING_POS;
  const y = groundHeight(x, z);
  const rand = makeRandom(4242);
  // stepped stone terrace against the north wall
  b.put(UNIT, mats.rim2, [x, y + 0.12, z], [0, 0, 0], [w, 0.3, d]);
  b.put(UNIT, mats.rim, [x, y + 0.3, z - 0.2], [0, 0, 0], [w - 0.3, 0.12, d - 0.5]);
  const potA = makeMat('#3d5d78', { rough: 0.4 });
  const potB = makeMat('#e8e3d4', { rough: 0.35 });
  const leaf = makeMat('#6f9148', { wind: 0.01 });
  for (let i = 0; i < 3; i++) {
    const px = x - w / 2 + 0.7 + i * ((w - 1.4) / 2);
    const pz = z - 0.25;
    const top = y + 0.36;
    // carved wood stand
    b.put(UNIT, mats.lacquerDark, [px, top + 0.22, pz], [0, 0, 0], [0.55, 0.44, 0.4]);
    b.put(UNIT, mats.wood, [px, top + 0.46, pz], [0, 0, 0], [0.62, 0.05, 0.46]);
    // shallow pot
    b.put(new CylinderGeometry(0.26, 0.2, 0.14, 8), i === 1 ? potB : potA, [px, top + 0.56, pz]);
    // miniature pine
    const base = new Vector3(px, top + 0.62, pz);
    const tip = base.clone().add(new Vector3((rand() - 0.5) * 0.3, 0.42, (rand() - 0.5) * 0.1));
    beam(b, UNIT, mats.trunk, base, tip, 0.05, 0.05);
    for (let k = 0; k < 3; k++) {
      const c = tip.clone().add(new Vector3((k - 1) * 0.16, -0.05 * k + 0.04, (rand() - 0.5) * 0.1));
      b.put(new CylinderGeometry(0.1, 0.14, 0.06, 7), leaf, [c.x, c.y, c.z], [0, rand() * 6, 0]);
    }
  }
  // a tall rock and lamp to anchor the composition
  b.put(jitter(new IcosahedronGeometry(1, 1), 0.38, 77), mats.rock2, [x + w / 2 + 0.6, y + 0.9, z - 0.3], [0.2, 1, 0.1], [0.4, 1.1, 0.35]);
  return b.build('Penjing');
}

/** Closed main entrance on the south wall, so the forecourt reads as an arrival court. */
export function buildEntrance(mats: Mats): Group {
  const b = new Batch();
  const z = GARDEN_RADIUS + 0.2 - 0.2;
  const gy = groundHeight(0, z - 0.6);
  const door = makeMat('#8e2f24', { rough: 0.6 });
  const stud = mats.gold;
  // recessed door frame and two leaves
  b.put(UNIT, mats.tile, [0, gy + 1.35, z - 0.2], [0, 0, 0], [2.6, 2.7, 0.12]);
  for (const sx of [-1, 1]) {
    b.put(UNIT, door, [sx * 0.6, gy + 1.2, z - 0.28], [0, 0, 0], [1.16, 2.3, 0.08]);
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 4; c++)
        b.put(new SphereGeometry(0.03, 6, 4), stud, [sx * (0.25 + c * 0.24), gy + 0.45 + r * 0.38, z - 0.33]);
    b.put(new TorusGeometry(0.08, 0.015, 4, 12), stud, [sx * 0.14, gy + 1.15, z - 0.34]);
  }
  // little tiled canopy
  tileCap(b, mats, new Vector3(-1.8, gy + 2.95, z - 0.45), new Vector3(1.8, gy + 2.95, z - 0.45), 0.9);
  for (const sx of [-1, 1]) b.put(UNIT, mats.lacquer, [sx * 1.4, gy + 1.5, z - 0.5], [0, 0, 0], [0.18, 3.0, 0.18]);
  // drum stones and potted plants
  const potMat = makeMat('#3d5d78', { rough: 0.4 });
  const leaf = makeMat('#6f9148', { wind: 0.05 });
  for (const sx of [-1, 1]) {
    b.put(new CylinderGeometry(0.3, 0.3, 0.3, 12), mats.rim, [sx * 1.0, gy + 0.45, z - 0.75], [0, 0, Math.PI / 2]);
    b.put(UNIT, mats.rim2, [sx * 1.0, gy + 0.15, z - 0.75], [0, 0, 0], [0.4, 0.3, 0.5]);
    b.put(new CylinderGeometry(0.32, 0.24, 0.5, 8), potMat, [sx * 2.6, gy + 0.25, z - 1.1]);
    b.put(jitter(new IcosahedronGeometry(1, 1), 0.22, sx > 0 ? 5 : 9), leaf, [sx * 2.6, gy + 0.85, z - 1.1], [0, 0, 0], [0.5, 0.45, 0.5]);
  }
  return b.build('Entrance');
}

export function buildTerrace(mats: Mats): Group {
  const b = new Batch();
  const { x, z } = TERRACE_POS;
  const y = groundHeight(x, z) + 0.07;
  b.put(new CylinderGeometry(0.48, 0.48, 0.1, 10), mats.rim, [x, y + 0.72, z]);
  b.put(new CylinderGeometry(0.14, 0.26, 0.7, 8), mats.rim2, [x, y + 0.35, z]);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.3;
    b.put(new CylinderGeometry(0.17, 0.15, 0.42, 10), mats.rim, [x + Math.cos(a) * 0.9, y + 0.21, z + Math.sin(a) * 0.9]);
  }
  // tea set
  const cup = makeMat('#e8e3d4', { rough: 0.3 });
  b.put(new CylinderGeometry(0.07, 0.06, 0.12, 8), cup, [x, y + 0.83, z]);
  b.put(new CylinderGeometry(0.035, 0.03, 0.04, 6), cup, [x + 0.2, y + 0.79, z + 0.05]);
  b.put(new CylinderGeometry(0.035, 0.03, 0.04, 6), cup, [x - 0.15, y + 0.79, z + 0.16]);
  return b.build('Terrace');
}
