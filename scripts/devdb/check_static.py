#!/usr/bin/env python3
"""Offline SQL/PLpgSQL grammar, manifest/dependency and execution-boundary checks."""
import hashlib
import json
import re
from pathlib import Path
from pglast import parse_sql, parser
from migrate import ROOT, load_plan


def main():
    if not __debug__:
        raise RuntimeError('Static checks must run without Python optimization')
    files=load_plan()
    journal=json.loads((ROOT/'drizzle/migrations/meta/_journal.json').read_text())
    historical=[str(p.relative_to(ROOT)) for p in sorted((ROOT/'supabase/migrations').glob('*.sql'))]
    historical += ['drizzle/migrations/'+entry['tag']+'.sql' for entry in journal['entries']]
    assert [p for p,_,_ in files[:8]] == historical
    statements=0
    for path,_,sql in files:
        tree=parse_sql(sql)
        assert not any(type(n.stmt).__name__=='TransactionStmt' for n in tree), path
        statements += len(tree)
        # Backend-free parser checks function body grammar, not catalog resolution.
        parser.parse_plpgsql_json(sql)
        if path.startswith('database/development/'):
            assert re.search(r"current_setting\('sellnova\.dev_project_ref',\s*true\)", sql), path
    for path in sorted((ROOT/'database/development/tests').glob('*.sql')):
        parse_sql(path.read_text())
        parser.parse_plpgsql_json(path.read_text())
    print(f'PASS: {len(files)} manifest files, {statements} SQL statements; SQL and PL/pgSQL grammar parsed offline')
    print('PASS: eight historical files match dependency order; no transaction controls; development guards present')
    print('No connections, migrations, SQL execution or writes performed')


if __name__=='__main__':
    main()
