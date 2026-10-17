import type { Group, Object3D } from '@iwsdk/core';

/**
 * State shared between PlayerSystem, GardenLifeSystem, the environment and the DOM HUD, and
 * read by the tools/ scripts through `window.__garden`. State owned by one module lives there
 * instead; scenic views are ECS entities (see PointOfInterest).
 */
export const G = {
  ready: false,
  garden: null as Group | null,
  /** 0 = day, 1 = dusk (animated) */
  dusk: 0,
  /** time of day 0..1 (0 = morning); a full cycle takes CYCLE_SECONDS */
  tod: 0.08,
  todMode: 'cycle' as 'cycle' | 'day' | 'dusk' | 'night',
  todRush: -1,
  time: 0,
  started: false,
  paused: true,
  muted: false,
  sensitivity: 1,
  discovered: new Set<string>(),
  completed: new Set<string>(),
  refreshLanterns: null as (() => void) | null,
  nearPoi: null as string | null,
  feedUntil: 0,
  feedPoint: [0, 1.0] as [number, number],
  bellStrikeAt: -10,
  gustAt: -100,
  koiFollowUntil: -1,
  feeds: 0,
  feedOrigin: [0, 2, 0] as [number, number, number],
  /** landmarks inside the garden asset, collected once by environment.ts */
  windBell: null as Object3D | null,
  /** one per view, in POIS order; each lights when its ritual is done */
  lanternAnchors: [] as Object3D[],
  lampAnchors: [] as Object3D[],
  /** objects skipped by the pond's reflection pass (underwater or too small to matter) */
  reflectSkip: [] as Object3D[],
  playerSpeed: 0,
  touchRun: false,
  steps: 0,
  walkOverride: null as number | null,
};

export const CYCLE_SECONDS = 60;
export const TOD_TARGETS = { day: 0.22, dusk: 0.6, night: 0.76 } as const;
