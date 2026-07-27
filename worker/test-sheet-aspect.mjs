// Self-check for isWideSheet — run with: node worker/test-sheet-aspect.mjs
// 只解 PNG 檔頭判寬高比；寬幅 = 模型把 9 格攤成 4~5 欄，要重打。
import assert from "node:assert/strict";
import { isWideSheet } from "./src/sheet.js";

const pngHeader = (w, h) => {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b.toString("base64");
};

assert.equal(isWideSheet(pngHeader(1024, 1024)), false, "正方形是好的");
assert.equal(isWideSheet(pngHeader(2048, 2048)), false, "大張正方形也是好的");
assert.equal(isWideSheet(pngHeader(1792, 2390)), false, "直式仍是 3x3，不擋");
assert.equal(isWideSheet(pngHeader(2730, 1536)), true, "1.78 寬幅 → 實測 4 欄");
assert.equal(isWideSheet(pngHeader(1424, 748)), true, "1.90 寬幅 → 實測 5 欄");
assert.equal(isWideSheet(pngHeader(1100, 1000)), false, "1.10 還在容差內");
assert.equal(isWideSheet("bm90LWEtcG5nLWF0LWFsbA=="), false, "不是 PNG 就放行");
assert.equal(isWideSheet(""), false, "空字串放行");

console.log("test-sheet-aspect: all assertions passed");
