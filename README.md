# LINE 貼圖製造機 ｜ LINE Sticker Studio

上傳一張角色圖 → AI 自動產出整組 LINE 貼圖 → 下載 ZIP 後拖去
[LINE Creators Market](https://creator.line.me/zh-hant/) 上架。

對應 LINE 接受的最小套組（**8 張**），1 次 Gemini 呼叫就完成、
~USD 0.04、約 50 秒。

> 🟢 線上版：<https://yazelin.github.io/line-sticker-studio/>
> 架構參考姊妹工具 [emoji-slot-machine](https://github.com/yazelin/emoji-slot-machine)。

## ✨ 特色

### 兩條輸入路徑

- **🅰 主路徑**：上傳一張角色圖（自拍 / 手繪 / Q 版頭像）讓 AI 產一切
  - 需要 LINE 登入
  - 每天免費 **3 次** AI 生成（per LINE userId、UTC 0 點重置）
- **🅱 替代路徑**：自己用 Gemini 跑好 3×3 圖直接上傳
  - 免登入、免 API 額度、不限次
  - 工具仍會幫你切 8 張、去背、打包成 LINE 規格 ZIP

### 內容自訂

- **8 格逐格自訂**：每格可固定預設 50 句之一 / 自訂任何語言文字 / 留隨機
- **✨ AI 主題產生器**：描述一個主題（例「上班崩潰」「我家貓」），AI 同時產 8 句短語 + 8 個英文 pose 描述
- **📝 印字 / 🤐 無字模式**：純表情/動作不印字也是有效設計，特別配合 phrase+action 配對能拿到精準姿勢
- **🌐 5 種貼圖文字語言**：繁中 / 簡中 / 英文 / 日文 / 韓文，同時影響 AI 短語生成 + Gemini 印字
- **角色動作描述**：每格可附英文 pose（例 `slumped at desk, weary look`）— 無字模式特別關鍵
- **單格客製重抽**：點任一格可改字再重抽（會耗 1 次 API quota）

### 畫風

**~46 種預設**：
- 通用 chat sticker DNA（粗黑線、粉嫩卡哇伊、果凍布丁、Gen-Z 閃亮亮…）
- 動漫 / 卡通（chibi、manga、賽璐璐、軟調手繪…）
- 3D / 立體（精緻 3D、盲盒公仔、黏土、像素…）
- 繪畫（水彩、油畫、水墨、浮世繪、印象派、Pop Art…）
- 攝影 / 寫實（街拍、底片、棚拍、拍立得…）
- 潮 / 主題（賽博龐克、蒸氣波、Y2K…）
- 梗圖（Impact 字、napkin 塗鴉…）
- **✏️ 自訂風格**（任何語言、最少 2 字）

> 所有預設均為原創描述，**不含任何品牌、IP、藝人、角色名稱**，避免上架被退件。

### LINE Creators Market 特輯活動

內建 6 個官方特輯活動 prompt（自動套用對應風格規則 + 投稿說明）：

- 🆕 進行中：**無字浮誇** / **水水** / **眼淚製造機** / **大臉攻擊**
- 📜 已結束（保留紀錄）：抽象搞笑研究所 / 台味大出巡

### 其他

- **📷 相機現拍**：getUserMedia 直接拍照當角色圖
- **📜 歷史 / 收藏**：IndexedDB 保留 30 筆未收藏 grid（含 AI + BYOG），收藏的不會被自動清除，可重命名 / 載入 / 重新切張下載
- **💚 客戶端 chroma-key 去背**：純綠 #00FF00 背景 → α=0、含 despill + 1-pass erosion 修綠邊。圖不上傳到任何伺服器
- **📦 ZIP 直接符合 LINE 規格**：370×320 貼圖 + 240×240 main + 96×74 tab + 上架說明 README
- **🔄 跨 tab 同步**：BroadcastChannel 即時同步配額，A tab 用了 B tab 立刻看到剩 N 次
- **⚖ LINE 規則確認 gate**：上傳前必須勾選確認，避免上架被退件

## 🏗 架構

```
┌────────────────────────┐         ┌──────────────────────────┐
│  Static frontend       │  POST   │  Cloudflare Worker       │
│  (GitHub Pages)        ├────────►│  line-sticker-gemini     │
│  index.html / app.js   │  JSON   │  src/index.js            │
│  styles.css            │         │  + VERTEX_API_KEY secret │
│                        │         │  + QUOTA KV namespace    │
│  ↓ split (chroma-key)  │         └────────┬─────────────────┘
│  ↓ fitWithPadding 10px │                  │
│  ↓ JSZip pack          │      ┌───────────┴──────┐
│  ↓ download .zip       │      ▼                  ▼
└────────────────────────┘  ┌────────┐    ┌──────────────────────┐
                            │ LINE   │    │ Vertex AI            │
                            │ Login  │    │ gemini-3.1-flash-    │
                            │ verify │    │ image-preview (圖)   │
                            └────────┘    │ gemini-2.5-flash (字)│
                                          └──────────────────────┘
```

- 前端純靜態，掛 GitHub Pages 免費
- Worker 是 Vertex API 的 proxy + prompt 組合器 + 配額守門員（不存圖、不留 log）
- 配額計數靠 Cloudflare KV，key 是 `quota:<lineUserId>:<UTC date>`，TTL 36h 自清
- 一次 AI 生成 = 1 次 worker call → 1 次 Gemini call → 9 個 sticker tiles（給用戶 9 選 8）

## 🔐 認證 + 配額

走 **LINE Login PKCE flow** — 純前端、不需要 Channel Secret。

- LINE userId 由 worker 透過 LINE 公開 verify endpoint 驗證 access_token 拿到
- 設定 `EXPECTED_LINE_CHANNEL_ID` 後 worker 只接受該 channel 簽出的 token（防止其他人用自己的 LINE Login channel 借免費生成）
- 配額：每天 3 次（DAILY_LIMIT 在 worker 開頭可改）
- 配額**只在 Gemini 確認成功後才扣**，timeout / 錯誤不會白燒
- 管理員 LINE userId 寫在 `ADMIN_LINE_USER_IDS`，可用 `POST /admin/reset-quota` 重設自己當天配額

> 🚫 **沒登入路徑也限額？** 故意不做。BYOG 路徑（自己用 Gemini 跑）天生不耗 worker 額度、不限次、不需要登入；要 AI 產就請登入。這個設計逼大家二選一，沒有「半路繞過」的灰色地帶。

## 🚀 本地開發

需要 Node.js 18+。

```bash
# Worker（本地 miniflare，不需要 Cloudflare 帳號）
cd worker
npm install
echo 'VERTEX_API_KEY="貼你 Vertex Express key"' > .dev.vars
npx wrangler dev --local --port 8787
# Worker 起在 http://127.0.0.1:8787
# 本機 dev 時 KV 也是 in-memory，配額不會跨重啟保留（剛好方便測試）

# 前端（另開 terminal）
cd ..
python3 -m http.server 8765
# 開 http://localhost:8765

# 把前端指向本地 worker（瀏覽器 console 跑一次）
localStorage.setItem('line-sticker-api-url', 'http://127.0.0.1:8787');
```

## ☁️ 部署

### 1. Worker → Cloudflare

```bash
cd worker
npx wrangler login                           # OAuth in browser
npx wrangler secret put VERTEX_API_KEY       # 貼你的 Vertex Express key

# 建配額用的 KV namespace（一次性）
npx wrangler kv namespace create QUOTA
# → 印出類似 { binding = "QUOTA", id = "abc123..." }
# 把 id 貼進 wrangler.toml 對應位置

npx wrangler deploy
# → https://line-sticker-gemini.<subdomain>.workers.dev
```

### 2. LINE Login channel

到 [LINE Developers](https://developers.line.biz/console/) 建一個 LINE Login channel：

- Callback URL：你的 GitHub Pages URL（例 `https://<user>.github.io/line-sticker-studio/`）
- 把拿到的 **Channel ID** 寫進：
  - `app.js` 的 `LINE_CHANNEL_ID`
  - `worker/src/index.js` 的 `EXPECTED_LINE_CHANNEL_ID`
- 想當管理員的話把你的 `Uxxxxx` userId 加進 `ADMIN_LINE_USER_IDS`

### 3. 前端 → GitHub Pages

```bash
git push origin main   # GitHub Pages 從 main branch 自動 deploy
```

如果 worker URL 不是 `line-sticker-gemini.yazelinj303.workers.dev`，改 `app.js` 的 `DEFAULT_API_URL`。

## 💰 成本

| 場景 | 你的成本 |
|---|---|
| 用戶按「開始生成」（AI 路徑、登入） | ~USD 0.04 / 用戶 / 次（最高 3 次/天） |
| AI 主題產生器（gemini-2.5-flash） | ~USD 0.0005 / 次 |
| 用戶按「複製 prompt → 自己到 Gemini 跑 → 回來上傳」| **0** |
| 用戶 BYOG（直接傳自己準備好的 3×3）| **0** |
| 前端去背 / ZIP 打包 / IndexedDB 歷史 | 0（瀏覽器算 + 瀏覽器存） |
| KV 配額讀寫 | 在 Cloudflare free tier 內 |

最壞情況：100 個用戶每天用滿 3 次 = 300 次 = ~USD 12/天 = ~USD 360/月。
真擔心被刷爆可以調低 `DAILY_LIMIT` 或在 worker 前套 Cloudflare Rate Limiting。

## 📁 檔案結構

```
.
├── index.html        # UI 結構 + LINE 規則 banner + dialog (settings, camera)
├── app.js            # 全部前端邏輯：auth、splitGrid、chroma-key、IndexedDB 歷史、ZIP
├── styles.css        # LINE 綠 #06c755 配色、所有 component CSS
├── manifest.json     # PWA manifest
└── worker/
    ├── wrangler.toml # KV binding + worker name
    └── src/
        └── index.js  # prompt 組合器、Gemini proxy、auth、quota、CAMPAIGNS、STYLE_PRESETS
```

## 📄 授權

MIT — 自由使用、改、商用。產出的貼圖版權歸**使用者**所有（你只是工具人）。
