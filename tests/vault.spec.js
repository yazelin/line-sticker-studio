// Issue #28 — vault export/import roundtrip across fresh contexts.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, captureDownload, loadZip,
} from "./helpers.js";

test("export carries assets+projects+styles; import restores them in a fresh profile", async ({ browser }) => {
  // --- Session 1: build some state and export ---
  const ctx1 = await browser.newContext({ locale: "zh-TW" });
  const page1 = await ctx1.newPage();
  await stubExternal(page1);
  await page1.goto("http://127.0.0.1:8917/");
  await ackRules(page1);
  await uploadGrid(page1, await makeGridBuffer(page1, "green"));
  await page1.locator("#project-name").fill("帶著走");
  await page1.locator("#project-name").blur();
  await page1.locator('.studio-tab[data-tab="create"]').click();
  await page1.locator("#style-hint").selectOption("__custom__");
  await page1.locator("#style-custom-input").fill("行李箱風格");
  await page1.locator("#style-save-btn").click();
  await page1.waitForTimeout(1100); // project autosave

  await page1.locator('.studio-tab[data-tab="assets"]').click();
  const { buffer, suggested } = await captureDownload(page1, () =>
    page1.locator("#vault-export-btn").click());
  expect(suggested).toMatch(/^sticker-studio-vault-.*\.zip$/);

  const zip = await loadZip(buffer);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  expect(manifest.generations).toHaveLength(1);
  expect(manifest.projects).toHaveLength(1);
  expect(manifest.projects[0].name).toBe("帶著走");
  expect(manifest.styles).toHaveLength(1);
  expect(zip.file(manifest.generations[0].gridFile)).toBeTruthy();
  await ctx1.close();

  // --- Session 2: fresh profile, import, everything comes back ---
  const ctx2 = await browser.newContext({ locale: "zh-TW" });
  const page2 = await ctx2.newPage();
  await stubExternal(page2);
  await page2.goto("http://127.0.0.1:8917/");
  await page2.locator('.studio-tab[data-tab="assets"]').click();
  await expect(page2.locator(".history-card")).toHaveCount(0);

  await page2.locator("#vault-import-input").setInputFiles({
    name: "vault.zip", mimeType: "application/zip", buffer,
  });
  await expect(page2.locator(".toast")).toContainText("匯入完成");
  await expect(page2.locator(".history-card")).toHaveCount(1);
  await expect(page2.locator("#project-select option", { hasText: "帶著走" })).toHaveCount(1);
  await expect(page2.locator('#style-hint optgroup[label="我的風格"] option', { hasText: "行李箱風格" }))
    .toHaveCount(1);

  // Idempotent: importing again skips everything.
  await page2.locator("#vault-import-input").setInputFiles({
    name: "vault.zip", mimeType: "application/zip", buffer,
  });
  await expect(page2.locator(".toast")).toContainText("略過");
  await expect(page2.locator(".history-card")).toHaveCount(1);
  await ctx2.close();
});
