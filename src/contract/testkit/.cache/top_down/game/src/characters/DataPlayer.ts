/**
 * DataPlayer — a BasePlayer configured ENTIRELY from level/blueprint DATA
 * (KEEP — engine seam for the data-driven loader).
 *
 * The data-driven loader builds the player from `TopDownLevelData.player` (its asset
 * slot + the {ref:'EightWayMovement', params} binding) merged over
 * gameConfig.playerConfig — so NO per-game player file is needed for a standard
 * top-down player. W4 only writes a player class when the design needs a custom
 * override beyond the bound movement params.
 *
 * GENERIC: reads stats from gameConfig.playerConfig (the W2-merged blueprint config)
 * and the movement tuning from the passed-in {ref,params} binding; no theme is baked
 * in. Mirrors platformer's characters/DataPlayer.ts (adapted to the top-down
 * BasePlayer config shape: no gravity/jump, an EightWayMovement {walkSpeed,friction}
 * binding instead of PlatformerMovement).
 */
import Phaser from 'phaser';
import { BasePlayer, type PlayerConfig } from './BasePlayer';
import type { PlayerAnimKeys } from './PlayerFSM';
import gameConfig from '../gameConfig.json';

const pc = (gameConfig as any).playerConfig ?? {};
const numOr = (v: any, d: number): number => (typeof v === 'number' ? v : d);

export interface DataPlayerSpec {
  /** texture key (an index.json slot); falls back to a placeholder key. */
  textureKey?: string;
  /**
   * Logical display HEIGHT in px (the frozen assetList height). The top-down
   * BasePlayer fits the sprite to this height (origin at feet for Y-sort).
   */
  displayHeight?: number;
  /** Logical display WIDTH in px (informational; the top-down player fits by height). */
  displayWidth?: number;
  /** the EightWayMovement {params} bound in the blueprint (verbatim). */
  movement?: {
    walkSpeed?: number;
    /** 1 = instant stop (snappy); <1 = eased deceleration (slidey). */
    friction?: number;
  };
  animKeys?: PlayerAnimKeys;
}

export class DataPlayer extends BasePlayer {
  constructor(scene: Phaser.Scene, x: number, y: number, spec: DataPlayerSpec = {}) {
    const m = spec.movement ?? {};
    const config: PlayerConfig = {
      textureKey: spec.textureKey || '__px',
      displayHeight: spec.displayHeight ?? 64,
      // Top-down foot hitbox: narrow width, short height (Y-sort depth).
      bodyWidthFactor: 0.5,
      bodyHeightFactor: 0.4,
      stats: {
        // bound movement params win over the config defaults (the blueprint binds
        // walkSpeed in the EightWayMovement params); config is the floor.
        maxHealth: numOr(pc.maxHealth?.value, 100),
        walkSpeed: numOr(m.walkSpeed, numOr(pc.walkSpeed?.value, 200)),
        attackDamage: numOr(pc.attackDamage?.value, 0),
        hurtingDuration: numOr(pc.hurtingDuration?.value, 100),
        invulnerableTime: numOr(pc.invulnerableTime?.value, 1000),
      },
      movement: {
        // friction default 1 (instant-stop, snappy); a slidey genre binds <1.
        friction: numOr(m.friction, 1),
      },
      animKeys: spec.animKeys,
    };
    super(scene, x, y, config);
  }
}
