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
  await expect(page.getByText("Purchases are paused")).toBeVisible();
  await expect(page.getByText("Nothing was charged.")).toBeVisible();
});

test("hero path (recorded AI run, real PayPal sandbox): the agent buys the bottle within the mandate", async ({
  page,
}) => {
  test.skip(!(await paypalConfigured(page)), "PayPal sandbox credentials not configured");
  await open(page, "/");
  await page.getByRole("button", { name: /Get me a 1L insulated water bottle/ }).click();
  await expect(page.locator("ol").getByText("Paid")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^recorded run of /)).toBeVisible();
  await expect(page.locator("header")).toContainText("24.89 GBP of 400.00 GBP");
  await open(page, "/ledger");
  await expect(page.locator(".ag-row").first()).toContainText("Paid");
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
