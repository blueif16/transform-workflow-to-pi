/**
 * ============================================================================
 * spawn.ts — the tile-spawn helper (KEEP — engine; INV-3)
 * ============================================================================
 *
 * Research brief INV-3: "spawn a new tile ONLY on an empty cell, and ONLY if the
 * move CHANGED the board." This module owns the EMPTY-CELL picker + the spawn
 * value roll; the CALLER (DataGridScene) owns the `changed` gate — it calls
 * spawnTile ONLY when resolveMove reported changed === true, so a no-op move never
 * floods the board. Pure over the supplied RNG so a seeded harness is deterministic.
 *
 * GENERIC: the spawn-value table is DELTA (the 90%-`2` / 10%-`4` split, or any
 * level table) — passed in, never hard-coded.
 */
import type { GridBoard } from './GridBoard';

/** One spawn-value weight: a tile VALUE and its relative probability weight. */
export interface SpawnWeight {
  value: number;
  weight: number;
}

/** The default merge-slide spawn table: 90% a 2, 10% a 4. */
export const DEFAULT_SPAWN: SpawnWeight[] = [
  { value: 2, weight: 0.9 },
  { value: 4, weight: 0.1 },
];

/** Roll a spawn value from a weighted table (rng() in [0,1)). */
export function rollSpawnValue(
  table: SpawnWeight[] = DEFAULT_SPAWN,
  rng: () => number = Math.random,
): number {
  const total = table.reduce((s, t) => s + Math.max(0, t.weight), 0);
  if (total <= 0) return table[0]?.value ?? 2;
  let r = rng() * total;
  for (const t of table) {
    r -= Math.max(0, t.weight);
    if (r < 0) return t.value;
  }
  return table[table.length - 1].value;
}

/**
 * Place ONE new tile on a uniformly-random EMPTY cell (INV-3 only-on-empty).
 * Returns the placed {row,col,value}, or null when the board is full (no empty
 * cell). The CALLER must only invoke this after a CHANGED move. Mutates the board
 * (it is the one sanctioned in-place write — placing the spawned tile).
 */
export function spawnTile(
  board: GridBoard,
  table: SpawnWeight[] = DEFAULT_SPAWN,
  rng: () => number = Math.random,
): { row: number; col: number; value: number } | null {
  const empties = board.emptyCells();
  if (empties.length === 0) return null;
  const idx = Math.floor(rng() * empties.length);
  const { row, col } = empties[Math.min(idx, empties.length - 1)];
  const value = rollSpawnValue(table, rng);
  board.set(row, col, value);
  return { row, col, value };
}
