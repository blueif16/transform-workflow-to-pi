import { DataPaddleScene } from './DataPaddleScene';
import type { PaddleLevelData } from './paddle-data';
import levelData from '../levels/level1.json';

/**
 * Level1Scene — the DEFAULT empty-but-playable level (ships with the template).
 *
 * A ~5-line DATA-DRIVEN shell: it extends DataPaddleScene and passes the committed
 * generic default `levels/level1.json` (a bounded field + a paddle + a ball + a small
 * brick grid). It exists so the EMPTY module RUNS standalone and flips
 * window.__GAME__.ready = true on the first interactive frame, instantiated FROM DATA
 * (every entity appears where level1.json defines it) with ZERO generated art and ZERO
 * per-game code.
 *
 * W2 OVERWRITES levels/level1.json with the materialized per-game level; this shell is
 * unchanged. W4 only authors the `custom[]` delta (registered via custom-registry).
 */
export class Level1Scene extends DataPaddleScene {
  constructor() {
    super('Level1Scene', levelData as PaddleLevelData);
  }
}
