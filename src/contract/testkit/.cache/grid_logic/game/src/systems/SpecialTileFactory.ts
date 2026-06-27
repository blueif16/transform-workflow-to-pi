/**
 * SpecialTileFactory — the match-3 SPECIAL-TILE system (kind=system).
 *
 * The match-3 reward loop's payoff layer (the Bejeweled / Candy-Crush family):
 * clearing a LONG run mints a SPECIAL tile, and triggering that special detonates a
 * whole line or area. It is a peer of TurnDuel / MineReveal — a scene-level
 * IGridSystem bound by id into the scene's systems[] and lifecycled by DataGridScene
 * (reset()/attach()) — but it owns the special-tile rule for the `match-3-swap`
 * genre rather than the deduction or duel rule.
 *
 * WHERE IT PLUGS IN. SpecialTileFactory does NOT re-implement the cascade — SwapMatch
 * owns the swap → clear → gravity → refill rule and EMITS the match moments on the
 * shared eventBus. This system SUBSCRIBES to those moments (the PUSH channel is the
 * seam, exactly as guidance/sfx wiring does): it listens for `match.cleared` (whose
 * `count` is the run length) to decide WHEN to mint a special, and tracks `gems.swapped`
 * so a swap that touches a live special TRIGGERS it. So it composes with the existing
 * rule with zero edits to it.
 *
 * THE MECHANIC (real logic, observable on scene.board):
 *   - CREATE: when a clear's run length is >= the line threshold (default 4), the
 *     factory mints a SPECIAL tile at the match origin cell — it writes a SPECIAL
 *     MARKER value into scene.board at that cell (a high sentinel, distinct from any
 *     gem id) and records its kind + base colour. A run of >= the colour threshold
 *     (default 5) mints a COLOUR-BOMB; 4 mints a LINE-BOMB. The marker is a real
 *     board write, so board.snapshot() (and the cursor) reflect the new special tile.
 *     -> emits 'special.created'.
 *   - DETONATE: a special is triggered either by a swap that lands on its cell
 *     (observed via 'gems.swapped') or by the public triggerAt(row,col) seam. A
 *     LINE-BOMB clears its entire row AND column; a COLOUR-BOMB clears every cell of
 *     its recorded base colour across the whole board. The cleared cells are written
 *     empty (0) in scene.board, the board is repainted, and the cursor is re-derived.
 *     -> emits 'special.detonated' with the count of cells cleared.
 *
 * THE SEAM: triggerAt(row,col) is PUBLIC so a headless harness can drive a detonation
 * directly (mirrors TurnDuel.placeAt / MineReveal.revealAt as the driveable seam),
 * and so a swap-onto-special auto-triggers it.
 *
 * Observables (its OWN real counters, published on the pull channel):
 *   __GAME__.specialCount    — live special tiles currently on the board (INCREASES
 *                              on create, DECREASES when one detonates);
 *   __GAME__.detonatedCount  — total cells cleared by detonations so far (INCREASES).
 *
 * idSource: a special's identity is DERIVED — its cell (row,col) plus the minted kind
 * (line|colour). No per-game id param is needed; the location + kind name it.
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, never a fabricated game number):
 *   lineThreshold    run length that mints a LINE-BOMB (default 4).
 *   colorThreshold   run length that mints a COLOUR-BOMB (default 5).
 *   specialBase      the sentinel marker base written into the board for a special
 *                    tile (default 90; the kind offsets it, so it never collides with
 *                    a gem id 1..N). DECLARED, not magic — a blueprint may override.
 *
 * GENERIC: no game/theme is encoded — a TYPE bound by id. Thresholds + the marker are
 * declared defaults a blueprint overrides via params, never hard-coded per-game.
 */
import type { IGridSystem } from '../scenes/grid-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (globbed by registry/discover.mjs — mirrors MineReveal/TurnDuel). */
export const CAPABILITY = {
  kind: 'system',
  id: 'SpecialTileFactory',
  intent:
    'Match-3 special-tile system: a long match (>= lineThreshold, default 4) mints a line-bomb; >= colorThreshold (default 5) mints a colour-bomb, written as a marker tile on the board. Triggering a special (a swap onto it, or triggerAt) detonates it — a line-bomb clears its whole row+column, a colour-bomb clears all of one colour. Subscribes to match.cleared / gems.swapped; counts published as __GAME__.specialCount / __GAME__.detonatedCount.',
  attachesTo: 'scene',
  params: ['lineThreshold', 'colorThreshold', 'specialBase'],
  roles: ['board'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** Declared defaults — the classic match-3 special thresholds + a non-colliding marker. */
const DEFAULT_LINE_THRESHOLD = 4;
const DEFAULT_COLOR_THRESHOLD = 5;
const DEFAULT_SPECIAL_BASE = 90;
/** Kind offsets added to specialBase so a marker encodes both "special" AND its kind. */
const LINE_OFFSET = 0;
const COLOR_OFFSET = 1;

type SpecialKind = 'line' | 'color';

interface SpecialTile {
  row: number;
  col: number;
  kind: SpecialKind;
  /** The base gem colour the special was minted from (a colour-bomb clears this id). */
  baseColor: number;
}

export interface SpecialTileFactoryConfig {
  /** Run length that mints a line-bomb (default 4). */
  lineThreshold?: number;
  /** Run length that mints a colour-bomb (default 5). */
  colorThreshold?: number;
  /** Sentinel marker base written for a special tile (default 90). */
  specialBase?: number;
}

export class SpecialTileFactory implements IGridSystem {
  private scene: any;

  // ── declared config (sensible defaults; NEVER fabricated per-game) ──
  private readonly lineThreshold: number;
  private readonly colorThreshold: number;
  private readonly specialBase: number;

  // ── run state (cleared by reset()) ──
  /** Live specials keyed by 'row,col' (a special is identified by its cell + kind). */
  private specials = new Map<string, SpecialTile>();
  /** The colour of the most-recent clear, captured so a mint knows its base colour. */
  private lastClearColor = 0;

  /** OWN observable counters (read by surface().observables thunks). */
  public specialCount = 0;
  public detonatedCount = 0;

  /** Bus unsubscribe handles, released on reset()/re-attach (no leak across restarts). */
  private offHandlers: Array<() => void> = [];

  /** The shared event bus, resolved from the attached scene. Publish via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  constructor(params: SpecialTileFactoryConfig = {}) {
    this.lineThreshold =
      typeof params.lineThreshold === 'number' && params.lineThreshold >= 3
        ? Math.floor(params.lineThreshold)
        : DEFAULT_LINE_THRESHOLD;
    this.colorThreshold =
      typeof params.colorThreshold === 'number' && params.colorThreshold > this.lineThreshold
        ? Math.floor(params.colorThreshold)
        : Math.max(DEFAULT_COLOR_THRESHOLD, this.lineThreshold + 1);
    this.specialBase =
      typeof params.specialBase === 'number' && params.specialBase > 0
        ? Math.floor(params.specialBase)
        : DEFAULT_SPECIAL_BASE;
  }

  /** Re-arm to a fresh state (the scene calls reset() before attach on a RESTART). */
  reset(): void {
    for (const off of this.offHandlers) off();
    this.offHandlers = [];
    this.specials = new Map();
    this.lastClearColor = 0;
    this.specialCount = 0;
    this.detonatedCount = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    const bus = scene?.eventBus;
    if (!bus?.on) return;

    // Capture the swap so we know WHICH colour a subsequent clear was built from, and
    // so a swap LANDING on a live special triggers it (the detonate input seam).
    this.offHandlers.push(
      bus.on('gems.swapped', (p: any) => this.onSwapped(p)),
    );
    // The mint trigger: a long clear mints a special at the clear's origin.
    this.offHandlers.push(
      bus.on('match.cleared', (p: any) => this.onMatchCleared(p)),
    );
  }

  // ── the bus subscriptions (where this system reacts to the cascade) ───────────

  /**
   * A swap landed. Record the colours under the two swapped cells (so a following
   * match.cleared knows its base colour) and, if either swapped cell holds a live
   * special, TRIGGER it (a swap onto a special detonates it — the input seam).
   */
  private onSwapped(p: any): void {
    const board = this.scene?.board;
    if (!board) return;
    const r1 = p?.r1, c1 = p?.c1, r2 = p?.r2, c2 = p?.c2;
    if (typeof r1 === 'number' && typeof c1 === 'number') {
      const v = board.get?.(r1, c1) ?? 0;
      if (!this.isSpecialMarker(v)) this.lastClearColor = v;
    }
    if (typeof r2 === 'number' && typeof c2 === 'number') {
      const v = board.get?.(r2, c2) ?? 0;
      if (!this.isSpecialMarker(v)) this.lastClearColor = v;
    }
    // A swap onto a live special triggers it.
    if (this.specials.has(`${r1},${c1}`)) this.triggerAt(r1, c1);
    else if (this.specials.has(`${r2},${c2}`)) this.triggerAt(r2, c2);
  }

  /**
   * A run of >= MIN_RUN cleared (SwapMatch's match.cleared, `count` = run length).
   * When the run is long enough, MINT a special at the cleared run's origin cell:
   * write the kind-encoded marker into the board (an observable board write) and
   * record the special. >= colorThreshold => colour-bomb; >= lineThreshold => line-bomb.
   */
  private onMatchCleared(p: any): void {
    const board = this.scene?.board;
    if (!board || this.scene?.gameCompleted) return;
    const count = typeof p?.count === 'number' ? p.count : 0;
    if (count < this.lineThreshold) return;

    const kind: SpecialKind = count >= this.colorThreshold ? 'color' : 'line';
    const cell = this.firstEmptyCell(board);
    if (!cell) return; // no room to host the special this pass (a no-op, not a crash)

    const baseColor = this.lastClearColor > 0 ? this.lastClearColor : 1;
    const marker = this.markerFor(kind);
    board.set?.(cell.row, cell.col, marker);
    this.specials.set(`${cell.row},${cell.col}`, {
      row: cell.row,
      col: cell.col,
      kind,
      baseColor,
    });
    this.specialCount += 1;

    this.scene?.refreshCursor?.();
    this.scene?.paintTiles?.();

    // special.created — the mint moment (a special tile now sits on the board). LEAN.
    this.bus?.emit('special.created', {
      row: cell.row,
      col: cell.col,
      kind,
      runLength: count,
      baseColor,
    });
  }

  // ── the detonate seam (PUBLIC — a headless harness drives this directly) ──────

  /**
   * Trigger the special at (row,col): clear its blast and remove it. A LINE-BOMB
   * clears its whole row + column; a COLOUR-BOMB clears every cell of its base
   * colour across the board. The cleared cells are written empty in scene.board
   * (an observable board change), then the board repaints + the cursor re-derives.
   * A cell with no live special is a no-op. Emits 'special.detonated'.
   */
  public triggerAt(row: number, col: number): void {
    const board = this.scene?.board;
    if (!board || this.scene?.gameCompleted) return;
    const key = `${row},${col}`;
    const special = this.specials.get(key);
    if (!special) return;

    // Remove the special from tracking BEFORE clearing (so its own marker clears too
    // and it cannot re-trigger itself within this detonation).
    this.specials.delete(key);
    this.specialCount = Math.max(0, this.specialCount - 1);

    const cleared = special.kind === 'line'
      ? this.clearLine(board, row, col)
      : this.clearColor(board, special.baseColor);

    this.detonatedCount += cleared;

    this.scene?.refreshCursor?.();
    this.scene?.paintTiles?.();

    // special.detonated — the blast moment (a line/area emptied). LEAN payload.
    this.bus?.emit('special.detonated', {
      row,
      col,
      kind: special.kind,
      cleared,
      detonated: this.detonatedCount,
    });
  }

  // ── core blast logic (the genuine clear, over the real board) ──────────────────

  /** Clear the entire row AND column through (row,col); returns cells cleared. */
  private clearLine(board: any, row: number, col: number): number {
    const rows = board.rows ?? 0;
    const cols = board.cols ?? 0;
    let cleared = 0;
    for (let c = 0; c < cols; c += 1) {
      if ((board.get?.(row, c) ?? 0) !== 0) {
        board.set?.(row, c, 0);
        cleared += 1;
        this.specials.delete(`${row},${c}`); // a chained special is consumed by the blast
      }
    }
    for (let r = 0; r < rows; r += 1) {
      if (r === row) continue; // the intersection cell already counted in the row pass
      if ((board.get?.(r, col) ?? 0) !== 0) {
        board.set?.(r, col, 0);
        cleared += 1;
        this.specials.delete(`${r},${col}`);
      }
    }
    return cleared;
  }

  /** Clear every cell holding `baseColor` across the whole board; returns cells cleared. */
  private clearColor(board: any, baseColor: number): number {
    const rows = board.rows ?? 0;
    const cols = board.cols ?? 0;
    let cleared = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if ((board.get?.(r, c) ?? 0) === baseColor && baseColor !== 0) {
          board.set?.(r, c, 0);
          cleared += 1;
          this.specials.delete(`${r},${c}`);
        }
      }
    }
    return cleared;
  }

  // ── helpers ────────────────────────────────────────────────────────────────────

  /** The kind-encoded sentinel marker written into the board for a special tile. */
  private markerFor(kind: SpecialKind): number {
    return this.specialBase + (kind === 'color' ? COLOR_OFFSET : LINE_OFFSET);
  }

  /** True iff `v` is one of this factory's special markers (not a plain gem id). */
  private isSpecialMarker(v: number): boolean {
    return v === this.markerFor('line') || v === this.markerFor('color');
  }

  /** The first empty cell on the board (where a freshly-minted special is placed). */
  private firstEmptyCell(board: any): { row: number; col: number } | null {
    const rows = board.rows ?? 0;
    const cols = board.cols ?? 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if ((board.get?.(r, c) ?? 0) === 0) return { row: r, col: c };
      }
    }
    return null;
  }

  // ── component surface (the declared event + observable set) ────────────────────

  /**
   * The uniform component surface for the special-tile system. Each EventDecl is a
   * TRUE statement about a real .emit() site in this file:
   *   - special.created   <- onMatchCleared (a long run mints a special on the board)
   *   - special.detonated <- triggerAt (a special is triggered; a line/area clears)
   */
  surface(): ComponentSurface {
    return {
      observables: {
        specialCount: () => this.specialCount,
        detonatedCount: () => this.detonatedCount,
      },
      anchors: [],
      events: [
        {
          name: 'special.created',
          payload: '{row,col,kind,runLength,baseColor}',
          scope: 'archetype',
          drivenBy: 'a match of 4+ forms',
          expect: '__GAME__ a special tile appears on the board; special.created logged',
        },
        {
          name: 'special.detonated',
          payload: '{row,col,kind,cleared,detonated}',
          scope: 'archetype',
          drivenBy: 'a special tile is matched/triggered',
          expect: '__GAME__ a whole line or colour clears (cells empty); special.detonated logged',
        },
      ],
    };
  }
}
