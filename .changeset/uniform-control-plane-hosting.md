---
"@piflow/cli": minor
---

Uniform, multi-pathway control-plane hosting. `piflowctl cloud up|down` now takes `--host <fly|railway|selfhost|docker>`
(default `fly` — every existing invocation is unchanged). All four pathways deploy the SAME control-plane image
(`deploy/control-vm/Dockerfile`) with the SAME credential projection (`mintCloudSecrets`) and the SAME acceptance
smoke — a host adapter owns only its provider-CLI steps + URL shape. New pathways: **railway** (`railway up`, same
Dockerfile via `RAILWAY_DOCKERFILE_PATH`), **selfhost** (`piflowctl serve` + a `cloudflared` tunnel for a free
stable URL, no cloud account), and **docker** (generic `docker run` anywhere; operator supplies `--public-url`).
Non-host-derived pathways (docker/selfhost) require `--public-url` before `--execute`.
