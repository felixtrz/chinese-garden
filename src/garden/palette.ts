import { applyPlaster, makeMat } from './util.js';

/** Low-poly palette sampled from the reference painting. */
export const C = {
  sky: '#dde7de',
  grassA: '#b4bd79',
  grassB: '#a2ae68',
  grassC: '#c2c58a',
  bank: '#cbbf98',
  pondBed: '#6f8470',
  sand: '#dccaa6',
  sand2: '#cfbb94',
  rim: '#d8c8a6',
  rim2: '#c8b690',
  lacquer: '#a8392b',
  lacquerDark: '#7e2a22',
  roof: '#3f6a55',
  roofDark: '#2f5244',
  beam: '#2f5a58',
  gold: '#c9a24a',
  trunk: '#8c3d2d',
  pineA: '#8fa95a',
  pineB: '#9db866',
  pineC: '#7f9a4d',
  bamboo: '#94b05c',
  bambooNode: '#7b9446',
  bambooLeaf: '#83a44c',
  rock: '#cdbca3',
  rock2: '#b9a78f',
  rockDark: '#9e8e78',
  plaster: '#efebe2',
  tile: '#5f676b',
  tileLight: '#7c858a',
  plum: '#e7a3b4',
  plum2: '#f3c6d0',
  water: '#8db0a8',
  mountain: '#a9bcb1',
  wood: '#7a4a33',
};

export function createMaterials() {
  return {
    sand: makeMat(C.sand),
    sand2: makeMat(C.sand2),
    rim: makeMat(C.rim),
    rim2: makeMat(C.rim2),
    lacquer: makeMat(C.lacquer, { rough: 0.6 }),
    lacquerDark: makeMat(C.lacquerDark, { rough: 0.7 }),
    roof: makeMat(C.roof, { rough: 0.75, double: true }),
    roofDark: makeMat(C.roofDark, { rough: 0.8, double: true }),
    beam: makeMat(C.beam, { rough: 0.7 }),
    gold: makeMat(C.gold, { rough: 0.35, metal: 0.6 }),
    trunk: makeMat(C.trunk, { rough: 0.95 }),
    pineA: makeMat(C.pineA, { wind: 0.006 }),
    pineB: makeMat(C.pineB, { wind: 0.006 }),
    pineC: makeMat(C.pineC, { wind: 0.006 }),
    bamboo: makeMat(C.bamboo, { rough: 0.6, wind: 0.0042 }),
    bambooNode: makeMat(C.bambooNode, { rough: 0.6, wind: 0.0042 }),
    bambooLeaf: makeMat(C.bambooLeaf, { double: true, wind: 0.0042 }),
    rock: makeMat(C.rock),
    rock2: makeMat(C.rock2),
    rockDark: makeMat(C.rockDark),
    plaster: (() => {
      const m = makeMat(C.plaster, { rough: 1 });
      applyPlaster(m);
      return m;
    })(),
    tile: makeMat(C.tile, { rough: 0.85 }),
    tileLight: makeMat(C.tileLight, { rough: 0.85 }),
    plum: makeMat(C.plum, { wind: 0.006 }),
    plum2: makeMat(C.plum2, { wind: 0.006 }),
    wood: makeMat(C.wood),
    mountain: makeMat(C.mountain, { rough: 1 }),
  };
}

export type Mats = ReturnType<typeof createMaterials>;
