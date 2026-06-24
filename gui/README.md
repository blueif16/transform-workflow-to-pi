# Flowmap Design System

A light, fast, *quietly* game-flavored design system for a node/workflow canvas
(n8n-style) where agents and files are rectangles that expand into windows.

## The thesis

Three influences, blended in strict proportion:

| Influence | What we take | What we leave |
|---|---|---|
| **Vercel Geist** | Off-white canvas, near-black ink, hairline borders, shadow-as-border, compact density, Geist Sans + **Geist Mono for "this is data/code"** | — (this is the base) |
| **Apple Liquid Glass** | A *single* frosted-glass surface for the expanded window + a faint orb-lit backdrop | Heavy translucency everywhere; we use it on **one** surface |
| **Game UI (Apex etc.)** | A 3px status bar, one accent, crisp micro-motion on hover | Dark sci-fi palette, chamfers, decoration, anything that costs frames |

**Functionality is the product. The game feeling is a 5% garnish, not a skin.**
The "premium" read comes from restraint + motion + type, not ornament.

## Stack (all lightweight, all DOM/compositor — no WebGL, no game engine)

- **React Flow** (`@xyflow/react`) — the node canvas
- **Motion** (`motion`, formerly Framer Motion) — the hover→expand shared-element morph (~12kb layout module)
- **Design tokens** (W3C DTCG JSON → CSS variables) — the single source of truth
- Plain CSS for material/orbs/nodes. No CSS-in-JS runtime, no UI kit dependency.

## File map

```
design-system/
├─ tokens/
│  ├─ design-tokens.json     # source of truth (W3C DTCG format)
│  └─ tokens.css             # compiled CSS variables (light + dark scaffold)
├─ src/
│  ├─ motion/transitions.ts  # Motion presets mirroring the motion tokens
│  ├─ styles/
│  │  ├─ glass.css           # CORE: material, orbs, node card, progress, reduced-motion
│  │  ├─ panels.css          # directory navigator + overlay config blocks
│  │  ├─ hud.css             # expanded "clicked-up" HUD chrome (all variants)
│  │  └─ reader.css          # markdown + json reader theming
│  └─ components/
│     ├─ OrbField.tsx        # dynamic background ("orbs")
│     ├─ GlassSurface.tsx    # the ONLY backdrop-filter surface
│     ├─ Button.tsx          # Geist action atom
│     ├─ ProgressBar.tsx     # in-node "charge" bar + overlay progress block
│     ├─ FieldBlock.tsx · Sparkline.tsx · MetricTile.tsx · HudBits.tsx  # HUD primitives
│     ├─ ExpandContext.tsx   # shares "which node is expanded"
│     ├─ WorkflowNode.tsx    # React Flow custom node (shared-element origin)
│     ├─ NodeExpandOverlay.tsx  # portaled shell (scrim + focus + morph)
│     ├─ HudWindow.tsx       # the clicked-up window frame + variant switch
│     ├─ OverlayMonitor/Stream/Inspector.tsx  # the three HUD body layouts
│     ├─ MarkdownReader.tsx · JsonReader.tsx · ContentView.tsx  # themed readers
│     ├─ DirectoryPanel.tsx  # floating Miller-columns folder/menu navigator
│     ├─ OverlayLab.tsx      # side-by-side gallery of the HUD variants
│     └─ WorkflowCanvas.tsx  # composes it all + sample data
└─ docs/
   ├─ FOUNDATIONS.md         # tokens, glass recipe, orbs, motion, perf budget
   ├─ COMPONENTS.md          # atomic architecture + props
   ├─ INTERACTION.md         # the hover→expand decision (overlay vs inline)
   └─ ACCESSIBILITY.md       # WCAG AA, keyboard, ARIA, reduced motion
```

## Use it

```bash
npm i @xyflow/react motion react react-dom
```

```tsx
import { WorkflowCanvas } from "./design-system/src/components/WorkflowCanvas";

export default function App() {
  return <div style={{ width: "100vw", height: "100vh" }}><WorkflowCanvas /></div>;
}
```

Tokens are consumed as CSS variables (`var(--ds-…)`) so you can theme globally
by editing `tokens.css` (or regenerating it from `design-tokens.json`). Drop the
`--ds-` variables into a Tailwind theme if you prefer utilities.

## The performance budget (non-negotiable)

1. **`backdrop-filter` lives on `.ds-glass` only** — the one expanded window. It is the single expensive effect; nodes are flat hairline cards.
2. **Hover is compositor-only** — `transform` + `box-shadow`, never layout, never blur.
3. **Orbs animate `transform` only**, are `contain: strict`, and `pointer-events: none`.
4. **`nodeTypes` defined at module scope** so nodes don't remount each render.
5. **Everything yields to `prefers-reduced-motion`** (orbs freeze, expand → fade).

## Reference shelf (study / clone-from)

- Vercel Geist — https://vercel.com/geist · token spec: https://www.shadcn.io/design/vercel
- Apple Liquid Glass — https://developer.apple.com/design/human-interface-guidelines/materials · https://developer.apple.com/videos/play/wwdc2025/219/
- React Flow workflow template — https://reactflow.dev/ui/templates/workflow-editor
- Motion shared-layout — https://motion.dev/docs/react-layout-animations
- Light game-button shapes — https://layerlab.io/products/gui-pro-minimal-game-light

See `docs/` for the detailed rationale behind every choice.

