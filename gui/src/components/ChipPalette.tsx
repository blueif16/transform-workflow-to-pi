/**
 * ChipPalette — the drag-to-compose source panel (Compose mode only). A row of draggable GATE chips the
 * user drags onto a node to attach a gate to its pipeline. Mirrors the FusionSaveBar affordance pattern
 * (portal'd glass bar, mode-gated) but is a SOURCE: each chip sets the drag payload (CHIP_DND_MIME) that
 * the per-node drop-target (NodeGateChips) reads and POSTs to the write-back endpoint.
 *
 * SCOPE: the 3 GATE chips (execution / judge / human — build-spec §"op[] mapping") are wired end-to-end.
 * SKILL / LOADOUT chips are STUBBED palette entries (greyed, not draggable) — the loadout write is a
 * follow-up (build-spec defers it to the same surface). The chips carry MINIMAL defaults; a real editor
 * would open a policy form (retry budget, judge rubric) — that detail is out of this vertical slice.
 */
import { createPortal } from "react-dom";
import { GlassSurface } from "./GlassSurface";
import { CHIP_DND_MIME } from "./ComposeContext";
import type { GateChip } from "../data/runView";
import "../styles/modes.css";

/** A draggable gate chip: its label + the minimal default payload it drops. */
interface PaletteEntry {
  label: string;
  title: string;
  chip: GateChip;
}

// The 3 GATE chips, with sane defaults so a bare drop produces a valid op[] entry. A future inline form
// would let the user tune cmd / judgeTier / question before the drop.
const GATE_CHIPS: PaletteEntry[] = [
  { label: "execution", title: "Run a test/build command; exit code is the verdict", chip: { kind: "execution", cmd: "npm test", onFailure: "block" } },
  { label: "judge", title: "A different model scores the output vs a rubric; reroute on fail", chip: { kind: "judge", judgeTier: "deep", threshold: "pass", retryMax: 1 } },
  { label: "human", title: "A person approves/rejects before the output propagates (G5 checkpoint)", chip: { kind: "human", checkpointKind: "confirm", question: "Approve this node's output?" } },
];

// STUBBED chips — the loadout lane (skills) is a follow-up; shown greyed so the surface is legible.
const STUB_CHIPS = ["skill", "loadout"];

export function ChipPalette({ active }: { active: boolean }) {
  if (!active) return null;
  return createPortal(
    <div className="ds-chippalette-layer">
      <GlassSurface variant="soft" className="ds-chippalette" legibleText aria-label="Gate chip palette — drag onto a node">
        <span className="ds-chippalette__title">Gates</span>
        {GATE_CHIPS.map((e) => (
          <button
            key={e.label}
            type="button"
            className="ds-chip ds-chip--gate"
            draggable
            title={e.title}
            aria-label={`Drag the ${e.label} gate onto a node`}
            onDragStart={(ev) => {
              ev.dataTransfer.setData(CHIP_DND_MIME, JSON.stringify(e.chip));
              ev.dataTransfer.effectAllowed = "copy";
            }}
          >
            {e.label}
          </button>
        ))}
        <span className="ds-chippalette__sep" aria-hidden="true" />
        <span className="ds-chippalette__title">Loadout</span>
        {STUB_CHIPS.map((s) => (
          <span key={s} className="ds-chip ds-chip--stub" title="Loadout chips (skills) — coming soon" aria-disabled="true">
            {s}
          </span>
        ))}
      </GlassSurface>
    </div>,
    document.body,
  );
}
