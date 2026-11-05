"""Backend contract/mutation regressions; parse source only, never execute SQL.
These checks cannot prove PostgreSQL authorization, lock behavior or persistence.
"""
import hashlib
import json
import re
import unittest
from pglast import ast, parse_sql, parser
from migrate import ROOT, load_plan

PATH = 'database/development/corrections/008_admin_subscription_management.sql'


def routines(sql):
    result = {}
    for raw in parse_sql(sql):
        node = raw.stmt
        if isinstance(node, ast.CreateFunctionStmt):
            options = {o.defname: o.arg for o in node.options}
            result['.'.join(x.sval for x in node.funcname)] = (node, options, options['as'][0].sval)
    return result


def validate_boundary(sql):
    """Fail on unauthorized surface expansion or obvious data-destructive edits."""
    funcs = routines(sql)
    required = ['sellnova_admin_list_subscriptions', 'sellnova_admin_subscription_history', 'sellnova_admin_set_subscription']
    for name in required:
        _, options, body = funcs['public.'+name]
        if not options.get('security') or not options['security'].boolval:
            raise ValueError('Admin routine must be SECURITY DEFINER')
        setting = options['set']
        if setting.name != 'search_path' or setting.args[0].val.sval != 'pg_catalog':
            raise ValueError('Unsafe search path')
        if 'PERFORM sellnova_dev.require_subscription_admin();' not in body:
            raise ValueError('Missing stored-role authorization')
    for raw in parse_sql(sql):
        node = raw.stmt
        if isinstance(node, (ast.DeleteStmt, ast.TruncateStmt, ast.DropStmt)):
            raise ValueError('Destructive top-level statement')
        if isinstance(node, ast.UpdateStmt):
            if node.relation.schemaname != 'public' or node.relation.relname != 'plans' or any(t.name != 'max_products' for t in node.targetList):
                raise ValueError('Historical-record backfill')
        if isinstance(node, ast.GrantStmt) and node.is_grant:
            if any(r.rolename != 'authenticated' for r in node.grantees):
                raise ValueError('Unexpected grant recipient')
            if any(p.priv_name != 'execute' for p in node.privileges):
                raise ValueError('Unexpected grant privilege')
    body = funcs['public.sellnova_admin_set_subscription'][2]
    if re.search(r'(INSERT INTO|UPDATE|DELETE FROM) public\.(subscription_requests|products|orders|order_items)', body):
        raise ValueError('Manual grant mutates commerce/payment records')
    for name in ('sellnova_admin_set_subscription', 'sellnova_begin_payment', 'sellnova_notify_payment', 'sellnova_review_payment'):
        body = funcs['public.'+name][2]
        if not re.search(r'pg_advisory_xact_lock\(hashtextextended\([^;]+,921\)\)', body):
            raise ValueError('Missing shared store lock')
        if body.index(',921)') > body.index('FROM public.stores'):
            raise ValueError('Inconsistent store lock order')


class AdminBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = (ROOT/PATH).read_text()
        cls.funcs = routines(cls.sql)

    def test_nineteenth_entry_preserves_reviewed_eighteen(self):
        entries = json.loads((ROOT/'database/development/manifest.json').read_text())['files']
        self.assertEqual(len(entries), 19)
        self.assertEqual(entries[18]['path'], PATH)
        self.assertEqual(hashlib.sha256(json.dumps(entries[:18], sort_keys=True).encode()).hexdigest(),
                         '23c087131a8e370caef64892c0044a7b0ece6b34010abee2d047ea453db1dd7c')
        load_plan()

    def test_sql_grammar_and_authority_boundary(self):
        parser.parse_plpgsql_json(self.sql)
        validate_boundary(self.sql)

    def test_unsafe_boundary_mutations_are_detected(self):
        alterations = [
            self.sql.replace('PERFORM sellnova_dev.require_subscription_admin();', 'NULL;'),
            self.sql.replace('SET search_path=pg_catalog', 'SET search_path=public'),
            self.sql.replace('SECURITY DEFINER', 'SECURITY INVOKER'),
            self.sql.replace(' TO authenticated;', ' TO anon;'),
            self.sql.replace(',921)', ',999)'),
            self.sql.replace(' PERFORM pg_advisory_xact_lock(hashtextextended(_store_id::text,921));', ' PERFORM 1 FROM public.stores;'),
            self.sql+'\nDELETE FROM public.products;',
            self.sql+'\nUPDATE public.subscription_requests SET amount=1;',
        ]
        for sql in alterations:
            with self.subTest(mutation=alterations.index(sql)), self.assertRaises(ValueError):
                validate_boundary(sql)

    def test_replay_is_authorized_scoped_and_precedes_stale_or_expiry_checks(self):
        body = self.funcs['public.sellnova_admin_set_subscription'][2]
        self.assertLess(body.index('require_subscription_admin'), body.index('SELECT * INTO prior'))
        self.assertIn('prior.actor_id<>auth.uid() OR prior.payload IS DISTINCT FROM payload', body)
        self.assertLess(body.index("RETURN prior.receipt"), body.index('NOT isfinite(_expires_at)'))
        self.assertLess(body.index('RETURN prior.receipt'), body.index("before_row->>'revision' IS DISTINCT FROM _expected_revision"))
        self.assertIn("_expires_at AT TIME ZONE 'UTC'", body)
        self.assertIn('operation_id uuid PRIMARY KEY', self.sql)

    def test_server_validation_atomic_audit_and_no_payment_fabrication(self):
        body = self.funcs['public.sellnova_admin_set_subscription'][2]
        for guard in ("_action NOT IN ('paid','free')", 'NOT BETWEEN 1 AND 1000', 'NOT isfinite(_expires_at)',
                      "_action='free' AND _expires_at IS NOT NULL", "before_row->>'stored_status'='suspended'"):
            self.assertIn(guard, body)
        self.assertEqual(body.count('_expires_at<=clock_timestamp()'), 2)
        self.assertLess(body.index('INSERT INTO public.store_subscriptions'), body.index('INSERT INTO public.admin_audit_log'))
        self.assertLess(body.index('INSERT INTO public.admin_audit_log'), body.index('INSERT INTO sellnova_dev.subscription_operations'))
        self.assertNotIn('EXCEPTION WHEN', body)  # Failed audit/receipt must roll back the entitlement too.
        self.assertNotRegex(body, r'(INSERT INTO|UPDATE|DELETE FROM) public\.subscription_requests')
        self.assertIn("'before',sellnova_dev.subscription_snapshot(before_row)", body)
        self.assertIn("'after',sellnova_dev.subscription_snapshot(after_row)", body)

    def test_revision_covers_same_plan_edits_and_effective_expiry(self):
        self.assertIn('BEFORE INSERT OR UPDATE ON public.store_subscriptions', self.sql)
        self.assertIn('NEW.revision:=gen_random_uuid()', self.funcs['sellnova_dev.subscription_revision'][2])
        self.assertIn('hashtextextended(NEW.store_id::text,921)', self.funcs['sellnova_dev.subscription_revision'][2])
        row = self.funcs['sellnova_dev.subscription_row'][2]
        self.assertIn("sub.revision::text", row)
        self.assertIn("||':'||allowance::text||':'||effective", row)

    def test_role_and_private_ledger_permissions_fail_closed(self):
        role = self.funcs['sellnova_dev.require_subscription_admin'][2]
        self.assertIn("WHERE user_id=auth.uid() AND role='admin' FOR SHARE", role)
        self.assertIn("ERRCODE='42501'", role)
        self.assertIn('ALTER TABLE sellnova_dev.subscription_operations ENABLE ROW LEVEL SECURITY', self.sql)
        self.assertIn('FROM PUBLIC,anon,authenticated,service_role', self.sql)
        self.assertNotIn('CREATE POLICY', self.sql)  # Existing RLS remains, private operations have no client policy.
        self.assertIn('sellnova_set_subscription_state(uuid,text,integer,text)', self.sql)
        self.assertIn('sellnova_decide_subscription(uuid,boolean,text,integer)', self.sql)

    def test_bank_approval_increments_revision_and_preserves_snapshot_contract(self):
        body = self.funcs['public.sellnova_review_payment'][2]
        for term in ("r.status<>'pending'", '_verified IS DISTINCT FROM true', 'r.payment_snapshot IS NULL',
                     "latest_source='payment'", "cur.status='suspended'", "cur.expires_at>at_time", 'make_interval(days=>r.duration_days)',
                     "'before_revision',before_row->>'revision'", "'after_revision',after_row->>'revision'"):
            self.assertIn(term, body)
        self.assertNotIn('_amount', [p.name for p in self.funcs['public.sellnova_review_payment'][0].parameters])
        for name in ('sellnova_begin_payment', 'sellnova_notify_payment'):
            self.assertIn('Paid subscription is already active', self.funcs['public.'+name][2])

    def test_free_paid_limits_and_no_catalog_rewrite(self):
        limit = self.funcs['public.sellnova_publication_limit'][2]
        self.assertIn("pl.code='paid'", limit)
        self.assertIn('THEN 50 ELSE 12', limit)
        self.assertIn('clock_timestamp()', limit)
        state = self.funcs['public.sellnova_publication_state'][2]
        self.assertIn("allowance=50 THEN 'paid'", state)
        self.assertNotIn('allowance=100', self.sql)
        for table in ('products', 'stores', 'orders', 'order_items', 'store_branding'):
            self.assertNotRegex(self.sql, r'(UPDATE|DELETE FROM|INSERT INTO) public\.'+table+r'\b')

    def test_existing_integration_execution_gate_unchanged(self):
        text = (ROOT/'scripts/devdb/integration.py').read_text()
        self.assertEqual(hashlib.sha256(text[text.index('def main():'):].encode()).hexdigest(), '462ed129147eca204a1086c32ae031af15329ab1ecef71c4a5c7d28dd7526054')
        begin = text.index('            actual=owner.execute(')
        end = text.index('            initialized=True')
        self.assertEqual(hashlib.sha256(text[begin:end].encode()).hexdigest(), 'a4be73d5ed315fb0d14caa62ac0cf51c8e718f58056a637398c123254beadd41')


if __name__ == '__main__':
    unittest.main(verbosity=2)
