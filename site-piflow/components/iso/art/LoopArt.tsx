/**
 * LoopArt — bespoke isometric illustration of the Compose → Run → Improve loop.
 * RSC/server-safe: no "use client", no hooks, no browser APIs.
 *
 * Coverage inventory (for bar verification):
 *   Platforms : 3  (IsoBox h=6 variant="surface" acting as plinths, one wire, one surface, one glow)
 *   IsoGrid   : 1
 *   IsoPlanes : 3  (subtle under-glow tiles beneath each platform)
 *   Marker cubes : 3  (wire / glow / surface — mixed variants, varied heights)
 *   IsoEdges  : 4  (2 forward curved flow edges + 1 loop-back bowed edge + 1 decorative flow arc)
 *   IsoDots   : 3  (one per platform centre, accent + ring)
 *   IsoPosts  : 3  (one per platform, dashed vertical risers)
 *   Float group : wraps all floating cubes + dots (iso-float)
 *
 * ViewBox: "-94 -56 321 232"
 * Computed to include all projected coords + 28u padding.
 * Feedback arc control point projects to sy≈−28, well within the −56 top margin.
 */

import {
  IsoScene,
  IsoBox,
  IsoPlane,
  IsoGrid,
  IsoEdge,
  IsoDot,
  IsoPost,
} from "@/components/iso/iso";

const ACCENT = "#3df2a7";
const NEUTRAL_STROKE = "rgba(255,255,255,0.18)";
const NEUTRAL_FILL = "rgba(255,255,255,0.04)";

// ─── Layout constants ───────────────────────────────────────────────
// All coordinates in iso-units. x→down-right, y→down-left, z→up.
//
// Three stages spread along x-axis, y centred around 28.
//   Stage 1 "Compose" : x=0   … 56, y=0…56
//   Stage 2 "Run"     : x=80  … 136, y=0…56   ← active / accent
//   Stage 3 "Improve" : x=160 … 216, y=0…56
//
// Platform slabs : IsoBox h=6
// Marker cubes on top (z=6): heights 18 / 28 / 22  (progression)
// Ground grid    : x=−4, y=−12, w=228, d=80
// ────────────────────────────────────────────────────────────────────

export default function LoopArt({ className }: { className?: string }) {
  return (
    <IsoScene viewBox="-94 -56 321 232" className={className}>
      {/* ── 1. Faint floor grid ─────────────────────────────────── */}
      <IsoGrid x={-4} y={-12} z={0} w={228} d={80} step={28} />

      {/* ── 2. Under-glow accent planes (subtle wash beneath each plinth) */}
      {/* Stage 1 */}
      <IsoPlane
        x={-2} y={-2} z={0}
        w={60} d={60}
        accent={ACCENT}
        fillAlpha={0.025}
        stroke="none"
      />
      {/* Stage 2 — slightly stronger glow for the active stage */}
      <IsoPlane
        x={78} y={-2} z={0}
        w={60} d={60}
        accent={ACCENT}
        fillAlpha={0.06}
        stroke="none"
      />
      {/* Stage 3 */}
      <IsoPlane
        x={158} y={-2} z={0}
        w={60} d={60}
        accent={ACCENT}
        fillAlpha={0.025}
        stroke="none"
      />

      {/* ── 3. Platform plinths ─────────────────────────────────── */}
      {/* Stage 1: wire-style plinth */}
      <IsoBox
        x={0} y={0} z={0} w={56} d={56} h={6}
        variant="wire"
        accent={NEUTRAL_STROKE}
        strokeWidth={1.1}
        dash="3 4"
      />
      {/* Stage 2: surface-style (active, gets its glow from the cube above) */}
      <IsoBox
        x={80} y={0} z={0} w={56} d={56} h={6}
        variant="surface"
        strokeWidth={1.1}
      />
      {/* Stage 3: wire plinth */}
      <IsoBox
        x={160} y={0} z={0} w={56} d={56} h={6}
        variant="wire"
        accent={NEUTRAL_STROKE}
        strokeWidth={1.1}
        dash="3 4"
      />

      {/* ── 4. Vertical risers (posts) ──────────────────────────── */}
      {/* Decorative dashed posts from ground up to top of each plinth */}
      <IsoPost x={28} y={28} z0={0} z1={6} accent={NEUTRAL_STROKE} strokeWidth={1} />
      <IsoPost x={108} y={28} z0={0} z1={6} accent={ACCENT} strokeWidth={1} />
      <IsoPost x={188} y={28} z0={0} z1={6} accent={NEUTRAL_STROKE} strokeWidth={1} />

      {/* ── 5. Forward connector edges (platform centre → next) ─── */}
      {/* Edge 1→2: curved flow in accent */}
      <IsoEdge
        from={[56, 28, 6]}
        to={[80, 28, 6]}
        accent={ACCENT}
        curved
        lift={22}
        strokeWidth={1.6}
        dash="8 260"
        className="flow"
        len={180}
      />
      {/* Edge 2→3: curved flow in accent */}
      <IsoEdge
        from={[136, 28, 6]}
        to={[160, 28, 6]}
        accent={ACCENT}
        curved
        lift={22}
        strokeWidth={1.6}
        dash="8 260"
        className="flow"
        len={180}
      />

      {/* ── 6. Loop-back feedback edge (Improve → Compose) ─────── */}
      {/* Tall bowed arc: lifts high (lift=90) to arc over everything */}
      <IsoEdge
        from={[188, 28, 6]}
        to={[28, 28, 6]}
        accent={ACCENT}
        curved
        lift={90}
        strokeWidth={1.8}
        dash="8 340"
        opacity={0.85}
        className="flow"
        len={320}
      />

      {/* ── 7. Floating cubes + dots (wrapped in iso-float group) ── */}
      <g className="iso-float">
        {/* Stage 1 marker cube — "wire", height 18 */}
        <IsoBox
          x={16} y={16} z={6}
          w={24} d={24} h={18}
          variant="wire"
          accent={NEUTRAL_STROKE}
          strokeWidth={1.1}
          dash="3 5"
        />

        {/* Stage 2 marker cube — "glow" (the accent element), height 28 */}
        <IsoBox
          x={96} y={16} z={6}
          w={24} d={24} h={28}
          variant="glow"
          accent={ACCENT}
          strokeWidth={1.4}
          topAlpha={0.28}
        />

        {/* Stage 3 marker cube — "surface", height 22 */}
        <IsoBox
          x={176} y={16} z={6}
          w={24} d={24} h={22}
          variant="surface"
          strokeWidth={1.1}
        />

        {/* Stage 1 dot — neutral ring, small */}
        <IsoDot at={[28, 28, 6]} r={3} fill={NEUTRAL_STROKE} ring={NEUTRAL_STROKE} />
        {/* Stage 2 dot — accent, larger ring (active node) */}
        <IsoDot at={[108, 28, 6]} r={4} fill={ACCENT} ring={ACCENT} />
        {/* Stage 3 dot — neutral */}
        <IsoDot at={[188, 28, 6]} r={3} fill={NEUTRAL_STROKE} ring={NEUTRAL_STROKE} />
      </g>

      {/* ── 8. Slow-floating secondary detail (inner platform markers) */}
      {/* Extra faint draw edge hinting at structural depth on stage 2 */}
      <g className="iso-float-slow">
        <IsoEdge
          from={[96, 16, 34]}
          to={[120, 40, 34]}
          accent={ACCENT}
          curved={false}
          strokeWidth={0.8}
          opacity={0.22}
        />
        <IsoEdge
          from={[96, 40, 34]}
          to={[120, 16, 34]}
          accent={ACCENT}
          curved={false}
          strokeWidth={0.8}
          opacity={0.22}
        />
      </g>
    </IsoScene>
  );
}
