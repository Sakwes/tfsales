"""No database driver/network required for these safety checks."""
import contextlib
import copy
import io
import hashlib
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
            conn.execute.return_value.fetchone.side_effect = [('on',), ('postgres', 'postgres')]
            driver = MagicMock()
            driver.connect.return_value = conn
            with patch.dict(os.environ, env, clear=True), patch.dict('sys.modules', psycopg=driver):
                self.assertIs(target.connect_verified(read_only=True), conn)
            self.assertEqual(driver.connect.call_count, 1)
            self.assertEqual(driver.connect.call_args.kwargs['sslmode'], 'verify-full')
            self.assertNotIn('options', driver.connect.call_args.kwargs)
            self.assertEqual([call.args[0] for call in conn.execute.call_args_list], [
                "SET statement_timeout = '120s'", "SET lock_timeout = '10s'",
                'SET TRANSACTION READ ONLY', 'SHOW transaction_read_only',
                'SELECT current_database(), session_user'])
            conn.close.assert_not_called()

    def test_failed_tls_identity_and_connection_never_retry(self):
        import ssl
        for failure in ('no_tls', 'identity', 'read_only', 'certificate', 'disconnect'):
            with self.subTest(failure=failure):
                conn = MagicMock()
                conn.pgconn.ssl_in_use = failure != 'no_tls'
                rows = [('on',), ('wrong', 'postgres')] if failure == 'identity' else [('off',)]
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

    def test_read_only_transaction_failures_block_identity_and_close(self):
        for failure in ('set', 'show', 'off', 'missing', 'database', 'role'):
            with self.subTest(failure=failure):
                conn = MagicMock()
                conn.pgconn.ssl_in_use = True
                active = False

                def enter():
                    nonlocal active
                    active = True

                def execute(sql):
                    if sql.startswith('SET statement_timeout') or sql.startswith('SET lock_timeout'):
                        return MagicMock()
                    self.assertTrue(active, 'Read-only enforcement and queries must share a transaction')
                    if sql == 'SET TRANSACTION READ ONLY' and failure == 'set':
                        raise RuntimeError('synthetic enforcement failure')
                    if sql == 'SHOW transaction_read_only':
                        if failure == 'show':
                            raise RuntimeError('synthetic status failure')
                        row = None if failure == 'missing' else ('off',) if failure == 'off' else ('on',)
                        return MagicMock(fetchone=MagicMock(return_value=row))
                    if sql.startswith('SELECT'):
                        self.assertIn(failure, ('database', 'role'))
                        row = ('wrong', 'postgres') if failure == 'database' else ('postgres', 'wrong')
                        return MagicMock(fetchone=MagicMock(return_value=row))
                    return MagicMock()

                conn.transaction.return_value.__enter__.side_effect = enter
                conn.execute.side_effect = execute
                driver = MagicMock()
                driver.connect.return_value = conn
                with patch.dict(os.environ, self.session_env(), clear=True), patch.dict('sys.modules', psycopg=driver):
                    with self.assertRaises((ValueError, RuntimeError)):
                        target.connect_verified(read_only=True)
                statements = [call.args[0] for call in conn.execute.call_args_list]
                if failure not in ('database', 'role'):
                    self.assertNotIn('SELECT current_database(), session_user', statements)
                conn.transaction.return_value.__exit__.assert_called_once()
                self.assertIsNotNone(conn.transaction.return_value.__exit__.call_args.args[0])
                conn.close.assert_called_once()
                driver.connect.assert_called_once()

    def test_default_connection_keeps_migration_session_behavior(self):
        for env in (self.env, self.session_env()):
            conn = MagicMock()
            conn.pgconn.ssl_in_use = True
            conn.execute.return_value.fetchone.return_value = ('postgres', 'postgres')
            driver = MagicMock()
            driver.connect.return_value = conn
            with patch.dict(os.environ, env, clear=True), patch.dict('sys.modules', psycopg=driver):
                self.assertIs(target.connect_verified(), conn)
            self.assertEqual(driver.connect.call_args.kwargs, dict(target.connection_options(env), autocommit=True))
            self.assertEqual([call.args[0] for call in conn.execute.call_args_list], [
                "SET statement_timeout = '120s'", "SET lock_timeout = '10s'",
                'SELECT current_database(), session_user'])
            conn.close.assert_not_called()

    def test_identity_cli_requests_read_only_verification(self):
        conn = MagicMock()
        with patch('sys.argv', ['check_identity.py', '--check']), \
             patch('check_identity.connect_verified', return_value=conn) as connect, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_identity.main(), 0)
        connect.assert_called_once_with(read_only=True)
        conn.__exit__.assert_called_once()

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

    def test_transport_compatibility_keeps_real_context_verification(self):
        import ssl
        ca = str(Path(__file__).parent / 'fixtures' / 'offline-ca.pem')
        original_factory = ssl.create_default_context
        system_root = os.environ.get('SystemRoot', r'C:\Windows')

        def strict_factory(**kwargs):
            self.assertEqual(os.environ.get('SystemRoot'), system_root)
            context = original_factory(**kwargs)
            context.verify_flags |= ssl.VERIFY_X509_STRICT
            return context

        # Real OpenSSL initialization needs the platform environment on Windows
        # (notably SystemRoot). Isolate only the setting this test consumes.
        with patch.dict(os.environ, {'SystemRoot': system_root}), \
             patch.dict(os.environ, {'DEV_DB_SSLROOTCERT': ca}), \
             patch('check_transport.ssl.create_default_context', side_effect=strict_factory):
            default = check_transport.tls_context(target.SESSION_HOST)
            compat = check_transport.tls_context(target.SESSION_HOST, supabase_root_2021_compat=True)
        self.assertTrue(default.verify_flags & ssl.VERIFY_X509_STRICT)
        self.assertEqual(compat.verify_flags, default.verify_flags & ~ssl.VERIFY_X509_STRICT)
        for context in (default, compat):
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.cert_store_stats()['x509_ca'], 1)

    def test_real_tls_context_preserves_windows_runtime_environment(self):
        import ssl
        ca = str(Path(__file__).parent / 'fixtures' / 'offline-ca.pem')
        original_factory = ssl.create_default_context
        system_root = os.environ.get('SystemRoot', r'C:\Windows')

        def platform_factory(**kwargs):
            # Exercise the Windows environment dependency even on Linux. Keep
            # the actual Windows value when running natively there.
            self.assertEqual(os.environ.get('SystemRoot'), system_root)
            return original_factory(**kwargs)

        with patch.dict(os.environ, {'SystemRoot': system_root}):
            with patch.dict(os.environ, {'DEV_DB_SSLROOTCERT': ca}), \
                 patch('check_transport.ssl.create_default_context', side_effect=platform_factory):
                context = check_transport.tls_context(target.SESSION_HOST)
            self.assertEqual(os.environ.get('SystemRoot'), system_root)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.cert_store_stats()['x509_ca'], 1)

    def test_transport_compatibility_requires_session_and_explicit_valid_ca(self):
        for env, host in (({'DEV_DB_SSLROOTCERT': ''}, target.SESSION_HOST),
                          ({'DEV_DB_SSLROOTCERT': self.cert.name}, target.DB_HOST),
                          ({'DEV_DB_SSLROOTCERT': '/does-not-exist'}, target.SESSION_HOST),
                          ({'DEV_DB_SSLROOTCERT': self.cert.name}, target.SESSION_HOST)):
            with self.subTest(host=host, env=bool(env)), patch.dict(os.environ, env):
                with self.assertRaises((ValueError, OSError)):
                    check_transport.tls_context(host, supabase_root_2021_compat=True)

    def test_transport_compatibility_fails_closed_on_certificate_or_hostname_error(self):
        import ssl
        for reason in ('certificate chain rejected', 'hostname mismatch'):
            context = MagicMock()
            context.wrap_socket.side_effect = ssl.SSLCertVerificationError(reason)
            raw = MagicMock()
            raw.__enter__.return_value = raw
            raw.recv.return_value = b'S'
            addresses = [(2, 1, 6, '', ('192.0.2.1', 5432))]
            output = io.StringIO()
            with patch.dict(os.environ, self.session_env(), clear=True), \
                 patch('sys.argv', ['check_transport.py', '--probe', '--supabase-root-2021-compat']), \
                 patch('check_transport.ssl.create_default_context', return_value=context), \
                 patch('check_transport.socket.getaddrinfo', side_effect=[addresses, OSError()]), \
                 patch('check_transport.socket.socket', return_value=raw), contextlib.redirect_stdout(output):
                self.assertEqual(check_transport.main(), 1)
            context.wrap_socket.assert_called_once_with(raw, server_hostname=target.SESSION_HOST)
            self.assertIn('COMPATIBILITY:', output.getvalue())
            self.assertIn('BLOCKED: TLS verification', output.getvalue())
            raw.sendall.assert_called_once_with(b'\x00\x00\x00\x08\x04\xd2\x16/')

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
        self.assertEqual(len(files),18)
        self.assertTrue(all(path.startswith(('supabase/migrations/','drizzle/migrations/')) for path,_,_ in files[:8]))
        self.assertTrue(all(path.startswith('database/development/') for path,_,_ in files[8:]))

    def test_store_helper_correction_preserves_applied_manifest_prefix(self):
        entries=json.loads(migrate.MANIFEST.read_text())['files']
        self.assertEqual(hashlib.sha256(json.dumps(entries[:14],sort_keys=True).encode()).hexdigest(),
                         '2ab4fb79a7b1fb65b776d894bb793d2d9cc4df005a4ae50076eb727c092a4990')
        self.assertEqual(entries[14]['path'], 'database/development/corrections/004_store_helper_permissions.sql')
        migrate.load_plan()  # Verifies the bytes of every historical and appended file.

    def test_billing_preserves_fifteen_applied_entries(self):
        entries=json.loads(migrate.MANIFEST.read_text())['files']
        self.assertEqual(hashlib.sha256(json.dumps(entries[:15],sort_keys=True).encode()).hexdigest(),
                         '56e19d588f32af2ee496745f4f91a3b1e9716fa83e436294f307e23c67903090')
        self.assertEqual(entries[15]['path'], 'database/development/corrections/005_subscription_payments.sql')
        migrate.load_plan()

    def test_payment_guard_preserves_sixteen_migration_entries(self):
        entries=json.loads(migrate.MANIFEST.read_text())['files']
        self.assertEqual(hashlib.sha256(json.dumps(entries[:16],sort_keys=True).encode()).hexdigest(),
                         '5ad99ec36089bd849ec2dd87c3905cacc6f2008ca39c462716d3e569b427df51')
        self.assertEqual(entries[16]['path'], 'database/development/corrections/006_active_paid_payment_guard.sql')
        migrate.load_plan()

    def test_publication_preserves_seventeen_applied_entries(self):
        entries=json.loads(migrate.MANIFEST.read_text())['files']
        self.assertEqual(hashlib.sha256(json.dumps(entries[:17],sort_keys=True).encode()).hexdigest(),
                         'fb6510e8ac53020b928b6b52a98399a9092c245de5418f15c7f3c90294fe519c')
        self.assertEqual(entries[17]['path'], 'database/development/corrections/007_product_publication.sql')
        migrate.load_plan()

    def test_store_creation_integration_default_never_connects(self):
        with patch('integration.check_seller_store_creation', side_effect=AssertionError('Forbidden')), \
             patch('integration.connect_verified', side_effect=AssertionError('Forbidden')), \
             patch('sys.argv', ['integration.py']), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(integration.main(), 0)


if __name__=='__main__':unittest.main(verbosity=2)
