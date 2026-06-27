import Phaser from 'phaser';

/**
 * ============================================================================
 * paddle_ball UTILS  (KEEP — shared engine helpers; overlays core/src/utils.ts)
 * ============================================================================
 * This module ships its OWN utils.ts that overlays core/src/utils.ts in the
 * scaffolded project. It MUST re-export the same engine helpers core's scenes
 * (Preloader, the end-screens) import (`setScore/addScore/warnPlaceholderFloor` +
 * `ensurePlaceholderTexture`) so the overlay is transparent, PLUS the paddle_ball
 * helpers the scene base uses. Keep the names identical to core/src/utils.ts +
 * @contract/score. Mirrors top_down's utils.ts (slim subset).
 */

// Engine-agnostic CONTRACT helpers (the score seam + the placeholder-floor diagnostic).
export { setScore, addScore, warnPlaceholderFloor } from '@contract/score';

// ── deterministic placeholder colors (per slot type) ────────────────────────
const PLACEHOLDER_COLORS: Record<string, number> = {
  sprite: 0x4a90d9,
  animation: 0x4a90d9,
  image: 0x9b59b6,
  tileset: 0x7f8c8d,
  background: 0x2c3e50,
};

/** Generate a flat colored-rect texture under `key` if it does not exist yet. */
export function ensurePlaceholderTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  type = 'sprite',
): void {
  if (scene.textures.exists(key)) return;
  const color = PLACEHOLDER_COLORS[type] ?? 0x4a90d9;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(color, 1);
  g.fillRect(0, 0, width, height);
  g.lineStyle(2, 0xffffff, 0.35);
  g.strokeRect(1, 1, width - 2, height - 2);
  g.generateTexture(key, width, height);
  g.destroy();
}

/** Check if a texture key exists. */
export function textureExists(scene: Phaser.Scene, key: string): boolean {
  return scene.textures.exists(key);
}

/** Fit a sprite's display size to contain a box (preserve aspect; no upscaling past box). */
export function fitDisplayContain(
  sprite: Phaser.GameObjects.Sprite,
  boxW: number,
  boxH: number,
): void {
  sprite.setDisplaySize(boxW, boxH);
}
