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

test("history and finished-sticker cards share one column width", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  // Make one finished sticker so both sections render.
  await page.locator("#stickers-grid .sticker-cell").first().locator("img").click();
  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 20_000 });
  await page.locator("#tile-save-sticker-btn").click();
  await page.locator("#tile-dialog-x").click();
  await page.locator('.studio-tab[data-tab="assets"]').click();
  const h = await page.locator(".history-card").first().boundingBox();
  const s = await page.locator(".sticker-lib-card").first().boundingBox();
  expect(Math.abs(h.width - s.width)).toBeLessThan(1.5);
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
