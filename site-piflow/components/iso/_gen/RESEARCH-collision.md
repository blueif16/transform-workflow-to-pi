# Collision Detection + Auto-Spacing for Data-Authored Isometric SVGs

Research target: a Node.js collision-detection + min-padding + label-auto-placement utility for our
data-generated 2.5D iso line-art. We OWN the geometry (we project every box corner ourselves) and our
labels are MONOSPACE (geist-mono). No browser / Playwright installed; resvg/rsvg-convert/magick present.

---

## 1. TL;DR recommendation

- **Go zero-dep for detection.** With <30 elements, an O(n²) AABB pairwise loop with a min-padding
  constant is trivially fast (<900 comparisons) and ~30 lines of code. **Skip `rbush`** — an R-tree only
  pays off in the thousands; here it is pure overhead and a dependency you'd maintain. SKIP `sat-js` too
  unless eyeball tests show the AABB over-report actually causes false positives (see §4).
- **Compute label boxes analytically, no font parsing.** Because labels are monospace, advance width is a
  closed form: **`w = nChars × fontSize × 0.6`** (the 0.6em em-ratio is the documented industry constant
  for monospace). Height ≈ `fontSize` (use ~`1.0×fontSize` for the box, with the baseline `~0.8×fontSize`
  below the top). **Do NOT add `opentype.js`** for the common path — keep it as a one-time **calibration**
  tool to measure geist-mono's real advance ratio once (it's typically ~0.6 but verify), then hardcode that
  constant. (opentype.js verdict: REFERENCE, not a runtime dep.)
- **Box detection from projected corners.** You already produce the 4 (or 8) iso-projected corner points of
  every `roundIsoBox`. Take `min/max` of those screen X/Y → an AABB per shape. That's your collision rect.
- **Auto-placement algorithm: candidate-position greedy for LABELS + a bounded nudge pass for everything
  else.** For each label try the canonical **8-point** offset positions (the classic cartographic label
  model) in preference order, pick the first that collides with nothing (+padding) and stays inside the
  viewBox; this is fast, deterministic, and reproducible (no random seed → identical SVG every run, which
  matters for diffable generated output). Reserve **simulated annealing** (the d3-labeler algorithm) only if
  greedy can't satisfy a dense scene — but at <30 elements greedy + a small nudge almost always wins.
- **Edge-clip is the same test:** treat the viewBox (inset by padding) as a container rect; any element AABB
  whose min/max falls outside is "clipped" → clamp it inward (and grow the viewBox if a hard element like a
  shape can't move).
- **The one library worth vendoring (optional):** `d3-labeler` (≈150 LOC, MIT) as a *reference port* for the
  annealing energy function if you ever need it. It needs no DOM — it operates on plain `{x,y,width,height}`
  arrays — so it runs fine in pure Node. But start without it.
- **Don't add headless Chrome.** Its only value would be `getBBox()`, which we don't need: we own the
  geometry and our text is monospace. Adding Chrome to a generator pipeline is a heavy, slow, flaky
  dependency for zero benefit here.

---

## 2. Detection

### 2a. Bounding box per element

**Boxes (iso shapes).** You already compute the iso projection of each box's corners. An iso projection of
an axis-aligned 3D box gives a hexagonal silhouette (up to 7 visible corners). Collect ALL projected screen
points for the shape (top rhombus + visible side corners), then:

```
aabb(points) = {
  minX: min(p.x), minY: min(p.y),
  maxX: max(p.x), maxY: max(p.y)
}
```

This is the tight axis-aligned box over the *projected* polygon — already much tighter than projecting the
3D bounding cube, and correct because the silhouette's extremes are always at projected corners.

**Monospace labels — the exact formula.** For text anchored at `(ax, ay)` with `n` characters at
`fontSize` px in geist-mono / ui-monospace:

```
charW   = fontSize * 0.6            // monospace em-ratio (CALIBRATE once, see §4; ~0.6 is the standard)
textW   = n * charW
ascent  = fontSize * 0.75           // cap/ascender height above baseline (geist-mono ~0.75–0.8)
descent = fontSize * 0.25           // below baseline for g/p/y etc.

// SVG <text> y is the BASELINE. Convert anchor → box by text-anchor:
//   text-anchor="start":  x0 = ax
//   text-anchor="middle": x0 = ax - textW/2
//   text-anchor="end":    x0 = ax - textW
labelBox = {
  minX: x0,
  minY: ay - ascent,               // top of glyphs
  maxX: x0 + textW,
  maxY: ay + descent               // bottom of descenders
}
```

Round-trip note: `font.getAdvanceWidth(text, fontSize)` in opentype.js is the exact version of `n*charW`
and matches Canvas `measureText().width` — use it ONCE to confirm 0.6 for geist-mono, then drop it.

### 2b. Pairwise overlap + min-padding

Inflate each box by half the required gap (or test with a gap term). Standard AABB overlap with padding `p`:

```
function overlapsWithPadding(a, b, p) {
  return a.minX - p < b.maxX && a.maxX + p > b.minX &&
         a.minY - p < b.maxY && a.maxY + p > b.minY;
}
```

If this returns true the two elements are closer than `p` (or overlapping). Run it over all pairs:

```
for (let i = 0; i < boxes.length; i++)
  for (let j = i + 1; j < boxes.length; j++)
    if (overlapsWithPadding(boxes[i], boxes[j], MIN_PAD)) report(i, j);
```

### 2c. rbush / SAT — do they earn their cost here?

- **`rbush` (R-tree spatial index): NO, for us.** It accelerates "find candidates near box X" from O(n) to
  ~O(log n), which matters at n in the thousands. At n<30 the plain double loop is ≤435 cheap comparisons —
  faster than building a tree. rbush's API (`tree.search({minX,minY,maxX,maxY})`, `tree.collides(bbox)`,
  `{minX,minY,maxX,maxY}` item shape) is exactly the box shape we'd use, so it's a drop-in IF we ever scale —
  but today it's a dependency for nothing. **Verdict: SKIP now, REFERENCE if element counts explode.**
- **SAT (separating-axis theorem): only if AABB false-positives bite.** AABB over the iso rhombus/parallelogram
  faces over-reports area (the corners of the bounding rect are empty triangles), so two iso faces whose
  bounding rects touch may not actually touch. With one-accent premium art and generous padding this rarely
  causes a *visible* problem; AABB-with-padding is conservative (it errs toward MORE spacing, which is the
  safe direction). Use SAT (`sat-js` `testPolygonPolygon`, polygons CCW) ONLY for the specific pair-types
  where AABB demonstrably spaces things too far apart. See §4.

---

## 3. Auto-spacing / label placement

Two regimes: **labels move freely** (reposition around their anchor); **shapes are mostly fixed** (nudge a
little, or grow the viewBox). Padding `P` and viewBox inset `M` are constants.

### 3a. Labels — candidate-position greedy (the recommended core)

The classic cartographic **fixed-position model**: each label anchor has a small ordered set of candidate
offsets; pick the first conflict-free one. Use the canonical **8-point** set (4-point is the cheaper subset).
Order encodes your aesthetic preference (e.g. prefer up-right, then right, etc.).

```
// obstacles = all shape AABBs + already-placed label AABBs (an array, or an rbush if it ever grows)
// candidates ordered by preference; dx,dy are offsets of the label box origin from the anchor
const CANDIDATES = [
  /* TR */ { dx:+g, dy:-g }, /* R */ { dx:+g, dy:0 }, /* BR */ { dx:+g, dy:+g },
  /* T  */ { dx:0,  dy:-g }, /* B */ { dx:0,  dy:+g },
  /* TL */ { dx:-g, dy:-g }, /* L */ { dx:-g, dy:0 }, /* BL */ { dx:-g, dy:+g },
];

function placeLabel(label, anchor, obstacles, viewBox) {
  let best = null, bestPenalty = Infinity;
  for (const c of CANDIDATES) {
    const box = labelBoxAt(anchor.x + c.dx, anchor.y + c.dy, label); // §2a formula
    if (!insideViewBox(box, viewBox, M)) continue;                   // edge-clip clamp: reject off-canvas
    const penalty = totalOverlapArea(box, obstacles, P);             // 0 = no collision
    if (penalty === 0) { obstacles.push(box); return box; }          // first clean candidate wins
    if (penalty < bestPenalty) { bestPenalty = penalty; best = box; }
  }
  // no clean spot → take least-bad, optionally draw a LEADER LINE from anchor to box (see §5)
  obstacles.push(best);
  return best;
}

// process labels in a stable order (e.g. by anchor y then x) so output is deterministic & diff-friendly
labels.sort(byAnchorYThenX).forEach(l => placeLabel(l, l.anchor, obstacles, viewBox));
```

This is `d3fc-label-layout`'s `layoutGreedy` strategy in spirit ("adds each label in sequence, selecting the
position where the label has the lowest overlap with already-added rectangles and is inside the container").

### 3b. If greedy stalls — annealing (d3-labeler) as the fallback

`d3-labeler` (Evan Wang, Berkeley CS294) is **simulated annealing over `{x,y,width,height}` arrays** — no
DOM, runs in plain Node. Energy = weighted sum of (label–label overlap) + (label–anchor distance) +
(label over its own feature) + (off-canvas). Each step: move ONE label, accept if energy drops, else accept
with Boltzmann probability `exp(-ΔE/T)`; cool `T` over `nSweeps` (50 iterations is plenty per the SO author,
not the demo's 1000). Use it only when greedy leaves residual overlaps in a dense scene; for premium hand-
authored hero art at <30 elements that should be rare. **Trade-off:** annealing is stochastic → seed it (or
it produces a different SVG each run, breaking reproducible/diffable generation).

### 3c. Shapes & generic rectangles — bounded nudge (avoid-overlap style)

For overlaps between *shapes* (which shouldn't teleport like labels), use the iterative
center-repulsion nudge (the StackOverflow / `kevinschaul/avoid-overlap` `nudge` technique):

```
repeat up to K times (K ~ 20):
  movedAny = false
  for each colliding pair (a,b):
     v = unit(center(a) - center(b))         // push along the line of centers
     shift = (requiredGap - currentGap)/2
     move a by +v*shift, b by -v*shift        // split the correction
     movedAny = true
  clampAllInsideViewBox(inset M)
  if (!movedAny) break
```

Deterministic, converges fast at low n, and "moves things apart with minimal movement." For shapes that are
structurally fixed (a backbone box), mark them immovable and only move the other side of the pair (or grow
the viewBox).

### 3d. viewBox edge clamp (clipping fix)

Clipping is just collision against the *inside* of the container. After placement, for every element box:

```
if (box.minX < M)            shiftRight(el, M - box.minX);
if (box.minY < M)            shiftDown (el, M - box.minY);
if (box.maxX > W - M)        shiftLeft (el, box.maxX - (W - M));
if (box.maxY > H - M)        shiftUp   (el, box.maxY - (H - M));
// if a non-movable shape still overflows → grow viewBox W/H instead of moving it
```

---

## 4. Bounding boxes without a browser — the verdict

| Approach | Accuracy for us | Cost | Verdict |
|---|---|---|---|
| **Monospace `n×fontSize×0.6` (analytic)** | Exact-enough; monospace = uniform advance, so the only error is the em-ratio constant and the asc/desc estimate | Zero deps, instant | **USE — primary path** |
| **opentype.js `getAdvanceWidth` / `glyph.getBoundingBox`** | Pixel-exact incl. real cap-height/descent of geist-mono | Adds a dep + must ship/locate the .ttf; loads font once | **REFERENCE — one-time calibration** of the 0.6 ratio + true ascent/descent, then hardcode |
| **resvg / usvg bbox emit** | resvg renders SVG→PNG; it does **not** expose a per-element bbox API to Node. usvg computes bboxes internally but doesn't surface them on the CLI | n/a | **SKIP** (not available as a usable API) |
| **@svgdotjs/svg.js `.bbox()` + svgdom** | `.bbox()` needs a DOM; `svgdom` provides one headlessly, BUT geometric bbox from svgdom is computed, not font-rendered, and is heavier than just doing the math we already own | dep + DOM shim | **SKIP** — we already know the geometry; don't reconstruct it from an SVG string |
| **Headless Chrome for `getBBox()`** | Ground truth, but solves a problem we don't have | Huge: install Chrome, spawn per build, flaky | **SKIP — not worth adding** |

**Recommendation:** ship the analytic monospace formula. Run a 10-line opentype.js script ONCE against
geist-mono.ttf to read its true advance ratio (`getAdvanceWidth('M',1000)/1000`) and its ascent/descent from
`font.ascender/descender / unitsPerEm`; bake those three numbers in as constants. Then geist-mono needs no
runtime font parsing. (If you switch fonts, re-run calibration.)

**Iso wrinkle restated (thread 4):** AABB-on-projected-points is the right default — cheap and *conservative*
(over-reports → more spacing, the safe error). The over-report is the empty corner-triangles of a rhombus
top / parallelogram face. A cheap mitigation short of full SAT is a **"padding ring"**: shrink the effective
AABB by a small inset for iso faces (since their real mass is centered), OR just accept the slightly-larger
spacing — for premium art, a touch more breathing room is usually *desired*. Escalate to `sat-js`
`testPolygonPolygon` (feed the actual CCW projected polygon) only for specific pair types where the AABB
false-positive provably wastes space.

---

## 5. Label-leader / callout placement (brief)

When greedy can't place a label adjacent without overlap, fall back to the **technical-illustration leader
convention**: park the label in clear space and draw a thin continuous leader line from the label's reference
edge to the feature, with a dot terminator for a face / arrow for an edge. Practical rules from engineering
drawing standards (BS8888 / ASME): leaders at fixed angles (**15° increments; prefer horizontal / vertical /
45°**), never parallel to the art, never crossing each other or other leaders, text horizontally aligned with
the leader's shoulder and sitting just above a reference line. For us this is the graceful degradation path
of §3a's `placeLabel` "no clean spot" branch — move the label out to guaranteed-empty space (e.g. a margin
gutter) and connect it, rather than letting it overlap.

---

## 6. Library table

| Library | What it gives us | License | Node/CLI usable? | Verdict |
|---|---|---|---|---|
| **d3-labeler** (tinker10) | Simulated-annealing label placement over `{x,y,width,height}` arrays + anchors; ~150 LOC, no DOM | MIT | Yes (pure arrays, no DOM) | **REFERENCE** — port the energy fn if greedy stalls; not needed day 1 |
| **d3fc-label-layout** (@d3fc) | greedy / annealing / remove-overlap strategies as composable layouts | MIT(/Apache via d3fc) | Partly — `.size()` accessor calls `text.getBBox()` (DOM); strategies themselves are rect math | **REFERENCE** — copy the greedy strategy idea; the component layer wants a DOM |
| **rbush** (mourner) | R-tree spatial index; `insert`, `search({minX,minY,maxX,maxY})`, `collides(bbox)` | MIT | Yes (pure JS, Node-native) | **SKIP now / REFERENCE** — only worth it above ~hundreds of elements |
| **rbush-knn** (mourner) | k-nearest-neighbour over an rbush tree | ISC | Yes | **SKIP** — not our problem (we want overlap, not nearest) |
| **opentype.js** (opentypejs) | `font.getAdvanceWidth(text,size)`, `glyph.getBoundingBox()`, real ascent/descent from the .ttf | MIT | Yes (Node-native, parses .ttf/.otf/.woff buffer) | **REFERENCE** — one-time calibration of the 0.6 ratio & metrics, then drop |
| **sat-js** (jriecken/`sat`) | SAT collision for convex polygons (`testPolygonPolygon`), `getAABBAsBox`, point-in-poly | MIT | Yes (`npm i sat`, Node) | **SKIP unless** AABB false-positives on iso faces waste space — then USE for those pairs |
| **textric** / **pretext** | Higher-level pure-JS text measurement on top of opentype.js (wrapping, rich text) | MIT | Yes | **SKIP** — overkill; our text is single-line monospace |
| **kevinschaul/avoid-overlap** | `nudge` + `choices` overlap-avoidance techniques (DOM-oriented) | MIT | Browser-oriented (operates on DOM nodes) | **REFERENCE** — the `nudge` algorithm is what §3c reimplements zero-dep |
| **jasondavies/d3-cloud** | Archimedean/rectangular spiral placement with collision (wordcloud) | BSD-3 | Yes (sprite-based, no DOM needed for layout) | **REFERENCE** — spiral search is an alternative to 8-point if labels need free 2D search |

**Net:** ship **zero new runtime dependencies**. Implement detection (§2) + greedy 8-point placement (§3a)
+ nudge (§3c) + viewBox clamp (§3d) by hand. Keep **opentype.js** around as a calibration script and
**d3-labeler** / **sat-js** as named fallbacks for the dense-scene and iso-false-positive cases respectively.

---

## 7. Sources

Exa web search / fetch:
- d3-labeler paper (Evan Wang, Berkeley CS294-10): https://vis.berkeley.edu/courses/cs294-10-fa13/wiki/images/5/55/FP_EvanWang_paper.pdf
- D3-Labeler repo (tinker10): https://github.com/tinker10/D3-Labeler/blob/master/index.html
- d3fc-label-layout (greedy/annealing/remove-overlaps): https://github.com/ColinEberhardt/d3fc-label-layout/ and https://registry.npmjs.org/@d3fc/d3fc-label-layout
- d3-plugins force_labels: https://github.com/d3/d3-plugins/tree/master/force_labels
- "A General Cartographic Labeling Algorithm" (MERL, candidate positions + simulated annealing): https://www.merl.com/publications/docs/TR96-04.pdf
- "An Empirical Study of Algorithms for Point-Feature Label Placement" (Christensen/Marks/Shieber, 8-point model, SA dominates): https://www.eecs.harvard.edu/shieber/Biblio/Papers/tog-final.pdf
- GRASP for PFCLP (8 candidate positions, conflict graph): https://www.sciencedirect.com/science/article/abs/pii/S0098300407001033
- Brown CS "Labeling Algorithms" handbook chapter (4/8 candidate positions, NP-hardness, SA): https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/labeling.pdf
- Wolff "Automated Label Placement in Theory and Practice": https://www1.pub.informatik.uni-wuerzburg.de/pub/wolff/pub/w-alptp-99.pdf
- StackOverflow: D3 automatic label placement (force repulsion, D3-Labeler, 50 iterations): https://stackoverflow.com/questions/17425268/
- SAT.js docs + repo (separating-axis theorem, testPolygonPolygon, getAABBAsBox): http://jriecken.github.io/sat-js/ and https://github.com/jriecken/sat-js and https://www.npmjs.com/package/sat
- Monospace 0.6 char-width ratio in practice (kilocode textMeasurement.ts): https://github.com/bernie43/kilocode-1/blob/main/src/services/ghost/utils/textMeasurement.ts
- Pure-TS text measurement / opentype.js note (LogicAI): https://logicaistudio.com/ai-strategy/pure-typescript-text-measurement-no-dom-reflow/
- textric (opentype.js getAdvanceWidth in Node): https://github.com/ShiyuCheng2018/textric
- "Calculating text width programmatically" (Chris Hewett): https://chrishewett.com/blog/calculating-text-width-programmatically/
- StackOverflow: algorithm to space out overlapping rectangles (center-repulsion nudge): https://stackoverflow.com/questions/3265986/
- kevinschaul/avoid-overlap (nudge / choices techniques): https://github.com/kevinschaul/avoid-overlap/blob/main/README.md
- jasondavies/d3-cloud (spiral collision placement): https://github.com/jasondavies/d3-cloud/
- Leader-line conventions (CAD Setter Out / BS8888): https://cadsetterout.com/drawing-standards/technical-drawing-standards-leader-lines/
- ANSI leaders/callouts best practices (LinkedIn): https://www.linkedin.com/advice/1/what-best-practices-creating-clear-consistent-leaders

Context7 libraries queried:
- `/mourner/rbush` — confirmed `insert`, `search({minX,minY,maxX,maxY})`, `collides(bbox)`, `{minX,minY,maxX,maxY}` item shape.
- `/opentypejs/opentype.js` — confirmed `font.getAdvanceWidth(text, fontSize, {kerning})` (== Canvas measureText width) and `glyph.getBoundingBox() → {x1,y1,x2,y2}`.
