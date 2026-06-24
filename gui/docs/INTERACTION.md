# Interaction: hover → expand

This is the question you raised directly — *overlay, or expand a panel into the
DOM?* Here is the decision, the reasoning, and the spec we built to.

## Decision: **overlay (portaled), morphed from the node via a shared element.**

Not inline DOM reflow. On a node canvas, inline expansion is the wrong tool.

### Why inline DOM-reflow loses here

A React Flow node is **absolutely positioned inside a CSS-`transform`ed pane**
(the viewport is panned/zoomed via `transform: translate() scale()`). That means:

- **There is no document flow to push.** Siblings don't reflow around an
  absolutely-positioned element, so "expand a panel into the DOM" would force you
  to *manually* shove every neighbouring node out of the way and then put them
  back — bookkeeping that fights the canvas.
- **You'd be fighting the zoom transform.** An inline panel inherits the pane's
  `scale()`, so at 70% zoom your "window" renders at 70% and its text is fuzzy.
- **It interrupts everything else** — exactly the thing you wanted to avoid.

### Why the overlay wins

- **Zero disruption.** Other nodes never move. The canvas keeps its state.
- **Rendered in a portal at `<body>`**, *outside* the transformed pane → it is
  not clipped, not scaled by zoom, crisp at any zoom level.
- **Blur stays on one surface.** The glass/`backdrop-filter` is applied to the
  single open window, never multiplied across nodes → frame-rate safe.
- **It's the industry pattern.** n8n, Figma, Linear all float the detail surface.

The "it grew out of the node" feeling is preserved by a **shared-element
transition**: the node and the overlay share `layoutId={`node-${id}`}`, so Motion
animates the small flat card's real on-screen box into the big glass window. You
get the inline *feeling* with the overlay's *safety*.

## The three-tier interaction model

| Tier | Trigger | What happens | Cost |
|---|---|---|---|
| **Rest** | — | Flat hairline card, 3px status bar | ~0 |
| **Hover / focus** | pointer over, or Tab to | Card lifts 2px, shadow strengthens, expand glyph fades in | compositor-only (`transform`, `box-shadow`, `opacity`) |
| **Expanded** | click card / Enter / click glyph | Shared-element morph into a centered glass window with the full content | one blur surface, one spring |

**Hover never opens the window.** Hover is *affordance only* — it signals "this is
expandable." Opening is an explicit click/Enter. Reasons:

- Hover-to-open is inaccessible (no keyboard, no touch) and fires on accidental
  pass-over while panning.
- An explicit gesture matches the mental model of "open this node."

> Optional: if you want hover to *open* (kiosk/demo mode), gate it behind a
> **dwell of ~180ms** (hover-intent) and still keep click/Enter. Don't ship
> hover-open as the only path.

## What drives the morph (code shape)

```tsx
// origin — inside the node
<motion.div layoutId={`node-${id}`} className="ds-node" onClick={() => expand(id)} />

// destination — portaled window, same id, same LayoutGroup
<motion.div layoutId={`node-${id}`} transition={expandTransition(reduce)}>
  <GlassSurface role="dialog">…full content…</GlassSurface>
</motion.div>
```

Both live under one `<LayoutGroup>` (in `WorkflowCanvas`). `AnimatePresence`
keeps the window mounted long enough to animate *back* to the node on close.

## Known caveat + fallback (zoom precision)

Motion measures real bounding boxes, so the morph starts from the node's actual
on-screen size even when zoomed. The one edge case: if the canvas pane is
**mid-pan/zoom animation** at the moment of expand, the projected origin can be
slightly off. Two mitigations, in order of preference:

1. **Don't expand mid-transition** — disable the expand trigger while the
   viewport is animating (`onMoveStart`/`onMoveEnd`).
2. **FLIP from a measured rect** — if you ever drop `layoutId`, capture
   `node.getBoundingClientRect()` on click and animate the window `from` that
   rect manually. Same feel, fully manual control.

For 95% of cases `layoutId` is correct and the simplest path.

## Reduced motion

`useReducedMotion()` swaps the spring for a 200ms fade (`expandTransition`),
orbs freeze, the running-pulse stops. The window still opens and closes — only
the *motion* is dialed down, never the *function*.
