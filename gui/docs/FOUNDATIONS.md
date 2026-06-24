# Foundations

Every value here lives in `tokens/design-tokens.json` and compiles to
`--ds-*` CSS variables in `tokens/tokens.css`. Edit the JSON, regenerate the CSS;
never hard-code a hex in a component.

## Color

A **near-monochrome neutral scale + one chromatic accent**. That's the whole
palette. Discipline is the look.

- **Canvas** `#ffffff`, soft surfaces `#fafafa`/`#f5f5f5`. The workspace is white.
- **Ink** `#171717` (never pure black) for primary text and filled actions.
- **Hairlines** `#ebebeb` carry structure instead of heavy borders/shadows.
- **Accent** — Geist blue `#0070f3`, used *scarcely*: selected/running nodes,
  focus rings, live edges, the one primary action. Text-on-white uses `#0061d5`
  (the 600 step) for AA contrast.
- **Feedback** green/amber/red each ship a solid (dots/bars/fills) and a darker
  `-fg` (AA body text). Color = meaning only, never decoration.

> Rule: if a color isn't carrying *state* or *meaning*, it shouldn't be there.
> The product's complexity lives in the graph, not the chrome.

## Typography

- **Geist Sans** for UI; **Geist Mono** for file paths, IDs, code, and the
  uppercase type-labels on nodes — mono is how we say "this is data."
- Compact scale: **UI base = 14px** (Geist density). Display caps at **600**
  weight with negative tracking (`-0.03em`) — voice from spacing, not heft.
- Uppercase mono labels use positive tracking (`0.04em`).

## Spacing, radius, borders

- **4px spacing base.** Stick to the scale (`--ds-space-*`).
- **Radius:** 6px buttons/inputs, **8px node cards**, **16px glass window**.
- **Borders:** 1px hairline default; the **3px left status bar** on nodes is the
  one bit of "game" geometry — cheap, legible, meaningful.

## Shadows — shadow-as-border

Geist's signature: a zero-offset `0 0 0 1px rgba(0,0,0,0.08)` "ring" replaces CSS
borders on raised surfaces, then ambient/drop layers add lift. Cards feel *built*,
not floating. See `--ds-shadow-ring / sm / md / lg / glass / node-hover`.

## Glass (the material) — the recipe

```css
background: rgba(255,255,255,0.72);
backdrop-filter: blur(20px) saturate(180%);
box-shadow:
  0 1px 1px rgba(0,0,0,.04),          /* ambient   */
  0 16px 40px -8px rgba(0,0,0,.18),   /* drop       */
  inset 0 1px 0 rgba(255,255,255,.7), /* top highlight — reads as "lit" */
  0 0 0 1px rgba(0,0,0,.06);          /* rim so it separates from white */
```

- **`saturate(180%)`** is what makes light glass look *alive* rather than grey —
  it pumps the colour of whatever's behind it (Apple's trick).
- **Legibility guard:** text over glass-over-busy-content gets a faint
  `text-shadow` (`.ds-glass__legible`) — Apple's rule that glass must never cost
  readability.
- **Fallback:** `@supports not (backdrop-filter)` → opaque `rgba(255,255,255,.85)`.

**Where glass is allowed:** the expanded overlay window, floating toolbars.
**Where it is banned:** individual nodes. (Perf — see below.)

## Orbs (the dynamic background)

Two or three large radial blooms (`44vmax`), ~8–10% opacity, blurred 40px,
drifting on slow alternating `transform` animations (32s+). They give the white
canvas *a hint of life and depth* without color noise. They're `contain: strict`,
`pointer-events: none`, sit at `z-index:-1`, and **freeze under reduced motion**.
Drop the third orb (`<OrbField full={false} />`) for the absolute lightest cost.

## Motion

- **Durations:** hover 120ms · most transitions 200ms · expand 420ms.
- **Easing:** `cubic-bezier(0.2,0.8,0.2,1)` — soft, no overshoot.
- **Expand spring:** `stiffness 380, damping 32` — snappy but settles clean.
- All presets live in `src/motion/transitions.ts`, mirroring the tokens so CSS
  and JS never drift.

## Progress — the in-node "charge" bar

The single element allowed to animate *continuously* inside a node. It reads like
a battery charging, kept elegant: a determinate accent fill with a leading-edge
glow, and a soft sheen of light **sweeping** along it (the "energy"). Slim (3px,
`--ds-progress-h`) and flush on a node's bottom edge so it echoes the 3px status
geometry; a taller block (`--ds-progress-h-block`) carries it into the overlay.

It is deliberately cheap and honest:

- **Transform-only motion.** The continuous part is the sheen's `translateX`
  (compositor); the *fill width* only changes on a real progress update (a state
  change, not per frame), so many nodes can charge at once without cost.
- **Status recolors the fill** (running → accent, success → green, error → red);
  the sheen shows **only while `running`**. Omit the value while running for an
  indeterminate looping segment.
- **Reduced motion freezes the sweep** and parks the indeterminate segment — the
  fill still communicates state, just without travel.

Tokens live under `progress.*` (→ `--ds-progress-*`); the pattern (`.ds-progress`,
`__fill`, `__sheen`) lives in the core `src/styles/glass.css`.

## Overlay scrim

The dim + blur behind the expanded window (`.ds-scrim`). The node canvas is
high-contrast, so the scrim is **heavier than a hint** — `--ds-scrim-bg`
(`rgba(23,23,23,0.34)`) + `--ds-scrim-blur` (3px) — enough to drop the graph
back and make the window unambiguously the focus, while staying short of an
opaque "dark modal." Tune both via tokens.

## Performance budget

The whole point of "lightweight + reacts fast." Hard rules:

1. **One blur surface.** `backdrop-filter` only on `.ds-glass`. Multiplying blur
   across nodes is the #1 way to tank a canvas — don't.
2. **Compositor-only hovers.** `transform`, `opacity`, `box-shadow`. Never animate
   width/height/top/left on hover.
3. **Orbs = transforms + containment.** No gradient animation, no layout.
4. **Nodes stay flat.** Hairline + shadow-ring. Hundreds can render.
5. **`nodeTypes` at module scope.** Re-declaring it remounts every node each render.
6. **Reduced motion is wired everywhere**, in CSS and JS.
