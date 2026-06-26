# piflow metaphor SVGs — STYLE CONTRACT (read before drawing)

Three illustrations — **atom · substrate · protein** — must read as ONE family.
You compose with the shared kit `/tmp/isogen/kit.mjs` (never reinvent its primitives).

## The look (the bar)
Light, editorial **2.5D isometric** "engineered hardware" — the aintrum/Daytona feeling,
but in OUR light system. Reference render: `/tmp/isogen/atom.png` (good craft — but it is
deliberately TOO CROWDED; your job is the MINIMAL version of the same language).

## Palette — the ONLY colors (all in the kit; never add a hue)
- field `#f5f5f7` · box tops `#ffffff` · faces grey `#e7e7ee`/`#d8d8e0` · edges near-black `#1f1f24`
- labels `#6b6b73` (mute) / `#1f1f24` (ink) · **ONE orange `#ff5a1f`** — the single accent, used on
  exactly ONE element (the agent/active/verified spark named in the object spec). Never a second orange
  unless it is the SAME semantic signal.

## Craft conventions
- Thin **1.5px non-scaling** near-black outline on every solid; rounded-iso tops (`roundIsoBox r:`).
- "Sealed / engineered" cues earn their place ONLY if the spec calls for them: `bolt` (sealed), `glass`
  (sealed chamber), `gate` (a hook/check the flow passes through), `toolChip` (a wired capability).
- `shadow(...)` a soft contact shadow under every solid so nothing floats.
- `guide(...)` dashed ground rhombus = a ghost / landing zone / path.
- `flow([...])` dashed path + arrowhead = a task moving.
- `label(...)` geist-mono uppercase — cheap meaning carriers; label every object from the spec.

## The MINIMALITY LAW (this is why the workflow exists)
- Draw **only** the objects in the stage-1 object spec. No extras, no decoration.
- Every shape must map to a concept in the spec; if you cannot say why a shape exists, delete it.
- Generous spacing — crowding is the failure we are fixing. When in doubt, fewer + bigger.

## The render-verify loop (MANDATORY — you must actually look)
1. write `/tmp/isogen/out/<key>.mjs` importing `../kit.mjs`, composing the spec objects.
2. `cd /tmp/isogen/out && node <key>.mjs` (writes `<key>.svg`).
3. `rsvg-convert <key>.svg -o <key>.png -b "#f5f5f7"` then **Read `<key>.png` and look at it**.
4. Self-critique against the bar (every spec object present + labeled? any object NOT in spec → cut?
   crowded? one orange only? does the story read at a glance?). Revise + re-render. Repeat ≤3×.

## Motion (NOT now)
The kit emits static SVG. The site port later adds `.flow`/`.iso-float`/`.pulse` CSS classes
(reduced-motion gated). Do not bake animation into the SVG.
