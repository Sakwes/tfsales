# Sprint 2F — Explicit read-only identity transaction

Development project: `sellnova-v2-dev` (`qfcnaceeppgrquoszkor`). Branch:
`sellnova-v2-development`. Reviewed 2026-10-16.

## Finding and correction

The Windows Python 3.14.6 findings supplied by the user establish successful
Session Pooler authentication, active TLS and expected database/role, but not
effective read-only state from the startup `default_transaction_read_only=on`
option. An explicit transaction with `SET TRANSACTION READ ONLY` did report `on`.
These are supplied findings; no remote execution was performed in this sprint.

A startup `options=-c ...` session default depends on forwarding and handling
by the pooler and its backend session lifecycle. The observation does not
distinguish an ignored startup option, a reset default, or other pooler handling;
it does not prove this endpoint is operating in transaction-pooling mode.
Session defaults are insufficient evidence of the active transaction's mode.
The old implementation also queried identity before checking that mode.

`connect_verified(read_only=True)` no longer supplies the unreliable startup
option. After unchanged TLS validation and session timeout settings, it opens
a psycopg transaction (on the existing autocommit connection), executes
`SET TRANSACTION READ ONLY`, then `SHOW transaction_read_only`. Only an exact
`('on',)` result permits `SELECT current_database(), session_user`. Both values
must still equal `postgres`. All three statements share one transaction. Any
enforcement, status, identity, or connection error fails closed: transaction
context cleanup occurs and the connection is closed without retry.

Read-only protection is scoped to this identity transaction. The helper returns
after the transaction ends; it does not promise that future transactions on
the returned connection are read-only. `check_identity.py` closes the connection
without executing further SQL. Its success text now states that scope.

Exact project/API/host/port/tenant validation, credential handling, trusted CA
configuration and `sslmode=verify-full` remain unchanged. Shared pooler TLS alone
does not establish tenant identity; the pinned development routing and credentials
remain necessary. The default `connect_verified()` path, migration runner,
approval gates, migration SQL, checksums and write permissions are unchanged.

## Offline validation and Windows instructions

From the repository root, with the existing Windows tools environment:

```powershell
git branch --show-current
$py = '.\.venv-devdb\Scripts\python.exe'
& $py -c "import sys; print(sys.version)"
& $py scripts/devdb/test_offline.py
& $py scripts/devdb/check_static.py
git diff --check
```

If the tools environment is not prepared, use the approved Python 3.14.6:

```powershell
py -3.14 -m venv .venv-devdb
& .\.venv-devdb\Scripts\python.exe -m pip install -r scripts/devdb/requirements.txt
```

Linux validation passed: 27 offline safety tests; SQL/PLpgSQL static checks for
14 manifest files and 324 statements; Python compilation and diff checks.
Tests cover enforcement/query order, shared transaction scope, setting/status
errors, off/missing status, wrong database/role, cleanup/no retry, CLI opt-in,
and unchanged default connection behavior for both direct and session targets.
Existing TLS, routing, secret-safe failure and migration approval tests pass.
Native Windows execution remains to be repeated by the developer.

The following is a **future remote verification step**, documented only and
not executed here. It requires separate authorization to authenticate and run
read-only remote SQL. Reuse the securely configured development credentials;
do not paste, print or commit them. Set only the non-secret routing and approved
CA file path shown below; substitute the actual approved downloaded PEM path.

```powershell
$env:DEV_PROJECT_REF = 'qfcnaceeppgrquoszkor'
$env:VITE_SUPABASE_URL = 'https://qfcnaceeppgrquoszkor.supabase.co'
$env:DEV_DB_CONNECTION_MODE = 'session'
$env:DEV_DB_SSLROOTCERT = 'C:\Users\YOUR_USER\Certificates\prod-supabase.cer'
& $py scripts/devdb/check_identity.py
# Only after separate authorization for remote read-only verification:
& $py scripts/devdb/check_identity.py --check
```

The first invocation is offline. The opt-in invocation authenticates, verifies
TLS and transaction mode before identity queries, then closes the connection.
Expected result: `PASS: verified TLS, pinned development routing, postgres
database/role in a verified read-only transaction`. A `BLOCKED` result requires
diagnosis; do not change the target, downgrade TLS, bypass read-only checks,
or proceed to migrations. The standalone Python TLS compatibility flag is
unrelated to psycopg/libpq and is not accepted by the identity checker.

No database connections, remote SQL, migrations, seeds, database writes,
production access, main merge or deployment were performed for this change.
