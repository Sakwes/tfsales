#!/usr/bin/env python3
"""Opt-in integration harness. No connection without --run and an explicit gate.
Creates/cleans only tagged synthetic fixtures. SQL is NOT executed by static tests.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from uuid import uuid4
from migrate import ROOT, load_plan
from target import PROJECT_REF, connect_verified


def claim(conn, role, user=None):
    if role not in ('anon','authenticated'):
        raise ValueError('Unsupported test role')
    conn.execute('SET LOCAL ROLE '+role)
    conn.execute("SELECT set_config('request.jwt.claims',%s,true)",
                 (json.dumps({'role':role,'sub':str(user) if user else None}),))


def checkout(conn, ids, request=None, quantity=1, items=None, role='anon', user=None):
    with conn.transaction():
        claim(conn,role,user)
        return conn.execute('''SELECT public.sellnova_create_order(%s,%s,%s,%s,%s,%s::jsonb,%s,%s)''',
            (ids['store_a'],'Synthetic Buyer','2348030000003','10 Synthetic Test Road','',
             json.dumps(items if items is not None else [{'product_id':str(ids['product']),'quantity':quantity}]),
             None,request or uuid4())).fetchone()[0]


def must_fail(conn, sql, params=(), role='authenticated', user=None):
    import psycopg
    try:
        with conn.transaction():
            claim(conn,role,user)
            conn.execute(sql,params)
    except psycopg.Error as error:
        assert error.sqlstate in ('42501','P0001','23514','23502','22023','22P02'), error.sqlstate
        return
    raise AssertionError('Expected database rejection')


def run():
    files=load_plan()
    ids={name:uuid4() for name in ['run','seller_a','seller_b','admin','store_a','store_b','product']}
    initialized=False
    print('SYNTHETIC RUN',ids['run'])
    with connect_verified() as owner:
        owner.execute('SELECT pg_advisory_lock(728410215)')
        try:
            actual=owner.execute('SELECT path,sha256,project_ref FROM sellnova_dev.migration_history').fetchall()
            if set(actual)!={(p,h,PROJECT_REF) for p,h,_ in files}:
                raise ValueError('Apply complete reviewed manifest first')
            if owner.execute("""SELECT EXISTS(SELECT 1 FROM auth.users WHERE
                coalesce((raw_user_meta_data->>'sellnova_synthetic_test'),'false')<>'true'
                OR email NOT LIKE '%@example.test')""").fetchone()[0]:
                raise ValueError('Not a disposable synthetic-only project')
            with owner.transaction():
                for name,value in ids.items():
                    owner.execute("SELECT set_config(%s,%s,true)",('sellnova.test_'+name,str(value)))
                owner.execute("SELECT set_config('sellnova.dev_project_ref',%s,true)",(PROJECT_REF,))
                owner.execute((ROOT/'database/development/tests/fixtures.sql').read_text(),prepare=False)
            initialized=True

            def reset_stock(count=20):
                owner.execute('UPDATE public.products SET stock_quantity=%s WHERE id=%s',(count,ids['product']))
                owner.execute('DELETE FROM sellnova_dev.rate_windows WHERE subject LIKE %s OR subject=%s',
                              (str(ids['store_a'])+'%',str(ids['product'])))

            # Auth trigger, email-first phone behavior, and default roles.
            assert owner.execute('SELECT phone FROM public.profiles WHERE id=%s',(ids['seller_a'],)).fetchone()==(None,)
            assert owner.execute("SELECT count(*) FROM public.user_roles WHERE user_id=%s AND role='seller'",(ids['seller_a'],)).fetchone()[0]==1
            print('PASS auth/profile trigger fixture (not real Auth API signup/login)')

            key=uuid4()
            first=checkout(owner,ids,key)
            again=checkout(owner,ids,key)
            assert first==again
            assert owner.execute('SELECT stock_quantity FROM public.products WHERE id=%s',(ids['product'],)).fetchone()[0]==19
            must_fail(owner,'SELECT public.sellnova_create_order(%s,%s,%s,%s,%s,%s::jsonb,%s,%s)',
                (ids['store_a'],'Synthetic Buyer','2348030000003','10 Synthetic Test Road','',
                 json.dumps([{'product_id':str(ids['product']),'quantity':2}]),None,key),role='anon')
            print('PASS replay returns same receipt and mismatched reuse rejects')

            order=owner.execute('SELECT id FROM public.orders WHERE order_reference=%s',(first['order_reference'],)).fetchone()[0]
            for column,value in [('stock_applied',False),('customer_name','forged'),('review_submitted',True)]:
                must_fail(owner,'UPDATE public.orders SET '+column+'=%s WHERE id=%s',(value,order),user=ids['seller_a'])
            with owner.transaction():
                claim(owner,'authenticated',ids['seller_b'])
                assert owner.execute('SELECT id FROM public.orders WHERE id=%s',(order,)).fetchall()==[]
                assert owner.execute("UPDATE public.orders SET status='confirmed' WHERE id=%s",(order,)).rowcount==0
            must_fail(owner,'SELECT * FROM public.orders',role='anon')
            must_fail(owner,'SELECT public.sellnova_discount_for(%s,1000,NULL,%s::jsonb)',(ids['store_a'],'[]'),role='anon')
            must_fail(owner,"INSERT INTO public.user_roles(user_id,role) VALUES(%s,'admin')",(ids['seller_b'],),user=ids['seller_b'])
            with owner.transaction():
                claim(owner,'authenticated',ids['seller_a'])
                owner.execute("UPDATE public.orders SET status='confirmed' WHERE id=%s",(order,))
            assert owner.execute('SELECT stock_quantity FROM public.products WHERE id=%s',(ids['product'],)).fetchone()[0]==19
            with owner.transaction():
                claim(owner,'authenticated',ids['seller_a'])
                owner.execute("UPDATE public.orders SET status='cancelled' WHERE id=%s",(order,))
                owner.execute("UPDATE public.orders SET status='cancelled' WHERE id=%s",(order,))
            assert owner.execute('SELECT stock_quantity FROM public.products WHERE id=%s',(ids['product'],)).fetchone()[0]==20
            print('PASS RLS/column grants; confirmation and repeated cancellation do not double-apply stock')

            reset_stock(1)
            def worker(request):
                import psycopg
                try:
                    with connect_verified() as conn:return checkout(conn,ids,request)
                except psycopg.Error as error:return error.sqlstate
            same=uuid4()
            with ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(worker,[same,same]))
            assert isinstance(results[0],dict) and results[0]==results[1]
            reset_stock(1)
            with ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(worker,[uuid4(),uuid4()]))
            assert sum(isinstance(r,dict) for r in results)==1 and 'P0001' in results
            print('PASS concurrent replay creates one order; last-unit race has one winner')

            reset_stock(1)
            bad_items=[{'product_id':str(ids['product']),'quantity':1}]*2
            count=owner.execute('SELECT count(*) FROM public.orders WHERE store_id=%s',(ids['store_a'],)).fetchone()[0]
            must_fail(owner,'SELECT public.sellnova_create_order(%s,%s,%s,%s,%s,%s::jsonb,%s,%s)',
                (ids['store_a'],'Synthetic Buyer','2348030000003','10 Synthetic Test Road','',json.dumps(bad_items),None,uuid4()),role='anon')
            assert owner.execute('SELECT count(*) FROM public.orders WHERE store_id=%s',(ids['store_a'],)).fetchone()[0]==count
            assert owner.execute('SELECT stock_quantity FROM public.products WHERE id=%s',(ids['product'],)).fetchone()[0]==1
            print('PASS aggregated duplicate lines and insufficient-stock rollback')

            reset_stock(10)
            promotion=owner.execute("""INSERT INTO public.promotions(store_id,name,discount_type,value,scope,usage_limit)
              VALUES(%s,'Synthetic one use','fixed',10,'store',1) RETURNING id""",(ids['store_a'],)).fetchone()[0]
            with ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(worker,[uuid4(),uuid4()]))
            assert all(isinstance(result,dict) for result in results)
            assert sorted(result['discount_total'] for result in results)==[0,10]
            assert owner.execute('SELECT used_count FROM public.promotions WHERE id=%s',(promotion,)).fetchone()[0]==1
            print('PASS concurrent promotion usage limit')

            must_fail(owner,'SELECT * FROM sellnova_dev.checkout_requests',role='anon')
            must_fail(owner,'SELECT * FROM public.store_subscriptions',role='anon')
            for bad in [None,[],[{'product_id':str(ids['product']),'quantity':0}],
                        [{'product_id':str(ids['product']),'quantity':1.5}]]:
                must_fail(owner,'SELECT public.sellnova_create_order(%s,%s,%s,%s,%s,%s::jsonb,%s,%s)',
                    (ids['store_a'],'Synthetic Buyer','2348030000003','10 Synthetic Test Road','',json.dumps(bad),None,uuid4()),role='anon')
            # Seed a saturated server-side window, then verify the public insert
            # cannot evade it through anonymous RLS filtering.
            owner.execute("""INSERT INTO sellnova_dev.rate_windows(scope,subject,window_start,hits)
              VALUES('visit',%s,date_trunc('minute',clock_timestamp()),30)
              ON CONFLICT(scope,subject,window_start) DO UPDATE SET hits=30""",(str(ids['store_a']),))
            must_fail(owner,'INSERT INTO public.store_visitors(store_id) VALUES(%s)',(ids['store_a'],),role='anon')
            assert owner.execute("SELECT public.has_role(%s,'admin')",(ids['seller_a'],)).fetchone()[0] is False
            buckets=dict(owner.execute("SELECT id,public FROM storage.buckets WHERE id IN ('product-images','store-logos','payment-proofs')").fetchall())
            assert buckets=={'product-images':True,'store-logos':False,'payment-proofs':False}
            print('PASS input bounds, private ACLs, analytic rate rejection and bucket privacy metadata')

            # A transaction-local test price never changes the stored zero-price seed.
            with owner.transaction():
                owner.execute("UPDATE public.plans SET price_ngn=5000 WHERE code='paid'")
                paid=owner.execute("SELECT id FROM public.plans WHERE code='paid'").fetchone()[0]
                with owner.transaction():
                    claim(owner,'authenticated',ids['seller_a'])
                    owner.execute('''INSERT INTO public.subscription_requests(store_id,plan_id,amount,payment_reference)
                      VALUES(%s,%s,5000,'SYNTHETIC-NO-PAYMENT')''',(ids['store_a'],paid))
                request=owner.execute('SELECT id FROM public.subscription_requests WHERE store_id=%s',(ids['store_a'],)).fetchone()[0]
                must_fail(owner,'SELECT public.sellnova_decide_subscription(%s,true,NULL,30)',(request,),user=ids['seller_a'])
                with owner.transaction():
                    claim(owner,'authenticated',ids['admin'])
                    owner.execute('SELECT public.sellnova_decide_subscription(%s,true,NULL,30)',(request,))
                assert owner.execute('SELECT status FROM public.subscription_requests WHERE id=%s',(request,)).fetchone()[0]=='approved'
                # Roll back price, request, decision and audit changes together.
                from psycopg import Rollback
                raise Rollback()
            print('PASS seller cannot approve; synthetic admin can; temporary billing fixture rolled back')
        finally:
            if initialized:
                with owner.transaction():
                    owner.execute('DELETE FROM public.admin_audit_log WHERE store_id IN (%s,%s)',(ids['store_a'],ids['store_b']))
                    owner.execute('DELETE FROM sellnova_dev.rate_windows WHERE subject LIKE %s OR subject=%s',
                                  (str(ids['store_a'])+'%',str(ids['product'])))
                    owner.execute("DELETE FROM auth.users WHERE id IN (%s,%s,%s) AND email LIKE '%%@example.test' AND raw_user_meta_data->>'sellnova_synthetic_test'='true'",
                                  (ids['seller_a'],ids['seller_b'],ids['admin']))
            owner.execute('SELECT pg_advisory_unlock(728410215)')


def main():
    if not __debug__:
        raise RuntimeError('Tests must run without Python optimization')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',action='store_true')
    args=parser.parse_args()
    if not args.run:
        print('PREPARED ONLY: integration requires approved --run; no connection or SQL execution')
        return 0
    if os.environ.get('DEVDB_TEST_APPROVAL')!='RUN-SYNTHETIC-'+PROJECT_REF:
        print('STOP: explicit synthetic test approval required')
        return 1
    try:run()
    except Exception as error:
        print('FAIL:',type(error).__name__,'(details suppressed to protect credentials and rows)')
        return 1
    return 0


if __name__=='__main__':
    raise SystemExit(main())
