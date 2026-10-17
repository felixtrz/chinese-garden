import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Shape,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import {
  MOON_BRIDGE,
  MOON_LEN,
  POND_FLOOR_Y,
  WATER_Y,
  ZIGZAG,
  ZIGZAG_WIDTH,
  ZIGZAG_Y0,
  ZIGZAG_Y1,
  MOON_DIR,
  moonDeckY,
  offsetPolyline,
  zigzagY,
} from './layout.js';
import { Mats } from './palette.js';
import { Batch, beam } from './util.js';

const UNIT = new BoxGeometry(1, 1, 1);

/** World position of a point on the moon bridge centerline at distance s. */
export function moonPoint(s: number, lateral = 0, dy = 0): Vector3 {
  const [dx, dz] = MOON_DIR;
  return new Vector3(
    MOON_BRIDGE.start[0] + dx * s - dz * lateral,
    moonDeckY(s) + dy,
    MOON_BRIDGE.start[1] + dz * s + dx * lateral,
  );
}

const MOON_THETA = Math.atan2(-MOON_DIR[1], MOON_DIR[0]);
const MOON_YAW = Math.atan2(MOON_DIR[0], MOON_DIR[1]);

function buildMoonBridge(b: Batch, mats: Mats) {
  const L = MOON_LEN;
  const R = MOON_BRIDGE.archR;
  const sc = L / 2;
  const W = MOON_BRIDGE.width;
  const shape = new Shape();
  shape.moveTo(0, POND_FLOOR_Y);
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * L;
    shape.lineTo(s, moonDeckY(s) - 0.06);
  }
  shape.lineTo(L, POND_FLOOR_Y);
  shape.lineTo(sc + R, POND_FLOOR_Y);
  const A = 28;
  for (let i = 0; i <= A; i++) {
    const a = (i / A) * Math.PI;
    shape.lineTo(sc + Math.cos(a) * R, WATER_Y + Math.sin(a) * R);
  }
  shape.lineTo(sc - R, POND_FLOOR_Y);
  shape.closePath();
  const body = new ExtrudeGeometry(shape, { depth: W - 0.3, bevelEnabled: false });
  body.translate(0, 0, -(W - 0.3) / 2);
  body.rotateY(MOON_THETA);
  body.translate(MOON_BRIDGE.start[0], 0, MOON_BRIDGE.start[1]);
  b.add(body, mats.rim);

  // smooth voussoir ring on both faces
  const ring = new Shape();
  const RO = R + 0.27;
  const RI = R + 0.01;
  const RS = 36;
  ring.moveTo(sc + RO, WATER_Y - 0.4);
  for (let i = 0; i <= RS; i++) {
    const a = (i / RS) * Math.PI;
    ring.lineTo(sc + Math.cos(a) * RO, WATER_Y + Math.sin(a) * RO);
  }
  ring.lineTo(sc - RO, WATER_Y - 0.4);
  ring.lineTo(sc - RI, WATER_Y - 0.4);
  for (let i = RS; i >= 0; i--) {
    const a = (i / RS) * Math.PI;
    ring.lineTo(sc + Math.cos(a) * RI, WATER_Y + Math.sin(a) * RI);
  }
  ring.lineTo(sc + RI, WATER_Y - 0.4);
  ring.closePath();
  for (const side of [-1, 1]) {
    const rg = new ExtrudeGeometry(ring, { depth: 0.07, bevelEnabled: false, curveSegments: 1 });
    rg.translate(0, 0, side > 0 ? (W - 0.3) / 2 - 0.02 : -(W - 0.3) / 2 - 0.05);
    rg.rotateY(MOON_THETA);
    rg.translate(MOON_BRIDGE.start[0], 0, MOON_BRIDGE.start[1]);
    b.add(rg, mats.sand2);
  }

  // stepped treads following the deck
  const steps = 22;
  for (let i = 0; i < steps; i++) {
    const s0 = (i / steps) * L;
    const s1 = ((i + 1) / steps) * L;
    const sm = (s0 + s1) / 2;
    const y = Math.max(moonDeckY(s0), moonDeckY(s1));
    const p = moonPoint(sm);
    b.put(UNIT, i % 2 ? mats.sand : mats.sand2, [p.x, y - 0.04, p.z], [0, MOON_YAW, 0], [W - 0.42, 0.1, (s1 - s0) * 1.02], { cast: false });
  }

  // parapets with lotus-capped posts
  for (const side of [-1, 1]) {
    const lat = side * (W / 2 - 0.13);
    const P = 10;
    for (let i = 0; i <= P; i++) {
      // leave the north parapet open at the platform end: a clear view of the cascade
      if (side < 0 && i >= P - 1) continue;
      const s = (i / P) * L;
      const p = moonPoint(s, lat);
      b.put(UNIT, mats.rim2, [p.x, p.y + 0.36, p.z], [0, 0, 0], [0.13, 0.8, 0.13]);
      b.put(new SphereGeometry(0.075, 6, 4), mats.rim, [p.x, p.y + 0.82, p.z], [0, 0, 0], [1, 0.9, 1]);
      if (i < P) {
        const q = moonPoint(((i + 1) / P) * L, lat);
        beam(b, UNIT, mats.rim, p.clone().add(new Vector3(0, 0.25, 0)), q.clone().add(new Vector3(0, 0.25, 0)), 0.07, 0.36);
        beam(b, UNIT, mats.rim2, p.clone().add(new Vector3(0, 0.6, 0)), q.clone().add(new Vector3(0, 0.6, 0)), 0.1, 0.07);
      }
    }
    // end scrolls on the land side
    const e = moonPoint(-0.25, side * (W / 2 - 0.13));
    b.put(new CylinderGeometry(0.18, 0.22, 0.4, 8), mats.rim2, [e.x, e.y + 0.08, e.z]);
  }
}

function buildZigzag(b: Batch, mats: Mats) {
  const W = ZIGZAG_WIDTH;
  const total = ZIGZAG.length - 1;
  for (let i = 0; i < total; i++) {
    const [x0, z0] = ZIGZAG[i];
    const [x1, z1] = ZIGZAG[i + 1];
    const y0 = ZIGZAG_Y0 + (ZIGZAG_Y1 - ZIGZAG_Y0) * (i / total);
    const y1 = ZIGZAG_Y0 + (ZIGZAG_Y1 - ZIGZAG_Y0) * ((i + 1) / total);
    const a = new Vector3(x0, y0, z0);
    const e = new Vector3(x1, y1, z1);
    beam(b, UNIT, mats.sand, a.clone().add(new Vector3(0, -0.08, 0)), e.clone().add(new Vector3(0, -0.08, 0)), W, 0.16, { cast: false });
    beam(b, UNIT, mats.rim2, a.clone().add(new Vector3(0, -0.22, 0)), e.clone().add(new Vector3(0, -0.22, 0)), W - 0.2, 0.14);
    // slab seams across the deck
    const segLen = a.distanceTo(e);
    const dirV = e.clone().sub(a).normalize();
    const sideV = new Vector3(-dirV.z, 0, dirV.x);
    const nSeam = Math.floor(segLen / 0.5);
    for (let k = 1; k < nSeam; k++) {
      const c = a.clone().lerp(e, k / nSeam).add(new Vector3(0, 0.002, 0));
      beam(b, UNIT, mats.rim2, c.clone().add(sideV.clone().multiplyScalar(W / 2 - 0.15)), c.clone().add(sideV.clone().multiplyScalar(-(W / 2 - 0.15))), 0.03, 0.012, { cast: false });
    }
    // piers
    for (const t of [0.25, 0.75]) {
      const p = a.clone().lerp(e, t);
      b.put(new CylinderGeometry(0.16, 0.2, p.y - POND_FLOOR_Y, 6), mats.rim2, [p.x, (p.y + POND_FLOOR_Y) / 2 - 0.15, p.z]);
    }
  }
  // railings on miter-offset polylines so corners close cleanly
  for (const sgn of [-1, 1]) {
    const line = offsetPolyline(ZIGZAG, sgn * (W / 2 - 0.08));
    for (let i = 0; i < line.length - 1; i++) {
      const pa = new Vector3(line[i][0], zigzagY(i), line[i][1]);
      const pe = new Vector3(line[i + 1][0], zigzagY(i + 1), line[i + 1][1]);
      const yaw = Math.atan2(pe.x - pa.x, pe.z - pa.z);
      beam(b, UNIT, mats.rim, pa.clone().add(new Vector3(0, 0.55, 0)), pe.clone().add(new Vector3(0, 0.55, 0)), 0.12, 0.09);
      beam(b, UNIT, mats.rim2, pa.clone().add(new Vector3(0, 0.2, 0)), pe.clone().add(new Vector3(0, 0.2, 0)), 0.08, 0.06);
      const len = pa.distanceTo(pe);
      const n = Math.max(2, Math.round(len / 0.7));
      for (let k = 0; k <= n; k++) {
        const p = pa.clone().lerp(pe, k / n);
        b.put(UNIT, mats.rim2, [p.x, p.y + 0.27, p.z], [0, yaw, 0], [0.13, 0.6, 0.13]);
      }
    }
  }
  // corner pads
  for (let i = 1; i < total; i++) {
    const [x, z] = ZIGZAG[i];
    const y = ZIGZAG_Y0 + (ZIGZAG_Y1 - ZIGZAG_Y0) * (i / total);
    b.put(new CylinderGeometry(W / 2 + 0.05, W / 2 + 0.05, 0.16, 8), mats.sand2, [x, y - 0.08, z], [0, 0, 0], 1, { cast: false });
    b.put(new CylinderGeometry(0.3, 0.34, y - POND_FLOOR_Y, 6), mats.rim2, [x, (y + POND_FLOOR_Y) / 2 - 0.15, z]);
  }
}

export function buildBridges(mats: Mats): Group {
  const b = new Batch();
  buildMoonBridge(b, mats);
  buildZigzag(b, mats);
  return b.build('Bridges');
}
