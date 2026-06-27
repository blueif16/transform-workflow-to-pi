/**
 * SegmentSplit — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/SegmentSplit.ts):
 *   - segment.split   drivenBy "a shot hits a mid-body segment (an index that is neither head nor tail)"
 *                     expect   "the chain cleaves into two independently-tracked chains (a new rear
 *                               chain id appears, the live chain count grows); segment.split logged"
 *   - mushroom.grown  drivenBy "a segment is destroyed (any index hit)"
 *                     expect   "a mushroom obstacle appears at that cell in __GAME__.entities (the
 *                               mushroom count grows); mushroom.grown logged"
 *
 * REAL drive through the REAL seam: the system spawns segmented chains as .__segment enemies into
 * scene.enemies and wires its OWN player-bullet↔segment overlap in setupCollisions() (mirroring
 * ProjectilePool). We drive that exact verb: with speed:0 the chain is static (deterministic), so
 * we read a live MID-BODY segment's position, land ONE real player-bullet hit on it, and STEP —
 * the overlap routes onSegmentHit → the segment dies (a mushroom grows at its cell: mushroom.grown)
 * AND the chain cleaves (a new rear chain id appears, the live chain count grows: segment.split).
 * A HEAD hit (index 0) is the COUNTERFACTUAL for split: it grows a mushroom but does NOT split
 * (the chain only shortens) — proving segment.split is specific to a mid-body hit.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/SegmentSplit.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Land EXACTLY ONE player-bullet hit ON (x,y): the real bullet↔segment overlap, fired once. */
const oneHit = (world, scene, x, y) => {
  const b = scene.physics.add.sprite(x, y, '__px');
  b.setDisplaySize(6, 16);
  b.body.setAllowGravity(false);
  b.__type = 'projectile';
  b.setActive(true);
  b.setVisible(true);
  scene.playerBullets.add(b);
  world.step(1);
  b.setActive(false);
  if (b.body) b.body.enable = false;
  b.destroy();
};
const liveMushrooms = (scene) =>
  (scene.obstacles?.getChildren?.() ?? []).filter((c) => c?.active !== false && c.__mushroom).length;

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a mid-body hit cleaves the chain (segment.split) + grows a mushroom.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;

  // One static (speed 0 → deterministic) chain of 9 segments, head-led front→rear.
  const seg = world.mountSystem('SegmentSplit', { chains: 1, segments: 9, cellPx: 24, speed: 0, originX: 120, originY: 200 });
  check('resolveSystem returned a real SegmentSplit', seg.constructor.name === 'SegmentSplit', seg.constructor.name);
  check('attach published the scene.__segmentSplit seam', scene.__segmentSplit === seg, `seam=${scene.__segmentSplit?.constructor?.name}`);
  check('precondition: one tracked chain, no mushrooms yet', seg.chainCountLive() === 1 && seg.mushroomCount() === 0, `chains=${seg.chainCountLive()} mush=${seg.mushroomCount()}`);

  // Pick a real MID-BODY segment (index 4 of 9 — neither head nor tail) from scene.enemies.
  const segments = scene.enemies.getChildren().filter((e) => e.__segment && e.active !== false);
  check('precondition: nine real segments in scene.enemies', segments.length === 9, `n=${segments.length}`);
  // front→rear order is head (highest x) to tail (lowest x) — sort by x descending.
  segments.sort((a, b) => b.x - a.x);
  const mid = segments[4];
  const chainsBefore = seg.chainCountLive();
  const mushBefore = seg.mushroomCount();

  // DRIVE: one real player-bullet hit on the mid-body segment.
  let cur = bus.cursor;
  oneHit(world, scene, mid.x, mid.y);
  const split = bus.recent(cur).filter((e) => e.type === 'segment.split');
  const grown = bus.recent(cur).filter((e) => e.type === 'mushroom.grown');
  check('SPLIT: the chain cleaved — the live chain count grew', seg.chainCountLive() === chainsBefore + 1, `before=${chainsBefore} after=${seg.chainCountLive()}`);
  check('SPLIT: segment.split logged {chainId,newChainId,index}', split.length === 1 && typeof split.at(-1)?.payload?.newChainId === 'string' && split.at(-1)?.payload?.index === 4, JSON.stringify(split.at(-1)?.payload));
  check('GROW: a mushroom grew at the destroyed segment cell (count +1)', seg.mushroomCount() === mushBefore + 1, `before=${mushBefore} after=${seg.mushroomCount()}`);
  check('GROW: the mushroom surfaced as an obstacle in __GAME__.entities', liveMushrooms(scene) >= 1, `mush obstacles=${liveMushrooms(scene)}`);
  check('GROW: mushroom.grown logged {id,col,row}', grown.length === 1 && /^mush_/.test(grown.at(-1)?.payload?.id ?? ''), JSON.stringify(grown.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a HEAD hit (index 0) grows a mushroom but
// does NOT split — the chain only SHORTENS, so segment.split must NOT fire. If
// onSegmentHit()'s mid-body cleave fired on any hit, the SPLIT assertion would not
// prove the event is specific to a mid-body index.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const seg = world.mountSystem('SegmentSplit', { chains: 1, segments: 9, cellPx: 24, speed: 0, originX: 120, originY: 200 });
  const segments = scene.enemies.getChildren().filter((e) => e.__segment && e.active !== false);
  segments.sort((a, b) => b.x - a.x);
  const head = segments[0]; // index 0 — the head
  const chainsBefore = seg.chainCountLive();
  const mushBefore = seg.mushroomCount();

  const cur = bus.cursor;
  oneHit(world, scene, head.x, head.y);
  const split = bus.recent(cur).filter((e) => e.type === 'segment.split');
  const grown = bus.recent(cur).filter((e) => e.type === 'mushroom.grown');
  check('counterfactual: a head hit grew a mushroom (any destroyed segment does)', seg.mushroomCount() === mushBefore + 1 && grown.length === 1, `mush=${seg.mushroomCount()} grown=${grown.length}`);
  check('counterfactual: a head hit did NOT split (no new chain, no segment.split)', seg.chainCountLive() === chainsBefore && split.length === 0, `chains=${seg.chainCountLive()} split=${split.length}`);

  world.destroy();
}

console.log(`\n[oracle] SegmentSplit ok — ${passed} assertions: segment.split (real mid-body bullet hit cleaves the chain → live chain count +1) + mushroom.grown (the destroyed cell grows a mushroom obstacle); counterfactual (head hit grows-but-does-not-split) holds.`);
process.exit(0);
