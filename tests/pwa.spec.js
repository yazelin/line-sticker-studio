// Issue #3 — PWA offline: after one online visit, the whole BYOG
// pipeline (import → split → clean → pack → download) works offline.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, captureDownload, loadZip,
} from "./helpers.js";

async function loadUntilControlled(page) {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 });
  // Second load is fully SW-controlled → runtime cache captures the
  // worker config GETs (phrases/campaigns/config).
  await page.reload();
  await page.waitForLoadState("networkidle");
}

test("offline: full BYOG flow still produces a valid LINE ZIP", async ({ page, context }) => {
  await stubExternal(page);
  await loadUntilControlled(page);

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator("#offline-banner")).toBeVisible();
  await expect(page.locator("#generate-btn")).toBeDisabled();

  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(9);
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });

  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  expect(Object.keys(zip.files)).toHaveLength(11);
});

test("offline: cached worker config keeps phrase dropdown data", async ({ page, context }) => {
  await stubExternal(page);
  await loadUntilControlled(page);
  await context.setOffline(true);
  await page.reload();

  await page.locator("#open-settings-link").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
  // Stubbed /phrases payload survived offline via SWR runtime cache.
  await expect(page.locator(".slot-select").first().locator("option", { hasText: "測試短語" }))
    .toHaveCount(1);
});

test("online/offline toggle flips AI controls live", async ({ page, context }) => {
  await stubExternal(page);
  await loadUntilControlled(page);

  await context.setOffline(true);
  await expect(page.locator("#offline-banner")).toBeVisible();
  await expect(page.locator("#generate-btn")).toBeDisabled();

  await context.setOffline(false);
  await expect(page.locator("#offline-banner")).toBeHidden();
  await expect(page.locator("#generate-btn")).toBeEnabled();
});
