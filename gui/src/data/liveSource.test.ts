// liveSource — the CLIENT transport flag resolver (docs/design/observe-live-sse-single-source.md DR7/P4).
// The contract that MUST hold: the DEFAULT is now 'sse' (P4-live proved SSE ≡ /run-view — sseParity.test.ts +
// real gs01/p06/run01 runs), and the URL `?live=poll` override is the per-session escape back to the legacy
// transport. These tests FAIL if the default silently reverts or if the override is ignored/mis-parsed.
import { describe, it, expect, afterEach, vi } from "vitest";
import { liveSource } from "./liveSource";

function setSearch(search: string) {
  vi.stubGlobal("window", { location: { search } });
}

describe("liveSource — the client transport flag", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to 'sse' with no ?live= override (parity proven — P4-live)", () => {
    setSearch("");
    expect(liveSource()).toBe("sse");
  });

  it("?live=poll is the escape hatch back to the legacy poll transport", () => {
    setSearch("?live=poll&foo=1");
    expect(liveSource()).toBe("poll");
  });

  it("?live=sse selects the enriched SSE render path (matches the new default)", () => {
    setSearch("?live=sse");
    expect(liveSource()).toBe("sse");
  });

  it("an unrecognized ?live= value falls through to the default 'sse', never throws", () => {
    setSearch("?live=nonsense");
    expect(liveSource()).toBe("sse");
  });
});
