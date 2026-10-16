#!/usr/bin/env python3
"""Opt-in development-only read-only PostgreSQL identity check; never migrations."""
import argparse
from target import connect_verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if not args.check:
        print('PLAN ONLY: --check authenticates and checks identity in a verified read-only transaction')
        return 0
    try:
        with connect_verified(read_only=True):
            print('PASS: verified TLS, pinned development routing, postgres database/role in a verified read-only transaction')
        return 0
    except Exception as error:
        # Driver messages may contain connection details. Never print them.
        print('BLOCKED: read-only identity check:', type(error).__name__)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
