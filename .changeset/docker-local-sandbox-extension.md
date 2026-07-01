---
"@piflow/docker": minor
"@piflow/cli": patch
---

Add `@piflow/docker` — the LOCAL Docker-container sandbox backend, packaged as a choose-to-install extension (`npm i @piflow/docker`; the CLI loads it dynamically on `--sandbox docker`). One local Docker container per run (per-node workdir subtrees, removed once) behind `@piflow/core`'s existing sandbox seam, booting the SAME pi node-runtime image the cloud backends use (`deploy/docker/Dockerfile`, from the shared `deploy/pi-runtime` spec). It is the OFFLINE, FREE mirror of the Daytona/E2B path — same image, same credential injection (a container is a `CLOUD_KIND`: no host env, creds cross via the declared allowlist, `~/.pi/agent/models.json` staged in), same tool binding — NOT a stronger isolation tier than `--sandbox local` seatbelt. Talks to the `docker` CLI only (no daemon-client dependency); the provider is dependency-free and unit-tested against a fake SDK.
