// Issue #10 — occupation/scene quick-entry chips in the theme generator.
import { test, expect } from "@playwright/test";
import { stubExternal } from "./helpers.js";

test.describe("chips (zh-TW default)", () => {
  test.beforeEach(async ({ page }) => {
    await stubExternal(page);
    await page.goto("/");
  });

  test("chips render, click seeds the theme input without calling the worker", async ({ page }) => {
    await page.locator("#open-settings-link").click();
    await expect(page.locator("#settings-dialog")).toBeVisible();
    const chips = page.locator(".theme-chip");
    expect(await chips.count()).toBeGreaterThanOrEqual(10);

    const label = await chips.first().textContent();
    await chips.first().click();
    await expect(page.locator("#theme-input")).toHaveValue(label);
    // Seeding must NOT trigger generation (worker call costs quota).
    await expect(page.locator("#theme-gen-status")).toBeHidden();
    await expect(chips.first()).toHaveText("上班族日常");
  });
});

test.describe("chips (en locale)", () => {
  // UI language auto-detects from navigator.language (no manual picker).
  test.use({ locale: "en-US" });

  test("chips follow detected UI language", async ({ page }) => {
    await stubExternal(page);
    await page.goto("/");
    await page.locator("#open-settings-link").click();
    await expect(page.locator(".theme-chip").first()).toHaveText("office worker daily life");
  });
});
