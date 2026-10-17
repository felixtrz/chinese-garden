import { Group, LocomotionSystem, Vector3, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GardenAudio } from './runtime/audio.js';
import { setupEnvironment } from './runtime/environment.js';
import { Hud } from './runtime/hud.js';
import { GardenLifeSystem, setEnv } from './runtime/life.js';
import { PlayerSystem, bindPlayerDeps } from './runtime/player.js';
import { G } from './runtime/state.js';
import { installVirtualGamepad, isTouch, setVirtualStick, setupTouch } from './runtime/touch.js';
import { POIS } from './garden/layout.js';
import { AdaptiveResolutionSystem } from './runtime/resolution.js';

/**
 * VR is hidden until the headset version is ready (the pond reflection pass is still
 * missing in XR). To bring it back, set this to true and `world.xr.offer` in
 * iwsdk.config.json back to "always".
 */
const VR_ENABLED = false;

const audio = new GardenAudio();
let world: World | null = null;
let player: PlayerSystem | null = null;

const hud = new Hud({
  onEnter: () => {
    if (isTouch) {
      // immersive landscape on phones where the browser allows it
      const de = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
      de.requestFullscreen?.()
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {});
    }
    audio.start();
    G.started = true;
    hud.hideIntro();
    player?.setPaused(false);
  },
  onEnterVR: () => {
    audio.start();
    G.started = true;
    G.paused = false;
    hud.hideIntro();
    world?.launchXR();
  },
  onResume: () => player?.setPaused(false),
  onTime: (mode) => {
    G.todMode = mode;
    G.todRush = -1;
    hud.syncSettings();
  },
  onMute: (m) => {
    G.muted = m;
    audio.setMuted(m);
    hud.syncSettings();
  },
  onSensitivity: (v) => (G.sensitivity = v),
});
bindPlayerDeps(hud, audio);

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((w) => {
  world = w;
  w.registerSystem(PlayerSystem);
  w.registerSystem(GardenLifeSystem);
  w.registerSystem(AdaptiveResolutionSystem);
  player = w.getSystem(PlayerSystem) ?? null;
  if (isTouch) {
    setupTouch({
      look: (dx, dy) => player?.addLook(dx, dy),
      act: () => player?.interact(),
      time: () => player?.toggleTime(),
      menu: () => player?.setPaused(true),
      canAct: () => player?.promptLabel ?? null,
    });
  }

  // the calligraphy font must be ready before plaques are painted into canvas textures
  const fontReady = Promise.race([
    document.fonts.load('64px "Garden Kai"', '留云园'),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  const waitForGarden = async () => {
    const garden = w.getSceneObject<Group>('garden');
    if (!garden) {
      requestAnimationFrame(waitForGarden);
      return;
    }
    G.garden = garden;
    // the garden never moves: freeze its transforms so per-frame matrix updates skip it
    garden.updateMatrixWorld(true);
    garden.traverse((o) => {
      if (o.name === 'WindBell' || o.name === 'BellStriker') return;
      if (o.parent?.name === 'WindBell' || o.parent?.name === 'BellStriker') return;
      o.matrixAutoUpdate = false;
    });
    await fontReady;
    setEnv(setupEnvironment(w, garden));
    G.ready = true;
    hud.setReady();
    // the VR check can take a long time on some browsers; never hold the intro on it
    if (!VR_ENABLED) return;
    navigator.xr?.isSessionSupported('immersive-vr').then(
      (vr) => vr && hud.showVrButton(),
      () => {},
    );
  };
  waitForGarden();

  // scripted capture drives movement through the same analog stick as the touch joystick
  const params = new URLSearchParams(location.search);
  const capture = params.has('capture');
  if (capture) installVirtualGamepad();

  // debug/automation hooks for tools/*.mjs: dev server, ?debug or ?capture only
  if (!import.meta.env.DEV && !capture && !params.has('debug')) return;
  (window as unknown as { __garden: unknown }).__garden = {
    G,
    move: (x: number, y: number) => setVirtualStick(x, y),
    capture,
    pois: POIS,
    world: w,
    player: () => player,
    teleport: (x: number, z: number, yaw = 0, pitch = 0) => {
      const loco = w.getSystem(PlayerSystem);
      if (loco) {
        loco.yaw = yaw;
        loco.pitch = pitch;
      }
      w.getSystem(LocomotionSystem)?.setPlayerPosition(new Vector3(x, 2.6, z));
    },
  };
});
