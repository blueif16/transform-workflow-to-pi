/**
 * DataShip — a BaseShip configured ENTIRELY from level/blueprint DATA (KEEP — engine
 * seam for the data-driven loader). The top_down analogue of DataPlayer.
 *
 * The data-driven loader builds the cannon from `ShooterLevelData.player` (its asset
 * slot + the {ref:'AxisConstrainedMovement', params} binding) merged over
 * gameConfig.playerConfig — so NO per-game player file is needed for a standard
 * gallery-shooter cannon. The loader then attaches the axis mover from the binding.
 *
 * GENERIC: reads stats from gameConfig.playerConfig (the W2-merged blueprint config);
 * no theme is baked in.
 */
import Phaser from 'phaser';
import { BaseShip, type ShipConfig } from './BaseShip';
import gameConfig from '../gameConfig.json';

const pc = (gameConfig as any).playerConfig ?? {};
const numOr = (v: any, d: number): number => (typeof v === 'number' ? v : d);

export interface DataShipSpec {
  /** texture key (an index.json slot); falls back to a placeholder key. */
  textureKey?: string;
  /** Logical display width in px (the cannon is wider than tall). */
  displayWidth?: number;
  /** Logical display height in px. */
  displayHeight?: number;
}

export class DataShip extends BaseShip {
  constructor(scene: Phaser.Scene, x: number, y: number, spec: DataShipSpec = {}) {
    const config: ShipConfig = {
      textureKey: spec.textureKey || '__px',
      displayWidth: spec.displayWidth ?? 44,
      displayHeight: spec.displayHeight ?? 28,
      stats: {
        maxHealth: numOr(pc.maxHealth?.value, 3),
        invulnerableTime: numOr(pc.invulnerableTime?.value, 800),
      },
    };
    super(scene, x, y, config);
  }
}
