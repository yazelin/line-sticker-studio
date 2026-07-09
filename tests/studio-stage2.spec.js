// 建議 1-4:素材庫直通編輯器、成品參數級 re-edit、定稿守門、批次+tag。
import { test, expect } from "@playwright/test";
import { stubExternal, makeGridBuffer, ackRules, uploadGrid } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
});

test("assets → pick a grid cell → detached editor → finish; pool untouched", async ({ page }) => {
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await page.locator(".history-card > img").click();
  await expect(page.locator("#grid-pick-dialog")).toBeVisible();
  await expect(page.locator(".grid-pick-cell")).toHaveCount(9);
  await page.locator(".grid-pick-cell").nth(4).click();

  await expect(page.locator("#tile-dialog")).toBeVisible();
  await expect(page.locator("#tile-dialog-title")).toContainText("素材編輯：第 5 格");
  await expect(page.locator("#tile-prev")).toBeHidden();       // pool-only controls off
  await expect(page.locator("#tile-include-btn")).toBeHidden();

  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 20_000 });
  await page.locator("#tile-save-sticker-btn").click();
  await expect(page.locator(".toast")).toContainText("成品");
  await page.locator("#tile-dialog-x").click();

  await expect(page.locator(".sticker-lib-card")).toHaveCount(1);
  await page.locator('.studio-tab[data-tab="pack"]').click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(9); // pool untouched
});

test("finished sticker re-edits at parameter level and updates in place", async ({ page }) => {
  // Finish tile 1 with text.
  await page.locator("#stickers-grid .sticker-cell").first().locator("img").click();
  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 20_000 });
  await page.locator("#text-content").fill("第一版");
  await page.locator("#tile-save-sticker-btn").click();
  await expect(page.locator(".toast")).toContainText("成品");
  await page.locator("#tile-dialog-x").click();

  await page.locator('.studio-tab[data-tab="assets"]').click();
  const srcBefore = await page.locator(".sticker-lib-card img").getAttribute("src");
  await page.locator(".sticker-lib-bar button", { hasText: "✏️" }).click();
  await expect(page.locator("#tile-dialog")).toBeVisible();
  // Params came back, not baked pixels: status shows cleaned, textarea has text.
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背");
  await expect(page.locator("#text-content")).toHaveValue("第一版");

  await page.locator("#text-content").fill("第二版");
  await page.locator("#tile-save-sticker-btn").click();
  await page.locator("#tile-dialog-x").click();
  await expect(page.locator(".sticker-lib-card")).toHaveCount(1); // updated, not duplicated
  await expect
    .poll(async () => page.locator(".sticker-lib-card img").getAttribute("src"))
    .not.toBe(srcBefore);
});

test("save guard blocks un-keyed finalization on cancel", async ({ page }) => {
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await page.locator(".history-card > img").click();
  await page.locator(".grid-pick-cell").first().click();
  // No cleanup → composed tile is an opaque card.
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.locator("#tile-save-sticker-btn").click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("還沒去乾淨");
  await page.locator("#tile-dialog-x").click();
  await expect(page.locator("#sticker-lib-section")).toBeHidden(); // nothing saved
});

test("batch select pools both; tag filter narrows the library", async ({ page }) => {
  // Make two finished stickers from two different cells.
  for (const i of [0, 1]) {
    await page.locator('.studio-tab[data-tab="assets"]').click();
    await page.locator(".history-card > img").click();
    await page.locator(".grid-pick-cell").nth(i).click();
    await page.locator("#tile-clean-btn").click();
    await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 20_000 });
    await page.locator("#tile-save-sticker-btn").click();
    await page.locator("#tile-dialog-x").click();
  }
  await expect(page.locator(".sticker-lib-card")).toHaveCount(2);

  // Tag the first card, then filter by it.
  page.on("dialog", (d) => d.accept("貓"));
  await page.locator(".sticker-lib-card").nth(0).locator("button", { hasText: "🏷" }).click();
  await expect(page.locator(".sticker-tag-pill")).toHaveCount(1);
  await page.locator("#sticker-tag-filter").selectOption("貓");
  await expect(page.locator(".sticker-lib-card")).toHaveCount(1);
  await page.locator("#sticker-tag-filter").selectOption("");
  await expect(page.locator(".sticker-lib-card")).toHaveCount(2);

  // Batch: check both → pool them.
  await page.locator(".sticker-lib-card").nth(0).locator(".sticker-check").check();
  await page.locator(".sticker-lib-card").nth(1).locator(".sticker-check").check();
  await page.locator("#sticker-batch-pool").click();
  await page.locator('.studio-tab[data-tab="pack"]').click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(11);
});
