/**
 * ProgressBar — the "charge" indicator (battery-charging energy, kept elegant).
 * One component, two homes:
 *   - size="node"  → a slim 3px bar flush on a node's bottom edge (live status)
 *   - size="block" → a taller bar inside the expanded overlay's progress block
 *
 * Pass a `value` (0..1) for a determinate fill. Omit it while `status` is
 * "running" to get an indeterminate looping segment. The continuous motion is
 * a transform-only sheen (see .ds-progress in glass.css) so it stays cheap even
 * with many nodes charging at once, and it freezes under reduced motion.
 */
import type { CSSProperties } from "react";
import type { NodeStatus } from "./WorkflowNode";
import "../styles/glass.css";

export interface ProgressBarProps {
  /** 0..1 determinate fill. Omit while running for an indeterminate sweep. */
  value?: number;
  /** recolors the fill; "running" is the only state that shows the sheen */
  status?: NodeStatus;
  /** slim node-edge bar vs the taller overlay block */
  size?: "node" | "block";
  className?: string;
  "aria-label"?: string;
}

export function ProgressBar({
  value,
  status = "running",
  size = "node",
  className,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  const indeterminate = value == null && status === "running";
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value));

  const classes = [
    "ds-progress",
    size === "node" ? "ds-progress--node" : "ds-progress--block",
    indeterminate ? "ds-progress--indeterminate" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-status={status}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={indeterminate ? undefined : pct}
      // determinate fill width rides on a CSS var; indeterminate ignores it
      style={indeterminate ? undefined : ({ ["--ds-p" as string]: `${pct * 100}%` } as CSSProperties)}
    >
      <div className="ds-progress__fill">
        <span className="ds-progress__sheen" aria-hidden="true" />
      </div>
    </div>
  );
}
