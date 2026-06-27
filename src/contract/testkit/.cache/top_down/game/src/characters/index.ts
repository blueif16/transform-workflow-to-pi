/**
 * Characters - Player and Enemy base classes for top-down games
 *
 * Architecture:
 * - BasePlayer: Abstract foundation for player characters (8-way movement, mouse aim, dash)
 * - BaseEnemy: Abstract foundation for enemy characters (2D AI, 4-direction facing)
 * - PlayerFSM: Finite state machine for player states
 * - DataPlayer: BasePlayer built ENTIRELY from TopDownLevelData (the data-driven loader)
 *
 * The data-driven DataTopDownScene builds the player via DataPlayer from the level
 * data — no per-game player file is needed for a standard top-down player. W4 only
 * writes a player class when the design needs a custom override beyond the bound
 * movement params.
 */

// Player
export { BasePlayer, type PlayerConfig } from './BasePlayer';
export {
  PlayerFSM,
  type PlayerAnimKeys,
  DEFAULT_PLAYER_ANIM_KEYS,
} from './PlayerFSM';

// Data-driven player (built FROM TopDownLevelData by DataTopDownScene).
export { DataPlayer, type DataPlayerSpec } from './DataPlayer';

// Enemy
export { BaseEnemy, type EnemyConfig, type EnemyAIType } from './BaseEnemy';
