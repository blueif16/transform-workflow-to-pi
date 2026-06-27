/**
 * utils.ts — endless_runner engine helpers (KEEP — engine seam).
 *
 * Standalone, engine-light utilities the systems share: a DETERMINISTIC seeded PRNG
 * (the procedural-spawn reproducibility guarantee, INV-DETERMINISTIC / RB §3) + a
 * placeholder-texture helper. No game/theme is encoded.
 */
import Phaser from 'phaser';

/**
 * A small, fast, DETERMINISTIC PRNG (mulberry32). Same seed ⇒ the identical sequence,
 * so the procedural obstacle stream is reproducible (a defect reproduces from its
 * seed; a restart re-seeds to byte-identical). This is the INV-DETERMINISTIC engine
 * guarantee: the spawner NEVER calls Math.random(). Returns floats in [0,1).
 */
export class SeededRandom {
  private state: number;
  private readonly seed: number;

  constructor(seed = 1) {
    // Coerce to a non-zero 32-bit integer seed.
    this.seed = (Math.floor(seed) >>> 0) || 1;
    this.state = this.seed;
  }

  /** Next float in [0,1). */
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next float in [min,max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Re-initialize to the original seed (called on restart for a clean, replayable run). */
  reset(): void {
    this.state = this.seed;
  }
}

// ── core bridge helpers (shared engine — used by core scenes after overlay) ──
// This module utils.ts overlays core/src/utils.ts, so it MUST provide the engine
// helpers the overlaid core scenes import (Preloader). Names + signatures kept
// IDENTICAL to core/src/utils.ts (mirrors templates/modules/platformer/src/utils.ts).

const PLACEHOLDER_COLORS: Record<string, number> = {
  sprite: 0x4a90d9,
  animation: 0x4a90d9,
  image: 0x9b59b6,
  tileset: 0x7f8c8d,
  background: 0x2c3e50,
};

/**
 * Generate a flat colored-rect texture under `key` if it does not exist yet (5-param
 * CORE signature — KEEP). The Preloader uses this to placeholder-fill any asset slot
 * W3 has not generated, so the game boots & renders with ZERO generated art. Generic.
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
  g.lineStyle(2, 0xffffff, 0.35);
  g.strokeRect(1, 1, width - 2, height - 2);
  g.generateTexture(key, width, height);
  g.destroy();
}

// ── placeholder-floor diagnostics (dev log ONLY — never an observed field) ───
const _warnedFloors = new Set<string>();

/**
 * Flag (console.warn, ONCE) that a primary visible object fell back to the programmatic
 * placeholder rect instead of a real generated asset. DEV DIAGNOSTIC only: writes
 * nothing to window.__GAME__ and changes no game behavior. Generic — kind + key.
 */
export function warnPlaceholderFloor(kind: string, key: string): void {
  const tag = `${kind}:${key}`;
  if (_warnedFloors.has(tag)) return;
  _warnedFloors.add(tag);
  // eslint-disable-next-line no-console
  console.warn(
    `[asset-floor] ${kind} "${key}" rendered as a placeholder rect — no real asset resolved.`,
  );
}
