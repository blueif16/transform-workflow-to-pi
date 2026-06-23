// Bounded stdout/stderr capture for the sandbox providers. A provider buffers a command's output to
// return it as `ExecResult.stdout`, but the runner only ever reads the FINAL fenced-json return block
// from it (lastJsonBlock scans from the end) — and the full stream is now archived by the event
// recorder (../runner/events.ts). So an UNBOUNDED `stdout += chunk` buys nothing and is a latent crash:
// a model/runtime that re-embeds its whole accumulated transcript on every delta (observed with pi +
// some non-Claude models) balloons the raw stream past V8's ~512MB max string length, and the next
// `+=` throws `RangeError: Invalid string length`, killing the node mid-run before it can write.
// `tailAppend` keeps only the last `max` chars — enough for the return block, immune to the blow-up.

/** Default tail window kept per stream: generous enough for any return block, far under the string cap. */
export const DEFAULT_CAPTURE_MAX = 8 * 1024 * 1024; // 8 MiB

/** Append `chunk` to `buf`, retaining only the last `max` characters. Never exceeds `max` (so a single
 *  oversized chunk is tail-clipped first) — the bound holds regardless of input size. */
export function tailAppend(buf: string, chunk: string, max: number = DEFAULT_CAPTURE_MAX): string {
  const c = chunk.length > max ? chunk.slice(chunk.length - max) : chunk;
  const next = buf + c;
  return next.length > max ? next.slice(next.length - max) : next;
}
