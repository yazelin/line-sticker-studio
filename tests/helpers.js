// Shared test helpers: worker-API stubs, synthetic grid fixtures, ZIP/PNG
// inspection. All external network (worker, Turnstile, fonts, CDN) is
// stubbed so tests are deterministic and run offline.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZIP_MIN = require.resolve("jszip/dist/jszip.min.js");
const JSZip = require("jszip");

export async function loadZip(buffer) {
  return JSZip.loadAsync(buffer);
}

export const WORKER_ORIGIN = "https://line-sticker-gemini.yazelinj303.workers.dev";

export async function stubExternal(page) {
  // Route at the CONTEXT level: with PW_EXPERIMENTAL_SERVICE_WORKER_
  // NETWORK_EVENTS, service-worker-initiated fetches surface on the
  // context, not the page — page-level routes would let the SW hit the
  // real worker. Context routes intercept both.
  const ctx = typeof page.context === "function" ? page.context() : page;
  // NOTE: Playwright matches routes in REVERSE registration order — the
  // catch-all must be registered FIRST so specific stubs win.
  await ctx.route(`${WORKER_ORIGIN}/**`, (r) =>
    r.fulfill({ status: 500, json: { error: "unexpected worker call in test" } }));
  // Worker API endpoints the frontend fetches at boot.
  await ctx.route(`${WORKER_ORIGIN}/quota*`, (r) =>
    r.fulfill({ json: { quota: { used: 0, limit: 1, balance: 0 } } }));
  await ctx.route(`${WORKER_ORIGIN}/config`, (r) =>
    r.fulfill({ json: { turnstileSiteKey: null } }));
  await ctx.route(`${WORKER_ORIGIN}/campaigns`, (r) =>
    r.fulfill({ json: { campaigns: [] } }));
  await ctx.route(`${WORKER_ORIGIN}/phrases`, (r) =>
    r.fulfill({ json: { phrases: [{ id: 1, label: "測試短語" }] } }));
  // Turnstile + Google Fonts: dead-end them (page must still boot).
  await ctx.route("https://challenges.cloudflare.com/**", (r) => r.abort());
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await ctx.route("https://fonts.gstatic.com/**", (r) => r.abort());
  // JSZip CDN → serve the local copy (same 3.10.1).
  await ctx.route("https://cdn.jsdelivr.net/npm/jszip@*/dist/jszip.min.js", (r) =>
    r.fulfill({ body: readFileSync(JSZIP_MIN, "utf8"), contentType: "application/javascript" }));
}

// Named chroma plates, mirroring app.js CHROMA_KEYS. Tests deliberately keep
// their own copy: a helper that imported the app's table would move with it.
export const KEY_RGB = {
  green: [0, 255, 0],
  magenta: [255, 0, 255],
  blue: [0, 0, 255],
  cyan: [0, 255, 255],
  yellow: [255, 255, 0],
};

export function keyRgbOf(key) {
  if (KEY_RGB[key]) return KEY_RGB[key];
  const m = /^#?([0-9a-f]{6})$/i.exec(String(key));
  if (!m) throw new Error(`unknown chroma key: ${key}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

// Build a synthetic 3×3 grid PNG in the page and return it as a Buffer.
// 1024×1024 (not divisible by 3 — exercises the Math.floor split path).
// Each cell: bg color + a dark-red rounded blob so the character survives
// chroma-key. bg: a named plate ("green" | "magenta" | "blue" | "cyan" |
// "yellow"), "white", or any "#RRGGBB".
export async function makeGridBuffer(page, bg = "green", size = 1024, height = null) {
  const dataUrl = await page.evaluate(({ bg, size, height }) => {
    const c = document.createElement("canvas");
    c.width = size; c.height = height || size;
    const ctx = c.getContext("2d");
    const BG = { green: "#00FF00", magenta: "#FF00FF", blue: "#0000FF",
      cyan: "#00FFFF", yellow: "#FFFF00", white: "#FFFFFF" }[bg] || bg;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, size, size);
    const cell = size / 3;
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        const idx = r * 3 + col;
        const cx = col * cell + cell / 2;
        const cy = r * cell + cell / 2;
        // Distinct per-tile blob color (never green/magenta-ish) so tests
        // can identify which source tile ended up where (reorder/main/tab).
        ctx.fillStyle = `rgb(${180 - idx * 12}, 26, ${30 + idx * 10})`;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(cx - cell * 0.12, cy - cell * 0.05, cell * 0.24, cell * 0.1);
      }
    }
    return c.toDataURL("image/png");
  }, { bg, size, height });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

// Build the edge case that exposed visible chroma halos in production:
// an opaque white sticker border pre-composited against the key plate.
// The two blended rings mimic the several-pixel anti-alias fringe emitted
// by image generators (and amplified by grid splitting/resampling).
export async function makeFringedGridBuffer(page, bg = "green", size = 1024) {
  const dataUrl = await page.evaluate(({ bg, size }) => {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    const colors = bg === "magenta"
      ? { plate: "#FF00FF", outer: "rgb(255, 180, 255)", inner: "rgb(255, 220, 255)" }
      : { plate: "#00FF00", outer: "rgb(180, 255, 180)", inner: "rgb(220, 255, 220)" };
    ctx.fillStyle = colors.plate;
    ctx.fillRect(0, 0, size, size);
    const cell = size / 3;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cx = col * cell + cell / 2;
        const cy = row * cell + cell / 2;
        for (const [radius, color] of [
          [0.30, colors.outer],
          [0.285, colors.inner],
          [0.27, "#FFFFFF"],
        ]) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(cx, cy, cell * radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#404040";
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return c.toDataURL("image/png");
  }, { bg, size });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

// A low-light key-colour shadow around the subject. It is deliberately below
// the strict minKey profiles but still visibly leans toward the selected key;
// the legacy continuous matte should remove its colour cast.
export async function makeDarkKeyShadowGridBuffer(page, bg = "green", size = 1024) {
  const dataUrl = await page.evaluate(({ bg, size }) => {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    const colors = bg === "magenta"
      ? { plate: "#FF00FF", shadow: "rgb(26, 6, 26)" }
      : { plate: "#00FF00", shadow: "rgb(6, 26, 6)" };
    ctx.fillStyle = colors.plate;
    ctx.fillRect(0, 0, size, size);
    const cell = size / 3;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cx = col * cell + cell / 2;
        const cy = row * cell + cell / 2;
        ctx.fillStyle = colors.shadow;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.31, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#404040";
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.20, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return c.toDataURL("image/png");
  }, { bg, size });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

// Ack the LINE-rules gate (unlocks both upload boxes).
export async function ackRules(page) {
  const ack = page.locator("#rules-ack");
  if (!(await ack.isChecked())) await ack.check();
}

// Upload a grid buffer through the BYOG input.
export async function uploadGrid(page, buffer, name = "grid.png") {
  await page.setInputFiles("#grid-file-input", {
    name, mimeType: "image/png", buffer,
  });
  // Uploads land in the assets workspace (material stage); most tests
  // operate on the pool, so hop to pack once processing kicked off.
  await page.locator('.studio-tab[data-tab="pack"]').click();
}

// Parse PNG width/height from the IHDR chunk.
export function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Count fully-transparent pixels of an <img> dataURL rendered in-page.
export async function transparentPixelCount(page, imgSelector) {
  return page.evaluate(async (sel) => {
    const img = document.querySelector(sel);
    const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] === 0) n++;
    return n;
  }, imgSelector);
}

// Count visible pixels whose RGB still leans toward the selected key color.
// Transparent pixels are intentionally ignored: their hidden RGB does not
// render, while even low-alpha colored pixels can form a bright fringe.
export async function visibleKeySpillPixelCount(page, imgSelector, key) {
  return page.evaluate(async ({ imgSelector, keyRgb }) => {
    const img = document.querySelector(imgSelector);
    const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const mid = (Math.max(...keyRgb) + Math.min(...keyRgb)) / 2;
    const ki = [0, 1, 2].filter((i) => keyRgb[i] > mid);
    const oi = [0, 1, 2].filter((i) => !ki.includes(i));
    let spill = 0;
    for (let i = 0; i < d.length; i += 4) {
      const px = [d[i], d[i + 1], d[i + 2]];
      const a = d[i + 3];
      if (a <= 8) continue;
      // key 佔的通道裡最弱的一支，減其餘通道裡最強的一支 —— 與 app.js 同一個分數。
      const excess = Math.min(...ki.map((c) => px[c])) - Math.max(...oi.map((c) => px[c]));
      // Match the legacy cleaner's lower bound: ≤20/255 is a subtle cast;
      // anything above it is the clearly visible green/pink fringe we must remove.
      if (excess > 20) spill++;
    }
    return spill;
  }, { imgSelector, keyRgb: keyRgbOf(key) });
}

// Count opaque pixels (alpha 255) of an <img> dataURL rendered in-page.
// The 撞色 negative control needs this: "主體還在嗎" is an opaque-pixel
// question, and a fully-eaten sticker still looks fine on a checkerboard.
export async function opaquePixelCount(page, imgSelector) {
  return page.evaluate(async (sel) => {
    const img = document.querySelector(sel);
    const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] === 255) n++;
    return n;
  }, imgSelector);
}

// A grid whose cells already have the 370:320 sticker aspect ratio, so
// splitGrid adds no padding bars — the only backdrop colour in the output
// is `plate`. That keeps custom-key tests honest: with a square fixture the
// contain-fit bars are painted in whatever key was selected AT IMPORT time,
// which would show up as leftover opaque pixels unrelated to the keying.
// `subject` is the disc colour; pass one close to `plate` for the 撞色
// negative control.
export async function makeAspectGridBuffer(page, plate, subject = "rgb(180, 26, 30)") {
  const dataUrl = await page.evaluate(({ plate, subject }) => {
    const cellW = 370, cellH = 320;
    const c = document.createElement("canvas");
    c.width = cellW * 3; c.height = cellH * 3;
    const ctx = c.getContext("2d");
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, c.width, c.height);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        ctx.fillStyle = subject;
        ctx.beginPath();
        ctx.arc(col * cellW + cellW / 2, row * cellH + cellH / 2, cellH * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return c.toDataURL("image/png");
  }, { plate, subject });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

// Expected average red channel of a keyed sticker built from fixture tile
// `idx` — blob dominates the opaque area; small white rect pulls it up.
export function fixtureTileAvgRed(idx) {
  return 0.91 * (180 - idx * 12) + 23;
}

// Average RGB of opaque pixels in a PNG buffer (decoded in-page).
export async function pngAvgOpaqueColor(page, buffer) {
  const b64 = buffer.toString("base64");
  return page.evaluate(async (b64) => {
    const resp = await fetch(`data:image/png;base64,${b64}`);
    const bmp = await createImageBitmap(await resp.blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    }
    return n ? { r: r / n, g: g / n, b: b / n, n } : { r: 0, g: 0, b: 0, n: 0 };
  }, b64);
}

// Upload several grid buffers at once through the BYOG input.
export async function uploadGrids(page, buffers) {
  await page.setInputFiles(
    "#grid-file-input",
    buffers.map((buffer, i) => ({ name: `grid-${i + 1}.png`, mimeType: "image/png", buffer })),
  );
  await page.locator('.studio-tab[data-tab="pack"]').click();
}

// Click a download trigger and return the downloaded file as a Buffer.
export async function captureDownload(page, trigger) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    trigger(),
  ]);
  const path = await download.path();
  return { buffer: readFileSync(path), suggested: download.suggestedFilename() };
}
