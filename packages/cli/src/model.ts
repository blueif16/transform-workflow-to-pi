// `piflowctl model` — set / inspect the model-TIER config (`~/.piflow/model-tiers.json`) NON-interactively.
//
// This is the agent/skill/CI-safe write side of `@piflow/core`'s tier routing: NO blocking prompts (the
// SKILL does the asking, then calls these). The tier file is the SAME `{active, tiers}` shape the runner
// reads via `loadModelTiers` — so what this command writes, `resolveNodeModel` resolves (model > tier (if
// active) > run --model > pi default; model-routing.ts §2).
//
//   piflowctl model            → list (current tiers + active + the canonical keys + how to set)
//   piflowctl model list       → same
//   piflowctl model set <tier> <modelId>  → tiers[tier]=modelId, active:true, written atomically
//   piflowctl model activate / deactivate → flip active (the tier map is untouched)
//
// The MUTATION + arg-parse is the PURE `applyModelCommand(current, argv) → { next, output }` (no fs — unit-
// testable). The thin `runModelCli` wrapper is the only fs: read the file via `loadModelTiers`, apply, write
// the next state via `writeModelTiers`, print the output. A non-canonical tier name WARNS (free product
// names are allowed — model-routing.ts: keys are whatever the product chose) but never hard-fails.

import {
  loadModelTiers,
  writeModelTiers,
  homeTiersFile,
  CANONICAL_TIERS,
  type ModelTiers,
} from '@piflow/core';

/** The pure result of one `model` invocation: the next tier state to persist + the text to print. */
export interface ModelCommandResult {
  /** The tier config AFTER the command (the wrapper persists this; for `list` it equals `current`). */
  next: ModelTiers;
  /** The human/agent-facing text the wrapper prints (a list render, a confirmation, a warning, an error). */
  output: string;
}

/** Render the current tier config: each canonical key (+ any extra product keys), active, and how to set. */
function renderList(t: ModelTiers): string {
  const keys = [...new Set([...CANONICAL_TIERS, ...Object.keys(t.tiers)])];
  const rows = keys
    .map((k) => {
      const v = t.tiers[k];
      const canonical = (CANONICAL_TIERS as readonly string[]).includes(k);
      return `  ${k.padEnd(10)} ${v ? v : '(unset)'}${canonical ? '' : '  [custom]'}`;
    })
    .join('\n');
  // The PARALLEL claude-code tier map (the `--claude` set target) — shown only when configured.
  const claudeRows = t.claude
    ? '\nclaude-code tiers (executor: claude-code)\n' +
      Object.entries(t.claude)
        .map(([k, v]) => `  ${k.padEnd(10)} ${v || '(unset)'}`)
        .join('\n')
    : '';
  return [
    `model tiers (${homeTiersFile()})`,
    `  active: ${t.active}${t.active ? '' : '  — tier references will NOT resolve until active'}`,
    rows + claudeRows,
    `set a model:  piflowctl model set <tier> <modelId> [--claude]   (canonical tiers: ${CANONICAL_TIERS.join(' | ')})`,
    `then enable:  piflowctl model activate`,
  ].join('\n');
}

/**
 * Apply ONE `model` subcommand to the current tier config. PURE — no fs, no process exit. The thin CLI
 * wrapper handles the read/write/print around this. Unknown/missing args produce an `output` describing the
 * error and leave `next` unchanged (never throws — agent/CI safe).
 */
export function applyModelCommand(current: ModelTiers, argv: string[]): ModelCommandResult {
  // Defensive clone so a caller's `current` is never mutated in place (pure-function contract). Preserve the
  // optional `claude` tier block — this command mutates only the `pi` map, and dropping `claude` on every
  // write would silently erase the user's claude-code tier mappings (model-routing.ts ModelTiers.claude).
  const clone = (): ModelTiers => ({
    active: current.active,
    tiers: { ...current.tiers },
    ...(current.claude ? { claude: { ...current.claude } } : {}),
  });
  const [sub, ...rest] = argv;

  switch (sub) {
    case undefined:
    case 'list':
      return { next: current, output: renderList(current) };

    case 'set': {
      // `--claude` (position-free) targets the PARALLEL `claude` tier map (the claude-code executor reads it
      // via resolveClaudeModel). It is gated by the SAME `active` flag, so it activates exactly like the pi set.
      const claude = rest.includes('--claude');
      const [tier, modelId] = rest.filter((a) => a !== '--claude');
      if (!tier || !modelId) {
        return {
          next: current,
          output: `error: usage — piflowctl model set <tier> <modelId> [--claude] (required: a tier name and a model id)`,
        };
      }
      const next = clone();
      if (claude) (next.claude ??= {})[tier] = modelId;
      else next.tiers[tier] = modelId;
      next.active = true; // `set` is the ACTIVATING action — so the runner resolves the tier immediately.
      const canonical = (CANONICAL_TIERS as readonly string[]).includes(tier);
      const warn = canonical
        ? ''
        : `warning: "${tier}" is not a canonical tier (${CANONICAL_TIERS.join(' | ')}); set anyway (free product name).\n`;
      return {
        next,
        output: `${warn}set ${claude ? 'claude ' : ''}tier "${tier}" = ${modelId} (active: true)`,
      };
    }

    case 'activate': {
      const next = clone();
      next.active = true;
      return { next, output: `model tiers active: true` };
    }

    case 'deactivate': {
      const next = clone();
      next.active = false;
      return { next, output: `model tiers active: false` };
    }

    default:
      return {
        next: current,
        output: `error: unknown 'model' subcommand '${sub}'. Use: list | set <tier> <modelId> | activate | deactivate`,
      };
  }
}

/** `piflowctl model [...]` — the thin fs/print wrapper around the pure `applyModelCommand`. */
export async function runModelCli(argv: string[]): Promise<void> {
  const file = homeTiersFile();
  const current = loadModelTiers(file);
  const { next, output } = applyModelCommand(current, argv);
  // Persist only when the state actually changed (list/no-op never writes).
  if (next !== current) writeModelTiers(next, file);
  process.stdout.write(output + '\n');
  // A usage/unknown error → non-zero exit (CI signal); a successful list/set/activate → 0.
  if (output.startsWith('error:')) process.exitCode = 1;
}
