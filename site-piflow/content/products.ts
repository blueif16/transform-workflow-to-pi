/* ============================================================
   products.ts — THE single source of truth for the product
   screens (Agents · Workflow · Memory). One file, one shape, so
   the same entry powers BOTH the grid card face (title + keyword
   subtitle) AND the full-screen detail view you reach by clicking
   into a card (`details`). Update copy here only.

   Card face shows: `title` + `keywords` (the subtitle).
   Detail view shows: `summary` + `details.lead` + `details.points`.
   Presentation (HUD silhouette, grid layout) lives in the
   component, NOT here — this file stays purely informational.
   ============================================================ */

export type ProductCard = {
  /** stable id — card key + future detail route/anchor */
  id: string;
  /** card-face heading */
  title: string;
  /** the few keywords shown as the card subtitle */
  keywords: string[];
  /** one-line gist (detail-view subheading) */
  summary: string;
  /** full-screen detail content, reached by clicking the card */
  details: {
    lead: string;
    points: string[];
  };
};

export type ProductPanel = {
  /** breadcrumb + anchor key */
  key: "agents" | "workflow" | "memory";
  /** breadcrumb label */
  name: string;
  /** rail index label, e.g. "P1" */
  layer: string;
  cards: ProductCard[];
};

const AGENTS: ProductCard[] = [
  {
    id: "node",
    title: "Node",
    keywords: ["Full Pi agent", "Read / write scope", "Tools & skills", "MCP & OpenClaw"],
    summary: "A full Pi agent you scope and equip.",
    details: {
      lead: "Every node is a complete Pi agent — not a thin model call. You define exactly what it can see, touch, and do.",
      points: [
        "Freely define the read and write scope.",
        "Declare the tools and skills it can use.",
        "Install any MCP or OpenClaw plugin.",
        "Connect to any MCP server.",
      ],
    },
  },
  {
    id: "hooks",
    title: "Hooks",
    keywords: ["Pre / post checks", "Programmatic", "Gate + policy"],
    summary: "Programmatic checks around every node.",
    details: {
      lead: "Hooks let you run programmatic checks before and after a node — the seam where the gate and policy are applied.",
      points: [
        "Run a check before a node executes.",
        "Run a check after a node completes.",
        "Apply the gate + policy here.",
      ],
    },
  },
  {
    id: "sandbox",
    title: "Sandbox",
    keywords: ["Filesystem hand-off", "Per workflow / run / node", "Git-tracked", "Local · any OS · cloud"],
    summary: "Isolated execution with file-based hand-off.",
    details: {
      lead: "The filesystem carries every hand-off between nodes, and each node runs isolated in a sandbox you scope at exactly the level you need.",
      points: [
        "All file passing goes through the filesystem.",
        "Set a sandbox per workflow, per run, or per node.",
        "Git-tracked sandboxes.",
        "Create one locally, on any OS, or on a supported cloud provider.",
      ],
    },
  },
  {
    id: "telemetry",
    title: "Telemetry",
    keywords: ["Agent-native CLI", "Runtime debugging", "Tool calls & sync", "Docker-style streaming"],
    summary: "See and debug the agent's runtime, live.",
    details: {
      lead: "Agent-native CLI commands surface the pieces that matter most when debugging an agent's runtime — every tool call and every sync.",
      points: [
        "Agent-native CLI commands for inspecting a run.",
        "Trace each tool call and each syncing step.",
        "Docker-style streaming modes to debug in real time.",
        "Monitor agent performance as it runs.",
      ],
    },
  },
  {
    id: "composability",
    title: "Composability",
    keywords: ["Base agent types", "Skills + tools", "Lego-style", "Specialist per node"],
    summary: "Compose specialists from base types, skills, and tools.",
    details: {
      lead: "Start from base agent types and snap on skills and their associated tools like Lego — each node grows into the specialist its task needs.",
      points: [
        "Base agent types as the starting point.",
        "Skills and their associated tools.",
        "Piece them together like Lego.",
        "Each node wires up exactly the tools its task requires.",
      ],
    },
  },
  // The sixth slot is intentionally left out — Agents shows five.
];

// TODO: content pending — placeholders until you dictate Workflow + Memory.
const WORKFLOW: ProductCard[] = [
  { id: "wf-1", title: "Pending", keywords: ["content coming"], summary: "—", details: { lead: "", points: [] } },
  { id: "wf-2", title: "Pending", keywords: ["content coming"], summary: "—", details: { lead: "", points: [] } },
  { id: "wf-3", title: "Pending", keywords: ["content coming"], summary: "—", details: { lead: "", points: [] } },
];
const MEMORY: ProductCard[] = [
  { id: "mem-1", title: "Pending", keywords: ["content coming"], summary: "—", details: { lead: "", points: [] } },
  { id: "mem-2", title: "Pending", keywords: ["content coming"], summary: "—", details: { lead: "", points: [] } },
];

export const PRODUCTS: ProductPanel[] = [
  { key: "agents", name: "Agents", layer: "P1", cards: AGENTS },
  { key: "workflow", name: "Workflow", layer: "P2", cards: WORKFLOW },
  { key: "memory", name: "Memory", layer: "P3", cards: MEMORY },
];
