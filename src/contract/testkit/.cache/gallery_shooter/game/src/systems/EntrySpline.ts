/**
 * EntrySpline — the swooping ENTRY-CHOREOGRAPHY + captor system (BUILD — the Galaga
 * "formation" genre engine piece). Where FormationMarch animates the rack ONCE it is
 * settled, EntrySpline is the layer BEFORE the rack settles: each formation member
 * flies in along a CURVED spline path from an off-screen origin to its assigned rack
 * SLOT, then "locks" into the formation. One designated member is a CAPTOR — once it
 * has settled it can fire a tractor beam straight down its column; a player ship that
 * the beam reaches is CAPTURED (its mover frozen, a captured flag set). Destroying the
 * captor RESCUES the captured ship — the player regains a second ship (a health bump,
 * the Galaga twin-fighter reward).
 *
 * It DOES NOT own enemy creation — DataShooterScene builds the grid members (tagged
 * .__formation, with a __row/__col offset) into scene.enemies, the SAME group the
 * bullet-collision path kills + FormationMarch marches. This system READS that group,
 * and on attach:
 *   1. records each member's BUILT position as its rack SLOT (the target),
 *   2. re-parks each member at an off-screen ENTRY origin (alternating left/right per
 *      row) and flags it .__entering,
 *   3. each frame, advances every entering member a step ALONG a quadratic-Bézier
 *      spline (origin → a curved control point → slot); on arrival it pins the member
 *      to its slot, clears the flag, and emits enemy.entered (the member JOINS the
 *      formation — FormationMarch then owns it).
 *   4. designates ONE settled member the CAPTOR; on a cadence it fires a capture beam
 *      down its column. If the player sits under the beam (same x-band, below it) and is
 *      not already captured, the ship is CAPTURED: ship.captured fires, scene.shipCaptured
 *      latches true, and the player's mover input is frozen.
 *   5. when the captor is destroyed (isDead) while a ship is captured, the ship is
 *      RESCUED: ship.rescued fires, the captured flag clears, the mover unfreezes, and
 *      the player gains a SECOND SHIP (health += rescueBonus, capped at maxHealth+1).
 *
 * GENERIC: no game/theme, no baked coordinate — the rack slots come from the live
 * members' BUILT positions + the map bounds; the spline shape / cadence / bonus from
 * params. A level with no formation is a clean no-op.
 *
 * EVENTS (the PUSH channel):
 *   - enemy.entered ← a member finishing its entry spline (joins the formation)
 *   - ship.captured ← the captor beam reaching the player (captured flag set)
 *   - ship.rescued  ← the captor destroyed while a ship is captured (regain a second ship)
 *
 * ID-SOURCE: the enemy/captor `id` payload field is AUTO-DERIVED from the bound entity
 * — the formation member's engine-assigned `.__id` (DataShooterScene.spawnMember sets
 * `inv_<row>_<col>_<n>`), never a fabricated config id.
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible declared defaults):
 *   entryMs        ms a member takes to fly its full entry spline (default 900).
 *   entryStaggerMs per-member launch stagger so they swoop in sequence (default 90).
 *   bowPx          lateral bow of the spline control point off the straight line (default 120).
 *   captorBeamMs   ms between captor beam pulses once it has settled (default 2200).
 *   beamBandPx     half-width (px) of the capture beam's column hit band (default 22).
 *   rescueBonus    health (second ships) granted on a rescue (default 1).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'EntrySpline',
  intent:
    'Fly each formation member in along a curved Bézier spline from an off-screen origin to its rack slot before it settles, then designate a CAPTOR that fires a tractor beam down its column to capture the player ship — destroying the captor rescues the ship and grants a second ship. The Galaga formation-entry + capture/rescue choreography.',
  attachesTo: 'scene',
  params: ['entryMs', 'entryStaggerMs', 'bowPx', 'captorBeamMs', 'beamBandPx', 'rescueBonus'],
  roles: ['enemy', 'player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface EntrySplineConfig {
  entryMs?: number;
  entryStaggerMs?: number;
  bowPx?: number;
  captorBeamMs?: number;
  beamBandPx?: number;
  rescueBonus?: number;
}

/** Per-member entry-flight record (the spline endpoints + its launch offset). */
interface EntryFlight {
  sprite: any;
  /** off-screen entry origin (world px). */
  ox: number;
  oy: number;
  /** the rack SLOT (the member's BUILT position — the target). */
  sx: number;
  sy: number;
  /** the curved control point (origin/slot midpoint, bowed laterally). */
  cx: number;
  cy: number;
  /** ms this member waits before its swoop begins (the stagger). */
  delayMs: number;
  /** ms elapsed against this member's own flight clock. */
  t: number;
  /** latched once it has reached its slot + emitted enemy.entered. */
  arrived: boolean;
}

export class EntrySpline implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly entryMs: number;
  private readonly entryStaggerMs: number;
  private readonly bowPx: number;
  private readonly captorBeamMs: number;
  private readonly beamBandPx: number;
  private readonly rescueBonus: number;

  /** The members currently flying their entry spline (cleared as each arrives). */
  private flights: EntryFlight[] = [];
  /** The designated captor (a settled member) + its beam clock. */
  private captor: any = null;
  private beamAcc = 0;
  /** Whether the player ship is currently captured (mirrored to scene.shipCaptured). */
  private captured = false;
  /** Latches once the rescue (second-ship grant) has fired for the current capture. */
  private rescuedThisCapture = false;

  constructor(params: EntrySplineConfig = {}) {
    this.entryMs = Math.max(1, params.entryMs ?? 900);
    this.entryStaggerMs = Math.max(0, params.entryStaggerMs ?? 90);
    this.bowPx = params.bowPx ?? 120;
    this.captorBeamMs = Math.max(1, params.captorBeamMs ?? 2200);
    this.beamBandPx = Math.max(1, params.beamBandPx ?? 22);
    this.rescueBonus = Math.max(0, Math.floor(params.rescueBonus ?? 1));
  }

  reset(): void {
    this.flights = [];
    this.captor = null;
    this.beamAcc = 0;
    this.captured = false;
    this.rescuedThisCapture = false;
  }

  attach(scene: any): void {
    this.scene = scene;
    scene.shipCaptured = false;
    scene.registry?.set?.('shipCaptured', false);
    // Publish self so diagnostics / a future system can read the entry + capture state.
    scene.__entrySpline = this;
    this.seedEntryFlights();
  }

  /**
   * Record each member's BUILT position as its rack slot, then re-park it at an
   * off-screen origin and start its spline flight (the swoop-in). Alternates the entry
   * side per row so the formation streams in from both edges (the Galaga look).
   */
  private seedEntryFlights(): void {
    const scene = this.scene;
    const members = this.members();
    if (members.length === 0) return;
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    this.flights = [];
    members.forEach((m: any, i: number) => {
      const sx = m.x;
      const sy = m.y;
      // Enter from the left edge on even rows, the right edge on odd rows; start above.
      const fromLeft = (m.__row ?? 0) % 2 === 0;
      const ox = fromLeft ? -40 : W + 40;
      const oy = -40 - (m.__col ?? 0) * 6;
      // Bow the control point laterally so the path is a CURVE, not a straight line.
      const midX = (ox + sx) / 2;
      const midY = (oy + sy) / 2;
      const bowDir = fromLeft ? 1 : -1;
      const cx = midX + bowDir * this.bowPx;
      const cy = midY;
      m.x = ox;
      m.y = oy;
      m.__entering = true;
      const body = m.body;
      if (body) body.enable = false; // not collidable until it joins the rack.
      this.flights.push({
        sprite: m,
        ox, oy, sx, sy, cx, cy,
        delayMs: i * this.entryStaggerMs,
        t: 0,
        arrived: false,
      });
    });
  }

  /** The live formation members (tagged .__formation, still active + not dead). */
  private members(): any[] {
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return [];
    return grp.getChildren().filter((e: any) => e && e.__formation && e.active !== false && !e.isDead);
  }

  /** Quadratic Bézier point at parameter u∈[0,1] over (a → c → b). */
  private bezier(a: number, c: number, b: number, u: number): number {
    const iu = 1 - u;
    return iu * iu * a + 2 * iu * u * c + u * u * b;
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    const dtMs = scene.game?.loop?.delta ?? 16.67;

    this.advanceEntries(dtMs);
    this.tickCaptor(dtMs);
    this.checkRescue();
  }

  /** Advance every still-flying member one step along its spline; arrive → enemy.entered. */
  private advanceEntries(dtMs: number): void {
    if (this.flights.length === 0) return;
    const stillFlying: EntryFlight[] = [];
    for (const f of this.flights) {
      const m = f.sprite;
      if (!m || m.isDead || m.active === false) continue; // killed mid-entry — drop it.
      f.t += dtMs;
      const active = Math.max(0, f.t - f.delayMs);
      const u = Math.min(1, active / this.entryMs);
      m.x = this.bezier(f.ox, f.cx, f.sx, u);
      m.y = this.bezier(f.oy, f.cy, f.sy, u);
      if (u >= 1 && !f.arrived) {
        // The member reached its slot — it JOINS the formation.
        f.arrived = true;
        m.x = f.sx;
        m.y = f.sy;
        m.__entering = false;
        const body = m.body;
        if (body) body.enable = true; // now collidable (a bullet can kill it).
        // The PUSH seam: a member finished its entry spline (joined the rack).
        this.bus?.emit('enemy.entered', { id: m.__id, x: f.sx, y: f.sy });
        continue;
      }
      stillFlying.push(f);
    }
    this.flights = stillFlying;
  }

  /** Once the entries are done, pick a captor + fire its capture beam on a cadence. */
  private tickCaptor(dtMs: number): void {
    const scene = this.scene;
    // The captor must be a SETTLED member (no longer entering) and still alive.
    if (!this.captor || this.captor.isDead || this.captor.active === false || this.captor.__entering) {
      this.captor = this.members().find((m: any) => !m.__entering) ?? null;
      this.beamAcc = 0;
      if (this.captor) this.captor.__captor = true;
    }
    if (!this.captor || this.captured) return; // no captor, or a ship is already held.

    this.beamAcc += dtMs;
    if (this.beamAcc < this.captorBeamMs) return;
    this.beamAcc -= this.captorBeamMs;

    // Fire the beam straight DOWN the captor's column: a player in the x-band BELOW it is caught.
    const player = scene?.player;
    if (!player || player.isDead || player.active === false) return;
    const dx = Math.abs((player.x ?? 0) - (this.captor.x ?? 0));
    const below = (player.y ?? 0) > (this.captor.y ?? 0);
    if (dx <= this.beamBandPx && below) {
      this.captured = true;
      this.rescuedThisCapture = false;
      scene.shipCaptured = true;
      scene.registry?.set?.('shipCaptured', true);
      // Freeze the captured ship's mover (it can't act while held).
      player.movement?.stop?.();
      player.movement?.setInput?.(0);
      // The PUSH seam: the captor beam captured the player ship.
      this.bus?.emit('ship.captured', {
        captorId: this.captor.__id,
        x: player.x ?? 0,
        y: player.y ?? 0,
      });
    }
  }

  /** If a ship is captured and the captor dies, RESCUE it: regain a second ship. */
  private checkRescue(): void {
    const scene = this.scene;
    if (!this.captured || this.rescuedThisCapture) return;
    const captorGone = !this.captor || this.captor.isDead || this.captor.active === false;
    if (!captorGone) return;

    this.rescuedThisCapture = true;
    this.captured = false;
    scene.shipCaptured = false;
    scene.registry?.set?.('shipCaptured', false);

    const player = scene?.player;
    let health = 0;
    if (player) {
      // Regain a SECOND SHIP: a health bump (capped one above max — the twin-fighter reward).
      const cap = (player.maxHealth ?? 1) + 1;
      player.health = Math.min(cap, (player.health ?? 0) + this.rescueBonus);
      health = player.health;
      player.movement?.setInput?.(0); // control returns (the scheme drives it again next frame).
    }
    // The PUSH seam: the captor was destroyed → the player regains a second ship.
    this.bus?.emit('ship.rescued', { health });
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - enemy.entered ← advanceEntries (a member finishes its entry spline)   [archetype]
   *   - ship.captured ← tickCaptor (the captor beam reaches the player)        [archetype]
   *   - ship.rescued  ← checkRescue (the captor is destroyed while captured)   [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'enemy.entered',
          payload: '{id,x,y}',
          scope: 'archetype',
          drivenBy: 'an enemy finishing its entry spline (it reaches its rack slot)',
          expect:
            'the member stops flying, pins to its rack slot, becomes collidable, and joins the formation (FormationMarch then advances it); enemy.entered logged',
        },
        {
          name: 'ship.captured',
          payload: '{captorId,x,y}',
          scope: 'archetype',
          drivenBy: 'a captor beam reaching the player (the player sits under the captor column)',
          expect:
            "__GAME__ registry 'shipCaptured' becomes true; the player's mover input is frozen; ship.captured logged",
        },
        {
          name: 'ship.rescued',
          payload: '{health}',
          scope: 'archetype',
          drivenBy: 'the captor being destroyed while a ship is captured',
          expect:
            "the captured flag clears; __GAME__.player.health increases (a regained second ship); ship.rescued logged",
        },
      ],
    };
  }
}
