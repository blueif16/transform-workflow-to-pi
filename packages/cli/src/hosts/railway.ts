// The Railway host adapter — the SAME control-VM image on Railway's builder (design:
// docs/design/control-plane-hosting-uniform.md §4-railway). `railway up --detach` builds the identical
// `deploy/control-vm/Dockerfile` server-side; the host only supplies secrets (as env variables) + a public
// domain, exactly like fly. It owns the same four leaks the MAP found: the `.up.railway.app` URL shape
// (`appUrl`), the argv of its provider-CLI steps, and its render tag (`id`/`label`).
//
// Everything else — the .dockerignore copy/rm dance (railway's builder reads a repo-root Dockerfile +
// .dockerignore, same as fly) and the secrets-set redaction — comes from the SHARED step factories in
// `cloud.ts`, so redaction lives in exactly one place across all hosts. `secretsSetStep` builds the
// `NAME=VALUE` pairs (secrets `***`-redacted in the display, the labeled non-secret gateway config shown as
// `<gateway:…>`) and hands them to a railway-shaped argv (`railway variables --set K=V …`).
//
// Dockerfile targeting: `railway up` doesn't take a `--dockerfile` flag, so we point it at the SAME
// control-VM Dockerfile via the `RAILWAY_DOCKERFILE_PATH` env on the deploy step (the doc §11 alternative to
// copying it to the repo root). The step's `env` rides the same `DeployStep` field the smoke uses.

import type { HostAdapter } from './adapter.js';
import { copyDockerignoreStep, rmDockerignoreStep, secretsSetStep } from '../cloud.js';

export const railwayAdapter: HostAdapter = {
  id: 'railway',
  label: 'railway',
  urlIsHostDerived: true,

  // Railway's default public origin is `https://<service>.up.railway.app` — a deterministic guess the
  // `railway domain` step confirms; an operator who already has a custom domain passes it as `--public-url`.
  appUrl: (app, { publicUrl }) => publicUrl ?? `https://${app}.up.railway.app`,

  upSteps: (c) => [
    // railway's builder reads ONLY a context-root Dockerfile + .dockerignore (same as fly) — stage then clean.
    copyDockerignoreStep(),
    // `railway variables --set K=V --set K=V …` stages each secret as a service env var — the SAME {name,value}
    // shape fly's `fly secrets set` takes, redacted identically via the shared factory.
    secretsSetStep(c, (pairs) => ['railway', 'variables', ...pairs.flatMap((p) => ['--set', p])]),
    {
      id: 'deploy',
      kind: 'host',
      command: ['railway', 'up', '--detach', '--service', c.app],
      display: `railway up --detach --service ${c.app}`,
      outward: true,
      paid: true,
      // Point railway's builder at the SAME control-VM Dockerfile (no image change across hosts).
      env: { RAILWAY_DOCKERFILE_PATH: c.dockerfile },
      note: 'the operator\'s paid step — builds the SAME deploy/control-vm/Dockerfile on Railway + deploys.',
    },
    {
      id: 'domain',
      kind: 'host',
      command: ['railway', 'domain'],
      display: 'railway domain',
      outward: true,
      idempotent: true,
      note: 'ensures a public https domain; copy it into --public-url if the smoke URL was a guess.',
    },
    rmDockerignoreStep(),
  ],

  downSteps: () => [
    {
      id: 'railway-down',
      kind: 'host',
      command: ['railway', 'down', '--yes'],
      display: 'railway down --yes',
      outward: true,
      note: 'DESTRUCTIVE — removes the service deployment.',
    },
  ],
};
