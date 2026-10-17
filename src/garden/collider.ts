import { BoxGeometry, CylinderGeometry, Group, PlaneGeometry, Vector3 } from '@iwsdk/core';
import {
  BAMBOO,
  GARDEN_RADIUS,
  LAMP_ANGLES,
  LAMP_OFFSET,
  LOOP,
  MOON_BRIDGE,
  MOON_LEN,
  PAVILION_ROT,
  PINES,
  PLATFORM,
  PLUMS,
  POND_FLOOR_Y,
  ROCKERY,
  SCREEN_WALL,
  SHRUB_CLUSTERS,
  PENJING,
  STELES,
  STONES,
  TERRACE,
  ZIGZAG,
  ZIGZAG_WIDTH,
  loopPoint,
  offsetPolyline,
  pondPoint,
  zigzagY,
  balconyFrame,
} from './layout.js';
import { groundHeight } from './terrain.js';
import { moonPoint } from './bridges.js';
import { Batch, beam, makeMat } from './util.js';

const UNIT = new BoxGeometry(1, 1, 1);
const WALL_H = 2.2;

/**
 * Invisible walkable surfaces + walls for the IWSDK locomotor. Kept simple so
 * capsule collision is cheap and predictable.
 */
export function buildCollider(): Group {
  const mat = makeMat('#ff00ff');
  const b = new Batch();

  // ground
  const g = new PlaneGeometry(46, 46, 70, 70);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  b.add(g, mat);

  // pond rim walls with gaps at the bridge landings
  const N = 110;
  const zA = ZIGZAG[ZIGZAG.length - 2];
  const zB = ZIGZAG[ZIGZAG.length - 1];
  const distSeg = (px: number, pz: number, a: [number, number], e: [number, number]) => {
    const vx = e[0] - a[0];
    const vz = e[1] - a[1];
    const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t));
  };
  for (let i = 0; i < N; i++) {
    const [x0, z0] = pondPoint((i / N) * Math.PI * 2, 0.05);
    const [x1, z1] = pondPoint(((i + 1) / N) * Math.PI * 2, 0.05);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    if (distSeg(mx, mz, MOON_BRIDGE.start, MOON_BRIDGE.end) < MOON_BRIDGE.width / 2 - 0.1) continue;
    if (distSeg(mx, mz, zA, zB) < ZIGZAG_WIDTH / 2 - 0.05) continue;
    beam(b, UNIT, mat, new Vector3(x0, 0.3, z0), new Vector3(x1, 0.3, z1), 0.3, WALL_H + 1.4);
  }

  // moon bridge deck (smooth ramp) + parapet walls
  const S = 40;
  const hw = MOON_BRIDGE.width / 2 - 0.15;
  for (let i = 0; i < S; i++) {
    const s0 = -0.5 + ((MOON_LEN + 0.8) * i) / S;
    const s1 = -0.5 + ((MOON_LEN + 0.8) * (i + 1)) / S;
    beam(b, UNIT, mat, moonPoint(s0, 0, -0.1), moonPoint(s1, 0, -0.1), hw * 2, 0.2);
    if (s1 < 0.05 || s0 > MOON_LEN - 0.05) continue;
    for (const side of [-1, 1]) {
      beam(b, UNIT, mat, moonPoint(s0, side * (hw + 0.05), 0.5), moonPoint(s1, side * (hw + 0.05), 0.5), 0.2, WALL_H);
    }
  }

  // platform top + railing walls (openings south and north)
  const plat = new CylinderGeometry(PLATFORM.r, PLATFORM.r, PLATFORM.y + 0.04 - POND_FLOOR_Y, 6);
  b.put(plat, mat, [PLATFORM.x, (PLATFORM.y + 0.04 + POND_FLOOR_Y) / 2, PLATFORM.z], [0, PAVILION_ROT, 0]);
  const corner = (r: number, k: number, y: number) =>
    new Vector3(PLATFORM.x + Math.sin(PAVILION_ROT + (k * Math.PI) / 3) * r, y, PLATFORM.z + Math.cos(PAVILION_ROT + (k * Math.PI) / 3) * r);
  for (let k = 0; k < 6; k++) {
    const c0 = corner(PLATFORM.r - 0.05, k, PLATFORM.y + 0.6);
    const c1 = corner(PLATFORM.r - 0.05, k + 1, PLATFORM.y + 0.6);
    const open = k === 4 ? 2.15 : k === 0 ? 2.0 : k === 3 ? 2.3 : 0;
    const len = c0.distanceTo(c1);
    if (open > 0) {
      beam(b, UNIT, mat, c0, c0.clone().lerp(c1, (len - open) / 2 / len), 0.25, WALL_H);
      beam(b, UNIT, mat, c0.clone().lerp(c1, (len + open) / 2 / len), c1, 0.25, WALL_H);
    } else beam(b, UNIT, mat, c0, c1, 0.25, WALL_H);
    // pavilion bench backs on four sides; columns everywhere
    const p0 = corner(2.05, k, PLATFORM.y + 0.6);
    const p1 = corner(2.05, k + 1, PLATFORM.y + 0.6);
    if (k !== 4 && k !== 0 && k !== 3) beam(b, UNIT, mat, p0, p1, 0.3, WALL_H);
    b.put(new CylinderGeometry(0.3, 0.3, WALL_H, 16), mat, [p0.x, PLATFORM.y + 1.1, p0.z]);
  }
  // balcony off side 3 (angled at the cascade): deck + three walls
  {
    const f = balconyFrame();
    const dir = new Vector3(f.dir[0], 0, f.dir[1]);
    const lat = new Vector3(dir.z, 0, -dir.x);
    const at = (r: number, l: number, y: number) =>
      new Vector3(f.start[0], y, f.start[1]).add(dir.clone().multiplyScalar(r)).add(lat.clone().multiplyScalar(l));
    beam(b, UNIT, mat, at(-0.6, 0, PLATFORM.y - 0.06), at(f.len, 0, PLATFORM.y - 0.06), 1.8, 0.2);
    beam(b, UNIT, mat, at(0.05, 0.85, PLATFORM.y + 0.6), at(f.len, 0.85, PLATFORM.y + 0.6), 0.2, WALL_H);
    beam(b, UNIT, mat, at(0.05, -0.85, PLATFORM.y + 0.6), at(f.len, -0.85, PLATFORM.y + 0.6), 0.2, WALL_H);
    beam(b, UNIT, mat, at(f.len, 0.95, PLATFORM.y + 0.6), at(f.len, -0.95, PLATFORM.y + 0.6), 0.2, WALL_H);
  }
  b.put(new CylinderGeometry(0.32, 0.32, 1, 16), mat, [PLATFORM.x, PLATFORM.y + 0.5, PLATFORM.z]);

  // zigzag deck + railings
  for (let i = 0; i < ZIGZAG.length - 1; i++) {
    const a = new Vector3(ZIGZAG[i][0], zigzagY(i) - 0.1, ZIGZAG[i][1]);
    const e = new Vector3(ZIGZAG[i + 1][0], zigzagY(i + 1) - 0.1, ZIGZAG[i + 1][1]);
    const dir = e.clone().sub(a).setY(0).normalize().multiplyScalar(0.6);
    beam(b, UNIT, mat, a.clone().sub(dir), e.clone().add(dir), ZIGZAG_WIDTH, 0.2);
  }
  for (const sgn of [-1, 1]) {
    const line = offsetPolyline(ZIGZAG, sgn * (ZIGZAG_WIDTH / 2 - 0.05));
    for (let i = 0; i < line.length - 1; i++) {
      beam(b, UNIT, mat, new Vector3(line[i][0], zigzagY(i) + 0.6, line[i][1]), new Vector3(line[i + 1][0], zigzagY(i + 1) + 0.6, line[i + 1][1]), 0.2, WALL_H);
    }
  }

  // perimeter wall
  const W = 96;
  const R = GARDEN_RADIUS - 2.8;
  for (let i = 0; i < W; i++) {
    const a0 = (i / W) * Math.PI * 2;
    const a1 = ((i + 1) / W) * Math.PI * 2;
    beam(b, UNIT, mat, new Vector3(Math.cos(a0) * R, 1, Math.sin(a0) * R), new Vector3(Math.cos(a1) * R, 1, Math.sin(a1) * R), 0.5, 4);
  }

  // screen wall with a gate opening
  const gate = 0.68;
  const swz = SCREEN_WALL.z;
  const L = SCREEN_WALL.halfLen + 0.6;
  b.put(UNIT, mat, [-(L + gate) / 2, 1.5, swz], [0, 0, 0], [L - gate, 3.5, 2.4]);
  b.put(UNIT, mat, [(L + gate) / 2, 1.5, swz], [0, 0, 0], [L - gate, 3.5, 2.4]);

  // obstacles: tree trunks, bamboo clumps, stones, rockery, lanterns
  const post = (x: number, z: number, r: number) =>
    b.put(new CylinderGeometry(r, r, 3, 16), mat, [x, groundHeight(x, z) + 1.2, z]);
  for (const t of [...PINES, ...PLUMS]) post(t.x, t.z, 0.3 * t.scale);
  for (const c of BAMBOO) post(c.x, c.z, 0.95);
  // fill gaps inside groves so the bamboo reads (and behaves) as a solid thicket
  for (let i = 0; i < BAMBOO.length; i++)
    for (let j = i + 1; j < BAMBOO.length; j++) {
      const a = BAMBOO[i];
      const c = BAMBOO[j];
      if (Math.hypot(a.x - c.x, a.z - c.z) < 4.0) post((a.x + c.x) / 2, (a.z + c.z) / 2, 0.9);
    }
  for (const [cx, cz] of SHRUB_CLUSTERS) post(cx, cz, 1.45);
  for (const s of STONES) post(s.x, s.z, 0.45 + s.h * 0.12);
  post(ROCKERY.x - 0.1, ROCKERY.z - 0.3, 1.3);
  post(-5.6, -7.15, 0.7);
  post(TERRACE.x, TERRACE.z, 0.5);
  b.put(UNIT, mat, [PENJING.x, 0.6, PENJING.z - 0.2], [0, 0, 0], [PENJING.w, 1.6, PENJING.d - 0.4]);
  for (const st of STELES) post(st.x, st.z, 0.3);
  for (const a of LAMP_ANGLES) {
    const [lx, lz] = loopPoint(a);
    const nx = Math.cos(a) / LOOP.rx;
    const nz = Math.sin(a) / LOOP.rz;
    const nl = Math.hypot(nx, nz);
    post(lx + (nx / nl) * LAMP_OFFSET, lz + (nz / nl) * LAMP_OFFSET, 0.22);
  }

  const group = b.build('Collider');
  group.traverse((o) => {
    o.visible = false;
    o.castShadow = false;
    o.receiveShadow = false;
  });
  group.visible = false;
  return group;
}
