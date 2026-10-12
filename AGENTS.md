# AGENTS.md

## Unwritten
- Publishing: there is no CD. Production is updated by hand on the server per `deploy/README.md` (`git pull --ff-only`, then `docker compose -f docker-compose.prod.yml up -d --build`), and server-side edits go only through git. `luki-api` applies Alembic migrations itself on every start (`backend/docker-entrypoint.sh`).
- Gotchas: every production service must be named `luki-*` (a CI step enforces it): `luki-web` and `luki-api` join the external network of the patrol journal (JiraJura), where an unprefixed `api` or `db` would hijack JiraJura's DNS names; never run `docker compose down` on the JiraJura project while this app runs, since it tries to remove that shared network.
- Checks: `cd backend && python -m pytest -q` (tests create and drop their own DB via `TEST_DATABASE_URL` and stub JiraJura, no network needed); `cd frontend && npm run lint && npm run build && npm test`. CI also runs `ruff check` and `ruff format --check` on `app tests alembic`, `mypy app`, pip-audit, npm audit, gitleaks, trivy, and Compose/nginx config validation.
- Conventions: UI text, README, and `docs/DECISIONS.md` are in Russian; `docs/DECISIONS.md` is append-only, newest on top, only for decisions not recoverable from code. Commit subjects are Russian sentences naming the user-visible effect, squash-merged with `(#N)`. Help texts live in `frontend/src/lib/faq.ts`, and `frontend/tests/faq-labels.test.ts` checks that labels in «ёлочки» match the UI.
- Why: login forwards the client address in `X-Real-IP` because JiraJura rate-limits login attempts by it; without it all employees share one address and lock each other out. The token is not silently refreshed, so users disabled in JiraJura drop out; expiry shows a re-login dialog instead. A card stores the territory name as of fixing (`cards.address`), and territories missing from a new registry export are disabled, never deleted, because cards reference them.
- Off-limits: `backend/data/territories.json.gz` is built by `backend/tools/build_territories.py` from a registry export (see `README.md`); regenerate it, never edit by hand. `SECRET_KEY` and `POSTGRES_PASSWORD` in the server `.env` must not change after first start (logs everyone out / cuts the API off its DB).

## Pointers
- **Writing** or reviewing code: apply `CODING_STANDARDS.md`; project config and linters win where they disagree.
- **Security**-sensitive change (auth, permissions, untrusted input, secrets): read `docs/agents/security.md` first.
- **Committing** or opening a PR: follow `docs/agents/git.md`.
- **Risky** change (spans modules, migrates data, alters a public API): propose a phased plan and get approval before editing.
- **Done** means you ran the project's own check commands and they are green, or you named the ones you could not run.
