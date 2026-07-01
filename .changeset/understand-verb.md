---
"@piflow/cli": minor
---

Add `piflowctl understand [subsystem] [--check|--rebuild]` — the user-facing front door to the code-understanding
slices (`.agents/okf/topics/`). It FINDs the slice that owns a subsystem/file/symbol (ownership beats a bare prose
mention), runs the drift gate (`--check`, blocks only on a moved anchor), and regenerates the machine-derived
regions (`--rebuild`). A thin wrapper over the one repo-local engine, so it never drifts from the pre-commit hook;
errors clearly when a repo has no `.agents/okf/` substrate.

Renames the skills add-on id `okf` → `understand` (`skills install --with understand`) so the typed surface no
longer exposes the internal "OKF" acronym. The legacy `okf` id still resolves (back-compat alias), in both
`--with` and an existing `.piflow/skills.json`.
