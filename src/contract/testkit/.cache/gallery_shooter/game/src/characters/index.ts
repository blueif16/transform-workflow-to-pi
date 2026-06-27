/**
 * characters — the gallery-shooter player cannon (KEEP — engine seam).
 *
 * BaseShip is the foundation (axis-constrained mover + health/i-frame/takeDamage +
 * the player.damaged surface); DataShip builds it entirely from level/blueprint data.
 * Mirrors top_down/src/characters/ (BasePlayer + DataPlayer), trimmed to the gallery
 * shooter (no FSM/melee/dash/mouse-aim).
 */
export { BaseShip, type ShipConfig } from './BaseShip';
export { DataShip, type DataShipSpec } from './DataShip';
