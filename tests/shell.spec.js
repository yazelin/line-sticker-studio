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

test("upload lands in ASSETS (material stage); pool is silently ready", async ({ page }) => {
  await ackRules(page);
  // Raw setInputFiles (no helper hop): assert the app's own landing tab.
  await page.setInputFiles("#grid-file-input", {
    name: "g.png", mimeType: "image/png", buffer: await makeGridBuffer(page, "green"),
  });
  await expect(page.locator("#history-section")).toBeVisible();
  expect(page.url()).toContain("#assets");
  // Pool got prepared in the background.
  // P6: the toast carries a one-tap「去打包」action.
  await page.locator(".toast .toast-action").click();
  expect(page.url()).toContain("#pack");
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(9);
  await expect(page.locator("#pack-source-cards .pack-source-card")).toHaveCount(1);
});
