/**
 * CacheDonut — the ONE sanctioned donut, in the HUD `model` detail region.
 *
 * Exactly two categories (cache hit vs fresh/miss); the single key % is the cache-hit
 * rate, the top cost signal. The hit ratio + its attention tone are computed ONCE in the
 * observe surface (core `deriveNode` → `node.derived.cacheHit`); this component only
 * RENDERS them. The hit arc is `--ds-success`, the miss arc `--ds-neutral-400`. The
 * center % recolors by the tone (high→error, warn→warning, ok→success). The caller
 * renders nothing when there is no cache data (`derived.cacheHit` is null).
 * NEVER reuse this shape for >2 categories.
 */
import type { Tone } from "../data/runView";

export interface CacheDonutProps {
  /** the pre-derived cache-hit zone: ratio 0–1 + attention tone. */
  hit: { ratio: number; tone: Tone };
}

const R = 24; // radius of the donut stroke circle (viewBox 0 0 64 64)
const C = 2 * Math.PI * R; // circumference

const TONE_COLOR: Record<Tone, string> = {
  high: "var(--ds-error-fg)",
  warn: "var(--ds-warning-fg)",
  ok: "var(--ds-success-fg)",
};

export function CacheDonut({ hit }: CacheDonutProps) {
  const { ratio, tone } = hit;
  const pctLabel = `${Math.round(ratio * 100)}%`;

  return (
    <div className="ds-cachedonut">
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Cache hit rate ${pctLabel}`}>
        {/* miss / fresh track (full ring) */}
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="var(--ds-neutral-400)"
          strokeWidth="8"
        />
        {/* hit arc, drawn from the top (rotate -90°) clockwise */}
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="var(--ds-success)"
          strokeWidth="8"
          strokeDasharray={`${ratio * C} ${C}`}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="ds-cachedonut__pct" style={{ color: TONE_COLOR[tone] }}>{pctLabel}</span>
      <span>cache</span>
    </div>
  );
}
