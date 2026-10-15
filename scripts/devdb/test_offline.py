"""No database driver/network required for these safety checks."""
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import migrate
import target
import integration
import auth_contract
import provision_admin
import check_identity
import check_transport


class OfflineSafetyTests(unittest.TestCase):
    def setUp(self):
        self.cert=tempfile.NamedTemporaryFile()
        self.env={'DEV_PROJECT_REF':target.PROJECT_REF,'VITE_SUPABASE_URL':target.API_URL,
            'DEV_DATABASE_URL':f'postgresql://postgres:synthetic-not-a-secret@{target.DB_HOST}:5432/postgres',
            'DEV_DB_SSLROOTCERT':self.cert.name}

    def tearDown(self):self.cert.close()

    def test_exact_development_target_requires_verified_tls(self):
        options=target.connection_options(self.env)
        self.assertEqual(options['host'],target.DB_HOST)
        self.assertEqual(options['sslmode'],'verify-full')

    def session_env(self):
        return dict(self.env, DEV_DB_CONNECTION_MODE='session',
                    DEV_DATABASE_URL=f'postgresql://{target.SESSION_USER}:synthetic-not-a-secret@{target.SESSION_HOST}:5432/postgres')

    def test_exact_session_target_requires_verified_tls(self):
        options = target.connection_options(self.session_env())
        self.assertEqual(options['host'], target.SESSION_HOST)
        self.assertEqual(options['user'], target.SESSION_USER)
        self.assertEqual(options['port'], 5432)
        self.assertEqual(options['sslmode'], 'verify-full')
        self.assertEqual(options['sslrootcert'], self.cert.name)

    def test_session_rejects_foreign_targets_and_unsafe_overrides(self):
        env = self.session_env()
        original = env['DEV_DATABASE_URL']
        replacements = [
            original.replace(':5432', ':6543'), original.replace(':5432', ''),
            original.replace(target.SESSION_USER, 'postgres.other-project'),
            original.replace(target.SESSION_USER, 'postgres'),
            original.replace(target.SESSION_HOST, target.DB_HOST),
            original.replace(target.SESSION_HOST, 'aws-0-eu-west-1.pooler.supabase.com'),
            original.replace(target.SESSION_HOST, 'db.tepvbliaxwgbdeisttgj.supabase.co'),
            original.replace(target.SESSION_HOST, target.SESSION_HOST + '.attacker.test'),
            original.replace('/postgres', '/another'), original + '#fragment',
            original + '?sslmode=disable', original + '?hostaddr=127.0.0.1',
            original + '?service=production', original.replace('postgresql:', 'file:'),
            original.replace('synthetic-not-a-secret', ''), original + '\n',
        ]
        for index, uri in enumerate(replacements):
            with self.subTest(case=index):
                with self.assertRaises(ValueError):
                    target.connection_options(dict(env, DEV_DATABASE_URL=uri))
        for mode in ('direct', 'transaction', '', 'SESSION'):
            with self.subTest(mode=mode):
                with self.assertRaises(ValueError):
                    target.connection_options(dict(env, DEV_DB_CONNECTION_MODE=mode))
        for override in ({'DEV_PROJECT_REF': 'other'}, {'VITE_SUPABASE_URL': 'https://other.supabase.co'},
                         {'DEV_DB_SSLROOTCERT': '/does-not-exist'}):
            with self.assertRaises(ValueError):
                target.connection_options(dict(env, **override))

    def test_mocked_connection_identity_tls_and_read_only(self):
        for env in (self.env, self.session_env()):
            conn = MagicMock()
            conn.pgconn.ssl_in_use = True
            conn.execute.return_value.fetchone.side_effect = [('postgres', 'postgres'), ('on',)]
            driver = MagicMock()
            driver.connect.return_value = conn
            with patch.dict(os.environ, env, clear=True), patch.dict('sys.modules', psycopg=driver):
                self.assertIs(target.connect_verified(read_only=True), conn)
            self.assertEqual(driver.connect.call_count, 1)
            self.assertEqual(driver.connect.call_args.kwargs['sslmode'], 'verify-full')
            self.assertEqual(driver.connect.call_args.kwargs['options'], '-c default_transaction_read_only=on')
            conn.close.assert_not_called()

    def test_failed_tls_identity_and_connection_never_retry(self):
        import ssl
        for failure in ('no_tls', 'identity', 'read_only', 'certificate', 'disconnect'):
            with self.subTest(failure=failure):
                conn = MagicMock()
                conn.pgconn.ssl_in_use = failure != 'no_tls'
                rows = [('wrong', 'postgres')] if failure == 'identity' else [('postgres', 'postgres'), ('off',)]
                conn.execute.return_value.fetchone.side_effect = rows
                driver = MagicMock()
                driver.connect.return_value = conn
                if failure == 'certificate':
                    driver.connect.side_effect = ssl.SSLCertVerificationError('synthetic')
                if failure == 'disconnect':
                    conn.execute.side_effect = ConnectionError('synthetic')
                with patch.dict(os.environ, self.session_env(), clear=True), patch.dict('sys.modules', psycopg=driver):
                    with self.assertRaises(Exception):
                        target.connect_verified(read_only=True)
                self.assertEqual(driver.connect.call_count, 1)
                if failure != 'certificate':
                    conn.close.assert_called_once()

    def test_session_apply_without_approval_never_connects(self):
        with patch.dict(os.environ, self.session_env(), clear=True), patch('migrate.connect_verified', side_effect=AssertionError('Forbidden')):
            with self.assertRaises(ValueError):
                migrate.apply(migrate.load_plan())

    def test_identity_and_transport_default_to_no_connection(self):
        with patch('check_identity.connect_verified', side_effect=AssertionError('Forbidden')), \
             patch('check_transport.socket.getaddrinfo', side_effect=AssertionError('Forbidden')), \
             contextlib.redirect_stdout(io.StringIO()):
            with patch('sys.argv', ['check_identity.py']):
                self.assertEqual(check_identity.main(), 0)
            with patch('sys.argv', ['check_transport.py']):
                self.assertEqual(check_transport.main(), 0)

    def test_transport_pins_hostname_and_requires_certificate_verification(self):
        import ssl
        for mode, host in (('direct', target.DB_HOST), ('session', target.SESSION_HOST)):
            env = dict(self.env, DEV_DB_CONNECTION_MODE=mode)
            context = MagicMock()
            raw = MagicMock()
            raw.__enter__.return_value = raw
            raw.recv.return_value = b'S'
            addresses = [(2, 1, 6, '', ('192.0.2.1', 5432))]
            with patch.dict(os.environ, env, clear=True), patch('sys.argv', ['check_transport.py', '--probe']), \
                 patch('check_transport.ssl.create_default_context', return_value=context), \
                 patch('check_transport.socket.getaddrinfo', return_value=addresses), \
                 patch('check_transport.socket.socket', return_value=raw), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(check_transport.main(), 0)
            self.assertEqual(context.wrap_socket.call_args.kwargs['server_hostname'], host)
            context.wrap_socket.side_effect = ssl.SSLCertVerificationError('synthetic')
            with patch.dict(os.environ, env, clear=True), patch('sys.argv', ['check_transport.py', '--probe']), \
                 patch('check_transport.ssl.create_default_context', return_value=context), \
                 patch('check_transport.socket.getaddrinfo', return_value=addresses), \
                 patch('check_transport.socket.socket', return_value=raw), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(check_transport.main(), 1)

    def test_invalid_session_never_calls_driver(self):
        env = dict(self.session_env(), DEV_DATABASE_URL='postgresql://postgres:synthetic@db.other.supabase.co:5432/postgres')
        driver = MagicMock()
        with patch.dict(os.environ, env, clear=True), patch.dict('sys.modules', psycopg=driver):
            with self.assertRaises(ValueError):
                target.connect_verified()
        driver.connect.assert_not_called()

    def test_identity_failure_output_does_not_reveal_driver_details(self):
        output = io.StringIO()
        with patch('sys.argv', ['check_identity.py', '--check']), \
             patch('check_identity.connect_verified', side_effect=ValueError('synthetic-secret')), \
             contextlib.redirect_stdout(output):
            self.assertEqual(check_identity.main(), 1)
        self.assertNotIn('synthetic-secret', output.getvalue())

    def test_other_projects_and_poolers_rejected(self):
        for host in ['db.tepvbliaxwgbdeisttgj.supabase.co','db.imgelomtkcwqqbjfhefb.supabase.co',
            'localhost','127.0.0.1','aws-0-eu-west-1.pooler.supabase.com',target.DB_HOST+'.attacker.test']:
            with self.subTest(host=host):
                env=dict(self.env,DEV_DATABASE_URL=self.env['DEV_DATABASE_URL'].replace(target.DB_HOST,host))
                with self.assertRaises(ValueError):target.connection_options(env)

    def test_uri_overrides_ports_roles_database_and_queries_rejected(self):
        for uri in [self.env['DEV_DATABASE_URL']+'?sslmode=disable',self.env['DEV_DATABASE_URL']+'?hostaddr=127.0.0.1',
            self.env['DEV_DATABASE_URL'].replace(':5432',':6543'),
            self.env['DEV_DATABASE_URL'].replace(':5432',':0'),
            self.env['DEV_DATABASE_URL'].replace('/postgres','/another_db'),
            self.env['DEV_DATABASE_URL'].replace('postgres:','service_role:',1)]:
            with self.subTest(uri_kind='synthetic URI'):
                with self.assertRaises(ValueError):target.connection_options(dict(self.env,DEV_DATABASE_URL=uri))

    def test_missing_or_conflicting_frontend_identity_rejected(self):
        for name in ['DEV_PROJECT_REF','VITE_SUPABASE_URL','DEV_DATABASE_URL']:
            env=dict(self.env);env.pop(name)
            with self.assertRaises(ValueError):target.connection_options(env)
        with self.assertRaises(ValueError):target.connection_options(dict(self.env,VITE_SUPABASE_URL='https://other.supabase.co'))

    def test_plan_and_default_integration_do_not_connect(self):
        with patch('migrate.connect_verified',side_effect=AssertionError('Connection forbidden')), \
             patch('integration.connect_verified',side_effect=AssertionError('Connection forbidden')), \
             patch('sys.argv',['migrate.py']),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(migrate.main(),0)
            self.assertEqual(integration.main(),0)

    def test_apply_without_approval_never_connects(self):
        with patch.dict(os.environ,{},clear=True),patch('migrate.connect_verified',side_effect=AssertionError('Connection forbidden')):
            with self.assertRaises(ValueError):migrate.apply(migrate.load_plan())

    def test_integration_without_approval_never_connects(self):
        with patch.dict(os.environ,{},clear=True),patch('sys.argv',['integration.py','--run']), \
             patch('integration.connect_verified',side_effect=AssertionError('Connection forbidden')),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(integration.main(),1)

    def test_auth_and_admin_tools_default_to_no_connection(self):
        with patch('auth_contract.run',side_effect=AssertionError('Network forbidden')),              patch('provision_admin.connect_verified',side_effect=AssertionError('Connection forbidden')),              contextlib.redirect_stdout(io.StringIO()):
            with patch('sys.argv',['auth_contract.py']):self.assertEqual(auth_contract.main(),0)
            with patch('sys.argv',['provision_admin.py','11111111-1111-4111-8111-111111111111']):
                self.assertEqual(provision_admin.main(),0)

    def test_auth_contract_rejects_foreign_or_missing_admin_key(self):
        import base64
        def fake_key(ref,role):
            payload=base64.urlsafe_b64encode(json.dumps({'ref':ref,'role':role,'exp':4102444800}).encode()).decode().rstrip('=')
            return 'synthetic.'+payload+'.synthetic'
        env=dict(self.env,VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-value')
        for key in ['',fake_key('foreign-project','service_role'),fake_key(target.PROJECT_REF,'anon')]:
            with self.assertRaises(ValueError):auth_contract.validate(dict(env,DEV_AUTH_ADMIN_JWT=key))

    def test_manifest_rejects_modified_checksum(self):
        manifest=json.loads(migrate.MANIFEST.read_text())
        manifest['files'][0]['sha256']='0'*64
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'manifest.json';path.write_text(json.dumps(manifest))
            with patch('migrate.MANIFEST',path):
                with self.assertRaisesRegex(ValueError,'checksum'):migrate.load_plan()

    def test_manifest_contains_exact_eight_historical_files_first(self):
        files=migrate.load_plan()
        self.assertEqual(len(files),14)
        self.assertTrue(all(path.startswith(('supabase/migrations/','drizzle/migrations/')) for path,_,_ in files[:8]))
        self.assertTrue(all(path.startswith('database/development/') for path,_,_ in files[8:]))


if __name__=='__main__':unittest.main(verbosity=2)
