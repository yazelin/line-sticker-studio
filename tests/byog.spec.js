// Baseline protection: locks the current BYOG behavior — upload → split
// 9 → default-select 8 → chroma-key removal → LINE-spec ZIP.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid,
  pngSize, transparentPixelCount, captureDownload, loadZip,
} from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
});

test("page boots with stubs: zones lock/unlock via rules gate", async ({ page }) => {
  await expect(page.locator("#drop-zone")).toHaveClass(/locked/);
  await ackRules(page);
  await expect(page.locator("#drop-zone")).not.toHaveClass(/locked/);
  await expect(page.locator("#grid-drop-zone")).not.toHaveClass(/locked/);
});

test("BYOG: split 9 tiles, 8 preselected, status ready", async ({ page }) => {
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  const cells = page.locator("#stickers-grid .sticker-cell");
  await expect(cells).toHaveCount(9);
  await expect(cells.locator("img")).toHaveCount(9);
  await expect(page.locator("#stickers-grid .sticker-cell.excluded")).toHaveCount(1);
  await expect(page.locator("#selection-status")).toContainText("8/8");
});

test("BYOG: selection toggle swaps which tile is packed", async ({ page }) => {
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  const cells = page.locator("#stickers-grid .sticker-cell");
  // Drop #1 → short by one; add #9 back → ready again.
  await cells.nth(0).locator(".tile-include-toggle").click();
  await expect(page.locator("#selection-status")).toContainText("7/8");
  await cells.nth(8).locator(".tile-include-toggle").click();
  await expect(page.locator("#selection-status")).toContainText("8/8");
});

test("chroma-key removal makes tiles transparent (pixel-verified)", async ({ page }) => {
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
  const sel = "#stickers-grid .sticker-cell:first-child img";
  const n = await transparentPixelCount(page, sel);
  // 370×320 = 118,400 px; the green plate dominates the cell, so a big
  // chunk must be transparent after keying.
  expect(n).toBeGreaterThan(30_000);
});

test("ZIP download: 8 stickers + main + tab + README, LINE sizes", async ({ page }) => {
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });

  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual([
    "01.png", "02.png", "03.png", "04.png", "05.png", "06.png", "07.png", "08.png",
    "README.txt", "main.png", "tab.png",
  ]);
  const s1 = pngSize(await zip.file("01.png").async("nodebuffer"));
  expect(s1).toEqual({ w: 370, h: 320 });
  const main = pngSize(await zip.file("main.png").async("nodebuffer"));
  expect(main).toEqual({ w: 240, h: 240 });
  const tab = pngSize(await zip.file("tab.png").async("nodebuffer"));
  expect(tab).toEqual({ w: 96, h: 74 });
  const readme = await zip.file("README.txt").async("string");
  expect(readme).toContain("上架說明");
});

test("ZIP download without prior removal auto-runs removal on confirm", async ({ page }) => {
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  page.on("dialog", (d) => d.accept());
  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  expect(Object.keys(zip.files)).toHaveLength(11);
});

test("history: uploaded grid lands in assets tab and reloads", async ({ page }) => {
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  // Upload auto-switches to the pack workspace.
  await expect(page.locator("#stickers-grid .sticker-cell img")).toHaveCount(9);
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await expect(page.locator("#history-section")).toBeVisible();
  await expect(page.locator(".history-card")).toHaveCount(1);
  // Load it back — returns to pack with tiles re-rendered.
  await page.locator(".history-card .act-load").first().click();
  await expect(page.locator("#stickers-grid .sticker-cell img")).toHaveCount(9);
  await expect(page.locator("#step-preview")).toBeVisible();
});
