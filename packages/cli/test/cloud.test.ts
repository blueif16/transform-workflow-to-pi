import { describe, it, expect, vi } from 'vitest';
import {
  mintCloudSecrets,
  buildFlyDeployPlan,
  renderPlan,
  runCloudUp,
  runCloudDown,
  flyAppUrl,
  MODELS_JSON_ENV,
  type MintDeps,
  type CloudDeps,
  type DeployStep,
} from '../src/cloud.js';

// A fixed resolver set so no test mints a real token, reads ~/.pi, shells out, or writes ~/.piflow.
const OAUTH_VALUE = 'oauth-SUBSCRIPTION-secret';
const PROVIDER_VALUE = 'nebius-KEY-secret';
const fixedMintDeps = (over: Partial<MintDeps> = {}): MintDeps => ({
  randomToken: () => 'MINTED-BEARER',
  cloudCred: (async (names: string[]) => Object.fromEntries(names.map((n) => [n, PROVIDER_VALUE]))) as MintDeps['cloudCred'],
  resolveOAuth: (async () => OAUTH_VALUE) as MintDeps['resolveOAuth'],
  resolveProvider: () => ({ credVars: [] }),
  ...over,
});

// ── mintCloudSecrets — the value minting (PURE given injected RNG + resolvers) ─────────────────────
describe('mintCloudSecrets', () => {
  it('mints a fresh PIFLOW_TOKEN and derives the cloud context entry + app url', async () => {
    const m = await mintCloudSecrets({ app: 'my-app', providerSecret: 'NEBIUS_API_KEY' }, fixedMintDeps());
    expect(m.token).toBe('MINTED-BEARER');
    expect(m.appUrl).toBe('https://my-app.fly.dev');
    expect(m.contextEntry).toEqual({ baseUrl: 'https://my-app.fly.dev', token: 'MINTED-BEARER' });
    expect(m.secrets[0]).toEqual({ name: 'PIFLOW_TOKEN', value: 'MINTED-BEARER' });
  });

  it('plain path (no --provider): stages the single --provider-secret + OAuth, no gateway file', async () => {
    const m = await mintCloudSecrets({ app: 'a', providerSecret: 'NEBIUS_API_KEY' }, fixedMintDeps());
    expect(m.modelsJson).toBeUndefined();
    expect(m.provider).toBeUndefined();
    expect(m.secrets.map((s) => s.name)).toEqual(['PIFLOW_TOKEN', 'NEBIUS_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
    expect(m.missing).toEqual([]);
  });

  it('custom gateway (--provider): stages the models.json entry + ITS cred vars (not the fallback key)', async () => {
    const m = await mintCloudSecrets(
      { app: 'a', provider: 'mmgw', providerSecret: 'NEBIUS_API_KEY' },
      fixedMintDeps({ resolveProvider: () => ({ config: '{"providers":{"mmgw":{}}}', credVars: ['MMGW_KEY'] }) }),
    );
    expect(m.modelsJson).toBe('{"providers":{"mmgw":{}}}');
    expect(m.provider).toBe('mmgw');
    expect(m.secrets.map((s) => s.name)).toEqual(['PIFLOW_TOKEN', 'MMGW_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
  });

  it('reports an UNRESOLVED provider cred + OAuth as missing (never staged empty)', async () => {
    const m = await mintCloudSecrets(
      { app: 'a', providerSecret: 'NEBIUS_API_KEY' },
      fixedMintDeps({
        cloudCred: (async () => ({})) as MintDeps['cloudCred'],
        resolveOAuth: (async () => undefined) as MintDeps['resolveOAuth'],
      }),
    );
    expect(m.missing).toEqual(['NEBIUS_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
    expect(m.secrets.map((s) => s.name)).toEqual(['PIFLOW_TOKEN']); // only the minted bearer resolved
  });

  // These isolate the STAGE-INTENT guard: an ANTHROPIC_* var must be rejected because we'd DECLARE it a Fly
  // secret — independent of whether it resolves on this machine (a non-resolving cloudCred, so the reject can
  // only come from the credVarNames guard, not from the resolved-secrets defense-in-depth check downstream).
  const nonResolving = (over: Partial<MintDeps> = {}) => fixedMintDeps({ cloudCred: (async () => ({})) as MintDeps['cloudCred'], ...over });

  it('BILLING GUARD: refuses an ANTHROPIC_* API key as the --provider-secret, even when it does not resolve', async () => {
    await expect(mintCloudSecrets({ app: 'a', providerSecret: 'ANTHROPIC_API_KEY' }, nonResolving())).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('BILLING GUARD: refuses a gateway whose cred vars include an ANTHROPIC_* API key, even when it does not resolve', async () => {
    await expect(
      mintCloudSecrets(
        { app: 'a', provider: 'evil', providerSecret: 'NEBIUS_API_KEY' },
        nonResolving({ resolveProvider: () => ({ config: '{}', credVars: ['ANTHROPIC_API_KEY'] }) }),
      ),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

// ── buildFlyDeployPlan — the ordered runbook (PURE) ────────────────────────────────────────────────
describe('buildFlyDeployPlan', () => {
  const base = { app: 'the-app', appUrl: flyAppUrl('the-app'), config: 'deploy/control-vm/fly.toml', dockerfile: 'deploy/control-vm/Dockerfile', token: 'BEARER', secrets: [{ name: 'PIFLOW_TOKEN', value: 'BEARER' }, { name: 'NEBIUS_API_KEY', value: 'NK' }] };

  it('emits the six steps in runbook order', () => {
    const plan = buildFlyDeployPlan(base);
    expect(plan.steps.map((s) => s.id)).toEqual([
      'copy-dockerignore',
      'apps-create',
      'secrets-set',
      'deploy',
      'rm-dockerignore',
      'smoke',
    ]);
  });

  it('the deploy step is the paid one and carries --config/--dockerfile/-a <app>/. from the repo root', () => {
    const plan = buildFlyDeployPlan(base);
    const deploy = plan.steps.find((s) => s.id === 'deploy')!;
    expect(deploy.paid).toBe(true);
    expect(deploy.command).toEqual([
      'fly', 'deploy', '--config', 'deploy/control-vm/fly.toml', '--dockerfile', 'deploy/control-vm/Dockerfile', '-a', 'the-app', '.',
    ]);
  });

  it('apps-create is idempotent (its failure is tolerated in execute mode)', () => {
    const plan = buildFlyDeployPlan(base);
    expect(plan.steps.find((s) => s.id === 'apps-create')!.idempotent).toBe(true);
  });

  it('secrets-set inlines the REAL values in the command but redacts them in display', () => {
    const plan = buildFlyDeployPlan(base);
    const set = plan.steps.find((s) => s.id === 'secrets-set')!;
    expect(set.command).toContain('NEBIUS_API_KEY=NK'); // execute form has the real value
    expect(set.display).toContain('NEBIUS_API_KEY=***'); // display redacts it
    expect(set.display).not.toContain('=NK');
  });

  it('when a gateway models.json is present it rides secrets-set as a NON-secret labeled env', () => {
    const plan = buildFlyDeployPlan({ ...base, modelsJson: '{"providers":{"mmgw":{"apiKey":"$MMGW_KEY"}}}', provider: 'mmgw' });
    const set = plan.steps.find((s) => s.id === 'secrets-set')!;
    expect(set.command.some((a) => a.startsWith(`${MODELS_JSON_ENV}={`))).toBe(true); // the real config in the command
    expect(set.display).toContain(`${MODELS_JSON_ENV}=<gateway:mmgw>`); // labeled, not the blob, in display
    expect(set.display).not.toContain('$MMGW_KEY');
  });

  it('the smoke step carries the app url + token in its env (redacted in display)', () => {
    const plan = buildFlyDeployPlan(base);
    const smoke = plan.steps.find((s) => s.id === 'smoke')!;
    expect(smoke.env).toEqual({ PIFLOW_CLOUD_URL: 'https://the-app.fly.dev', PIFLOW_TOKEN: 'BEARER' });
    expect(smoke.display).toContain('PIFLOW_TOKEN=***');
    expect(smoke.display).not.toContain('BEARER');
  });
});

// ── renderPlan — the runbook a user reads (redaction is the critical property) ──────────────────────
describe('renderPlan', () => {
  const mkMint = (over = {}) => ({ token: 'BEARER', appUrl: flyAppUrl('a'), contextEntry: { baseUrl: flyAppUrl('a'), token: 'BEARER' }, secrets: [{ name: 'PIFLOW_TOKEN', value: 'BEARER' }, { name: 'NEBIUS_API_KEY', value: PROVIDER_VALUE }, { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: OAUTH_VALUE }], missing: [] as string[], ...over });

  it('NEVER leaks a resolved secret value (all shown ***)', () => {
    const mint = mkMint();
    const plan = buildFlyDeployPlan({ app: 'a', appUrl: mint.appUrl, config: 'c', dockerfile: 'd', token: mint.token, secrets: mint.secrets });
    const out = renderPlan(plan, mint, { contextName: 'cloud' });
    expect(out).not.toContain(PROVIDER_VALUE);
    expect(out).not.toContain(OAUTH_VALUE);
    expect(out).toContain('***');
  });

  it('warns about unresolved secrets and points at claude setup-token for the OAuth one', () => {
    const mint = mkMint({ missing: ['CLAUDE_CODE_OAUTH_TOKEN'] });
    const plan = buildFlyDeployPlan({ app: 'a', appUrl: mint.appUrl, config: 'c', dockerfile: 'd', token: mint.token, secrets: mint.secrets });
    const out = renderPlan(plan, mint, { contextName: 'cloud' });
    expect(out).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(out).toContain('claude setup-token');
  });

  it('marks it a PLAN, warns off ANTHROPIC_API_KEY, and gives the context-use next step', () => {
    const mint = mkMint();
    const plan = buildFlyDeployPlan({ app: 'a', appUrl: mint.appUrl, config: 'c', dockerfile: 'd', token: mint.token, secrets: mint.secrets });
    const out = renderPlan(plan, mint, { contextName: 'cloud' });
    expect(out).toContain('PLAN');
    expect(out).toContain('NEVER set ANTHROPIC_API_KEY');
    expect(out).toContain('piflowctl context use cloud');
  });
});

// ── runCloudUp — the orchestration (injected boundaries; no spawn / no ~/.piflow write) ─────────────
describe('runCloudUp', () => {
  const upOpts = { app: 'a', providerSecret: 'NEBIUS_API_KEY', contextName: 'cloud', config: 'deploy/control-vm/fly.toml', dockerfile: 'deploy/control-vm/Dockerfile' };

  it('PLAN mode: registers the context row, prints the plan, and runs NO outward step', async () => {
    const registered: { name: string; entry: unknown }[] = [];
    const runStep = vi.fn();
    const switchContext = vi.fn();
    const printed: string[] = [];
    const deps: CloudDeps = {
      ...fixedMintDeps(),
      registerContext: async (name, entry) => { registered.push({ name, entry }); },
      runStep: runStep as unknown as CloudDeps['runStep'],
      switchContext: switchContext as unknown as CloudDeps['switchContext'],
      print: (s) => printed.push(s),
    };
    await runCloudUp({ ...upOpts, execute: false }, deps);
    expect(registered).toEqual([{ name: 'cloud', entry: { baseUrl: 'https://a.fly.dev', token: 'MINTED-BEARER' } }]);
    expect(runStep).not.toHaveBeenCalled();
    expect(switchContext).not.toHaveBeenCalled();
    expect(printed.join('\n')).toContain('PLAN');
  });

  it('EXECUTE mode: runs every step in order, then switches context on success', async () => {
    const ran: string[] = [];
    const switched: string[] = [];
    const deps: CloudDeps = {
      ...fixedMintDeps(),
      registerContext: async () => {},
      runStep: async (s: DeployStep) => { ran.push(s.id); return { ok: true }; },
      switchContext: async (name: string) => { switched.push(name); },
      print: () => {},
    };
    await runCloudUp({ ...upOpts, execute: true }, deps);
    expect(ran).toEqual(['copy-dockerignore', 'apps-create', 'secrets-set', 'deploy', 'rm-dockerignore', 'smoke']);
    expect(switched).toEqual(['cloud']); // switch happens AFTER all steps, only on success
  });

  it('EXECUTE mode: a HARD step failure halts before the context switch', async () => {
    const switchContext = vi.fn();
    const deps: CloudDeps = {
      ...fixedMintDeps(),
      registerContext: async () => {},
      runStep: async (s: DeployStep) => (s.id === 'deploy' ? { ok: false, code: 1 } : { ok: true }),
      switchContext: switchContext as unknown as CloudDeps['switchContext'],
      print: () => {},
    };
    await expect(runCloudUp({ ...upOpts, execute: true }, deps)).rejects.toThrow(/step "deploy" failed/);
    expect(switchContext).not.toHaveBeenCalled();
  });

  it('EXECUTE mode: an IDEMPOTENT step failure (apps-create) is tolerated and the switch still happens', async () => {
    const ran: string[] = [];
    const switched: string[] = [];
    const deps: CloudDeps = {
      ...fixedMintDeps(),
      registerContext: async () => {},
      runStep: async (s: DeployStep) => { ran.push(s.id); return s.id === 'apps-create' ? { ok: false, code: 1 } : { ok: true }; },
      switchContext: async (name: string) => { switched.push(name); },
      print: () => {},
    };
    await runCloudUp({ ...upOpts, execute: true }, deps);
    expect(ran).toContain('deploy'); // continued past the tolerated apps-create failure
    expect(switched).toEqual(['cloud']);
  });
});

// ── runCloudDown — teardown ────────────────────────────────────────────────────────────────────────
describe('runCloudDown', () => {
  it('PLAN mode: prints the teardown, runs no step, removes no context', async () => {
    const runStep = vi.fn();
    const removeContextFn = vi.fn();
    const printed: string[] = [];
    await runCloudDown({ app: 'a', contextName: 'cloud', execute: false }, {
      runStep: runStep as unknown as CloudDeps['runStep'],
      removeContextFn: removeContextFn as unknown as CloudDeps['removeContextFn'],
      print: (s) => printed.push(s),
    });
    expect(runStep).not.toHaveBeenCalled();
    expect(removeContextFn).not.toHaveBeenCalled();
    expect(printed.join('\n')).toContain('PLAN');
  });

  it('EXECUTE mode: destroys the app then removes the context', async () => {
    const ran: string[] = [];
    const removed: string[] = [];
    await runCloudDown({ app: 'a', contextName: 'cloud', execute: true }, {
      runStep: async (s: DeployStep) => { ran.push(s.command.join(' ')); return { ok: true }; },
      removeContextFn: async (name: string) => { removed.push(name); },
      print: () => {},
    });
    expect(ran).toEqual(['fly apps destroy a --yes']);
    expect(removed).toEqual(['cloud']);
  });

  it('EXECUTE mode: a failed destroy does NOT remove the context', async () => {
    const removeContextFn = vi.fn();
    await expect(
      runCloudDown({ app: 'a', contextName: 'cloud', execute: true }, {
        runStep: async () => ({ ok: false, code: 1 }),
        removeContextFn: removeContextFn as unknown as CloudDeps['removeContextFn'],
        print: () => {},
      }),
    ).rejects.toThrow(/failed/);
    expect(removeContextFn).not.toHaveBeenCalled();
  });
});
