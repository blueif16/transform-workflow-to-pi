/**
 * ============================================================================
 * MergeSlideResolver — the merge-slide (2048) move-resolution CORE LOOP (KEEP — engine)
 * ============================================================================
 *
 * The PURE move-resolution function the whole archetype is built around (research
 * brief §(b) engine piece 4 + the build hand-off note: "the pure resolver IS the
 * contract"). It takes the current grid + a direction INTENT and produces a NEW
 * grid + a `changed` flag + the `scoreDelta` (sum of newly-merged values) — never
 * mutating the input (pure function), so every invariant below is testable on the
 * array with no renderer.
 *
 * It encodes the three rules that make merge-slide PLAY RIGHT (the craft = rule
 * correctness, not graphics):
 *   - INV-1  a tile merges AT MOST ONCE per move ([2,2,2,2] -> [4,4,0,0], never
 *            [8,0,0,0]); the merged cell is advanced past (i += 2) so it cannot
 *            chain. No flags, no extra state.
 *   - INV-2  compress -> merge -> compress, ONE direction implemented (slideLeft);
 *            right/up/down derived by reverse/transpose, so the merge rule lives
 *            in exactly ONE place ("fix a bug once, not four times").
 *
 * Win/lose (INV-4 / INV-5) and spawn (INV-3) are separate pure helpers below so a
 * system / the scene can compose them around the resolver.
 *
 * GENERIC: the win target + spawn rates are DELTA (params), never hard-coded here.
 */
import type { Grid } from './GridBoard';

/** The four slide directions a move-slide intent resolves to. */
export type SlideDir = 'left' | 'right' | 'up' | 'down';

/** The result of resolving one move (a NEW grid; the input is never mutated). */
export interface MoveResult {
  /** The resolved grid (a fresh array). */
  grid: Grid;
  /** True iff the move actually changed the board (gates spawn — INV-3). */
  changed: boolean;
  /** Sum of the values CREATED by merges this move (the score increment). */
  scoreDelta: number;
}

// ── the ONE implemented direction: slide a single row LEFT ───────────────────
// compress -> merge -> compress (INV-2). The merge pass advances by two on a
// merge so a just-created tile is untouchable for the rest of the pass (INV-1).

/** Drop zeros, keeping order (compress toward the left wall). */
const compress = (line: number[]): number[] => {
  const out = line.filter((v) => v !== 0);
  while (out.length < line.length) out.push(0);
  return out;
};

/**
 * Resolve ONE row sliding LEFT: compress, merge adjacent equals (each tile at
 * most once — i += 2 on a merge), compress again. Returns the new row + the score
 * gained. This is the SINGLE place the merge rule lives.
 */
const slideRowLeft = (line: number[]): { row: number[]; gained: number } => {
  const packed = compress(line);
  let gained = 0;
  for (let i = 0; i < packed.length - 1; i += 1) {
    if (packed[i] !== 0 && packed[i] === packed[i + 1]) {
      const merged = packed[i] * 2;
      packed[i] = merged;
      packed[i + 1] = 0;
      gained += merged;
      i += 1; // skip the consumed right cell — this tile cannot merge again (INV-1)
    }
  }
  return { row: compress(packed), gained };
};

// ── grid orientation helpers (reflect the one direction to the other three) ──
const reverseRows = (g: Grid): Grid => g.map((r) => r.slice().reverse());
const transpose = (g: Grid): Grid =>
  g[0].map((_, c) => g.map((row) => row[c]));

/**
 * Resolve a whole move in `dir` over `grid` (PURE — `grid` is not mutated).
 * Orients the grid so the move becomes a left-slide, applies slideRowLeft to each
 * row, then orients back. INV-2: every direction shares the one merge rule.
 */
export function resolveMove(grid: Grid, dir: SlideDir): MoveResult {
  // Orient so the move is a LEFT slide.
  let work: Grid;
  switch (dir) {
    case 'left':
      work = grid.map((r) => r.slice());
      break;
    case 'right':
      work = reverseRows(grid);
      break;
    case 'up':
      work = transpose(grid);
      break;
    case 'down':
      work = reverseRows(transpose(grid));
      break;
  }

  let scoreDelta = 0;
  const slid = work.map((row) => {
    const { row: out, gained } = slideRowLeft(row);
    scoreDelta += gained;
    return out;
  });

  // Orient back to the board frame (inverse of the orient-in step).
  let resolved: Grid;
  switch (dir) {
    case 'left':
      resolved = slid;
      break;
    case 'right':
      resolved = reverseRows(slid);
      break;
    case 'up':
      resolved = transpose(slid);
      break;
    case 'down':
      resolved = transpose(reverseRows(slid));
      break;
  }

  const changed = !gridsEqual(grid, resolved);
  return { grid: resolved, changed, scoreDelta };
}

/** Cell-for-cell grid equality (the `changed` test). */
function gridsEqual(a: Grid, b: Grid): boolean {
  for (let r = 0; r < a.length; r += 1) {
    for (let c = 0; c < a[r].length; c += 1) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

// ── win / lose detection (pure; INV-4 / INV-5) ───────────────────────────────

/** INV-4: win iff any cell has reached the (DELTA-configured) target value. */
export function hasReachedTarget(grid: Grid, target: number): boolean {
  for (const row of grid) for (const v of row) if (v >= target) return true;
  return false;
}

/**
 * INV-5 (EXACT game-over): over iff there is NO empty cell AND no two
 * orthogonally-adjacent cells are equal. A FULL board that still has an adjacent
 * equal pair is NOT over (the pair can still merge). Checks empties first (cheap),
 * then scans right + down neighbours for equality.
 */
export function isGameOver(grid: Grid): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const v = grid[r][c];
      if (v === 0) return false; // an empty cell -> a move exists
      if (c + 1 < cols && grid[r][c + 1] === v) return false; // right neighbour equal
      if (r + 1 < rows && grid[r + 1][c] === v) return false; // down neighbour equal
    }
  }
  return true;
}
