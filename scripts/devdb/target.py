"""Strict development-only target validation. No connection occurs on import."""
import os
from pathlib import Path
from urllib.parse import urlsplit, unquote

PROJECT_REF = 'qfcnaceeppgrquoszkor'
API_URL = f'https://{PROJECT_REF}.supabase.co'
DB_HOST = f'db.{PROJECT_REF}.supabase.co'
SESSION_HOST = 'aws-0-eu-west-2.pooler.supabase.com'
SESSION_USER = f'postgres.{PROJECT_REF}'
APPROVAL = f'APPLY-{PROJECT_REF}'


def endpoint(environ=None):
    """Explicit dashboard-pinned endpoint; never infer or fall back between modes."""
    env = os.environ if environ is None else environ
    if env.get('DEV_PROJECT_REF') != PROJECT_REF:
        raise ValueError('DEV_PROJECT_REF must match the approved development project')
    if env.get('VITE_SUPABASE_URL', '').rstrip('/') != API_URL:
        raise ValueError('Frontend URL must explicitly target the development project')
    mode = env.get('DEV_DB_CONNECTION_MODE', 'direct')
    if mode == 'direct':
        return DB_HOST, 'postgres'
    if mode == 'session':
        return SESSION_HOST, SESSION_USER
    raise ValueError('Only explicit direct or session connection modes are supported')


def trusted_root(environ=None):
    env = os.environ if environ is None else environ
    root = Path(env.get('DEV_DB_SSLROOTCERT', '/etc/ssl/certs/ca-certificates.crt'))
    if not root.is_file():
        raise ValueError('Supply a trusted TLS root certificate file through DEV_DB_SSLROOTCERT')
    return str(root)


def connection_options(environ=None):
    env = os.environ if environ is None else environ
    host, user = endpoint(env)
    try:
        raw_uri = env.get('DEV_DATABASE_URL', '')
        uri = urlsplit(raw_uri)
        # Reject controls before urlsplit can normalize them away.
        clean = not any(ord(char) <= 32 or ord(char) == 127 for char in raw_uri)
        port_ok = uri.port == 5432 if user == SESSION_USER else uri.port in (None, 5432)
        valid = (clean and uri.scheme in ('postgres', 'postgresql') and uri.hostname == host
                 and port_ok and unquote(uri.username or '') == user
                 and unquote(uri.path) == '/postgres' and bool(uri.password)
                 and not uri.query and not uri.fragment)
    except ValueError:
        valid = False
    if not valid:
        raise ValueError('Refusing target: exact approved development host, mode, role, database and port required; no URI overrides')
    return dict(host=host, port=5432, dbname='postgres', user=user,
                password=unquote(uri.password), sslmode='verify-full', sslrootcert=trusted_root(env),
                connect_timeout=10, application_name='sellnova-development-only')


def connect_verified(*, read_only=False):
    # Import the driver only after all local identity and credential checks pass.
    options = connection_options()
    if read_only:
        options['options'] = '-c default_transaction_read_only=on'
    import psycopg
    conn = psycopg.connect(**options, autocommit=True)
    try:
        # Shared-host TLS authenticates the pooler; the pinned tenant username
        # plus password authenticates routing to the development project.
        if not conn.pgconn.ssl_in_use:
            raise ValueError('TLS connection required')
        conn.execute("SET statement_timeout = '120s'")
        conn.execute("SET lock_timeout = '10s'")
        with conn.transaction():
            database, user = conn.execute('SELECT current_database(), session_user').fetchone()
            if (database, user) != ('postgres', 'postgres'):
                raise ValueError('Unexpected database identity')
            if read_only and conn.execute('SHOW transaction_read_only').fetchone()[0] != 'on':
                raise ValueError('Read-only connection required')
        return conn
    except BaseException:
        conn.close()
        raise
