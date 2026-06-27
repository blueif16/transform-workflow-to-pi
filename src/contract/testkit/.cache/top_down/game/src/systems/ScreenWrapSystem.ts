/**
 * ScreenWrapSystem — toroidal screen wrap for an inertial-space arena (BUILD —
 * system; top_down:inertial-space, DR §9 inertial PER-GENRE CHECK = screen-wrap).
 *
 * Makes the play-field a TORUS: any wrappable entity whose position passes a screen
 * bound is SHIFTED by the screen dimension to the opposite edge — x += / -= screenWidth,
 * y += / -= screenHeight — and NOT snapped to the edge, so the sub-pixel overshoot is
 * preserved and motion stays smooth (the rocketshipgames.com canon: add/subtract, never
 * clamp). Applies to ALL wrappable entities (the ship, bullets, hazards) — every member
 * of the live gameplay groups the __GAME__ hook reads, plus the player.
 *
 * Why a system (not the default bounds): BaseGameScene.setupWorldBounds() makes all four
 * world bounds SOLID and calls setCollideWorldBounds(true) on the player + enemies, which
 * would BLOCK a crossing. This system DISABLES that clamp on the entities it owns (so they
 * can actually pass the bound) and then wraps them each tick — the torus replaces the wall.
 *
 * Observable (__GAME__): an entity past a bound reappears on the FAR side. The player shows
 * up as player.x|y (and entities['player']); every other wrapped sprite as its
 * __GAME__.entities[*].x|y. On each wrap the entity's x|y jumps by ±screen-dimension while
 * its velocity (and thus continuous motion) is untouched.
 *
 * It owns NO win and NO score; it only repositions sprites. The id in the emit payload is
 * AUTO-DERIVED from the crossing entity (mirrors core/hook.ts entityId: __id ?? entityId ??
 * name, and 'player' for the player) — never a config param.
 *
 * Params (all OPTIONAL — sensible defaults, no baked game/theme/coordinate):
 *   groups   the live group names this system wraps (default mirrors the hook's
 *            gameplay groups: enemies/decorations/collectibles/hazards/obstacles/
 *            projectiles/playerBullets/enemyBullets). The player is always wrapped.
 *   margin   how far PAST a bound (px) an entity must travel before it wraps, so a sprite
 *            straddling the edge does not flicker (default 0 — wrap the instant the
 *            CENTER crosses the bound; a positive margin lets the sprite fully exit first).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ScreenWrapSystem',
  intent:
    'Toroidal screen wrap for an inertial-space arena: any wrappable entity (ship, bullets, hazards) that passes a screen bound is shifted by the screen dimension to the opposite edge (add/subtract, not snapped — sub-pixel overshoot preserved). Replaces the solid world bounds with a torus.',
  attachesTo: 'scene',
  params: ['groups', 'margin'],
  roles: ['player', 'enemy', 'projectile', 'hazard'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** The live gameplay group names the __GAME__ hook reads — the wrap default set. */
const DEFAULT_WRAP_GROUPS = [
  'enemies',
  'decorations',
  'collectibles',
  'hazards',
  'obstacles',
  'projectiles',
  'playerBullets',
  'enemyBullets',
] as const;

export interface ScreenWrapConfig {
  groups?: string[];
  margin?: number;
}

export class ScreenWrapSystem implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly groups: string[];
  private readonly margin: number;

  constructor(params: ScreenWrapConfig = {}) {
    this.groups =
      Array.isArray(params.groups) && params.groups.length > 0
        ? params.groups.slice()
        : [...DEFAULT_WRAP_GROUPS];
    this.margin = Number.isFinite(params.margin) ? Number(params.margin) : 0;
  }

  reset(): void {
    // No internal latch — the wrap is recomputed from the live world each tick.
  }

  attach(scene: any): void {
    this.scene = scene;
    // The torus replaces the solid wall: a clamped body can never pass a bound, so the
    // wrap could never fire. Release the player (and any already-spawned enemies) from
    // the world-bounds clamp BaseGameScene.setupWorldBounds() applied.
    this.releaseClamp(scene.player);
    for (const sprite of this.wrappableSprites()) this.releaseClamp(sprite);
  }

  setupCollisions(): void {
    // Enemies are spawned by setupCollisions time; release any the SDK clamped after attach().
    for (const sprite of this.wrappableSprites()) this.releaseClamp(sprite);
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    const w = this.screenWidth();
    const h = this.screenHeight();
    if (w <= 0 || h <= 0) return;

    // The player first (its wrap surfaces as __GAME__.player.x|y).
    this.wrapOne(scene.player, 'player', w, h);
    // Then every wrappable group sprite (each surfaces as __GAME__.entities[*].x|y).
    for (const sprite of this.wrappableSprites()) {
      this.wrapOne(sprite, this.entityIdOf(sprite), w, h);
    }
  }

  // ── the wrap (add/subtract a screen dimension — NOT a snap) ──────────────────

  /**
   * Wrap one sprite across the torus. If its CENTER has passed a bound by `margin`, shift
   * it by exactly the screen dimension to the opposite edge — preserving the sub-pixel
   * overshoot (new = old ± dim, so an entity 3.4px past the right edge lands 3.4px in from
   * the left). Velocity is untouched, so continuous motion carries through the seam.
   */
  private wrapOne(sprite: any, id: string, w: number, h: number): void {
    if (!sprite || sprite.active === false) return;
    let edge: string | null = null;
    let nx = sprite.x;
    let ny = sprite.y;

    if (sprite.x < -this.margin) {
      nx = sprite.x + w; // off the LEFT → reappear on the RIGHT
      edge = 'left';
    } else if (sprite.x > w + this.margin) {
      nx = sprite.x - w; // off the RIGHT → reappear on the LEFT
      edge = 'right';
    }
    if (sprite.y < -this.margin) {
      ny = sprite.y + h; // off the TOP → reappear on the BOTTOM
      edge = edge ?? 'top';
    } else if (sprite.y > h + this.margin) {
      ny = sprite.y - h; // off the BOTTOM → reappear on the TOP
      edge = edge ?? 'bottom';
    }
    if (edge === null) return;

    this.reposition(sprite, nx, ny);
    // The crossing is the true gameplay seam: an entity's x|y just jumped by ±screen-dim
    // to the far side. Surfaces on __GAME__.entities / player.x|y; logged on the bus.
    this.bus?.emit('entity.wrapped', { id, edge });
  }

  /** Move a sprite (keep the arcade body in sync — setPosition alone desyncs it). */
  private reposition(sprite: any, x: number, y: number): void {
    if (sprite.body?.reset) sprite.body.reset(x, y);
    else sprite.setPosition?.(x, y);
  }

  // ── wrappable set + clamp release ────────────────────────────────────────────

  /** Every live sprite in the wrap groups (the same groups __GAME__.entities reads). */
  private wrappableSprites(): any[] {
    const scene = this.scene;
    const out: any[] = [];
    for (const name of this.groups) {
      const group = scene?.[name];
      if (!group || typeof group.getChildren !== 'function') continue;
      for (const child of group.getChildren()) {
        if (child && child.active !== false) out.push(child);
      }
    }
    return out;
  }

  /** Drop the solid-world-bounds clamp so the body can actually pass a bound. */
  private releaseClamp(sprite: any): void {
    sprite?.setCollideWorldBounds?.(false);
  }

  /** Auto-derive the entity id (mirrors core/hook.ts entityId resolution order). */
  private entityIdOf(sprite: any): string {
    return (sprite?.__id ?? sprite?.entityId ?? sprite?.name ?? 'entity') as string;
  }

  private screenWidth(): number {
    const scene = this.scene;
    return Number(scene?.mapWidth ?? scene?.scale?.width ?? 0);
  }

  private screenHeight(): number {
    const scene = this.scene;
    return Number(scene?.mapHeight ?? scene?.scale?.height ?? 0);
  }

  // ── component surface (the declared PUSH channel) ────────────────────────────

  /**
   * The event this system publishes on the shared bus. One moment — an entity wrapped
   * across a screen bound — fired at the true seam in wrapOne(). The matching .emit() is
   * `this.scene.eventBus.emit('entity.wrapped', { id, edge })`.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'entity.wrapped',
          payload: '{id,edge}',
          scope: 'archetype',
          drivenBy: "an entity's position crosses a screen bound",
          expect:
            'the entity x|y jumps by ±screen-dimension to the opposite edge in __GAME__.entities / player.x|y (continuous motion preserved); entity.wrapped logged',
        },
      ],
    };
  }
}
