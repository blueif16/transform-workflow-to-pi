// M1 — the pi GATEWAY credential parity unit (no creds, no real VM).
//
// Design contract: docs/design/node-action-protocol.md §4 (provider-credential parity) +
// docs/design/credential-architecture.md §4. The MCP/tool `$VAR` allowlist already crosses into a cloud
// VM via `mcpEnvAdditions` (runner.ts) under the `CLOUD_KINDS` allowlist; the pi agent's OWN provider
// gateway key did NOT. `defaultPiCommand` stamps `--provider`/`--model` but no key — pi reads the key from
// its env (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, …). A LOCAL child inherits `process.env` so it works
// today; a CLOUD VM does NOT (daytona exec merges only `{...this.env,...opts.env}`; the per-run VM env is
// `{PI_RUN}`). This file pins the SHARED-seam fix: the declared provider-cred var(s) resolve through the
// SAME `SecretResolver` and join the SAME cloud allowlist `mcpEnvAdditions` enforces.
//
// The load-bearing INVARIANT (the allowlist): on `isCloud`, the forwarded env contains EXACTLY the declared
// provider var(s) and EXCLUDES an unrelated host var — never a wholesale host-env spread into the VM.

import { describe, it, expect } from 'vitest';
import { cloudCredEnvAdditions } from '../src/runner/runner.js';
import type { SecretResolver } from '../src/index.js';

describe('cloudCredEnvAdditions — the pi gateway credential on the SAME allowlist as MCP creds', () => {
  // A resolver that knows the provider key AND an unrelated host secret. The allowlist must let only the
  // DECLARED name through — proving we never blast the rest of the host env into the VM.
  const resolver: SecretResolver = (name) => {
    const env: Record<string, string> = {
      ANTHROPIC_API_KEY: 'sk-ant-from-resolver',
      UNRELATED_HOST_SECRET: 'should-NOT-cross-into-the-vm',
    };
    return env[name];
  };

  it('on cloud, forwards EXACTLY the declared provider var and EXCLUDES an unrelated host var (the allowlist invariant)', async () => {
    const env = await cloudCredEnvAdditions(['ANTHROPIC_API_KEY'], true, 'node-a', resolver);
    // the declared provider credential reached the VM exec env...
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-from-resolver');
    // ...and the unrelated host secret did NOT ride along (the load-bearing allowlist invariant).
    expect(env).not.toHaveProperty('UNRELATED_HOST_SECRET');
    // the additions are EXACTLY the declared set — nothing else.
    expect(Object.keys(env)).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('resolves EACH declared var through the SecretResolver seam (multi-key gateway)', async () => {
    const multi: SecretResolver = (name) =>
      ({ NEBIUS_API_KEY: 'neb-key', PROXY_API_KEY: 'proxy-key' } as Record<string, string>)[name];
    const env = await cloudCredEnvAdditions(['NEBIUS_API_KEY', 'PROXY_API_KEY'], true, 'node-b', multi);
    expect(env).toEqual({ NEBIUS_API_KEY: 'neb-key', PROXY_API_KEY: 'proxy-key' });
  });

  it('a var the resolver does not know is simply absent (never injected as undefined)', async () => {
    const env = await cloudCredEnvAdditions(['MISSING_KEY'], true, 'node-c', resolver);
    expect(env).not.toHaveProperty('MISSING_KEY');
    expect(Object.keys(env)).toEqual([]);
  });

  it('passes {nodeId, isCloud} to the resolver so a host can mint a per-node, cloud-only scoped token', async () => {
    const seen: { nodeId: string; isCloud: boolean }[] = [];
    const spy: SecretResolver = (_name, ctx) => {
      seen.push(ctx);
      return 'scoped-token';
    };
    await cloudCredEnvAdditions(['ANTHROPIC_API_KEY'], true, 'node-d', spy);
    expect(seen).toEqual([{ nodeId: 'node-d', isCloud: true }]);
  });

  it('an empty declared set yields no additions (a keyless/local-only run is unaffected)', async () => {
    expect(await cloudCredEnvAdditions([], true, 'node-e', resolver)).toEqual({});
    expect(await cloudCredEnvAdditions(undefined, true, 'node-f', resolver)).toEqual({});
  });
});
