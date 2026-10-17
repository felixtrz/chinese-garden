/**
 * Shared garden layout. Pure data + math so the asset builders (editor and
 * runtime realms) and the runtime systems (minimap, POIs, koi) agree.
 * Coordinates: +Y up, the visitor enters from +Z looking toward -Z.
 */

export const GARDEN_RADIUS = 21; // inner face of the perimeter wall
export const WATER_Y = -0.32;
export const POND_FLOOR_Y = -0.95;
export const RIM_Y = 0.14;

export const POND = { cx: 0, cz: -3, rx: 10, rz: 6.6 };

/** Irregular scale factor for the pond outline at polar angle theta. */
export function pondScale(theta: number): number {
  return (
    1 +
    0.06 * Math.sin(3 * theta + 0.7) +
    0.04 * Math.sin(5 * theta + 1.3) +
    0.025 * Math.sin(7 * theta + 2.1)
  );
}

/** Point on the pond outline, expanded outward by `offset` meters. */
export function pondPoint(theta: number, offset = 0): [number, number] {
  const s = pondScale(theta);
  const x = Math.cos(theta) * (POND.rx * s + offset);
  const z = Math.sin(theta) * (POND.rz * s + offset);
  return [POND.cx + x, POND.cz + z];
}

/** Signed "inside-ness" of the pond: < 1 inside, > 1 outside. */
export function pondField(x: number, z: number): number {
  const dx = x - POND.cx;
  const dz = z - POND.cz;
  const theta = Math.atan2(dz / POND.rz, dx / POND.rx);
  const s = pondScale(theta);
  return Math.hypot(dx / (POND.rx * s), dz / (POND.rz * s));
}

/** Pavilion platform (hexagonal, juts into the pond from the north). */
export const PLATFORM = { x: -1.2, z: -4.3, r: 3.3, y: 0.42 };
/** Corners at multiples of 60deg; side 4 faces west (moon bridge), side 0 faces SSE (zig-zag). */
export const PAVILION_ROT = 0;

/** Moon bridge: east-west arched span from the west shore to the platform. */
export const MOON_BRIDGE = {
  start: [-9.3, -4.3] as [number, number], // west landing on the rim (x, z)
  end: [-4.06, -4.3] as [number, number], // platform west side
  width: 2.1,
  rise: 1.38,
  archR: 1.62,
  y0: 0.14,
  y1: 0.46,
};

export const MOON_LEN = Math.hypot(MOON_BRIDGE.end[0] - MOON_BRIDGE.start[0], MOON_BRIDGE.end[1] - MOON_BRIDGE.start[1]);
/** Unit direction along the moon bridge (start -> end) and its left normal. */
export const MOON_DIR = [
  (MOON_BRIDGE.end[0] - MOON_BRIDGE.start[0]) / MOON_LEN,
  (MOON_BRIDGE.end[1] - MOON_BRIDGE.start[1]) / MOON_LEN,
] as [number, number];
export const MOON_CENTER = [
  (MOON_BRIDGE.start[0] + MOON_BRIDGE.end[0]) / 2,
  (MOON_BRIDGE.start[1] + MOON_BRIDGE.end[1]) / 2,
] as [number, number];

/** Deck top height at distance s (0..MOON_LEN) from the south landing. */
export function moonDeckY(s: number): number {
  const u = Math.min(1, Math.max(0, s / MOON_LEN));
  return MOON_BRIDGE.y0 + (MOON_BRIDGE.y1 - MOON_BRIDGE.y0) * u + MOON_BRIDGE.rise * Math.sin(Math.PI * u);
}

/** Zig-zag bridge from the platform (index 0) to the south shore (last). */
export const ZIGZAG: [number, number][] = [
  [0.13, -1.99],
  [1.35, -0.62],
  [-1.15, 0.95],
  [1.05, 2.45],
  [0.3, 4.15],
];
export const ZIGZAG_WIDTH = 1.9;
export const ZIGZAG_Y0 = 0.42;
export const ZIGZAG_Y1 = 0.2;

/** Freestanding screen wall with a moon gate that frames the first view. */
export const SCREEN_WALL = { z: 12.2, halfLen: 17.4, height: 3.0, gateR: 1.35 };

export const SPAWN = { x: 0, z: 17.2, yaw: 0 };

/** Main stroll loop around the pond (ellipse), radii in meters. */
export const LOOP = { cx: 0, cz: -2.6, rx: 14, rz: 10.4 };

/**
 * Content for one scenic view. Where each view is (position, radius, what to face) is authored
 * in public/scenes/main.iwsdk.scene.json as a node with a `PointOfInterest` component.
 */
export interface PoiDef {
  id: string;
  zh: string;
  en: string;
  verse: string;
  action?: string;
  hint?: string;
}

/** The seven views, in discovery-card and lantern order. */
export const POIS: PoiDef[] = [
  {
    id: 'gate',
    hint: 'The round doorway in the long white wall',
    zh: '月洞门',
    en: 'Moon Gate',
    verse: 'A round doorway frames the garden like a painted scroll.',
    action: 'Read the inscription',
  },
  {
    id: 'zigzag',
    hint: 'The bridge that zig-zags out to the pavilion',
    zh: '九曲桥',
    en: 'Nine-Turn Bridge',
    verse: 'The path bends so the view may change with every step.',
    action: 'Float a lotus lantern',
  },
  {
    id: 'pavilion',
    hint: 'The red pavilion standing in the pond',
    zh: '留云亭',
    en: 'Pavilion of Lingering Clouds',
    verse: 'Clouds pause above the water; so may you.',
    action: 'Strike the bronze bell',
  },
  {
    id: 'bridge',
    hint: 'The arched stone bridge on the west side',
    zh: '月影桥',
    en: 'Moon-Shadow Bridge',
    verse: 'Arch and reflection meet to close the full moon.',
    action: 'Feed the koi',
  },
  {
    id: 'cascade',
    hint: 'From the pavilion’s little north-west balcony',
    zh: '叠石飞泉',
    en: 'Rockery Cascade',
    verse: 'Stone piled on stone, a mountain in miniature.',
    action: 'Toss a coin — aim beneath the falls',
  },
  {
    id: 'bamboo',
    hint: 'The grove along the eastern path',
    zh: '听竹径',
    en: 'Listening-Bamboo Path',
    verse: 'Wind combs the grove; the leaves answer softly.',
    action: 'Listen to the wind',
  },
  {
    id: 'pine',
    hint: 'Beneath the old pine on the west terrace',
    zh: '松风台',
    en: 'Pine-Breeze Terrace',
    verse: 'An old pine leans over a stone table, waiting for tea.',
    action: 'Sit and rest',
  },
];

export interface TreeDef {
  x: number;
  z: number;
  scale: number;
  rot: number;
  seed: number;
}

export const PINES: TreeDef[] = [
  { x: -15.6, z: 1.6, scale: 1.25, rot: 0.6, seed: 11 },
  { x: 10.6, z: -11.8, scale: 1.15, rot: 2.4, seed: 23 },
  { x: -5.6, z: -15.6, scale: 1.05, rot: 4.1, seed: 37 },
  { x: 16.4, z: 9.6, scale: 1.0, rot: 3.3, seed: 41 },
  { x: -9.6, z: 9.6, scale: 0.95, rot: 1.2, seed: 53 },
];

export const PLUMS: TreeDef[] = [
  { x: 7.2, z: 9.4, scale: 1.0, rot: 0.3, seed: 71 },
];

/** Bamboo clump centers; the east grove straddles the bamboo path. */
export const BAMBOO: { x: number; z: number; n: number; seed: number }[] = [
  { x: 16.6, z: -1.8, n: 9, seed: 101 },
  { x: 17.8, z: 3.6, n: 8, seed: 103 },
  { x: 12.4, z: 4.6, n: 6, seed: 107 },
  { x: 10.9, z: -5.0, n: 5, seed: 109 },
  { x: 18.4, z: 0.9, n: 7, seed: 113 },
  { x: -18.2, z: -2.6, n: 7, seed: 127 },
  { x: 4.6, z: 15.8, n: 7, seed: 131 },
  { x: -5.4, z: 17.4, n: 6, seed: 137 },
  { x: 8.4, z: -16.6, n: 8, seed: 139 },
  { x: -12.0, z: 15.4, n: 6, seed: 149 },
];

/** Rockery (artificial mountain) that feeds a cascade into the pond. */
export const ROCKERY = { x: -9.3, z: -7.4 };
/** Origin of the cascade's rock spur (kept east of the moon-bridge sightline). */
export const SPUR_BASE = { x: -7.0, z: -7.4 };

/** Tall scholar stones and boulder groups. */
export const STONES: { x: number; z: number; h: number; seed: number }[] = [
  { x: -3.8, z: 10.2, h: 2.3, seed: 201 },
  { x: 9.6, z: 2.6, h: 1.9, seed: 203 },
  { x: 8.9, z: -8.3, h: 1.2, seed: 205 },
  { x: -12.3, z: 7.0, h: 1.4, seed: 207 },
  { x: 4.6, z: -14.8, h: 1.6, seed: 209 },
];

export const TERRACE = { x: -14.6, z: 3.8, half: 1.7 };

function catmull(points: [number, number][], samplesPerSeg: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < samplesPerSeg; j++) {
      const t = j / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function loopPoint(t: number): [number, number] {
  return [LOOP.cx + Math.cos(t) * LOOP.rx, LOOP.cz + Math.sin(t) * LOOP.rz];
}

/** Stepping-stone path centerlines as dense polylines (x, z). */
export function pathPolylines(): [number, number][][] {
  const loop: [number, number][] = [];
  const N = 220;
  for (let i = 0; i <= N; i++) loop.push(loopPoint((i / N) * Math.PI * 2));
  return [
    catmull(
      [
        [0, 19.8],
        [0.5, 16.4],
        [0, SCREEN_WALL.z],
        [-0.2, 9.0],
        [0.25, 6.2],
        [0.3, 4.75],
      ],
      14,
    ),
    loop,
    catmull(
      [
        [-9.9, -4.3],
        [-11.8, -4.0],
        [-13.9, -3.7],
      ],
      6,
    ),
    catmull(
      [
        [-11.2, 2.4],
        [-12.6, 3.3],
        [-13.4, 3.8],
      ],
      6,
    ),
    catmull(
      [
        [3.0, -12.9],
        [3.4, -14.3],
        [3.6, -15.3],
      ],
      5,
    ),
    catmull(
      [
        [6.2, 6.4],
        [6.6, 7.8],
        [6.4, 8.4],
      ],
      4,
    ),
  ];
}

/** Miter-offset a 2D polyline (left = positive offset). */
export function offsetPolyline(pts: [number, number][], off: number): [number, number][] {
  const out: [number, number][] = [];
  const n = pts.length;
  const normal = (a: [number, number], b: [number, number]): [number, number] => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    return [-dz / l, dx / l];
  };
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) {
      const nm = i === 0 ? normal(pts[0], pts[1]) : normal(pts[n - 2], pts[n - 1]);
      out.push([pts[i][0] + nm[0] * off, pts[i][1] + nm[1] * off]);
    } else {
      const n0 = normal(pts[i - 1], pts[i]);
      const n1 = normal(pts[i], pts[i + 1]);
      const mx = n0[0] + n1[0];
      const mz = n0[1] + n1[1];
      const ml = Math.hypot(mx, mz);
      const cos = (mx / ml) * n0[0] + (mz / ml) * n0[1];
      const k = off / Math.max(cos, 0.3);
      out.push([pts[i][0] + (mx / ml) * k, pts[i][1] + (mz / ml) * k]);
    }
  }
  return out;
}

export function zigzagY(i: number): number {
  return ZIGZAG_Y0 + (ZIGZAG_Y1 - ZIGZAG_Y0) * (i / (ZIGZAG.length - 1));
}

/** Cascade: water spills from the rockery lip into the pond. */
export const CASCADE = {
  top: [-5.5, 1.65, -7.0] as [number, number, number],
  bottom: [-4.75, -0.3, -7.25] as [number, number, number],
  width: 1.25,
};

/** Stone lanterns placed beside the stroll loop (loop parameter angles). */
export const LAMP_ANGLES = [0.55, 1.15, 2.0, 3.15, 3.7, 4.4, 5.2, 5.9];
export const LAMP_OFFSET = 1.15;

/** Engraved stone tablets beside the path (yaw: tablet face direction). */
export const STELES = [
  { x: -11.2, z: -5.3, yaw: 0.9 },
  { x: -16.0, z: 5.0, yaw: 1.57 },
];

/** Planting groups: shrubs + boulders that break up the lawn. */
export const SHRUB_CLUSTERS: [number, number, number][] = [
  [-16.6, -7.6, 4],
  [-12.2, -13.8, 3],
  [-1.8, -17.2, 3],
  [8.6, -15.6, 3],
  [14.3, -11.3, 3],
  [17.0, -5.0, 3],
  [17.6, 6.2, 3],
  [12.0, 10.2, 4],
  [-16.4, 7.2, 3],
  [3.0, 5.2, 2],
  [-5.0, 4.9, 3],
  [8.4, 3.6, 2],
  [9.2, 15.4, 3],
  [-8.6, 15.8, 3],
  [14.6, 15.8, 2],
  [-3.4, 15.0, 2],
  [-4.6, -14.6, 2],
  [-16.4, -1.2, 2],
];

/** North set piece: a low stone terrace displaying potted bonsai. */
export const PENJING = { x: 3.6, z: -16.6, w: 3.6, d: 2.0 };

/** Cascade balcony: leaves the platform at side 3 and points straight at the falls. */
export function balconyFrame() {
  const a = PAVILION_ROT + 3.5 * (Math.PI / 3);
  const apo = PLATFORM.r * Math.cos(Math.PI / 6);
  const sx = PLATFORM.x + Math.sin(a) * apo;
  const sz = PLATFORM.z + Math.cos(a) * apo;
  const dx = CASCADE.bottom[0] - sx;
  const dz = CASCADE.bottom[2] - sz;
  const l = Math.hypot(dx, dz);
  return { start: [sx, sz] as [number, number], dir: [dx / l, dz / l] as [number, number], len: 1.15 };
}
