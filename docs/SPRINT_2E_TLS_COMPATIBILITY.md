# Sprint 2E — Supabase TLS certificate compatibility

Reviewed 2026-10-16 on `sellnova-v2-development`, development project
`sellnova-v2-dev` (`qfcnaceeppgrquoszkor`). Approved transport endpoint:
`aws-0-eu-west-2.pooler.supabase.com:5432`.

## Decision

No migration-runner change is required on the available evidence. Keep
`target.connection_options()` and `migrate.py` unchanged: psycopg receives the
exact pinned host, `sslmode=verify-full` and `sslrootcert=DEV_DB_SSLROOTCERT`.
On Windows, explicitly set the downloaded development project's Supabase Root
2021 PEM file; the default Linux `/etc/ssl/certs/ca-certificates.crt` path is
not portable. Setting the existing CA option is configuration, not a runner fix.

The reported Windows Python probe initially failed with OpenSSL verification
code 92 (CA certificate lacks a key usage extension), then negotiated TLS 1.3
using that CA with only `VERIFY_X509_STRICT` removed. These are user-reported
results, not a live check performed in this sprint.

Python's `ssl.create_default_context()` enables `VERIFY_X509_STRICT` and
`VERIFY_X509_PARTIAL_CHAIN` starting in Python 3.13. Earlier Python versions
can therefore behave differently with the same certificate and OpenSSL version.
Strict mode adds certificate-profile checks, including checks on CA extensions;
removing it retains normal OpenSSL chain verification and hostname checking.
It deliberately accepts some certificates rejected by strict mode, so it must
be a visible, explicit choice rather than a silent retry.

Psycopg uses libpq's OpenSSL TLS path, not Python's `SSLContext`. The PostgreSQL
17 and 18 source reviewed loads the trusted CA, enables `SSL_VERIFY_PEER`, and
checks the peer name for `verify-full`; it does not set `X509_V_FLAG_X509_STRICT`.
Thus Python's code 92 does not establish a corresponding libpq failure.
Nor does a successful Python probe prove actual libpq compatibility: linked
OpenSSL versions, distribution policies, CA files and chain construction can
differ. This environment's pinned psycopg 3.3.6 binary reports libpq 180006;
the Windows installation must record its own implementation and version.

Source references inspected:

- [CPython 3.13 SSL defaults](https://github.com/python/cpython/blob/3.13/Lib/ssl.py),
  `create_default_context()`.
- [PostgreSQL 18 OpenSSL implementation](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/interfaces/libpq/fe-secure-openssl.c),
  `initialize_SSL()` and `open_client_SSL()`; also checked `REL_17_STABLE`.
- [PostgreSQL certificate and hostname verification contract](https://www.postgresql.org/docs/18/libpq-ssl.html#LIBPQ-SSL-CERTIFICATES).

## Small diagnostic-only adjustment

`check_transport.py --probe --supabase-root-2021-compat` removes only Python's
strict verification flag before its first handshake. It requires the pinned
Session Pooler and an explicit, loadable `DEV_DB_SSLROOTCERT`. The certificate
must be obtained and checked through the approved development Supabase dashboard
workflow; the script does not identify a CA by filename or pin its fingerprint.
Do not select this option for an arbitrary CA. It prints the selected policy.
`CERT_REQUIRED`, `check_hostname`, the pinned SNI hostname, all other verification
flags, and TLS protocol defaults remain enabled. There is no automatic fallback,
authentication, SQL or new migration option. Without the flag the prior Python
verification defaults remain intact. No code forces TLS 1.3; the probe reports
the actually negotiated protocol.

## Exact Windows PowerShell verification commands

Run from the repository root on `sellnova-v2-development`. Use an approved
Python 3.14.6 Windows installation and its compatible pinned binary wheels.
The venv can be reused if already prepared. No credentials are needed.

```powershell
git branch --show-current
py -3.14 -m venv .venv-devdb
$py = '.\.venv-devdb\Scripts\python.exe'
& $py -m pip install -r scripts/devdb/requirements.txt
& $py -c "import sys,ssl,psycopg; from psycopg import pq; print(sys.version); print(ssl.OPENSSL_VERSION); print('psycopg',psycopg.__version__,'implementation',pq.__impl__,'libpq',pq.version()); print('Python verify flags',ssl.create_default_context().verify_flags)"
& $py scripts/devdb/test_offline.py
& $py scripts/devdb/check_static.py
& $py scripts/devdb/migrate.py --plan
git diff --check
```

The version command reports Python's OpenSSL version; it does not claim to
report the separate OpenSSL library bundled with psycopg-binary.

For an authorized transport-only check, replace the CA path below with the
actual downloaded development CA path (spaces are supported). Validate its
provenance and fingerprint against the approved Supabase download first.

```powershell
$env:DEV_PROJECT_REF = 'qfcnaceeppgrquoszkor'
$env:VITE_SUPABASE_URL = 'https://qfcnaceeppgrquoszkor.supabase.co'
$env:DEV_DB_CONNECTION_MODE = 'session'
$env:DEV_DB_SSLROOTCERT = 'C:\Users\YOUR_USER\Certificates\prod-supabase.cer'
Test-Path -LiteralPath $env:DEV_DB_SSLROOTCERT -PathType Leaf
Get-FileHash -LiteralPath $env:DEV_DB_SSLROOTCERT -Algorithm SHA256
& $py scripts/devdb/check_transport.py
& $py scripts/devdb/check_transport.py --probe
# Explicit opt-in only for the confirmed Root 2021 strict-extension issue:
& $py scripts/devdb/check_transport.py --probe --supabase-root-2021-compat
```

The `.cer` extension is acceptable only if the file contains PEM certificate
data; a DER file must be converted through the approved certificate workflow.
Stop on any unrecognized certificate or hostname failure. Do not downgrade
verification or substitute a different endpoint. `DEV_DATABASE_URL` is not
needed by these commands and must not be requested or printed.

## Validation and remaining prerequisites

Linux validation: 23 offline safety tests passed; SQL/PLpgSQL static checks
passed for 14 manifest files and 324 statements; offline migration plan and
`git diff --check` passed. New coverage checks real SSL contexts with strict
mode both enabled and removed (including simulated Python 3.13 defaults),
CA loading, mandatory chain/hostname verification, compatibility scoping,
missing/invalid CA refusal, and certificate/hostname failure without retry.
`fixtures/offline-ca.pem` is a synthetic public test CA, never a deployment
trust anchor; its private key is not committed.

Native Windows execution was not available here. Repeat the commands above
there; the code uses stdlib SSL and `Path`, and no Unix path is required when
the existing CA override is configured. The offline context tests use the
portable synthetic PEM fixture, not the Linux trust store.

Still required: working DNS and outbound TCP 5432, the authentic development
CA file, Windows runtime/version verification, and ultimately a separately
authorized actual libpq connection to establish live compatibility. Do not
run `check_identity.py --check`, migrations or any database authentication as
part of this sprint. That identity tool sends startup parameters and SQL and
is not a transport-only check. If a future authorized libpq check fails,
diagnose its actual error and CA chain before proposing any further change.

No remote database checks, authentication, SQL, migrations, production access,
main merge or deployment were performed for Sprint 2E.

## Windows offline-test environment correction

The reported Python 3.14.6 failure occurred inside the real default context
factory, before the test's strict-flag adjustment. The test had cleared the
entire process environment, including Windows `SystemRoot`, immediately before
calling OpenSSL. This is an unsafe test isolation boundary for Windows crypto
initialization. The saved factory calls the original function, so the patch
does not recursively call itself. The synthetic PEM loads successfully here;
no certificate change or TLS policy change is justified by this error.

The two tests that create real contexts now override only `DEV_DB_SSLROOTCERT`,
preserving platform variables. The missing-CA case explicitly sets that variable
empty so an inherited setting cannot change the result. Added regression coverage
preserves `SystemRoot` while creating a real context on all platforms (using its
native value on Windows), with chain and hostname verification still required.
No diagnostic or migration-runner code changed in this correction.

Validation after correction: 24 offline tests and SQL/PLpgSQL static checks
(14 files, 324 statements) passed on Linux. Native Windows Python 3.14.6 was
unavailable; the environment-clearing defect is established by inspection, but
attributing the opaque Windows OpenSSL error specifically to `SystemRoot`
requires rerunning the commands above on that machine. No database connection
is needed to verify this fix.
