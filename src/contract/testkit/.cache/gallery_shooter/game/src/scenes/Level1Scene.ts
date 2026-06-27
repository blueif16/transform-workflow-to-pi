import { DataShooterScene } from './DataShooterScene';
import type { ShooterLevelData } from './shooter-data';
import levelData from '../levels/level1.json';

/**
 * Level1Scene — the DEFAULT empty-but-playable level (ships with the template).
 *
 * A ~5-line DATA-DRIVEN shell: it extends DataShooterScene and passes the committed
 * generic default `levels/level1.json` (a bounded arena, a placeholder cannon on its
 * bottom track, a small placeholder formation + bunkers, bound to the three base
 * systems). It exists so the EMPTY module RUNS standalone and flips window.__GAME__.ready
 * = true on the first interactive frame, instantiated FROM DATA with ZERO generated art
 * and ZERO per-game code.
 *
 * W2 OVERWRITES levels/level1.json with the materialized per-game level; this shell is
 * unchanged. W4 only authors the `custom[]` delta (registered via custom-registry). The
 * construction path is the same either way.
 */
export class Level1Scene extends DataShooterScene {
  constructor() {
    super('Level1Scene', levelData as ShooterLevelData);
  }
}
