/* ============================================================
   Tests for the collision-detection + auto-spacing Scene utility.
   TEST-FIRST: these import symbols (boxAABB, labelAABB, overlaps,
   Scene) that the kit must export. Run `node --test` and watch
   them FAIL (red) before the Scene exists, then implement to green.

   A test here is meaningful ONLY if it fails when the code is wrong.
   The load-bearing test (auto-placement) proves it tests the FIX by
   first asserting the PREFERRED (unplaced) position WOULD overlap.
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { overlaps, labelAABB, boxAABB, Scene } from "./kit.mjs";

/* ---- overlaps(a,b,pad): the core AABB predicate ---- */
test("overlaps: true for overlapping rects", () => {
  const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const b = { minX: 5, minY: 5, maxX: 15, maxY: 15 };
  assert.equal(overlaps(a, b, 0), true);
});

test("overlaps: false for clearly separated rects", () => {
  const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const b = { minX: 50, minY: 50, maxX: 60, maxY: 60 };
  assert.equal(overlaps(a, b, 0), false);
});

test("overlaps: padding turns a near-miss into a hit", () => {
  // 4px gap on x. overlaps() flags pairs CLOSER than `pad`, so pad must
  // EXCEED the gap (4) to trip. pad 3 (< 4) does not; pad 5 (> 4) does.
  const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const b = { minX: 14, minY: 0, maxX: 24, maxY: 10 };
  assert.equal(overlaps(a, b, 0), false, "no pad: 4px gap is separated");
  assert.equal(overlaps(a, b, 3), false, "pad 3 < 4px gap: still separated");
  assert.equal(overlaps(a, b, 5), true, "pad 5 > 4px gap: now within the required clearance");
});

/* ---- labelAABB: monospace analytic box ---- */
test("labelAABB: width grows with char count", () => {
  const size = 10;
  const w3 = labelAABB(0, 0, "ABC", { anchor: "start", size });
  const w6 = labelAABB(0, 0, "ABCDEF", { anchor: "start", size });
  const width3 = w3.maxX - w3.minX, width6 = w6.maxX - w6.minX;
  assert.ok(width6 > width3, "6 chars wider than 3");
  // exact: charW = size*0.6 -> 3 chars = 18, 6 chars = 36
  assert.equal(width3, 3 * size * 0.6);
  assert.equal(width6, 6 * size * 0.6);
});

test("labelAABB: text-anchor shifts the box x-origin", () => {
  const size = 10, text = "ABCD"; // textW = 4*10*0.6 = 24
  const ax = 100;
  const start = labelAABB(ax, 0, text, { anchor: "start", size });
  const middle = labelAABB(ax, 0, text, { anchor: "middle", size });
  const end = labelAABB(ax, 0, text, { anchor: "end", size });
  assert.equal(start.minX, ax, "start: box begins at anchor");
  assert.equal(middle.minX, ax - 24 / 2, "middle: box centered on anchor");
  assert.equal(end.maxX, ax, "end: box ends at anchor");
});

test("labelAABB: vertical box straddles the baseline (ascent up, descent down)", () => {
  const size = 10, ay = 100;
  const b = labelAABB(0, ay, "X", { anchor: "start", size });
  assert.ok(b.minY < ay, "top of glyphs above baseline");
  assert.ok(b.maxY > ay, "descenders below baseline");
});

/* ---- THE LOAD-BEARING TEST: auto-placement removes a known collision ----
   A shape obstacle sits where the label's PREFERRED side would land. The
   Scene must relocate the label to a candidate that does NOT overlap the
   shape AND stays inside the viewBox. We first PROVE the unplaced/preferred
   box overlaps (so the test exercises the fix, not a no-op). */
test("Scene auto-placement: moves a label out of a known shape collision", () => {
  const viewBox = "0 0 200 200";
  const s = Scene({ viewBox, padding: 2, margin: 4, labelSize: 10 });

  // a tracked solid obstacle near screen-center. roundIsoBox at iso origin;
  // we read its registered AABB back to construct the proof.
  s.box(40, 40, 0, 40, 40, 20, { r: 4 });
  const obstacles = s.obstacles();
  assert.equal(obstacles.length, 1, "exactly one tracked obstacle registered");
  const shape = obstacles[0];

  // Anchor the label at the shape's CENTER and force its preferred side to
  // "right" with a tiny gap so the preferred box lands ON the shape.
  const cx = (shape.minX + shape.maxX) / 2, cy = (shape.minY + shape.maxY) / 2;

  // PROOF the test is meaningful: the preferred-position box (no search) overlaps.
  const preferredGap = 2;
  const preferred = labelAABB(cx + preferredGap, cy, "LABEL", { anchor: "start", size: 10 });
  assert.equal(overlaps(preferred, shape, 2), true,
    "precondition: the preferred (un-searched) label position DOES overlap the shape");

  // Now queue the label via the Scene at that same anchor/side and let emit() place it.
  s.label([cx, cy], "LABEL", { side: "right", size: 10, gap: preferredGap, anchorScreen: true });
  s.emit({ w: 200 });

  const placed = s.placedLabels();
  assert.equal(placed.length, 1);
  const box = placed[0].box;

  // (1) placed label must NOT overlap the shape (with padding)
  assert.equal(overlaps(box, shape, 2), false,
    "after placement the label no longer overlaps the shape");
  // (2) placed label must be inside the viewBox margin
  const [vx, vy, vw, vh] = viewBox.split(/\s+/).map(Number);
  assert.ok(box.minX >= vx + 4 && box.minY >= vy + 4 &&
            box.maxX <= vx + vw - 4 && box.maxY <= vy + vh - 4,
            "placed label is inside the viewBox margin");
  // (3) the residual-collision report is empty
  assert.deepEqual(s.collisions(), [], "no residual collisions after placement");
});

/* ---- deco does not become an obstacle ---- */
test("Scene: deco draws (shadow/nucleus ring/flow) do NOT register obstacles", () => {
  const s = Scene({ viewBox: "0 0 200 200", padding: 2, margin: 4, labelSize: 10 });
  s.shadow(50, 50, 30, 15);
  s.nucleus(50, 50, 0, 30, 15);
  s.flow([[0, 0, 0], [40, 40, 0]]);
  assert.equal(s.obstacles().length, 0, "no obstacle registered by pure deco");
});
