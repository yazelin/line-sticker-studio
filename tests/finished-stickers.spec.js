// 成品貼圖 — the studio's middle-stage asset: finish a tile in the
// editor, it becomes a reusable single-sticker asset.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, transparentPixelCount,
} from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
});

async function finishFirstTile(page, text = "定稿") {
  await page.locator("#stickers-grid .sticker-cell").first().locator("img").click();
  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 20_000 });
  await page.locator("#text-content").fill(text);
  await page.locator("#tile-save-sticker-btn").click();
  await expect(page.locator(".toast")).toContainText("成品");
  await page.locator("#tile-dialog-x").click();
}

test("save-as-finished lands in the assets library and re-enters the pool baked", async ({ page }) => {
  await finishFirstTile(page);
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await expect(page.locator("#sticker-lib-section")).toBeVisible();
  await expect(page.locator(".sticker-lib-card")).toHaveCount(1);

  // ＋ into the pool: becomes a 10th tile, already transparent + texted.
  await page.locator(".sticker-lib-card button", { hasText: "＋" }).click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(10);
  const n = await transparentPixelCount(page, "#stickers-grid .sticker-cell:nth-child(10) img");
  expect(n).toBeGreaterThan(30_000);
});

test("finished sticker survives source-grid deletion (pixels are baked)", async ({ page }) => {
  await finishFirstTile(page);
  await page.locator('.studio-tab[data-tab="assets"]').click();
  page.on("dialog", (d) => d.accept());
  await page.locator(".history-card .act-delete").click();
  await expect(page.locator(".history-card")).toHaveCount(0);
  await expect(page.locator(".sticker-lib-card")).toHaveCount(1);
  await page.locator(".sticker-lib-card button", { hasText: "＋" }).click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(10);
});

test("project slots persist finished-sticker tiles across reload", async ({ page }) => {
  await finishFirstTile(page);
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await page.locator(".sticker-lib-card button", { hasText: "＋" }).click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(10);
  await page.waitForTimeout(1200); // autosave

  await page.reload();
  await page.locator('.studio-tab[data-tab="pack"]').click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(10, { timeout: 15_000 });
  const n = await transparentPixelCount(page, "#stickers-grid .sticker-cell:nth-child(10) img");
  expect(n).toBeGreaterThan(30_000);
});

test("saving from a pool tile binds the slot; re-editing the sticker syncs it back", async ({ page }) => {
  // Finish pool tile 1 (clean + text) — slot becomes the finished sticker.
  await page.locator("#stickers-grid .sticker-cell").first().locator("img").click();
  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 20_000 });
  await page.locator("#text-content").fill("綁定");
  await page.locator("#tile-save-sticker-btn").click();
  await expect(page.locator(".toast")).toContainText("已連結成品");
  await page.locator("#tile-dialog-x").click();

  // P3: provenance badge on the pool cell; pool count unchanged.
  await expect(page.locator("#stickers-grid .sticker-cell").first().locator(".tile-badge-final")).toHaveText("稿");
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(9);

  // Re-edit the finished sticker from assets with new text → pool cell updates.
  const cellSrcBefore = await page.locator("#stickers-grid .sticker-cell img").first().getAttribute("src");
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await page.locator(".sticker-lib-card img").click();
  await expect(page.locator("#tile-dialog")).toBeVisible();
  await page.locator("#text-content").fill("同步了");
  await page.locator("#tile-save-sticker-btn").click();
  await page.locator("#tile-dialog-x").click();
  await page.locator('.studio-tab[data-tab="pack"]').click();
  await expect
    .poll(async () => page.locator("#stickers-grid .sticker-cell img").first().getAttribute("src"))
    .not.toBe(cellSrcBefore);
  await expect(page.locator(".sticker-lib-card")).toHaveCount(1); // still ONE sticker
});

test("pack source strip lists finished stickers first with a badge style", async ({ page }) => {
  await finishFirstTile(page);
  await expect(page.locator("#pack-source-cards .pack-source-card.is-finished")).toHaveCount(1);
});
