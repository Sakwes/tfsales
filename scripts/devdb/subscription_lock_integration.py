"""Prepared lock inversion regressions; ONLY called inside the synthetic-only harness.
No standalone runner, no connection on import. Not executed by offline validation.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from queue import Queue
import time
from uuid import uuid4
from integration import claim
from target import connect_verified


def check_subscription_locks(owner, ids):
    # A trusted writer owns the subscription row. The RPC then owns 921 and waits
    # for that row. A revision trigger must not try to wait back on 921.
    store, operation = ids['store_b'], uuid4()
    pid_queue = Queue()
    row = owner.execute('SELECT revision FROM public.store_subscriptions WHERE store_id=%s', (store,)).fetchone()
    assert row is not None
    with owner.transaction():
        claim(owner, 'authenticated', ids['admin'])
        before = owner.execute("SELECT public.sellnova_admin_list_subscriptions('', 'all',0,25,%s)", (store,)).fetchone()[0]['items'][0]
    expiry = owner.execute('SELECT clock_timestamp()').fetchone()[0]+timedelta(days=30)

    def manual():
        import psycopg
        with connect_verified() as conn:
            pid_queue.put(conn.execute('SELECT pg_backend_pid()').fetchone()[0])
            try:
                with conn.transaction():
                    claim(conn, 'authenticated', ids['admin'])
                    conn.execute('SELECT public.sellnova_admin_set_subscription(%s,%s,%s,%s,%s,%s)',
                                 (store, 'paid', expiry, 'Synthetic lock inversion', before['revision'], operation))
                return 'applied'
            except psycopg.Error as error:
                return error.sqlstate

    with ThreadPoolExecutor(max_workers=1) as pool:
        with owner.transaction():
            owner.execute("SET LOCAL statement_timeout='3s'")
            owner.execute('SELECT 1 FROM public.store_subscriptions WHERE store_id=%s FOR UPDATE', (store,))
            pending = pool.submit(manual)
            pid = pid_queue.get(timeout=10)
            deadline = time.monotonic()+5
            while time.monotonic()<deadline:
                owner.execute('SELECT pg_stat_clear_snapshot()')
                waiting = owner.execute("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=%s", (pid,)).fetchone()
                if waiting and waiting[0]:
                    break
                time.sleep(0.05)
            else:
                raise AssertionError('Expected the manual command to reach its locked subscription row')
            # With the old revision-trigger advisory wait this forms an actual cycle.
            owner.execute('UPDATE public.store_subscriptions SET updated_at=clock_timestamp() WHERE store_id=%s', (store,))
        assert pending.result(timeout=10) == 'P0001'  # Fresh revision invalidates the command.
    assert owner.execute('SELECT count(*) FROM sellnova_dev.subscription_operations WHERE operation_id=%s', (operation,)).fetchone()[0] == 0

    # Existing order UPDATE owns a row before its trigger can acquire advisory 921.
    # Contention must return a retry error without partial inventory/order changes.
    order = owner.execute("SELECT id FROM public.orders WHERE store_id=%s AND status='new' ORDER BY id LIMIT 1", (ids['store_a'],)).fetchone()
    assert order is not None
    snapshot = owner.execute('SELECT to_jsonb(o) FROM public.orders o WHERE id=%s', (order[0],)).fetchone()[0]

    def confirm():
        import psycopg
        with connect_verified() as conn:
            try:
                with conn.transaction():
                    claim(conn, 'authenticated', ids['seller_a'])
                    conn.execute("UPDATE public.orders SET status='confirmed' WHERE id=%s", (order[0],))
                return 'confirmed'
            except psycopg.Error as error:
                return error.sqlstate

    with ThreadPoolExecutor(max_workers=1) as pool:
        with owner.transaction():
            owner.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,921))', (str(ids['store_a']),))
            assert pool.submit(confirm).result(timeout=10) == '40001'
    assert owner.execute('SELECT to_jsonb(o) FROM public.orders o WHERE id=%s', (order[0],)).fetchone()[0] == snapshot
    print('PASS trusted-writer lock inversion and atomic order contention rejection')
