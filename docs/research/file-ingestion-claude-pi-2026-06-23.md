# File ingestion — Claude Code vs pi — and the piflow readScope decision (2026-06-23)

> Brief for `template-format.md` §6a (input delivery: inject vs path+tool-read). Researched via Exa + the local
> `docs/pi-agent-notes.md`. Each claim's confidence noted.

## §1 Claude Code file ingestion — INJECT contents (not path+tool-read). *Confidence: HIGH.*
When a user `@`-mentions a file, the harness **pre-reads it and injects the content into context** as a
synthetic attachment — Claude does NOT call Read itself.
- The `@`-mention path injects a **synthetic Read**: a `<system-reminder>` formatted *as if* a Read had occurred
  (`Called the Read tool with the following input: {"file_path":"…"}`) + a second reminder carrying the file's
  numbered contents (standard Read-result format). Source: anthropics/claude-code issue #58574 (the bug is the
  model then can't edit because the synthetic injection isn't registered with the Read-tracker).
- The general wrapper is the **`<system-reminder>` XML tag** — the unified mechanism for putting system/file
  content in context without the model mistaking it for the user's words. For memory/CLAUDE.md-style content the
  form is a `"Contents of ${path}:\n\n${content}"` preamble inside the system-reminder (visible in `getClaudeMds()`).
- Net: Claude Code's bias is **deterministic rule-based injection** ("RAG without a vector store") for what the
  user explicitly pointed at; the **Read tool** is for files the model discovers/chooses on its own.

## §2 pi file ingestion — PATH + tool-read (the model calls `read`). *Confidence: HIGH.*
- Ground truth (`docs/pi-agent-notes.md`): pi is a headless coding-agent CLI with **read / write / edit / bash**
  tools (+ `grep`/`find`/`ls`) working against files in its cwd; nodes coordinate **purely through the
  filesystem**; "large repo context must be managed by the node prompt, not assumed." No inline-injection channel
  in the headless invocation (`pi -p --mode json -a --no-session --offline --no-extensions`).
- pi's `read` tool: default pulls **up to 2000 lines / 50 KB per call**, pageable (offset/limit), pluggable
  (`ReadOperations`). Read-only mode = `pi --tools read,grep,find,ls`. `AGENTS.md`/`CLAUDE.md` ARE auto-loaded at
  startup, but per-task input files are NOT — those are tool-read.
- Sharp edge (issue #3432): weaker/local models "may not think to use the limit param… then bloat the context"
  by over-reading — pi's own version of piflow's read-thrash risk, externally confirmed.
- Nuance: pi CAN inject (a `transformContext`/`convertToLlm` hook exists), so an injection channel is buildable;
  out of the box, and in piflow's invocation, inputs are path+tool-read.

## §3 Recommendation for piflow readScope — HYBRID, inject-biased. *Adopted (§6a).*
**Inject** small · always-needed · stable inputs (wrap like Claude Code: `<system-reminder>` + `Contents of
{{abs-path}}:` + numbered body — AND pass the path too); **path + pi `read`** for large · optional · mutable
inputs. The line: inject iff `(≲300–500 lines / well under pi's per-call cap) AND always-needed AND stable when
the prompt is composed`; else tool-read. Three deciding reasons:
1. **Guaranteed-sight + anti-thrash.** Injecting removes the read decision — defusing the cheap-executor
   explore-forever / over-read failure (piflow's FILL-don't-explore lesson; pi issue #3432). Claude Code itself
   pre-reads what the user pointed at rather than trusting the model to pull it.
2. **Token cost flips past a threshold.** Injection is cheapest for small files (one block, zero tool turns) but
   pins a large file in the window for the whole node; tool-read pages just the needed slice — the only sane
   path for big/optional inputs.
3. **Staleness.** A mid-run-edited file is the one case injection gets wrong (the prompt froze a stale copy);
   any file a producer may rewrite before a later node consumes it MUST be tool-read.

**Bottom line:** inject small/always-needed/stable inputs (path also given); path-only + pi `read` for
large/optional/mutable — the inject default is what tames the cheap executor's explore-forever tendency.

## §4 Sources
- `local: docs/pi-agent-notes.md` — pi = read/write/edit/bash, filesystem-coordinated, large context via the node prompt; the headless invocation.
- github.com/anthropics/claude-code issue #58574 — `@`-mention injects a synthetic Read (`Called the Read tool with… {file_path}` + numbered contents) + the context cost.
- digitalrain.studio/posts/2026-04-04-claude-code-preprocessing-pipeline — Claude Code's ~25 attachment types; `at_mentioned_files` pre-reads `@path`; "RAG without a vector store."
- openedclaude.github.io …/10-context-assembly — leaked `getClaudeMds()`: the `Contents of ${path}:` preamble + `<system-reminder>` rendering.
- github.com/earendil-works/pi …/coding-agent/README.md — pi default tools read/write/edit/bash (+grep/find/ls); `pi --tools read,…`; AGENTS.md/CLAUDE.md auto-loaded.
- github.com/earendil-works/pi issue #3432 — pi `read` 2000 lines / 50 KB default; weaker models over-read and bloat context.
