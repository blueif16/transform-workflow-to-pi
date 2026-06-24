# Component architecture

Atomic design, mapped to a workflow canvas. We keep the hierarchy shallow — the
product is a graph, not a form library, so most value is in the **organisms**.

```
Atoms        Button · ProgressBar · Sparkline · StatusPill · StatusBar · TypeLabel · KindIcon · Handle · Spinner
Molecules    NodeHeader · NodeBody · OverlayHeader · FieldBlock · MetricTile · Vital · HudCorners · HudSection
Organisms    WorkflowNode · NodeExpandOverlay · HudWindow (+ Monitor/Stream/Inspector bodies)
             DirectoryPanel · MarkdownReader · JsonReader · ContentView · OrbField · GlassSurface
Templates    WorkflowCanvas (workspace shell) · OverlayLab (variant gallery)
```

## Atoms

### `Button`
Geist action atom. Polymorphic (`as`).

| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `primary \| secondary \| ghost \| accent` | `secondary` | `primary`=ink fill, `accent`=blue (one per surface), `secondary`=white+shadow-ring |
| `size` | `sm \| md \| lg` | `md` | 28 / 32 / 40px tall |
| `loading` | `boolean` | `false` | keeps focus, sets `aria-busy` |
| `icon` | `ReactNode` | — | leading glyph |
| `iconOnly` | `boolean` | `false` | **requires `aria-label`** |
| `as` | `ElementType` | `button` | render as `a`, etc. |

### `ProgressBar`
The in-node "charge" bar (and the overlay's progress block). One component, two
sizes.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `number` (0..1) | — | determinate fill; **omit while running** for an indeterminate sweep |
| `status` | `NodeStatus` | `running` | recolors the fill; only `running` shows the sheen |
| `size` | `node \| block` | `node` | slim 3px node-edge bar vs taller overlay block |
| `aria-label` | `string` | — | progressbar label |

Renders `role="progressbar"`. Continuous motion is transform-only and freezes
under reduced motion. Full rationale in `FOUNDATIONS.md → Progress`.

### Status bar, type label, kind icon
Not separate components — they're the cheap primitives composed *inside*
`WorkflowNode` (3px `::before` bar, mono uppercase label, inline SVG glyph). Kept
inline deliberately so a node is one render, not five.

## Molecules

### `FieldBlock`
One rectangular config cell for the expanded overlay. Label (mono, uppercase)
over a value; a `tone` paints the 3px left status edge (the node's left-bar
grammar) so the blocks read as the same kit. Drop several into
`<div className="ds-field-grid">` and they tile (auto-fill, `minmax(132px,1fr)`).

| Prop | Type | Default | Notes |
|---|---|---|---|
| `label` | `string` | — | mono uppercase eyebrow |
| `value` | `ReactNode` | — | omit when supplying custom `children` |
| `tone` | `default \| accent \| success \| warning \| error` | `default` | status edge + value color |
| `mono` | `boolean` | `false` | render value in mono (paths/ids) |
| `full` | `boolean` | `false` | span the whole grid row (the progress block uses this) |

### `Handle` (styling only)
React Flow's `Handle` + our `.ds-handle` class: 9px, hairline, accent-on-hover.

## Organisms

### `WorkflowNode` (React Flow custom node)
The flat card. **Origin** of the shared-element morph (`layoutId="node-${id}"`).

`data: FlowNodeData`:

| Field | Type | Purpose |
|---|---|---|
| `title` | `string` | node name |
| `kind` | `agent \| file` | drives icon + accent color |
| `typeLabel` | `string` | mono uppercase tag (`agent`, `tsx`, `css`…) |
| `status` | `idle \| selected \| running \| success \| error` | status bar + ring |
| `preview` | `string` | one-line body (path/summary) |
| `content` | `string` | full text shown in the overlay |
| `progress` | `number` (0..1) | optional; renders the in-node charge bar (indeterminate while running if omitted) |
| `meta` | `NodeMetaField[]` | optional; rectangular config blocks shown in the overlay (`{label, value, tone?, mono?}`) |

The card renders its `ProgressBar` flush on the bottom edge whenever `progress`
is set **or** `status === "running"`.

Register it **outside** the canvas: `const nodeTypes = { flowNode: WorkflowNode }`.

### `NodeExpandOverlay` (portaled shell)
**Destination** of the morph, but only the *shell* now: portal at `<body>`, the
heavier `.ds-scrim`, focus trap + restore, Esc / scrim-click close, reduced
motion, and the `layoutId` morph. It reads the node's `data.view` and renders a
`HudWindow` in that variant. Render once at the canvas level.

### The clicked-up window — `HudWindow` + three HUD variants
The expanded node is a **HUD to monitor**, not one card carrying everything.
`HudWindow` is the shared frame (GlassSurface + corner brackets + header with
eyebrow · title · variant badge · close); it switches on `variant` to one of
three **curated body layouts**, each with a distinct job:

| Variant | Job | Layout |
|---|---|---|
| **monitor** | live telemetry | vitals strip · hero charge bar · `MetricTile` grid (with sparklines) · activity pulse |
| **stream** | live output | minimal vitals · slim charge · large console (severity dots + blinking cursor) · actions |
| **inspector** | structure | two columns (Config `FieldBlock` grid · I/O signals) · framed Definition via `ContentView` |

A node picks its layout with `data.view` (default `monitor`). `HudWindow` is
presentational and reused outside the portal by `OverlayLab` (`?lab=overlays`),
which renders all three side by side for comparison. Monitor data comes from
`data.metrics`/`activity`/`eta`; stream from `data.logs`; inspector from
`data.meta`/`io`/`content`. Primitives: `Sparkline` (dependency-free trend
line), `MetricTile`, and the HUD bits (`StatusPill`, `Vital`, `HudCorners`,
`HudSection`).

### Readers — `MarkdownReader`, `JsonReader`, `ContentView`
Themed, **dependency-free** content renderers (no `marked`, no
`dangerouslySetInnerHTML` — every token is a real React node, XSS-safe).
`MarkdownReader` covers headings, bold/italic, inline + fenced code, links,
lists, blockquotes, rules. `JsonReader` is a collapsible, type-colored tree that
degrades to a readable error on invalid JSON. `ContentView` picks the right one
from `data.contentType` (else inferred from `typeLabel`: `md`→markdown,
`json`→json) and frames it in `.ds-reader`. The inspector variant uses it for
its Definition block, so opening `README.md` / `design-tokens.json` from the
directory navigator renders prose / a JSON tree in-theme.

### `DirectoryPanel` (floating folder/menu navigator)
A **Miller-columns** file/menu navigator: opening a folder reveals the next
column to the right (a drill-in that keeps the whole path on screen), the strip
scrolls horizontally, and new columns slide in (reduced-motion aware). Built on
`GlassSurface variant="soft"` — the "floating toolbar" case the perf budget
allows blur on. Float it over the canvas with React Flow's `<Panel>`.

| Prop | Type | Notes |
|---|---|---|
| `tree` | `DirEntry[]` | `{ id, name, kind: "folder"\|"file", typeLabel?, children? }` |
| `title` | `string` | header label (default `"Files"`) |
| `onOpenFile` | `(entry, path) => void` | fired on a file leaf — e.g. open that node's overlay |

**Why columns, not a tree:** the path of choices stays visible (a collapsing
tree hides the trail; a single drill-down pane forgets it), it maps onto the
file graph, and it reads as a HUD strip that suits the game-garnish aesthetic.

### `GlassSurface`
The only `backdrop-filter` surface. `variant="window" | "soft"`, `legibleText`,
polymorphic. Use for the overlay and floating toolbars **only**.

### `OrbField`
Background blooms. `full?: boolean` (3 orbs vs 2). Place once as the first child
of the workspace shell. `aria-hidden`.

## Template

### `WorkflowCanvas`
The shell: `ReactFlowProvider` → `LayoutGroup` → `ExpandContext.Provider` →
`OrbField` + `ReactFlow` (`colorMode="light"`) + `NodeExpandOverlay`. Owns the
`expandedId` state and the sample graph. This is your integration point — swap
`initialNodes`/`initialEdges` for real data and wire `onConnect` to your store
(Zustand recommended, per the React Flow workflow template).

## API conventions (match these when extending)

- **Predictable prop names** across components (`variant`, `size`, `as`).
- **Sensible defaults** — a component should render with zero required visual props.
- **Composition over configuration** — pass children, don't add `hasHeader`-style booleans.
- **Tokens only** — every color/space/radius is a `var(--ds-*)`, never a literal.
- **One render per node** — resist splitting the node into many sub-components; canvas perf depends on it.
