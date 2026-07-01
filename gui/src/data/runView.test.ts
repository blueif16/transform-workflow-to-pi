// (SA-E) gatePipelineLabels — the pure projection of a node's authored `op[]` lane onto the compact
// gate-chip labels the node badge surfaces (the badge WIDEN). This is the badge's correctness contract:
// an op.run reads "exec", an op.gate reads "floor:<kind>", a rerouteTo action reads "judge", and a G5
// `checkpoint` reads "human" — IN op[] ORDER (the pipeline is ordered). A test here FAILS if the badge
// would mislabel or drop a gate, or scramble the order — not coverage theater.
import { describe, it, expect } from "vitest";
import { gatePipelineLabels, sandboxSkin, effectiveSandbox, deriveNodeLocal, type AuthoredNodeConfig, type RunView, type RunViewNode } from "./runView";
// The GUI can't bundle @piflow/core, so `deriveNodeLocal` is a hand-kept mirror of core's authoritative
// `deriveNode`. This test PINS them equal — the browser fork can never silently drift from the surface.
import { deriveNode } from "../../../packages/core/src/observe/derive.js";

describe("gatePipelineLabels — op[] → badge chip labels", () => {
  it("an unconfigured node (no op[], no checkpoint) has an empty pipeline", () => {
    expect(gatePipelineLabels({ id: "n" })).toEqual([]);
    expect(gatePipelineLabels(null)).toEqual([]);
    expect(gatePipelineLabels(undefined)).toEqual([]);
  });

  it("maps each op body to its chip label, preserving op[] ORDER", () => {
    const cfg: AuthoredNodeConfig = {
      id: "build",
      op: [
        { when: "post", run: { cmd: "npm test" } },
        { when: "post", gate: { kind: "non-empty" } },
        { when: "on-failure", action: { kind: "rerouteTo", node: "build" } },
      ],
    };
    // exec (run) → floor:<kind> (gate) → judge (rerouteTo) — in authored order.
    expect(gatePipelineLabels(cfg)).toEqual(["exec", "floor:non-empty", "judge"]);
  });

  it("a human gate (G5 checkpoint) appends 'human' to the pipeline", () => {
    const cfg: AuthoredNodeConfig = { id: "build", op: [{ when: "post", run: { cmd: "tsc" } }], checkpoint: { kind: "confirm", prompt: "ok?" } };
    expect(gatePipelineLabels(cfg)).toEqual(["exec", "human"]);
  });

  it("a non-reroute action keeps its kind as the label (e.g. retry)", () => {
    const cfg: AuthoredNodeConfig = { id: "n", op: [{ when: "on-failure", action: { kind: "retry" } }] };
    expect(gatePipelineLabels(cfg)).toEqual(["retry"]);
  });
});

// (per-node-full-access §4/§7) The node skin is a PURE projection of node config — three modes
// flat | cloud | unlocked. Precedence: cloud backend → "cloud"; else config.fullAccess → "unlocked";
// else "flat" (INCLUDING a programmatic node — it has no sandbox to unlock, so it stays flat). The skin
// reads ONLY node.config.fullAccess (a per-node value); there is NO run-level field. A test here FAILS
// if the precedence inverts, if a programmatic node mislabels as "unlocked", or if cloud loses to fullAccess.
describe("sandboxSkin — node config → flat | cloud | unlocked", () => {
  const node = (config?: RunViewNode["config"]): RunViewNode =>
    ({ id: "n", label: "n", phase: null, status: "ok", config, toolCalls: 0, toolBreakdown: {}, timeline: [], reads: [], scopes: [], writes: [], artifacts: [], bash: [], retries: 0, stopReason: null, truncated: false, thinkingChars: 0 });
  const view = (sandbox?: RunView["sandbox"]): RunView =>
    ({ run: "r", sandbox, stages: [], edges: [], nodes: [] });

  it("returns 'unlocked' when the node's config.fullAccess is set", () => {
    const v = view("local");
    const n = node({ fullAccess: true });
    expect(sandboxSkin(effectiveSandbox(v, n), n)).toBe("unlocked");
  });

  it("returns 'cloud' for a cloud backend (daytona / e2b), winning over fullAccess", () => {
    for (const backend of ["daytona", "e2b"] as const) {
      const v = view(backend);
      // even if fullAccess is set, the cloud backend takes precedence (a no-op in cloud).
      const n = node({ fullAccess: true });
      expect(sandboxSkin(effectiveSandbox(v, n), n)).toBe("cloud");
    }
  });

  it("returns 'flat' for a plain local node (no fullAccess)", () => {
    const v = view("local");
    expect(sandboxSkin(effectiveSandbox(v, node()), node())).toBe("flat");
  });

  it("returns 'flat' for a programmatic node — it has no sandbox to unlock", () => {
    // a programmatic node is host-local (effectiveSandbox → "local") and never carries fullAccess.
    const v = view("local");
    const n = node({ programmatic: true });
    expect(sandboxSkin(effectiveSandbox(v, n), n)).toBe("flat");
  });
});

// The GUI's `deriveNodeLocal` (the browser-side stand-in that fills `derived` on a live-folded node) MUST
// stay byte-identical to core's authoritative `deriveNode` — else a running run's zones would disagree with
// the same run once loaded. Comparing full outputs over varied fixtures FAILS the moment either drifts.
describe("deriveNodeLocal — pinned equal to core deriveNode", () => {
  const dn = (p: Partial<RunViewNode>): RunViewNode => ({
    id: "n", label: "n", phase: null, status: "ok",
    toolCalls: 0, toolBreakdown: {}, timeline: [], reads: [], scopes: [], writes: [], artifacts: [],
    bash: [], retries: 0, stopReason: null, truncated: false, thinkingChars: 0, ...p,
  });
  const span = (ok: boolean) => ({ name: "t", tStartMs: 0, durMs: 1, ok });
  const fixtures: Record<string, RunViewNode> = {
    empty: dn({}),
    rich: dn({
      tokens: { input: 100, output: 20, cacheRead: 900, cacheWrite: 0, cost: 0, contextPeak: 1000, billable: 120 },
      contextWindow: 100_000, durationMs: 1600, expectedMs: 1000,
      toolCalls: 10, toolBreakdown: { bash: 9, read: 1 },
      timeline: [...Array(8).fill(0).map(() => span(true)), span(false), span(false)],
      retries: 5,
      artifacts: [{ path: "/x/a", displayPath: "a", exists: true, bytes: 1 }],
      writes: [{ path: "/x/a", displayPath: "a", verified: true }, { path: "/x/b", displayPath: "b", verified: false, bytes: 2 }],
    }),
    cacheBoundary: dn({ tokens: { input: 70, output: 0, cacheRead: 30, cacheWrite: 0, cost: 0, contextPeak: 0, billable: 0 } }),
    running: dn({ durationMs: null, contextWindow: null, tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextPeak: 140_000, billable: 5 } }),
  };
  for (const [name, n] of Object.entries(fixtures)) {
    it(`matches core for the ${name} fixture`, () => {
      expect(deriveNodeLocal(n)).toEqual(deriveNode(n));
    });
  }
});
