"""Prepared synthetic-only payment contract checks; imported by the gated harness."""
from datetime import timedelta
from integration import claim, must_fail


def check_billing(conn, ids):
    from psycopg import Rollback

    def rpc(role, user, sql, params=()):
        with conn.transaction():
            claim(conn, role, user)
            return conn.execute(sql, params).fetchone()[0]

    settings_sql = 'SELECT public.sellnova_update_payment_settings(%s,%s,%s,%s,%s,%s,%s,%s)'
    review_sql = 'SELECT public.sellnova_review_payment(%s,%s,%s,%s)'
    begin_sql = 'SELECT public.sellnova_begin_payment(%s)'
    notify_sql = 'SELECT public.sellnova_notify_payment(%s,%s,%s)'
    with conn.transaction():
        # This scenario is isolated from the checkout fixtures and always rolled back.
        conn.execute("UPDATE public.store_subscriptions SET status='free' WHERE store_id=%s", (ids['store_a'],))
        version = conn.execute('SELECT version FROM public.platform_settings WHERE id=true').fetchone()[0]
        # Deliberately invalid/non-live synthetic bank account; no real transfer.
        args = (version, 1500, 30, 'Synthetic test provider', 'NOT A REAL ACCOUNT', '0000000000', 'TEST ONLY - DO NOT TRANSFER', True)
        must_fail(conn, settings_sql, args, user=ids['seller_a'])
        must_fail(conn, begin_sql, (ids['store_a'],), role='anon', states=('42501',))
        must_fail(conn, "UPDATE public.plans SET price_ngn=1 WHERE code='paid'", user=ids['seller_a'], states=('42501',))
        must_fail(conn, settings_sql, (version, 0, 30, '', '', '', '', True), user=ids['admin'])
        must_fail(conn, settings_sql, (version, 1500, 0, '', '', '', '', True), user=ids['admin'])
        must_fail(conn, settings_sql, (version, 1500, 30, '', '', '', '', True), user=ids['admin'])
        must_fail(conn, 'SELECT public.sellnova_decide_subscription(%s,true,NULL,NULL)', (ids['run'],), user=ids['admin'], states=('42501',))
        rpc('authenticated', ids['admin'], settings_sql, args)
        must_fail(conn, settings_sql, args, user=ids['admin'])  # stale version
        must_fail(conn, begin_sql, (ids['store_a'],), user=ids['seller_b'])
        request = rpc('authenticated', ids['seller_a'], begin_sql, (ids['store_a'],))
        must_fail(conn, begin_sql, (ids['store_a'],), user=ids['seller_a'])
        must_fail(conn, "UPDATE public.subscription_requests SET amount=1,status='approved' WHERE id=%s", (request,), user=ids['seller_a'], states=('42501',))
        must_fail(conn, "INSERT INTO public.subscription_requests(store_id,plan_id,amount,payment_reference) SELECT %s,id,1,'forged' FROM public.plans WHERE code='paid'", (ids['store_a'],), user=ids['seller_a'], states=('42501',))
        with conn.transaction():
            claim(conn, 'authenticated', ids['seller_b'])
            assert conn.execute('SELECT id FROM public.subscription_requests WHERE id=%s', (request,)).fetchall() == []
        rpc('authenticated', ids['admin'], settings_sql, (version+1, 2000, 45, 'New synthetic provider', 'NOT REAL', '0000000001', 'NEW TEST INSTRUCTIONS', True))
        with conn.transaction():
            claim(conn, 'authenticated', ids['seller_a'])
            amount, days, snap = conn.execute('SELECT amount,duration_days,payment_snapshot FROM public.subscription_requests WHERE id=%s', (request,)).fetchone()
            assert (amount, days, snap['bank_name']) == (1500, 30, 'Synthetic test provider')
        must_fail(conn, notify_sql, (request, 'TEST-'+str(request), str(ids['seller_b'])+'/forged.pdf'), user=ids['seller_a'])
        rpc('authenticated', ids['seller_a'], notify_sql, (request, 'TEST-'+str(request), None))
        must_fail(conn, notify_sql, (request, 'TEST-'+str(request), None), user=ids['seller_a'])
        must_fail(conn, review_sql, (request, True, True, None), user=ids['seller_a'])
        must_fail(conn, review_sql, (request, True, False, None), user=ids['admin'])
        assert rpc('authenticated', ids['seller_a'], 'SELECT status FROM public.store_subscriptions WHERE store_id=%s', (ids['store_a'],)) == 'free'
        rpc('authenticated', ids['admin'], review_sql, (request, True, True, 'Synthetic verification'))
        must_fail(conn, review_sql, (request, True, True, None), user=ids['admin'])
        with conn.transaction():
            claim(conn, 'authenticated', ids['admin'])
            start, end = conn.execute('SELECT activated_from,activated_until FROM public.subscription_requests WHERE id=%s', (request,)).fetchone()
            assert end-start == timedelta(days=30)
            assert conn.execute('SELECT paid_amount,paid_duration_days FROM public.store_subscriptions WHERE store_id=%s', (ids['store_a'],)).fetchone() == (1500, 30)
        renewal = rpc('authenticated', ids['seller_a'], begin_sql, (ids['store_a'],))
        must_fail(conn, notify_sql, (renewal, 'TEST-'+str(request), None), user=ids['seller_a'])
        rpc('authenticated', ids['seller_a'], notify_sql, (renewal, 'TEST-'+str(renewal), None))
        rpc('authenticated', ids['admin'], review_sql, (renewal, True, True, 'Renewal verified'))
        with conn.transaction():
            claim(conn, 'authenticated', ids['admin'])
            new_start, new_end = conn.execute('SELECT activated_from,activated_until FROM public.subscription_requests WHERE id=%s', (renewal,)).fetchone()
            assert new_start == end and new_end-new_start == timedelta(days=45)
        rejected = rpc('authenticated', ids['seller_a'], begin_sql, (ids['store_a'],))
        rpc('authenticated', ids['seller_a'], notify_sql, (rejected, 'TEST-'+str(rejected), None))
        rpc('authenticated', ids['admin'], review_sql, (rejected, False, False, 'No matching transfer'))
        assert rpc('authenticated', ids['seller_a'], 'SELECT expires_at FROM public.store_subscriptions WHERE store_id=%s', (ids['store_a'],)) == new_end
        rpc('authenticated', ids['admin'], settings_sql, (version+2, 2000, 45, '', '', '', '', False))
        must_fail(conn, begin_sql, (ids['store_a'],), user=ids['seller_a'])
        with conn.transaction():
            claim(conn, 'authenticated', ids['admin'])
            assert conn.execute("SELECT count(*) FROM public.admin_audit_log WHERE action IN ('payment.approved','payment.rejected') AND store_id=%s", (ids['store_a'],)).fetchone()[0] == 3
        raise Rollback()
    print('PASS billing ACLs, immutable snapshots, paused collection, verified approval once, rejection and renewal')
