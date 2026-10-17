import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
} from '@iwsdk/core';
import {
  GARDEN_RADIUS,
  MOON_BRIDGE,
  POND_FLOOR_Y,
  RIM_Y,
  ROCKERY,
  SCREEN_WALL,
  TERRACE,
  ZIGZAG,
  pathPolylines,
  pondField,
  pondPoint,
} from './layout.js';
import { C, Mats } from './palette.js';
import { Batch, fbm, makeMat, makeRandom, noise2 } from './util.js';

export function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Terrain height (meters) at a world XZ position. */
export function groundHeight(x: number, z: number): number {
  const f = pondField(x, z);
  const r = Math.hypot(x, z);
  let h = (fbm(x * 0.09 + 3, z * 0.09 - 7) - 0.5) * 0.34;
  h += 0.22 * smooth(17, 21.5, r);
  // gentle rise behind the rockery
  const rx = x - (ROCKERY.x - 1.2);
  const rz = z - (ROCKERY.z - 1.6);
  h += 0.55 * Math.exp(-(rx * rx + rz * rz) / 9);
  // flatten the stone terrace
  const tx = Math.max(Math.abs(x - TERRACE.x) - TERRACE.half, 0);
  const tz = Math.max(Math.abs(z - TERRACE.z) - TERRACE.half, 0);
  h = h * smooth(0, 1.2, Math.hypot(tx, tz));
  // flatten bank toward rim height
  const bankT = smooth(1.16, 1.0, f);
  h = h + (0.02 - h) * bankT;
  if (f < 1) {
    const d = smooth(1.0, 0.84, f);
    h = 0.02 + (POND_FLOOR_Y - 0.02) * d + (noise2(x * 0.7, z * 0.7) - 0.5) * 0.12 * d;
  }
  return h;
}

function buildGround(): Mesh {
  const size = 50;
  const seg = 150;
  const g = new PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const colors: number[] = [];
  const ca = new Color(C.grassA);
  const cb = new Color(C.grassB);
  const cc = new Color(C.grassC);
  const bank = new Color(C.bank);
  const bed = new Color(C.pondBed);
  const moss = new Color('#8b9a58');
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = Math.hypot(x, z) > 22.3 ? 0.15 : groundHeight(x, z);
    pos.setY(i, h);
    const n = fbm(x * 0.21 + 11, z * 0.21 + 5);
    tmp.copy(ca).lerp(cb, smooth(0.35, 0.7, n));
    tmp.lerp(cc, smooth(0.6, 0.85, fbm(x * 0.5 - 4, z * 0.5 + 9)) * 0.75);
    tmp.lerp(moss, smooth(0.55, 0.8, fbm(x * 0.33 + 21, z * 0.33 - 13)) * 0.55);
    const f = pondField(x, z);
    tmp.lerp(bank, smooth(1.12, 1.0, f));
    tmp.lerp(bed, smooth(0.97, 0.86, f));
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const mesh = new Mesh(g, m);
  mesh.name = 'Ground';
  mesh.receiveShadow = true;
  return mesh;
}

function irregularSlab(rand: () => number, w: number, d: number, t: number): BufferGeometry {
  const s = new Shape();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.3;
    // rounded rectangle-ish superellipse
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const px = Math.sign(ca) * Math.pow(Math.abs(ca), 0.55) * (w / 2) * (0.88 + rand() * 0.12);
    const pz = Math.sign(sa) * Math.pow(Math.abs(sa), 0.55) * (d / 2) * (0.88 + rand() * 0.12);
    if (i === 0) s.moveTo(px, pz);
    else s.lineTo(px, pz);
  }
  s.closePath();
  const g = new ExtrudeGeometry(s, {
    depth: t,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.03,
    bevelSegments: 1,
  });
  g.rotateX(Math.PI / 2); // extrude along -Y, top face at y = +bevel
  g.translate(0, t, 0);
  return g;
}

function distToSeg(px: number, pz: number, a: [number, number], e: [number, number]): number {
  const vx = e[0] - a[0];
  const vz = e[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t));
}

function nearBridgeLanding(x: number, z: number): boolean {
  if (distToSeg(x, z, MOON_BRIDGE.start, MOON_BRIDGE.end) < MOON_BRIDGE.width / 2 + 0.3) return true;
  for (let i = 0; i < ZIGZAG.length - 1; i++) if (distToSeg(x, z, ZIGZAG[i], ZIGZAG[i + 1]) < 1.15) return true;
  return false;
}

function buildPaths(b: Batch, mats: Mats, occupied: Set<string>) {
  const rand = makeRandom(7);
  const lines = pathPolylines();
  const placed: [number, number][] = [];
  for (const line of lines) {
    let acc = 0;
    let next = 0;
    for (let i = 1; i < line.length; i++) {
      const [x0, z0] = line[i - 1];
      const [x1, z1] = line[i];
      const seg = Math.hypot(x1 - x0, z1 - z0);
      while (next <= acc + seg) {
        const t = (next - acc) / seg;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        const yaw = Math.atan2(x1 - x0, z1 - z0);
        next += 0.94 + rand() * 0.16;
        if (pondField(x, z) < 1.1 || nearBridgeLanding(x, z)) continue;
        if (Math.abs(z - SCREEN_WALL.z) < 0.5 && Math.abs(x) < 1.6) continue;
        if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.72)) continue;
        placed.push([x, z]);
        const split = rand() < 0.14;
        const parts = split ? 2 : 1;
        for (let k = 0; k < parts; k++) {
          const w = split ? 0.66 + rand() * 0.18 : 1.3 + rand() * 0.35;
          const d = 0.62 + rand() * 0.16;
          const off = split ? (k === 0 ? -0.42 : 0.42) : (rand() - 0.5) * 0.16;
          const g = irregularSlab(rand, w, d, 0.06);
          const cx = x + Math.cos(yaw) * off;
          const cz = z - Math.sin(yaw) * off;
          const o = new Object3D();
          o.position.set(cx, groundHeight(cx, cz) + 0.005, cz);
          o.rotation.set((rand() - 0.5) * 0.03, yaw + (rand() - 0.5) * 0.16, (rand() - 0.5) * 0.03);
          b.addObject(g, rand() < 0.5 ? mats.sand : mats.sand2, o, { cast: false });
        }
        for (let gx = -2; gx <= 2; gx++)
          for (let gz = -2; gz <= 2; gz++)
            occupied.add(`${Math.round(x / 0.4) + gx},${Math.round(z / 0.4) + gz}`);
      }
      acc += seg;
    }
  }
  // stone terrace paving
  const tr = makeRandom(99);
  const n = 5;
  const cell = (TERRACE.half * 2) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = TERRACE.x - TERRACE.half + cell * (i + 0.5);
      const z = TERRACE.z - TERRACE.half + cell * (j + 0.5);
      b.put(
        new BoxGeometry(cell - 0.05, 0.08, cell - 0.05),
        tr() < 0.5 ? mats.sand : mats.sand2,
        [x, groundHeight(x, z) + 0.03, z],
        [0, (tr() - 0.5) * 0.04, 0],
        1,
        { cast: false },
      );
      occupied.add(`${Math.round(x / 0.4)},${Math.round(z / 0.4)}`);
    }
  }
  for (let gx = -6; gx <= 6; gx++)
    for (let gz = -6; gz <= 6; gz++)
      occupied.add(`${Math.round(TERRACE.x / 0.4) + gx},${Math.round(TERRACE.z / 0.4) + gz}`);
}

function buildRim(b: Batch, mats: Mats) {
  const rand = makeRandom(3);
  const N = 120;
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * Math.PI * 2;
    const t1 = ((i + 1) / N) * Math.PI * 2;
    const [x0, z0] = pondPoint(t0, 0.18);
    const [x1, z1] = pondPoint(t1, 0.18);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const h = 0.42 + rand() * 0.06;
    const g = new BoxGeometry(0.62 + rand() * 0.08, h, len * 1.04);
    b.put(g, i % 3 === 0 ? mats.rim2 : mats.rim, [cx, RIM_Y - h / 2 + rand() * 0.03, cz], [0, yaw, 0], 1, {
      cast: false,
    });
  }
  // inner wall face down to the pond bed
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * Math.PI * 2;
    const t1 = ((i + 1) / N) * Math.PI * 2;
    const [x0, z0] = pondPoint(t0, -0.12);
    const [x1, z1] = pondPoint(t1, -0.12);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    b.put(new BoxGeometry(0.25, 0.7, len * 1.05), mats.rim2, [(x0 + x1) / 2, RIM_Y - 0.62, (z0 + z1) / 2], [0, yaw, 0], 1, {
      cast: false,
    });
  }
  // scattered bank boulders, mostly where the rim meets planting
  const rock = new DodecahedronGeometry(1, 0);
  for (let i = 0; i < 26; i++) {
    const t = rand() * Math.PI * 2;
    const [x, z] = pondPoint(t, 0.55 + rand() * 0.5);
    if (nearBridgeLanding(x, z)) continue;
    const s = 0.18 + rand() * 0.3;
    b.put(rock, rand() < 0.5 ? mats.rock : mats.rock2, [x, groundHeight(x, z) + s * 0.35, z], [rand() * 3, rand() * 3, rand() * 3], [s * 1.3, s * 0.8, s]);
  }
}

function buildGrass(occupied: Set<string>): Group {
  const group = new Group();
  group.name = 'Grass';
  const blade = new BufferGeometry();
  const verts: number[] = [];
  const r = makeRandom(5);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + r() * 0.6;
    const lean = 0.06 + r() * 0.05;
    const h = 0.13 + r() * 0.12;
    const w = 0.028;
    const ox = Math.cos(a) * 0.03;
    const oz = Math.sin(a) * 0.03;
    const px = Math.cos(a + Math.PI / 2) * w;
    const pz = Math.sin(a + Math.PI / 2) * w;
    verts.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + Math.cos(a) * lean, h, oz + Math.sin(a) * lean);
  }
  blade.setAttribute('position', new Float32BufferAttribute(verts, 3));
  blade.computeVertexNormals();
  const mats = [makeMat('#a3b06a', { double: true, wind: 0.9 }), makeMat('#b0bb74', { double: true, wind: 0.9 })];
  const counts = [1050, 900];
  const rand = makeRandom(17);
  const dummy = new Object3D();
  mats.forEach((mat, mi) => {
    const inst = new InstancedMesh(blade, mat, counts[mi]);
    inst.name = `GrassTufts${mi}`;
    let n = 0;
    let guard = 0;
    while (n < counts[mi] && guard++ < 40000) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * (GARDEN_RADIUS - 0.6);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (pondField(x, z) < 1.12) continue;
      if (occupied.has(`${Math.round(x / 0.4)},${Math.round(z / 0.4)}`)) continue;
      // cluster: favor noise peaks so grass reads as clumps
      if (fbm(x * 0.4, z * 0.4) < 0.42 + rand() * 0.1) continue;
      dummy.position.set(x, groundHeight(x, z) - 0.01, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.setScalar(0.6 + rand() * 0.6);
      dummy.updateMatrix();
      inst.setMatrixAt(n++, dummy.matrix);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  });
  // wildflowers
  const flower = new ConeGeometry(0.045, 0.05, 5);
  flower.translate(0, 0.2, 0);
  const stems = new BufferGeometry();
  const fcols = ['#f2eee0', '#e9c75b', '#e6a0b0'];
  fcols.forEach((col, ci) => {
    const inst = new InstancedMesh(flower, makeMat(col, { wind: 0.9 }), 160);
    inst.name = `Flowers${ci}`;
    let n = 0;
    let guard = 0;
    while (n < 160 && guard++ < 20000) {
      const a = rand() * Math.PI * 2;
      const rr = 4 + Math.sqrt(rand()) * (GARDEN_RADIUS - 5);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (pondField(x, z) < 1.15) continue;
      if (occupied.has(`${Math.round(x / 0.4)},${Math.round(z / 0.4)}`)) continue;
      if (fbm(x * 0.3 + 40, z * 0.3) < 0.55) continue;
      dummy.position.set(x, groundHeight(x, z), z);
      dummy.rotation.set(Math.PI, 0, 0);
      dummy.rotation.set(0, rand() * 6, 0);
      dummy.scale.setScalar(0.8 + rand() * 0.6);
      dummy.updateMatrix();
      inst.setMatrixAt(n++, dummy.matrix);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  });
  stems.dispose();
  return group;
}

export function buildTerrain(mats: Mats): Group {
  const group = new Group();
  group.name = 'Terrain';
  group.add(buildGround());
  const b = new Batch();
  const occupied = new Set<string>();
  buildPaths(b, mats, occupied);
  buildRim(b, mats);
  group.add(b.build('Stonework'));
  group.add(buildGrass(occupied));
  return group;
}
