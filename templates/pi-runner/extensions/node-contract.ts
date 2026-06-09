/**
 * node-contract — GENERIC pi extension for the pi-runner harness. Copy this file verbatim; it takes
 * NO repo-specific edits (it is configured per node via env the driver sets). Loaded with `-e`
 * (explicit -e still loads under --no-extensions), opt-in via PI_RUNNER_CONTRACT_EXT.
 *
 * It gives the headless `-p` driver two things a plain stdout-scrape cannot:
 *
 *   1. submit_result — a TYPED, terminating return tool. The node ENDS by CALLING it; pi validates
 *      the args against the schema, so the cheap model can't botch a ```json fence (the single most-
 *      patched surface in run.mjs: 98fcdd3 → 89fe3ac). The structured `details` reach the driver on
 *      the `tool_execution_end` json event; `terminate:true` saves the extra follow-up LLM turn.
 *      The driver still keeps its fenced-JSON parser as a fallback, so this is strictly non-breaking.
 *
 *   2. owned-paths block — a `tool_call` hook that BLOCKS any write/edit landing outside this node's
 *      lane (PI_NODE_OWNS = space-separated globs the driver derives from the node's DRIVER-OWNS
 *      marker). In-loop PREVENTION with immediate model feedback, vs the driver's post-hoc, self-
 *      reported owns check. This closes the cross-contamination class (a node writing a SIBLING
 *      lesson's file) at the moment of the write. Best-effort: it gates `write`/`edit` (whose target
 *      is `input.path`); a shell redirect inside `bash` can still bypass it, so the driver's post-hoc
 *      check + worktree-per-run remain the backstop for bash writes.
 *
 * Resolution note: pi's extension loader BUNDLES `typebox` and `@earendil-works/pi-coding-agent`
 * (dist/core/extensions/loader.js), so these imports resolve even though this file lives outside
 * pi's node_modules. (The existing providers/coding-plan.ts proves the -e load path.)
 */
import path from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const submitResult = defineTool({
  name: "submit_result",
  label: "Submit node result",
  description:
    "Return this node's FINAL structured result. Call this as your LAST action, after writing every " +
    "required output file AND the _logs entry. Do not emit another message after calling it.",
  promptSnippet: "End the node by calling submit_result with the structured outcome (do not also print a JSON block).",
  promptGuidelines: [
    "Call submit_result exactly once, as the final action, after all output files exist on disk.",
    "status='ok' ONLY if every required artifact was written; otherwise 'gap' or 'blocked' with the reason in summary.",
    "outputArtifacts = the repo-relative paths you actually wrote.",
  ],
  parameters: Type.Object({
    node: Type.String({ description: "this node's label" }),
    status: Type.Union([Type.Literal("ok"), Type.Literal("gap"), Type.Literal("blocked")], {
      description: "node outcome — ok only if every required artifact is on disk",
    }),
    outputArtifacts: Type.Array(Type.String(), { description: "repo-relative paths you wrote", default: [] }),
    summary: Type.String({ description: "1-2 sentence outcome" }),
    issues: Type.Array(Type.String(), { description: "problems encountered", default: [] }),
    pipelineFindings: Type.Array(Type.String(), { description: "workflow-improvement findings", default: [] }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `submitted: ${params.node} → ${params.status}` }],
      details: params,
      terminate: true,
    };
  },
});

function withinOwned(absTarget: string, globs: string[]): boolean {
  return globs.some((g) => {
    if (/\/\*\*?$/.test(g)) {
      const base = g.replace(/\/\*\*?$/, "");
      return absTarget === base || absTarget.startsWith(base + "/");
    }
    return absTarget === g || absTarget.startsWith(g.replace(/\/$/, "") + "/");
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(submitResult);

  // Owned-paths in-loop block — active only when the driver set PI_NODE_OWNS for this node.
  const owns = (process.env.PI_NODE_OWNS || "").split(/\s+/).filter(Boolean);
  if (owns.length) {
    pi.on("tool_call", async (event, _ctx) => {
      if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
      const raw = (event.input as { path?: string })?.path;
      if (!raw) return undefined;
      // pi runs with cwd = the driver's RUN_CWD; resolve a relative target the same way the driver does.
      const absTarget = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
      if (!withinOwned(absTarget, owns)) {
        return { block: true, reason: `path "${raw}" is outside this node's owned lane (DRIVER-OWNS: ${owns.join(" ")})` };
      }
      return undefined;
    });
  }
}
