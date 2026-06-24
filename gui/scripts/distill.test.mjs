// Test for the node event-stream reducer (gui/scripts/lib/distill.mjs).
//
// ORACLE (independent of the code under test): the OLD run-status.json recorded a per-node
// `toolBreakdown` + `toolCalls` for w2-scaffold as a SEPARATE rollup, computed by the original
// engine — NOT by this reducer. We replay the same node's raw events.jsonl through our reducer and
// assert the two independent recordings agree. If the reducer miscounts (off-by-one, wrong event
// type, dedup bug), the two diverge → RED. The expected values are read from the data, never pasted
// from our own output, so this can't be a copy-the-output tautology.
//
// Run: node gui/scripts/distill.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNodeAccumulator } from './lib/distill.mjs';

const SRC = '/Users/tk/Desktop/game-omni/out/e2e-m3';
const NODE = 'w2-scaffold';

let passed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

const status = JSON.parse(fs.readFileSync(`${SRC}/run-status.json`, 'utf8'));
const oracle = status.nodes[NODE]; // recorded by the original engine, our independent ground truth

function replay(nodeId, rec) {
  const lines = fs.readFileSync(`${SRC}/_pi/${nodeId}.events.jsonl`, 'utf8').trim().split('\n');
  const acc = createNodeAccumulator();
  for (const l of lines) { if (l) acc.push(JSON.parse(l)); }
  return acc.finalize(rec); // rec supplies on-disk artifacts so writes can be verified-not-trusted
}

const { rich } = replay(NODE, oracle);

console.log(`distill reducer — replay ${NODE}.events.jsonl vs run-status.json oracle`);

test('toolCalls matches the rollup count', () => {
  assert.equal(rich.toolCalls, oracle.toolCalls); // 35
});

test('toolBreakdown matches the rollup name→count map', () => {
  assert.deepEqual(rich.toolBreakdown, oracle.toolBreakdown); // {bash:20, read:14, edit:1}
});

test('model is recovered from the assistant message stream', () => {
  assert.equal(rich.model, 'MiniMax-M3'); // run-level .model was null; only the event stream has it
});

test('reads capture real input file paths (read/grep args.path), de-duped', () => {
  const paths = rich.reads.map((r) => r.path);
  assert.ok(paths.includes('/Users/tk/Desktop/game-omni/out/e2e-m3/spec/blueprint.json'),
    'expected the blueprint.json read');
  assert.equal(new Set(paths).size, paths.length, 'reads must be de-duplicated');
  assert.ok(rich.reads.every((r) => r.via === 'read' || r.via === 'grep'),
    'every read must carry its source tool');
});

test('writes capture edit/write targets, verified against artifacts', () => {
  const w = rich.writes.find((x) => x.path.endsWith('MEMORY.w2.md'));
  assert.ok(w, 'expected the MEMORY.w2.md edit to surface as a write');
  assert.equal(w.verified, true, 'MEMORY.w2.md is a real on-disk artifact → verified');
});

test('per-tool timeline spans are produced for every tool call', () => {
  assert.equal(rich.timeline.length, oracle.toolCalls,
    'one timeline span per tool call');
  assert.ok(rich.timeline.every((t) => typeof t.tStartMs === 'number' && typeof t.durMs === 'number'),
    'each span has a start offset and duration');
});

if (process.exitCode) console.error(`\n${passed} passed, some FAILED`);
else console.log(`\nall ${passed} passed`);
