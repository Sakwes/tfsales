# Sprint 3C — Store creation helper permissions

Prepared 2026-10-17 for `sellnova-v2-development`, development project
`sellnova-v2-dev` (`qfcnaceeppgrquoszkor`). No remote SQL was executed.

## Cause and reviewed call graph

Seller onboarding inserts `seller_id`, `store_name`, `contact_phone` and requests
the inserted row through the ordinary authenticated Supabase client. The
`sellnova_stores_before_write()` BEFORE INSERT/UPDATE trigger runs as SECURITY
INVOKER (the default), so its nested function calls use the seller's privileges.
`003_permissions_rls.sql` revokes all public `sellnova_*` function privileges from
PUBLIC, anon and authenticated, then selectively restores client entry points.
It omitted two helpers that this invoker trigger requires:

- `sellnova_normalize_phone(text)`: called first by the store trigger; missing
  authenticated EXECUTE produces the observed error.
- `sellnova_slugify(text)`: called next on insertion or store-name change; fixing
  only phone normalization would expose this second failure.

Both functions are immutable SECURITY INVOKER text transformations with a fixed
public search path and no table access or administrative capability. Granting
their exact signatures to authenticated is sufficient for the reviewed store
path. It also permits authenticated RPC calls to these pure transformations.
Anonymous callers remain denied. No trigger is changed to SECURITY DEFINER.

All phone-helper call sites in the repository were reviewed:

- The historical release-1 backfill executes as the migration owner.
- `sellnova_stores_before_write()` runs on store inserts/updates as the caller.
- `handle_new_user()` on `auth.users` INSERT is SECURITY DEFINER, including its
  email-first replacement; it calls normalization only for a nonblank phone.
- `sellnova_create_order(...)` is SECURITY DEFINER, including the development
  replacement in `002_checkout.sql`; its normalization runs as the owner.
- The generated frontend type is an RPC signature, not an execution site.

The store trigger calls no other application helpers. Store RLS calls
`has_role(uuid,app_role)`, which already has client EXECUTE. Store UPDATE also
fires `update_updated_at_column()`, which only sets `NEW.updated_at` using a
built-in function. PostgreSQL checks the trigger function's EXECUTE privilege
when the trigger is created, not for each row fired later; clients do not need
direct EXECUTE on either trigger function. Their ACLs stay restricted.

## Append-only correction

New manifest entry 15:
`database/development/corrections/004_store_helper_permissions.sql`

SHA-256: `599fe6bdc7fd400a96c174a840f612c430620b91186bd56984bf8bc9b4db47cf`

```sql
-- DEVELOPMENT ONLY. Invoker store validation needs these pure text helpers.
DO $$ BEGIN
  IF current_setting('sellnova.dev_project_ref', true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
    RAISE EXCEPTION 'Development runner context required';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.sellnova_normalize_phone(text),
  public.sellnova_slugify(text) TO authenticated;
```

The original 14 SQL files and their ordered manifest entries/checksums are
unchanged. A new offline test pins the original prefix. No table privileges,
policies, ownership checks, function bodies, privileged administrative APIs,
frontend credentials, or TLS configuration change. The runner remains unchanged.

## Validation

Passed offline on Linux: 29 safety tests; SQL/PLpgSQL static checks for 15
manifest files and 326 statements; Python compilation; TypeScript application
and node project checks; diff whitespace checks. Native Windows and live
database behavior are not claimed as validated here.

The integration harness now inserts a newly registered synthetic seller with
the existing auth-trigger fixture mechanism, switches to authenticated with that
seller's claims, then inserts/returns a store with the browser's three fields.
It checks generated slug and Nigerian phone normalization, name/phone updates,
helper ACLs, forged ownership/ownership-transfer rejection, cross-seller update
filtering, anonymous table/helper denial, invalid-phone validation and private
function denial. Exact SQLSTATE checks distinguish validation and permission
failures. All new fixtures are in a rolled-back transaction. Previous fixtures
inserted stores as postgres, which bypassed the missing helper ACLs.

The harness models SQL role/JWT claims; it is not a real Auth API or browser test.
It remains opt-in and refuses projects containing real, non-synthetic Auth users.
Do not run it against the current browser-testing project if real sellers exist;
do not remove its gate or reset the database to make it pass. It was prepared,
compiled and reviewed here, not executed remotely.

## Windows review and application instructions

Run from the repository root on the development branch, using the existing
Python 3.14.6 tools environment:

```powershell
git branch --show-current
$py = '.\.venv-devdb\Scripts\python.exe'
& $py scripts/devdb/test_offline.py
& $py scripts/devdb/check_static.py
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.app.json
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
& $py scripts/devdb/migrate.py --plan
Get-FileHash database/development/corrections/004_store_helper_permissions.sql -Algorithm SHA256
git diff --check
```

The offline plan lists all 15 files; it does not inspect remote history. Review
the SQL and checksum above separately. Ensure Git has retained LF line endings
for SQL files so their raw-byte hashes match the manifest; stop on a mismatch,
never recompute historical checksums to bypass it. The normal runner validates
the live history against a contiguous manifest prefix before changing anything.

**Only after separate execution review and approval**, reuse the securely
configured development-only `DEV_DATABASE_URL` (do not print or paste it), the
approved downloaded PEM CA path, and the exact pinned session tuple:

```powershell
$env:DEV_PROJECT_REF = 'qfcnaceeppgrquoszkor'
$env:VITE_SUPABASE_URL = 'https://qfcnaceeppgrquoszkor.supabase.co'
$env:DEV_DB_CONNECTION_MODE = 'session'
$env:DEV_DB_SSLROOTCERT = 'C:\Users\YOUR_USER\Certificates\prod-supabase.cer'
$env:DEVDB_APPROVAL = 'APPLY-qfcnaceeppgrquoszkor'
try {
    & $py scripts/devdb/migrate.py --apply
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed; stop and inspect safely' }
} finally {
    Remove-Item Env:DEVDB_APPROVAL -ErrorAction SilentlyContinue
}
```

With the existing correct 14-entry history, the runner skips those 14 files,
applies only correction 004, records entry 15 and reruns the existing read-only
postflight catalog assertions in the same transaction. Stop if history/project/
checksum validation fails; do not reset, alter old entries or reapply old files.
No manual SQL-editor application is needed, and no seeds should be rerun.

After approved application, repeat real browser onboarding as a newly registered
seller using the existing development frontend configuration. Confirm store
creation, persisted normalized phone/slug and editing work. Verify a seller
cannot create a store for another user or modify another seller's store. Do not
introduce service-role credentials in the browser. The synthetic integration
harness may be run only with separate test approval in a qualifying synthetic-only
development environment, following its existing runbook and gates.

## Rollback considerations

A failed runner transaction rolls back both grants and the new history row.
After a successful commit, reverting the Git commit does not undo database ACLs.
If a rollback is separately approved, append another guarded, checksummed
migration revoking EXECUTE on these exact two functions FROM authenticated; do
not edit correction 004 or delete history rows. That rollback deliberately
restores the seller store creation/update failure. It removes no store data.
Do not revoke unrelated grants or restore broad PUBLIC access as a workaround.
