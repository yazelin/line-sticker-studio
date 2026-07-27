// 判「這張 sheet 是不是寬幅畫布」。
// gemini-web 的畫布比例是模型自己挑的，挑到寬幅（實測 1.78 / 1.90）時它會把
// 9 格攤成 4～5 欄並重複語句填滿，前端切九格就整個錯位。直式畫布仍是 3×3，
// 切九格照樣正確，所以只擋寬的。
export const WIDE_SHEET_RATIO = 1.15;

// PNG 的寬高就寫在檔頭 IHDR（byte 16..23），解前 48 bytes 就夠，不必整張 decode。
export function isWideSheet(b64) {
  try {
    const head = atob(String(b64).slice(0, 64));
    if (head.charCodeAt(0) !== 0x89 || head.slice(1, 4) !== "PNG") return false;
    const u32 = (i) =>
      ((head.charCodeAt(i) << 24) | (head.charCodeAt(i + 1) << 16) |
       (head.charCodeAt(i + 2) << 8) | head.charCodeAt(i + 3)) >>> 0;
    const w = u32(16), h = u32(20);
    return w > 0 && h > 0 && w / h > WIDE_SHEET_RATIO;
  } catch {
    return false; // 判不出來就放行，寧可出圖也不要卡住使用者
  }
}
