#!/usr/bin/env node
// 檢查 LINE Creators Magazine 是否刊出新的貼圖特輯活動，並將候選資料
// 附加到 worker/src/campaigns.json。GitHub Actions 會依差異開 PR，供人工
// 補上 extraPromptInstruction 與 forceStyleHint 後再合併。
//
// 必要環境變數：GEMINI_WEB_BASE_URL 與 GEMINI_API_KEY。
//
// 輸出：找到新活動時更新 worker/src/campaigns.json，並寫入
// .github/campaign-pr-body.md。找不到新活動時不修改檔案。

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGeminiWebJsonClient } from "./gemini-web-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CAMPAIGNS_PATH = path.join(REPO_ROOT, "worker", "src", "campaigns.json");
const PR_BODY_PATH = path.join(REPO_ROOT, ".github", "campaign-pr-body.md");

// LINE Creators Magazine 台灣文章彙整頁。從周邊 HTML 找出符合
// /archives/<數字>.html 格式，且提到「徵稿」或「特輯」的文章連結。
const LISTING_URL = "https://creator-mag-tw.weblog.to/";

const GEMINI_WEB_BASE_URL = process.env.GEMINI_WEB_BASE_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const missingSecrets = [
  ["GEMINI_WEB_BASE_URL", GEMINI_WEB_BASE_URL],
  ["GEMINI_API_KEY", GEMINI_API_KEY],
].filter(([, value]) => !value).map(([name]) => name);
if (missingSecrets.length > 0) {
  console.error(
    `缺少必要環境變數：${missingSecrets.join("、")}。請在 GitHub 儲存庫設定 secrets：GEMINI_WEB_BASE_URL 與 GEMINI_API_KEY。`,
  );
  process.exit(1);
}

const geminiWebJson = createGeminiWebJsonClient({
  baseUrl: GEMINI_WEB_BASE_URL,
  apiKey: GEMINI_API_KEY,
});

// 第一步：讀取既有活動資料。

const existing = JSON.parse(await fs.readFile(CAMPAIGNS_PATH, "utf8"));
const knownUrls = new Set(existing.map((c) => c.articleUrl));
console.log(`已載入 ${existing.length} 個既有活動`);

// 第二步：讀取活動列表並擷取候選文章網址。

console.log(`正在擷取活動列表：${LISTING_URL}`);
const listingHtml = await fetchText(LISTING_URL);

// 找出 /archives/<id>.html 連結與周邊文字，再篩選貼圖特輯或徵稿活動。
const linkRe = /href=["']([^"']*\/archives\/(\d+)\.html)["'][^>]*>([\s\S]{0,400})/g;
const candidates = new Map(); // 網址對應周邊文字。
let m;
while ((m = linkRe.exec(listingHtml)) !== null) {
  let url = m[1];
  if (!url.startsWith("http")) {
    url = "https://creator-mag-tw.weblog.to" + (url.startsWith("/") ? url : "/" + url);
  }
  if (knownUrls.has(url)) continue;
  const context = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // 候選文章必須同時提到貼圖，以及特輯、徵稿或徵集。
  if (!/貼圖|sticker/i.test(context)) continue;
  if (!/特輯|徵稿|徵集/.test(context)) continue;
  if (!candidates.has(url)) candidates.set(url, context);
}

console.log(`找到 ${candidates.size} 篇尚未收錄的候選文章`);
if (candidates.size === 0) {
  console.log("沒有新活動，檢查完成。");
  process.exit(0);
}

// 第三步：讀取候選文章並透過 gemini-web 擷取活動資料。

const additions = [];
const skippedArticles = [];
for (const [url, context] of candidates) {
  console.log(`正在擷取候選文章：${url}`);
  let articleHtml;
  try {
    articleHtml = await fetchText(url);
  } catch (err) {
    console.warn(`  略過，文章擷取失敗：${err.message}`);
    continue;
  }
  // 移除 HTML 標籤與程式區塊，並將文章內容限制在 10,000 個字元內。
  const bodyText = articleHtml
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10_000);

  let extracted;
  try {
    extracted = await extractCampaignViaGemini(bodyText);
  } catch (error) {
    // 單篇內容不合格式（例如截止日不是 YYYY-MM-DD）：跳過這一篇，其餘照常處理。
    // 服務連不上、回應截斷等其他錯誤仍然中止，避免誤判成「這週沒有活動」。
    if (error.name === "CampaignValidationError") {
      console.warn(`::warning::略過 ${url}：${error.message}`);
      skippedArticles.push({ url, reason: error.message });
      continue;
    }
    console.error(`  gemini-web 活動資料抽取失敗：${error.message}`);
    process.exit(1);
  }
  if (!extracted) {
    console.warn("  略過，模型判斷文章不是貼圖特輯活動。");
    continue;
  }
  // 預填需要人工整理的欄位，讓 PR 清楚標出後續工作。
  extracted.articleUrl = url;
  extracted.forceWithText ??= null;
  extracted.forceStyleHint ??= null;
  extracted.extraPromptInstruction ??=
    `TODO(human)：請為「${extracted.fullName || extracted.label}」撰寫英文活動規則`;
  additions.push(extracted);
  console.log(`  新增候選活動：${extracted.id}／${extracted.label}`);
}

if (additions.length === 0) {
  console.log("沒有新活動，檢查完成。");
  process.exit(0);
}

// 第四步：合併新活動並寫回檔案。

const merged = existing.concat(additions);
await fs.writeFile(CAMPAIGNS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
console.log(`已將 ${additions.length} 個新活動寫入 campaigns.json，目前共 ${merged.length} 個活動`);

// 第五步：準備工作流程建立 PR 時使用的說明。

const prBody = [
  `找到 **${additions.length} 個**新的 LINE Creators Market 特輯活動，請人工審查：`,
  "",
  ...additions.map((c) =>
    `- **${c.label}**（\`${c.id}\`），投稿截止日：\`${c.submitDeadline}\`\n` +
    `  - [活動文章](${c.articleUrl})\n` +
    `  - 活動簡介：${c.blurb}`
  ),
  "",
  "## 合併前請完成以下審查：",
  "",
  "1. 開啟 `worker/src/campaigns.json`，檢查檔案底部新增的活動資料。",
  "2. **改寫 `extraPromptInstruction`**，以既有活動格式撰寫英文規則，取代 `TODO(human)`。",
  "3. 若活動要求特定畫風，設定 `forceStyleHint`，例如水水活動使用 `cute_chibi`。",
  "4. 禁止文字時將 `forceWithText` 設為 `false`；要求文字時設為 `true`；皆可時設為 `null`。",
  "5. 視需要修正 `label`、`blurb` 或 `submitTag`。",
  "6. 確認投稿截止日格式為 `YYYY-MM-DD`。",
  "",
  "審查完成後部署 Worker：`cd worker && npx wrangler deploy`。",
  "",
  "_由 `.github/workflows/check-line-campaigns.yml` 自動產生。_",
].join("\n");

await fs.writeFile(PR_BODY_PATH, prBody, "utf8");
console.log(`已寫入 PR 說明：${PR_BODY_PATH}`);

// 輔助函式：讀取網頁與組成模型提示。

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; line-sticker-studio-campaign-checker/1.0; +https://github.com/yazelin/line-sticker-studio)",
    },
  });
  if (!r.ok) throw new Error(`網頁讀取失敗（HTTP ${r.status} ${r.statusText}）`);
  return await r.text();
}

async function extractCampaignViaGemini(bodyText) {
  const prompt = `你是 LINE Creators Magazine 文章解析助手。以下是一篇文章內容，請判斷它是否在介紹一個「LINE 貼圖（sticker）特輯活動」並擷取結構化資料。

如果文章不是貼圖特輯，例如表情貼（sticon）特輯、其他類型公告或教學文，請回傳 JSON \`null\`。
如果文章是貼圖特輯，請回傳 JSON 物件，並提供以下所有欄位：
- "id"：5 至 25 個字元的英文 snake_case 識別碼，依活動主題歸納，例如 "no_text"、"watery"、"big_face"。
- "label"：4 至 15 個中文字的簡短標籤，例如「無字浮誇」或「水水」。
- "fullName"：文章中的完整活動名稱，10 至 40 個字元。
- "submitTag"：LINE 編輯器中的投稿活動標籤，通常等於 fullName 或與其近似。
- "submitDeadline"："YYYY-MM-DD" 格式，從「投稿截止」或「徵稿期限」等資訊判斷。
- "bannerPeriod"："YYYY/MM/DD ~ MM/DD" 格式，從 Banner 露出期或曝光期判斷；找不到時填 "未公布"。
- "blurb"：以繁體中文寫一句 10 至 40 字的風格特徵說明。

文章內容（已移除 HTML 標籤）：
"""
${bodyText}
"""

只回傳 JSON 物件或 null，不要加上 Markdown 程式碼區塊或其他文字。`;

  return await geminiWebJson(prompt);
}
