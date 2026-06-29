// `piflowctl model` — the NON-interactive tier config command (agent/skill/CI-safe; the skill does the
// asking, this just mutates + prints). The load-bearing logic is the PURE `applyModelCommand(current, argv)
// → { next, output }`: no fs, exhaustively testable. The read/write/print is a thin wrapper around it.
//
// Behaviors pinned here (the §c block):
//   • `set <tier> <model>` → tiers[tier]=model AND active flips TRUE (set is the activating action).
//   • `list` (and bare) → renders the current tiers + active + how-to-set, without mutating.
//   • a NON-canonical tier name → WARNS (free product names are allowed) but does NOT throw and still sets.
//   • `activate` / `deactivate` → flip active, leaving the tier map intact.
// The test-the-test mutation target: `set` MUST set active:true (a writer that left active:false would
// route nothing) — flipping that in the impl reddens 'set activates'.

import { describe, it, expect } from 'vitest';
import { applyModelCommand } from '../src/model.js';
import type { ModelTiers } from '@piflow/core';

const EMPTY: ModelTiers = { active: false, tiers: { fast: '', balanced: '', deep: '' } };

describe('applyModelCommand — set', () => {
  it('set <tier> <model> sets the tier AND activates (active:true)', () => {
    const { next } = applyModelCommand(EMPTY, ['set', 'deep', 'claude-opus-4-8']);
    expect(next.tiers.deep).toBe('claude-opus-4-8');
    expect(next.active).toBe(true); // set is the ACTIVATING action — proves the runner will resolve the tier.
  });

  it('set preserves the OTHER tiers (only the named key changes)', () => {
    const current: ModelTiers = { active: false, tiers: { fast: 'keep-fast', balanced: 'keep-mid', deep: '' } };
    const { next } = applyModelCommand(current, ['set', 'deep', 'new-deep']);
    expect(next.tiers).toEqual({ fast: 'keep-fast', balanced: 'keep-mid', deep: 'new-deep' });
  });

  it('a NON-canonical tier name WARNS (free product name) but does NOT throw and still sets it', () => {
    let result!: ReturnType<typeof applyModelCommand>;
    // The whole point: free product names are ALLOWED — no throw.
    expect(() => {
      result = applyModelCommand(EMPTY, ['set', 'turbo', 'some-model']);
    }).not.toThrow();
    expect(result.next.tiers.turbo).toBe('some-model'); // it WAS set despite being non-canonical.
    expect(result.output.toLowerCase()).toContain('warn'); // and it warned.
  });

  it('set with a missing arg is an error in output, not a throw, and does not mutate', () => {
    let result!: ReturnType<typeof applyModelCommand>;
    expect(() => {
      result = applyModelCommand(EMPTY, ['set', 'deep']); // no model id
    }).not.toThrow();
    expect(result.next).toEqual(EMPTY); // unchanged
    expect(result.output.toLowerCase()).toMatch(/usage|error|require/);
  });
});

describe('applyModelCommand — list', () => {
  it('list renders the current tiers, the active flag, and how to set — without mutating', () => {
    const current: ModelTiers = { active: true, tiers: { fast: 'f', balanced: 'b', deep: 'd' } };
    const { next, output } = applyModelCommand(current, ['list']);
    expect(next).toEqual(current); // list never mutates.
    expect(output).toContain('deep'); // shows a tier key
    expect(output).toContain('d'); // and its model id
    expect(output.toLowerCase()).toContain('active'); // shows the active state
    expect(output.toLowerCase()).toContain('set'); // tells the user how to set
  });

  it('a BARE invocation (no subcommand) behaves like list', () => {
    const current: ModelTiers = { active: false, tiers: { fast: '', balanced: '', deep: '' } };
    const { next, output } = applyModelCommand(current, []);
    expect(next).toEqual(current);
    expect(output.toLowerCase()).toContain('fast'); // the canonical keys are listed
  });
});

describe('applyModelCommand — activate / deactivate', () => {
  it('activate flips active true, leaving the tier map intact', () => {
    const current: ModelTiers = { active: false, tiers: { fast: 'f', balanced: 'b', deep: 'd' } };
    const { next } = applyModelCommand(current, ['activate']);
    expect(next.active).toBe(true);
    expect(next.tiers).toEqual(current.tiers);
  });

  it('deactivate flips active false, leaving the tier map intact', () => {
    const current: ModelTiers = { active: true, tiers: { fast: 'f', balanced: 'b', deep: 'd' } };
    const { next } = applyModelCommand(current, ['deactivate']);
    expect(next.active).toBe(false);
    expect(next.tiers).toEqual(current.tiers);
  });
});
