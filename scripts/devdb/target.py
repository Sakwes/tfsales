"""Strict development-only target validation. No connection occurs on import."""
import os
from pathlib import Path
from urllib.parse import urlsplit, unquote

PROJECT_REF = 'qfcnaceeppgrquoszkor'
API_URL = f'https://{PROJECT_REF}.supabase.co'
DB_HOST = f'db.{PROJECT_REF}.supabase.co'
APPROVAL = f'APPLY-{PROJECT_REF}'


def connection_options(environ=None):
    env = os.environ if environ is None else environ
    if env.get('DEV_PROJECT_REF') != PROJECT_REF:
        raise ValueError('DEV_PROJECT_REF must match the approved development project')
    if env.get('VITE_SUPABASE_URL', '').rstrip('/') != API_URL:
        raise ValueError('Frontend URL must explicitly target the development project')
    try:
        uri = urlsplit(env.get('DEV_DATABASE_URL', ''))
        valid = (uri.scheme in ('postgres', 'postgresql') and uri.hostname == DB_HOST
                 and (uri.port or 5432) == 5432 and unquote(uri.username or '') == 'postgres'
                 and unquote(uri.path) == '/postgres' and bool(uri.password)
                 and not uri.query and not uri.fragment)
    except ValueError:
        valid = False
    if not valid:
        raise ValueError('Refusing target: only the exact development direct PostgreSQL endpoint is supported; no poolers, query options or alternate hosts')
    root = Path(env.get('DEV_DB_SSLROOTCERT', '/etc/ssl/certs/ca-certificates.crt'))
    if not root.is_file():
        raise ValueError('Supply a trusted TLS root certificate file through DEV_DB_SSLROOTCERT')
    return dict(host=DB_HOST, port=5432, dbname='postgres', user='postgres',
                password=unquote(uri.password), sslmode='verify-full', sslrootcert=str(root),
                connect_timeout=10, application_name='sellnova-development-only')


def connect_verified():
    # Import the driver only after all local identity and credential checks pass.
    options = connection_options()
    import psycopg
    conn = psycopg.connect(**options, autocommit=True)
    # Hostname-validated TLS binds this direct connection to the project endpoint.
    if not conn.pgconn.ssl_in_use:
        conn.close()
        raise ValueError('TLS connection required')
    conn.execute("SET statement_timeout = '120s'")
    conn.execute("SET lock_timeout = '10s'")
    with conn.transaction():
        database, user = conn.execute('SELECT current_database(), session_user').fetchone()
        if (database, user) != ('postgres', 'postgres'):
            raise ValueError('Unexpected database identity')
    return conn
