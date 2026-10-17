import { defineAssets } from '@iwsdk/core';
import garden from './scene-assets/garden.scene-asset.js';
import collider from './scene-assets/collider.scene-asset.js';

export default defineAssets({
  garden,
  'garden-collider': collider,
});
