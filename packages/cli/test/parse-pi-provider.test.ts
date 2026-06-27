// M1b — parsePiProvider: scope ~/.pi/agent/models.json to the SELECTED provider and extract its $VAR cred
// refs. This is the pure logic the CLI's daytona branch uses to (a) STAGE the right custom-gateway config
// into the VM and (b) derive the cloud cred allowlist from the entry's own apiKey/header $VARs (the
// authoritative source, vs the providerCredVar built-in fallback). See docs/design/credential-architecture.md.

import { describe, it, expect } from 'vitest';
import { parsePiProvider } from '../src/run.js';

const MODELS = JSON.stringify({
  providers: {
    nebius: {
      baseUrl: 'https://api.tokenfactory.nebius.com/v1',
      api: 'openai-completions',
      apiKey: '$NEBIUS_API_KEY',
      models: [{ id: 'qwen' }],
    },
    mmgw: {
      baseUrl: 'https://minnimax.chat',
      api: 'anthropic-messages',
      apiKey: '${MMGW_KEY}',
      headers: { 'X-Tenant': '$TENANT_ID' },
      models: [{ id: 'a' }],
    },
  },
});

describe('parsePiProvider — scope to provider + extract $VAR cred refs (M1b)', () => {
  it('scopes the staged config to the SELECTED provider ONLY (other gateways never cross)', () => {
    const r = parsePiProvider(MODELS, 'nebius');
    const cfg = JSON.parse(r.config!) as { providers: Record<string, { api: string }> };
    expect(Object.keys(cfg.providers)).toEqual(['nebius']); // mmgw is NOT staged
    expect(cfg.providers.nebius.api).toBe('openai-completions');
  });

  it('extracts $VAR and ${VAR} cred refs from apiKey AND headers (the cloud allowlist)', () => {
    expect(parsePiProvider(MODELS, 'nebius').credVars).toEqual(['NEBIUS_API_KEY']);
    expect(parsePiProvider(MODELS, 'mmgw').credVars.sort()).toEqual(['MMGW_KEY', 'TENANT_ID']);
  });

  it('a BUILT-IN provider (no models.json entry) ⇒ no config, no creds (needs neither)', () => {
    expect(parsePiProvider(MODELS, 'anthropic')).toEqual({ credVars: [] });
  });

  it('is TOTAL — malformed JSON, empty config, or no provider never throws', () => {
    expect(parsePiProvider('not json at all', 'nebius')).toEqual({ credVars: [] });
    expect(parsePiProvider('{}', 'nebius')).toEqual({ credVars: [] });
    expect(parsePiProvider(MODELS, undefined)).toEqual({ credVars: [] });
  });
});
