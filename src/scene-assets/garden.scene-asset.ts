import { Group, Mesh, MeshStandardMaterial, Shape, ShapeGeometry, Color } from '@iwsdk/core';
import { buildBridges } from '../garden/bridges.js';
import { buildFlora } from '../garden/flora.js';
import { WATER_Y, pondPoint } from '../garden/layout.js';
import { createMaterials } from '../garden/palette.js';
import { buildPavilion, createLanternMaterial } from '../garden/pavilion.js';
import { buildEntrance, buildPenjing, buildStructures, buildTerrace, createLampMaterial } from '../garden/structures.js';
import { buildTerrain } from '../garden/terrain.js';

/** Static placeholder water so the editor shows the pond; runtime upgrades it. */
function buildWaterPlaceholder(): Mesh {
  const shape = new Shape();
  const N = 128;
  for (let i = 0; i <= N; i++) {
    const [x, z] = pondPoint((i / N) * Math.PI * 2, 0.1);
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  const g = new ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const m = new MeshStandardMaterial({ color: new Color('#8db0a8'), roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
  const mesh = new Mesh(g, m);
  mesh.name = 'WaterSurface';
  mesh.position.y = WATER_Y;
  return mesh;
}

export function createGarden(): Group {
  const mats = createMaterials();
  const lantern = createLanternMaterial();
  const lamp = createLampMaterial();
  const root = new Group();
  root.name = 'ChineseGarden';
  root.add(buildTerrain(mats));
  root.add(buildBridges(mats));
  root.add(buildPavilion(mats, lantern));
  root.add(buildFlora(mats));
  root.add(buildStructures(mats, lamp));
  root.add(buildTerrace(mats));
  root.add(buildPenjing(mats));
  root.add(buildEntrance(mats));
  root.add(buildWaterPlaceholder());
  // remember intended shadow flags; scene content flags may reset them
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) m.userData.shadow = { cast: m.castShadow, receive: m.receiveShadow };
  });
  return root;
}

export default createGarden();
