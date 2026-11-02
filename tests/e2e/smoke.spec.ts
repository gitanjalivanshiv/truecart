import { expect, test } from "@playwright/test";

test("health endpoint reports sandbox", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  expect(await res.json()).toMatchObject({ ok: true, paypal: "sandbox" });
});

test("every page carries the honest sandbox banner", async ({ page }) => {
  for (const path of ["/", "/offers", "/approvals", "/ledger", "/mandate", "/red-team"]) {
    await page.goto(path);
    await expect(page.getByText("Sandbox: no real money. Merchants are simulated.")).toBeVisible();
  }
});
