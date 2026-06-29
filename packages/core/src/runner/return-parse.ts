// Forgiving return-parse (run.mjs lastJsonBlock 670–698) — recover a node's structured return from its
// stdout. Extracted verbatim from runner.ts (the §2.1 cluster C split); re-exported there for the barrel.

// The recovered structured return: the recognized fields PLUS any arbitrary `@return:<field>` payload a
// promote may lift (§3.6 — `lastJsonBlock` already JSON.parses the WHOLE block; we just stop narrowing it).
export type NodeReturn = { status?: string; summary?: string; issues?: string[] } & Record<string, unknown>;

/** Recover a node's return object from its stdout. Tries closed ```json, unclosed fence, last {…}. */
export function lastJsonBlock(text: string): NodeReturn | null {
  if (!text) return null;
  const tryParse = (s: string): NodeReturn | null => { try { return JSON.parse(s.trim()); } catch { return null; } };
  const fenced = /```json\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = fenced.exec(text))) last = m[1];
  if (last) { const o = tryParse(last); if (o) return o; }
  const open = text.lastIndexOf('```json');
  if (open >= 0) { const o = tryParse(text.slice(open + 7).replace(/```\s*$/, '')); if (o) return o; }
  for (let end = text.lastIndexOf('}'); end >= 0; end = text.lastIndexOf('}', end - 1)) {
    let depth = 0; let start = -1;
    for (let i = end; i >= 0; i--) {
      if (text[i] === '}') depth++;
      else if (text[i] === '{') { depth--; if (depth === 0) { start = i; break; } }
    }
    if (start < 0) break;
    const o = tryParse(text.slice(start, end + 1));
    if (o && typeof o === 'object' && ('status' in o || 'summary' in o)) return o;
  }
  return null;
}
