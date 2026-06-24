/**
 * MetricTile — one telemetry cell for the monitor variant: a mono label, a big
 * value, an optional delta (auto-colored by +/- sign), and an optional inline
 * sparkline. Drop several into <div className="ds-metric-grid">.
 */
import { Sparkline } from "./Sparkline";
import type { NodeMetric } from "./WorkflowNode";

export function MetricTile({ metric }: { metric: NodeMetric }) {
  const dir = metric.delta?.startsWith("+") ? "up" : metric.delta?.startsWith("-") ? "down" : "";
  return (
    <div className="ds-metric">
      <div className="ds-metric__k">{metric.label}</div>
      <div className="ds-metric__v">{metric.value}</div>
      {metric.delta && <div className={`ds-metric__d${dir ? ` ds-metric__d--${dir}` : ""}`}>{metric.delta}</div>}
      {metric.series && metric.series.length > 1 && (
        <span className="ds-metric__spark">
          <Sparkline data={metric.series} />
        </span>
      )}
    </div>
  );
}
