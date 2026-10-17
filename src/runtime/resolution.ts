import { createSystem } from '@iwsdk/core';
import { isTouch } from './touch.js';

/**
 * Adaptive resolution for the flat browser view: steps the pixel ratio by 0.25 to hold
 * roughly 60 fps. Skipped in XR (the headset owns its framebuffer) and in scripted capture,
 * where frames must be deterministic.
 */
export class AdaptiveResolutionSystem extends createSystem({}) {
  private cap = Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2);
  private floor = isTouch ? 0.75 : 1;
  private ratio = Math.min(this.cap, isTouch ? 1.5 : this.cap);
  private disabled = new URLSearchParams(location.search).has('capture');
  private acc = 0;
  private frames = 0;
  private cooldown = 0;

  init() {
    this.renderer.setPixelRatio(this.ratio);
  }

  update(delta: number) {
    const ms = delta * 1000;
    // ignore hitches such as tab switches; they say nothing about steady-state cost
    if (this.disabled || this.renderer.xr.isPresenting || ms >= 250) return;
    this.acc += ms;
    this.frames++;
    if (this.acc <= 1500) return;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    if (this.cooldown > 0) this.cooldown--;
    else if (avg > 19 && this.ratio > this.floor) {
      this.ratio = Math.max(this.floor, this.ratio - 0.25);
      this.renderer.setPixelRatio(this.ratio);
      this.cooldown = 1;
    } else if (avg < 12 && this.ratio < this.cap) {
      this.ratio = Math.min(this.cap, this.ratio + 0.25);
      this.renderer.setPixelRatio(this.ratio);
      this.cooldown = 2;
    }
  }
}
