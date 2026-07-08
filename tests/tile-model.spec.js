// Tile model invariant: cleaning always recomputes from the pristine
// original — running removal twice (even with different strength) must
// equal a single run, never stack despill/erosion into dirty edges.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, transparentPixelCount,
} from "./helpers.js";

const SEL = "#stickers-grid .sticker-cell:first-child img";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
});

async function runRemoval(page) {
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
}

test("double removal is idempotent (no despill stacking)", async ({ page }) => {
  await runRemoval(page);
  const n1 = await transparentPixelCount(page, SEL);
  await runRemoval(page);
  const n2 = await transparentPixelCount(page, SEL);
  expect(n2).toBe(n1);
});

test("strength change re-runs from original: aggressive ≥ safe transparency", async ({ page }) => {
  await page.locator("#bg-tune-select").selectOption("safe");
  await runRemoval(page);
  const nSafe = await transparentPixelCount(page, SEL);
  await page.locator("#bg-tune-select").selectOption("aggressive");
  await runRemoval(page);
  const nAggr = await transparentPixelCount(page, SEL);
  expect(nAggr).toBeGreaterThanOrEqual(nSafe);
  // And going back to safe returns to the exact original-derived result.
  await page.locator("#bg-tune-select").selectOption("safe");
  await runRemoval(page);
  expect(await transparentPixelCount(page, SEL)).toBe(nSafe);
});

test("restore returns the pristine tile (zero transparency)", async ({ page }) => {
  await runRemoval(page);
  await page.locator("#bg-restore-btn").click();
  expect(await transparentPixelCount(page, SEL)).toBe(0);
});
