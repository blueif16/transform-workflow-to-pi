/**
 * ============================================================================
 * ball-physics.ts — the PADDLE-BALL REFLECTION ENGINE (KEEP — the new engine core)
 * ============================================================================
 *
 * The ~80% undifferentiated physics every paddle-ball game shares, written ONCE as
 * PURE functions (no Phaser, no scene) so the §2 acceptance invariants are directly
 * testable and the scene just drives them. Grounded in
 * research/paddle_ball-category-research-2026-06-19.md (cited [RB §x]).
 *
 * THREE reflection rules + ONE integration rule:
 *
 *  1. WALL bounce (mirror) — a solid top/left/right wall flips the crossing axis.
 *  2. BRICK bounce (axis-resolved by SHALLOW penetration) — on a ball↔AABB overlap the
 *     axis with the SMALLER penetration is the one that flipped, so a corner hit
 *     reflects correctly and the ball never burrows the wrong way [RB §2.3].
 *  3. PADDLE bounce by CONTACT POINT (NOT a mirror) — the decisive skill rule [RB §2.1]:
 *     map the hit to offset = (ballX − paddleCenterX) / paddleHalfWidth ∈ [−1, 1], build
 *     dir = normalize({ x: offset·maxSteer, y: −1 }), then velocity = dir · speed. A
 *     near-EDGE hit returns at a STEEPER horizontal angle than a CENTER hit, and the
 *     TOTAL speed is preserved (we rescale to the incoming speed) — the bounce changes
 *     the ANGLE, never the SPEED [RB §1].
 *
 *  4. SUB-STEPPED integration (continuous collision; the no-tunnel rule [RB §2.2]) — the
 *     ball's per-frame displacement is split into N steps each ≤ a min collider extent,
 *     resolving collisions after every step, so even a fast ball can never teleport past
 *     the thin paddle (a life it never earned) or skip a brick row.
 *
 * GENERIC: every number is a parameter; no game/theme, no baked coordinate.
 */

/** A 2D vector (mutable, plain — no engine type). */
export interface Vec2 {
  x: number;
  y: number;
}

/** An axis-aligned box by CENTER + half-extents (the ball + bricks + paddle all use this). */
export interface AABB {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

/** Make an AABB from a center + full size. */
export function aabb(cx: number, cy: number, width: number, height: number): AABB {
  return { cx, cy, halfW: width / 2, halfH: height / 2 };
}

/** The magnitude (speed) of a velocity vector. */
export function speedOf(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** True iff two AABBs overlap (strict — touching edges do not count). */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    Math.abs(a.cx - b.cx) < a.halfW + b.halfW &&
    Math.abs(a.cy - b.cy) < a.halfH + b.halfH
  );
}

/**
 * Resolve a ball↔brick (or ball↔solid-AABB) overlap. Reflects the SHALLOW axis (the
 * one with the smaller penetration), so a corner hit picks the correct axis and the
 * ball is pushed OUT along that axis by the penetration depth (no sticking). Mutates
 * `vel` and returns the reflected axis ('x' | 'y') so the caller knows what happened.
 * [RB §2.3] — exact grid collision.
 */
export function resolveAABBBounce(ball: AABB, box: AABB, vel: Vec2): 'x' | 'y' {
  // Penetration depth on each axis (positive when overlapping).
  const penX = ball.halfW + box.halfW - Math.abs(ball.cx - box.cx);
  const penY = ball.halfH + box.halfH - Math.abs(ball.cy - box.cy);
  if (penX < penY) {
    // shallow X → flip horizontal velocity + push out along x
    vel.x = -vel.x;
    ball.cx += ball.cx < box.cx ? -penX : penX;
    return 'x';
  }
  // shallow Y → flip vertical velocity + push out along y
  vel.y = -vel.y;
  ball.cy += ball.cy < box.cy ? -penY : penY;
  return 'y';
}

/**
 * The PADDLE bounce by CONTACT POINT — the skill rule [RB §2.1, §1]. Given the ball's
 * x at impact, the paddle center x, the paddle half-width, the (constant) ball speed,
 * and a steering strength, return the NEW velocity:
 *
 *   offset    = clamp((ballX − paddleCenterX) / paddleHalfWidth, −1, 1)
 *   dir       = normalize({ x: offset·maxSteer, y: −1 })   // y always up off the paddle
 *   newVel    = dir · speed                                // SAME total speed
 *
 * `maxSteer` (default 2.2) sets how sharp an edge hit gets: a CENTER hit (offset 0) →
 * straight up (vx 0, |vy| = speed); a full-EDGE hit (offset ±1) → a strongly horizontal
 * launch with |vx| ≈ speed·maxSteer/√(maxSteer²+1). So edge |vx| > center |vx| always —
 * the steering invariant — while |newVel| === speed always (speed preserved). The y
 * component is forced NEGATIVE (upward, screen-down-is-positive) so the ball never
 * sticks below the bat (the LearnOpenGL always-positive-y unstick).
 */
export function paddleBounce(
  ballX: number,
  paddleCenterX: number,
  paddleHalfWidth: number,
  speed: number,
  maxSteer = 2.2,
): Vec2 {
  const raw = (ballX - paddleCenterX) / Math.max(1e-6, paddleHalfWidth);
  const offset = Math.max(-1, Math.min(1, raw));
  const dx = offset * maxSteer;
  const dy = -1; // always launch upward off the paddle
  const len = Math.hypot(dx, dy) || 1;
  return { x: (dx / len) * speed, y: (dy / len) * speed };
}

/**
 * How many sub-steps to split this frame's motion into so the step length never
 * exceeds `minExtent` (the smallest collider half-extent in the scene — the ball
 * radius / a brick/paddle thickness). dt is in seconds. [RB §2.2] — the no-tunnel
 * guarantee scales with speed: a faster ball gets more sub-steps automatically.
 */
export function subStepCount(vel: Vec2, dt: number, minExtent: number): number {
  const dist = speedOf(vel) * dt;
  return Math.max(1, Math.ceil(dist / Math.max(1, minExtent)));
}
