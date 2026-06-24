/**
 * Small HUD header bits shared across the overlay variants:
 *   - StatusPill: a status dot (pulsing while running) + label
 *   - Vital: a mono key/value pair for the vitals strip
 *   - HudCorners: the four targeting brackets on the window
 *   - HudSection: a mono section label with a trailing hairline rule
 * All presentational; styles live in styles/hud.css.
 */
import type { ReactNode } from "react";
import type { NodeStatus } from "./WorkflowNode";
import { STATUS_LABEL } from "./status";

export function StatusPill({ status, label }: { status: NodeStatus; label?: string }) {
  return (
    <span className="ds-pill" data-status={status}>
      <span className="ds-pill__dot" aria-hidden="true" />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export function Vital({ k, v }: { k: string; v: ReactNode }) {
  return (
    <span className="ds-vital">
      <span className="ds-vital__k">{k}</span>
      <span className="ds-vital__v">{v}</span>
    </span>
  );
}

/* Only two brackets, on the square corners (top-left + bottom-right). The other
   diagonal carries the panel's chamfer/round, where a right-angle bracket would
   sit too close and read as cut off. */
export function HudCorners() {
  return (
    <>
      <span className="ds-hud__corner ds-hud__corner--tl" aria-hidden="true" />
      <span className="ds-hud__corner ds-hud__corner--br" aria-hidden="true" />
    </>
  );
}

export function HudSection({ children }: { children: ReactNode }) {
  return (
    <div className="ds-hud__section">
      <span className="ds-hud__section-label">{children}</span>
    </div>
  );
}
