#!/usr/bin/env python3
"""Prepare/approve a synthetic application-admin grant; never promote real users."""
import argparse
import os
from uuid import UUID
from target import PROJECT_REF, connect_verified


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('user_id',type=UUID)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    if not args.apply:
        print('PLAN ONLY: synthetic-user checks and admin grant require explicit --apply; no connection')
        return 0
    if os.environ.get('DEVDB_ADMIN_APPROVAL')!='PROMOTE-SYNTHETIC-'+PROJECT_REF:
        print('STOP: explicit synthetic admin approval required')
        return 1
    try:
        with connect_verified() as conn,conn.transaction():
            conn.execute('SELECT pg_advisory_xact_lock(728410215)')
            user=conn.execute('SELECT email,raw_user_meta_data FROM auth.users WHERE id=%s FOR UPDATE',(args.user_id,)).fetchone()
            if not user or not (user[0] or '').endswith('@example.test') or user[1].get('sellnova_synthetic_test') is not True:
                raise ValueError('Only explicitly tagged reserved-domain synthetic users may be promoted')
            conn.execute("INSERT INTO public.user_roles(user_id,role) VALUES(%s,'admin') ON CONFLICT(user_id,role) DO NOTHING",(args.user_id,))
            print('Synthetic development admin grant prepared; transaction will commit')
    except Exception as error:
        print('STOP:',type(error).__name__,'(details suppressed)')
        return 1
    return 0


if __name__=='__main__':
    raise SystemExit(main())
