// Issue #8 — per-tile text layer: compose at preview/export, anchors,
// free drag, font upload/local-font listing, project persistence.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, ackRules, uploadGrid, captureDownload, loadZip,
} from "./helpers.js";

const CELL0_IMG = "#stickers-grid .sticker-cell:nth-child(1) img";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
});

// Count opaque pixels of an img inside a horizontal band [y0,y1).
async function bandOpaque(page, selector, y0Frac, y1Frac) {
  return page.evaluate(async ({ sel, y0Frac, y1Frac }) => {
    const img = document.querySelector(sel);
    const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const y0 = Math.floor(bmp.height * y0Frac);
    const y1 = Math.floor(bmp.height * y1Frac);
    const d = ctx.getImageData(0, y0, bmp.width, Math.max(1, y1 - y0)).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    return n;
  }, { sel: selector, y0Frac, y1Frac });
}

async function openZoom(page, i = 0) {
  await page.locator("#stickers-grid .sticker-cell").nth(i).locator(".tile-zoom").click();
  await expect(page.locator("#tile-dialog")).toBeVisible();
  await page.locator("#tile-text-panel summary").click();
}

test("typing text renders it into the tile preview (bottom band)", async ({ page }) => {
  const before = await bandOpaque(page, CELL0_IMG, 0.82, 1.0);
  await openZoom(page);
  await page.locator("#text-content").fill("哈囉");
  await page.locator("#tile-dialog-close").click();
  const after = await bandOpaque(page, CELL0_IMG, 0.82, 1.0);
  expect(after).toBeGreaterThan(before + 500);
});

test("anchor switch moves text to the top band; export carries it", async ({ page }) => {
  await openZoom(page);
  await page.locator("#text-content").fill("上面");
  await page.locator('#text-anchors button[data-anchor="hor_top"]').click();
  await page.locator("#tile-dialog-close").click();

  const topBand = await bandOpaque(page, CELL0_IMG, 0.0, 0.2);
  expect(topBand).toBeGreaterThan(500);

  // Export: 01.png contains the same top-band text pixels.
  page.on("dialog", (d) => d.accept());
  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  const png = await zip.file("01.png").async("nodebuffer");
  const b64 = png.toString("base64");
  const topOpaque = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, Math.floor(bmp.height * 0.2)).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    return n;
  }, b64);
  expect(topOpaque).toBeGreaterThan(500);
});

test("free drag repositions text and margin warning fires near edges", async ({ page }) => {
  await openZoom(page);
  await page.locator("#text-content").fill("拖我");
  const img = page.locator("#tile-dialog-img");
  const box = await img.boundingBox();
  // Drag to the very top-left corner → out of the 10px safe zone.
  await img.dispatchEvent("pointerdown", { clientX: box.x + 4, clientY: box.y + 4, pointerId: 7 });
  await img.dispatchEvent("pointerup", { pointerId: 7 });
  await expect(page.locator("#text-margin-warn")).toBeVisible();
  await page.locator("#tile-dialog-close").click();
  const topBand = await bandOpaque(page, CELL0_IMG, 0.0, 0.25);
  expect(topBand).toBeGreaterThan(300);
});

test("native image drag is suppressed; drag keeps following across moves", async ({ page }) => {
  await openZoom(page);
  await page.locator("#text-content").fill("跟著走");
  const img = page.locator("#tile-dialog-img");
  expect(await img.evaluate((el) => el.draggable)).toBe(false);
  expect(await img.evaluate((el) => {
    const ev = new Event("dragstart", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  })).toBe(true);

  // pointerdown top-left → move to bottom-right → release: text must land
  // at the LAST position (native DnD would have frozen it mid-way).
  const box = await img.boundingBox();
  await img.dispatchEvent("pointerdown", { clientX: box.x + 10, clientY: box.y + 10, pointerId: 9 });
  await img.dispatchEvent("pointermove", { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerId: 9 });
  await img.dispatchEvent("pointermove", { clientX: box.x + box.width - 12, clientY: box.y + box.height - 12, pointerId: 9 });
  await img.dispatchEvent("pointerup", { pointerId: 9 });
  await page.locator("#tile-dialog-close").click();
  const bottomBand = await bandOpaque(page, CELL0_IMG, 0.8, 1.0);
  expect(bottomBand).toBeGreaterThan(300);
});

test("queryLocalFonts (stubbed) fills the local-font group", async ({ page }) => {
  // Re-init with the API present.
  await page.addInitScript(() => {
    window.queryLocalFonts = async () => [
      { family: "測試少女體" }, { family: "Fake Mono" },
    ];
  });
  await page.reload();
  await ackRules(page);
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  await openZoom(page);
  await expect(page.locator("#text-local-fonts")).toBeVisible();
  await page.locator("#text-local-fonts").click();
  await expect(page.locator('#text-font optgroup[label="本機字型"] option', { hasText: "測試少女體" }))
    .toHaveCount(1);
});

test("invalid font file shows an error and keeps the select intact", async ({ page }) => {
  await openZoom(page);
  await page.locator('#text-font-file').setInputFiles({
    name: "not-a-font.ttf", mimeType: "font/ttf", buffer: Buffer.from("garbage"),
  });
  await expect(page.locator("#text-font-status")).toContainText("失敗");
  await expect(page.locator('#text-font optgroup[label="上傳字型"]')).toHaveCount(0);
});

test("text params persist through reload via the project", async ({ page }) => {
  await openZoom(page);
  await page.locator("#text-content").fill("留住");
  await page.locator("#tile-dialog-close").click();
  await page.waitForTimeout(1200); // autosave

  await page.reload();
  await page.locator('.studio-tab[data-tab="pack"]').click();
  await expect(page.locator("#stickers-grid .sticker-cell")).toHaveCount(9, { timeout: 15_000 });
  const bottomBand = await bandOpaque(page, CELL0_IMG, 0.82, 1.0);
  expect(bottomBand).toBeGreaterThan(500);
});
