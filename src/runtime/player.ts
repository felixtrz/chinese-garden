import {
  Entity,
  Euler,
  InputComponent,
  LocomotionSystem,
  Object3D,
  Quaternion,
  Raycaster,
  Vector3,
  VisibilityState,
  createSystem,
} from '@iwsdk/core';
import { BAMBOO, CASCADE, PLATFORM, POIS, SCREEN_WALL, SPAWN, WATER_Y, pathPolylines } from '../garden/layout.js';
import { GATE_CY } from '../garden/structures.js';
import { PointOfInterest, type ViewPlacement } from '../components/point-of-interest.js';
import { groundHeight } from '../garden/terrain.js';
import { pondField } from '../garden/layout.js';
import { GardenAudio } from './audio.js';
import { Hud } from './hud.js';
import { G } from './state.js';
import { isTouch } from './touch.js';
import { effects, life } from './life.js';
import { inWater } from './effects.js';

let hud: Hud | null = null;
let audio: GardenAudio | null = null;
export function bindPlayerDeps(h: Hud, a: GardenAudio) {
  hud = h;
  audio = a;
}

function safeLock(el: HTMLElement) {
  if (isTouch) return;
  try {
    const r = el.requestPointerLock?.() as unknown as Promise<void> | undefined;
    r?.catch?.(() => {});
  } catch {
    /* pointer lock unavailable (e.g. headless); drag-to-look still works */
  }
}

const WALK = 2.3;
const RUN = 4.4;
const EYE = 1.62;

// cheap path proximity grid to pick footstep material (numeric keys: no per-frame string building)
const cellKey = (x: number, z: number) => (Math.round(x) + 64) * 128 + (Math.round(z) + 64);
const stoneCells = new Set<number>();
for (const line of pathPolylines()) for (const [x, z] of line) stoneCells.add(cellKey(x, z));

const POI_BY_ID = new Map(POIS.map((p) => [p.id, p]));
const CATALOG_ORDER = new Map(POIS.map((p, i) => [p.id, i]));

/** A placed view plus the scene object it was authored on. */
interface PlacedView extends ViewPlacement {
  object: Object3D;
  /** facing === 'node': face the node itself, so faceX/faceZ follow it */
  faceNode: boolean;
}
/** Probe distances (m) for finding open water to feed koi / float a lantern. */
const FEED_DISTS = [4.8, 4.2, 5.4, 3.6, 3.0, 2.4, 1.8];
const LANTERN_DISTS = [2.6, 3.2, 2.0, 3.8, 4.4, 1.5];

/**
 * Desktop/touch first-person controller and the garden's ritual logic.
 *
 * Scenic views are entities: scene nodes carrying a `PointOfInterest` component, gathered by
 * the `views` query. The garden itself is one static scene asset, so the rest of the shared
 * runtime state lives in `G` (src/runtime/state.ts). Movement and collision are delegated to
 * the built-in LocomotionSystem, which walks on the garden-collider entity.
 */
export class PlayerSystem extends createSystem({
  views: { required: [PointOfInterest] },
}) {
  private inXR = false;
  private sitting = false;
  private coins = 0;
  private lucky = 0;
  /** Placed views in catalog order, kept in sync with the `views` query. */
  private placed: PlacedView[] = [];
  private placedBy = new Map<Entity, PlacedView>();

  private addView(entity: Entity) {
    if (this.placedBy.has(entity) || !entity.object3D) return;
    const id = entity.getValue(PointOfInterest, 'view') as string;
    const def = POI_BY_ID.get(id);
    if (!def) {
      console.warn(`PointOfInterest: unknown view "${id}" (see POIS in src/garden/layout.ts)`);
      return;
    }
    const facing = entity.getValue(PointOfInterest, 'facing');
    const focus = entity.getVectorView(PointOfInterest, 'focus');
    const v: PlacedView = {
      def,
      object: entity.object3D,
      x: 0,
      z: 0,
      radius: entity.getValue(PointOfInterest, 'radius') as number,
      faceNode: facing === 'node',
      faceX: facing === 'focus' ? focus[0] : null,
      faceZ: facing === 'focus' ? focus[2] : null,
    };
    this.placedBy.set(entity, v);
    this.placed.push(v);
    this.placed.sort((a, b) => CATALOG_ORDER.get(a.def.id)! - CATALOG_ORDER.get(b.def.id)!);
    this.syncViewPositions();
  }

  private removeView(entity: Entity) {
    const v = this.placedBy.get(entity);
    if (!v) return;
    this.placedBy.delete(entity);
    this.placed.splice(this.placed.indexOf(v), 1);
  }

  /** Views are static in the app, but cheap to re-read so editor moves are always honoured. */
  private syncViewPositions() {
    for (const v of this.placed) {
      v.object.getWorldPosition(this.tmp);
      v.x = this.tmp.x;
      v.z = this.tmp.z;
      if (v.faceNode) {
        v.faceX = v.x;
        v.faceZ = v.z;
      }
    }
  }

  yaw = SPAWN.yaw;
  pitch = -0.04;
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private prev = new Vector3();
  private wp = new Vector3();
  private fwd = new Vector3();
  private bob = 0;
  private sitBlend = 0;
  private sitYaw = 0;
  private mapTimer = 0;
  private loco: InstanceType<typeof LocomotionSystem> | null = null;
  private allDone = false;

  /** Pending ritual/finale timeouts, cancelled if the system is torn down. */
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private later(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  init() {
    this.cleanupFuncs.push(() => {
      for (const id of this.timers) clearTimeout(id);
      this.timers.clear();
    });
    for (const e of this.queries.views.entities) this.addView(e);
    this.cleanupFuncs.push(
      this.queries.views.subscribe('qualify', (e) => this.addView(e)),
      this.queries.views.subscribe('disqualify', (e) => this.removeView(e)),
    );
    // entering/leaving an immersive session: hide the DOM HUD in the headset, pause on return
    let immersive = false;
    this.cleanupFuncs.push(
      this.visibilityState.subscribe((state) => {
        const now = state !== VisibilityState.NonImmersive;
        if (now === immersive) return;
        immersive = now;
        this.inXR = now;
        hud?.setHudVisible(!now);
        if (!now) this.setPaused(true);
      }),
    );
    const canvas = this.renderer.domElement;
    const onMove = (e: MouseEvent) => {
      if (!G.started || G.paused || this.inXR) return;
      let dx = 0;
      let dy = 0;
      if (document.pointerLockElement === canvas) {
        dx = e.movementX;
        dy = e.movementY;
      } else if (this.dragging) {
        dx = e.clientX - this.lastX;
        dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      } else return;
      const s = (document.pointerLockElement === canvas ? 0.0022 : 0.0042) * G.sensitivity;
      this.yaw -= dx * s;
      this.pitch = Math.max(-1.35, Math.min(1.25, this.pitch - dy * s));
    };
    const onDown = (e: MouseEvent) => {
      if (!G.started || G.paused || this.inXR) return;
      if (document.pointerLockElement !== canvas) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        safeLock(canvas);
      }
    };
    const onUp = () => (this.dragging = false);
    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keydown') this.keys.add(e.code);
      else this.keys.delete(e.code);
      if (e.type !== 'keydown' || e.repeat || !G.started) return;
      if (e.code === 'KeyE' || e.code === 'Enter') this.interact();
      if (e.code === 'KeyT') this.toggleTime();
      if (e.code === 'KeyM') this.toggleMute();
      if (e.code === 'KeyH') hud?.showHints();
      if (e.code === 'Escape' && !this.inXR && performance.now() - this.lastUnlock > 250) {
        if (G.paused) this.setPaused(false);
        else this.setPaused(true);
      }
      if (this.sitting && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown'].includes(e.code)) this.stand();
    };
    const onLock = () => {
      const locked = document.pointerLockElement === canvas;
      hud?.setPointerLocked(locked);
      if (!locked && G.started && !this.inXR && !this.dragging && !G.paused) {
        this.lastUnlock = performance.now();
        this.setPaused(true);
      }
    };
    document.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    document.addEventListener('pointerlockchange', onLock);
    const onBlur = () => this.keys.clear();
    window.addEventListener('blur', onBlur);
    this.cleanupFuncs.push(() => {
      document.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      document.removeEventListener('pointerlockchange', onLock);
      window.removeEventListener('blur', onBlur);
    });
  }

  setPaused(p: boolean) {
    G.paused = p;
    hud?.setPaused(p);
    if (!p) safeLock(this.renderer.domElement);
  }

  toggleTime() {
    const order = ['cycle', 'day', 'dusk', 'night'] as const;
    G.todMode = order[(order.indexOf(G.todMode) + 1) % order.length];
    G.todRush = -1;
    const msg = {
      cycle: 'Time flows again — a full day passes every minute.',
      day: 'Holding the bright light of day.',
      dusk: 'Holding the golden dusk; lanterns glow.',
      night: 'Holding the night — stars, moon and fireflies.',
    }[G.todMode];
    hud?.note(msg);
    hud?.syncSettings();
  }

  toggleMute() {
    G.muted = !G.muted;
    audio?.setMuted(G.muted);
    hud?.note(G.muted ? 'Sound off' : 'Sound on', 1400);
    hud?.syncSettings();
  }

  private stand() {
    if (!this.sitting) return;
    this.sitting = false;
    hud?.note('', 1);
  }

  interact() {
    if (this.sitting) {
      this.stand();
      return;
    }
    const poi = G.nearPoi ? POI_BY_ID.get(G.nearPoi) : undefined;
    if (!poi?.action) {
      this.player.getWorldPosition(this.wp);
      let best: PlacedView | null = null;
      let bd = Infinity;
      for (const v of this.placed) {
        const d = Math.hypot(v.x - this.wp.x, v.z - this.wp.z);
        if (v.def.action && d < v.radius + 4 && d < bd) {
          bd = d;
          best = v;
        }
      }
      if (best) {
        const { en, action } = best.def;
        hud?.note(bd < best.radius ? `Turn toward the ${en} to ${action!.toLowerCase()}.` : `Step closer to the ${en} to ${action!.toLowerCase()}.`, 2600);
      }
      else {
        hud?.note('Nothing to do here — the red rings on the map mark scenic spots.', 2600);
        hud?.pulseMap();
      }
      return;
    }
    const t = G.time;
    if (poi.id === 'bridge') {
      const pt = this.waterInView(FEED_DISTS, true);
      if (!pt) {
        hud?.note('Face the water to scatter the food.');
        return;
      }
      this.camera.getWorldPosition(this.wp);
      this.camera.getWorldDirection(this.fwd);
      G.feedOrigin = [this.wp.x + this.fwd.x * 1.0, this.wp.y - 0.5, this.wp.z + this.fwd.z * 1.0];
      G.feedPoint = pt;
      this.focusOn(pt[0], WATER_Y, pt[1], 2.5);
      G.feedUntil = t + 16;
      G.koiFollowUntil = t + 60;
      G.feeds++;
      this.later(() => {
        const n = life?.koiNear(pt[0], pt[1], 1.8) ?? 0;
        hud?.note(n > 0 ? `${n} koi crowd the surface${G.feeds >= 3 ? ' — they know you now and will follow you along the shore.' : '.'}` : 'The koi are still on their way…', 3200);
      }, 3800);
      audio?.splash();
      hud?.note('You scatter a handful of food — the koi come gliding.');
      this.complete('bridge');
    } else if (poi.id === 'pavilion') {
      const harmony = t - G.bellStrikeAt > 0.9 && t - G.bellStrikeAt < 4.5;
      G.bellStrikeAt = t;
      this.later(() => audio?.bell(1), 480);
      if (harmony) {
        this.later(() => audio?.bell(0.8, 1.5), 520);
        this.later(() => {
          effects?.flock(PLATFORM.x, PLATFORM.y + 6.5, PLATFORM.z, 9, 2);
          for (let i = 0; i < 8; i++) this.later(() => effects?.sparkle(PLATFORM.x + (Math.random() - 0.5) * 6, 1 + Math.random() * 4, PLATFORM.z + (Math.random() - 0.5) * 6, 1.4, 1.5), i * 90);
        }, 600);
        hud?.note('Two strikes in harmony — the whole pond answers.', 3600);
      }
      if (G.windBell) {
        G.windBell.getWorldPosition(this.tmp);
        this.player.getWorldPosition(this.wp);
        this.focusOn(this.tmp.x, Math.min(this.tmp.y - 0.75, this.wp.y + 2.1), this.tmp.z, 2.2);
        const b = this.tmp.clone();
        this.later(() => effects?.sparkle(b.x, b.y - 0.7, b.z, 1.6, 1.2), 500);
      }
      if (!harmony) hud?.note('A deep bronze note rolls out over the water. Strike again as it fades for a harmony.', 3600);
      this.complete('pavilion');
    } else if (poi.id === 'zigzag') {
      // place the lantern where you look on the water, if possible
      this.camera.getWorldPosition(this.tmp);
      this.camera.getWorldDirection(this.fwd);
      let pt: [number, number] | null = null;
      if (this.fwd.y < -0.05) {
        const tHit = (WATER_Y - this.tmp.y) / this.fwd.y;
        const hx = this.tmp.x + this.fwd.x * tHit;
        const hz = this.tmp.z + this.fwd.z * tHit;
        if (tHit < 7 && inWater(hx, hz, 0.86)) pt = [hx, hz];
      }
      pt ??= this.waterInView(LANTERN_DISTS, true);
      if (!pt) {
        hud?.note('Face the water to set a lantern afloat.');
        return;
      }
      this.player.getWorldPosition(this.wp);
      effects?.floatLantern(pt[0], pt[1], pt[0] - this.wp.x, pt[1] - this.wp.z);
      effects?.splash(pt[0], pt[1], 8, 0.7);
      effects?.sparkle(pt[0], WATER_Y + 0.25, pt[1], 0.9, 1.2);
      this.focusOn(pt[0], WATER_Y + 0.2, pt[1], 2.4);
      audio?.splash();
      hud?.note(G.dusk > 0.5 ? 'A lotus lantern drifts out, glowing on the dark water.' : 'A lotus lantern drifts out — it will glow when night falls.');
      this.complete('zigzag');
    } else if (poi.id === 'bamboo') {
      G.gustAt = t;
      this.player.getWorldPosition(this.wp);
      effects?.gust(this.wp.x, this.wp.z);
      audio?.gust();
      hud?.note('A gust sweeps through the grove; the bamboo sways and whispers.');
      this.focusOn(this.wp.x + 3.5, 4.5, this.wp.z, 2.4);
      this.complete('bamboo');
    } else if (poi.id === 'gate') {
      this.player.getWorldPosition(this.wp);
      const south = this.wp.z > SCREEN_WALL.z;
      const py = groundHeight(0, SCREEN_WALL.z) - 0.05 + GATE_CY + SCREEN_WALL.gateR + 0.42;
      const pz = SCREEN_WALL.z + (south ? 0.3 : -0.3);
      const side = south ? 1 : -1;
      this.playShot(4.6, 0.6, (t, p, tg) => {
        p.set(0.7 - t * 0.12, py - 0.55, SCREEN_WALL.z + side * (3.6 - t * 0.15));
        tg.set(0, py - 0.05, pz);
      });
      this.later(() => {
        effects?.sparkle(-0.3, py, pz, 0.9, 1.4);
        effects?.sparkle(0.3, py, pz, 0.9, 1.4);
      }, 450);
      audio?.chime();
      if (south) hud?.toast('Inscription', '留云', '“Where clouds linger”', 'The garden’s name, carved above the gate. Look back from inside for its partner: 入胜.', 7000);
      else hud?.toast('Inscription', '入胜', '“Entering the scenic realm”', 'Carved on the garden side of the gate; its partner outside reads 留云, “where clouds linger.”', 7000);
      this.complete('gate');
    } else if (poi.id === 'cascade') {
      this.camera.getWorldPosition(this.wp);
      // honest aim: the coin flies along the view and lands where the view meets the water
      this.camera.getWorldDirection(this.fwd);
      let to: [number, number, number];
      let onWater = false;
      if (G.time - this.lastAim[2] < 0.25) {
        const [hx, hz] = this.lastAim;
        onWater = pondField(hx, hz) < 0.97;
        to = [hx, onWater ? WATER_Y : groundHeight(hx, hz) + 0.02, hz];
      } else if (this.fwd.y < -0.05) {
        const tHit = Math.min((WATER_Y - this.wp.y) / this.fwd.y, 7);
        const hx = this.wp.x + this.fwd.x * tHit;
        const hz = this.wp.z + this.fwd.z * tHit;
        onWater = pondField(hx, hz) < 0.97;
        to = [hx, onWater ? WATER_Y : groundHeight(hx, hz) + 0.02, hz];
      } else {
        // looking level or up: a short arc a few metres ahead
        const hx = this.wp.x + this.fwd.x * 3.5;
        const hz = this.wp.z + this.fwd.z * 3.5;
        onWater = pondField(hx, hz) < 0.97;
        to = [hx, onWater ? WATER_Y : groundHeight(hx, hz) + 0.02, hz];
      }
      effects?.tossCoin([this.wp.x, this.wp.y - 0.25, this.wp.z], to);
      if (effects)
        effects.onCoinLand = () => {
          if (!onWater) {
            hud?.note('The coin clinks onto the stones and rolls away — aim at the ring of stones beneath the falls.', 3600);
            return;
          }
          for (let i = 0; i < 3; i++) this.later(() => life?.spawnRipple(to[0], to[2], 0.6 + i * 0.4, 1.8), i * 180);
          this.coins++;
          effects?.restCoin(to[0], to[2]);
          const lucky = Math.hypot(to[0] - CASCADE.bottom[0], to[2] - CASCADE.bottom[2]) < 0.75;
          if (lucky) audio?.chime();
          if (lucky) {
            this.lucky++;
            for (let i = 0; i < 5; i++) this.later(() => effects?.sparkle(to[0] + (Math.random() - 0.5) * 0.8, WATER_Y + 0.2 + Math.random() * 0.8, to[2] + (Math.random() - 0.5) * 0.5, 1.2, 1.2), i * 120);
            this.later(() => audio?.bell(0.45), 300);
            effects?.splash(to[0], to[2], 24, 1.3);
            effects?.pulse(to[0], WATER_Y + 0.03, to[2], 0.25);
            hud?.note(`Right into the heart of the falls — great fortune! (${this.lucky} lucky ${this.lucky > 1 ? 'coins' : 'coin'})`, 4200);
          } else
            hud?.note(`Plop — a miss. The coin sinks (${this.coins} in the pond). Aim the ring inside the stones beneath the falls for luck.`, 4200);
        };
      audio?.splash();
      this.complete('cascade');
    } else if (poi.id === 'pine') {
      this.sitting = true;
      this.player.getWorldPosition(this.wp);
      this.sitYaw = Math.atan2(-(PLATFORM.x - this.wp.x), -(PLATFORM.z - this.wp.z));
      hud?.note('You rest beneath the old pine. Press E or move to stand.', 4200);
      this.complete('pine');
    }
  }

  // A geometric line-of-sight test against the static garden mesh, not a pointer interaction,
  // so a plain Raycaster is the right tool here (RayInteractable is for selectable entities).
  private ray = new Raycaster();
  private losDir = new Vector3();
  /** True when nothing in the garden blocks the line from the eye to a point. */
  private visible(x: number, y: number, z: number): boolean {
    if (!G.garden) return true;
    this.camera.getWorldPosition(this.tmp);
    const dir = this.losDir.set(x, y, z).sub(this.tmp);
    const dist = dir.length();
    this.ray.set(this.tmp, dir.normalize());
    this.ray.camera = this.camera;
    this.ray.far = dist - 0.15;
    const hits = this.ray.intersectObject(G.garden, true);
    return !hits.some((h) => h.object.visible && !h.object.name.startsWith('Grass') && !h.object.name.startsWith('Flowers'));
  }

  /** First point on the water along the view direction (or to either side), as a new tuple. */
  private waterInView(dists: number[], los = false): [number, number] | null {
    return this.findWater(dists, los) ? [this.waterHit[0], this.waterHit[1]] : null;
  }

  // probe directions (x, z pairs) and the hit, reused every frame while a water ritual is near
  private probeDirs = new Float32Array(14);
  private waterHit = new Float32Array(2);
  /** Allocation-free probe; writes the hit to `waterHit`. */
  private findWater(dists: number[], los: boolean): boolean {
    this.player.getWorldPosition(this.wp);
    this.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    this.fwd.normalize();
    const fx = this.fwd.x;
    const fz = this.fwd.z;
    const d = 0.7071;
    const dirs = this.probeDirs;
    // ahead, ±45°, ±90°, ±135°
    dirs[0] = fx; dirs[1] = fz;
    dirs[2] = (fx - fz) * d; dirs[3] = (fz + fx) * d;
    dirs[4] = (fx + fz) * d; dirs[5] = (fz - fx) * d;
    dirs[6] = -fz; dirs[7] = fx;
    dirs[8] = fz; dirs[9] = -fx;
    dirs[10] = (-fx - fz) * d; dirs[11] = (-fz + fx) * d;
    dirs[12] = (-fx + fz) * d; dirs[13] = (-fz - fx) * d;
    for (let i = 0; i < 14; i += 2)
      for (const r of dists) {
        const x = this.wp.x + dirs[i] * r;
        const z = this.wp.z + dirs[i + 1] * r;
        if (inWater(x, z, 0.86) && (!los || this.visible(x, WATER_Y + 0.12, z))) {
          this.waterHit[0] = x;
          this.waterHit[1] = z;
          return true;
        }
      }
    return los ? this.findWater(dists, false) : false;
  }

  private introBlend = 0;
  private introPos = new Vector3();
  private introQuat = new Quaternion();
  private eyeQuat = new Quaternion();
  private eyeEuler = new Euler(0, 0, 0, 'YXZ');
  private introTarget = new Vector3(-1.5, 0.8, -3.5);
  private smoothY = 0;
  private gaitAmp = 0;
  private stepSide = 0;
  private onStone(): boolean {
    return stoneCells.has(cellKey(this.wp.x, this.wp.z)) || this.wp.y > 0.3;
  }
  private lastAim: [number, number, number] = [0, 0, -10];
  private lastCardAt = -10;
  private cardQueue: string[] = [];
  private lastRescue = -10;
  private focus = new Vector3();
  private focusUntil = -1;
  private tmp = new Vector3();
  private safe = new Vector3(0, 0.2, 17.2);
  private rescuePos = new Vector3();
  private shotEyeQ = new Quaternion();
  private shotQ = new Quaternion();
  private shotEyeP = new Vector3();

  private complete(id: string) {
    if (G.completed.has(id)) return;
    G.completed.add(id);
    G.refreshLanterns?.();
    hud?.updateProgress();
    const n = G.completed.size;
    const poi = POI_BY_ID.get(id)!;
    hud?.ritual(poi, n, POIS.length);
    this.later(() => {
      audio?.chime();
      const anchor = this.lanternAnchor(n - 1);
      if (anchor && n < POIS.length) {
        anchor.getWorldPosition(this.tmp);
        effects?.sparkle(this.tmp.x, this.tmp.y, this.tmp.z, 2.2, 1.6);
        this.player.getWorldPosition(this.wp);
      }
    }, 2400);
    if (n === POIS.length && !this.allDone) {
      this.allDone = true;
      this.later(() => this.finale(), 3200);
    }
  }

  private lanternAnchor(i: number): Object3D | null {
    return G.lanternAnchors[i] ?? null;
  }

  private shotAt = -100;
  private shotDur = 0;
  private shotArc = 0;
  private shotPos = new Vector3();
  private shotTgt = new Vector3();
  private shotFn: ((t: number, pos: Vector3, target: Vector3) => void) | null = null;
  playShot(dur: number, arc: number, fn: (t: number, pos: Vector3, target: Vector3) => void) {
    this.shotAt = G.time;
    this.shotDur = dur;
    this.shotArc = arc;
    this.shotFn = fn;
  }
  private finale() {
    // build up: lamps around the stroll light one after another, then dusk, lanterns and the pull-back
    const lamps = G.lampAnchors;
    lamps.forEach((l, i) =>
      this.later(() => {
        const p = l.getWorldPosition(this.tmp);
        effects?.sparkle(p.x, p.y, p.z, 1.8, 1.4);
        if (i % 2 === 0) audio?.chime();
      }, i * 280),
    );
    this.later(() => this.finaleRest(), lamps.length * 280 + 300);
  }

  private finaleRest() {
    if (!this.sitting) {
      // land back facing the lit pavilion and the lotus lights
      this.player.getWorldPosition(this.wp);
      this.yaw = Math.atan2(-(PLATFORM.x - this.wp.x), -(PLATFORM.z - this.wp.z));
      this.pitch = 0.04;
    }
    const tgt = this.introTarget;
    this.playShot(9, 2.5, (t, p, tg) => {
      const a = Math.PI / 2 + 0.4 - t * 0.09;
      p.set(tgt.x + Math.cos(a) * 14, 8.5, tgt.z + Math.sin(a) * 14);
      tg.copy(tgt);
    });
    // the finale always plays into evening, then the day keeps turning
    G.todMode = 'night';
    G.todRush = -1;
    hud?.syncSettings();
    hud?.finale();
    audio?.bell(0.7);
    this.later(() => audio?.chime(), 900);
    life?.shower();
    const spots: [number, number][] = [];
    for (let i = 0; i < 80 && spots.length < 12; i++) {
      const x = -9 + Math.random() * 18;
      const z = -9 + Math.random() * 12;
      if (inWater(x, z, 0.8) && spots.every(([a, b]) => Math.hypot(a - x, b - z) > 1.6)) spots.push([x, z]);
    }
    spots.forEach(([x, z], i) => this.later(() => effects?.floatLantern(x, z), 600 + i * 260));
    effects?.flock(-1.2, 7, -4.3, 7, 1.5);
  }

  /** Touch look: radians of yaw/pitch to apply. */
  addLook(dx: number, dy: number) {
    if (!G.started || G.paused || this.inXR) return;
    this.yaw -= dx * G.sensitivity;
    this.pitch = Math.max(-1.35, Math.min(1.25, this.pitch - dy * G.sensitivity));
  }

  promptLabel: string | null = null;

  /** Briefly steer the view toward a world point so actions are seen. */
  focusOn(x: number, y: number, z: number, seconds = 2.2) {
    this.focus.set(x, y, z);
    this.focusUntil = G.time + seconds;
  }
  private safeTimer = 0;
  private lastUnlock = 0;

  update(delta: number, time: number) {
    if (!G.ready) return;
    const dt = Math.min(delta, 0.05);
    if (!this.loco) this.loco = this.world.getSystem(LocomotionSystem) ?? null;
    this.inXR = !!this.renderer.xr.isPresenting;

    // speed gating
    const canMove = G.started && !G.paused && !this.sitting;
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || G.touchRun;
    if (this.loco) {
      const want = this.inXR ? 2.6 : canMove ? (run ? RUN : G.walkOverride ?? WALK) : 0;
      if (this.loco.config.slidingSpeed.peek() !== want) this.loco.config.slidingSpeed.value = want;
    }

    // XR controller shortcuts
    if (this.inXR) {
      const right = this.input.xr.gamepads.right;
      if (right?.getButtonDown(InputComponent.A_Button)) this.interact();
      if (right?.getButtonDown(InputComponent.B_Button)) this.toggleTime();
    }

    // camera look (browser only)
    this.player.getWorldPosition(this.wp);
    this.safeTimer -= dt;
    if (this.wp.y > -0.15 && this.safeTimer <= 0) {
      this.safe.copy(this.wp);
      this.safeTimer = 0.5;
    }
    if (this.wp.y < -0.45 && this.loco) {
      this.rescuePos.copy(this.safe).y += 0.2;
      this.loco.setPlayerPosition(this.rescuePos);
      if (G.time - this.lastRescue > 3) {
        hud?.flash();
        hud?.note('You step back onto solid ground.', 1800);
      }
      this.lastRescue = G.time;
    }
    const speed = this.prev.distanceTo(this.wp) / Math.max(dt, 1e-4);
    this.prev.copy(this.wp);
    G.playerSpeed = G.playerSpeed + (Math.min(speed, 8) - G.playerSpeed) * Math.min(1, dt * 8);
    if (!this.inXR) {
      this.sitBlend += ((this.sitting ? 1 : 0) - this.sitBlend) * Math.min(1, dt * 2.5);
      if (this.sitting) {
        let d = this.sitYaw - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw += d * Math.min(1, dt * 1.5);
      }
      if (time < this.focusUntil) {
        this.camera.getWorldPosition(this.tmp);
        const dx = this.focus.x - this.tmp.x;
        const dy = this.focus.y - this.tmp.y;
        const dz = this.focus.z - this.tmp.z;
        const wantYaw = Math.atan2(-dx, -dz);
        const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        let dyaw = wantYaw - this.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        const k = Math.min(1, dt * 2.2);
        this.yaw += dyaw * k;
        this.pitch += (wantPitch - this.pitch) * k;
      }
      else if (time < this.focusUntil + 1.2 && this.focusUntil > 0) {
        this.pitch += (-0.04 - this.pitch) * Math.min(1, dt * 2.2);
      }
      // natural gait: the head dips on each footfall, sways a little side to side,
      // and the motion fades in and out with walking speed (stride ≈ 0.72 m)
      const gait = Math.min(1, G.playerSpeed / 1.6) * (this.sitting ? 0 : 1);
      this.gaitAmp += (gait - this.gaitAmp) * Math.min(1, dt * 4);
      const prevStep = Math.floor(this.bob / Math.PI);
      this.bob += (G.playerSpeed * dt * Math.PI) / 0.72;
      if (Math.floor(this.bob / Math.PI) !== prevStep && G.playerSpeed > 0.35) {
        G.steps++;
        this.stepSide ^= 1;
        audio?.footstep(this.onStone(), this.stepSide);
      }
      const a = this.gaitAmp;
      const bobY = (0.016 - Math.abs(Math.sin(this.bob)) * 0.032) * a;
      const sway = Math.sin(this.bob) * 0.011 * a;
      this.smoothY += (this.wp.y - this.smoothY) * Math.min(1, dt * 10);
      if (Math.abs(this.wp.y - this.smoothY) > 0.6) this.smoothY = this.wp.y;
      this.camera.position.set(
        Math.cos(this.yaw) * sway,
        EYE - this.sitBlend * 0.55 + bobY + (this.smoothY - this.wp.y),
        -Math.sin(this.yaw) * sway,
      );
      this.camera.rotation.set(this.pitch + Math.sin(this.bob * 2) * 0.0035 * a, this.yaw, Math.sin(this.bob) * 0.0045 * a, 'YXZ');
      // scripted camera shots (gate inscription, finale): blend out on an arc, hold, blend back
      const st = time - this.shotAt;
      if (this.shotFn && st >= 0 && st < this.shotDur) {
        const k = Math.min(1, st / 1.6) * Math.min(1, (this.shotDur - st) / 1.6);
        const kk = k * k * (3 - 2 * k);
        this.shotFn(st, this.shotPos, this.shotTgt);
        this.shotEyeQ.copy(this.camera.quaternion);
        this.shotEyeP.copy(this.camera.position);
        this.tmp.copy(this.shotPos).sub(this.wp);
        this.camera.position.copy(this.tmp);
        this.camera.lookAt(this.shotTgt);
        this.shotQ.copy(this.camera.quaternion);
        this.camera.position.copy(this.shotEyeP).lerp(this.tmp, kk);
        this.camera.position.y += Math.sin(kk * Math.PI) * this.shotArc;
        this.camera.quaternion.copy(this.shotEyeQ).slerp(this.shotQ, kk);
      }
      // intro: slow elevated orbit over the diorama, then glide down to eye level
      if (!G.started || this.introBlend < 1) {
        if (G.started) this.introBlend = Math.min(1, this.introBlend + dt / 2.6);
        const a = Math.PI / 2 + Math.sin(time * 0.06) * 0.5;
        const R = 13.5;
        if (!G.started) {
          this.introPos.set(this.introTarget.x + Math.cos(a) * R - this.wp.x, 8.2 - this.wp.y, this.introTarget.z + Math.sin(a) * R - this.wp.z);
          this.camera.position.copy(this.introPos);
          this.camera.lookAt(this.introTarget);
          this.introQuat.copy(this.camera.quaternion);
        } else {
          const k = this.introBlend * this.introBlend * (3 - 2 * this.introBlend);
          this.eyeEuler.set(this.pitch, this.yaw, 0, 'YXZ');
          this.eyeQuat.setFromEuler(this.eyeEuler);
          this.camera.position.set(0, EYE, 0).lerp(this.introPos, 1 - k);
          this.camera.quaternion.copy(this.introQuat).slerp(this.eyeQuat, k);
        }
      }
    }

    // scenic views (entities from the `views` query)
    this.syncViewPositions();
    let nearView: PlacedView | null = null;
    let nearD = Infinity;
    for (const v of this.placed) {
      const d = Math.hypot(this.wp.x - v.x, this.wp.z - v.z);
      if (d < v.radius) {
        const id = v.def.id;
        if (!G.discovered.has(id) && G.started) {
          G.discovered.add(id);
          this.cardQueue.push(id);
          hud?.updateProgress();
          audio?.chime();
        }
        if (d / v.radius < nearD) {
          nearD = d / v.radius;
          nearView = v;
        }
      }
    }
    // only offer an action when the visitor roughly faces it (or stands on it)
    if (nearView && nearView.faceX !== null && nearView.faceZ !== null) {
      const fx = nearView.faceX;
      const fz = nearView.faceZ;
      const d = Math.hypot(fx - this.wp.x, fz - this.wp.z);
      if (d > 1.6) {
        this.camera.getWorldDirection(this.fwd);
        const dot = (this.fwd.x * (fx - this.wp.x) + this.fwd.z * (fz - this.wp.z)) / (d * Math.hypot(this.fwd.x, this.fwd.z) + 1e-6);
        if (dot < 0.2) nearView = null;
      }
    }
    let near = nearView ? nearView.def.id : null;
    if ((near === 'zigzag' || near === 'bridge') && !this.findWater(near === 'bridge' ? FEED_DISTS : LANTERN_DISTS, false)) near = null;
    // discovery cards are spaced out so overlapping zones never flash two cards
    if (this.cardQueue.length && time - this.lastCardAt > 3.2) {
      const id = this.cardQueue.shift()!;
      const p = POI_BY_ID.get(id)!;
      const idx = [...G.discovered].indexOf(id) + 1;
      this.lastCardAt = time;
      hud?.toastFor(p.id);
      hud?.toast(`New view · ${idx} of ${POIS.length}`, p.zh, p.en, p.verse + (p.action && !G.completed.has(p.id) ? ` <span class="todo">${isTouch ? 'Tap' : 'Press E'} · ${p.action}</span>` : ''));
    }
    G.nearPoi = near;
    if (near && time - this.lastCardAt > 3.2) hud?.dropToastIfNot(near);
    const poi = near ? POI_BY_ID.get(near) : undefined;
    // coin aim marker while the cascade ritual is offered
    if ((near === 'cascade' || near === 'zigzag') && !this.inXR) {
      this.camera.getWorldPosition(this.tmp);
      this.camera.getWorldDirection(this.fwd);
      let shown = false;
      if (this.fwd.y < -0.02) {
        const tHit = (WATER_Y - this.tmp.y) / this.fwd.y;
        const hx = this.tmp.x + this.fwd.x * tHit;
        const hz = this.tmp.z + this.fwd.z * tHit;
        this.lastAim[0] = hx;
        this.lastAim[1] = hz;
        this.lastAim[2] = time;
        if (tHit < 7 && pondField(hx, hz) < 0.97) {
          if (near === 'zigzag' && !inWater(hx, hz, 0.86)) {
            effects?.setAim(null);
          } else {
            effects?.setAim(hx, hz, near === 'cascade' && Math.hypot(hx - CASCADE.bottom[0], hz - CASCADE.bottom[2]) < 0.75, time, near === 'zigzag');
            shown = true;
          }
        }
      }
      if (!shown) effects?.setAim(null);
    } else effects?.setAim(null);
    const scripted = time < this.focusUntil || (time - this.shotAt >= 0 && time - this.shotAt < this.shotDur);
    const label = poi?.action ? (G.completed.has(poi.id) ? `${poi.action} again` : poi.action) : null;
    this.promptLabel = G.started && !G.paused && !this.inXR && !scripted ? (this.sitting ? 'Stand up' : label) : null;
    hud?.setPrompt(isTouch ? null : this.promptLabel);

    // minimap ~20 Hz
    this.mapTimer -= dt;
    if (this.mapTimer <= 0 && G.started) {
      this.mapTimer = 0.05;
      hud?.drawMap(this.wp.x, this.wp.z, this.yaw, time, this.placed);
    }

    // audio proximity
    const cd = Math.hypot(this.wp.x - CASCADE.bottom[0], this.wp.z - CASCADE.bottom[2]);
    let bd = Infinity;
    for (const b of BAMBOO) bd = Math.min(bd, Math.hypot(this.wp.x - b.x, this.wp.z - b.z));
    audio?.update(Math.max(0, 1 - cd / 11), Math.max(0, 1 - bd / 7), G.paused ? 0 : G.playerSpeed, this.onStone(), G.dusk);
  }
}
