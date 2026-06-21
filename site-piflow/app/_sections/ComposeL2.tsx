"use client";

import { ReactFlow, Background, BackgroundVariant } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const nodeBase = {
  background: "var(--surface-2)",
  color: "var(--fg)",
  border: "1px solid var(--hairline)",
  borderRadius: 10,
  fontSize: 12,
  padding: "8px 12px",
  width: 150,
  textAlign: "center" as const,
};

const nodeRunning = {
  ...nodeBase,
  border: "1px solid var(--accent-30)",
  boxShadow: "0 0 32px -10px var(--accent-glow)",
};

// One goal fans out into parallel work, then converges into one finish.
const nodes: Node[] = [
  { id: "goal", position: { x: 0, y: 130 }, data: { label: "understand the goal" }, style: nodeBase },
  { id: "gather", position: { x: 240, y: 20 }, data: { label: "gather sources" }, style: nodeBase },
  { id: "draft", position: { x: 240, y: 130 }, data: { label: "draft" }, style: nodeRunning },
  { id: "check", position: { x: 240, y: 240 }, data: { label: "fact-check" }, style: nodeBase },
  { id: "publish", position: { x: 480, y: 130 }, data: { label: "publish" }, style: nodeBase },
];

const edgeBase = {
  type: "smoothstep" as const,
  animated: true,
  style: { stroke: "var(--hairline-2)" },
};

const edges: Edge[] = [
  { id: "g-gather", source: "goal", target: "gather", ...edgeBase },
  { id: "g-draft", source: "goal", target: "draft", ...edgeBase },
  { id: "g-check", source: "goal", target: "check", ...edgeBase },
  { id: "gather-pub", source: "gather", target: "publish", ...edgeBase },
  { id: "draft-pub", source: "draft", target: "publish", ...edgeBase },
  { id: "check-pub", source: "check", target: "publish", ...edgeBase },
];

const BULLETS = [
  "Decomposes the goal",
  "Discovers the right tools",
  "Edges inferred, not drawn",
  "Parallel by default",
];

export default function ComposeL2() {
  return (
    <section id="compose" className="mx-auto w-full max-w-6xl px-6 py-28">
      <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-[1fr_1.1fr]">
        {/* Copy */}
        <div className="reveal">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
            L2 · Compose
          </p>
          <h2 className="mt-4 max-w-md text-balance text-4xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">
            Hand it a goal. It designs the graph.
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-fg-muted">
            An agent breaks your goal into the work that gets it done, finds the right tools for each
            piece, and wires them into a flow. Independent steps run side by side; the dependencies
            between them become the edges.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {BULLETS.map((b) => (
              <li key={b} className="flex items-center gap-2.5 text-sm text-fg">
                <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* Illustration — a designed DAG: one goal fans out, then converges */}
        <div className="reveal rounded-2xl border border-[var(--hairline)] bg-surface-1">
          <div className="h-[400px] w-full">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              fitViewOptions={{ padding: 0.22 }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              panOnScroll={false}
              preventScrolling={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={28} color="rgba(255,255,255,0.06)" />
            </ReactFlow>
          </div>
        </div>
      </div>
    </section>
  );
}
