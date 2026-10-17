import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  ConeGeometry,
  Color,
  DoubleSide,
  LatheGeometry,
  Vector2,
} from '@iwsdk/core';
import { PAVILION_ROT, PLATFORM, POND_FLOOR_Y, balconyFrame } from './layout.js';
import { Mats } from './palette.js';
import { Batch, beam, makeMat } from './util.js';

const UNIT = new BoxGeometry(1, 1, 1);

/** Angle convention matches CylinderGeometry: x = sin(phi), z = cos(phi). */
function polar(r: number, phi: number, y: number): Vector3 {
  return new Vector3(Math.sin(phi) * r, y, Math.cos(phi) * r);
}

function hexFactor(phi: number): { f: number; corner: number } {
  const seg = Math.PI / 3;
  let local = (((phi - PAVILION_ROT) % seg) + seg) % seg;
  local -= seg / 2;
  const f = Math.cos(seg / 2) / Math.cos(local);
  const corner = Math.pow(Math.abs(local) / (seg / 2), 5);
  return { f, corner };
}

interface RoofSpec {
  rTop: number;
  rEave: number;
  yTop: number;
  yEave: number;
  lift: number;
  flare: number;
}

function roofPoint(s: RoofSpec, t: number, phi: number): Vector3 {
  const { f, corner } = hexFactor(phi);
  const rad = (s.rTop + (s.rEave - s.rTop) * t) * f * (1 + s.flare * corner * t * t);
  const y = s.yTop - (s.yTop - s.yEave) * (1 - Math.pow(1 - t, 2.1)) + s.lift * corner * Math.pow(t, 3.2);
  return polar(rad, phi, y);
}

/** Concave hexagonal roof with upturned corners and a thick eave band. */
function roofGeometry(s: RoofSpec): BufferGeometry {
  const seg = 6 * 12;
  const rings = 12;
  const verts: number[] = [];
  const grid: Vector3[][] = [];
  for (let i = 0; i <= rings; i++) {
    const row: Vector3[] = [];
    for (let j = 0; j <= seg; j++) row.push(roofPoint(s, i / rings, PAVILION_ROT + (j / seg) * Math.PI * 2));
    grid.push(row);
  }
  const push = (a: Vector3, b: Vector3, c: Vector3) => verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = grid[i][j];
      const b = grid[i][j + 1];
      const c = grid[i + 1][j];
      const d = grid[i + 1][j + 1];
      push(a, c, b);
      push(b, c, d);
    }
  }
  // eave thickness band
  const outer = grid[rings];
  for (let j = 0; j < seg; j++) {
    const a = outer[j];
    const b = outer[j + 1];
    const a2 = a.clone().setY(a.y - 0.16);
    const b2 = b.clone().setY(b.y - 0.16);
    push(a, a2, b);
    push(b, a2, b2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

function addRoof(b: Batch, mats: Mats, s: RoofSpec) {
  b.add(roofGeometry(s), mats.roof);
  // tile ribs: follow the surface from ridge to eave
  const ribsPerSide = 9;
  const steps = 10;
  for (let k = 0; k < 6; k++) {
    for (let r = 1; r < ribsPerSide; r++) {
      const phi = PAVILION_ROT + (k + r / ribsPerSide) * (Math.PI / 3);
      let prev = roofPoint(s, 0.04, phi);
      for (let i = 1; i <= steps; i++) {
        const p = roofPoint(s, 0.04 + (i / steps) * 0.96, phi);
        const lift = new Vector3(0, 0.035, 0);
        beam(b, UNIT, mats.roofDark, prev.clone().add(lift), p.clone().add(lift), 0.07, 0.05, { cast: false });
        prev = p;
      }
    }
    // hip ridge along the corner, with a curled tip
    const phi = PAVILION_ROT + k * (Math.PI / 3);
    let prev = roofPoint(s, 0, phi);
    for (let i = 1; i <= 14; i++) {
      const t = i / 14;
      const p = roofPoint(s, t, phi);
      const up = new Vector3(0, 0.09, 0);
      beam(b, UNIT, mats.roofDark, prev.clone().add(up), p.clone().add(up), 0.16, 0.16);
      prev = p;
    }
    const tip = roofPoint(s, 1, phi);
    const outward = new Vector3(Math.sin(phi), 0, Math.cos(phi));
    const curl = tip.clone().add(outward.multiplyScalar(0.22)).add(new Vector3(0, 0.34, 0));
    beam(b, UNIT, mats.roofDark, tip.clone().add(new Vector3(0, 0.09, 0)), curl, 0.13, 0.13);
    b.put(new SphereGeometry(0.07, 6, 4), mats.gold, [curl.x, curl.y, curl.z]);
  }
}

function hexRing(
  b: Batch,
  mat: MeshStandardMaterial,
  r: number,
  y: number,
  w: number,
  h: number,
  skip: (k: number) => boolean = () => false,
) {
  for (let k = 0; k < 6; k++) {
    if (skip(k)) continue;
    const p0 = polar(r, PAVILION_ROT + k * (Math.PI / 3), y);
    const p1 = polar(r, PAVILION_ROT + (k + 1) * (Math.PI / 3), y);
    beam(b, UNIT, mat, p0, p1, w, h);
  }
}

/** Side k spans corners k..k+1; side 0 faces the zig-zag, side 4 the moon bridge. */
const ZIG = 0;
const MOON = 4;
const VIEW = 3;

function railing(
  b: Batch,
  mats: Mats,
  r: number,
  y: number,
  heightIn: number | ((k: number) => number),
  opening: (k: number) => number,
  postMat: MeshStandardMaterial,
  railMat: MeshStandardMaterial,
  thick = 0.08,
) {
  for (let k = 0; k < 6; k++) {
    const height = typeof heightIn === 'number' ? heightIn : heightIn(k);
    const c0 = polar(r, PAVILION_ROT + k * (Math.PI / 3), y);
    const c1 = polar(r, PAVILION_ROT + (k + 1) * (Math.PI / 3), y);
    const open = opening(k); // gap width centered on the side
    const len = c0.distanceTo(c1);
    const pieces: [number, number][] =
      open > 0
        ? [
            [0, (len - open) / 2 / len],
            [(len + open) / 2 / len, 1],
          ]
        : [[0, 1]];
    for (const [t0, t1] of pieces) {
      const a = c0.clone().lerp(c1, t0);
      const e = c0.clone().lerp(c1, t1);
      const top = new Vector3(0, height, 0);
      beam(b, UNIT, railMat, a.clone().add(top), e.clone().add(top), thick * 1.4, thick);
      beam(b, UNIT, railMat, a.clone().add(new Vector3(0, height * 0.35, 0)), e.clone().add(new Vector3(0, height * 0.35, 0)), thick, thick * 0.7);
      const segLen = a.distanceTo(e);
      const n = Math.max(1, Math.round(segLen / 0.32));
      for (let i = 0; i <= n; i++) {
        const p = a.clone().lerp(e, i / n);
        const big = i === 0 || i === n;
        b.put(UNIT, postMat, [p.x, p.y + height / 2, p.z], [0, PAVILION_ROT + (k + 0.5) * (Math.PI / 3), 0], [
          big ? thick * 1.7 : thick * 0.6,
          big ? height + 0.1 : height * 0.95,
          big ? thick * 1.7 : thick * 0.6,
        ]);
      }
    }
  }
}

const lanternAnchors: Vector3[] = [];

function lantern(b: Batch, mats: Mats, glow: MeshStandardMaterial, p: Vector3, scale = 1) {
  b.put(new CylinderGeometry(0.008, 0.008, 0.3 * scale, 4), mats.tile, [p.x, p.y - 0.15 * scale, p.z], [0, 0, 0], 1, { cast: false });
  const c = p.clone().add(new Vector3(0, -0.5 * scale, 0));
  lanternAnchors.push(c.clone());
  b.put(new SphereGeometry(0.2 * scale, 10, 7), glow, [c.x, c.y, c.z], [0, 0, 0], [1, 1.2, 1]);
  // dark ribs give the silk lantern shape and shading
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI;
    b.put(new TorusGeometry(0.205 * scale, 0.008 * scale, 3, 16), mats.lacquerDark, [c.x, c.y, c.z], [0, a, 0], [1, 1.2, 1], { cast: false });
  }
  b.put(new CylinderGeometry(0.11 * scale, 0.11 * scale, 0.06 * scale, 8), mats.gold, [c.x, c.y + 0.25 * scale, c.z]);
  b.put(new CylinderGeometry(0.11 * scale, 0.11 * scale, 0.06 * scale, 8), mats.gold, [c.x, c.y - 0.25 * scale, c.z]);
  b.put(new ConeGeometry(0.035 * scale, 0.22 * scale, 5), mats.lacquerDark, [c.x, c.y - 0.38 * scale, c.z], [Math.PI, 0, 0]);
}

export function createLanternMaterial(): MeshStandardMaterial {
  const m = makeMat('#c8402e', { rough: 0.55, emissive: '#ff7a3a', emissiveIntensity: 0.0 });
  m.name = 'LanternGlow';
  return m;
}

export function buildPavilion(mats: Mats, lanternMat: MeshStandardMaterial): Group {
  const root = new Group();
  root.name = 'Pavilion';
  const b = new Batch();
  const D = PLATFORM.y;

  // ---------- platform ----------
  const body = new CylinderGeometry(PLATFORM.r, PLATFORM.r + 0.12, D - POND_FLOOR_Y, 6);
  b.put(body, mats.rim2, [0, (D + POND_FLOOR_Y) / 2 - 0.08, 0], [0, PAVILION_ROT, 0]);
  b.put(new CylinderGeometry(PLATFORM.r + 0.14, PLATFORM.r + 0.14, 0.14, 6), mats.rim, [0, D - 0.04, 0], [0, PAVILION_ROT, 0]);
  b.put(new CylinderGeometry(PLATFORM.r - 0.25, PLATFORM.r - 0.25, 0.04, 6), mats.sand, [0, D + 0.04, 0], [0, PAVILION_ROT, 0], 1, { cast: false });
  railing(b, mats, PLATFORM.r - 0.05, D, (k) => (k === 3 || k === 4 ? 0.26 : 0.62), (k) => (k === ZIG ? 2.0 : k === MOON ? 2.15 : k === VIEW ? 2.3 : 0), mats.rim, mats.rim, 0.1);

  // small viewing balcony off side 3, angled straight at the cascade
  {
    const f = balconyFrame();
    const dir = new Vector3(f.dir[0], 0, f.dir[1]);
    const lat = new Vector3(dir.z, 0, -dir.x);
    const o = new Vector3(f.start[0] - PLATFORM.x, 0, f.start[1] - PLATFORM.z);
    const at = (r: number, l: number, y: number) => o.clone().add(dir.clone().multiplyScalar(r)).add(lat.clone().multiplyScalar(l)).setY(y);
    beam(b, UNIT, mats.rim2, at(-0.6, 0, D - 0.12), at(f.len, 0, D - 0.12), 1.95, 0.28);
    beam(b, UNIT, mats.sand, at(-0.5, 0, D + 0.02), at(f.len - 0.06, 0, D + 0.02), 1.75, 0.06, { cast: false });
    for (const l of [-0.9, 0.9]) {
      beam(b, UNIT, mats.rim, at(0.05, l, D + 0.28), at(f.len, l, D + 0.28), 0.12, 0.42);
      const pier = at(f.len - 0.25, l * 0.8, (D + POND_FLOOR_Y) / 2);
      b.put(new CylinderGeometry(0.14, 0.18, D - POND_FLOOR_Y, 6), mats.rim2, [pier.x, pier.y, pier.z]);
      const c = at(f.len, l, D + 0.55);
      b.put(new SphereGeometry(0.09, 6, 4), mats.rim2, [c.x, c.y, c.z]);
    }
    // a low kerb at the end keeps the view of the falls open
    beam(b, UNIT, mats.rim, at(f.len, -0.96, D + 0.13), at(f.len, 0.96, D + 0.13), 0.14, 0.2);
  }

  // ---------- lower storey ----------
  const colR = 2.05;
  const colTop = D + 2.75;
  for (let k = 0; k < 6; k++) {
    const p = polar(colR, PAVILION_ROT + k * (Math.PI / 3), 0);
    b.put(new CylinderGeometry(0.22, 0.26, 0.22, 8), mats.rim, [p.x, D + 0.11, p.z]);
    b.put(new CylinderGeometry(0.12, 0.13, colTop - D, 8), mats.lacquer, [p.x, (colTop + D) / 2, p.z]);
  }
  // bench railings between columns (open on south & north)
  const benchY = D + 0.45;
  for (let k = 0; k < 6; k++) {
    if (k === ZIG || k === MOON || k === VIEW) continue;
    const c0 = polar(colR, PAVILION_ROT + k * (Math.PI / 3), benchY);
    const c1 = polar(colR, PAVILION_ROT + (k + 1) * (Math.PI / 3), benchY);
    const inward = c0.clone().add(c1).multiplyScalar(-0.5).setY(0).normalize();
    const s0 = c0.clone().add(inward.clone().multiplyScalar(0.18));
    const s1 = c1.clone().add(inward.clone().multiplyScalar(0.18));
    beam(b, UNIT, mats.lacquerDark, s0, s1, 0.4, 0.07); // seat
    const back0 = c0.clone().add(new Vector3(0, 0.42, 0)).add(inward.clone().multiplyScalar(-0.06));
    const back1 = c1.clone().add(new Vector3(0, 0.42, 0)).add(inward.clone().multiplyScalar(-0.06));
    beam(b, UNIT, mats.lacquer, back0, back1, 0.07, 0.06);
    const n = 9;
    for (let i = 1; i < n; i++) {
      const p = c0.clone().lerp(c1, i / n).add(inward.clone().multiplyScalar(0.0));
      b.put(UNIT, mats.lacquer, [p.x, p.y + 0.2, p.z], [-0.25 * 0, PAVILION_ROT + (k + 0.5) * (Math.PI / 3), 0], [0.035, 0.42, 0.035]);
    }
    for (let i = 0; i <= 1; i++) {
      const p = c0.clone().lerp(c1, 0.15 + i * 0.7).add(inward.clone().multiplyScalar(0.18));
      b.put(UNIT, mats.lacquerDark, [p.x, D + 0.22, p.z], [0, 0, 0], [0.07, 0.45, 0.07]);
    }
  }
  // lintels + painted beam + fretwork frieze
  hexRing(b, mats.beam, colR, colTop - 0.08, 0.2, 0.24);
  hexRing(b, mats.gold, colR + 0.005, colTop - 0.08, 0.205, 0.04);
  hexRing(b, mats.lacquer, colR, colTop - 0.32, 0.12, 0.08);
  for (let k = 0; k < 6; k++) {
    const c0 = polar(colR, PAVILION_ROT + k * (Math.PI / 3), colTop - 0.36);
    const c1 = polar(colR, PAVILION_ROT + (k + 1) * (Math.PI / 3), colTop - 0.36);
    const n = 8;
    for (let i = 1; i < n; i++) {
      const p = c0.clone().lerp(c1, i / n);
      b.put(UNIT, mats.lacquer, [p.x, p.y - 0.12, p.z], [0, PAVILION_ROT + (k + 0.5) * (Math.PI / 3), 0], [0.03, 0.26, 0.03]);
    }
    const a = c0.clone().lerp(c1, 0.12).add(new Vector3(0, -0.25, 0));
    const e = c0.clone().lerp(c1, 0.88).add(new Vector3(0, -0.25, 0));
    beam(b, UNIT, mats.lacquer, a, e, 0.03, 0.03);
    // bracket sets (dougong) above each column
    const cp = polar(colR, PAVILION_ROT + k * (Math.PI / 3), colTop + 0.08);
    b.put(UNIT, mats.beam, [cp.x, cp.y, cp.z], [0, PAVILION_ROT + k * (Math.PI / 3), 0], [0.34, 0.12, 0.34]);
    b.put(UNIT, mats.lacquer, [cp.x, cp.y + 0.12, cp.z], [0, PAVILION_ROT + k * (Math.PI / 3), 0], [0.24, 0.12, 0.48]);
  }
  // ceiling
  b.put(new CylinderGeometry(colR + 0.15, colR + 0.15, 0.08, 6), mats.beam, [0, colTop + 0.2, 0], [0, PAVILION_ROT, 0]);
  b.put(new CylinderGeometry(0.42, 0.42, 0.02, 12), mats.gold, [0, colTop + 0.15, 0]);
  b.put(new TorusGeometry(1.25, 0.04, 4, 6), mats.gold, [0, colTop + 0.15, 0], [Math.PI / 2, 0, PAVILION_ROT]);
  for (let k = 0; k < 12; k++) {
    const a = PAVILION_ROT + (k * Math.PI) / 6;
    beam(b, UNIT, mats.lacquerDark, polar(0.42, a, colTop + 0.12), polar(colR + 0.1, a, colTop + 0.12), 0.06, 0.07, { cast: false });
  }

  // lower roof
  const lower: RoofSpec = { rTop: 1.55, rEave: 3.25, yTop: colTop + 1.05, yEave: colTop + 0.22, lift: 0.6, flare: 0.1 };
  addRoof(b, mats, lower);

  // ---------- upper storey ----------
  const upBase = lower.yTop - 0.05;
  b.put(new CylinderGeometry(1.75, 1.6, 0.22, 6), mats.lacquerDark, [0, upBase, 0], [0, PAVILION_ROT, 0]);
  b.put(new CylinderGeometry(1.85, 1.85, 0.06, 6), mats.beam, [0, upBase + 0.13, 0], [0, PAVILION_ROT, 0]);
  railing(b, mats, 1.75, upBase + 0.13, 0.42, () => 0, mats.lacquer, mats.lacquer, 0.06);
  const upColR = 1.25;
  const upTop = upBase + 2.05;
  for (let k = 0; k < 6; k++) {
    const p = polar(upColR, PAVILION_ROT + k * (Math.PI / 3), 0);
    b.put(new CylinderGeometry(0.085, 0.09, upTop - upBase, 8), mats.lacquer, [p.x, (upTop + upBase) / 2, p.z]);
  }
  hexRing(b, mats.beam, upColR, upTop - 0.06, 0.16, 0.2);
  hexRing(b, mats.gold, upColR + 0.005, upTop - 0.06, 0.165, 0.035);
  hexRing(b, mats.lacquer, upColR, upTop - 0.26, 0.09, 0.06);
  // open colonnade: hanging fretwork frieze between the upper columns
  for (let k = 0; k < 6; k++) {
    const c0 = polar(upColR, PAVILION_ROT + k * (Math.PI / 3), upTop - 0.3);
    const c1 = polar(upColR, PAVILION_ROT + (k + 1) * (Math.PI / 3), upTop - 0.3);
    const rot = PAVILION_ROT + (k + 0.5) * (Math.PI / 3);
    for (let i = 1; i < 6; i++) {
      const p = c0.clone().lerp(c1, i / 6);
      b.put(UNIT, mats.lacquer, [p.x, p.y - 0.1, p.z], [0, rot, 0], [0.025, 0.22, 0.025]);
    }
    beam(b, UNIT, mats.lacquer, c0.clone().lerp(c1, 0.1).add(new Vector3(0, -0.21, 0)), c0.clone().lerp(c1, 0.9).add(new Vector3(0, -0.21, 0)), 0.03, 0.03);
  }
  // upper ceiling with rafters
  b.put(new CylinderGeometry(upColR + 0.12, upColR + 0.12, 0.06, 6), mats.beam, [0, upTop + 0.12, 0], [0, PAVILION_ROT, 0]);
  for (let k = 0; k < 12; k++) {
    const a = PAVILION_ROT + (k * Math.PI) / 6;
    beam(b, UNIT, mats.lacquerDark, new Vector3(0, upTop + 0.07, 0), polar(upColR + 0.05, a, upTop + 0.07), 0.05, 0.05, { cast: false });
  }
  // a small seated figure-free table on the upper floor reads as usable space
  b.put(new CylinderGeometry(0.3, 0.3, 0.05, 8), mats.lacquerDark, [0, upBase + 0.75, 0]);
  b.put(new CylinderGeometry(0.06, 0.1, 0.6, 6), mats.lacquerDark, [0, upBase + 0.45, 0]);

  const upper: RoofSpec = { rTop: 0.12, rEave: 2.35, yTop: upTop + 1.85, yEave: upTop + 0.15, lift: 0.55, flare: 0.12 };
  addRoof(b, mats, upper);
  // finial
  const fy = upper.yTop;
  b.put(new CylinderGeometry(0.16, 0.22, 0.2, 8), mats.roofDark, [0, fy + 0.05, 0]);
  b.put(new SphereGeometry(0.17, 8, 6), mats.gold, [0, fy + 0.3, 0]);
  b.put(new SphereGeometry(0.11, 8, 6), mats.gold, [0, fy + 0.53, 0]);
  b.put(new ConeGeometry(0.05, 0.4, 6), mats.gold, [0, fy + 0.8, 0]);
  b.put(new TorusGeometry(0.13, 0.025, 4, 10), mats.gold, [0, fy + 0.42, 0], [Math.PI / 2, 0, 0]);

  // stone table + drum stools inside
  b.put(new CylinderGeometry(0.55, 0.55, 0.08, 10), mats.rim, [0, D + 0.78, 0]);
  b.put(new CylinderGeometry(0.16, 0.28, 0.74, 8), mats.rim2, [0, D + 0.37, 0]);
  for (let k = 0; k < 4; k++) {
    const a = k * (Math.PI / 2) + Math.PI / 4;
    b.put(new CylinderGeometry(0.17, 0.15, 0.44, 10), mats.rim, [Math.sin(a) * 0.95, D + 0.22, Math.cos(a) * 0.95]);
  }

  // corner lanterns (glow at dusk)
  for (let k = 0; k < 6; k++) {
    const tip = roofPoint(lower, 0.94, PAVILION_ROT + k * (Math.PI / 3));
    const m = lanternMat.clone();
    m.name = 'LanternGlow';
    m.userData.index = k;
    lantern(b, mats, m, tip.clone().add(new Vector3(0, -0.12, 0)), 0.9);
  }
  root.add(b.build('PavilionMesh'));
  for (const a of lanternAnchors.splice(0)) {
    const o = new Group();
    o.name = 'LanternAnchor';
    o.position.copy(a);
    root.add(o);
  }

  // bronze bell hanging from the ceiling (separate so it can swing)
  const bellPivot = new Group();
  bellPivot.name = 'WindBell';
  bellPivot.position.set(0, colTop + 0.15, 0);
  const bronze = makeMat('#5f6e52', { rough: 0.45, metal: 0.55, flat: false });
  const bronzeLight = makeMat('#c2a35a', { rough: 0.3, metal: 0.8, flat: false });
  const profile: Vector2[] = [
    new Vector2(0.001, 0),
    new Vector2(0.1, 0.0),
    new Vector2(0.15, -0.04),
    new Vector2(0.175, -0.14),
    new Vector2(0.185, -0.3),
    new Vector2(0.2, -0.44),
    new Vector2(0.235, -0.53),
    new Vector2(0.245, -0.56),
    new Vector2(0.232, -0.57),
  ];
  const bell = new Mesh(new LatheGeometry(profile, 28), bronze);
  bell.material.side = DoubleSide;
  bell.position.y = -0.3;
  bell.castShadow = true;
  const bands = [-0.3 - 0.16, -0.3 - 0.42].map((y, i) => {
    const m = new Mesh(new TorusGeometry(i ? 0.205 : 0.18, 0.012, 6, 28), bronzeLight);
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    return m;
  });
  // raised boss studs on the shoulder
  const studs: Mesh[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const st = new Mesh(new SphereGeometry(0.018, 6, 4), bronzeLight);
    st.position.set(Math.cos(a) * 0.182, -0.3 - 0.27, Math.sin(a) * 0.182);
    studs.push(st);
  }
  const crown = new Mesh(new TorusGeometry(0.06, 0.02, 8, 16), bronzeLight);
  crown.position.y = -0.27;
  const chain = new Mesh(new CylinderGeometry(0.01, 0.01, 0.3, 5), bronzeLight);
  chain.position.y = -0.14;
  bellPivot.add(bell, ...bands, ...studs, crown, chain);
  root.add(bellPivot);
  // wooden striker log hung beside the bell
  const striker = new Group();
  striker.name = 'BellStriker';
  striker.position.set(0, colTop + 0.15, 0);
  const log = new Mesh(new CylinderGeometry(0.055, 0.055, 0.7, 8), mats.wood);
  log.rotation.z = Math.PI / 2;
  log.position.set(0.6, -0.62, 0);
  const ropes = [0.42, 0.82].map((x) => {
    const r = new Mesh(new CylinderGeometry(0.006, 0.006, 0.62, 4), mats.lacquerDark);
    r.position.set(x, -0.31, 0);
    return r;
  });
  striker.add(log, ...ropes);
  root.add(striker);

  root.position.set(PLATFORM.x, 0, PLATFORM.z);
  void Color;
  return root;
}
