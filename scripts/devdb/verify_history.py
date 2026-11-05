#!/usr/bin/env python3
"""Opt-in, read-only verification of the approved development migration ledger."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from migrate import load_plan
from target import PROJECT_REF, connect_verified


def compare_history(rows, expected):
    actual = [(path, checksum, project) for path, checksum, project in rows]
    wanted = {(path, checksum, PROJECT_REF) for path, checksum, _ in expected}
    if len(actual) != len(wanted) or set(actual) != wanted:
        raise ValueError('Deployed history does not match the exact reviewed manifest prefix')
    return [{'path': path, 'sha256': checksum, 'project_ref': PROJECT_REF} for path, checksum, _ in expected]


def verify(expected_count=18):
    plan = load_plan()
    if not 18 <= expected_count <= len(plan):
        raise ValueError('Expected history count must identify a reviewed prefix of at least eighteen entries')
    expected = plan[:expected_count]
    with connect_verified(read_only=True) as conn:
        # connect_verified protects its identity transaction only. Protect this separate read too.
        with conn.transaction():
            conn.execute('SET TRANSACTION READ ONLY')
            if conn.execute('SHOW transaction_read_only').fetchone() != ('on',):
                raise ValueError('Read-only transaction required before reading migration history')
            rows = conn.execute('SELECT path,sha256,project_ref FROM sellnova_dev.migration_history').fetchall()
            entries = compare_history(rows, expected)
    return {'project_ref': PROJECT_REF, 'checked_at': datetime.now(timezone.utc).isoformat(),
            'expected_count': expected_count, 'matches': True,
            'expected_prefix_sha256': hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest(),
            'entries': entries}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--expected-count', type=int, default=18)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not args.check:
        print('PLAN ONLY: --check verifies the development ledger in a read-only transaction; no migration execution')
        return 0
    try:
        result = verify(args.expected_count)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
        print(json.dumps(result, indent=2))
        return 0
    except Exception as error:
        # Do not print driver messages, URIs, credentials or untrusted database error detail.
        print('BLOCKED: development history verification:', type(error).__name__)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
