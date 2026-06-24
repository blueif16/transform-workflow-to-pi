/**
 * FieldBlock — one rectangular config cell for the expanded overlay.
 * Label (mono, uppercase) over a value; an optional `tone` paints the 3px left
 * status edge (the node's left-bar grammar) so the blocks read as the same kit
 * as the nodes. Drop several into a <div className="ds-field-grid"> and they
 * tile cleanly beside the "middle card" content.
 */
import type { ReactNode } from "react";
import "../styles/panels.css";

export type FieldTone = "default" | "accent" | "success" | "warning" | "error";

export interface FieldBlockProps {
  label: string;
  /** the cell value; omit when supplying custom `children` (e.g. a progress bar) */
  value?: ReactNode;
  /** status edge + value color */
  tone?: FieldTone;
  /** render the value in mono (paths, ids, code-ish data) */
  mono?: boolean;
  /** span the whole grid row (used for the progress block) */
  full?: boolean;
  className?: string;
  children?: ReactNode;
}

export function FieldBlock({ label, value, tone = "default", mono = false, full = false, className, children }: FieldBlockProps) {
  const classes = [
    "ds-field",
    tone !== "default" ? `ds-field--${tone}` : "",
    full ? "ds-field--full" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="ds-field__label">{label}</div>
      {children ?? <div className={`ds-field__value${mono ? " ds-field__value--mono" : ""}`}>{value}</div>}
    </div>
  );
}
