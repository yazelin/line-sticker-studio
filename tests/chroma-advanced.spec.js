// Issue #7 — continuous chroma fine-tuning per tile.
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
});

async function openAdvanced(page) {
  await page.locator("#stickers-grid .sticker-cell").first().locator(".tile-zoom").click();
  await page.locator("#tile-advanced summary").click();
}

async function setSlider(page, id, value) {
  await page.locator(`#${id}`).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, String(value));
}

test("aggressive sliders key out at least as much as conservative ones", async ({ page }) => {
  await openAdvanced(page);
  // Conservative extreme.
  await setSlider(page, "adv-hard", 0.45);
  await setSlider(page, "adv-minkey", 90);
  await setSlider(page, "adv-dominance", 2.2);
  await expect(page.locator("#tile-dialog-status")).toContainText("自訂細調", { timeout: 10_000 });
  const conservative = await transparentPixelCount(page, CELL0);

  // Aggressive extreme.
  await setSlider(page, "adv-hard", 0.12);
  await setSlider(page, "adv-soft", 0.03);
  await setSlider(page, "adv-minkey", 25);
  await setSlider(page, "adv-dominance", 1.25);
  await page.waitForTimeout(600);
  const aggressive = await transparentPixelCount(page, CELL0);

  expect(aggressive).toBeGreaterThanOrEqual(conservative);
  expect(aggressive).toBeGreaterThan(30_000);
});

test("custom tuning persists into the project and reload restores it", async ({ page }) => {
  await openAdvanced(page);
  await setSlider(page, "adv-hard", 0.18);
  await expect(page.locator("#tile-dialog-status")).toContainText("自訂細調", { timeout: 10_000 });
  await page.locator("#tile-dialog-close").click();
  await page.waitForTimeout(1200); // autosave

  await page.reload();
  await page.locator('.studio-tab[data-tab="pack"]').click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(9, { timeout: 15_000 });
  expect(await transparentPixelCount(page, CELL0)).toBeGreaterThan(30_000);
  // Reopen dialog — stored custom value is loaded back into the slider.
  await page.locator("#stickers-grid .sticker-cell").first().locator(".tile-zoom").click();
  await expect(page.locator("#adv-hard")).toHaveValue("0.18");
  await expect(page.locator("#tile-dialog-status")).toContainText("自訂細調");
});

test("reset returns to the preset profile", async ({ page }) => {
  await openAdvanced(page);
  await setSlider(page, "adv-hard", 0.12);
  await expect(page.locator("#tile-dialog-status")).toContainText("自訂細調", { timeout: 10_000 });
  await page.locator("#tile-adv-reset").click();
  await page.waitForTimeout(600);
  await expect(page.locator("#adv-hard")).toHaveValue("0.25"); // balanced default
});
