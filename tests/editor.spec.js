// Editor workspace: side-by-side layout, prev/next navigation, include
// chip, mobile fullscreen + sticky preview.
import { test, expect } from "@playwright/test";
import { stubExternal, makeGridBuffer, ackRules, uploadGrid } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator("#stickers-grid .sticker-cell").first().locator("img").click();
  await expect(page.locator("#tile-dialog")).toBeVisible();
});

test("prev/next and arrow keys flip tiles without closing", async ({ page }) => {
  await expect(page.locator("#tile-dialog-title")).toHaveText("第 01 / 09 張");
  const src1 = await page.locator("#tile-dialog-img").getAttribute("src");
  await page.locator("#tile-next").click();
  await expect(page.locator("#tile-dialog-title")).toHaveText("第 02 / 09 張");
  expect(await page.locator("#tile-dialog-img").getAttribute("src")).not.toBe(src1);

  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tile-dialog-title")).toHaveText("第 03 / 09 張");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#tile-dialog-title")).toHaveText("第 02 / 09 張");
  // wraps around backwards
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#tile-dialog-title")).toHaveText("第 09 / 09 張");
  await expect(page.locator("#tile-dialog")).toBeVisible();
});

test("include chip toggles selection and syncs the pool cell", async ({ page }) => {
  await expect(page.locator("#tile-include-btn")).toHaveText("✓ 已選入");
  await page.locator("#tile-include-btn").click();
  await expect(page.locator("#tile-include-btn")).toHaveText("✗ 未選入");
  await page.locator("#tile-dialog-x").click();
  await expect(page.locator("#stickers-grid .sticker-cell").first()).toHaveClass(/excluded/);
});

test("editing layout keeps preview and text tools in view together", async ({ page, isMobile }) => {
  const stage = await page.locator(".tile-dialog-stage").boundingBox();
  const textarea = await page.locator("#text-content").boundingBox();
  expect(stage).toBeTruthy();
  expect(textarea).toBeTruthy();
  if (isMobile) {
    // Stacked, preview pinned via sticky.
    const pos = await page.locator(".tile-dialog-left")
      .evaluate((el) => getComputedStyle(el).position);
    expect(pos).toBe("sticky");
  } else {
    // The editor is a real workspace, not a 480px popup.
    const dlg = await page.locator("#tile-dialog").boundingBox();
    expect(dlg.width).toBeGreaterThan(900);
    // Side-by-side: tools column starts right of the stage.
    expect(textarea.x).toBeGreaterThan(stage.x + stage.width - 5);
    // Both visible in the viewport at once — no scroll ping-pong.
    const vp = page.viewportSize();
    expect(textarea.y + textarea.height).toBeLessThan(vp.height);
    expect(stage.y).toBeGreaterThanOrEqual(0);
  }
});
