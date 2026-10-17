import {
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from '@iwsdk/core';
// Three.js add-ons are not re-exported by @iwsdk/core; `three` resolves to the same
// super-three build (package.json overrides + vite dedupe), so this shares its classes.
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Deterministic mulberry32 PRNG. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 2D value noise in [0, 1]. */
export function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, z: number): number {
  return (
    noise2(x, z) * 0.55 + noise2(x * 2.1, z * 2.1) * 0.3 + noise2(x * 4.3, z * 4.3) * 0.15
  );
}

// ---------------------------------------------------------------------------
// Wind: a shared time uniform drives vertex sway on foliage materials.
// ---------------------------------------------------------------------------

export const windUniforms = { uWindTime: { value: 0 }, uWindStrength: { value: 1 } };

/**
 * Patch a material so vertices bend with height (local Y) using world-position
 * phase. `amount` is lateral meters at 1 m height^2 scale.
 */
export function applyWind(material: MeshStandardMaterial, amount: number, key: string) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.uWindTime;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.vertexShader =
      'uniform float uWindTime;\nuniform float uWindStrength;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wpos = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wpos = instanceMatrix * wpos;
          #endif
          wpos = modelMatrix * wpos;
          float hgt = max(transformed.y, 0.0);
          float bend = hgt * hgt * ${amount.toFixed(4)} * uWindStrength;
          float ph = wpos.x * 0.35 + wpos.z * 0.27;
          float gust = 0.65 + 0.35 * sin(uWindTime * 0.37 + wpos.x * 0.05);
          transformed.x += bend * gust * (sin(uWindTime * 1.3 + ph) * 0.8 + sin(uWindTime * 2.9 + ph * 1.7) * 0.2);
          transformed.z += bend * gust * (cos(uWindTime * 1.1 + ph * 1.3) * 0.6);
        }`,
      );
  };
  material.customProgramCacheKey = () => `wind-${key}-${amount}`;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface MatOpts {
  rough?: number;
  metal?: number;
  double?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  wind?: number;
  flat?: boolean;
}

export function makeMat(color: string, opts: MatOpts = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color(color),
    roughness: opts.rough ?? 0.92,
    metalness: opts.metal ?? 0,
    flatShading: opts.flat ?? true,
    side: opts.double ? DoubleSide : FrontSide,
  });
  if (opts.emissive) {
    m.emissive = new Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  if (opts.wind) applyWind(m, opts.wind, color);
  return m;
}

// ---------------------------------------------------------------------------
// Batch: merges many transformed geometries per material into single meshes.
// ---------------------------------------------------------------------------

function normalizeGeometry(g: BufferGeometry): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(ng.attributes)) {
    if (name !== 'position' && name !== 'normal') ng.deleteAttribute(name);
  }
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  ng.clearGroups();
  return ng;
}

interface BatchEntry {
  material: MeshStandardMaterial;
  geoms: BufferGeometry[];
  cast: boolean;
  receive: boolean;
}

export class Batch {
  private entries = new Map<MeshStandardMaterial, BatchEntry>();

  add(
    geom: BufferGeometry,
    material: MeshStandardMaterial,
    matrix?: Matrix4,
    shadow: { cast?: boolean; receive?: boolean } = {},
  ) {
    const g = normalizeGeometry(geom);
    if (matrix) g.applyMatrix4(matrix);
    let e = this.entries.get(material);
    if (!e) {
      e = { material, geoms: [], cast: false, receive: false };
      this.entries.set(material, e);
    }
    e.geoms.push(g);
    e.cast ||= shadow.cast ?? true;
    e.receive ||= shadow.receive ?? true;
  }

  /** Convenience: position / euler rotation (radians) / scale. */
  put(
    geom: BufferGeometry,
    material: MeshStandardMaterial,
    pos: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] | number = 1,
    shadow?: { cast?: boolean; receive?: boolean },
  ) {
    const o = new Object3D();
    o.position.set(pos[0], pos[1], pos[2]);
    o.rotation.set(rot[0], rot[1], rot[2]);
    if (typeof scale === 'number') o.scale.setScalar(scale);
    else o.scale.set(scale[0], scale[1], scale[2]);
    o.updateMatrix();
    this.add(geom, material, o.matrix, shadow);
  }

  /** Add with an explicit object transform. */
  addObject(geom: BufferGeometry, material: MeshStandardMaterial, o: Object3D, shadow?: { cast?: boolean; receive?: boolean }) {
    o.updateMatrix();
    this.add(geom, material, o.matrix, shadow);
  }

  build(name: string): Group {
    const group = new Group();
    group.name = name;
    let i = 0;
    for (const e of this.entries.values()) {
      const merged = mergeGeometries(e.geoms, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, e.material);
      mesh.name = `${name}-${i++}`;
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      group.add(mesh);
    }
    return group;
  }
}

export const tmpV = new Vector3();

const _beamObj = new Object3D();
const _beamUp = new Vector3(0, 1, 0);
/**
 * Add a box spanning p0 -> p1 (its local Z along the span). `w` is width (local X),
 * `h` is height (local Y).
 */
export function beam(
  b: Batch,
  geom: BufferGeometry,
  material: MeshStandardMaterial,
  p0: Vector3,
  p1: Vector3,
  w: number,
  h: number,
  shadow?: { cast?: boolean; receive?: boolean },
) {
  const len = p0.distanceTo(p1);
  _beamObj.position.copy(p0).add(p1).multiplyScalar(0.5);
  _beamObj.scale.set(w, h, len);
  _beamObj.up.copy(_beamUp);
  if (Math.abs(p1.y - p0.y) > len * 0.999) _beamObj.up.set(1, 0, 0);
  _beamObj.lookAt(p1.x + 0, p1.y, p1.z);
  // lookAt on a non-camera Object3D points +Z toward target from position
  b.addObject(geom, material, _beamObj, shadow);
}

/** Subtle plaster weathering: darker, cooler foot and soft blotches by world position. */
export function applyPlaster(material: MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vPlasterPos;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vPlasterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = 'varying vec3 vPlasterPos;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float h = clamp(vPlasterPos.y / 2.4, 0.0, 1.0);
        vec2 q = vPlasterPos.xz * 0.9 + vPlasterPos.y * 0.6;
        float n = sin(q.x * 1.7 + sin(q.y * 2.3)) * sin(q.y * 1.3 + sin(q.x * 0.7));
        float stain = smoothstep(0.35, 0.95, n) * 0.05;
        vec3 foot = vec3(0.86, 0.87, 0.82);
        diffuseColor.rgb *= mix(foot, vec3(1.0), smoothstep(0.0, 0.45, h));
        diffuseColor.rgb *= 1.0 - stain;
        diffuseColor.rgb *= 1.0 - 0.05 * smoothstep(0.85, 1.0, h);
      }`,
    );
  };
  material.customProgramCacheKey = () => 'plaster';
}
