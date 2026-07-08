// Issue #25 — projects: pool autosave, restore across reloads,
// multi-project switching, reference-protected deletes.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, transparentPixelCount,
} from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
});

const cells = (page) => page.locator("#stickers-grid .sticker-cell");

test("pool autosaves and survives a reload (selection/main/packSize/clean)", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  // Mutate: drop tile 1, add tile 9, main = tile 3, clean all.
  await cells(page).nth(0).locator(".tile-include-toggle").click();
  await cells(page).nth(8).locator(".tile-include-toggle").click();
  await cells(page).nth(2).locator(".tile-pick").nth(0).click();
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
  await page.waitForTimeout(1200); // autosave debounce

  await page.reload();
  await page.locator('.studio-tab[data-tab="pack"]').click();
  await expect(cells(page)).toHaveCount(9, { timeout: 15_000 });
  // Selection pattern restored: cell 1 excluded, cell 9 included.
  await expect(cells(page).nth(0)).toHaveClass(/excluded/);
  await expect(cells(page).nth(8)).not.toHaveClass(/excluded/);
  await expect(cells(page).nth(2)).toHaveClass(/is-main/);
  // Cleanup params re-applied from originals.
  const n = await transparentPixelCount(page, "#stickers-grid .sticker-cell:nth-child(2) img");
  expect(n).toBeGreaterThan(30_000);
  // Project bar shows the restored project.
  const sel = page.locator("#project-select");
  await expect(sel).not.toHaveValue("");
});

test("two projects switch without cross-contamination", async ({ page }) => {
  // Project A: upload, drop tile 1, name it.
  await uploadGrid(page, await makeGridBuffer(page, "green"), "a.png");
  await cells(page).nth(0).locator(".tile-include-toggle").click();
  await page.locator("#project-name").fill("專案A");
  await page.locator("#project-name").blur();
  await page.waitForTimeout(1000);

  // Project B: replace-load via single upload (starts a NEW draft).
  await uploadGrid(page, await makeGridBuffer(page, "green"), "b.png");
  await page.locator("#project-name").fill("專案B");
  await page.locator("#project-name").blur();
  await page.waitForTimeout(1000);

  const sel = page.locator("#project-select");
  await expect(sel.locator("option")).toHaveCount(3); // 草稿占位 + A + B

  // Switch back to A by its label.
  const aValue = await sel.locator("option", { hasText: "專案A" }).getAttribute("value");
  await sel.selectOption(aValue);
  await expect(cells(page).nth(0)).toHaveClass(/excluded/, { timeout: 15_000 });
  await expect(page.locator("#project-name")).toHaveValue("專案A");

  // And forward to B again — B has no exclusion on tile 1.
  const bValue = await sel.locator("option", { hasText: "專案B" }).getAttribute("value");
  await sel.selectOption(bValue);
  await expect(cells(page).nth(0)).not.toHaveClass(/excluded/, { timeout: 15_000 });
});

test("deleting a referenced grid warns with project names", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator("#project-name").fill("引用中");
  await page.locator("#project-name").blur();
  await page.waitForTimeout(1000);

  await page.locator('.studio-tab[data-tab="assets"]').click();
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.locator(".history-card .act-delete").first().click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("引用中");
  // Dismissed → grid still there.
  await expect(page.locator(".history-card")).toHaveCount(1);
});

test("replace-load resets pack size to 8 (no stale 16 from prior project)", async ({ page }) => {
  // Build a 16-target project from two grids.
  await uploadGrid(page, await makeGridBuffer(page, "green"), "a.png");
  await uploadGrid(page, await makeGridBuffer(page, "green"), "b.png");
  await page.locator("#pack-source-cards .act-add").nth(1).click();
  await page.locator('.pack-size-chip[data-size="16"]').click();
  await expect(page.locator("#selection-status")).toContainText("16/16");
  // Single upload = replace → fresh draft at packSize 8, downloadable.
  page.on("dialog", (d) => d.accept());
  await uploadGrid(page, await makeGridBuffer(page, "green"), "c.png");
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(9);
  await expect(page.locator('.pack-size-chip[data-size="8"]')).toHaveClass(/selected/);
  await expect(page.locator("#selection-status")).toContainText("8/8");
});

test("new-project button clears to an empty draft", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.waitForTimeout(1000);
  page.on("dialog", (d) => d.accept());
  await page.locator("#project-new").click();
  await expect(page.locator("#pack-empty")).toBeVisible();
  await expect(page.locator("#project-select")).toHaveValue("");
});
