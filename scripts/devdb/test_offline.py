"""No database driver/network required for these safety checks."""
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import migrate
import target
import integration
import auth_contract
import provision_admin


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

    def test_other_projects_and_poolers_rejected(self):
        for host in ['db.tepvbliaxwgbdeisttgj.supabase.co','db.imgelomtkcwqqbjfhefb.supabase.co',
            'localhost','127.0.0.1','aws-0-eu-west-1.pooler.supabase.com',target.DB_HOST+'.attacker.test']:
            with self.subTest(host=host):
                env=dict(self.env,DEV_DATABASE_URL=self.env['DEV_DATABASE_URL'].replace(target.DB_HOST,host))
                with self.assertRaises(ValueError):target.connection_options(env)

    def test_uri_overrides_ports_roles_database_and_queries_rejected(self):
        for uri in [self.env['DEV_DATABASE_URL']+'?sslmode=disable',self.env['DEV_DATABASE_URL']+'?hostaddr=127.0.0.1',
            self.env['DEV_DATABASE_URL'].replace(':5432',':6543'),
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
