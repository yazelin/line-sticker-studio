// Issues #4/#5 — sticker pool: multi-grid pooling, 8/16/24/32/40 pack
// sizes, custom main/tab, ▲▼ ordering.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, uploadGrids,
  captureDownload, loadZip, pngSize, pngAvgOpaqueColor, fixtureTileAvgRed,
} from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
});

async function removeAll(page) {
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 60_000 });
}

test("16-pack: pool two grids via history ＋, export 16 stickers", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"), "a.png");
  await uploadGrid(page, await makeGridBuffer(page, "green"), "b.png");
  await expect(page.locator(".history-card")).toHaveCount(2);

  // Append the OLDER grid (cards sort newest-first → nth(1)).
  await page.locator(".history-card").nth(1).locator(".act-add").click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(18);

  // Target 16 → auto-top-up to 16 selected.
  await page.locator('.pack-size-chip[data-size="16"]').click();
  await expect(page.locator("#selection-status")).toContainText("16/16");

  await removeAll(page);
  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  const names = Object.keys(zip.files);
  expect(names).toHaveLength(16 + 3);
  expect(names).toContain("16.png");
  expect(names).not.toContain("17.png");
  expect(pngSize(await zip.file("16.png").async("nodebuffer"))).toEqual({ w: 370, h: 320 });
  const readme = await zip.file("README.txt").async("string");
  expect(readme).toContain("共 16 張");
});

test("multi-file upload pools all grids and auto-picks pack size", async ({ page }) => {
  const bufs = [
    await makeGridBuffer(page, "green"),
    await makeGridBuffer(page, "green"),
    await makeGridBuffer(page, "green"),
  ];
  await uploadGrids(page, bufs);
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(27);
  await expect(page.locator('.pack-size-chip[data-size="24"]')).toHaveClass(/selected/);
  await expect(page.locator("#selection-status")).toContainText("24/24");
  await expect(page.locator(".history-card")).toHaveCount(3);
});

test("pool too small for target shows shortfall hint", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator('.pack-size-chip[data-size="16"]').click();
  const status = page.locator("#selection-status");
  await expect(status).toContainText("還差 7");
  await expect(status).toContainText("池裡只有 9 格");
});

test("▲▼ reorder swaps tiles and ZIP follows pool order", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  const cell = (i) => page.locator(`#stickers-grid .sticker-cell`).nth(i);
  const src0 = await cell(0).locator("img").getAttribute("src");
  const src1 = await cell(1).locator("img").getAttribute("src");
  // Move first tile down one slot.
  await cell(0).locator(".tile-move").nth(1).click();
  expect(await cell(0).locator("img").getAttribute("src")).toBe(src1);
  expect(await cell(1).locator("img").getAttribute("src")).toBe(src0);

  await removeAll(page);
  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  // 01.png must now be the ORIGINAL tile #2 (fixture idx 1).
  const avg = await pngAvgOpaqueColor(page, await zip.file("01.png").async("nodebuffer"));
  expect(Math.abs(avg.r - fixtureTileAvgRed(1))).toBeLessThan(10);
});

test("custom main/tab picks land in main.png / tab.png", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  const cell = (i) => page.locator(`#stickers-grid .sticker-cell`).nth(i);
  await cell(3).locator(".tile-pick").nth(0).click(); // 主
  await cell(4).locator(".tile-pick").nth(1).click(); // 標
  await expect(cell(3)).toHaveClass(/is-main/);
  await expect(cell(4)).toHaveClass(/is-tab/);

  await removeAll(page);
  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  const mainAvg = await pngAvgOpaqueColor(page, await zip.file("main.png").async("nodebuffer"));
  const tabAvg = await pngAvgOpaqueColor(page, await zip.file("tab.png").async("nodebuffer"));
  expect(Math.abs(mainAvg.r - fixtureTileAvgRed(3))).toBeLessThan(12);
  expect(Math.abs(tabAvg.r - fixtureTileAvgRed(4))).toBeLessThan(12);
});

test("replace-guard: single upload onto a pooled set asks before clearing", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"), "a.png");
  await uploadGrid(page, await makeGridBuffer(page, "green"), "b.png");
  await page.locator(".history-card").nth(1).locator(".act-add").click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(18);

  // Dismiss the guard → pool untouched.
  page.once("dialog", (d) => d.dismiss());
  await uploadGrid(page, await makeGridBuffer(page, "green"), "c.png");
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(18);
});

test("default 8-pack flow unchanged (baseline parity)", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await expect(page.locator("#selection-status")).toContainText("8/8");
  await removeAll(page);
  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  expect(Object.keys(zip.files)).toHaveLength(11);
  // Unpicked main/tab falls back to first included tile (fixture idx 0).
  const mainAvg = await pngAvgOpaqueColor(page, await zip.file("main.png").async("nodebuffer"));
  expect(Math.abs(mainAvg.r - fixtureTileAvgRed(0))).toBeLessThan(12);
});
