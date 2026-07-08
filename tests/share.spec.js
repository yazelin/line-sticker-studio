// Issue #9 — single-sticker download / OS share sheet from the zoom dialog.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, pngSize, captureDownload,
} from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
});

async function openFirstTileDialog(page) {
  await page.goto("/");
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator("#stickers-grid .sticker-cell").first()
    .locator(".tile-zoom").click();
  await expect(page.locator("#tile-dialog")).toBeVisible();
}

test("no Web Share API: share button hidden, download PNG works", async ({ page }) => {
  await openFirstTileDialog(page);
  // Linux desktop/headless Chromium has no navigator.canShare.
  const hasShare = await page.evaluate(() => typeof navigator.canShare === "function");
  test.skip(hasShare, "environment unexpectedly exposes Web Share");
  await expect(page.locator("#tile-share-btn")).toBeHidden();

  const { buffer, suggested } = await captureDownload(page, () =>
    page.locator("#tile-single-dl-btn").click());
  expect(suggested).toBe("sticker-01.png");
  expect(pngSize(buffer)).toEqual({ w: 370, h: 320 });
});

test("with Web Share API: share button visible and receives the file", async ({ page }) => {
  await page.addInitScript(() => {
    window.__shared = [];
    navigator.canShare = (data) => Boolean(data?.files?.length);
    navigator.share = async (data) => {
      window.__shared.push(data.files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
    };
  });
  await openFirstTileDialog(page);
  await expect(page.locator("#tile-share-btn")).toBeVisible();
  await page.locator("#tile-share-btn").click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const shared = await page.evaluate(() => window.__shared[0]);
  expect(shared).toHaveLength(1);
  expect(shared[0].name).toBe("sticker-01.png");
  expect(shared[0].type).toBe("image/png");
  expect(shared[0].size).toBeGreaterThan(1000);
});

test("share failure (non-abort) falls back to download", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.canShare = (data) => Boolean(data?.files?.length);
    navigator.share = async () => { throw new Error("boom"); };
  });
  await openFirstTileDialog(page);
  const { suggested } = await captureDownload(page, () =>
    page.locator("#tile-share-btn").click());
  expect(suggested).toBe("sticker-01.png");
});
