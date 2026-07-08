// Issue #26 — assets workspace: filters, storage usage, import entry.
import { test, expect } from "@playwright/test";
import { stubExternal, makeGridBuffer, ackRules, uploadGrid } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
});

test("filters split BYOG vs AI vs starred", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await expect(page.locator(".history-card")).toHaveCount(1);

  await page.locator('.assets-filter[data-filter="ai"]').click();
  await expect(page.locator(".history-card")).toHaveCount(0);
  await expect(page.locator("#assets-filter-empty")).toBeVisible();

  await page.locator('.assets-filter[data-filter="byog"]').click();
  await expect(page.locator(".history-card")).toHaveCount(1);

  // Star it → starred filter shows it.
  await page.locator(".history-card .act-star").click();
  await page.locator('.assets-filter[data-filter="starred"]').click();
  await expect(page.locator(".history-card")).toHaveCount(1);
});

test("storage usage line renders MB figure", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await expect(page.locator("#storage-usage")).toContainText("MB");
});

test("import button opens the file chooser (multi-select)", async ({ page }) => {
  await page.locator('.studio-tab[data-tab="assets"]').click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#assets-import-btn").click(),
  ]);
  expect(chooser.isMultiple()).toBe(true);
});
