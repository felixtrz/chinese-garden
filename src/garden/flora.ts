import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from '@iwsdk/core';
import { BAMBOO, PINES, PLUMS, SCREEN_WALL, SHRUB_CLUSTERS, TreeDef, WATER_Y } from './layout.js';
import { DodecahedronGeometry } from '@iwsdk/core';
import { Mats } from './palette.js';
import { Batch, makeMat, makeRandom } from './util.js';
import { groundHeight } from './terrain.js';

/** Deterministically jitter vertices by position hash (keeps facets welded). */
export function jitter(g: BufferGeometry, amt: number, seed: number): BufferGeometry {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = Math.sin(Math.round(x * 1000) * 12.9898 + Math.round(y * 1000) * 78.233 + Math.round(z * 1000) * 37.719 + seed) * 43758.5453;
    const r = h - Math.floor(h);
    const h2 = Math.sin(r * 91.7 + seed) * 1234.5;
    const r2 = h2 - Math.floor(h2);
    const s = 1 + (r - 0.5) * amt;
    pos.setXYZ(i, x * s, y * (1 + (r2 - 0.5) * amt), z * s);
  }
  g.computeVertexNormals();
  return g;
}

const _seg = new Object3D();
function trunkSeg(b: Batch, mat: MeshStandardMaterial, p0: Vector3, p1: Vector3, r0: number, r1: number, sides = 7) {
  const len = p0.distanceTo(p1);
  const g = new CylinderGeometry(r1, r0, len * 1.04, sides);
  g.rotateX(Math.PI / 2);
  _seg.position.copy(p0).add(p1).multiplyScalar(0.5);
  _seg.scale.set(1, 1, 1);
  _seg.lookAt(p1);
  b.addObject(g, mat, _seg);
}

function foliagePad(b: Batch, mat: MeshStandardMaterial, c: Vector3, w: number, rand: () => number) {
  // flat, layered cloud pads like a painted pine
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = i === 0 ? 0 : w * (0.22 + rand() * 0.18);
    const r = w * (i === 0 ? 0.62 : 0.42 + rand() * 0.12);
    const h = r * 0.42;
    const g = jitter(new CylinderGeometry(r * 0.72, r, h, 8, 1), 0.12, Math.floor(rand() * 1000));
    b.put(g, mat, [c.x + Math.cos(a) * d, c.y + (i === 0 ? 0 : h * 0.45), c.z + Math.sin(a) * d], [(rand() - 0.5) * 0.12, rand() * 6, (rand() - 0.5) * 0.12]);
    // soft rounded cap on top
    const cap = jitter(new CylinderGeometry(r * 0.4, r * 0.7, h * 0.5, 8, 1), 0.15, Math.floor(rand() * 1000));
    b.put(cap, mat, [c.x + Math.cos(a) * d, c.y + (i === 0 ? 0 : h * 0.45) + h * 0.7, c.z + Math.sin(a) * d], [0, rand() * 6, 0]);
  }
}

function buildPine(b: Batch, mats: Mats, t: TreeDef) {
  const rand = makeRandom(t.seed);
  const s = t.scale;
  const base = new Vector3(t.x, groundHeight(t.x, t.z) - 0.1, t.z);
  const lean = new Vector3(Math.cos(t.rot), 0, Math.sin(t.rot));
  const pts: Vector3[] = [base.clone()];
  const H = 3.6 * s;
  const n = 7;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const bend = Math.sin(u * Math.PI * 1.3) * 0.9 * s + u * 0.5 * s;
    const wob = new Vector3(Math.sin(u * 7 + t.seed) * 0.12, 0, Math.cos(u * 5 + t.seed) * 0.12);
    pts.push(base.clone().add(new Vector3(0, u * H, 0)).add(lean.clone().multiplyScalar(bend)).add(wob));
  }
  for (let i = 0; i < n; i++) {
    const r0 = (0.24 - (i / n) * 0.16) * s;
    const r1 = (0.24 - ((i + 1) / n) * 0.16) * s;
    trunkSeg(b, mats.trunk, pts[i], pts[i + 1], r0, r1);
  }
  // root flare
  b.put(new ConeGeometry(0.42 * s, 0.5 * s, 7), mats.trunk, [base.x, base.y + 0.22, base.z]);
  const greens = [mats.pineA, mats.pineB, mats.pineC];
  // branches from upper trunk, each ending in a cloud pad
  const nb = 4 + Math.floor(rand() * 2);
  for (let k = 0; k < nb; k++) {
    const idx = 4 + Math.floor(rand() * (n - 4));
    const from = pts[idx];
    const ang = t.rot + (k / nb) * Math.PI * 2 + rand() * 0.8;
    const len = (1.2 + rand() * 1.0) * s;
    const dir = new Vector3(Math.cos(ang), 0.25 + rand() * 0.35, Math.sin(ang)).normalize();
    const mid = from.clone().add(dir.clone().multiplyScalar(len * 0.55)).add(new Vector3(0, -0.12 * s, 0));
    const end = from.clone().add(dir.clone().multiplyScalar(len));
    if (end.y - base.y < 2.75 * s) end.y = base.y + 2.75 * s;
    trunkSeg(b, mats.trunk, from, mid, 0.085 * s, 0.06 * s, 5);
    trunkSeg(b, mats.trunk, mid, end, 0.06 * s, 0.035 * s, 5);
    foliagePad(b, greens[k % 3], end.clone().add(new Vector3(0, 0.18 * s, 0)), (1.25 + rand() * 0.6) * s, rand);
  }
  foliagePad(b, greens[1], pts[n].clone().add(new Vector3(0, 0.25 * s, 0)), 1.5 * s, rand);
}

function buildPlum(b: Batch, mats: Mats, t: TreeDef) {
  const rand = makeRandom(t.seed);
  const s = t.scale;
  const base = new Vector3(t.x, groundHeight(t.x, t.z) - 0.05, t.z);
  const dark = mats.lacquerDark;
  const grow = (from: Vector3, dir: Vector3, len: number, r: number, depth: number) => {
    const to = from.clone().add(dir.clone().multiplyScalar(len));
    trunkSeg(b, depth === 0 ? mats.trunk : dark, from, to, r, r * 0.7, 5);
    if (depth >= 3) {
      // blossom clouds: flat layered pads like the pines, in blossom pink
      foliagePad(b, rand() < 0.6 ? mats.plum : mats.plum2, to, (0.75 + rand() * 0.3) * s, rand);
      return;
    }
    const kids = depth === 0 ? 3 : 2;
    for (let i = 0; i < kids; i++) {
      const nd = dir
        .clone()
        .add(new Vector3((rand() - 0.5) * 1.3, 0.15 + rand() * 0.2, (rand() - 0.5) * 1.3))
        .normalize();
      grow(to, nd, len * (0.62 + rand() * 0.15), r * 0.62, depth + 1);
    }
  };
  grow(base, new Vector3(Math.cos(t.rot) * 0.25, 1, Math.sin(t.rot) * 0.25).normalize(), 1.4 * s, 0.14 * s, 0);
}

function buildBamboo(b: Batch, mats: Mats) {
  const leaf = new BufferGeometry();
  // a drooping blade made of two triangles
  leaf.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 0.045, -0.02, 0.15, 0, -0.08, 0.32, 0, 0, 0, 0, -0.08, 0.32, -0.045, -0.02, 0.15], 3),
  );
  leaf.computeVertexNormals();
  for (const clump of BAMBOO) {
    const rand = makeRandom(clump.seed);
    for (let i = 0; i < clump.n; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * 0.95;
      const x = clump.x + Math.cos(a) * d;
      const z = clump.z + Math.sin(a) * d;
      const y0 = groundHeight(x, z) - 0.05;
      const H = 4.6 + rand() * 2.8;
      const r = 0.035 + rand() * 0.025;
      const lx = (rand() - 0.5) * 0.08;
      const lz = (rand() - 0.5) * 0.08;
      let y = y0;
      let px = x;
      let pz = z;
      while (y < y0 + H) {
        const segH = 0.38 + rand() * 0.1;
        const ny = Math.min(y + segH, y0 + H);
        const nx = px + lx * (ny - y);
        const nz = pz + lz * (ny - y);
        const p0 = new Vector3(px, y, pz);
        const p1 = new Vector3(nx, ny, nz);
        trunkSeg(b, mats.bamboo, p0, p1, r, r * 0.97, 6);
        b.put(new CylinderGeometry(r * 1.25, r * 1.25, 0.03, 6), mats.bambooNode, [nx, ny, nz]);
        y = ny;
        px = nx;
        pz = nz;
        const frac = (y - y0) / H;
        if (frac > 0.42) {
          const sprays = frac > 0.8 ? 3 : 1;
          for (let k = 0; k < sprays; k++) {
            const ang = rand() * Math.PI * 2;
            const stem = 0.12 + rand() * 0.25;
            const cx = px + Math.cos(ang) * stem;
            const cz = pz + Math.sin(ang) * stem;
            for (let l = 0; l < 5; l++) {
              const la = ang + (rand() - 0.5) * 1.6;
              const sc = 0.9 + rand() * 0.7;
              b.put(leaf, mats.bambooLeaf, [cx, y + (rand() - 0.5) * 0.1, cz], [(rand() - 0.2) * 0.6, la + Math.PI / 2, 0], sc, { cast: true });
            }
          }
        }
      }
    }
    // little shoots and stones at the clump base
    b.put(new ConeGeometry(0.05, 0.35, 5), mats.bambooNode, [clump.x + 0.6, groundHeight(clump.x + 0.6, clump.z) + 0.15, clump.z - 0.3]);
  }
}

function buildLotus(b: Batch, mats: Mats) {
  const padMat = makeMat('#6f9a50', { rough: 0.7 });
  const padMat2 = makeMat('#86ad5e', { rough: 0.7 });
  const pad = new CylinderGeometry(1, 1, 0.02, 12, 1, false, 0.35, Math.PI * 2 - 0.35);
  const clusters: [number, number, number][] = [
    [-3.6, -8.4, 6],
    [5.6, -6.0, 9],
    [6.8, -1.0, 7],
    [3.6, 1.4, 5],
    [2.2, -8.8, 6],
    [-3.4, 1.6, 4],
  ];
  const rand = makeRandom(404);
  const petal = new ConeGeometry(0.07, 0.2, 4);
  petal.translate(0, 0.1, 0);
  for (const [cx, cz, n] of clusters) {
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * 2.2;
      const z = cz + (rand() - 0.5) * 1.6;
      const r = 0.22 + rand() * 0.2;
      b.put(pad, rand() < 0.5 ? padMat : padMat2, [x, WATER_Y + 0.02, z], [0, rand() * 6, 0], [r, 1, r], { cast: false });
      if (rand() < 0.3) {
        const fy = WATER_Y + 0.05;
        for (let p = 0; p < 7; p++) {
          const a = (p / 7) * Math.PI * 2;
          b.put(petal, p % 2 ? mats.plum : mats.plum2, [x + Math.cos(a) * 0.03, fy, z + Math.sin(a) * 0.03], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], 1, { cast: false });
        }
        b.put(new IcosahedronGeometry(0.03, 0), mats.gold, [x, fy + 0.08, z]);
      }
    }
  }
}

function buildShrubs(b: Batch, mats: Mats) {
  const greens = [makeMat('#6f8f4a', { wind: 0.05 }), makeMat('#88a656', { wind: 0.05 }), makeMat('#7a9a4e', { wind: 0.05 })];
  const azalea = makeMat('#d98aa0', { wind: 0.05 });
  const rand = makeRandom(606);
  const boulder = new DodecahedronGeometry(1, 0);
  for (const [cx, cz, n] of SHRUB_CLUSTERS) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = i === 0 ? 0 : 0.5 + rand() * 0.7;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const s = 0.38 + rand() * 0.42;
      const mat = rand() < 0.06 ? azalea : greens[Math.floor(rand() * 3)];
      const y = groundHeight(x, z);
      b.put(jitter(new IcosahedronGeometry(1, 1), 0.22, Math.floor(rand() * 9999)), mat, [x, y + s * 0.42, z], [0, rand() * 6, 0], [s * 1.25, s * 0.85, s * 1.1]);
    }
    const nb = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < nb; i++) {
      const a = rand() * Math.PI * 2;
      const x = cx + Math.cos(a) * (0.9 + rand() * 0.5);
      const z = cz + Math.sin(a) * (0.9 + rand() * 0.5);
      const s = 0.22 + rand() * 0.3;
      b.put(boulder, rand() < 0.5 ? mats.rock : mats.rock2, [x, groundHeight(x, z) + s * 0.35, z], [rand() * 3, rand() * 3, rand() * 3], [s * 1.4, s * 0.9, s * 1.1]);
    }
  }
}

function buildWallPlanting(b: Batch, mats: Mats) {
  const rand = makeRandom(808);
  const greens = [makeMat('#6a8a48', { wind: 0.04 }), makeMat('#7f9d50', { wind: 0.04 }), makeMat('#5f7d42', { wind: 0.04 })];
  const moss = makeMat('#5c7a40', { rough: 1 });
  const maple = makeMat('#b9765a', { wind: 0.02 });
  const maple2 = makeMat('#c98f63', { wind: 0.02 });
  const fern = makeMat('#93ad5f', { wind: 0.1 });
  const boulder = new DodecahedronGeometry(1, 0);
  const N = 96;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rand() * 0.03;
    // keep the gate axis and the forecourt wall junctions open
    const r = 20.0 + rand() * 0.6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z > 0 && Math.abs(x) < 3.4) continue; // keep the entrance doors clear
    const y = groundHeight(x, z);
    const s = 0.4 + rand() * 0.5;
    const kind = rand();
    if (kind < 0.1) {
      // small red maple
      // small red maple: forked trunk with layered cloud pads, like the pines
      const h = 1.5 + rand() * 0.6;
      const base = new Vector3(x, y - 0.05, z);
      const fork = base.clone().add(new Vector3((rand() - 0.5) * 0.3, h * 0.55, (rand() - 0.5) * 0.3));
      trunkSeg(b, mats.trunk, base, fork, 0.11, 0.08, 6);
      for (let k = 0; k < 3; k++) {
        const ang = rand() * Math.PI * 2;
        const end = fork.clone().add(new Vector3(Math.cos(ang) * 0.7, h * 0.45 + rand() * 0.4, Math.sin(ang) * 0.7));
        trunkSeg(b, mats.trunk, fork, end, 0.06, 0.035, 5);
        foliagePad(b, k % 2 ? maple : maple2, end, 0.9 + rand() * 0.35, rand);
      }
    } else if (kind < 0.3) {
      // tall scholar rock
      const g = jitter(new IcosahedronGeometry(1, 1), 0.38, i * 5);
      b.put(g, rand() < 0.5 ? mats.rock : mats.rock2, [x, y + 0.7, z], [rand() * 0.4, rand() * 6, rand() * 0.4], [0.35, 0.9 + rand() * 0.5, 0.3]);
      b.put(jitter(new IcosahedronGeometry(1, 1), 0.25, i * 7 + 3), greens[i % 3], [x + 0.5, y + 0.25, z + 0.3], [0, rand() * 6, 0], [0.5, 0.35, 0.45]);
    } else if (kind < 0.42) {
      // fern / grass mound
      b.put(jitter(new IcosahedronGeometry(1, 0), 0.3, i * 3), fern, [x, y + 0.12, z], [0, rand() * 6, 0], [s * 1.6, s * 0.45, s * 1.3]);
    } else {
      b.put(jitter(new IcosahedronGeometry(1, 1), 0.25, i * 7 + 3), greens[i % 3], [x, y + s * 0.4, z], [0, rand() * 6, 0], [s * 1.5, s * (0.8 + rand() * 0.5), s * 1.2]);
    }
    // moss along the wall foot
    const mr = 20.85;
    b.put(jitter(new IcosahedronGeometry(1, 0), 0.3, i), moss, [Math.cos(a + 0.03) * mr, groundHeight(Math.cos(a) * mr, Math.sin(a) * mr) + 0.05, Math.sin(a + 0.03) * mr], [0, rand() * 6, 0], [0.5, 0.12, 0.35]);
    if (rand() < 0.35) {
      const bs = 0.25 + rand() * 0.35;
      const bx = Math.cos(a + 0.05) * (r - 0.6);
      const bz = Math.sin(a + 0.05) * (r - 0.6);
      b.put(boulder, rand() < 0.5 ? mats.rock : mats.rock2, [bx, groundHeight(bx, bz) + bs * 0.35, bz], [rand() * 3, rand() * 3, rand() * 3], [bs * 1.4, bs * 0.9, bs * 1.1]);
    }
  }
}

function buildScreenWallBeds(b: Batch, mats: Mats) {
  const rand = makeRandom(919);
  const greens = [makeMat('#6a8a48', { wind: 0.04 }), makeMat('#7f9d50', { wind: 0.04 })];
  for (const side of [-1, 1]) {
    for (let x = -16.5; x <= 16.5; x += 1.1) {
      if (Math.abs(x) < 2.4) continue; // keep the gate approach open
      const z = SCREEN_WALL.z + side * (0.75 + rand() * 0.25);
      const y = groundHeight(x, z);
      const s = 0.38 + rand() * 0.25;
      if (rand() < 0.22) {
        b.put(jitter(new IcosahedronGeometry(1, 1), 0.35, Math.floor(x * 10) + side), rand() < 0.5 ? mats.rock : mats.rock2, [x, y + 0.45, z], [0, rand() * 6, 0], [0.3, 0.7 + rand() * 0.4, 0.26]);
      } else {
        b.put(jitter(new IcosahedronGeometry(1, 1), 0.22, Math.floor(x * 7) + side * 3), greens[Math.floor(rand() * 2)], [x, y + s * 0.4, z], [0, rand() * 6, 0], [s * 1.3, s * 0.9, s * 1.0]);
      }
    }
  }
}

export function buildFlora(mats: Mats): Group {
  const group = new Group();
  group.name = 'Flora';
  const trees = new Batch();
  for (const p of PINES) buildPine(trees, mats, p);
  for (const p of PLUMS) buildPlum(trees, mats, p);
  buildShrubs(trees, mats);
  buildWallPlanting(trees, mats);
  buildScreenWallBeds(trees, mats);
  group.add(trees.build('Trees'));
  const bamboo = new Batch();
  buildBamboo(bamboo, mats);
  group.add(bamboo.build('Bamboo'));
  const lotus = new Batch();
  buildLotus(lotus, mats);
  group.add(lotus.build('Lotus'));
  return group;
}
