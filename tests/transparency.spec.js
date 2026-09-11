// Issue #2 — export-time transparency audit + import-time backdrop check.
import { test, expect } from "@playwright/test";
import {
  stubExternal, makeGridBuffer, makeFringedGridBuffer, makeDarkKeyShadowGridBuffer,
  makeAspectGridBuffer, ackRules, uploadGrid,
  transparentPixelCount, opaquePixelCount, visibleKeySpillPixelCount,
  captureDownload, loadZip,
} from "./helpers.js";

const CELL0 = "#stickers-grid .sticker-cell:first-child img";

async function removeAll(page) {
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
}

// 選單裡的「自訂色…」會問色碼（window.prompt），這裡代答。
async function pickCustomKey(page, hex) {
  page.once("dialog", (d) => d.accept(hex));
  await page.locator("#bg-key-select").selectOption("__custom__");
  await expect(page.locator("#bg-key-select")).toHaveValue("__custom__");
}

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
  await page.goto("/");
  await ackRules(page);
});

test("white-bg grid warns at import, blocks at download on cancel", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "white"));
  await expect(page.locator(".toast")).toContainText("不是綠幕");

  // Removal runs but keys nothing → all tiles stay opaque.
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });

  // Cancel on the per-tile opaque confirm → no download happens.
  let sawOpaqueConfirm = false;
  page.on("dialog", (d) => {
    if (d.message().includes("完全沒有透明背景")) {
      sawOpaqueConfirm = true;
      return d.dismiss();
    }
    return d.accept();
  });
  let downloaded = false;
  page.once("download", () => { downloaded = true; });
  await page.locator("#download-zip-btn").click();
  await page.waitForTimeout(800);
  expect(sawOpaqueConfirm).toBe(true);
  expect(downloaded).toBe(false);
});

test("white-bg grid still downloadable when user insists", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "white"));
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
  page.on("dialog", (d) => d.accept());
  const { buffer } = await captureDownload(page, () =>
    page.locator("#download-zip-btn").click());
  const zip = await loadZip(buffer);
  expect(Object.keys(zip.files)).toHaveLength(11);
});

test("magenta grid auto-switches key color and keys out cleanly", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "magenta"));
  await expect(page.locator(".toast")).toContainText("洋紅幕");
  await expect(page.locator("#chroma-key")).toHaveValue("magenta");

  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
  const n = await transparentPixelCount(page, "#stickers-grid .sticker-cell:first-child img");
  expect(n).toBeGreaterThan(30_000);
});

test("green grid keeps clean path: no warning toast, no opaque confirm", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  // Info toast (存入素材庫) is fine — but no backdrop WARNING.
  await expect(page.locator(".toast")).not.toContainText("不是綠幕");
  await page.locator("#bg-remove-btn").click();
  await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await captureDownload(page, () => page.locator("#download-zip-btn").click());
  expect(dialogs.filter((m) => m.includes("完全沒有透明背景"))).toHaveLength(0);
});

for (const key of ["green", "magenta"]) {
  test(`${key} anti-aliased border leaves no visible key-color fringe`, async ({ page }) => {
    await uploadGrid(page, await makeFringedGridBuffer(page, key));
    await page.locator("#bg-remove-btn").click();
    await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });

    const selector = "#stickers-grid .sticker-cell:first-child img";
    expect(await visibleKeySpillPixelCount(page, selector, key)).toBeLessThan(10);
  });

  test(`${key} low-light key shadow is decontaminated`, async ({ page }) => {
    await uploadGrid(page, await makeDarkKeyShadowGridBuffer(page, key));
    await page.locator("#bg-remove-btn").click();
    await expect(page.locator("#bg-progress-text")).toContainText("完成", { timeout: 30_000 });

    const selector = "#stickers-grid .sticker-cell:first-child img";
    expect(await visibleKeySpillPixelCount(page, selector, key)).toBeLessThan(10);
  });
}

// 選單裡的其他幕色：匯入時要認得出來、去背要真的咬得動。
for (const [key, label] of [["blue", "藍幕"], ["cyan", "青幕"], ["yellow", "黃幕"]]) {
  test(`${label}匯入時自動切 key 色並去得乾淨`, async ({ page }) => {
    await uploadGrid(page, await makeGridBuffer(page, key));
    await expect(page.locator(".toast")).toContainText(label);
    await expect(page.locator("#chroma-key")).toHaveValue(key);

    await removeAll(page);
    expect(await transparentPixelCount(page, CELL0)).toBeGreaterThan(30_000);
    expect(await visibleKeySpillPixelCount(page, CELL0, key)).toBeLessThan(10);
  });
}

// 正控制：選單外的自訂幕色，去背照樣只吃背景、主體留著。
test("自訂幕色 #FF0000：背景去乾淨、主體留著（正控制）", async ({ page }) => {
  await uploadGrid(page, await makeAspectGridBuffer(page, "#FF0000", "rgb(40, 60, 180)"));
  // 偵測只認具名幕色，選單外的顏色一律先警告，不自己猜一個顏色硬 key。
  await expect(page.locator(".toast")).toContainText("不是綠幕");

  await pickCustomKey(page, "#FF0000");
  await expect(page.locator("#chroma-key")).toHaveValue("__custom__");
  await removeAll(page);

  expect(await transparentPixelCount(page, CELL0)).toBeGreaterThan(60_000);
  expect(await opaquePixelCount(page, CELL0)).toBeGreaterThan(15_000);
  expect(await visibleKeySpillPixelCount(page, CELL0, "#FF0000")).toBeLessThan(10);
});

// 對照：同一張圖不挑 key 就去背，幾乎什麼都去不掉 —— 上面那條正控制的
// 九萬多個透明像素確實是「挑對 key 才有」的，不是本來就有。
test("自訂幕色沒挑就去背：背景原封不動（對照）", async ({ page }) => {
  await uploadGrid(page, await makeAspectGridBuffer(page, "#FF0000", "rgb(40, 60, 180)"));
  await removeAll(page);

  expect(await transparentPixelCount(page, CELL0)).toBeLessThan(20_000);
  expect(await opaquePixelCount(page, CELL0)).toBeGreaterThan(90_000);
});

// 負控制：主體顏色撞到幕色，主體會連著背景一起被吃掉。
// 沒有這一條，上面那條正控制也可能是「其實什麼都沒去到」而僥倖通過。
test("自訂幕色撞色：主體和幕色同色時整個被吃掉（負控制）", async ({ page }) => {
  await uploadGrid(page, await makeAspectGridBuffer(page, "#FF0000", "rgb(200, 40, 40)"));
  await pickCustomKey(page, "#FF0000");
  await removeAll(page);

  expect(await opaquePixelCount(page, CELL0)).toBeLessThan(2_000);
  expect(await transparentPixelCount(page, CELL0)).toBeGreaterThan(110_000);
});

// 單張編輯器是第三個 key 下拉，自訂色在那裡也要能挑，而且只影響這一張。
test("單張編輯器挑自訂幕色，只把這張去乾淨", async ({ page }) => {
  await uploadGrid(page, await makeAspectGridBuffer(page, "#FF0000", "rgb(40, 60, 180)"));
  await page.locator("#stickers-grid .sticker-cell").first().locator("img").click();

  page.once("dialog", (d) => d.accept("#FF0000"));
  await page.locator("#tile-key-select").selectOption("__custom__");
  await page.locator("#tile-clean-btn").click();
  await expect(page.locator("#tile-dialog-status")).toContainText("自訂幕色 #FF0000");
  await page.locator("#tile-dialog-close").click();

  expect(await transparentPixelCount(page, CELL0)).toBeGreaterThan(60_000);
  expect(await opaquePixelCount(page, CELL0)).toBeGreaterThan(15_000);
  // 沒動到的第二張還是原封不動。
  const cell1 = "#stickers-grid .sticker-cell:nth-child(2) img";
  expect(await transparentPixelCount(page, cell1)).toBeLessThan(20_000);
});

// 黑、白、灰沒有色度，chroma key 在數學上抓不到，要擋在入口而不是靜默什麼都不做。
test("自訂幕色擋掉沒有色度的灰色並說明原因", async ({ page }) => {
  await uploadGrid(page, await makeGridBuffer(page, "green"));
  const messages = [];
  page.on("dialog", (d) => {
    messages.push(d.message());
    return d.type() === "prompt" ? d.accept("#808080") : d.accept();
  });
  await page.locator("#bg-key-select").selectOption("__custom__");
  await expect(page.locator("#bg-key-select")).toHaveValue("green");
  expect(messages.join("\n")).toContain("沒有色度");
});
