import { DataGridScene } from './DataGridScene';
import type { GridLevelData } from './grid-data';
import levelData from '../levels/level1.json';

/**
 * Level1Scene — the DEFAULT empty-but-playable level (ships with the template).
 *
 * A ~5-line DATA-DRIVEN shell: it extends DataGridScene and passes the committed
 * generic default `levels/level1.json` (a 4x4 board, win target 2048, the 4-way
 * scheme, the merge-slide goal). It exists so the module RUNS standalone and flips
 * window.__GAME__.ready = true on the first interactive frame, instantiated FROM
 * DATA (the board appears with its seeded opening tiles) with ZERO generated art and
 * ZERO per-game code.
 *
 * W2 OVERWRITES levels/level1.json with the materialized per-game level; this shell
 * is unchanged. W4 only authors the `custom[]` delta (registered via custom-registry)
 * and may append more level shells. The construction path is the same either way.
 */
export class Level1Scene extends DataGridScene {
  constructor() {
    super('Level1Scene', levelData as GridLevelData);
  }
}
