// Issue #24 — three-workspace studio shell.
import { test, expect } from "@playwright/test";
import { stubExternal, makeGridBuffer, ackRules, uploadGrid } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
});

test("default tab is create; others hidden", async ({ page }) => {
  await expect(page.locator("#step-upload")).toBeVisible();
  await expect(page.locator("#assets-panel")).toBeHidden();
  await expect(page.locator("#pack-empty")).toBeHidden(); // pack tab inactive
});

test("tab switching shows the right workspace and sets the hash", async ({ page }) => {
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await expect(page.locator("#assets-panel")).toBeVisible();
  await expect(page.locator("#step-upload")).toBeHidden();
  expect(page.url()).toContain("#assets");

  await page.locator('.studio-tab[data-tab="pack"]').click();
  await expect(page.locator("#pack-empty")).toBeVisible(); // empty pool state
  await expect(page.locator("#step-preview")).toBeHidden();
});

test("hash deep-link opens the requested workspace", async ({ page }) => {
  await page.goto("/#assets");
  await expect(page.locator("#assets-panel")).toBeVisible();
  await expect(page.locator("#step-upload")).toBeHidden();
});

test("upload auto-lands in pack with the pool visible", async ({ page }) => {
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await expect(page.locator("#step-preview")).toBeVisible();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(9);
  await expect(page.locator("#pack-empty")).toBeHidden(); // has-pool
  expect(page.url()).toContain("#pack");
  // Source strip shows the grid we just uploaded.
  await expect(page.locator("#pack-source-cards .pack-source-card")).toHaveCount(1);
});
