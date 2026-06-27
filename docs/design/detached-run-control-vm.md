# Detached Run — the orchestrator in the cloud (control-VM)

> **Status:** DIRECTION / discussion (2026-06-26). Captures the "fire it and close the laptop" idea and the
> recommended shape. Not yet a committed build. Builds on the provider extensions (`@piflow/e2b`,
> `@piflow/daytona`) + the `SandboxProvider`/`RunScope`/`SecretResolver` seam. Cross-ref:
> `docs/design/multi-provider-sandbox-portability.md`, `docs/design/credential-architecture.md`.

## The idea
Today the piflow **runner (control plane) runs on the laptop** and spawns **per-node** cloud sandboxes. Close
the laptop → the orchestrator dies → the run stops. The goal: **detach the whole run** — kick it off, close
the laptop, it keeps running in the cloud.

## Three architectures (name them — the user is choosing B, not C)
- **A — per-node sandboxes, laptop orchestrator (CURRENT).** Control plane on the laptop; nodes in the cloud.
  Laptop must stay on.
- **B — detached control-VM (RECOMMENDED).** One cloud VM runs `piflowctl run …`; that runner uses the SAME
  provider seam to spawn per-node sandboxes (or run some nodes `local` inside the control VM). Laptop only
  kicks it off + re-attaches. **Per-node heterogeneity (tools/model/sandbox/egress) is preserved.**
- **C — one big VM, whole DAG inside, no per-node isolation.** Simplest detach but **loses piflow's thesis**
  (per-node heterogeneous tools/sandbox/model). Reject as the default — though B can *degrade into* C for a
  given run by choosing `--sandbox local` for every node inside the control VM (cheap, no nested VMs).

## Why B is cheap given what we have (the key insight)
**The control VM is just another staged sandbox running a different command.** A node sandbox runs `pi …`; the
control VM runs `piflowctl run <template>`. The staging seam we already use for nodes (putFiles the template +
inputs, forward an env allowlist, collect outputs via `downloadDir`) works **one level up**. The runner is
already provider-agnostic over `SandboxProvider`, so it does not care that it is itself running in a VM. So B
is mostly **packaging + entrypoint + credentials + observability**, NOT an engine rewrite.

Minimal v1: `piflowctl run --detach --control e2b <template>` → boot a control VM from a piflow-CLI image,
stage the template/inputs, run `piflowctl run --sandbox <e2b|local> …` inside it, print a **run handle** the
laptop re-attaches to. Reuses `@piflow/e2b`/`@piflow/daytona` at BOTH levels.

## The genuinely new work (be honest about the hard parts)
1. **Nested credentials.** The control VM needs the provider API key (E2B/DAYTONA) to spawn child sandboxes —
   a long-lived infra secret now in a cloud VM. This is exactly the `SecretResolver` "mint short-lived scoped
   token, never the raw key" seam (credential-architecture.md §3). v1 may forward the key; v2 mints a scoped,
   TTL-bounded provider token for the control VM.
2. **Reconnectable observability.** GUI/TUI read the `.pi` run tree via `observe`/`watchRun` on the laptop.
   With B that tree lives in the control VM. Options: (i) the control VM exposes the run-view over HTTP/SSE
   (piflow already has `watchRun` + the companion bridge — bind it to a port); (ii) sync the run dir to a
   bucket / `~/.piflow` the laptop polls; (iii) pull-on-reattach. **This is the main net-new surface.**
3. **Orphan/teardown safety when detached.** `RunScope.dispose` tears child VMs per run, but if the CONTROL VM
   dies, children can leak. Needs: `autoStopInterval` guards at BOTH levels + a run-level TTL/budget the
   control VM owns, so an abandoned run self-destructs.
4. **Cost visibility** you can't watch live → emit a run budget + a "still alive / $spent" heartbeat.

## Recommendation
Pursue **B** as a thin "control plane is just another staged sandbox" layer on top of the provider extensions —
do **not** build C as the default (it throws away the differentiator). Sequence after the provider extensions
+ live smoke test land: (1) a CLI-image + `--detach`/`--control` entrypoint, (2) scoped provider creds for the
control VM, (3) reconnectable run-view. Each is incremental; (1)+(degrade-to-local) already gives "close the
laptop, it runs."
