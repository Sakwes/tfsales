"""Prepared synthetic-only expiry/publication contracts, including real concurrent sessions.
Called only by the existing explicitly gated, synthetic-project integration harness.
"""
from concurrent.futures import ThreadPoolExecutor
import json
from uuid import uuid4
from integration import claim, must_fail
from target import connect_verified


def check_publication(owner, ids):
    seller, store, run = uuid4(), uuid4(), ids['run']
    created = False
    state_sql = 'SELECT public.sellnova_publication_state(%s)'
    select_sql = 'SELECT public.sellnova_set_publication(%s,%s::uuid[],%s)'
    insert_sql = "INSERT INTO public.products(store_id,name,price) VALUES(%s,%s,1000) RETURNING id"

    def as_user(conn, sql, params=(), role='authenticated', user=seller):
        with conn.transaction():
            claim(conn, role, user)
            return conn.execute(sql, params).fetchall()

    def state():
        return as_user(owner, state_sql, (store,))[0][0]

    def public():
        return as_user(owner, 'SELECT id FROM public.sellnova_storefront_products(%s)', (store,), role='anon', user=None)

    def entitlement(active):
        owner.execute("""INSERT INTO public.store_subscriptions(store_id,plan_id,status,expires_at)
          SELECT %s,id,'active',CASE WHEN %s THEN now()+interval '30 days' ELSE now()-interval '1 day' END
          FROM public.plans WHERE code='paid'
          ON CONFLICT(store_id) DO UPDATE SET status='active',expires_at=EXCLUDED.expires_at""", (store, active))

    try:
        owner.execute("""INSERT INTO auth.users(id,email,aud,role,raw_user_meta_data)
          VALUES(%s,%s,'authenticated','authenticated',%s::jsonb)""",
          (seller, 'publication+'+str(run)+'@example.test', json.dumps({'sellnova_synthetic_test': True, 'sellnova_test_run': str(run)})))
        created = True
        owner.execute("INSERT INTO public.stores(id,seller_id,store_name,contact_phone) VALUES(%s,%s,%s,'2348030000009')",
                      (store, seller, 'Publication '+str(run)[:8]))
        assert state()['plan'] == 'free' and state()['allowance'] == 12
        for i in range(11):
            as_user(owner, insert_sql, (store, 'Publication '+str(i)))

        def insert_worker(i):
            import psycopg
            try:
                with connect_verified() as conn:
                    as_user(conn, insert_sql, (store, 'Concurrent '+str(i)))
                return 'inserted'
            except psycopg.Error as error:
                return error.sqlstate
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(insert_worker, (1, 2)))
        assert sorted(results) == ['P0001', 'inserted']
        assert state()['saved_count'] == 12 and len(public()) == 12
        must_fail(owner, insert_sql, (store, 'Thirteenth'), user=seller, states=('P0001',))
        entitlement(True)
        for i in range(3):
            as_user(owner, insert_sql, (store, 'Paid extra '+str(i)))
        assert state()['plan'] == 'paid' and len(public()) == 15
        all_ids = [r[0] for r in owner.execute('SELECT id FROM public.products WHERE store_id=%s ORDER BY created_at,id', (store,)).fetchall()]
        owner.execute('UPDATE public.products SET track_stock=true,stock_quantity=10 WHERE id=%s', (all_ids[0],))
        owner.execute("INSERT INTO public.store_branding(store_id,primary_color) VALUES(%s,'#123456')", (store,))
        entitlement(False)
        expired = state()
        assert expired['status'] == 'expired' and expired['plan'] == 'free'
        assert set(expired['visible_ids']) == set(map(str, all_ids[:12]))
        assert expired['saved_count'] == 15 and len(expired['selected_ids']) == 15
        hidden = all_ids[-1]
        assert as_user(owner, 'SELECT id FROM public.products WHERE id=%s', (hidden,), role='anon', user=None) == []
        assert as_user(owner, 'SELECT public.sellnova_public_branding(%s)', (store,), role='anon', user=None)[0][0] == {'entitled': False}
        entitlement(True)
        assert len(public()) == 15  # Temporarily suppressed products restore without recreation.
        assert as_user(owner, 'SELECT public.sellnova_public_branding(%s)', (store,), role='anon', user=None)[0][0]['primary_color'] == '#123456'
        entitlement(False)
        expired = state()
        must_fail(owner, select_sql, (store, all_ids[:13], expired['version']), user=seller, states=('P0001',))
        must_fail(owner, select_sql, (store, all_ids[:12], expired['version']), user=ids['seller_b'], states=('P0001',))
        must_fail(owner, 'UPDATE public.products SET publication_selected=false WHERE id=%s', (all_ids[0],), user=seller, states=('42501',))

        def selection_worker(selection):
            import psycopg
            try:
                with connect_verified() as conn:
                    as_user(conn, select_sql, (store, selection, expired['version']))
                return 'saved'
            except psycopg.Error as error:
                return error.sqlstate
        choices = (all_ids[:12], all_ids[:11]+[hidden])
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(selection_worker, choices))
        assert sorted(results) == ['P0001', 'saved']
        selected = state()
        assert len(selected['visible_ids']) == 12 and selected['saved_count'] == 15
        # Make a deterministic replacement and reject stale clients after it.
        replacement = [all_ids[-1], *all_ids[1:12]]
        as_user(owner, select_sql, (store, replacement, selected['version']))
        assert set(state()['visible_ids']) == set(map(str, replacement))
        assert owner.execute('SELECT track_stock,stock_quantity FROM public.products WHERE id=%s', (all_ids[0],)).fetchone() == (True, 10)
        checkout_sql = 'SELECT public.sellnova_create_order(%s,%s,%s,%s,%s,%s::jsonb,%s,%s)'
        def checkout_params(product, request):
            return (store, 'Synthetic Buyer', '2348030000003', '10 Synthetic Test Road', '', json.dumps([{'product_id': str(product), 'quantity': 1}]), None, request)
        request = uuid4()
        receipt = as_user(owner, checkout_sql, checkout_params(hidden, request), role='anon', user=None)[0][0]
        # Unpublish an item already in an accepted order/cart, preserving order history.
        current = state()
        as_user(owner, select_sql, (store, all_ids[:12], current['version']))
        must_fail(owner, checkout_sql, checkout_params(hidden, uuid4()), role='anon', states=('P0001',))
        replay = as_user(owner, checkout_sql, checkout_params(hidden, request), role='anon', user=None)[0][0]
        assert replay == receipt  # Existing accepted receipt, not a new hidden-product purchase.
        assert owner.execute('SELECT count(*) FROM public.orders WHERE store_id=%s', (store,)).fetchone()[0] == 1
        order = owner.execute('SELECT id FROM public.orders WHERE store_id=%s', (store,)).fetchone()[0]
        as_user(owner, "UPDATE public.orders SET status='confirmed' WHERE id=%s RETURNING id", (order,))
        assert owner.execute('SELECT product_name FROM public.order_items WHERE order_id=%s', (order,)).fetchone()
        entitlement(True)
        assert len(public()) == 12  # Explicitly unpublished products do not auto-restore.
        current = state()
        as_user(owner, select_sql, (store, all_ids, current['version']))
        assert len(public()) == 15
        owner.execute("INSERT INTO public.products(store_id,name,price) SELECT %s,'Paid cap '||i,1000 FROM generate_series(1,85) i", (store,))
        assert state()['saved_count'] == 100 and len(public()) == 100
        must_fail(owner, insert_sql, (store, 'Paid 101'), user=seller, states=('P0001',))
        print('PASS permanent Free, concurrent caps/selections, expiry, public RLS, hidden checkout, history and renewal restoration')
    finally:
        if created:
            owner.execute('DELETE FROM sellnova_dev.rate_windows WHERE subject LIKE %s', (str(store)+'%',))
            owner.execute("DELETE FROM auth.users WHERE id=%s AND email LIKE 'publication+%%@example.test' AND raw_user_meta_data->>'sellnova_test_run'=%s", (seller, str(run)))
