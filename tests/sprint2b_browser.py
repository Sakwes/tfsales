"""Sprint 2B regressions plus inherited Sprint 1 coverage; isolated mocks only."""
import json
import unittest
from playwright.sync_api import expect
import sprint1_browser as baseline


class SprintTwoBrowserTests(baseline.SprintOneBrowserTests):
    def reopen_after_reload(self):
        self.page.reload()
        self.page.get_by_role('button',name='Open cart, 1 item',exact=True).click()
        self.page.get_by_role('button',name='Send order on WhatsApp',exact=True).click()
        expect(self.page.get_by_label('Full name',exact=True)).to_have_value('Ada Buyer')
        expect(self.page.get_by_label('Delivery address',exact=True)).to_have_value('10 Test Road, Lagos')

    def test_lost_commit_response_survives_refresh(self):
        self.checkout()
        self.mode='lost_after_commit'
        self.submit()
        expect(self.page.get_by_role('alert')).to_contain_text('Retry with the same details')
        self.assertEqual(self.page.evaluate('window.orderPopups'),[])
        self.reopen_after_reload()
        self.mode='success'
        self.submit()
        expect(self.page.get_by_text('SN-TEST123456',exact=True)).to_be_visible()
        self.assertEqual(self.calls[0]['_request_id'],self.calls[1]['_request_id'])
        self.assertEqual(len(self.saved_orders),1)

    def test_changed_payload_gets_new_uuid(self):
        self.checkout()
        self.mode='error'
        self.submit()
        expect(self.page.get_by_role('alert')).to_contain_text('currently unavailable')
        original=self.calls[0]['_request_id']
        self.page.get_by_label('Note to seller (optional)',exact=True).fill('A genuinely changed request')
        self.submit()
        expect(self.page.get_by_role('button',name='Save order and open WhatsApp',exact=True)).to_be_enabled()
        self.assertEqual(len(self.calls),2)
        self.assertNotEqual(original,self.calls[1]['_request_id'])

    def test_same_payload_retry_keeps_uuid(self):
        self.checkout()
        self.mode='error'
        self.submit()
        expect(self.page.get_by_role('alert')).to_contain_text('currently unavailable')
        self.submit()
        expect(self.page.get_by_role('button',name='Save order and open WhatsApp',exact=True)).to_be_enabled()
        self.assertEqual(len(self.calls),2)
        self.assertEqual(self.calls[0]['_request_id'],self.calls[1]['_request_id'])

    def test_changed_cart_gets_new_uuid(self):
        self.checkout()
        self.mode='error'
        self.submit()
        expect(self.page.get_by_role('alert')).to_contain_text('currently unavailable')
        original=self.calls[0]['_request_id']
        self.page.get_by_role('button',name='Close',exact=True).click()
        self.page.get_by_role('button',name='Open cart, 1 item',exact=True).click()
        self.page.get_by_role('button',name='Increase quantity of Test Shirt').click()
        self.page.get_by_role('button',name='Send order on WhatsApp',exact=True).click()
        self.submit()
        expect(self.page.get_by_role('button',name='Save order and open WhatsApp',exact=True)).to_be_enabled()
        self.assertNotEqual(original,self.calls[-1]['_request_id'])
        self.assertEqual(self.calls[-1]['_items'][0]['quantity'],2)

    def test_equivalent_phone_and_whitespace_keep_uuid(self):
        self.checkout()
        self.mode='error'
        self.submit()
        expect(self.page.get_by_role('alert')).to_contain_text('currently unavailable')
        original=self.calls[0]['_request_id']
        self.page.get_by_label('Full name',exact=True).fill('  Ada Buyer  ')
        self.page.get_by_label('WhatsApp number',exact=True).fill('+2348031234567')
        self.submit()
        expect(self.page.get_by_role('button',name='Save order and open WhatsApp',exact=True)).to_be_enabled()
        self.assertEqual(original,self.calls[-1]['_request_id'])

    def test_blocked_checkout_storage_sends_no_rpc(self):
        self.context.add_init_script("""
          const original=Storage.prototype.setItem;
          Storage.prototype.setItem=function(key,value) {
            if(key.startsWith('sellnova:checkout:')) throw new DOMException('Blocked','QuotaExceededError');
            return original.call(this,key,value);
          };
        """)
        self.checkout()
        self.submit()
        expect(self.page.get_by_role('alert')).to_contain_text('retry reference')
        self.assertEqual(self.calls,[])
        self.assertEqual(self.page.evaluate('window.orderPopups'),[])

    def test_two_tabs_retry_same_pending_uuid(self):
        self.checkout()
        self.mode='lost_after_commit'
        self.submit()
        expect(self.page.get_by_role('alert')).to_contain_text('Retry with the same details')
        original=self.calls[0]['_request_id']
        first=self.page
        self.page=self.context.new_page()
        self.page.goto(baseline.BASE+'/store/mock-shop')
        self.page.get_by_role('button',name='Open cart, 1 item',exact=True).click()
        self.page.get_by_role('button',name='Send order on WhatsApp',exact=True).click()
        for label,value in [('Full name','Ada Buyer'),('WhatsApp number','08031234567'),
                            ('Delivery address','10 Test Road, Lagos'),('Note to seller (optional)','Call on arrival')]:
            self.page.get_by_label(label,exact=True).fill(value)
        self.mode='success'
        self.submit()
        expect(self.page.get_by_text('SN-TEST123456',exact=True)).to_be_visible()
        self.assertEqual(self.calls[-1]['_request_id'],original)
        self.page=first
        self.submit()
        expect(self.page.get_by_text('SN-TEST123456',exact=True)).to_be_visible()
        self.assertEqual(self.calls[-1]['_request_id'],original)
        self.assertEqual(len(self.saved_orders),1)

    def test_timeout_retains_identity(self):
        self.context.add_init_script("""
          AbortSignal.timeout=()=>{ const c=new AbortController(); setTimeout(()=>c.abort(),250); return c.signal; };
        """)
        self.checkout()
        self.mode='hold'
        self.submit()
        expect(self.page.get_by_role('alert')).to_contain_text('Retry with the same details')
        original=self.calls[0]['_request_id']
        self.mode='success'
        self.submit()
        expect(self.page.get_by_text('SN-TEST123456',exact=True)).to_be_visible()
        self.assertEqual(self.calls[-1]['_request_id'],original)

    def test_out_of_stock_product_cannot_be_added(self):
        self.product.update(track_stock=True,stock_quantity=0)
        self.page.goto(baseline.BASE+'/store/mock-shop')
        expect(self.page.get_by_text('Out of stock',exact=True)).to_be_visible()
        expect(self.page.get_by_role('button',name='Add',exact=True)).to_be_disabled()

    def prepare_order(self):
        self.authenticate()
        self.orders=[dict(id='44444444-4444-4444-8444-444444444444',order_reference='SN-SELLER-TEST',
            customer_name='Synthetic Buyer',customer_phone='2348030000003',delivery_address='10 Synthetic Road',
            customer_note=None,status='new',subtotal=2000,discount_total=0,delivery_fee=0,total=2000,
            review_token=None,review_submitted=False,created_at='2026-10-15T12:00:00Z',
            order_items=[dict(id='item',product_name='Test Shirt',unit_price=1000,quantity=2,line_total=2000)])]
        self.page.goto(baseline.BASE+'/seller/orders')
        self.page.get_by_role('button',name='View',exact=True).click()

    def test_seller_insufficient_stock_is_visible_and_pending(self):
        self.prepare_order()
        self.order_error=True
        self.page.get_by_role('button',name='Mark confirmed',exact=True).click()
        expect(self.page.get_by_role('dialog').get_by_role('alert')).to_contain_text('Insufficient stock')
        self.assertEqual(self.orders[0]['status'],'new')
        expect(self.page.get_by_role('button',name='Mark confirmed',exact=True)).to_be_enabled()

    def test_seller_confirm_cancel_uses_authoritative_status(self):
        self.prepare_order()
        self.page.get_by_role('button',name='Mark confirmed',exact=True).click()
        expect(self.page.get_by_role('button',name='Mark processing',exact=True)).to_be_visible()
        self.assertEqual(self.orders[0]['status'],'confirmed')
        expect(self.page.get_by_role('button',name='Mark confirmed',exact=True)).to_have_count(0)
        self.page.get_by_role('button',name='Mark cancelled',exact=True).click()
        expect(self.page.get_by_role('dialog')).to_be_visible()
        expect(self.page.get_by_role('button',name='Mark processing',exact=True)).to_have_count(0)
        self.assertEqual(self.orders[0]['status'],'cancelled')
        self.assertEqual(self.order_writes,[{'status':'confirmed'},{'status':'cancelled'}])


if __name__=='__main__':
    unittest.main(verbosity=2)
