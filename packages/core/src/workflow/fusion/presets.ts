// (Phase 2) The fusion ROLES as G6 agent PRESETS — so a fusion judge/obligations node is a first-class
// "preset agent" (carries `agentType` for observe → the GUI icon), exactly like an authored preset node.
//
// These are the fusion MECHANISM's BUILT-IN presets (its canonical defaults), the analogue of the codec's
// DRIVER-* marker prose that also lives in core — generic machinery, not product content. `expandFusion`
// stamps the judge/obligations node with the preset id and fills the preset's prompt body (the verbatim
// Appendix-A template) with the per-node task/partials. A user catalog file `~/.piflow/agents/<id>.md`
// may later OVERRIDE one by id (the read-only `loadAgentPreset` seam) — these are just the always-present
// fallback so fusion works with no catalog at all.
//
// NOTE: a fusion judge prompt is token-FILLED ({{ORIGINAL_TASK}}/{{PARTIAL_FILES}}/{{OBLIGATIONS}}), not
// `mergePreset`-prepended — so `expandFusion` consumes `preset.prompt` directly, it does NOT call
// `mergePreset` (whose role-then-task concatenation is for AUTHORED nodes adopting a preset).

import type { AgentPreset } from '../agent-preset.js';
import { JUDGE_MOA, JUDGE_BEST_OF_N, OBLIGATIONS_PLANNER } from './prompts.js';

/** Preset ids — the `agentType` a fusion node carries (the GUI keys its icon off these). */
export const FUSION_JUDGE_MOA = 'fusion-judge-moa';
export const FUSION_JUDGE_BEST_OF_N = 'fusion-judge-best-of-n';
export const FUSION_OBLIGATIONS = 'fusion-obligations';

/** The built-in fusion preset agents, by id. `expandFusion` resolves the judge/obligations role from here. */
export const FUSION_PRESETS: Record<string, AgentPreset> = {
  [FUSION_JUDGE_MOA]: {
    id: FUSION_JUDGE_MOA,
    display: { label: 'Fusion Judge · MoA', icon: 'scale', color: '#7c3aed' },
    prompt: JUDGE_MOA,
  },
  [FUSION_JUDGE_BEST_OF_N]: {
    id: FUSION_JUDGE_BEST_OF_N,
    display: { label: 'Fusion Judge · best-of-N', icon: 'scale', color: '#7c3aed' },
    prompt: JUDGE_BEST_OF_N,
  },
  [FUSION_OBLIGATIONS]: {
    id: FUSION_OBLIGATIONS,
    display: { label: 'Obligations Planner', icon: 'checklist', color: '#0891b2' },
    prompt: OBLIGATIONS_PLANNER,
  },
};

/** The judge preset id for a mode. */
export function judgePresetId(mode: 'moa' | 'best-of-n'): string {
  return mode === 'moa' ? FUSION_JUDGE_MOA : FUSION_JUDGE_BEST_OF_N;
}
