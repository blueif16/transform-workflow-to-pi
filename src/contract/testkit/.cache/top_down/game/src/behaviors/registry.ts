/**
 * behaviors/registry.ts — the runtime id->implementation resolution maps for the
 * top-down behavior & effect capabilities (KEEP — engine seam; mirrors platformer's
 * scenes-side behaviors/registry.ts).
 *
 * The blueprint BINDS to capability ids as DATA ({ref,params}); the SDK RESOLVES
 * each id → its implementation here, so a level is INSTANTIATED from data with no
 * per-game placement/behavior code. GENERIC: a behavior/effect is added in ONE
 * place (its file + one line below); every future blueprint can then bind it by id.
 * Nothing game-specific lives here.
 *
 * SCOPE NOTE (M2): the single-config-object KEEP behaviors are bindable from layout
 * (EightWayMovement, ChaseAI, PatrolAI, FaceTarget, DashAbility) plus the M2 BUILD
 * behavior Separation (Reynolds anti-stack, composed ON a chaser). Combat behaviors
 * that need a richer scene context (MeleeAttack, RangedAttack) are composed by the
 * Base* classes / the player, not bound from layout — exactly as platformer keeps
 * its combat behaviors off the layout binding. Future BUILD behaviors (GhostTarget,
 * …) land in M5 and add one line each here.
 */
import { EightWayMovement } from './EightWayMovement';
import { ChaseAI } from './ChaseAI';
import { PatrolAI } from './PatrolAI';
import { FaceTarget } from './FaceTarget';
import { DashAbility } from './DashAbility';
import { Separation } from './Separation';
import { GhostTarget } from './GhostTarget';
import { InertialThrustController } from './InertialThrustController';
import { HopGridMovement } from './HopGridMovement';
import { SplitterEnemy } from './SplitterEnemy';
import { PushBlock } from './PushBlock';
import { MagnetPickup } from './MagnetPickup';
import { ScreenEffectHelper } from './ScreenEffectHelper';
import type { IBehavior } from './IBehavior';
import type Phaser from 'phaser';

// ════════════════════════════════════════════════════════════════════════════
// RUNTIME RESOLUTION MAPS (KEEP — engine seam for the data-driven level loader)
//
// The blueprint BINDS to capability ids as DATA ({ref,params}); the SDK RESOLVES
// each id → its implementation here, so a level is INSTANTIATED from data with no
// per-game placement/behavior code.
// ════════════════════════════════════════════════════════════════════════════

/** A behavior class constructed from a single `params` object (the {ref,params} shape). */
export type BehaviorClass = new (params: any) => IBehavior;

/**
 * id → behavior class, for `entities[].behaviors[] = {ref, params}`. The loader does
 * `new BEHAVIOR_CLASSES[ref](params)` and attaches it via BehaviorManager. Only
 * behaviors whose constructor takes a single config object appear here.
 */
export const BEHAVIOR_CLASSES: Record<string, BehaviorClass> = {
  EightWayMovement: EightWayMovement as unknown as BehaviorClass,
  ChaseAI: ChaseAI as unknown as BehaviorClass,
  PatrolAI: PatrolAI as unknown as BehaviorClass,
  FaceTarget: FaceTarget as unknown as BehaviorClass,
  DashAbility: DashAbility as unknown as BehaviorClass,
  Separation: Separation as unknown as BehaviorClass,
  GhostTarget: GhostTarget as unknown as BehaviorClass,
  InertialThrustController: InertialThrustController as unknown as BehaviorClass,
  HopGridMovement: HopGridMovement as unknown as BehaviorClass,
  SplitterEnemy: SplitterEnemy as unknown as BehaviorClass,
  PushBlock: PushBlock as unknown as BehaviorClass,
  MagnetPickup: MagnetPickup as unknown as BehaviorClass,
};

/** Resolve a behavior id → class; undefined when unknown (loader reports it). */
export function resolveBehavior(id: string): BehaviorClass | undefined {
  return BEHAVIOR_CLASSES[id];
}

/**
 * id → effect invocation, for `effects[] = {on, play, params?}`. Each entry calls
 * the matching ScreenEffectHelper / scene method at (x,y) with the bound params.
 * The loader fires `EFFECT_DISPATCH[play]?.(scene, x, y, params)` when the bound
 * event emits. GENERIC: keyed off ScreenEffectHelper ids — a new effect id is one
 * line here. A param the effect needs but the blueprint omits falls back to a sane
 * default (an effect is cosmetic — it never reads/writes an observed field).
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
      endScale: Number(p?.endScale ?? Number(p?.scale ?? 0.6) * 2),
      alpha: Number(p?.alpha ?? 0.9),
      duration: Number(p?.duration ?? 500),
    }),
  createDefaultExplosion: (s, x, y, p) =>
    ScreenEffectHelper.createDefaultExplosion(s, x, y, String(p?.imageKey ?? '__px')),
  showDamageNumber: (s, x, y, p) =>
    ScreenEffectHelper.showDamageNumber(
      s,
      x,
      y,
      Number(p?.amount ?? 1),
      String(p?.color ?? '#ffd34a'),
    ),
  createDashTrail: (s, x, y, p) =>
    ScreenEffectHelper.createDashTrail(s, { x, y }, String(p?.imageKey ?? '__px')),
};

/** Resolve an effect id → invoker; undefined when unknown (loader reports it). */
export function resolveEffect(id: string): EffectInvoker | undefined {
  return EFFECT_DISPATCH[id];
}
