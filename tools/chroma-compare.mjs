#!/usr/bin/env node

// Generate visual comparisons for the green/magenta chroma-key algorithms.
// Usage:
//   node tools/chroma-compare.mjs [--key=green|magenta] image-a.png image-b.png
//
// The output is written next to each source image as
//   <name>.chroma-compare.png
//   <name>.chroma-compare-zoom.png
//   <name>.chroma-best.png       (strict / pureKey, transparent)
//   <name>.chroma-compare.json  (pixel counts for each method)
//
// This intentionally runs in a browser canvas, matching the production
// pixel format and alpha behaviour rather than using a server-side image
// library with different colour compositing rules.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const keyArg = args.find((arg) => arg.startsWith("--key="))?.slice("--key=".length) || "green";
const inputs = args.filter((arg) => !arg.startsWith("--key="));
if (!['green', 'magenta'].includes(keyArg)) {
  console.error("--key must be green or magenta");
  process.exit(2);
}
if (inputs.length === 0) {
  console.error("Usage: node tools/chroma-compare.mjs [--key=green|magenta] <grid.png> [more-grid.png ...]");
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent("<!doctype html><body></body>");

for (const input of inputs) {
  const absolute = path.resolve(input);
  const b64 = fs.readFileSync(absolute).toString("base64");
  const mime = path.extname(absolute).toLowerCase() === ".jpg" ? "image/jpeg" : "image/png";
  const result = await page.evaluate(async ({ b64, mime, key }) => {
    const STICKER_W = 370;
    const STICKER_H = 320;
    const INSET = 0.03;

    const img = new Image();
    img.src = `data:${mime};base64,${b64}`;
    await img.decode();

    const source = document.createElement("canvas");
    source.width = img.naturalWidth;
    source.height = img.naturalHeight;
    source.getContext("2d").drawImage(img, 0, 0);

    function keyScore(r, g, b, key) {
      return key === "magenta"
        ? (Math.min(r, b) - g) / 255
        : (g - Math.max(r, b)) / 255;
    }

    function splitTiles(key) {
      const out = [];
      const tileW = Math.floor(source.width / 3);
      const tileH = Math.floor(source.height / 3);
      const insetX = Math.round(tileW * INSET);
      const insetY = Math.round(tileH * INSET);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const tile = document.createElement("canvas");
          tile.width = STICKER_W;
          tile.height = STICKER_H;
          const ctx = tile.getContext("2d");
          ctx.fillStyle = key === "magenta" ? "#FF00FF" : "#00FF00";
          ctx.fillRect(0, 0, STICKER_W, STICKER_H);
          const sx = col * tileW + insetX;
          const sy = row * tileH + insetY;
          const sw = tileW - 2 * insetX;
          const sh = tileH - 2 * insetY;
          const scale = Math.min(STICKER_W / sw, STICKER_H / sh);
          const dw = sw * scale;
          const dh = sh * scale;
          ctx.drawImage(source, sx, sy, sw, sh,
            (STICKER_W - dw) / 2, (STICKER_H - dh) / 2, dw, dh);
          out.push(tile);
        }
      }
      return out;
    }

    function copyCanvas(src) {
      const dst = document.createElement("canvas");
      dst.width = src.width;
      dst.height = src.height;
      dst.getContext("2d").drawImage(src, 0, 0);
      return dst;
    }

    function processTile(src, key, mode) {
      const out = document.createElement("canvas");
      out.width = src.width;
      out.height = src.height;
      const ctx = out.getContext("2d");
      const input = src.getContext("2d").getImageData(0, 0, src.width, src.height);
      const result = ctx.createImageData(src.width, src.height);
      const od = result.data;
      const d = input.data;
      const hard = 0.25;
      const soft = 0.05;
      const strict = mode === "strict";
      const hybrid = mode === "hybrid";
      const safeUnmix = mode === "safe-unmix" || mode === "safe-unmix-erode";
      const directUnmix = mode === "direct-unmix";
      const erode = mode === "safe-unmix-erode" ? 1 : 0;
      const isPureKey = (r, g, b) => key === "magenta"
        ? Math.min(r, b) >= 50 && g <= 110 && r >= g * 1.7 && b >= g * 1.7
        : g >= 50 && r <= 110 && b <= 110 && g >= r * 1.7 && g >= b * 1.7;
      const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
      const despill = (i, r, g, b) => {
        if (key === "green") od[i + 1] = (r + b) >> 1;
        else { od[i] = g; od[i + 2] = g; }
      };
      const tryUnmixKey = (i, r, g, b, alpha) => {
        const a = alpha / 255;
        if (a <= 0.18 || a >= 0.96) return false;
        const inv = 1 - a;
        const kr = key === "magenta" ? 255 : 0;
        const kg = key === "green" ? 255 : 0;
        const kb = key === "magenta" ? 255 : 0;
        const fr = (r - inv * kr) / a;
        const fg = (g - inv * kg) / a;
        const fb = (b - inv * kb) / a;
        if ([fr, fg, fb].some((v) => v < -2 || v > 257)) return false;
        if (Math.max(fr, fg, fb) - Math.min(fr, fg, fb) > 52) return false;
        od[i] = clamp(fr);
        od[i + 1] = clamp(fg);
        od[i + 2] = clamp(fb);
        return true;
      };

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const score = keyScore(r, g, b, key);
        const pure = isPureKey(r, g, b);
        const neutralForeground = key === "green"
          ? r >= 128 && b >= 128 && Math.abs(r - b) <= 40
          : g >= 128 && Math.min(r, b) >= 128 && Math.abs(r - b) <= 40;
        const protectLightEdge = hybrid && neutralForeground && score <= hard;
        let alpha = 255;
        if (protectLightEdge) {
          alpha = 255;
        } else if (strict) {
          if (pure && score > hard) alpha = 0;
          else if (pure && score > soft) {
            alpha = Math.round(255 * (hard - score) / (hard - soft));
          }
        } else if (score > hard) {
          alpha = 0;
        } else if (score > soft) {
          alpha = Math.round(255 * (hard - score) / (hard - soft));
        }
        od[i] = r; od[i + 1] = g; od[i + 2] = b; od[i + 3] = alpha;
        const keyDominant = key === "green" ? g > r && g > b : r > g && b > g;
        if (alpha > 0 && keyDominant) {
          const unmixed = alpha < 255 && (directUnmix || (safeUnmix && tryUnmixKey(i, r, g, b, alpha)));
          if (!unmixed) despill(i, r, g, b);
        }
      }
      ctx.putImageData(result, 0, 0);

      if (erode === 0) return out;
      const clean = copyCanvas(out);
      const cctx = clean.getContext("2d");
      const px = cctx.getImageData(0, 0, clean.width, clean.height);
      const a = new Uint8Array(clean.width * clean.height);
      for (let i = 0, p = 0; i < px.data.length; i += 4, p++) a[p] = px.data[i + 3];
      for (let y = 1; y < clean.height - 1; y++) {
        for (let x = 1; x < clean.width - 1; x++) {
          const p = y * clean.width + x;
          if (a[p] === 0 || a[p] === 255) continue;
          let empty = false;
          for (let dy = -1; dy <= 1 && !empty; dy++) {
            for (let dx = -1; dx <= 1 && !empty; dx++) {
              if (dx || dy) empty = a[(y + dy) * clean.width + x + dx] === 0;
            }
          }
          if (empty) px.data[p * 4 + 3] = 0;
        }
      }
      cctx.putImageData(px, 0, 0);
      return clean;
    }

    function tileStats(tile, key) {
      const d = tile.getContext("2d").getImageData(0, 0, tile.width, tile.height).data;
      let transparent = 0;
      let partial = 0;
      let visibleSpill = 0;
      let spillExcess = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a === 0) transparent++;
        else if (a < 255) partial++;
        if (a > 8) {
          const excess = key === "magenta"
            ? Math.min(d[i], d[i + 2]) - d[i + 1]
            : d[i + 1] - Math.max(d[i], d[i + 2]);
          if (excess > 20) {
            visibleSpill++;
            spillExcess += excess;
          }
        }
      }
      return { transparent, partial, visibleSpill, spillExcess };
    }

    function checker(ctx, x, y, w, h) {
      const s = 16;
      for (let yy = y; yy < y + h; yy += s) {
        for (let xx = x; xx < x + w; xx += s) {
          ctx.fillStyle = ((xx / s + yy / s) & 1) ? "#303642" : "#4b5563";
          ctx.fillRect(xx, yy, Math.min(s, x + w - xx), Math.min(s, y + h - yy));
        }
      }
    }

    const rows = [
      ["原圖", "raw"],
      ["舊版連續 matte", "legacy"],
      ["目前 strict / pureKey", "strict"],
      ["混合：strict 保留淺色前景邊 + 連續清背景", "hybrid"],
      ["連續 matte + 安全反混合", "safe-unmix"],
      ["連續 matte + 安全反混合 + 侵蝕", "safe-unmix-erode"],
    ];
    const width = STICKER_W * 3;
    const rowH = STICKER_H * 3 + 42;
    const sheet = document.createElement("canvas");
    sheet.width = width;
    sheet.height = rowH * rows.length;
    const sctx = sheet.getContext("2d");
    sctx.fillStyle = "#111827";
    sctx.fillRect(0, 0, sheet.width, sheet.height);
    const renderedRows = [];
    for (let ri = 0; ri < rows.length; ri++) {
      const [label, mode] = rows[ri];
      const y0 = ri * rowH;
      sctx.fillStyle = "#f9fafb";
      sctx.font = "bold 22px sans-serif";
      sctx.fillText(label, 12, y0 + 30);
      const tiles = splitTiles(key);
      const rendered = [];
      for (let i = 0; i < tiles.length; i++) {
        const x = (i % 3) * STICKER_W;
        const y = y0 + 42 + Math.floor(i / 3) * STICKER_H;
        if (mode !== "raw") checker(sctx, x, y, STICKER_W, STICKER_H);
        const tile = mode === "raw" ? tiles[i] : processTile(tiles[i], key, mode);
        sctx.drawImage(tile, x, y);
        rendered.push(tile);
      }
      const stats = rendered.reduce((sum, tile) => {
        const current = tileStats(tile, key);
        for (const field of Object.keys(sum)) sum[field] += current[field];
        return sum;
      }, { transparent: 0, partial: 0, visibleSpill: 0, spillExcess: 0 });
      renderedRows.push({ label, tiles: rendered, stats });
    }

    // Enlarged first-tile view makes hair strands and white outline spill
    // visible without requiring an image editor.
    const zoomScale = 2;
    const zoom = document.createElement("canvas");
    zoom.width = STICKER_W * zoomScale;
    zoom.height = (STICKER_H * zoomScale + 42) * rows.length;
    const zctx = zoom.getContext("2d");
    zctx.fillStyle = "#111827";
    zctx.fillRect(0, 0, zoom.width, zoom.height);
    for (let ri = 0; ri < renderedRows.length; ri++) {
      const y0 = ri * (STICKER_H * zoomScale + 42);
      zctx.fillStyle = "#f9fafb";
      zctx.font = "bold 22px sans-serif";
      zctx.fillText(renderedRows[ri].label, 12, y0 + 30);
      checker(zctx, 0, y0 + 42, zoom.width, STICKER_H * zoomScale);
      zctx.drawImage(renderedRows[ri].tiles[0],
        0, y0 + 42, STICKER_W * zoomScale, STICKER_H * zoomScale);
    }

    const best = document.createElement("canvas");
    best.width = width;
    best.height = STICKER_H * 3;
    const bctx = best.getContext("2d");
    for (let i = 0; i < renderedRows[2].tiles.length; i++) {
      bctx.drawImage(renderedRows[2].tiles[i],
        (i % 3) * STICKER_W, Math.floor(i / 3) * STICKER_H);
    }
    return {
      sheetUrl: sheet.toDataURL("image/png"),
      zoomUrl: zoom.toDataURL("image/png"),
      bestUrl: best.toDataURL("image/png"),
      stats: Object.fromEntries(renderedRows.map((row) => [row.label, row.stats])),
    };
  }, { b64, mime, key: keyArg });

  const output = absolute.replace(/\.[^.]+$/, ".chroma-compare.png");
  const zoomOutput = absolute.replace(/\.[^.]+$/, ".chroma-compare-zoom.png");
  const bestOutput = absolute.replace(/\.[^.]+$/, ".chroma-best.png");
  const statsOutput = absolute.replace(/\.[^.]+$/, ".chroma-compare.json");
  fs.writeFileSync(output, Buffer.from(result.sheetUrl.split(",")[1], "base64"));
  fs.writeFileSync(zoomOutput, Buffer.from(result.zoomUrl.split(",")[1], "base64"));
  fs.writeFileSync(bestOutput, Buffer.from(result.bestUrl.split(",")[1], "base64"));
  fs.writeFileSync(statsOutput, JSON.stringify({ key: keyArg, source: absolute, modes: result.stats }, null, 2) + "\n");
  console.log(output);
  console.log(zoomOutput);
  console.log(bestOutput);
  console.log(statsOutput);
}

await browser.close();
