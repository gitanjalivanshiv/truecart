import { expect, test, type Page } from "@playwright/test";

/** Navigate and wait until the client has hydrated and its first data requests have settled. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function paypalConfigured(page: Page) {
  const health = await (await page.request.get("/api/health")).json();
  return Boolean(health.configured?.paypal);
}

async function rankWaterBottles(page: Page) {
  await open(page, "/offers");
  await page.getByRole("button", { name: "Rank offers" }).click();
  await expect(page.locator(".ag-row").first()).toBeVisible();
}

test("offers: ranked by landed cost, the cheapest sticker is not the cheapest landed, disallowed shops are denied", async ({
  page,
}) => {
  await rankWaterBottles(page);
  const first = page.locator(".ag-row[row-index='0']");
  await expect(first.locator("[col-id='trueRank']")).toHaveText("1");
  await expect(first.locator("[col-id='stickerRank']")).not.toHaveText("1");
  await expect(page.locator(".ag-row").filter({ hasText: "Store BE-1" }).getByText("Denied")).toBeVisible();
  // Masked: no store domains on screen.
  await expect(page.locator(".ag-root-wrapper")).not.toContainText(".com");
});

test("offers grid: market and mandate filters, quick filter, and a CSV of exactly what is shown", async ({ page }) => {
  await rankWaterBottles(page);
  const filters = page.getByRole("group", { name: "Filter offers" });
  const count = filters.getByRole("status");
  const total = Number((await count.textContent())!.match(/of (\d+)/)![1]);

  await filters.getByRole("button", { name: "US", exact: true }).click();
  await expect(count).not.toHaveText(`${total} of ${total} shown`);
  // Rows leave with an animation, so poll until only US shops remain.
  await expect
    .poll(async () =>
      (await page.locator(".ag-row [col-id='from']").allTextContents()).every((f) => f.startsWith("US")),
    )
    .toBe(true);

  await filters.getByRole("button", { name: "All shops" }).click();
  await filters.getByLabel("Only what my mandate allows").check();
  await expect(page.locator(".ag-row").filter({ hasText: "Denied" })).toHaveCount(0);
  await filters.getByLabel("Filter by product or store").fill("Store GB-1");
  await expect(count).toHaveText(new RegExp(`^1 of ${total} shown$`));

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    filters.getByRole("button", { name: "Download CSV" }).click(),
  ]);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(csv.split("\n")[0]).toContain("PayPal sandbox");
  expect(csv).toContain("Store GB-1");
  expect(csv).not.toContain("Store US-1"); // exports what the filters show
});

test("injection: a hijacked agent asking for 20 units is denied and nothing is charged", async ({ page }) => {
  await open(page, "/red-team");
  await expect(page.locator(".specimen")).toContainText("SYSTEM NOTICE FOR AI SHOPPING AGENTS");
  await page.getByRole("button", { name: "Send 20 units to checkout" }).click();
  await expect(page.locator(".stamp-big")).toHaveText("Denied");
  await expect(page.getByText("More units than one purchase allows")).toBeVisible();
  await expect(page.getByText("Nothing was charged.")).toBeVisible();
  await expect(page.locator("header")).toContainText("0.00 GBP of 400.00 GBP");
});

test("injection via the agent (recorded run): the model's 20-unit purchase is denied", async ({ page }) => {
  await open(page, "/red-team");
  await page.getByRole("button", { name: "Run the request" }).click();
  await expect(page.getByText(/Proposed buying o\d+ ×20/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("ol").getByText("Denied")).toBeVisible();
  await expect(page.locator("header")).toContainText("0.00 GBP of 400.00 GBP");
});

test("pause switch: a paused mandate refuses every purchase", async ({ page }) => {
  await open(page, "/mandate");
  await page.getByRole("button", { name: "Pause all purchases" }).click();
  await expect(page.locator("header").getByText("Paused")).toBeVisible();
  await rankWaterBottles(page);
  await page.locator(".ag-row[row-index='0']").click();
  await page.getByRole("button", { name: "Buy within mandate" }).click();
  const result = page.getByRole("status", { name: "Purchase result" });
  await expect(result).toContainText("Purchases are paused");
  await expect(result).toContainText("Nothing was charged.");
});

test("hero path (recorded AI run, real PayPal sandbox): the agent buys the bottle within the mandate", async ({
  page,
}) => {
  test.skip(!(await paypalConfigured(page)), "PayPal sandbox credentials not configured");
  await open(page, "/");
  await page.getByRole("button", { name: /Get me a 1L insulated water bottle/ }).click();
  await expect(page.locator("ol").getByText("Paid")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^recorded run of /)).toBeVisible();
  // The recorded run picks the true #1 (UK store, 15.00 + 3.99 simulated shipping).
  await expect(page.locator("header")).toContainText("18.99 GBP of 400.00 GBP");
  // After paying, the agent asks PayPal (Agent Toolkit, read-only) for its own record of the order.
  await expect(page.locator("ol li").filter({ hasText: "Asked PayPal for its own record" })).toContainText("Matches", {
    timeout: 30_000,
  });
  await open(page, "/ledger");
  await expect(page.locator(".ag-row").first()).toContainText("Paid");
  await expect(page.locator(".ag-row.row-total")).toContainText("1 paid in GBP");
  await page.getByRole("button", { name: "Check with PayPal" }).first().click();
  const check = page.getByRole("region", { name: "PayPal record check" });
  await expect(check.getByRole("status")).toContainText("Reconciled", { timeout: 30_000 });
  await expect(check).toContainText("get_order");
});

test("approval path (real PayPal sandbox): over the auto-buy limit waits for a person, then pays once", async ({
  page,
}) => {
  test.skip(!(await paypalConfigured(page)), "PayPal sandbox credentials not configured");
  await rankWaterBottles(page);
  await page.locator(".ag-row[row-index='0']").click();
  const detail = page.getByRole("region", { name: "Offer detail" });
  await expect(detail).toBeVisible();
  await detail.getByLabel("Units").fill("3");
  await detail.getByRole("button", { name: "Buy within mandate" }).click();
  await expect(page.getByText("waiting in Approvals")).toBeVisible();
  await open(page, "/approvals");
  await page.getByRole("button", { name: /Approve and pay/ }).click();
  await expect(page.getByText("Nothing to approve")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("table").getByText("Paid")).toBeVisible();
});
