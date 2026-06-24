import { WorkflowCanvas } from "../src/components/WorkflowCanvas";
import "../tokens/tokens.css";

/**
 * Demo shell — full-bleed canvas, no chrome.
 * Hover a node for the lift + HUD brackets; click (or Enter) to deploy its
 * multi-panel HUD (the node morphs into the identity panel, the rest fan in);
 * Esc / click-scrim to close. The floating directory navigator (top-left)
 * drills folders Miller-style; opening a file leaf opens that node's HUD.
 *
 * Deep-link / demo helper: /?open=<nodeId> opens that node's HUD on load.
 */
export function App() {
  const openId = new URLSearchParams(window.location.search).get("open") ?? undefined;
  return (
    <div style={{ height: "100%", background: "var(--ds-bg-canvas)" }}>
      <WorkflowCanvas initialExpandedId={openId} />
    </div>
  );
}
