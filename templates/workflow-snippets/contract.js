// ── OUTPUT CONTRACT helper — paste into your .claude/workflows/<name>.js next to discipline() ──
//
// The 4th contract layer Claude Code leaves to the orchestrator. Native Claude gives a skill
// `description` (requirements), `## Inputs`/`## Output` prose (I/O), and a return `schema` (the
// RETURN shape, validated + retried) — but it verifies the model's MESSAGE, never the FILESYSTEM.
// So each producing node declares, as DATA, the files it MUST leave on disk + the only paths it may
// write. This renders BOTH the forceful Definition-of-Done prose AND the DRIVER-ARTIFACTS /
// DRIVER-OWNS markers the generic pi driver (run.mjs) parses and verifies independent of the
// self-report — a clean exit missing a required artifact is `blocked`, not `ok`.
//
// REQUIREMENT: emit ABSOLUTE paths. `REPO` is your project's absolute package dir (the same constant
// your node prompts already use to address files). `owns` defaults to `artifacts`; a trailing /* or
// /** marks a directory the node owns; `note` is an optional extra owned-path caveat.
//
// Full spec: reference/artifact-contract.md.
function contract({ artifacts = [], owns = [], note = '' }) {
  const abs = (p) => `${REPO}/${p}`
  return [
    'OUTPUT CONTRACT — you are DONE only when EVERY file below exists and is non-empty at EXACTLY its path. Write NOTHING outside the owned paths (never another run\'s files). If you cannot produce them, set status="blocked" and say why — do NOT exit clean (an empty or wrong-path artifact set is a FAILURE, not an ok).',
    `DRIVER-ARTIFACTS: ${artifacts.map(abs).join(' ')}`,
    `DRIVER-OWNS: ${(owns.length ? owns : artifacts).map(abs).join(' ')}`,
    note ? `OWNED-PATH NOTE: ${note}` : '',
  ].filter(Boolean).join('\n')
}

// Usage in a node prompt array, alongside discipline():
//   const r = await agent([
//     discipline(),
//     'W0 — DO THE THING …',
//     `INPUT: ${REPO}/${P.input}.`,
//     contract({ artifacts: [P.output], note: 'lesson-agnostic; touches no shared code.' }),
//   ].join('\n'), { schema: NODE_RESULT })
