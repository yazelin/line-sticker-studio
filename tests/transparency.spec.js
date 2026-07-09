// Issue #2 — export-time transparency audit + import-time backdrop check.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid,
  transparentPixelCount, captureDownload, loadZip,
} from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
});

test("white-bg grid warns at import, blocks at download on cancel", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "white"));
  await expect(page.locator(".toast")).toContainText("不是綠幕");

  // Removal runs but keys nothing → all tiles stay opaque.
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });

  // Cancel on the per-tile opaque confirm → no download happens.
  let sawOpaqueConfirm = false;
  page.on("dialog", (d) => {
    if (d.message().includes("完全沒有透明背景")) {
      sawOpaqueConfirm = true;
      return d.dismiss();
    }
    return d.accept();
  });
  let downloaded = false;
  page.once("download", () => { downloaded = true; });
  await page.locator("#download-zip-btn").click();
  await page.waitForTimeout(800);
  expect(sawOpaqueConfirm).toBe(true);
  expect(downloaded).toBe(false);
});

test("white-bg grid still downloadable when user insists", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "white"));
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
  page.on("dialog", (d) => d.accept());
  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  expect(Object.keys(zip.files)).toHaveLength(11);
});

test("magenta grid auto-switches key color and keys out cleanly", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "magenta"));
  await expect(page.locator(".toast")).toContainText("洋紅幕");
  await expect(page.locator("#chroma-key")).toHaveValue("magenta");

  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
  const n = await transparentPixelCount(page, "#stickers-grid .sticker-cell:first-child img");
  expect(n).toBeGreaterThan(30_000);
});

test("green grid keeps clean path: no warning toast, no opaque confirm", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  // Info toast (存入素材庫) is fine — but no backdrop WARNING.
  await expect(page.locator(".toast")).not.toContainText("不是綠幕");
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await captureDownload(page, () => page.locator("#download-zip-btn").click());
  expect(dialogs.filter((m) => m.includes("完全沒有透明背景"))).toHaveLength(0);
});
