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
  // Worker API endpoints the frontend fetches at boot.
  await page.route(`${WORKER_ORIGIN}/quota`, (r) =>
    r.fulfill({ json: { quota: { used: 0, limit: 5 } } }));
  await page.route(`${WORKER_ORIGIN}/config`, (r) =>
    r.fulfill({ json: { turnstileSiteKey: null } }));
  await page.route(`${WORKER_ORIGIN}/campaigns`, (r) =>
    r.fulfill({ json: { campaigns: [] } }));
  await page.route(`${WORKER_ORIGIN}/phrases`, (r) =>
    r.fulfill({ json: { phrases: [{ id: 1, label: "測試短語" }] } }));
  // Anything else that slips through to the worker fails loudly.
  await page.route(`${WORKER_ORIGIN}/**`, (r) =>
    r.fulfill({ status: 500, json: { error: "unexpected worker call in test" } }));
  // Turnstile + Google Fonts: dead-end them (page must still boot).
  await page.route("https://challenges.cloudflare.com/**", (r) => r.abort());
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("https://fonts.gstatic.com/**", (r) => r.abort());
  // JSZip CDN → serve the local copy (same 3.10.1).
  await page.route("https://cdn.jsdelivr.net/npm/jszip@*/dist/jszip.min.js", (r) =>
    r.fulfill({ body: readFileSync(JSZIP_MIN, "utf8"), contentType: "application/javascript" }));
}

// Build a synthetic 3×3 grid PNG in the page and return it as a Buffer.
// 1024×1024 (not divisible by 3 — exercises the Math.floor split path).
// Each cell: bg color + a dark-red rounded blob so the character survives
// chroma-key. bg: "green" | "magenta" | "white".
export async function makeGridBuffer(page, bg = "green", size = 1024) {
  const dataUrl = await page.evaluate(({ bg, size }) => {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    const BG = { green: "#00FF00", magenta: "#FF00FF", white: "#FFFFFF" }[bg];
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, size, size);
    const cell = size / 3;
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        const cx = col * cell + cell / 2;
        const cy = r * cell + cell / 2;
        ctx.fillStyle = "#8B1A1A";
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(cx - cell * 0.12, cy - cell * 0.05, cell * 0.24, cell * 0.1);
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

// Click a download trigger and return the downloaded file as a Buffer.
export async function captureDownload(page, trigger) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    trigger(),
  ]);
  const path = await download.path();
  return { buffer: readFileSync(path), suggested: download.suggestedFilename() };
}
