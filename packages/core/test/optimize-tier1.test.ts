// Contract for optimize/tier1.ts — project a verify-milestone report → Tier1Result. Bound to the REAL
// committed reports (M3 = the rich six-gate shape; M2 = a degraded "self-fix exhausted" re-run) plus
// synthetic ABSTAIN cases. The load-bearing rule: ABSTAIN (measure-could-not-run) ≠ low score.
//
// Run: npx vitest run packages/core/test/optimize-tier1.test.ts

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVerifyReport } from '../src/optimize/tier1.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const report = (m: string) =>
  JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'optimize', 'gs01', 'verify', `report.${m}.json`), 'utf8'));

describe('readVerifyReport — the rich six-gate report (M3)', () => {
  const r = readVerifyReport(report('M3'), { reportPath: '/x/report.M3.json' });

  it('reads the verdict + provenance, and does NOT abstain (it measured)', () => {
    expect(r.milestoneId).toBe('M3');
    expect(r.marker).toBe('VALIDATION_FAILED');
    expect(r.passed).toBe(false);
    expect(r.abstained).toBe(false);
    expect(r.reportPath).toBe('/x/report.M3.json');
  });

  it('flattens the four gate arrays into checks (no double-counting the legacy assertions[])', () => {
    const byGate = (g: string) => r.checks.filter((c) => c.gate === g);
    expect(byGate('fidelity')).toHaveLength(4);
    expect(byGate('fidelity').every((c) => !c.passed)).toBe(true);
    expect(byGate('invariant')).toHaveLength(5);
    expect(byGate('invariant').every((c) => c.passed)).toBe(true);
    expect(byGate('completability')).toHaveLength(1);
    expect(byGate('completability')[0].passed).toBe(false);
    expect(byGate('perturbation')).toHaveLength(1);
    expect(byGate('perturbation')[0].passed).toBe(true); // perturbation.invariant === true
    expect(r.checks).toHaveLength(11); // 4+1+5+1, NOT 15 (the 4 legacy assertions[] are not re-counted)
  });

  it('carries a specific fidelity check through by id', () => {
    const a1 = r.checks.find((c) => c.id === 'M3-A1');
    expect(a1).toBeDefined();
    expect(a1!.gate).toBe('fidelity');
    expect(a1!.passed).toBe(false);
  });

  it('scalar = passed/total over checks that ran (6/11)', () => {
    expect(r.scalar).toBeCloseTo(6 / 11, 5);
  });

  it('captures the runtime consoleErrors (the masking TypeError) so the fixer can SEE the crash', () => {
    // M3 fails because an uncaught `TypeError ...'entries'` wedges the update loop, masking 4 fidelity +
    // completability. That signal lives ONLY in consoleErrors — the per-check arrays never name it — so the
    // reader must carry it through, or the fixer is sent in blind (the cause of 7 identical 0.5455 candidates).
    expect(r.consoleErrors).toBeDefined();
    expect(r.consoleErrors).toHaveLength(1);
    expect(r.consoleErrors!.join(' ')).toContain("Cannot read properties of undefined (reading 'entries')");
  });
});

describe('readVerifyReport — consoleErrors hygiene', () => {
  const base = { milestoneId: 'M9', marker: 'VALIDATION_FAILED', passed: false };

  it('omits consoleErrors entirely when the report has none (no empty-array noise in evidence)', () => {
    expect('consoleErrors' in readVerifyReport(base)).toBe(false);
  });

  it('drops non-string entries defensively (a malformed field never throws)', () => {
    const r = readVerifyReport({ ...base, consoleErrors: ['real error', 42, null, { x: 1 }] });
    expect(r.consoleErrors).toEqual(['real error']);
  });
});

describe('readVerifyReport — the degraded report (M2: self-fix exhausted, no per-check arrays)', () => {
  const r = readVerifyReport(report('M2'));

  it('is a real fail (not abstain) with no checks and a zero scalar', () => {
    expect(r.passed).toBe(false);
    expect(r.marker).toBe('VALIDATION_FAILED');
    expect(r.abstained).toBe(false); // it MEASURED and failed — this is not "could not run"
    expect(r.checks).toHaveLength(0);
    expect(r.scalar).toBe(0);
  });
});

describe('readVerifyReport — ABSTAIN re-tagging (measure-could-not-run ≠ low score)', () => {
  const base = { milestoneId: 'M9', marker: 'VALIDATION_FAILED', passed: false };

  it('boot failure abstains', () => {
    expect(readVerifyReport({ ...base, bootFailed: true }).abstained).toBe(true);
  });

  it('perturbation incomplete (declaredRanges absent → ran:false) abstains', () => {
    expect(readVerifyReport({ ...base, perturbation: { ran: false, invariant: false } }).abstained).toBe(true);
  });

  it('design escalation abstains', () => {
    expect(readVerifyReport({ ...base, escalation: { kind: 'design-defect' } }).abstained).toBe(true);
  });

  it('a genuine pass does not abstain and scores 1', () => {
    const r = readVerifyReport({
      milestoneId: 'M1', marker: 'VALIDATION_PASSED', passed: true,
      fidelity: [{ id: 'M1-A1', status: 'pass' }, { id: 'M1-A2', status: 'pass' }],
    });
    expect(r.abstained).toBe(false);
    expect(r.passed).toBe(true);
    expect(r.scalar).toBe(1);
  });
});
