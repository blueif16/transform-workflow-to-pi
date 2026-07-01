// liveSource — the CLIENT transport flag resolver (docs/design/observe-live-sse-single-source.md DR7/P3).
// The contract that MUST hold: the DEFAULT is 'poll' (so P3 is a no-op until parity is proven), and the URL
// `?live=` override wins for a session. These tests FAIL if the default flips (would change today's behavior
// silently) or if the override is ignored/mis-parsed. Pure resolver — no side effects.
import { describe, it, expect, afterEach, vi } from "vitest";
import { liveSource } from "./liveSource";

function setSearch(search: string) {
  vi.stubGlobal("window", { location: { search } });
}

describe("liveSource — the client transport flag", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to 'poll' with no ?live= override (the safe no-op default)", () => {
    setSearch("");
    expect(liveSource()).toBe("poll");
  });

  it("?live=sse selects the enriched SSE render path", () => {
    setSearch("?live=sse&foo=1");
    expect(liveSource()).toBe("sse");
  });

  it("?live=poll forces the poll path (an explicit runtime override back to default)", () => {
    setSearch("?live=poll");
    expect(liveSource()).toBe("poll");
  });

  it("an unrecognized ?live= value falls through to the default 'poll', never throws", () => {
    setSearch("?live=nonsense");
    expect(liveSource()).toBe("poll");
  });
});
