/**
 * NodeGateChips — the per-node Compose control: a DROP-TARGET that accepts a gate chip dragged from the
 * ChipPalette, plus the BADGE WIDEN that renders the node's gate pipeline + tier (not just the agentType
 * icon). Painted beneath each node in Compose mode, the SAME slot the NodeFusionToggle uses in Fusion mode.
 *
 * Drop flow (the vertical slice's spine):
 *   palette chip dragged → dropped here → ComposeContext.dropChip → POST /__piflow/node-edit → the gate
 *   joins this node's TEMPLATE `node.json` op[] lane → the config is refreshed upstream → this badge
 *   re-renders WITH the new gate. config is the single source of truth; the badge reflects the file.
 *
 * `stopPropagation` keeps a drop/click from also expanding the node's HUD (mirrors NodeFusionToggle).
 */
import { useState } from "react";
import { useCompose, CHIP_DND_MIME } from "./ComposeContext";
import { gatePipelineLabels, type GateChip } from "../data/runView";

export function NodeGateChips({ nodeId }: { nodeId: string }) {
  const { run, configs, dropChip } = useCompose();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const cfg = configs[nodeId];
  const pipeline = gatePipelineLabels(cfg);
  const tier = cfg?.tier;

  const onDrop = async (raw: string) => {
    let chip: GateChip;
    try { chip = JSON.parse(raw) as GateChip; } catch { setFlash({ tone: "err", text: "bad chip" }); return; }
    setBusy(true);
    const r = await dropChip(nodeId, chip);
    setBusy(false);
    if (r.ok) setFlash({ tone: "ok", text: `+${chip.kind}` });
    else setFlash({ tone: "err", text: r.stub ? "run-edit stubbed" : (r.error ?? "failed").slice(0, 28) });
    setTimeout(() => setFlash(null), 2200);
  };

  return (
    <div
      className={`ds-gatechips${over ? " is-over" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        if (!run) return;
        if (e.dataTransfer.types.includes(CHIP_DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!over) setOver(true); }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const raw = e.dataTransfer.getData(CHIP_DND_MIME);
        if (raw) void onDrop(raw);
      }}
      aria-label={`Drop a gate onto "${nodeId}". Gate pipeline: ${pipeline.length ? pipeline.join(" → ") : "none"}.`}
    >
      {/* BADGE WIDEN: the operating contract — tier + the ordered gate pipeline — surfaced on the node. */}
      <div className="ds-gatechips__pipeline">
        {tier && <span className="ds-gatechip ds-gatechip--tier" title={`tier: ${tier}`}>{tier}</span>}
        {pipeline.length === 0 ? (
          <span className="ds-gatechips__empty">{busy ? "…" : "drop a gate"}</span>
        ) : (
          pipeline.map((g, i) => (
            <span key={`${g}-${i}`} className="ds-gatechip ds-gatechip--gate" title={`gate ${i + 1}: ${g}`}>{g}</span>
          ))
        )}
      </div>
      {flash && <span className={`ds-gatechips__flash is-${flash.tone}`}>{flash.text}</span>}
    </div>
  );
}
