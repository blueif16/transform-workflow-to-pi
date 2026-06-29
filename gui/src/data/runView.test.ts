// (SA-E) gatePipelineLabels — the pure projection of a node's authored `op[]` lane onto the compact
// gate-chip labels the node badge surfaces (the badge WIDEN). This is the badge's correctness contract:
// an op.run reads "exec", an op.gate reads "floor:<kind>", a rerouteTo action reads "judge", and a G5
// `checkpoint` reads "human" — IN op[] ORDER (the pipeline is ordered). A test here FAILS if the badge
// would mislabel or drop a gate, or scramble the order — not coverage theater.
import { describe, it, expect } from "vitest";
import { gatePipelineLabels, type AuthoredNodeConfig } from "./runView";

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
