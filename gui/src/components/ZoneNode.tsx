/**
 * ZoneNode — the `type:'zone'` custom React Flow node: a non-interactive BACKDROP frame drawn BEHIND a
 * cluster of related cards (the "frame channel"). ONE reusable primitive (ZoneFrame); the fusion vs
 * template variants differ ONLY by hue/stroke (zones.css), never geometry.
 *
 * It renders no handles and takes no input: aria-hidden + tabIndex={-1} + pointer-events:none (in CSS)
 * keep every click/keystroke falling THROUGH to the card above it, so clicking a node inside still opens
 * its HUD and the zone never takes selection or keyboard focus. Z-order (it paints under the cards) is set
 * on the node itself (`zIndex` in toZoneFlowNode), not here.
 *
 * Anatomy (angular sci-fi on the light brand): a clip-path body with a corner notch, four L-bracket corner
 * ticks, and a small mono UPPERCASE label tab. `nodeTypes` MUST stay at module scope (see WorkflowCanvas).
 */
import { type NodeProps, type Node } from "@xyflow/react";
import type { ZoneData } from "../data/zones";
import "../styles/zones.css";

type ZoneFlowNode = Node<ZoneData, "zone">;

export function ZoneNode({ data }: NodeProps<ZoneFlowNode>) {
  return (
    <div
      className={`ds-zone ds-zone--${data.kind}`}
      style={{ width: data.width, height: data.height }}
      aria-hidden="true"
      tabIndex={-1}
    >
      {/* four L-bracket corner ticks — the HUD targeting cue, sized in CSS */}
      <span className="ds-zone__tick ds-zone__tick--tl" />
      <span className="ds-zone__tick ds-zone__tick--tr" />
      <span className="ds-zone__tick ds-zone__tick--bl" />
      <span className="ds-zone__tick ds-zone__tick--br" />
      {data.label && <span className="ds-zone__tab">{data.label}</span>}
    </div>
  );
}
