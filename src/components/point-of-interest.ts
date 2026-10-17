import { Types, createComponent } from '@iwsdk/core';
import type { PoiDef } from '../garden/layout.js';

/**
 * Marks a scene node as one of the garden's scenic views. The node's position and these
 * fields are authored in the scene (and editable in the IWSDK editor); the view's text and
 * ritual come from the `POIS` catalog in src/garden/layout.ts, matched by `view`.
 */
export const PointOfInterest = createComponent('PointOfInterest', {
  view: { type: Types.String, default: '', label: 'View id', help: 'Id of the view in the POIS catalog (src/garden/layout.ts)' },
  radius: {
    type: Types.Float32,
    default: 2.5,
    min: 0.5,
    max: 10,
    step: 0.05,
    label: 'Radius (m)',
    help: 'Discovered, and its ritual offered, within this distance on the ground plane',
  },
  facing: {
    type: Types.Enum,
    enum: { Anywhere: 'anywhere', Node: 'node', Focus: 'focus' },
    default: 'node',
    help: 'Offer the ritual only when the visitor roughly faces this node, the focus point, or anywhere',
  },
  focus: { type: Types.Vec3, default: [0, 0, 0], label: 'Focus point', help: 'World point to face when facing is "focus"' },
});

/** A view as placed in the world: catalog entry plus its authored placement. */
export interface ViewPlacement {
  def: PoiDef;
  x: number;
  z: number;
  radius: number;
  /** Point the visitor must face before the ritual is offered, or null for anywhere. */
  faceX: number | null;
  faceZ: number | null;
}
