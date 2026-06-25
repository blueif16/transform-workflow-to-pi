# Public docs — authoring guide & anti-drift contract

This governs the **public product docs** at `content/docs/` (the docs a *user* of Pi Flow
reads). It is the contract every author — human or agent — follows. If a rule here and a page
disagree, the rule wins; fix the page.

> Not to be confused with the repo's `../docs/` — that is the **engineering canon** (how to
> *build/understand* Pi Flow, for contributors). See "Two doc systems" below for the boundary.

---

## 1. The anti-drift law (the whole point)

Mirrors Pi Flow's own philosophy — *"exactly one reader; the views never reimplement state and
never diverge."* Docs obey the same law:

1. **One source of truth.** Every doc sentence lives in exactly one `.md` file under
   `content/docs/`. There is **no second copy** — not in JSX, not in a CMS, not pasted into the
   landing page.
2. **The site is a renderer, not an author.** The `/docs` route *reads* the tree at build time.
   Never hand-write doc prose into a `.tsx` component.
3. **One reader; the one derived artifact is generated.** The `/docs` route and the `llms.txt`
   generator both read the tree through `lib/docs.mjs` — a single parser, so the nav and the pages
   can never diverge in *logic*. The route reads the markdown live (nav + page); nothing is
   pre-baked. The only generated file is `public/llms.txt` (the AI index), emitted by
   `scripts/build-docs-index.mjs` on `prebuild`. It is a *pure function* of the markdown, gitignored,
   and **never hand-edited** — re-run `npm run docs:index`.
4. **No silent forks.** Need the same fact on the landing page (a hero stat, a feature line)? Import
   it from a shared module or the manifest — do not retype it. A retyped fact is a future drift.

**Acceptance check (per change):** after editing docs, `npm run docs:index` runs clean, the nav and
`llms.txt` reflect your change, and you did **not** touch any generated file by hand.

---

## 2. Two doc systems — one boundary rule

| | `../docs/` (repo root) | `content/docs/` (here) |
|---|---|---|
| Audience | contributors building Pi Flow | users *of* Pi Flow |
| Content | design canon, research, internals | tutorials, guides, reference, concepts |
| Source of truth for… | architecture rationale, decisions | the public API: CLI, `WorkflowSpec`, skills |

**Boundary rule (stops the two from contradicting each other):** a fact has exactly one home.
Deep invariants (CLI flags, the `WorkflowSpec`/template schema, `run-view.json` shape) are owned by
**code/types in `packages/`** — the public `reference/` pages should **link to or be generated from
source, never retype** them. When you can generate, generate.

---

## 3. Structure (Diátaxis-informed, domain-organized)

OpenClaw-style: folders are the nav, kebab-case files, shallow tree. Diátaxis is the *intent* model
(what each page **is**), not a rigid four-bucket cage.

```
content/docs/
├── index.md            # overview + cards  (the only root page)
├── start/              # tutorial: install → first live run
├── concepts/           # explanation: the substrate, L1/L2/L3, observe, data boundaries
├── guides/             # how-to: one outcome per page (author / run / monitor / enhance)
└── reference/          # information: CLI, WorkflowSpec, run-view  (canonical facts ONLY)
```

Rules:
- **kebab-case** filenames; **shallow** (2 levels max under `docs/`).
- **One concept per page.** Split a page before it sprawls.
- **Canonical data lives only in `reference/`.** Tutorials/guides *link* to it — never duplicate a
  flag table or schema into a how-to.
- Add a top-level folder → register it in `SECTIONS` in `lib/docs.mjs` (its nav title + order). The
  folder structure IS the nav; nothing else to maintain.

---

## 4. Frontmatter contract (every page, no exceptions)

```yaml
---
title: "Run on Pi"                 # required — nav label + page H1
summary: "Kick off a workflow on the pi fleet and follow it live."  # required — one line; powers nav + llms.txt + AI routing
read_when:                         # optional — when a reader/agent should open this page
  - You have a built template and want a live run
  - A run stalled and you need to follow it
order: 2                           # optional — sidebar order within the folder (default 99)
draft: true                        # optional — stub; excluded from the main llms.txt index
---
```

- `summary` is load-bearing: it is the nav blurb, the `llms.txt` description, **and** the routing
  hint an AI agent reads to pick the right page. Make it a factual one-liner, active voice, no
  marketing. Keep it < ~120 chars.
- `read_when` is the standout habit (borrowed from OpenClaw): per-file intent an agent can scan
  without opening the body. Use it on every non-trivial page.
- The body starts with a 1–2 sentence intro, then `##` sections. **No `#` H1 in the body** — the H1
  comes from `title`.

---

## 5. Writing conventions

- **Links:** root-relative, with the `/docs` prefix, no extension: `[CLI](/docs/reference/cli)`.
  Never `../reference/cli.md`.
- **Headings:** sentence case; avoid em-dashes/apostrophes in headings (they break anchor links).
- **Code:** real, runnable examples — no pseudocode. Show the actual `piflow` command.
- **Tutorials** are linear and kind: one happy path, no "you could also…".
- **How-to guides**: one outcome per page, crisp, task-focused; push the "why" to a concept page
  and link it.
- **Reference**: exact and exhaustive; the canonical home for flags, schema fields, error codes.

---

## 6. Pre-ship checklist

- [ ] Frontmatter has `title` + `summary`; `read_when` on anything non-trivial
- [ ] Page is one concept, in the right folder (tutorial/guide/concept/reference by intent)
- [ ] Canonical facts (flags, schema) live in `reference/` or are generated — not retyped here
- [ ] Links are root-relative `/docs/...` with no extension
- [ ] nav updates automatically from the tree; `npm run docs:index` regenerates `llms.txt` clean; **no generated file hand-edited**
- [ ] No doc prose pasted into a `.tsx` component (the site renders the markdown, it doesn't author it)
