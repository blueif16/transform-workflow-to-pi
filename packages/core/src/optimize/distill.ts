// optimize/distill.ts — the DISTILLATION SEAM of MEMORIZE (piflow-memory-v1.5 §6; memory-slices MODE B, the law
// "deterministic-first; the model only distills"). MEMORIZE (memorize.ts) COUNTS recurrence deterministically and
// APPENDs a lesson block whose Root/Prevention are honest `(pending — …)` placeholders. This module fills those
// placeholders with REAL prose — the same shape as compact.ts: the WRITE is deterministic and lives in core; the
// model call is INJECTED (like the fixer), so core holds NO model call, NO network, NO prompt.
//
// Two halves:
//   • fillLessonProse — DETERMINISTIC writer. Locate the lesson block whose `sig:` matches, REPLACE only the
//     provided `**Root:**`/`**Prevention:**` line(s) IN PLACE, preserve `sig:`/`recurrence:`/`[[okf]]` + all else.
//     Idempotent (re-fill overwrites the same line, never appends a duplicate). Missing file/sig ⇒ silent no-op.
//     Rides the SAME block-boundary rule the reader (recurrence.ts splitBlocks) + writer (memorize.ts) share, so
//     what it writes is exactly what `deriveRecurrence` reads back (the round-trip oracle).
//   • distillLesson — async orchestrator. Calls the INJECTED distiller (the model call), then fillLessonProse.
//     DEGRADES gracefully: a distiller that throws, or returns empty/whitespace root+prevention, leaves the
//     placeholders intact and returns 'skipped' — MEMORIZE must never crash on a bad distiller.

import { readFileSync, writeFileSync } from 'node:fs';
import type { Defect } from './types.js';

/** The prose fields a distiller yields (or a caller hands to fillLessonProse). Only the provided fields are written. */
export interface LessonProse {
  /** the distilled root-cause line (replaces `**Root:** (pending …)`). Omit/blank ⇒ leave that line untouched. */
  root?: string;
  /** the durable prevention rule (replaces `**Prevention:** (pending …)`). Omit/blank ⇒ leave that line untouched. */
  prevention?: string;
}

/**
 * The INJECTED distiller — the model call that turns a confirmed defect (+ the fixer's traced root, when it landed
 * one) into the lesson's Root/Prevention prose. It is ALWAYS injected (core contains no model/network/prompt); the
 * CLI seam wires the real `claude -p` call, tests inject a plain async fn returning canned prose. The distiller
 * OWNS the form-to-failure-type match (positive recipe for SKILL vs prohibition for a discipline lapse — see
 * agentic-prompt-design §0b + memory-slices MODE B); core stays the mechanical write.
 */
export type LessonDistiller = (input: {
  /** the confirmed defect being memorized (its bucket/symptom/evidence shape the prose form). */
  defect: Defect;
  /** the fixer's traced root cause, when the fix landed one — the raw material the distiller condenses. */
  foundRoot?: string;
}) => Promise<LessonProse>;

/** Options for {@link distillLesson}. */
export interface DistillLessonOpts {
  /** the fixer's traced root cause to pass through to the distiller (when the fix landed one). */
  foundRoot?: string;
}

const ROOT_MARKER = '**Root:**';
const PREVENTION_MARKER = '**Prevention:**';

/**
 * Fill a lesson block's Root/Prevention prose IN PLACE. Locate the block whose `sig:` equals `sig`, then replace
 * only the provided `**Root:**`/`**Prevention:**` line(s) with the given text — preserving `sig:`/`recurrence:`/
 * `[[okf]]` and every other line. Idempotent (re-filling overwrites the same line). A missing/unreadable file, an
 * absent sig, or an all-blank input is a silent no-op (never throws; never writes). After a fill, `deriveRecurrence`
 * reads back the new `lesson.root`/`lesson.prevention`.
 */
export function fillLessonProse(file: string, sig: string, prose: LessonProse): void {
  const root = clean(prose.root);
  const prevention = clean(prose.prevention);
  if (!root && !prevention) return; // nothing provided ⇒ leave the placeholders (no write)

  let body: string;
  try {
    body = readFileSync(file, 'utf8');
  } catch {
    return; // no file ⇒ nothing to fill (never throw)
  }

  const lines = body.split('\n');
  const block = findBlockBySig(lines, sig);
  if (!block) return; // absent sig ⇒ leave the file untouched

  let changed = false;
  if (root) changed = replaceMarker(lines, block, ROOT_MARKER, root) || changed;
  if (prevention) changed = replaceMarker(lines, block, PREVENTION_MARKER, prevention) || changed;
  if (!changed) return; // no marker line present to replace ⇒ don't rewrite

  writeFileSync(file, lines.join('\n'), 'utf8');
}

/**
 * Distill + fill: call the INJECTED distiller for this defect, then {@link fillLessonProse}. Returns 'filled' when
 * prose was written, 'skipped' when the distiller threw or returned empty/whitespace root+prevention — in which
 * case the block's placeholders are left intact. Never throws on a bad distiller (MEMORIZE must survive one).
 */
export async function distillLesson(
  file: string,
  sig: string,
  defect: Defect,
  distiller: LessonDistiller,
  opts: DistillLessonOpts = {},
): Promise<'filled' | 'skipped'> {
  let prose: LessonProse;
  try {
    prose = await distiller({ defect, foundRoot: opts.foundRoot });
  } catch {
    return 'skipped'; // a throwing distiller degrades to a no-op — the placeholders stay honest
  }
  if (!clean(prose?.root) && !clean(prose?.prevention)) return 'skipped'; // empty return ⇒ nothing to fill

  fillLessonProse(file, sig, prose);
  return 'filled';
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────

/** Trim; treat undefined/empty/whitespace-only as "not provided" (returns '' the caller reads as falsy). */
function clean(text: string | undefined): string {
  return text?.trim() ?? '';
}

/**
 * Replace the `marker` line within the block with `marker <text>`, preserving the line's leading indentation.
 * Returns true when a line was replaced. Only the FIRST matching marker in the block is touched (the grammar has
 * one Root + one Prevention per block).
 */
function replaceMarker(
  lines: string[],
  block: { start: number; end: number },
  marker: string,
  text: string,
): boolean {
  for (let i = block.start; i < block.end; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith(marker)) {
      const indent = lines[i].slice(0, lines[i].length - trimmed.length);
      lines[i] = `${indent}${marker} ${text}`;
      return true;
    }
  }
  return false;
}

/**
 * Locate the lesson block whose `sig:` equals `sig`. A block opens at a `### ` heading and runs until the next
 * `### `/`## ` or EOF — the SAME span rule recurrence.ts splitBlocks + memorize.ts findBlockBySig use, so the span
 * we edit is the span the reader reads.
 */
function findBlockBySig(lines: string[], sig: string): { start: number; end: number } | null {
  const target = `sig: ${sig}`;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    const isH3 = t.startsWith('### ');
    const isBoundary = isH3 || t.startsWith('## ');
    if (isBoundary && start >= 0) {
      if (blockHasSig(lines, start, i, target)) return { start, end: i };
      start = isH3 ? i : -1; // a `### ` boundary reopens; a `## `/EOF closes and opens nothing
    } else if (isH3 && start < 0) {
      start = i;
    }
  }
  if (start >= 0 && blockHasSig(lines, start, lines.length, target)) return { start, end: lines.length };
  return null;
}

function blockHasSig(lines: string[], start: number, end: number, target: string): boolean {
  for (let i = start; i < end; i++) if (lines[i].trim() === target) return true;
  return false;
}
