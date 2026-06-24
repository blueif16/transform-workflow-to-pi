/**
 * OrbField — the subtle dynamic background ("orbs").
 * 2–3 large, low-opacity blurred blooms drifting slowly behind the canvas.
 * Pure CSS (compositor transforms); freezes under prefers-reduced-motion.
 * pointer-events: none — never intercepts canvas interaction.
 *
 * Place once, as the first child of the workspace shell.
 */
import "../styles/glass.css";

export interface OrbFieldProps {
  /** Render the third (lilac) orb. Default true. Drop to 2 for lowest cost. */
  full?: boolean;
  className?: string;
}

export function OrbField({ full = true, className }: OrbFieldProps) {
  return (
    <div className={`ds-orb-field${className ? ` ${className}` : ""}`} aria-hidden="true">
      <div className="ds-orb ds-orb--a" />
      <div className="ds-orb ds-orb--b" />
      {full && <div className="ds-orb ds-orb--c" />}
    </div>
  );
}
