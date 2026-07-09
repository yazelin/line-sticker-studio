// History thumbnails render source grids at equal visual scale
// regardless of the source aspect ratio (cover, not letterboxed contain).
import { test, expect } from "@playwright/test";
import { stubExternal, makeGridBuffer, ackRules, uploadGrid } from "./helpers.js";

test("square and portrait grids get identical full-bleed card thumbs", async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green", 900), "square.png");
  page.on("dialog", (d) => d.accept()); // portrait aspect confirm
  await uploadGrid(page, await makeGridBuffer(page, "green", 640, 960), "portrait.png");
  await page.locator('.studio-tab[data-tab="assets"]').click();
  await expect(page.locator(".history-card")).toHaveCount(2);

  // The portrait thumb must contain NO baked letterbox bars: its left-edge
  // midpoint pixel should be the green backdrop, not #fafafa gray.
  const edge = await page.evaluate(async () => {
    const img = document.querySelectorAll(".history-card > img")[0]; // newest = portrait
    const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const cx = c.getContext("2d");
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(1, Math.floor(bmp.height / 2), 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  expect(edge[1]).toBeGreaterThan(180); // green, not gray bar
  expect(edge[0]).toBeLessThan(120);

  // Rendered boxes identical.
  const b0 = await page.locator(".history-card > img").nth(0).boundingBox();
  const b1 = await page.locator(".history-card > img").nth(1).boundingBox();
  expect(Math.abs(b0.width - b1.width)).toBeLessThan(1);
  expect(Math.abs(b0.height - b1.height)).toBeLessThan(1);
});
