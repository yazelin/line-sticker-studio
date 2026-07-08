// Issue #27 — library: prompt records, phrase sets, saved styles.
import { test, expect } from "@playwright/test";
import { stubExternal, WORKER_ORIGIN } from "./helpers.js";

test.beforeEach(async ({ page, context }) => {
  await stubExternal(page);
  await context.route(`${WORKER_ORIGIN}/prompt`, (r) =>
    r.fulfill({ json: { prompt: "TEST PROMPT XYZ — full builder output" } }));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
});

test("copying a prompt records it; record survives reload and can re-copy", async ({ page }) => {
  await page.locator("#open-settings-link").click();
  await page.locator("#slots-copy-prompt").click();
  await expect(page.locator("#slots-copy-status")).toContainText("已複製");
  await page.keyboard.press("Escape");

  await page.locator("#prompt-history-box summary").click();
  await expect(page.locator(".prompt-history-item")).toHaveCount(1);
  await expect(page.locator(".prompt-history-item .meta")).toContainText("TEST PROMPT XYZ");

  await page.reload();
  await page.locator("#prompt-history-box summary").click();
  await expect(page.locator(".prompt-history-item")).toHaveCount(1);
  // Re-copy works from the record (no worker call needed).
  await page.locator(".prompt-history-item button", { hasText: "複製" }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("TEST PROMPT XYZ");
});

test("phrase set: save named config, reset, load it back", async ({ page }) => {
  await page.locator("#open-settings-link").click();
  const firstSelect = page.locator(".slot-select").first();
  await firstSelect.selectOption("__custom__");
  await page.locator(".slot-custom").first().fill("庫存台詞");

  page.once("dialog", (d) => d.accept("我的組合"));
  await page.locator("#phrase-set-save").click();
  await expect(page.locator("#phrase-set-select option")).toHaveCount(2);

  await page.locator("#slots-reset").click();
  await expect(page.locator(".slot-custom").first()).toBeHidden();

  const setValue = await page.locator("#phrase-set-select option").nth(1).getAttribute("value");
  await page.locator("#phrase-set-select").selectOption(setValue);
  await expect(page.locator(".slot-custom").first()).toHaveValue("庫存台詞");
});

test("saved style lands in the dropdown and survives reload", async ({ page }) => {
  await page.locator("#style-hint").selectOption("__custom__");
  await page.locator("#style-custom-input").fill("浮世繪霓虹");
  await page.locator("#style-save-btn").click();
  await expect(page.locator('#style-hint optgroup[label="我的風格"] option')).toHaveCount(1);
  await expect(page.locator("#style-hint")).toHaveValue("saved:浮世繪霓虹");
  await expect(page.locator("#style-custom-wrap")).toBeHidden();

  await page.reload();
  await expect(page.locator('#style-hint optgroup[label="我的風格"] option', { hasText: "浮世繪霓虹" }))
    .toHaveCount(1);
});
