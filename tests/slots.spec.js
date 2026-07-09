// Issue #38 — all 9 grid cells are user-pinnable (no forced random 9th).
import { test, expect } from "@playwright/test";
import { stubExternal, WORKER_ORIGIN } from "./helpers.js";

test.beforeEach(async ({ page, context }) => {
  await stubExternal(page);
  await context.route(`${WORKER_ORIGIN}/prompt`, (r) =>
    r.fulfill({ json: { prompt: "PROMPT OK" } }));
  await context.grantPermissions(["clipboard-write"]);
});

test("settings dialog renders 9 slot cells", async ({ page }) => {
  await page.goto("/");
  await page.locator("#open-settings-link").click();
  await expect(page.locator(".slot-cell")).toHaveCount(9);
  await expect(page.locator(".slot-cell").nth(8).locator(".slot-head")).toHaveText("第 9 格");
});

test("9th slot pin is sent to /prompt", async ({ page, context }) => {
  let sentSlots = null;
  await context.route(`${WORKER_ORIGIN}/prompt`, async (r) => {
    sentSlots = r.request().postDataJSON().slots;
    await r.fulfill({ json: { prompt: "PROMPT OK" } });
  });
  await page.goto("/");
  await page.locator("#open-settings-link").click();
  const ninth = page.locator(".slot-cell").nth(8);
  await ninth.locator(".slot-select").selectOption("__custom__");
  await ninth.locator(".slot-custom").fill("第九句");
  await page.locator("#slots-copy-prompt").click();
  await expect(page.locator("#slots-copy-status")).toContainText("已複製");
  expect(sentSlots).toHaveLength(9);
  expect(sentSlots[8]).toEqual({ phraseCustom: "第九句" });
});

test("legacy 8-slot saved config migrates by padding to 9", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("line-sticker-slots",
      JSON.stringify([{ phraseCustom: "舊句1" }, null, null, null, null, null, null, { phraseCustom: "舊句8" }]));
  });
  await page.goto("/");
  await page.locator("#open-settings-link").click();
  await expect(page.locator(".slot-cell")).toHaveCount(9);
  await expect(page.locator(".slot-cell").nth(0).locator(".slot-custom")).toHaveValue("舊句1");
  await expect(page.locator(".slot-cell").nth(7).locator(".slot-custom")).toHaveValue("舊句8");
  await expect(page.locator(".slot-cell").nth(8).locator(".slot-select")).toHaveValue("__random__");
});
