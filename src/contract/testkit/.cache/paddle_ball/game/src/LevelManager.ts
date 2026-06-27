/**
 * Level Manager — engine seam re-export (KEEP).
 *
 * The pure level-order logic was RELOCATED to the engine-agnostic CONTRACT home
 * `@contract/LevelManager` (the shared top-level `templates/core-contract/`,
 * imported by every engine). This file re-exports it so every existing
 * `import { LevelManager } from '../LevelManager'` consumer (the core UI scenes,
 * the platformer BaseLevelScene) resolves unchanged.
 */
export { LevelManager } from '@contract/LevelManager';
