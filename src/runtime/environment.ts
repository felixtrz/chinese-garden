import {
  AmbientLight,
  AdditiveBlending,
  Object3D,
  Sprite,
  SpriteMaterial,
  BoxGeometry,
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  PCFSoftShadowMap,
  PlaneGeometry,
  PointLight,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  Vector2,
  World,
  Group,
} from '@iwsdk/core';
// Three.js add-ons are not re-exported by @iwsdk/core; `three` resolves to the same
// super-three build (package.json overrides + vite dedupe), so this shares its classes.
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import {
  CASCADE,
  PAVILION_ROT,
  PLATFORM,
  SCREEN_WALL,
  STELES,
  MOON_CENTER,
  WATER_Y,
  pondPoint,
} from '../garden/layout.js';
import { GATE_CY } from '../garden/structures.js';
import { groundHeight } from '../garden/terrain.js';
import { G } from './state.js';

interface Palette {
  t: number;
  skyTop: Color;
  skyHorizon: Color;
  fog: Color;
  sun: Color;
  sunIntensity: number;
  sunDir: Vector3;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  water: Color;
  exposure: number;
  glow: number; // lanterns, lamps, fireflies
  night: number; // stars + moon
  rim: number;
}

const P = (
  t: number,
  skyTop: string,
  skyHorizon: string,
  fog: string,
  sun: string,
  sunIntensity: number,
  sunDir: [number, number, number],
  hemiSky: string,
  hemiGround: string,
  hemiIntensity: number,
  water: string,
  exposure: number,
  glow: number,
  night: number,
  rim: number,
): Palette => ({
  t,
  skyTop: new Color(skyTop),
  skyHorizon: new Color(skyHorizon),
  fog: new Color(fog),
  sun: new Color(sun),
  sunIntensity,
  sunDir: new Vector3(...sunDir).normalize(),
  hemiSky: new Color(hemiSky),
  hemiGround: new Color(hemiGround),
  hemiIntensity,
  water: new Color(water),
  exposure,
  glow,
  night,
  rim,
});

/** One day, keyed on time-of-day 0..1 (0 = morning). The cycle loops. */
const KEYS: Palette[] = [
  P(0.0, '#b6cfd2', '#f1eee2', '#e6e9df', '#ffeccc', 2.3, [-0.72, 0.5, 0.42], '#e0e8e4', '#a8a67d', 1.2, '#6f938c', 1.0, 0, 0, 0),
  P(0.22, '#bcd3cf', '#eef1e6', '#e4eadf', '#fff1da', 2.6, [-0.4, 0.82, 0.3], '#e2ece6', '#a9a77c', 1.25, '#6f948c', 1.0, 0, 0, 0),
  P(0.45, '#a8c2c8', '#f3dcb0', '#eadcc3', '#ffd59a', 2.35, [0.62, 0.42, -0.32], '#e6e0cf', '#a99a74', 1.2, '#7a948e', 1.02, 0, 0, 0.1),
  P(0.58, '#3b4c74', '#f2a571', '#c6a593', '#ff9a5c', 1.85, [0.75, 0.22, -0.6], '#9098c4', '#8c7a6a', 1.4, '#6c6f84', 1.12, 0.8, 0.2, 0.75),
  P(0.7, '#101c38', '#34466c', '#28344c', '#aabfff', 0.75, [0.3, 0.72, 0.5], '#4c5c8e', '#302e36', 0.95, '#25334a', 1.25, 1, 1, 0.55),
  P(0.86, '#121e3a', '#3a4a70', '#2c3850', '#aabfff', 0.7, [-0.2, 0.7, 0.55], '#4e5e90', '#302e36', 0.95, '#26344c', 1.25, 1, 1, 0.5),
  P(0.94, '#9cafcd', '#f2c3aa', '#d8c6bf', '#ffc79e', 1.5, [-0.82, 0.2, 0.42], '#c6c8dc', '#958b80', 1.1, '#7b8896', 1.08, 0.35, 0.12, 0.3),
];

function paletteAt(t: number, out: Palette): Palette {
  const tt = ((t % 1) + 1) % 1;
  let i = KEYS.length - 1;
  for (let k = 0; k < KEYS.length; k++) if (KEYS[k].t <= tt) i = k;
  const a = KEYS[i];
  const b = KEYS[(i + 1) % KEYS.length];
  const span = ((b.t - a.t + 1) % 1) || 1;
  let k = (((tt - a.t + 1) % 1) / span);
  k = k * k * (3 - 2 * k);
  out.skyTop.copy(a.skyTop).lerp(b.skyTop, k);
  out.skyHorizon.copy(a.skyHorizon).lerp(b.skyHorizon, k);
  out.fog.copy(a.fog).lerp(b.fog, k);
  out.sun.copy(a.sun).lerp(b.sun, k);
  out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * k;
  out.sunDir.copy(a.sunDir).lerp(b.sunDir, k).normalize();
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, k);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, k);
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * k;
  out.water.copy(a.water).lerp(b.water, k);
  out.exposure = a.exposure + (b.exposure - a.exposure) * k;
  out.glow = a.glow + (b.glow - a.glow) * k;
  out.night = a.night + (b.night - a.night) * k;
  out.rim = a.rim + (b.rim - a.rim) * k;
  return out;
}

export interface Env {
  apply(t: number, force?: boolean): void;
  sun: DirectionalLight;
  waterMat: ShaderMaterial;
  cascadeMat: ShaderMaterial;
}

function skyDome(): { mesh: Mesh; mat: ShaderMaterial } {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new Color() },
      uHorizon: { value: new Color() },
      uSunDir: { value: new Vector3() },
      uSun: { value: new Color() },
      uDusk: { value: 0 },
      uNight: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSun; uniform float uDusk; uniform float uNight; uniform float uTime;
      varying vec3 vDir;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        float t = pow(smoothstep(-0.05, 0.75, h), 0.8);
        vec3 col = mix(uHorizon, uTop, t);
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSun * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * (0.12 + 0.35 * uDusk) * (1.0 - uNight));
        // night: crisp moon disc with a soft halo, and twinkling stars
        col += vec3(0.85, 0.9, 1.0) * uNight * (smoothstep(0.9993, 0.9996, s) * 1.4 + pow(s, 40.0) * 0.18);
        vec3 g3 = d * 110.0;
        vec3 c3 = floor(g3);
        float hs = fract(sin(dot(c3, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        float star = step(0.992, hs) * smoothstep(0.32, 0.05, length(fract(g3) - 0.5));
        star *= 0.6 + 0.4 * sin(uTime * (1.5 + hs * 3.0) + hs * 40.0);
        col += vec3(star) * uNight * smoothstep(0.04, 0.35, h) * 0.9;
        // faint painted cloud bands
        float band = sin(d.x * 6.0 + d.z * 3.0) * sin(d.z * 5.0 - d.x * 2.0);
        col = mix(col, col * 1.04 + 0.02, (1.0 - uNight) * smoothstep(0.55, 0.9, band) * smoothstep(0.05, 0.25, h) * (1.0 - smoothstep(0.45, 0.8, h)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(320, 32, 16), mat);
  mesh.name = 'SkyDome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, mat };
}

function makeWater(): { mesh: Reflector; mat: ShaderMaterial } {
  const shape = new Shape();
  const N = 160;
  for (let i = 0; i <= N; i++) {
    const [x, z] = pondPoint((i / N) * Math.PI * 2, 0.12);
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  const geom = new ShapeGeometry(shape);
  const shader = {
    name: 'GardenWater',
    uniforms: {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      uTime: { value: 0 },
      uDeep: { value: new Color('#6f948c') },
      uDusk: { value: 0 },
      uMoon: { value: new Vector2(MOON_CENTER[0], MOON_CENTER[1]) },
    },
    vertexShader: `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec3 vWorld;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform vec3 uDeep;
      uniform float uDusk;
      uniform vec2 uMoon;
      varying vec4 vUv;
      varying vec3 vWorld;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec2 w = vWorld.xz;
        float n1 = sin(w.x * 2.3 + uTime * 0.9) * sin(w.y * 2.9 - uTime * 0.7);
        float n2 = sin(w.x * 6.1 - uTime * 1.7 + w.y * 4.3) * 0.5;
        float n3 = sin(w.y * 9.0 + uTime * 2.3 - w.x * 3.0) * 0.25;
        float n = n1 + n2 + n3;
        vec4 uv = vUv;
        float calm = smoothstep(1.8, 5.0, distance(vWorld.xz, uMoon));
        uv.x += n * 0.0035 * uv.w * calm;
        uv.y += (n2 + n3) * 0.0025 * uv.w * calm;
        vec3 refl = sRGBTransferEOTF(texture2DProj(tDiffuse, uv)).rgb;
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.42 + 0.58 * pow(1.0 - clamp(V.y, 0.0, 1.0), 2.4);
        vec3 col = mix(uDeep, refl, clamp(fres * 1.05, 0.0, 1.0));
        // glints
        float g = smoothstep(1.25, 1.6, n) * (1.0 - uDusk * 0.6);
        col += vec3(g) * 0.12;
        float alpha = mix(0.55, 1.0, fres);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const mesh = new Reflector(geom, {
    clipBias: 0.002,
    textureWidth: Math.floor(window.innerWidth * dpr * (matchMedia('(pointer: coarse)').matches ? 0.4 : 0.6)),
    textureHeight: Math.floor(window.innerHeight * dpr * (matchMedia('(pointer: coarse)').matches ? 0.4 : 0.6)),
    shader,
  });
  mesh.getRenderTarget().texture.colorSpace = SRGBColorSpace;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = WATER_Y;
  mesh.name = 'WaterReflector';
  const mat = mesh.material as ShaderMaterial;
  mat.transparent = true;
  return { mesh, mat };
}

function makeCascade(): { mesh: Mesh; mat: ShaderMaterial; foam: Mesh } {
  const [tx, ty, tz] = CASCADE.top;
  const [bx, by, bz] = CASCADE.bottom;
  const len = Math.hypot(bx - tx, by - ty, bz - tz);
  const geom = new PlaneGeometry(CASCADE.width, len, 4, 16);
  // bow the sheet outward so it arcs off the lip
  const pos = geom.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const v = 0.5 - pos.getY(i) / len; // 0 top .. 1 bottom
    pos.setZ(i, Math.sin(v * Math.PI) * 0.18 - v * 0.05);
    pos.setX(i, pos.getX(i) * (1 + v * 0.35));
  }
  geom.computeVertexNormals();
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uTint: { value: new Color('#c9dcd8') } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uTint; varying vec2 vUv;
      void main(){
        float x = vUv.x; float y = vUv.y;
        float streak = 0.5 + 0.5 * sin(x * 55.0 + sin(x * 17.0) * 3.0);
        float streak2 = 0.5 + 0.5 * sin(x * 23.0 + 1.7);
        float flow = fract(y * 2.4 + uTime * 1.5 + streak2 * 0.6);
        float bands = smoothstep(0.5, 1.0, flow);
        float edge = smoothstep(0.0, 0.16, x) * smoothstep(1.0, 0.84, x);
        float a = (0.42 + 0.42 * streak * bands + 0.16 * streak2) * edge * smoothstep(0.0, 0.1, y);
        vec3 col = mix(uTint * 0.62, uTint * 1.05, 0.25 + 0.75 * bands * streak);
        col = floor(col * 6.0 + 0.5) / 6.0;
        gl_FragColor = vec4(col, a * 0.85);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geom, mat);
  mesh.name = 'Cascade';
  mesh.position.set((tx + bx) / 2, (ty + by) / 2, (tz + bz) / 2);
  mesh.lookAt(new Vector3(bx + (bz - tz), (ty + by) / 2, bz - (bx - tx)));
  // orient: plane's Y along the fall direction
  const dir = new Vector3(bx - tx, by - ty, bz - tz).normalize();
  const side = new Vector3(-(bz - tz), 0, bx - tx).normalize();
  const normal = new Vector3().crossVectors(side, dir.clone().negate()).normalize();
  const m = new Group().matrix;
  m.makeBasis(side, dir.clone().negate(), normal);
  mesh.quaternion.setFromRotationMatrix(m);
  const foam = new Mesh(
    new SphereGeometry(0.55, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    new MeshBasicMaterial({ color: '#f4f8f4', transparent: true, opacity: 0.55, depthWrite: false }),
  );
  foam.scale.set(1.2, 0.18, 0.9);
  foam.position.set(bx, WATER_Y + 0.01, bz);
  foam.name = 'CascadeFoam';
  return { mesh, mat, foam };
}

function textTexture(lines: { text: string; font: string; color: string; y: number }[], w: number, h: number, bg: string, border?: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = h * 0.06;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of lines) {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, w / 2, l.y * h);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const KAI = `"Garden Kai", "Kaiti SC", serif`;

function plaques(scene: Group) {
  const mk = (zh: string, w: number, h: number, bg: string, fg: string, border: string) =>
    new MeshStandardMaterial({
      map: textTexture([{ text: zh, font: `${Math.floor(h * 0.66)}px ${KAI}`, color: fg, y: 0.54 }], w, h, bg, border),
      roughness: 0.6,
    });
  // screen wall plaque, both faces
  const gy = groundHeight(0, SCREEN_WALL.z) - 0.05 + GATE_CY + SCREEN_WALL.gateR + 0.42;
  for (const side of [1, -1]) {
    const m = new Mesh(new PlaneGeometry(1.22, 0.4), mk(side > 0 ? '留云' : '入胜', 512, 168, '#3e4447', '#e8dcb8', '#8f7a4a'));
    m.position.set(0, gy, SCREEN_WALL.z + side * 0.272);
    if (side < 0) m.rotation.y = Math.PI;
    scene.add(m);
  }
  // pavilion plaque on the south lintel
  const pm = new Mesh(new PlaneGeometry(1.1, 0.36), mk('留云亭', 512, 168, '#2c4f4c', '#e9c86a', '#c9a24a'));
  const r = 2.05 * Math.cos(Math.PI / 6) + 0.12;
  const pa = PAVILION_ROT + Math.PI / 6;
  pm.position.set(PLATFORM.x + Math.sin(pa) * r, PLATFORM.y + 2.75 - 0.5, PLATFORM.z + Math.cos(pa) * r);
  pm.rotation.y = pa;
  scene.add(pm);
  stele(scene, STELES[0].x, STELES[0].z, STELES[0].yaw, '飞', '泉');
  stele(scene, STELES[1].x, STELES[1].z, STELES[1].yaw, '松', '风');
}

function stele(scene: Group, x: number, z: number, yaw: number, a: string, b: string) {
  const stone = new MeshStandardMaterial({ color: '#bfae95', roughness: 0.95, flatShading: true });
  const y = groundHeight(x, z);
  const g = new Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  const base = new Mesh(new BoxGeometry(0.7, 0.18, 0.34), stone);
  base.position.y = 0.09;
  const slab = new Mesh(new BoxGeometry(0.5, 1.05, 0.14), stone);
  slab.position.y = 0.7;
  const cap = new Mesh(new BoxGeometry(0.58, 0.1, 0.2), stone);
  cap.position.y = 1.27;
  const t = textTexture([], 128, 256, '#c9b89e');
  const ctx = (t.image as HTMLCanvasElement).getContext('2d')!;
  ctx.fillStyle = '#8a3324';
  ctx.font = `96px ${KAI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(a, 64, 74);
  ctx.fillText(b, 64, 182);
  t.needsUpdate = true;
  const face = new Mesh(new PlaneGeometry(0.4, 0.86), new MeshStandardMaterial({ map: t, roughness: 0.9 }));
  face.position.set(0, 0.7, 0.071);
  for (const m of [base, slab, cap]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  g.add(base, slab, cap, face);
  scene.add(g);
}

export function setupEnvironment(world: World, garden: Group): Env {
  const renderer = world.renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // No tone mapping + an sRGB reflection target: the main view and the pond's reflection
  // pass then share identical shader variants, so three.js never flips programs per frame.
  renderer.toneMapping = NoToneMapping;
  const scene = world.scene;

  const anchors: Object3D[] = [];
  // Landmarks inside the merged garden asset are found once by name here. They stay plain
  // Object3Ds rather than entities: createTransformEntity would re-parent them out of the
  // pavilion/structure hierarchy that positions them.
  const lanternMats: MeshStandardMaterial[] = [];
  const lampMats: MeshStandardMaterial[] = [];
  // restore authored shadow flags on the garden meshes
  garden.traverse((o) => {
    const m = o as Mesh;
    const s = m.userData?.shadow as { cast: boolean; receive: boolean } | undefined;
    if (m.isMesh && s) {
      m.castShadow = s.cast;
      m.receiveShadow = s.receive;
    }
    if (m.isMesh) {
      const mat = m.material as MeshStandardMaterial;
      if (mat?.name === 'LanternGlow' && !lanternMats.includes(mat)) lanternMats.push(mat);
      if (mat?.name === 'LampGlow' && !lampMats.includes(mat)) lampMats.push(mat);
    }
    if (o.name === 'WindBell') G.windBell = o;
    if (o.name === 'LanternAnchor' || o.name === 'LampAnchor') anchors.push(o);
    if (o.name === 'LanternAnchor') G.lanternAnchors.push(o);
    if (o.name === 'LampAnchor') G.lampAnchors.push(o);
  });
  const haloTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,214,150,1)');
    g.addColorStop(0.22, 'rgba(255,170,90,0.6)');
    g.addColorStop(1, 'rgba(255,140,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
  })();
  const halos: { s: Sprite; base: number; lantern: number }[] = [];
  let lanternCount = 0;
  for (const a of anchors) {
    const big = a.name === 'LanternAnchor';
    const s = new Sprite(new SpriteMaterial({ map: haloTex, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.scale.setScalar(big ? 0.95 : 0.8);
    a.add(s);
    halos.push({ s, base: big ? 0.45 : 0.42, lantern: big ? lanternCount++ : -1 });
  }
  // warm light pools on the ground beneath each stone lamp (cheap fake spill light)
  const pools: Mesh[] = [];
  const poolGeo = new PlaneGeometry(4.2, 4.2);
  poolGeo.rotateX(-Math.PI / 2);
  for (const a of anchors) {
    if (a.name !== 'LampAnchor') continue;
    const wpos = a.getWorldPosition(new Vector3());
    const m = new Mesh(poolGeo, new MeshBasicMaterial({ map: haloTex, color: '#ffb46a', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    m.position.set(wpos.x, groundHeight(wpos.x, wpos.z) + 0.04, wpos.z);
    m.renderOrder = 1;
    scene.add(m);
    pools.push(m);
  }
  const placeholder = garden.getObjectByName('WaterSurface');
  if (placeholder) placeholder.visible = false;

  const sky = skyDome();
  scene.add(sky.mesh);
  const fog = new Fog(KEYS[1].fog.clone(), 28, 175);
  scene.fog = fog;

  const hemi = new HemisphereLight(KEYS[1].hemiSky.clone(), KEYS[1].hemiGround.clone(), KEYS[1].hemiIntensity);
  scene.add(hemi);
  const ambient = new AmbientLight('#ffffff', 0.12);
  scene.add(ambient);
  const sun = new DirectionalLight(KEYS[1].sun.clone(), KEYS[1].sunIntensity);
  sun.castShadow = true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -25;
  sc.right = 25;
  sc.top = 25;
  sc.bottom = -25;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  // the garden is static: re-render the shadow map only when the light has moved
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  scene.add(sun);
  scene.add(sun.target);

  // cool rim light that only appears at dusk, keeps the lawn readable
  const rim = new DirectionalLight('#9fb4e0', 0);
  rim.position.set(-30, 18, 25);
  scene.add(rim);
  // warm dusk lights
  const pavLight = new PointLight('#ffb070', 0, 14, 1.6);
  pavLight.position.set(PLATFORM.x, PLATFORM.y + 2.4, PLATFORM.z);
  scene.add(pavLight);
  const gateLight = new PointLight('#ffc27a', 0, 10, 1.8);
  gateLight.position.set(0, 2.2, SCREEN_WALL.z - 1.2);
  scene.add(gateLight);

  const water = makeWater();
  scene.add(water.mesh);
  // the reflection only needs what can appear above the water: skip koi, ripples, grass
  garden.traverse((o) => {
    if (o.name.startsWith('Grass') || o.name.startsWith('Flowers')) G.reflectSkip.push(o);
  });
  const reflect = water.mesh.onBeforeRender.bind(water.mesh);
  const hidden: Object3D[] = [];
  water.mesh.onBeforeRender = (...args: Parameters<typeof reflect>) => {
    for (const o of G.reflectSkip)
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    reflect(...args);
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
  };
  const cascade = makeCascade();
  scene.add(cascade.mesh, cascade.foam);
  plaques(scene as unknown as Group);

  const LIT = new Color('#d0402c');
  const UNLIT = new Color('#d9d0c0');
  const DUSK_TINT = new Color('#9fb2c4');
  lanternMats.sort((a, b) => (a.userData.index ?? 0) - (b.userData.index ?? 0));
  let duskGlow = 0;
  /** Pavilion lanterns light one by one as rituals are completed, and all glow at dusk. */
  const refresh = () => {
    const lit = G.completed.size;
    const all = lit >= 7;
    lanternMats.forEach((m, i) => {
      const on = all || i < lit;
      // unlit lanterns stay dark paper; lit ones glow (brighter at dusk)
      m.color.copy(on ? LIT : UNLIT);
      m.emissiveIntensity = on ? 1.1 + duskGlow * 0.4 : duskGlow * 0.45;
    });
    for (const h of halos) {
      const on = h.lantern < 0 ? duskGlow * h.base : all || h.lantern < lit ? 0.5 + duskGlow * 0.1 : 0;
      (h.s.material as SpriteMaterial).opacity = on;
    }
  };
  G.refreshLanterns = refresh;
  const tmpC = new Color();
  const pal = paletteAt(0, { ...KEYS[0], skyTop: new Color(), skyHorizon: new Color(), fog: new Color(), sun: new Color(), sunDir: new Vector3(), hemiSky: new Color(), hemiGround: new Color(), water: new Color() });
  const lastShadowDir = new Vector3(0, 1, 0);
  let lastShadowAt = -10;
  let lastTod = -1;
  const apply = (tod: number, force = false) => {
    // the palette only needs re-evaluating when the time of day has visibly moved
    if (!force && Math.abs(tod - lastTod) < 0.0006 && G.time - lastShadowAt < 0.5) {
      sky.mat.uniforms.uTime.value = G.time;
      return;
    }
    lastTod = tod;
    paletteAt(tod, pal);
    const k = Math.min(1, pal.rim / 0.75); // "evening-ness" for secondary tweaks
    sky.mat.uniforms.uTop.value.copy(pal.skyTop);
    sky.mat.uniforms.uHorizon.value.copy(pal.skyHorizon);
    sky.mat.uniforms.uSunDir.value.copy(pal.sunDir);
    sky.mat.uniforms.uSun.value.copy(pal.sun);
    sky.mat.uniforms.uDusk.value = k;
    sky.mat.uniforms.uNight.value = pal.night;
    sky.mat.uniforms.uTime.value = G.time;
    fog.color.copy(pal.fog);
    hemi.color.copy(pal.hemiSky);
    hemi.groundColor.copy(pal.hemiGround);
    const ex = pal.exposure; // exposure is folded into light intensities
    hemi.intensity = pal.hemiIntensity * ex;
    sun.color.copy(pal.sun);
    sun.intensity = pal.sunIntensity * ex;
    sun.position.copy(pal.sunDir).multiplyScalar(45);
    if (lastShadowDir.angleTo(pal.sunDir) > 0.004 || G.time - lastShadowAt > 0.5) {
      lastShadowDir.copy(pal.sunDir);
      lastShadowAt = G.time;
      sun.shadow.needsUpdate = true;
    }
    sun.target.position.set(0, 0, 0);
    water.mat.uniforms.uDeep.value.copy(pal.water);
    water.mat.uniforms.uDusk.value = k;
    const glow = pal.glow;
    G.dusk = glow;
    duskGlow = glow;
    refresh();
    for (const m of lampMats) m.emissiveIntensity = glow * 2.0;
    pavLight.intensity = glow * 9;
    gateLight.intensity = glow * 5;
    ambient.intensity = (0.12 + 0.24 * k) * ex;
    rim.intensity = pal.rim * ex;
    for (const p of pools) (p.material as MeshBasicMaterial).opacity = glow * 0.8;
    cascade.mat.uniforms.uTint.value.copy(tmpC.set(0xc9dcd8).lerp(DUSK_TINT, Math.max(k, pal.night)));
  };
  apply(G.tod, true);
  return { apply, sun, waterMat: water.mat, cascadeMat: cascade.mat };
}
