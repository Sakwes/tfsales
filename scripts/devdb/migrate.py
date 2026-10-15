#!/usr/bin/env python3
"""Default is an offline, checksummed plan. --apply requires separate approval."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from target import PROJECT_REF, APPROVAL, connect_verified

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'database/development/manifest.json'


def load_plan():
    manifest = json.loads(MANIFEST.read_text())
    if manifest['project_ref'] != PROJECT_REF:
        raise ValueError('Manifest project mismatch')
    files = []
    for entry in manifest['files']:
        path = (ROOT / entry['path']).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file():
            raise ValueError('Unsafe/missing manifest path')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('Migration checksum mismatch: ' + entry['path'])
        files.append((entry['path'], entry['sha256'], data.decode()))
    if len({x[0] for x in files}) != len(files):
        raise ValueError('Duplicate manifest path')
    if 'database/development/tests/postflight.sql' not in {path for path,_,_ in files}:
        raise ValueError('Manifest must include reviewed catalog assertions')
    return files


def apply(files):
    if os.environ.get('DEVDB_APPROVAL') != APPROVAL:
        raise ValueError('Execution is locked: explicit development approval acknowledgment required')
    with connect_verified() as conn, conn.transaction():
        conn.execute("SET LOCAL lock_timeout = '10s'")
        conn.execute("SET LOCAL statement_timeout = '120s'")
        conn.execute('SELECT pg_advisory_xact_lock(728410215)')
        conn.execute("SELECT set_config('sellnova.dev_project_ref', %s, true)", (PROJECT_REF,))
        if conn.execute("SELECT to_regclass('sellnova_dev.migration_history')").fetchone()[0] is None:
            existing = conn.execute("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND NOT EXISTS
              (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e')""").fetchone()[0]
            if existing or conn.execute('SELECT EXISTS(SELECT 1 FROM auth.users)').fetchone()[0]:
                raise ValueError('Untracked nonempty database: stop for manual reconciliation; no automatic adoption/reset')
            if conn.execute("SELECT EXISTS(SELECT 1 FROM storage.buckets)").fetchone()[0]:
                raise ValueError('Untracked storage buckets: stop for manual reconciliation')
            conn.execute('CREATE SCHEMA sellnova_dev')
            conn.execute('REVOKE ALL ON SCHEMA sellnova_dev FROM PUBLIC, anon, authenticated, service_role')
            conn.execute('''CREATE TABLE sellnova_dev.migration_history
              (path text PRIMARY KEY, sha256 text NOT NULL, project_ref text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())''')
        rows = conn.execute('SELECT path, sha256, project_ref FROM sellnova_dev.migration_history ORDER BY applied_at, path').fetchall()
        known = {path: digest for path, digest, _ in files}
        if any(ref != PROJECT_REF or path not in known or known[path] != digest for path, digest, ref in rows):
            raise ValueError('Unexpected history/project/checksum: append reviewed corrections; never edit applied files')
        applied = {row[0] for row in rows}
        if applied != {path for path, _, _ in files[:len(applied)]}:
            raise ValueError('Migration history is not a contiguous manifest prefix')
        required = conn.execute("SELECT to_regclass('auth.users'), to_regclass('storage.buckets'), to_regprocedure('auth.uid()')").fetchone()
        if not all(required):
            raise ValueError('Supabase managed auth/storage prerequisites missing')
        extension_schema = conn.execute("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'").fetchone()
        if extension_schema and extension_schema[0] != 'extensions':
            raise ValueError('pgcrypto schema mismatch; historical SQL requires extensions.gen_random_bytes')
        for path, digest, sql in files:
            if path in applied:
                print('UNCHANGED', path)
                continue
            conn.execute(sql, prepare=False)
            conn.execute('INSERT INTO sellnova_dev.migration_history(path,sha256,project_ref) VALUES (%s,%s,%s)', (path,digest,PROJECT_REF))
            print('PREPARED', path)  # Entire chain and history commit together below.
        postflight = next(entry for entry in files if entry[0] == 'database/development/tests/postflight.sql')
        if postflight[0] in applied:
            conn.execute(postflight[2], prepare=False)
    print('Development migration transaction committed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--plan', action='store_true', help='Offline plan only (default)')
    actions.add_argument('--apply', action='store_true', help='Connect and apply only after explicit approval')
    args = parser.parse_args()
    try:
        files = load_plan()
        if not args.apply:
            print('OFFLINE PLAN ONLY — no database connection or SQL execution')
            print('Target:', PROJECT_REF)
            for index, (path, digest, _) in enumerate(files, 1):
                print(f'{index:02d} {digest} {path}')
        else:
            apply(files)
    except Exception as exc:
        # Connection strings, passwords, SQL rows and driver details must never leak.
        print('STOP:', str(exc) if isinstance(exc, ValueError) else type(exc).__name__)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
