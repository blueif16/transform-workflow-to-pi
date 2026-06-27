import Phaser from 'phaser';

/**
 * ============================================================================
 * CORE UTILS  (KEEP — shared engine helpers, do NOT edit in W4)
 * ============================================================================
 * The Phaser-SPECIFIC helpers used by the core scenes (Preloader, UI,
 * end-screens). The engine-agnostic score/registry semantics + the
 * placeholder-floor diagnostic now LIVE in `@contract/score` (the shared
 * top-level `templates/core-contract/`, no engine dep) and are RE-EXPORTED here
 * so every existing `utils.setScore/addScore/
 * warnPlaceholderFloor` consumer keeps resolving. A Phaser.Scene structurally
 * satisfies the contract's `ScoreHost` (it has `.registry` + `.game.events`).
 *
 * NOTE: an archetype module (e.g. platformer) ships its OWN `utils.ts` that
 * overlays this file in the scaffolded project and re-exports everything here
 * plus archetype-specific helpers. Keep the names below stable.
 */

// Engine-agnostic CONTRACT helpers (relocated to @contract/score) — re-exported
// so the public `utils.*` surface is unchanged.
export { setScore, addScore, warnPlaceholderFloor } from '@contract/score';

// ── deterministic placeholder colors (per slot type) ────────────────────────
const PLACEHOLDER_COLORS: Record<string, number> = {
  sprite: 0x4a90d9, // blue
  animation: 0x4a90d9,
  image: 0x9b59b6, // purple
  tileset: 0x7f8c8d, // grey
  background: 0x2c3e50, // dark slate
};

/**
 * Generate a flat colored-rect texture under `key` if it does not exist yet.
 * The Preloader uses this to placeholder-fill any asset slot W3 has not
 * generated, so the game boots & renders with ZERO generated art.
 */
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
  // A subtle border so overlapping placeholders are visually distinct.
  g.lineStyle(2, 0xffffff, 0.35);
  g.strokeRect(1, 1, width - 2, height - 2);
  g.generateTexture(key, width, height);
  g.destroy();
}

/**
 * Check if a texture key exists.
 */
export function textureExists(scene: Phaser.Scene, key: string): boolean {
  return scene.textures.exists(key);
}

/**
 * Safely add a sound — returns undefined if the audio key isn't loaded.
 * Prevents crashes when audio assets are missing (common pre-W3).
 */
export function safeAddSound(
  scene: Phaser.Scene,
  key: string,
  config?: Phaser.Types.Sound.SoundConfig,
): Phaser.Sound.BaseSound | undefined {
  if (!scene.cache.audio.exists(key)) return undefined;
  try {
    return scene.sound.add(key, config);
  } catch {
    return undefined;
  }
}

/**
 * Check if an audio key exists in the cache.
 */
export function audioExists(scene: Phaser.Scene, key: string): boolean {
  return scene.cache.audio.exists(key);
}
