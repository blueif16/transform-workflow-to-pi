import { DataTopDownScene } from './DataTopDownScene';
import type { TopDownLevelData } from './topdown-data';
import levelData from '../levels/level1.json';

/**
 * Level1Scene — the DEFAULT empty-but-playable level (ships with the template).
 *
 * A ~5-line DATA-DRIVEN shell: it extends DataTopDownScene and passes the committed
 * generic default `levels/level1.json` (a bare bounded arena + a placeholder player,
 * NO enemies/rewards/goal). It exists so the EMPTY module RUNS standalone and flips
 * window.__GAME__.ready = true on the first interactive frame, instantiated FROM
 * DATA (the player appears at the spawn DEFINED IN level1.json) with ZERO generated
 * art and ZERO per-game code.
 *
 * W2 OVERWRITES levels/level1.json with the materialized per-game level; this shell
 * is unchanged. W4 only authors the `custom[]` delta (registered via custom-registry)
 * and may append more level shells. The construction path is the same either way.
 */
export class Level1Scene extends DataTopDownScene {
  constructor() {
    super('Level1Scene', levelData as TopDownLevelData);
  }
}
