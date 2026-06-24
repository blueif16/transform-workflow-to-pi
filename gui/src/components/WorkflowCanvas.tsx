/**
 * WorkflowCanvas — the workspace shell that composes the whole system:
 *
 *   OrbField (background)  →  ReactFlow (light)  →  NodeExpandOverlay (portal)
 *   all wrapped in a single <LayoutGroup> so the node and the overlay share a
 *   layout context and the `layoutId` morph works across the portal boundary.
 *
 * Notes that matter:
 *   - `nodeTypes` is defined at module scope (React Flow re-render rule).
 *   - colorMode="light" — this system is light-first.
 *   - onNodeClick expands on a genuine click (React Flow filters out drags),
 *     which is the gesture we want; the in-node peek button covers keyboard.
 *   - Import order: tokens.css first, then the React Flow stylesheet, then our
 *     glass.css overrides last so our node/handle styles win.
 */
import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeMouseHandler,
} from "@xyflow/react";
import { LayoutGroup } from "motion/react";
import "@xyflow/react/dist/style.css";

import "../../tokens/tokens.css";
import "../styles/glass.css";
import "../styles/panels.css";

import { OrbField } from "./OrbField";
import { WorkflowNode, type FlowNode } from "./WorkflowNode";
import { NodeExpandOverlay } from "./NodeExpandOverlay";
import { DirectoryPanel, type DirEntry } from "./DirectoryPanel";
import { ExpandContext } from "./ExpandContext";

/* defined OUTSIDE the component — prevents node re-mounts on every render */
const nodeTypes = { flowNode: WorkflowNode };

/* sample data spans the HUD panels: agents carry metrics/activity/logs, files
   carry io + markdown/json content (so the clicked-up HUD shows the readers). */
const README_MD = `# Flowmap
A *quietly* game-flavored design system for a node canvas.

## Thesis
- **Geist** clean base
- **Liquid Glass** on one surface
- **Game UI** as a 5% garnish

See \`docs/\` for the rationale behind every choice.

> Functionality is the product; the game feeling is a garnish.`;

const TOKENS_JSON = `{
  "color": { "accent": "#0070f3", "ink": "#171717" },
  "radius": { "node": 8, "glass": 16 },
  "motion": { "expand": { "stiffness": 380, "damping": 32 } },
  "flags": { "reducedMotion": false }
}`;

const initialNodes: FlowNode[] = [
  {
    id: "agent-1",
    type: "flowNode",
    position: { x: 40, y: 120 },
    data: {
      title: "Planner",
      kind: "agent",
      typeLabel: "agent",
      status: "success",
      preview: "decomposed 4 subtasks",
      progress: 1,
      meta: [
        { label: "Model", value: "opus-4.8", mono: true },
        { label: "Subtasks", value: "4 / 4", tone: "success" },
      ],
      logs: [
        { text: "› decompose objective", level: "ok" },
        { text: "✓ 4 subtasks identified", level: "ok" },
        { text: "✓ dependencies resolved", level: "ok" },
        { text: "→ dispatched to Researcher", level: "ok" },
      ],
      content: "role: planner\nmodel: opus-4.8\nsubtasks:\n  - research sources\n  - draft tokens\n  - build components\n  - write docs",
    },
  },
  {
    id: "agent-2",
    type: "flowNode",
    position: { x: 320, y: 60 },
    data: {
      title: "Researcher",
      kind: "agent",
      typeLabel: "agent",
      status: "running",
      preview: "scanning 6 sources…",
      progress: 0.62,
      eta: "~0:18",
      meta: [
        { label: "Model", value: "opus-4.8", mono: true },
        { label: "Sources", value: "6", tone: "accent" },
      ],
      metrics: [
        { label: "Tokens/s", value: "128", delta: "+12%", series: [60, 80, 75, 110, 98, 128, 120, 128] },
        { label: "Context", value: "18.4k", delta: "+2.1k", series: [2, 5, 7, 9, 12, 15, 17, 18] },
        { label: "Cost", value: "$0.21", delta: "+$0.04", series: [2, 5, 8, 10, 13, 16, 19, 21] },
        { label: "Tool calls", value: "14", delta: "+3", series: [1, 2, 4, 6, 8, 9, 12, 14] },
      ],
      activity: [3, 6, 4, 8, 7, 10, 6, 9, 12, 8, 11, 14, 9, 13, 10, 15],
      content: "role: researcher\nstatus: running\nopen_tabs: 6\nfindings: streaming…",
    },
  },
  {
    id: "file-1",
    type: "flowNode",
    position: { x: 320, y: 200 },
    data: {
      title: "tokens.css",
      kind: "file",
      typeLabel: "css",
      status: "idle",
      preview: "tokens/tokens.css",
      io: { inputs: ["design-tokens.json"], outputs: ["all components"] },
      meta: [
        { label: "Path", value: "tokens/tokens.css", mono: true },
        { label: "Size", value: "6.2 KB", mono: true },
        { label: "Lines", value: "199", mono: true },
      ],
      content: ":root {\n  --ds-bg-canvas: #ffffff;\n  --ds-text-primary: #171717;\n  --ds-accent: #0070f3;\n}",
    },
  },
  {
    id: "file-2",
    type: "flowNode",
    position: { x: 600, y: 130 },
    data: {
      title: "WorkflowNode.tsx",
      kind: "file",
      typeLabel: "tsx",
      status: "idle",
      preview: "src/components/WorkflowNode.tsx",
      io: { inputs: ["ExpandContext", "ProgressBar"], outputs: ["nodeTypes.flowNode"] },
      meta: [
        { label: "Path", value: "src/components/WorkflowNode.tsx", mono: true },
        { label: "Size", value: "3.4 KB", mono: true },
        { label: "Lines", value: "118", mono: true },
      ],
      content: "export function WorkflowNode({ id, data }) {\n  // flat card, shared layoutId, hover lift\n}",
    },
  },
  {
    id: "file-readme",
    type: "flowNode",
    position: { x: 40, y: 300 },
    data: {
      title: "README.md",
      kind: "file",
      typeLabel: "md",
      status: "idle",
      preview: "README.md",
      contentType: "markdown",
      io: { outputs: ["docs"] },
      meta: [
        { label: "Path", value: "README.md", mono: true },
        { label: "Size", value: "4.3 KB", mono: true },
      ],
      content: README_MD,
    },
  },
  {
    id: "file-tokens-json",
    type: "flowNode",
    position: { x: 600, y: 300 },
    data: {
      title: "design-tokens.json",
      kind: "file",
      typeLabel: "json",
      status: "idle",
      preview: "tokens/design-tokens.json",
      contentType: "json",
      io: { inputs: ["figma/export"], outputs: ["tokens.css"] },
      meta: [
        { label: "Path", value: "tokens/design-tokens.json", mono: true },
        { label: "Tokens", value: "142", mono: true },
      ],
      content: TOKENS_JSON,
    },
  },
];

const initialEdges = [
  { id: "e1", source: "agent-1", target: "agent-2", className: "ds-edge-active" },
  { id: "e2", source: "agent-1", target: "file-1" },
  { id: "e3", source: "agent-2", target: "file-2", className: "ds-edge-active" },
  { id: "e4", source: "file-tokens-json", target: "file-1" },
];

/* sample folder tree for the floating directory navigator (Miller columns).
   File leaves whose name matches a node title open that node's overlay. */
const directoryTree: DirEntry[] = [
  {
    id: "d-src",
    name: "src",
    kind: "folder",
    children: [
      {
        id: "d-components",
        name: "components",
        kind: "folder",
        children: [
          { id: "f-node", name: "WorkflowNode.tsx", kind: "file", typeLabel: "tsx" },
          { id: "f-overlay", name: "NodeExpandOverlay.tsx", kind: "file", typeLabel: "tsx" },
          { id: "f-dir", name: "DirectoryPanel.tsx", kind: "file", typeLabel: "tsx" },
          { id: "f-progress", name: "ProgressBar.tsx", kind: "file", typeLabel: "tsx" },
        ],
      },
      {
        id: "d-styles",
        name: "styles",
        kind: "folder",
        children: [
          { id: "f-glass", name: "glass.css", kind: "file", typeLabel: "css" },
          { id: "f-panels", name: "panels.css", kind: "file", typeLabel: "css" },
        ],
      },
      {
        id: "d-motion",
        name: "motion",
        kind: "folder",
        children: [{ id: "f-trans", name: "transitions.ts", kind: "file", typeLabel: "ts" }],
      },
    ],
  },
  {
    id: "d-tokens",
    name: "tokens",
    kind: "folder",
    children: [
      { id: "f-tokenscss", name: "tokens.css", kind: "file", typeLabel: "css" },
      { id: "f-tokensjson", name: "design-tokens.json", kind: "file", typeLabel: "json" },
    ],
  },
  { id: "f-readme", name: "README.md", kind: "file", typeLabel: "md" },
];

function CanvasInner({ initialExpandedId }: { initialExpandedId?: string }) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge(c, eds)), [setEdges]);
  const onNodeClick: NodeMouseHandler = useCallback((_, node) => setExpandedId(node.id), []);

  const expandApi = useMemo(
    () => ({ expandedId, expand: setExpandedId, collapse: () => setExpandedId(null) }),
    [expandedId],
  );

  const expandedData = nodes.find((n) => n.id === expandedId)?.data ?? null;

  return (
    <ExpandContext.Provider value={expandApi}>
      <LayoutGroup>
        <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--ds-bg-canvas)" }}>
          <OrbField />
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            colorMode="light"
            fitView
            onlyRenderVisibleElements
            minZoom={0.3}
            proOptions={{ hideAttribution: false }}
            style={{ background: "transparent" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--ds-neutral-300)" />
            <Controls showInteractive={false} />
            <Panel position="top-left">
              <DirectoryPanel
                tree={directoryTree}
                title="Workspace"
                onOpenFile={(entry) => {
                  // a file leaf that matches a node title opens that node's window
                  const match = nodes.find((n) => n.data.title === entry.name);
                  if (match) setExpandedId(match.id);
                }}
              />
            </Panel>
          </ReactFlow>

          <NodeExpandOverlay id={expandedId} data={expandedData} onClose={() => setExpandedId(null)} />
        </div>
      </LayoutGroup>
    </ExpandContext.Provider>
  );
}

export function WorkflowCanvas({ initialExpandedId }: { initialExpandedId?: string } = {}) {
  return (
    <ReactFlowProvider>
      <CanvasInner initialExpandedId={initialExpandedId} />
    </ReactFlowProvider>
  );
}
