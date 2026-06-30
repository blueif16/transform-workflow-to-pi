# Releasing & maintaining the `@piflow/*` npm packages

The canonical runbook for **when** and **how** we publish. Read it before any publish — don't improvise one.

> **Default posture: you are MAINTAINING, not releasing.** Publishing is deliberate and infrequent.
> Published versions are **immutable** — npm won't let you reuse a version, and un-publishing is heavily
> restricted. When in doubt, do NOT publish: keep developing and accumulate changesets.

## What we publish

| Package | Published? | Global bin |
|---|---|---|
| `@piflow/core` | yes (public) | — |
| `@piflow/cli` | yes (public) | **`piflowctl`** |
| `@piflow/tool-bridge` | yes (public) | — |
| `@piflow/langgraph` | yes (public) | — |
| `@piflow/e2b` | yes (public) | — |
| `@piflow/daytona` | yes (public) | — |
| `@piflow/tui` | **no** (`private`) | `piflow-tui` (dev `pnpm link` only) |
| `gui` | **no** (`private`) | — |
| root `piflow-monorepo` | **no** (`private`) | — |

Scope `@piflow` is ours (npm org; owner `blueif23`). All six publishable packages carry
`publishConfig.access=public`. The CLI bin is `piflowctl`, **not** `piflow` (the bare name collides with the
unrelated `@arche-sh/piflow`; see `docs/research/arche-sh-piflow.md`).

## MAINTAIN vs RELEASE — the decision rule

**MAINTAIN (≈always):** writing code, fixing bugs, merging branches. The durable record of progress is
**git**, never an npm publish. For every change a consumer would notice, add a changeset (below). Do NOT publish.

**RELEASE (rare, deliberate):** publish only when **all** hold:
- a coherent, *finished* unit of work is on `main` (never mid-feature),
- it's something a consumer actually needs to `npm install`,
- the pre-release gate below is green.

Never publish to "save progress," to share with yourself, or from a feature branch — those are git / branch /
`npm pack` tarball jobs, not a registry release.

## The everyday loop (MAINTAIN)

After any consumer-facing change, while it's fresh:
```bash
pnpm run changeset    # pick affected packages + bump (patch/minor/major); one-sentence summary.
                      # commit the .md it writes ALONGSIDE the code change.
```
Changesets are cheap and accumulate; many batch into one release. No changeset ⇒ no release for that change.

## The release loop (RELEASE) — via CI, no token

Steady-state releases run through **CI with npm OIDC trusted publishing** (no long-lived token anywhere). See
[`CI.md`](./CI.md) for the why; the human steps are just:

1. **Land changesets on `main`** as part of normal work (the MAINTAIN loop above).
2. `release.yml` (push to `main`) runs `changesets/action`, which opens/updates a **"Version Packages" PR** —
   it consumes pending changesets, bumps versions, **rewrites internal ranges**, updates CHANGELOGs.
3. **Review that PR**, run the pre-release gate (next section), then **merge it**.
4. On merge, `release.yml` runs again and **publishes** the changed packages — `pnpm run release`
   (`build` → `changeset publish`, dependency order, `--access public`, git tags), authed via OIDC under
   `environment: release` with **provenance on**.
5. Verify: `npm view @piflow/core version` shows the new version; smoke-install in a scratch dir
   (`pnpm add @piflow/cli && piflowctl --help`).

> **First publish only — manual bootstrap.** OIDC needs the package to already exist on npm to attach a
> Trusted Publisher, and there is no pending-publisher configured. So the **very first** release is manual:
> `npm login` as a `piflow`-org member → `pnpm run release` locally → then on npmjs.com configure a **Trusted
> Publisher** per package (org/user `blueif16`, repo `PiFlow`, workflow `release.yml`, environment `release`;
> tick the post-May-2026 "npm publish" allowed action). After that, **all** releases go through CI/OIDC — never
> a stored token again. Full bootstrap rationale in [`CI.md`](./CI.md).

## Pre-release gate (ALL must pass)

These are the same gates `ci.yml` runs (see [`CI.md`](./CI.md) for what each uniquely catches); confirm green
on the "Version Packages" PR before merging.

- [ ] On `main`, working tree clean, pulled.
- [ ] `pnpm lint` green (Biome).
- [ ] `pnpm run build` green (`tsc -b`).
- [ ] `pnpm test` green — the `default` project (no creds). `live` tests are opt-in and not part of the gate.
- [ ] `pnpm pack-verify` green — per publishable package: publint + `@arethetypeswrong/cli` + the
      tarball-content assertion (`dist` present, no stray/secret files).
- [ ] `pnpm smoke:cli` green — packs + installs `@piflow/cli` with its workspace deps and runs
      `piflowctl --version` / `--help`.
- [ ] `pnpm changeset status` clean — no unconsumed changesets (i.e. the Version Packages PR consumed them).
- [ ] CLI: bin is `piflowctl`; `piflowctl --help` matches reality; README/docs command surface in sync.
- [ ] Target versions are NOT already on the registry.
- [ ] Publishing via CI/OIDC (no token needed) — or, for the **first** publish only, you're `npm login`'d as a
      `piflow`-org member (see the bootstrap note above).

## Versioning policy (we are pre-1.0)

- **patch** = fix / docs / internal. **minor** = new feature *or any breaking change* (breaking is allowed
  while `0.x` — call it out explicitly in the changeset).
- **Never hand-edit** `version` or internal dep ranges — Changesets keeps `@piflow/core`'s consumers in sync;
  hand-editing desyncs them.
- At API stability → cut `1.0.0` and switch to strict semver (breaking ⇒ major).

## Dogfood before it's real — canary / pre-release

To test a build (e.g. "fixtures rolling out", early integration feedback) without burning the stable version:
```bash
pnpm changeset pre enter next    # enter pre-release mode
pnpm run version-packages        # -> e.g. 0.2.0-next.0
pnpm run release                 # publishes under the `next` dist-tag:  pnpm add @piflow/core@next
pnpm changeset pre exit          # LEAVE pre mode before the real release
```
The stable `latest` tag is untouched until you exit pre mode and do a normal release.

## Anti-patterns (never)

- ❌ Publish from a feature branch or with a dirty tree.
- ❌ Publish to checkpoint progress (git does that).
- ❌ Hand-bump versions / edit `*` or internal ranges.
- ❌ Rely on un-publishing — **deprecate** instead (`npm deprecate @piflow/<pkg>@<ver> "message"`).
- ❌ Register the unscoped `piflow` package name (collision; see `docs/research/arche-sh-piflow.md`).
- ❌ Ship a stale `dist` — `prepublishOnly` rebuilds each package; never bypass it with `--ignore-scripts`.
