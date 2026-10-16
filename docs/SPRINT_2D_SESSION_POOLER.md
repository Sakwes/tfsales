# Sprint 2D — Verified development Session Pooler support

Development project: `sellnova-v2-dev` (`qfcnaceeppgrquoszkor`).
Branch: `sellnova-v2-development`. Validation date: 2026-10-15.

## Connection contract

Direct mode remains the default. Select Session Pooler mode explicitly with
`DEV_DB_CONNECTION_MODE=session`; no automatic fallback or transaction mode exists.
Both modes require the exact `DEV_PROJECT_REF=qfcnaceeppgrquoszkor` and
`VITE_SUPABASE_URL=https://qfcnaceeppgrquoszkor.supabase.co`.

| Parameter | Direct | Session Pooler |
| --- | --- | --- |
| Host | `db.qfcnaceeppgrquoszkor.supabase.co` | `aws-0-eu-west-2.pooler.supabase.com` |
| Port | 5432 (may be omitted in URI) | 5432 (explicit in URI) |
| Username | `postgres` | `postgres.qfcnaceeppgrquoszkor` |
| Database | `postgres` | `postgres` |
| Mode | `direct` (default) | `session` |

The Session Pooler tuple was confirmed by the user from the development project's
Supabase dashboard. It is pinned in code, not accepted from an arbitrary host
variable. A password-bearing `DEV_DATABASE_URL` must be configured securely in the
environment, with URI percent encoding where necessary. Never paste it into chat,
logs, command history or Git. The frontend publishable key is not a DB password.

The runner rejects port 6543, port 0, foreign project usernames/hosts, URI query
options and fragments, alternate databases, unknown modes and raw control
characters. URI options cannot override libpq host, TLS settings or services.
Direct mode rejects pooler URIs and session mode rejects direct URIs.

## TLS and identity safeguards

See [Sprint 2E TLS compatibility](SPRINT_2E_TLS_COMPATIBILITY.md) for the
Python 3.13 strict-extension distinction, explicit diagnostic compatibility
option and Windows CA configuration. The migration runner retains `verify-full`.

Both modes internally construct `sslmode=verify-full`, a trusted CA file,
connection timeout and the exact approved hostname. The default CA bundle is
`/etc/ssl/certs/ca-certificates.crt`; `DEV_DB_SSLROOTCERT` can name a trusted CA
file obtained through the approved Supabase certificate workflow. Its existence
is checked locally; actual chain and hostname validation occur at TLS handshake.
Never disable certificate/hostname verification or downgrade to require-only.

Direct TLS authenticates the project-specific database hostname. Shared pooler
TLS authenticates the shared endpoint; development identity additionally depends
on the exact pinned tenant username and development credentials. Backend checks
require database `postgres` and session role `postgres`. Those common names alone
are not proof of project identity. The expected backend role still needs live
verification; unexpected values fail closed, with no relaxed fallback.

Failed TLS/session checks close the connection. Connections are never retried or
replayed automatically. Session mode preserves the single-backend-session
semantics needed by the existing harness. The migration runner itself is
unchanged: checksums, project/history validation, fresh-database checks, explicit
execution approval, one transaction and advisory lock remain in place. All
migration SQL, seeds and manifest hashes remain unchanged.

## Separate diagnostic stages

These are instructions for a future authorized connectivity check, not migration
execution instructions. Securely configure the non-secret identity variables
above before probing; set the mode explicitly for each endpoint.

1. `python scripts/devdb/check_transport.py` defaults to offline help.
2. `python scripts/devdb/check_transport.py --probe` performs per-family DNS,
   TCP 5432, PostgreSQL SSLRequest and verified TLS. It sends no credentials,
   authentication or SQL. A failed family lookup does not prevent trying another
   resolved family. DNS failure stops before TCP; TCP/negotiation/TLS errors are
   reported separately, without printing driver messages or connection strings.
3. Only after transport succeeds and development credentials are securely
   provided, `python scripts/devdb/check_identity.py --check` is the separate
   opt-in identity check. Its default invocation does not connect. The check
   verifies TLS, then explicitly sets and verifies transaction read-only state
   before reading backend identity in that same transaction. It performs session
   timeout settings and read-only identity queries, no schema/data writes.
   Enforcement/status failure stops before identity queries and closes the
   connection. See [Sprint 2F](SPRINT_2F_READ_ONLY_IDENTITY.md) for the startup
   setting compatibility correction. It cannot run migrations. Errors print
   exception types only.
4. Stop before any migration or write test. This sprint does not authorize
   `migrate.py --apply`, integration `--run`, seeds, admin provisioning or DDL.

Read-only mode guards accidental writes, but it does not establish tenant
identity independently of the authenticated connection contract.

## Results and remaining blockers

| Validation | Result |
| --- | --- |
| Offline safety tests | 20 passed, including direct/session positives, foreign hosts/tenants, TLS failure, identity mismatch, no-retry, no-connection defaults and secret-safe error output |
| SQL/PLpgSQL static validation | Passed: 14 manifest files, 324 SQL statements; historical dependency order and development guards checked |
| Default migration plan | Passed offline; no connection or SQL execution |
| TypeScript app and node projects | Both passed |
| ESLint | Passed: 0 errors, 14 existing warnings |
| Production build | Passed; existing large-chunk warning remains |
| Session endpoint DNS probe | IPv4 and IPv6 both fail with EAI_AGAIN (-3) |
| Session endpoint TCP / TLS | Not attempted because DNS failed |
| Live read-only identity | Not attempted: DNS blocked and DEV_DATABASE_URL absent |

The existing pinned Python tools in `/tmp/sellnova-static-tools` were reused for
SQL grammar validation. Reproducible dependency versions are already recorded in
`scripts/devdb/requirements.txt`. No new application dependencies are required.

Required checks can be repeated offline:

```sh
python scripts/devdb/test_offline.py
python scripts/devdb/check_static.py
python scripts/devdb/migrate.py --plan
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json
npm run lint
npm run build
```

Install/use the existing pinned Python requirements in an isolated tools
environment before the static checker; frontend build requires injected
approved development variables to avoid the tracked production dotenv fallback.

Session Pooler support does not resolve the environment's DNS restrictions.
An administrator must restore DNS and confirm supported raw outbound TCP 5432
access to the approved host. HTTPS proxy availability alone is insufficient for
psycopg. The previous diagnostic also found no usable outbound IPv6 route;
Session Pooler is an IPv4 alternative, subject to working DNS and egress.
Configure development credentials securely and verify the actual trusted TLS
chain before attempting read-only authentication. Do not request passwords in chat.

## Scope and preservation

Changed files: `scripts/devdb/target.py`, `scripts/devdb/check_transport.py`,
`scripts/devdb/test_offline.py`, new `scripts/devdb/check_identity.py` and this
runbook. No application behavior, migration SQL or historical checksums changed.
The pre-existing untracked Sprint 2 verification document is preserved and is
excluded from this commit.

The guarded tools refuse production targets before connecting. Environment-wide
production network isolation is not established by these checks. No production
requests or credentials were used; no remote SQL, migrations, seeds, synthetic
writes or table changes occurred. No merge, deployment or main modification.

Future migration execution still requires separate explicit approval under the
[Sprint 2A runbook](SPRINT_2A_DATABASE_PREPARATION.md). If approved connection checks
fail, stop and repair the prerequisite; do not change targets or weaken TLS.
