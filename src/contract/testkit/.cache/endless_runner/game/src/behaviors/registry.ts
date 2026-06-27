/**
 * behaviors/registry.ts — the runtime id→class resolution map for the avatar
 * behaviors (KEEP — engine seam; mirrors platformer/top_down behaviors/registry.ts).
 *
 * The blueprint BINDS to behavior ids as DATA (entities[].behaviors[] = {ref,params});
 * the SDK RESOLVES each id → its class here, so the avatar is composed from data with
 * no per-game behavior code. GENERIC: a behavior is added in ONE place (its file + one
 * line below); every future blueprint can then bind it by id.
 *
 * SCOPE NOTE (base genre gravity-flap): only GravityFlapMovement is bindable today.
 * Wave-2 movement verbs (ground-run/jump, hold-thrust, lane-snap, slope-glide) add one
 * line each here when they land. The effect dispatch is the shared cosmetic seam (empty
 * for the base genre — no effects bound yet); a future effect id is one line.
 */
import { GravityFlapMovement } from './GravityFlapMovement';
import { GroundRunJump } from './GroundRunJump';
import { HoldThrust } from './HoldThrust';
import { LaneSnapMovement } from './LaneSnapMovement';
import { BeatFlap } from './BeatFlap';
import { SlopeGlide } from './SlopeGlide';
import { AirTrick } from './AirTrick';
import type { IBehavior } from './IBehavior';

/** A behavior class constructed from a single `params` object (the {ref,params} shape). */
export type BehaviorClass = new (params: any) => IBehavior;

/**
 * id → behavior class, for `entities[].behaviors[] = {ref, params}`. The loader does
 * `new BEHAVIOR_CLASSES[ref](params)` and attaches it. Only behaviors whose
 * constructor takes a single config object appear here.
 */
export const BEHAVIOR_CLASSES: Record<string, BehaviorClass> = {
  GravityFlapMovement: GravityFlapMovement as unknown as BehaviorClass,
  GroundRunJump: GroundRunJump as unknown as BehaviorClass,
  HoldThrust: HoldThrust as unknown as BehaviorClass,
  LaneSnapMovement: LaneSnapMovement as unknown as BehaviorClass,
  BeatFlap: BeatFlap as unknown as BehaviorClass,
  SlopeGlide: SlopeGlide as unknown as BehaviorClass,
  AirTrick: AirTrick as unknown as BehaviorClass,
};

/** Resolve a behavior id → class; undefined when unknown (the loader reports it). */
export function resolveBehavior(id: string): BehaviorClass | undefined {
  return BEHAVIOR_CLASSES[id];
}

/**
 * id → effect invocation, for `effects[] = {on, play, params?}`. The cosmetic event→
 * effect seam every module shares. EMPTY for the base genre (no effects bound yet); a
 * Wave-2 ScreenEffectHelper effect is one line here. An effect is cosmetic — it never
 * reads/writes an observed field (anti-reward-hack). Unknown id → undefined (no-op).
 */
export type EffectInvoker = (
  scene: any,
  x: number,
  y: number,
  params?: Record<string, any>,
) => void;

export const EFFECT_DISPATCH: Record<string, EffectInvoker> = {};

/** Resolve an effect id → invoker; undefined when unknown (loader no-ops). */
export function resolveEffect(id: string): EffectInvoker | undefined {
  return EFFECT_DISPATCH[id];
}
