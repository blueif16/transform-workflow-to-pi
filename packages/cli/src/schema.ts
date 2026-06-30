// `piflowctl schema [node|meta|workflow]` — make the SDK self-describing. An authoring agent (Claude
// Code in any repo) can print the full node-authoring JSON Schema (draft 2020-12, with rich per-field
// descriptions) on demand, instead of relying only on a prose skill. This is the machine-readable
// AUTHORING CONTRACT agents target when emitting node.json / meta.json / workflow.json.
//
// THE ANTI-DRIFT LAW (the entire point of this command): it prints the schema objects IMPORTED FROM
// @piflow/core — NEVER a hand-copied or duplicated schema. Because it re-exports the SDK's own frozen
// schema objects, the command is STRUCTURALLY INCAPABLE of drifting from the SDK: change the schema in
// core and this command's output changes with it, by construction. There is no schema logic here — only
// import-and-print.

import { nodeSchema, metaSchema, workflowSchema } from '@piflow/core';

/** The valid selectors → the SDK's own schema object. DEFAULT is `node` (the authoring schema agents need most). */
const SCHEMAS = {
  node: nodeSchema,
  meta: metaSchema,
  workflow: workflowSchema,
} as const;

type Selector = keyof typeof SCHEMAS;

/**
 * `piflowctl schema [node|meta|workflow]` — pretty-print the chosen SDK schema as JSON (2-space).
 * Sync; writes to process.stdout. DEFAULT selector: `node`. An unknown selector → a clear stderr error
 * + non-zero exit, listing the valid selectors.
 */
export function runSchemaCli(argv: string[]): void {
  const selector = argv.find((a) => !a.startsWith('-')) ?? 'node';
  const valid = Object.keys(SCHEMAS).join(' | ');
  if (!(selector in SCHEMAS)) {
    process.stderr.write(
      `piflowctl schema: unknown selector '${selector}' (valid: ${valid})\n`,
    );
    process.exitCode = 1;
    return;
  }
  // Print the SDK's OWN schema object — never a copy (see the anti-drift law above).
  process.stdout.write(`${JSON.stringify(SCHEMAS[selector as Selector], null, 2)}\n`);
}
