#!/usr/bin/env node
// Check LINE Creators Magazine for new sticker-pack campaigns and append
// any new entries to worker/src/campaigns.json. Designed to run as a
// GitHub Action; opens a PR with the diff so a human can fill in the
// hand-crafted `extraPromptInstruction` and `forceStyleHint` fields
// before merging.
//
// Env vars:
//   GEMINI_API_KEY   — required, used to extract structured metadata from
//                      a campaign blog post (gemini-2.5-flash, ~free).
//
// Output:
//   - Mutates ../worker/src/campaigns.json in place if new campaigns found
//   - Writes ../.github/campaign-pr-body.md (consumed by the workflow)
//   - Exits 0 always; the workflow checks `git diff --quiet` to decide
//     whether to open a PR.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CAMPAIGNS_PATH = path.join(REPO_ROOT, "worker", "src", "campaigns.json");
const PR_BODY_PATH = path.join(REPO_ROOT, ".github", "campaign-pr-body.md");

// Listing page that aggregates LINE Creators Magazine TW posts. We scan
// it for article URLs matching /archives/<digits>.html that mention
// 「徵稿」 or 「特輯」 in the surrounding HTML.
const LISTING_URL = "https://creator-mag-tw.weblog.to/";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY env var is required");
  process.exit(1);
}

// ---- Step 1: read existing campaigns ---------------------------------

const existing = JSON.parse(await fs.readFile(CAMPAIGNS_PATH, "utf8"));
const knownUrls = new Set(existing.map((c) => c.articleUrl));
console.log(`Loaded ${existing.length} existing campaigns`);

// ---- Step 2: fetch listing, extract candidate article URLs -----------

console.log(`Fetching listing: ${LISTING_URL}`);
const listingHtml = await fetchText(LISTING_URL);

// Find all /archives/<id>.html links along with ~200 chars of surrounding
// context so we can filter to ones that look like sticker-pack 特輯/徵稿.
const linkRe = /href=["']([^"']*\/archives\/(\d+)\.html)["'][^>]*>([\s\S]{0,400})/g;
const candidates = new Map(); // url → context snippet
let m;
while ((m = linkRe.exec(listingHtml)) !== null) {
  let url = m[1];
  if (!url.startsWith("http")) {
    url = "https://creator-mag-tw.weblog.to" + (url.startsWith("/") ? url : "/" + url);
  }
  if (knownUrls.has(url)) continue;
  const context = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // Filter heuristic: must mention sticker / 貼圖 + 特輯 or 徵稿
  if (!/貼圖|sticker/i.test(context)) continue;
  if (!/特輯|徵稿|徵集/.test(context)) continue;
  if (!candidates.has(url)) candidates.set(url, context);
}

console.log(`Found ${candidates.size} candidate article URL(s) not in campaigns.json`);
if (candidates.size === 0) {
  console.log("No new campaigns. Exiting cleanly.");
  process.exit(0);
}

// ---- Step 3: for each candidate, fetch + extract via Gemini ----------

const additions = [];
for (const [url, context] of candidates) {
  console.log(`Fetching candidate: ${url}`);
  let articleHtml;
  try {
    articleHtml = await fetchText(url);
  } catch (err) {
    console.warn(`  skip (fetch failed): ${err.message}`);
    continue;
  }
  // Strip down to <body> text-ish — keep it under ~10K chars for the LLM.
  const bodyText = articleHtml
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10_000);

  const extracted = await extractCampaignViaGemini(url, bodyText);
  if (!extracted) {
    console.warn(`  skip (Gemini did not extract a clean campaign object)`);
    continue;
  }
  // Sanity-check minimum required fields
  if (!extracted.id || !extracted.label || !extracted.submitDeadline) {
    console.warn(`  skip (missing required fields)`, extracted);
    continue;
  }
  // Default the human-curated fields so the PR has obvious TODO markers.
  extracted.articleUrl = url;
  extracted.forceWithText ??= null;
  extracted.forceStyleHint ??= null;
  extracted.extraPromptInstruction ??=
    `TODO(human): write English CAMPAIGN OVERRIDE rules for 「${extracted.fullName || extracted.label}」`;
  additions.push(extracted);
  console.log(`  + ${extracted.id} / ${extracted.label}`);
}

if (additions.length === 0) {
  console.log("No campaigns extracted. Exiting cleanly.");
  process.exit(0);
}

// ---- Step 4: append + write back -------------------------------------

const merged = existing.concat(additions);
await fs.writeFile(CAMPAIGNS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
console.log(`Wrote ${merged.length} campaigns (${additions.length} new) to campaigns.json`);

// ---- Step 5: build PR body for the workflow --------------------------

const prBody = [
  `Found **${additions.length}** new LINE Creators Market campaign(s) to review:`,
  "",
  ...additions.map((c) =>
    `- **${c.label}** (\`${c.id}\`) — submit deadline \`${c.submitDeadline}\`\n` +
    `  - 📄 [Article](${c.articleUrl})\n` +
    `  - blurb: ${c.blurb || "_(none)_"}`
  ),
  "",
  "## ✅ Before merging, please:",
  "",
  "1. Open `worker/src/campaigns.json`, scroll to the new entries at the bottom.",
  "2. **Replace `extraPromptInstruction`** — replace the `TODO(human)` placeholder with the carefully-crafted English rule block (mimic existing campaigns' style). This is the single most impactful field.",
  "3. **Set `forceStyleHint`** if the campaign demands a specific look (e.g. `cute_chibi` for 水水).",
  "4. **Set `forceWithText`** to `false` if the campaign forbids text; `true` if it requires; `null` if either is fine.",
  "5. Optionally tweak `label` / `blurb` / `submitTag` if Gemini's extraction missed nuance.",
  "6. Verify the deadline format is `YYYY-MM-DD`.",
  "",
  "After review, deploy worker (`cd worker && npx wrangler deploy`).",
  "",
  "_Auto-generated by `.github/workflows/check-line-campaigns.yml`._",
].join("\n");

await fs.writeFile(PR_BODY_PATH, prBody, "utf8");
console.log(`Wrote PR body to ${PR_BODY_PATH}`);

// ---- helpers ---------------------------------------------------------

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; line-sticker-studio-campaign-checker/1.0; +https://github.com/yazelin/line-sticker-studio)",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return await r.text();
}

async function extractCampaignViaGemini(url, bodyText) {
  const prompt = `你是 LINE Creators Magazine 文章解析助手。以下是一篇文章內容，請判斷它是否在介紹一個「LINE 貼圖（sticker）特輯活動」並擷取結構化資料。

如果文章不是貼圖特輯（例如：是表情貼/sticon 特輯、是其他類型公告、是教學文）→ 回 \`null\`。
如果是 → 回一個 JSON 物件，欄位：
- "id": 短英文 snake_case id (5-25 chars)，從活動主題歸納，例如 "no_text", "watery", "big_face"
- "label": 短中文標籤 (4-15 chars)，例如「無字浮誇」「水水」
- "fullName": 文章中的完整活動名稱 (10-40 chars)
- "submitTag": LINE 編輯器中對應的投稿活動 tag (通常等於 fullName 或近似)
- "submitDeadline": "YYYY-MM-DD" 格式 (找「投稿截止」「徵稿期限」等關鍵字)
- "bannerPeriod": "YYYY/MM/DD ~ MM/DD" 格式 (找「Banner 露出期」「曝光期」等關鍵字)，找不到就填 "未公布"
- "blurb": 一句話 (10-40 字) 說明這個特輯要的風格特徵 (用繁中)

文章內容（已 strip HTML）：
"""
${bodyText}
"""

只回 JSON 物件 (或 null)，無 markdown wrapping、無多餘文字。`;

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const r = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!r.ok) {
    console.warn(`  Gemini error: HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return null;
  }
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "null";
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const obj = text.match(/\{[\s\S]*\}/);
    parsed = obj ? JSON.parse(obj[0]) : null;
  }
  return parsed && typeof parsed === "object" ? parsed : null;
}
