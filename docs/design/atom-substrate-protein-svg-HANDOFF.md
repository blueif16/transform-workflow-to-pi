# Handoff — atom · substrate · protein hero SVGs (session-continuation)

**Written:** 2026-06-26 · **Resume by:** continuing to FIX REMAINING ATOM ISSUES FIRST, then substrate/protein, then port to site.

> **🔁 RELOCATED (2026-06-26):** the workspace was moved out of the ephemeral `/tmp/isogen/` **into the repo** at
> **`site-piflow/components/iso/_gen/`** (same internal layout: `kit.mjs`, `STYLE.md`, `RESEARCH-collision.md`,
> `collide.test.mjs`, `gen.mjs`, the crowded reference `atom.{png,svg}`, and `out/{atom,substrate,protein}.{mjs,svg,png}`).
> Any path below that still says `/tmp/isogen/…` now lives at `site-piflow/components/iso/_gen/…`. Two research
> companions are being added next to `RESEARCH-collision.md`: `RESEARCH-layout.md` (shape placement / iso composition)
> and `RESEARCH-interactivity.md` (clickable layered SVG → Next.js).

> Reference, don't re-derive: this doc points at files; read them, don't paste them back into context.

---

## 0. First actions in the new session (do these in order)
1. **Load the design skills before touching anything visual:** `piflow-web-design` (brand/tokens), `premium-saas-stack` (premium bar), and (only if you re-run the draw pipeline) `agentic-prompt-design` + `test-discipline`.
2. **✅ The workspace now lives IN THE REPO at `site-piflow/components/iso/_gen/`** (relocated 2026-06-26 — no longer in ephemeral `/tmp`). Verify with `ls site-piflow/components/iso/_gen/out`. It's committed, so it can't be lost on reboot.
3. **Regenerate + LOOK at the atom**, then review its remaining issues WITH the user (§4) before changing anything:
   ```
   cd site-piflow/components/iso/_gen/out && node atom.mjs && rsvg-convert atom.svg -o atom.png -b "#f5f5f7"
   ```
   then Read `site-piflow/components/iso/_gen/out/atom.png`.

---

## 1. The goal (what we're building & why)
Premium, **hand-authored** 2.5D isometric SVG illustrations for the PiFlow marketing site (`site-piflow/`), one per core metaphor:
- **atom** = ONE node (a full agent, sealed in a sandbox, guarded by pre/post hooks, wired to granted tools)
- **substrate** = the composed DAG (goal → graph of sealed nodes, edges inferred from reads/writes, a task flows through)
- **protein** = the self-improvement loop (verify fails → a better attempt is composed with evidence and re-run, bounded)

Every object must map to a real concept in `docs/design/node-action-protocol.md` — **meaning over decoration**. The visual bar = the **aintrum / Daytona** hero feeling (2.5D iso "engineered hardware", thin near-black outlines, cream/white field, ONE orange spark), but in OUR light system.

**Hard rules that are already settled (do not relitigate):**
- NOT image-gen, NOT stock SVG — we author our own (image-gen results were rejected; prior research `~/research/piflow-bespoke/leg-*.md` + `components/iso/HANDOFF.md` already chose zero-dep programmatic SVG).
- One orange spark only (`#ff5a1f`); everything else white/grey/ink. Light system per `piflow-web-design`.
- **Crowding/overlap is the #1 recurring defect** — it is now PREVENTED programmatically (§3 Scene), not eyeballed. Keep drawing THROUGH the Scene.

---

## 2. State now (what's done, verified)
- ✅ **Shared iso kit** `/tmp/isogen/kit.mjs` — rounded-iso boxes, bolts, gates, tool-chips, glass, flows, labels, `emit`. Light palette baked in.
- ✅ **Collision-aware `Scene` API appended to the kit** (additive) — tracks each solid's analytic bbox, AUTO-PLACES labels (greedy 8-point + viewBox clamp), prints `✓ no collisions` or a report. Pure deco (orange arc, shadows, rings) deliberately does NOT block labels. Exported helpers: `boxAABB`, `isoBoxAABB`, `labelAABB`, `overlaps`, `Scene({viewBox,padding,margin,labelSize})`.
- ✅ **Test-gated:** `/tmp/isogen/collide.test.mjs` — `node --test` → 8/8 green; the load-bearing test proves auto-placement removes a known overlap (test-the-test mutation confirmed it goes red). Monospace width const (0.6) empirically calibrated (10×"M" rendered = 119px vs 120px analytic; conservative).
- ✅ **atom** `/tmp/isogen/out/atom.{mjs,svg,png}` — drawn THROUGH the Scene; collision-clean; one orange; both earlier label defects (NUCLEUS-on-slab, POST-on-bolt) fixed. **Independently verified** (test re-run, render Read, substrate/protein byte-identical).
- ◐ **substrate** `/tmp/isogen/out/substrate.{mjs,svg,png}` — drawn with the FUNCTIONAL kit (hand-placed labels), NOT yet through the Scene → not collision-guaranteed. Reads well; needs the Scene pass.
- ◐ **protein** `/tmp/isogen/out/protein.{mjs,svg,png}` — functional kit, NOT Scene; **too busy** (literal climbing-ladder unroll). Needs simplification + Scene pass.

---

## 3. Key artifacts (the map)
**The SVG workspace `/tmp/isogen/` (RELOCATE INTO REPO — see §0.2):**
- `kit.mjs` — shared primitives + the `Scene` collision/auto-spacing API. **Single source of the visual family.**
- `STYLE.md` — the style contract every drawer obeys (light system, one orange, minimality law, render-verify loop).
- `RESEARCH-collision.md` — the collision-detection research (formula, 8-point greedy, library verdicts). Why zero-dep.
- `collide.test.mjs` — the test gate (`node --test`).
- `out/atom.mjs` — **the reference for HOW to use the Scene** (study this when porting substrate/protein to it).
- `out/{substrate,protein}.mjs` — current functional-kit generators (to be Scene-ified).
- `atom.png` (NOTE: the one at `/tmp/isogen/atom.png`, not `out/`) — the original hand-drawn, deliberately-CROWDED atom; craft reference only.

**Render-verify loop (MANDATORY — always look):** `node <key>.mjs && rsvg-convert <key>.svg -o <key>.png -b "#f5f5f7"` then Read the PNG. Tools present: `rsvg-convert`, `resvg`, `magick`. NO Playwright/Chrome (don't add — we own the geometry, labels are monospace).

**Site target (the eventual port):**
- `site-piflow/app/_sections/LayerCards.tsx` — the "Three layers. One loop." card row = the section to KEEP and wire. Rename to atom/substrate/protein; on tap → auto-scroll, pin cards at top, render the chosen SVG in a roomy stage below (user's spec).
- `site-piflow/components/iso/*` — the in-repo iso kit + `HANDOFF.md` (DAG-centric illustrations were always the plan). Port target: our `/tmp` kit becomes RSC-safe components here; motion via the gated CSS classes in `app/globals.css` (`.flow`, `.iso-float`, `.draw`, reduced-motion-safe). The architecture source is `docs/design/node-action-protocol.md`.

---

## 4. Open thread #1 (THE resume task): remaining atom issues
The atom is collision-clean and premium, but the user wants to "fix whatever issues we still have in atom FIRST." **Review these candidate issues WITH the user and let them prioritize — do not assume:**
- The minimal atom DROPPED the inbound→outbound **task flow** (the earlier crowded version had `task in → PRE → … → POST → verified out` with arrows). So the directional "guarded on the way IN, verified on the way OUT" story is weaker — the PRE/POST gates now read as floating beside the slab rather than sitting ON a path. Consider re-adding a minimal in/out flow (the Scene can keep it uncrowded).
- Does the **nucleus** read clearly as "a whole agent sealed in a sandbox"? It's a small core box + faint membrane ring; may want it to read more like a living/brain unit.
- **TOOLS** bundle is small/peripheral — "wired to exactly the tools you grant" could be stronger.
- **CONTROL** arc meaning (on-failure retry/escalate/reroute) may be too subtle.
- Composition vs the aintrum bar — bolts/vents/depth/balance.
- Pending family-wide decision (see §5): if orange becomes "the live unit," the atom's nucleus (not the control arc) becomes the orange spark — that's an atom change to make here.

---

## 5. Open thread #2: two family-wide design decisions (pending user)
1. **What the single orange spark MEANS across all three.** Current = the *adaptive signal* (atom control arc / substrate running node / protein evidence). Claude's recommendation = **the live unit** (agent nucleus / running node / improved re-run) — a glowing THING reads more premium and ties to atom=nucleus. USER HAS NOT DECIDED.
2. **protein simplification.** Current = literal climbing-ladder unroll (too busy). Claude's recommendation = a calm loop matching atom/substrate: run → folds into a summary capsule → distinct **Hermes** memory block → one re-run arc to a better attempt. USER HAS NOT DECIDED.

---

## 6. Decisions already made (and why)
- **Two-agent draw pipeline** (agent-1 derives the minimal object set from `node-action-protocol.md` with a hard ≤6 cap + every object cites a §; agent-2 draws only those through the kit, render-verified). The Workflow script is saved; re-runnable. This is how we keep "meaning over decoration" and avoid pile-up.
- **Collision handled in the TOOL, not the prompt** — bake the bar into the kit (Scene) so crowding can't ship, rather than asking the model to "space things out."
- **Shape-on-shape overlap is allowed** (nucleus sits INSIDE the sandbox by design); only LABELS auto-move. The Scene reflects this.
- **Reveal interaction (user spec):** keep the 3 parallel cards; tap → auto-scroll, cards pinned top, SVG in a roomy stage below. Substrate need only capture the *feeling* of the GUI flowmap, not match it literally.

---

## 7. Suggested skills to load next session
`piflow-web-design` · `premium-saas-stack` (both BEFORE any visual edit) · `agentic-prompt-design` + `test-discipline` (only if re-running the draw pipeline or editing the Scene/test) · the saved Workflow script for the two-agent pipeline if redrawing.

## 8. Watch-outs
- ✅ Workspace relocated into the repo (`site-piflow/components/iso/_gen/`) and committed — no longer ephemeral (§0.2).
- Keep `Scene` changes ADDITIVE; substrate/protein still use the functional kit until ported — don't break those exports (the test + a substrate/protein render are the guard).
- Verify subagent claims yourself (re-run the test, Read the PNG) — never trust the self-report.
- One-orange invariant: `grep -o '#ff5a1f' <file>.svg | wc -l` should map to ONE semantic element.
