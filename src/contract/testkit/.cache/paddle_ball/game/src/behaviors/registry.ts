/**
 * behaviors/registry.ts — the runtime id->implementation resolution maps for the
 * paddle_ball behavior & effect capabilities (KEEP — engine seam; mirrors top_down's
 * behaviors/registry.ts).
 *
 * The blueprint BINDS to capability ids as DATA ({ref,params}); the SDK RESOLVES each
 * id → its implementation here, so a level is INSTANTIATED from data with no per-game
 * code. GENERIC: a behavior/effect is added in ONE place (its file + one line below).
 */
import { PaddleController } from './PaddleController';
import { PinballFlippers } from './PinballFlippers';
import { SpinShot } from './SpinShot';
import { ScreenEffectHelper } from './ScreenEffectHelper';
import type { IBehavior } from './IBehavior';
import type Phaser from 'phaser';

/** A behavior class constructed from a single `params` object (the {ref,params} shape). */
export type BehaviorClass = new (params: any) => IBehavior;

/**
 * id → behavior class, for `entities[].behaviors[] = {ref, params}`. The loader does
 * `new BEHAVIOR_CLASSES[ref](params)` and attaches it via BehaviorManager.
 */
export const BEHAVIOR_CLASSES: Record<string, BehaviorClass> = {
  PaddleController: PaddleController as unknown as BehaviorClass,
  PinballFlippers: PinballFlippers as unknown as BehaviorClass,
  SpinShot: SpinShot as unknown as BehaviorClass,
};

/** Resolve a behavior id → class; undefined when unknown (loader reports it). */
export function resolveBehavior(id: string): BehaviorClass | undefined {
  return BEHAVIOR_CLASSES[id];
}

/**
 * id → effect invocation, for `effects[] = {on, play, params?}`. Each entry calls the
 * matching ScreenEffectHelper method at (x,y) with the bound params. The loader fires
 * `EFFECT_DISPATCH[play]?.(scene, x, y, params)` when the bound event emits. GENERIC.
 * An effect is cosmetic — it never reads/writes an observed field.
 */
export type EffectInvoker = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  params?: Record<string, any>,
) => void;

export const EFFECT_DISPATCH: Record<string, EffectInvoker> = {
  shake: (s, _x, _y, p) =>
    ScreenEffectHelper.shake(s, {
      duration: Number(p?.duration ?? 300),
      intensity: Number(p?.intensity ?? 0.008),
    }),
  shakeLight: (s) => ScreenEffectHelper.shakeLight(s),
  shakeMedium: (s) => ScreenEffectHelper.shakeMedium(s),
  shakeStrong: (s) => ScreenEffectHelper.shakeStrong(s),
  hitStop: (s, _x, _y, p) => ScreenEffectHelper.hitStop(s, Number(p?.duration ?? 60)),
  createExplosion: (s, x, y, p) =>
    ScreenEffectHelper.createExplosion(s, x, y, {
      imageKey: String(p?.imageKey ?? '__px'),
      scale: Number(p?.scale ?? 0.6),
      duration: Number(p?.duration ?? 500),
    }),
};

/** Resolve an effect id → invoker; undefined when unknown (loader reports it). */
export function resolveEffect(id: string): EffectInvoker | undefined {
  return EFFECT_DISPATCH[id];
}
