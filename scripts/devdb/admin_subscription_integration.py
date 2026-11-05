"""Prepared RPC regressions. Called ONLY after the existing synthetic-only safety gate.
Not run by offline tests. Never use this harness against a project containing real users.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import time
from uuid import uuid4
from integration import claim, must_fail
from target import connect_verified

SET = 'SELECT public.sellnova_admin_set_subscription(%s,%s,%s,%s,%s,%s)'
LIST = 'SELECT public.sellnova_admin_list_subscriptions(%s,%s,0,25,%s)'
HISTORY = 'SELECT public.sellnova_admin_subscription_history(%s,0,100)'


def check_admin_subscriptions(conn, ids):
    from psycopg import Rollback
    store, admin = ids['store_b'], ids['admin']

    def rpc(db, sql, params=(), user=admin, role='authenticated'):
        with db.transaction():
            claim(db, role, user)
            result = db.execute(sql, params).fetchone()[0]
            db.execute('RESET ROLE')
            db.execute("SELECT set_config('request.jwt.claims','{}',true)")
            return result

    def state(db=conn):
        return rpc(db, LIST, ('', 'all', store))['items'][0]

    def future(days=30):
        return conn.execute('SELECT clock_timestamp()').fetchone()[0] + timedelta(days=days)

    def command(row, action='paid', expiry=None, operation=None):
        return (store, action, expiry, 'Synthetic administrative reason', row['revision'], operation or uuid4())

    # Sequential mutations use an outer rollback; pre-existing fixtures/history are restored.
    with conn.transaction():
        must_fail(conn, LIST, ('', 'all', store), role='anon', states=('42501',))
        must_fail(conn, LIST, ('', 'all', store), user=ids['seller_b'], states=('42501',))
        must_fail(conn, HISTORY, (store,), user=ids['seller_a'], states=('42501',))
        must_fail(conn, 'SELECT * FROM sellnova_dev.subscription_operations', user=admin, states=('42501',))
        before = state()
        assert before['plan'] == 'free' and before['allowance'] == 12
        payments_before = conn.execute('SELECT to_jsonb(r) FROM public.subscription_requests r WHERE store_id=%s ORDER BY id', (store,)).fetchall()
        for bad in (command(before, expiry=None), command(before, expiry=future(-1)),
                    command(before, expiry='infinity'), command(before, 'other', future()),
                    command(before, 'free', future()), (*command(before, expiry=future())[:3], ' ', before['revision'], uuid4())):
            must_fail(conn, SET, bad, user=admin, states=('P0001',))
        args = command(before, expiry=future())
        must_fail(conn, SET, args, user=ids['seller_b'], states=('42501',))
        granted = rpc(conn, SET, args)
        assert granted['subscription']['plan'] == 'paid' and granted['subscription']['allowance'] == 50
        assert granted['subscription']['source'] == 'admin'
        assert granted['subscription']['revision'] != before['revision']
        must_fail(conn, SET, command(before, expiry=future()), user=admin, states=('P0001',))
        assert rpc(conn, SET, args)['replayed'] is True
        changed = (*args[:3], 'Different reason', args[4], args[5])
        must_fail(conn, SET, changed, user=admin, states=('P0001',))
        must_fail(conn, SET, (ids['store_a'], *args[1:]), user=admin, states=('P0001',))
        must_fail(conn, 'SELECT public.sellnova_set_subscription_state(%s,%s,%s,%s)',
                  (store, 'active', 30, 'legacy bypass'), user=admin, states=('42501',))
        must_fail(conn, "UPDATE public.store_subscriptions SET status='active' WHERE store_id=%s", (store,), user=admin, states=('42501',))
        for i in range(50):
            rpc(conn, 'INSERT INTO public.products(store_id,name,price) VALUES(%s,%s,1000) RETURNING id',
                (store, 'Admin synthetic '+str(i)), user=ids['seller_b'])
        must_fail(conn, 'INSERT INTO public.products(store_id,name,price) VALUES(%s,%s,1000)',
                  (store, 'Paid fifty first'), user=ids['seller_b'], states=('P0001',))
        saved_before = conn.execute('SELECT to_jsonb(p) FROM public.products p WHERE store_id=%s ORDER BY id', (store,)).fetchall()
        shorter = rpc(conn, SET, command(state(), expiry=future(1)))
        downgraded = rpc(conn, SET, command(shorter['subscription'], 'free'))
        assert downgraded['subscription']['allowance'] == 12 and downgraded['subscription']['expires_at'] is None
        assert downgraded['subscription']['saved_count'] == 50
        for role, user in (('anon', None), ('authenticated', ids['seller_b'])):
            assert len(rpc(conn, 'SELECT jsonb_agg(id) FROM public.sellnova_storefront_products(%s)', (store,), role=role, user=user)) == 12
        # Old receipt recovery cannot overwrite the newer downgrade.
        assert rpc(conn, SET, args)['replayed'] is True and state()['plan'] == 'free'
        renewed = rpc(conn, SET, command(state(), expiry=future()))
        assert renewed['subscription']['visible_count'] == 50
        assert conn.execute('SELECT to_jsonb(p) FROM public.products p WHERE store_id=%s ORDER BY id', (store,)).fetchall() == saved_before
        assert conn.execute('SELECT to_jsonb(r) FROM public.subscription_requests r WHERE store_id=%s ORDER BY id', (store,)).fetchall() == payments_before
        history = rpc(conn, HISTORY, (store,))
        manual = [e for e in history['items'] if e['action'].startswith('subscription.manual.')]
        assert len(manual) == 4 and all(e['actor_id'] == str(admin) and e['reason'] for e in manual)
        assert all(e['before'] and e['after'] and e['source'] == 'admin' for e in manual)
        # Role loss is checked even for a committed operation's replay.
        conn.execute("DELETE FROM public.user_roles WHERE user_id=%s AND role='admin'", (admin,))
        must_fail(conn, SET, args, user=admin, states=('42501',))
        conn.execute("INSERT INTO public.user_roles(user_id,role) VALUES(%s,'admin')", (admin,))
        conn.execute("UPDATE public.store_subscriptions SET status='suspended' WHERE store_id=%s", (store,))
        must_fail(conn, SET, command(state(), expiry=future()), user=admin, states=('P0001',))
        raise Rollback()

    # Real independent connections: fixture is committed by the unchanged harness.
    def worker(args):
        import psycopg
        try:
            with connect_verified() as db:
                return rpc(db, SET, args)
        except psycopg.Error as error:
            return error.sqlstate

    baseline = state()
    args = command(baseline, expiry=future())
    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(worker, [args, args]))
    assert all(isinstance(x, dict) for x in receipts)
    assert sorted(x['replayed'] for x in receipts) == [False, True]
    baseline = state()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(worker, [command(baseline, expiry=future(2)), command(baseline, 'free')]))
    assert sum(isinstance(x, dict) for x in results) == 1 and results.count('P0001') == 1

    # A pending payment created while Free survives a manual grant and extends it once.
    rpc(conn, SET, command(state(), 'free'))
    version = conn.execute('SELECT version FROM public.platform_settings WHERE id=true').fetchone()[0]
    settings = 'SELECT public.sellnova_update_payment_settings(%s,1500,30,%s,%s,%s,%s,true)'
    # Settings scenario rolls back, including the payment request and audit.
    with conn.transaction():
        rpc(conn, settings, (version, 'Synthetic provider', 'NOT REAL', '0000000000', 'TEST ONLY'))
        request = rpc(conn, 'SELECT public.sellnova_begin_payment(%s)', (store,), user=ids['seller_b'])
        rpc(conn, 'SELECT public.sellnova_notify_payment(%s,%s,NULL)', (request, 'ADMIN-TEST-'+str(request)), user=ids['seller_b'])
        pending = conn.execute('SELECT to_jsonb(r) FROM public.subscription_requests r WHERE id=%s', (request,)).fetchone()[0]
        grant = rpc(conn, SET, command(state(), expiry=future(5)))
        assert conn.execute('SELECT to_jsonb(r) FROM public.subscription_requests r WHERE id=%s', (request,)).fetchone()[0] == pending
        end = conn.execute('SELECT expires_at FROM public.store_subscriptions WHERE store_id=%s', (store,)).fetchone()[0]
        rpc(conn, 'SELECT public.sellnova_review_payment(%s,true,true,%s)', (request, 'Synthetic verified'))
        assert conn.execute('SELECT expires_at FROM public.store_subscriptions WHERE store_id=%s', (store,)).fetchone()[0] == end+timedelta(days=30)
        assert state()['source'] == 'payment' and state()['revision'] != grant['subscription']['revision']
        must_fail(conn, SET, command(grant['subscription'], 'free'), user=admin, states=('P0001',))
        must_fail(conn, 'SELECT public.sellnova_review_payment(%s,true,true,NULL)', (request,), user=admin, states=('P0001',))
        raise Rollback()

    # Simultaneous bank approval and a manual grant: approval either invalidates the
    # stale command, or extends the newly installed manual expiry. Never lost updates.
    rpc(conn, SET, command(state(), 'free'))
    request = uuid4()
    conn.execute("""INSERT INTO public.subscription_requests(id,store_id,plan_id,amount,payment_reference,
      status,duration_days,settings_version,payment_snapshot)
      SELECT %s,%s,id,1500,%s,'pending',30,1,
      '{"price_ngn":1500,"duration_days":30,"bank_name":"Synthetic","account_name":"NOT REAL",
        "account_number":"0000000000","payment_instructions":"TEST ONLY"}'::jsonb
      FROM public.plans WHERE code='paid'""", (request, store, 'RACE-'+str(request)))
    args = command(state(), expiry=future(10))

    def bank_worker(_):
        with connect_verified() as db:
            return rpc(db, 'SELECT public.sellnova_review_payment(%s,true,true,%s)', (request, 'Synthetic race'))

    with ThreadPoolExecutor(max_workers=2) as pool:
        manual_future = pool.submit(worker, args)
        bank_future = pool.submit(bank_worker, None)
        manual_result, bank_result = manual_future.result(), bank_future.result()
    assert bank_result == {'ok': True} and (isinstance(manual_result, dict) or manual_result == 'P0001')
    assert state()['plan'] == 'paid' and state()['source'] == 'payment'
    must_fail(conn, 'SELECT public.sellnova_review_payment(%s,true,true,NULL)', (request,), user=admin, states=('P0001',))

    # Wall-clock expiry test, without rewriting expiry/status to simulate it.
    near = conn.execute("SELECT clock_timestamp()+interval '2 seconds'").fetchone()[0]
    expiring = command(state(), expiry=near)
    rpc(conn, SET, expiring)
    timeout = time.monotonic()+8
    while state()['plan'] == 'paid' and time.monotonic()<timeout:
        time.sleep(0.1)
    expired = state()
    assert expired['plan'] == 'free' and expired['allowance'] == 12 and expired['effective_status'] == 'expired'
    assert rpc(conn, SET, expiring)['replayed'] is True and state()['plan'] == 'free'
    assert rpc(conn, SET, command(state(), expiry=future()))['subscription']['plan'] == 'paid'
    print('PASS admin grants/downgrades/history, ACLs, concurrent revisions/replay, bank coexistence and wall-clock expiry')
