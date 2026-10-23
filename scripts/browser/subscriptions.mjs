import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
// Every API call is intercepted. A failed mock never falls back to Supabase.
const origin = "http://127.0.0.1:4174";
const api = "http://127.0.0.1:54321";
const seller = "11111111-1111-4111-8111-111111111111";
const store = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const paidId = "44444444-4444-4444-8444-444444444444";
const plans = [
  {
    id: "free",
    code: "free",
    name: "Free",
    max_products: 12,
    price_ngn: 0,
    duration_days: 3650,
  },
  {
    id: paidId,
    code: "paid",
    name: "Paid",
    max_products: 100,
    price_ngn: 1500,
    duration_days: 30,
    allow_stock: true,
    allow_discounts: true,
    allow_reviews: true,
    allow_branding: true,
  },
];
let role = "seller",
  enabled = true,
  history = [],
  amount = 1500,
  version = 1;
let failQuote = false,
  failSettings = false,
  subscription = null;
const calls = [],
  unexpected = [];
const bank = () => ({
  id: true,
  bank_name: "OPay mock provider",
  account_name: "SYNTHETIC ONLY",
  account_number: "0000000000",
  payment_instructions: "MOCK ONLY. Do not transfer.",
  payment_collection_enabled: enabled,
  version,
});
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "4174",
    "--strictPort",
  ],
  {
    env: {
      ...process.env,
      SELLNOVA_ISOLATED_MOCKS: "1",
      VITE_SUPABASE_URL: api,
      VITE_SUPABASE_PUBLISHABLE_KEY: "mock-public-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (x) => (serverLog += x));
server.stderr.on("data", (x) => (serverLog += x));
let browser;
try {
  for (let tries = 0; ; tries++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* server starting */
    }
    if (tries > 100 || server.exitCode !== null)
      throw new Error("Mock server failed: " + serverLog);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
    headless: true,
  });
  const context = await browser.newContext();
  await context.addInitScript(
    ({ seller }) => {
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: seller,
            aud: "authenticated",
            role: "authenticated",
            email: "mock@example.test",
            app_metadata: {},
            user_metadata: {},
          },
        }),
      );
    },
    { seller },
  );
  await context.route("**/*", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.origin === origin) return route.continue();
    if (u.origin !== api) {
      unexpected.push(req.url());
      return route.abort();
    }
    const reply = (body, status = 200, headers = {}) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": origin, ...headers },
        body: JSON.stringify(body),
      });
    if (req.method() === "OPTIONS") return reply({});
    const endpoint = u.pathname.split("/").pop();
    if (u.pathname.startsWith("/auth/"))
      return reply({ id: seller, role: "authenticated" });
    if (u.pathname.includes("/rpc/")) {
      const body = req.postDataJSON();
      calls.push({ endpoint, body });
      if (endpoint === "sellnova_begin_payment") {
        assert.deepEqual(body, { _store_id: store });
        if (failQuote)
          return reply({ message: "Payment collection is unavailable" }, 400);
        history = [
          {
            id,
            store_id: store,
            plan_id: paidId,
            status: "draft",
            amount,
            duration_days: 30,
            payment_reference: "quote-" + id,
            payment_snapshot: {
              ...bank(),
              price_ngn: amount,
              duration_days: 30,
            },
            settings_version: version,
            created_at: new Date().toISOString(),
          },
        ];
        return reply(id);
      }
      if (endpoint === "sellnova_notify_payment") {
        assert.equal(body._request_id, id);
        assert.equal(body._reference, "MOCK-TRANSFER-1");
        assert.ok(body._proof_path?.startsWith(seller + "/"));
        history[0] = {
          ...history[0],
          status: "pending",
          payment_reference: body._reference,
          proof_path: body._proof_path,
        };
        return reply({ ok: true });
      }
      if (endpoint === "sellnova_update_payment_settings") {
        if (failSettings)
          return reply(
            { message: "Settings changed; reload before saving" },
            400,
          );
        assert.equal(body._version, version);
        amount = body._amount;
        enabled = body._enabled;
        version++;
        return reply({ ok: true });
      }
      if (endpoint === "sellnova_review_payment") {
        assert.equal(role, "admin");
        assert.equal(body._request_id, id);
        if (body._approve) assert.equal(body._verified, true);
        else assert.ok(body._reason);
        history[0] = {
          ...history[0],
          status: body._approve ? "approved" : "rejected",
          decision_reason: body._reason,
        };
        return reply({ ok: true });
      }
      unexpected.push(endpoint);
      return reply({ message: "Unmocked RPC" }, 500);
    }
    if (req.method() !== "GET" && req.method() !== "HEAD") {
      if (u.pathname.startsWith("/storage/"))
        return reply({ Key: "mock-upload" });
      unexpected.push(req.method() + " " + req.url());
      return route.abort();
    }
    if (endpoint === "user_roles")
      return reply(role === "admin" ? { role: "admin" } : null);
    if (endpoint === "stores") return reply({ id: store });
    if (endpoint === "plans")
      return reply(
        u.searchParams.has("code")
          ? { price_ngn: amount, duration_days: 30 }
          : plans.map((p) =>
              p.code === "paid" ? { ...p, price_ngn: amount } : p,
            ),
      );
    if (endpoint === "platform_settings") return reply(bank());
    if (endpoint === "products") return reply([], 200, { "content-range": "0-4/5" });
    if (endpoint === "store_subscriptions") return reply(subscription);
    if (endpoint === "subscription_requests") {
      const rows = history
        .filter(
          (r) =>
            !u.searchParams.has("status") ||
            u.searchParams.get("status") === "eq." + r.status,
        )
        .map((r) => ({
          ...r,
          stores: { store_name: "Mock seller store", seller_id: seller },
        }));
      return reply(rows, 200, {
        "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
      });
    }
    if (endpoint === "admin_audit_log")
      return reply([
        {
          id: "audit",
          action: "payment.settings.updated",
          created_at: new Date().toISOString(),
          details: { amount },
        },
      ]);
    unexpected.push(req.url());
    return reply({ message: "Unmocked endpoint" }, 500);
  });
  const page = await context.newPage();
  await page.goto(origin + "/seller/subscription");
  await expect(page.getByText("Free forever")).toBeVisible();
  await expect(page.getByText("Up to 100 products")).toBeVisible();
  await page.getByRole("button", { name: "Get payment instructions" }).click();
  await expect(page.getByText("Your saved payment instructions")).toBeVisible();
  // Global fee change must not change the displayed saved quote.
  amount = 2500;
  await page.reload();
  await expect(page.getByText("Transfer ₦1,500")).toBeVisible();
  await page.getByLabel("Transfer reference").fill("MOCK-TRANSFER-1");
  await page
    .getByLabel("Payment proof (optional)")
    .setInputFiles({
      name: "receipt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("mock proof"),
    });
  await page.getByRole("button", { name: "I Have Made Payment" }).click();
  await expect(
    page.getByText(
      "Pending: payment under review. Paid features activate only after approval.",
    ),
  ).toBeVisible();
  assert.equal(
    calls.filter((c) => c.endpoint === "sellnova_review_payment").length,
    0,
  );
  subscription = {
    store_id: store,
    plan_id: paidId,
    status: "active",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Current plan: Paid" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Paid access is active" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Get payment instructions" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "I Have Made Payment" })).toHaveCount(0);
  const quoteCalls = calls.filter(c => c.endpoint === "sellnova_begin_payment").length;
  history[0].status = "draft";
  subscription.expires_at = null; // Indefinite active legacy Paid access is also guarded.
  await page.reload();
  await expect(page.getByRole("button", { name: "Get payment instructions" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "I Have Made Payment" })).toHaveCount(0);
  assert.equal(calls.filter(c => c.endpoint === "sellnova_begin_payment").length, quoteCalls);
  history[0].status = "pending";
  subscription.expires_at = new Date(Date.now() - 86400000).toISOString();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Current plan: Free" }),
  ).toBeVisible();
  subscription = null;
  console.log(
    "PASS seller plans, saved quote after price change, private proof upload and pending notification",
  );

  role = "admin";
  await page.goto(origin + "/admin/subscriptions");
  await expect(
    page.getByRole("heading", { name: "Subscriptions and payments" }),
  ).toBeVisible();
  await page.getByLabel("Subscription amount (NGN)").fill("3000");
  await page.getByRole("button", { name: "Save payment settings" }).click();
  await expect(
    page.getByText("Payment settings saved and audited."),
  ).toBeVisible();
  failSettings = true;
  await page.getByRole("button", { name: "Save payment settings" }).click();
  await expect(
    page.getByText("Settings changed; reload before saving"),
  ).toBeVisible();
  failSettings = false;
  const approve = page.getByRole("button", { name: "Approve payment" });
  await expect(approve).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I verified this transfer/ })
    .check();
  await approve.click();
  await expect(page.getByText("Subscription approved.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve payment" }),
  ).toHaveCount(0);
  history[0].status = "pending";
  await page.getByRole("button", { name: "Refresh requests" }).click();
  await page
    .getByLabel("Decision note (required when rejecting)")
    .fill("No matching transfer");
  await page.getByRole("button", { name: "Reject payment" }).click();
  await expect(page.getByText("Payment rejected.")).toBeVisible();
  console.log(
    "PASS admin fee save, stale settings failure, verification acknowledgement, single decision and rejection",
  );

  role = "seller";
  history = [];
  enabled = false;
  await page.goto(origin + "/seller/subscription");
  await expect(
    page.getByRole("button", { name: "Get payment instructions" }),
  ).toBeDisabled();
  enabled = true;
  failQuote = true;
  await page.reload();
  await page.getByRole("button", { name: "Get payment instructions" }).click();
  await expect(
    page.getByText("Payment collection is unavailable"),
  ).toBeVisible();
  assert.equal(history.length, 0);
  await page.goto(origin + "/admin/subscriptions");
  await page.waitForURL("**/seller/dashboard");
  assert.deepEqual(unexpected, []);
  console.log(
    "PASS paused collection, server failure feedback, unauthorized admin redirect and no external network",
  );
} finally {
  await browser?.close();
  server.kill();
}
