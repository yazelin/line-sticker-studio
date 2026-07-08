// Issue #6 — per-tile zoom dialog: inspect, single-tile re-key, restore.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, transparentPixelCount,
} from "./helpers.js";

const CELL_IMG = (i) => `#stickers-grid .sticker-cell:nth-child(${i + 1}) img`;

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
});

function zoomBtn(page, i) {
  return page.locator("#stickers-grid .sticker-cell").nth(i)
    .locator(".tile-toolbar button", { hasText: "⤢" });
}

test("zoom opens with the tile image and raw status", async ({ page }) => {
  await zoomBtn(page, 0).click();
  await expect(page.locator("#tile-dialog")).toBeVisible();
  await expect(page.locator("#tile-dialog-title")).toHaveText("第 01 張");
  await expect(page.locator("#tile-dialog-status")).toContainText("未去背");
  const cellSrc = await page.locator(CELL_IMG(0)).getAttribute("src");
  expect(await page.locator("#tile-dialog-img").getAttribute("src")).toBe(cellSrc);
});

test("single-tile clean affects only that tile", async ({ page }) => {
  await zoomBtn(page, 0).click();
  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背");
  await page.locator("#tile-dialog-close").click();

  expect(await transparentPixelCount(page, CELL_IMG(0))).toBeGreaterThan(30_000);
  expect(await transparentPixelCount(page, CELL_IMG(1))).toBe(0);
});

test("restore one tile after global removal, download warns for it", async ({ page }) => {
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });

  await zoomBtn(page, 0).click();
  await page.locator("#tile-restore-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("未去背");
  await page.locator("#tile-dialog-close").click();

  expect(await transparentPixelCount(page, CELL_IMG(0))).toBe(0);
  expect(await transparentPixelCount(page, CELL_IMG(1))).toBeGreaterThan(30_000);

  // #2's audit must now flag exactly this restored tile.
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.locator("#download-zip-btn").click();
  await page.waitForTimeout(600);
  const warn = dialogs.find((m) => m.includes("完全沒有透明背景"));
  expect(warn).toContain("第 1 張");
});

test("per-tile key/tune choice is applied and re-runs from original", async ({ page }) => {
  await zoomBtn(page, 2).click();
  await page.locator("#tile-tune-select").selectOption("aggressive");
  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("積極");
  const n1 = await transparentPixelCount(page, CELL_IMG(2));
  // Re-clean at safe: recomputed from original, not from cleaned result.
  await page.locator("#tile-tune-select").selectOption("safe");
  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("保守");
  const n2 = await transparentPixelCount(page, CELL_IMG(2));
  expect(n2).toBeLessThanOrEqual(n1);
});
