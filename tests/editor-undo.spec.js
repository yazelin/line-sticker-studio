// Editor undo/redo — parameter-level history.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, transparentPixelCount,
} from "./helpers.js";

const CELL0 = "#stickers-grid .sticker-cell:nth-child(1) img";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator("#stickers-grid .sticker-cell").first().locator("img").click();
});

test("undo walks back clean+text; redo replays them", async ({ page }) => {
  await expect(page.locator("#tile-undo")).toBeDisabled();

  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 20_000 });
  const cleaned = await transparentPixelCount(page, CELL0);
  expect(cleaned).toBeGreaterThan(30_000);

  await page.locator("#text-content").fill("回得去");
  await page.waitForTimeout(600); // debounce push
  await expect(page.locator("#tile-undo")).toBeEnabled();

  // Undo #1: text gone, still cleaned.
  await page.locator("#tile-undo").click();
  await expect(page.locator("#text-content")).toHaveValue("", { timeout: 10_000 });
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背");

  // Undo #2: back to the raw tile.
  await page.locator("#tile-undo").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("未去背", { timeout: 10_000 });
  expect(await transparentPixelCount(page, CELL0)).toBe(0);
  await expect(page.locator("#tile-undo")).toBeDisabled();

  // Redo ×2: cleaned + text return.
  await page.locator("#tile-redo").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 10_000 });
  await page.locator("#tile-redo").click();
  await expect(page.locator("#text-content")).toHaveValue("回得去", { timeout: 10_000 });
  await expect(page.locator("#tile-redo")).toBeDisabled();
});

test("Ctrl+Z / Ctrl+Y shortcuts work outside inputs", async ({ page }) => {
  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 20_000 });
  await page.locator("#tile-dialog-img").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Control+z");
  await expect(page.locator("#tile-dialog-status")).toContainText("未去背", { timeout: 10_000 });
  await page.keyboard.press("Control+y");
  await expect(page.locator("#tile-dialog-status")).toContainText("已去背", { timeout: 10_000 });
});
