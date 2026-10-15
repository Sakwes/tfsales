"""Run with Python Playwright and system Chromium against the mock-configured Vite server.

SELLNOVA_ISOLATED_MOCKS=1 VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=mock-public-key \
VITE_STORE_URL=http://127.0.0.1:8081 npm run dev -- --host 127.0.0.1 --port 8081 --strictPort
python tests/sprint1_browser.py

All backend calls are intercepted. External network requests fail closed.
"""
import json
import os
import unittest
from urllib.parse import urlsplit, parse_qs, unquote
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:8081"
STORE_ID = "11111111-1111-4111-8111-111111111111"
PRODUCT_ID = "22222222-2222-4222-8222-222222222222"
USER_ID = "33333333-3333-4333-8333-333333333333"
STORE = dict(id=STORE_ID, seller_id=USER_ID, store_name="Mock Shop", slug="mock-shop",
             contact_phone="2348031234567", whatsapp_phone="2348031234567", is_active=True)
PRODUCT = dict(id=PRODUCT_ID, store_id=STORE_ID, name="Test Shirt", description="Mock product",
               price=1000, images=[], is_available=True, track_stock=False, stock_quantity=5)
RECEIPT = dict(order_reference="SN-TEST123456", subtotal=1200, discount_total=200, total=1000,
               items=[dict(product_name="Test Shirt", quantity=1, unit_price=1200, line_total=1200)])


class SprintOneBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            headless=True, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context()
        self.calls = []
        self.external = []
        self.errors = []
        self.mode = "success"
        self.saved_orders = {}
        self.product = dict(PRODUCT, low_stock_threshold=0)
        self.orders = []
        self.order_writes = []
        self.order_error = False
        self.pending = None
        self.legacy = False
        self.empty = False
        self.context.route("**/*", self.handle_request)
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.context.add_init_script("""
          window.orderPopups = [];
          window.open = (url) => { window.orderPopups.push(url); return null; };
        """)

    def tearDown(self):
        if self.pending:
            self.pending.abort()
            self.pending = None
        self.context.unroute_all(behavior="wait")
        self.context.close()
        self.assertEqual(self.external, [], "Unexpected external request (blocked)")
        self.assertEqual(self.errors, [], "Uncaught browser error")

    def fulfill(self, route, data, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(data),
                      headers={"Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1"})

    def handle_request(self, route):
        req = route.request
        url = urlsplit(req.url)
        if url.hostname == "127.0.0.1" and url.port == 8081:
            route.continue_()
            return
        if url.hostname != "127.0.0.1" or url.port != 54321:
            self.external.append(f"{req.method} {url.hostname}")
            route.abort()
            return
        if req.method == "OPTIONS":
            route.fulfill(status=204, headers={"Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"})
            return
        if url.path.endswith("/rpc/sellnova_create_order"):
            self.calls.append(req.post_data_json)
            if self.mode == "hold":
                self.pending = route
            elif self.mode == "error":
                self.fulfill(route, {"message": "Test Shirt is currently unavailable", "code": "P0001"}, 400)
            elif self.mode == "network":
                route.abort("failed")
            elif self.mode == "invalid":
                self.fulfill(route, {"unexpected": True})
            else:
                key = req.post_data_json.get('_request_id')
                if key not in self.saved_orders:
                    self.saved_orders[key] = RECEIPT
                if self.mode == "lost_after_commit":
                    route.abort("failed")
                else:
                    self.fulfill(route, self.saved_orders[key])
            return
        if url.path.endswith("/rpc/sellnova_review_context"):
            self.fulfill(route, {"valid": False})
            return
        table = url.path.rsplit("/", 1)[-1]
        query = parse_qs(url.query)
        if table == "orders" and req.method == "PATCH":
            self.order_writes.append(req.post_data_json)
            if self.order_error:
                self.fulfill(route, {"message": "Insufficient stock for Test Shirt. Need 2, available 1", "code": "P0001"}, 400)
                return
            for order in self.orders:
                if query.get("id") == ["eq." + order["id"]] and query.get("status") == ["eq." + order["status"]]:
                    order.update(req.post_data_json)
                    self.fulfill(route, [{"id": order["id"]}])
                    return
            self.fulfill(route, [])
            return
        if req.method != "GET":
            # Existing visitor/view analytics writes are mocked too.
            self.fulfill(route, [])
            return
        if table == "stores":
            rows = [] if self.legacy and "slug" in query else [STORE]
        elif table == "products":
            rows = [] if self.empty else [self.product]
        elif table == "orders":
            rows = self.orders
        else:
            rows = []
        if "application/vnd.pgrst.object+json" in req.headers.get("accept", ""):
            self.fulfill(route, rows[0] if rows else None)
        else:
            self.fulfill(route, rows)

    def authenticate(self):
        user = dict(id=USER_ID, aud="authenticated", role="authenticated", email="mock@example.test",
                    app_metadata={}, user_metadata={}, created_at="2026-01-01T00:00:00Z")
        session = dict(access_token="mock-access-token", refresh_token="mock-refresh-token",
                       token_type="bearer", expires_at=4102444800, expires_in=3600, user=user)
        self.context.add_init_script(
            "localStorage.setItem('sb-127-auth-token', " + json.dumps(json.dumps(session)) + ");")

    def checkout(self):
        self.page.goto(BASE + "/store/mock-shop")
        expect(self.page.get_by_role("heading", name="Mock Shop", exact=True)).to_be_visible()
        self.page.get_by_role("button", name="Add", exact=True).click()
        self.page.get_by_role("button", name="Open cart, 1 item", exact=True).click()
        self.page.get_by_role("button", name="Send order on WhatsApp", exact=True).click()
        expect(self.page.get_by_role("heading", name="Checkout", exact=True)).to_be_visible()
        self.page.get_by_label("Full name", exact=True).fill("Ada Buyer")
        self.page.get_by_label("WhatsApp number", exact=True).fill("08031234567")
        self.page.get_by_label("Delivery address", exact=True).fill("10 Test Road, Lagos")
        self.page.get_by_label("Note to seller (optional)", exact=True).fill("Call on arrival")

    def submit(self):
        self.page.get_by_role("button", name="Save order and open WhatsApp", exact=True).click()

    def test_all_seller_routes_require_authentication(self):
        for route in ["onboarding", "dashboard", "analytics", "subscription", "branding", "orders", "reviews", "promotions"]:
            with self.subTest(route=route):
                self.page.goto(BASE + "/seller/" + route)
                self.page.wait_for_url("**/auth/login")
                expect(self.page.locator('input[type="password"]')).to_be_visible()

    def test_authenticated_seller_navigation(self):
        self.authenticate()
        self.page.goto(BASE + "/seller/dashboard")
        nav = self.page.get_by_role("navigation", name="Seller sections")
        expect(nav).to_be_visible()
        for label, heading, path in [("Orders", "Orders", "orders"), ("Reviews", "Reviews", "reviews"),
                                     ("Discounts", "Discounts", "promotions"),
                                     ("Store Design", "Store design", "branding"),
                                     ("Plan", "Your plan", "subscription"),
                                     ("Analytics", "Store Analytics", "analytics"),
                                     ("Products", "Mock Shop", "dashboard")]:
            with self.subTest(path=path):
                nav.get_by_role("link", name=label, exact=True).click()
                self.page.wait_for_url("**/seller/" + path)
                expect(self.page.get_by_role("heading", name=heading, exact=True)).to_be_visible()
                expect(nav.get_by_role("link", name=label, exact=True)).to_have_attribute("aria-current", "page")

    def test_order_saved_before_whatsapp_and_repeated_submit_guard(self):
        self.checkout()
        self.mode = "hold"
        with self.page.expect_request("**/rpc/sellnova_create_order"):
            self.submit()
        expect(self.page.get_by_role("button", name="Saving order…")).to_be_disabled()
        self.page.locator("form").evaluate("form => { form.requestSubmit(); form.requestSubmit(); }")
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.page.evaluate("window.orderPopups"), [])
        from uuid import UUID
        self.assertEqual(UUID(self.calls[0]["_request_id"]).version, 4)
        payload = {k: v for k, v in self.calls[0].items() if k != "_request_id"}
        self.assertEqual(payload, dict(_store_id=STORE_ID, _customer_name="Ada Buyer",
            _customer_phone="2348031234567", _delivery_address="10 Test Road, Lagos",
            _customer_note="Call on arrival", _items=[dict(product_id=PRODUCT_ID, quantity=1)]))
        self.fulfill(self.pending, RECEIPT)
        self.pending = None
        expect(self.page.get_by_text("SN-TEST123456", exact=True)).to_be_visible()
        link = self.page.get_by_role("link", name="Open saved order in WhatsApp")
        message = unquote(link.get_attribute("href"))
        self.assertIn("SN-TEST123456", message)
        self.assertIn("1,200", message)  # database unit price, not stale cart price
        self.assertIn("Discount:", message)
        self.assertIn("Ada Buyer", message)
        self.assertIn("10 Test Road, Lagos", message)
        self.assertEqual(len(self.page.evaluate("window.orderPopups")), 1)
        self.page.get_by_role("button", name="Close", exact=True).click()
        self.page.get_by_role("button", name="View saved order").click()
        expect(self.page.get_by_text("SN-TEST123456", exact=True)).to_be_visible()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(json.loads(self.page.evaluate(f"localStorage.getItem('sellnova:cart:{STORE_ID}')")), [])

    def test_save_error_keeps_cart_and_allows_corrected_retry(self):
        self.checkout()
        self.mode = "error"
        self.submit()
        expect(self.page.get_by_role("alert")).to_contain_text("currently unavailable")
        self.assertEqual(self.page.evaluate("window.orderPopups"), [])
        saved_cart = json.loads(self.page.evaluate(f"localStorage.getItem('sellnova:cart:{STORE_ID}')"))
        self.assertEqual(saved_cart[0]["id"], PRODUCT_ID)
        self.mode = "success"
        self.submit()
        expect(self.page.get_by_text("SN-TEST123456", exact=True)).to_be_visible()
        self.assertEqual(len(self.calls), 2)

    def test_invalid_buyer_does_not_call_backend(self):
        self.checkout()
        self.page.get_by_label("WhatsApp number", exact=True).fill("123")
        self.submit()
        expect(self.page.get_by_role("alert")).to_contain_text("valid WhatsApp number")
        self.assertEqual(self.calls, [])
        self.assertEqual(self.page.evaluate("window.orderPopups"), [])

    def test_malformed_success_does_not_allow_second_order(self):
        self.checkout()
        self.mode = "invalid"
        self.submit()
        expect(self.page.get_by_role("alert")).to_contain_text("invalid receipt")
        expect(self.page.get_by_role("button", name="Save order and open WhatsApp")).to_be_enabled()
        self.mode = "success"
        self.submit()
        expect(self.page.get_by_text("SN-TEST123456", exact=True)).to_be_visible()
        self.assertEqual(self.calls[0]["_request_id"], self.calls[1]["_request_id"])

    def test_ambiguous_network_failure_prevents_blind_retry(self):
        self.checkout()
        self.mode = "network"
        self.submit()
        expect(self.page.get_by_role("alert")).to_contain_text("Retry with the same details")
        expect(self.page.get_by_role("button", name="Save order and open WhatsApp")).to_be_enabled()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.page.evaluate("window.orderPopups"), [])
        self.page.get_by_role("button", name="Close", exact=True).click()
        self.page.get_by_role("button", name="Open cart, 1 item", exact=True).click()
        self.page.get_by_role("button", name="Send order on WhatsApp", exact=True).click()
        expect(self.page.get_by_role("alert")).to_contain_text("Retry with the same details")
        expect(self.page.get_by_role("button", name="Save order and open WhatsApp")).to_be_enabled()
        self.assertEqual(len(self.calls), 1)

    def test_cart_restore_and_quantity_controls(self):
        self.checkout()
        self.page.get_by_role("button", name="Close", exact=True).click()
        self.page.reload()
        self.page.get_by_role("button", name="Open cart, 1 item", exact=True).click()
        self.page.get_by_role("button", name="Increase quantity of Test Shirt").click()
        expect(self.page.locator('span[aria-live="polite"]')).to_have_text("2")
        self.page.get_by_role("button", name="Reduce quantity of Test Shirt").click()
        self.page.get_by_role("button", name="Remove Test Shirt from cart").click()
        expect(self.page.get_by_role("button", name="Send order on WhatsApp")).to_have_count(0)
        self.assertEqual(self.calls, [])

    def test_legacy_store_url_and_empty_store(self):
        self.legacy = True
        self.empty = True
        self.page.goto(BASE + "/store/mock-shop")
        expect(self.page.get_by_role("heading", name="Mock Shop", exact=True)).to_be_visible()
        expect(self.page.get_by_role("heading", name="No products yet")).to_be_visible()

    def test_public_review_route_and_landing(self):
        self.page.goto(BASE + "/review/mock-token")
        expect(self.page.get_by_role("heading", name="This review link is not valid")).to_be_visible()
        self.page.get_by_role("link", name="Go to SellNova").click()
        expect(self.page.get_by_role("heading", name="Create an Online Store in Minutes")).to_be_visible()


if __name__ == "__main__":
    unittest.main(verbosity=2)
