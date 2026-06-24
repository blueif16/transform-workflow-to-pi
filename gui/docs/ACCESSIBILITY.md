# Accessibility

Target: **WCAG 2.1 AA**. A light, glassy, motion-y canvas has three risk areas —
contrast on glass, keyboard access to a spatial canvas, and motion. All three are
handled in the system; this is the contract for keeping them handled.

## Contrast (AA)

The palette is pre-checked against white `#ffffff`:

| Token | Hex | On white | Use |
|---|---|---|---|
| `text-primary` | `#171717` | ~16:1 | body, headings ✅ |
| `text-secondary` | `#525252` | ~7.5:1 | secondary ✅ |
| `text-tertiary` | `#737373` | ~4.7:1 | labels (AA normal) ✅ |
| `text-accent` | `#0061d5` | ~4.9:1 | accent text (uses 600, **not** 500) ✅ |
| `accent` 500 | `#0070f3` | ~3.5:1 | **non-text only** (bars, rings, edges) — fails for text |
| `success-fg` `#0f7a38` / `error-fg` `#c1262b` / `warning-fg` `#b46600` | | ≥4.5:1 | status **text** ✅ |

Rules:
- **Never set body text in accent-500** — use `--ds-text-accent` (600).
- Status *bars/dots* may use the bright 500s (they're graphics, 3:1 applies).
- **Text on glass:** add `.ds-glass__legible` (text-shadow lift). Apple's own
  rule — translucency must never cost readability. If glass sits over a very busy
  region, raise to `--ds-glass-bg-strong`.
- Don't rely on color alone for status: pair the bar color with the mono label
  and (for running) the pulse + text in the overlay.

## Keyboard

A canvas is spatial, so keyboard support is explicit:

- **Nodes are reachable.** Each node is `role="button" tabIndex=0` with an
  `aria-label` ("agent Planner. Press Enter to expand."). **Enter/Space expands.**
- **The peek glyph is a real `<button>`** with its own `aria-label` — a second,
  guaranteed keyboard path that doesn't depend on the card's handler.
- **Hover never opens** — so keyboard and pointer users get the same capability
  (no hover-only functionality, a WCAG must).
- **Overlay = dialog.** On open, focus moves into the window (`tabIndex=-1` +
  `.focus()`); **Esc** closes; **focus is restored** to the triggering node on
  close (`restoreFocusRef`). Add a focus *trap* (e.g. `focus-trap-react` or a
  small loop on Tab) before shipping — the scaffold moves focus in and restores
  it but does not yet cycle within.
- React Flow's own keyboard nav (arrow-move selected node, delete) stays on;
  don't override its handlers.

## ARIA

| Element | Role / attrs |
|---|---|
| Node | `role="button"`, `aria-label`, `tabindex=0` |
| Peek / close | `<button>` + `aria-label` |
| Overlay window | `role="dialog"`, `aria-modal="true"`, `aria-label="<title> details"` |
| Orbs | `aria-hidden="true"` (decorative) |
| Running node | announce status via an `aria-live="polite"` region in the overlay/side panel (wire to your run feed) |
| Icon-only buttons | **must** have `aria-label` (the Button enforces nothing — you must pass it) |

## Motion

- `prefers-reduced-motion: reduce` is honored in **CSS** (orbs freeze, pulse
  stops, hover lift removed, dashed edge stops) **and JS** (`useReducedMotion()`
  → expand spring becomes a 200ms fade via `expandTransition`).
- Function is never gated on motion: the window still opens/closes, edges still
  read as active (solid accent), status still shows — only the *animation* dials down.

## Touch / pointer

- Min interactive size `--ds-tap-target` (32px). Node cards exceed it; ensure
  custom controls don't shrink below it.
- Everything works on tap (no hover dependency), so the system is touch-complete.

## Pre-ship checklist

- [ ] Run axe / Lighthouse on the canvas + an open overlay (0 serious issues)
- [ ] Tab through: reach every node, expand via Enter, close via Esc, focus returns
- [ ] Add a focus trap inside the dialog (cycle Tab within)
- [ ] Verify all status text uses `-fg` tokens; no accent-500 text
- [ ] Test with reduced-motion ON (orbs still, expand fades, nothing breaks)
- [ ] Screen-reader pass: node labels read, dialog announced, running status via live region
- [ ] Contrast audit any custom node content you add
