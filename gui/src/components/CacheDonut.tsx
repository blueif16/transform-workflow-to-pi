/**
 * CacheDonut — the ONE sanctioned donut, in the HUD `model` detail region.
 *
 * Exactly two categories (cache hit vs fresh/miss); the single key % is the cache-hit
 * rate, the top cost signal. hit-rate = cacheRead / (input + cacheRead). The hit arc is
 * `--ds-success`, the miss arc `--ds-neutral-400`. The center % recolors by research
 * thresholds (<0.3 error, <0.6 warning, else success). With no cache data it renders
 * nothing (no zero-donut). NEVER reuse this shape for >2 categories.
 */
export interface CacheDonutProps {
  cacheRead: number;
  input: number;
}

const R = 24; // radius of the donut stroke circle (viewBox 0 0 64 64)
const C = 2 * Math.PI * R; // circumference

export function CacheDonut({ cacheRead, input }: CacheDonutProps) {
  const denom = input + cacheRead;
  if (denom === 0) return null; // no cache data → render nothing

  const hit = cacheRead / denom;
  const pctLabel = `${Math.round(hit * 100)}%`;
  const pctColor =
    hit < 0.3 ? "var(--ds-error-fg)" : hit < 0.6 ? "var(--ds-warning-fg)" : "var(--ds-success-fg)";

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
          strokeDasharray={`${hit * C} ${C}`}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="ds-cachedonut__pct" style={{ color: pctColor }}>{pctLabel}</span>
      <span>cache</span>
    </div>
  );
}
