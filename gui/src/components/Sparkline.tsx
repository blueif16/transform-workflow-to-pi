/**
 * Sparkline — a tiny dependency-free trend line (inline SVG, no chart lib).
 * Inherits its color from `currentColor`, stretches to its container width, and
 * keeps a uniform stroke under non-uniform scale (vector-effect). Used by the
 * monitor variant's metric tiles + activity strip.
 */
export interface SparklineProps {
  data: number[];
  /** intrinsic viewBox size; CSS controls the rendered size */
  width?: number;
  height?: number;
  area?: boolean;
  className?: string;
}

export function Sparkline({ data, width = 120, height = 28, area = true, className }: SparklineProps) {
  if (!data || data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((d, i): [number, number] => [i * stepX, height - ((d - min) / span) * height]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${line} L${width.toFixed(1)},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg
      className={`ds-spark${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {area && <path className="ds-spark__area" d={areaPath} />}
      <path className="ds-spark__line" d={line} vectorEffect="non-scaling-stroke" />
      <circle className="ds-spark__dot" cx={last[0]} cy={last[1]} r="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
