# LINE 貼圖製造機 ｜ LINE Sticker Studio

上傳一張角色圖 → AI 自動產出整組 LINE 貼圖 → 下載 ZIP 後拖去
[LINE Creators Market](https://creator.line.me/zh-hant/) 上架。

對應 LINE 接受的最小套組（**8 張**），1 次 Gemini 呼叫就完成、
~USD 0.04、約 50 秒。

> 架構參考姊妹工具 [emoji-slot-machine](https://github.com/yazelin/emoji-slot-machine)。

## ✨ 特色

- **雙路徑**：(A) 上傳角色圖讓 AI 產一切；(B) 自己用 Gemini 跑好 3×3 圖丟回來、跳過 AI 步驟（省 API 額度）
- **8 格逐格自訂**：每格可固定預設 50 句之一 / 自訂任何語言文字（中/英/日/混搭/梗圖台詞）/ 留隨機
- **LINE 官方特輯活動 prompt**：自動套對應規則（無字浮誇 / 水水 / 眼淚製造機 / 大臉攻擊 ...）
- **7 種畫風**：跟原圖一致 / Q 版 / 粗線條 / 水彩 / 像素 / **梗圖 IMPACT 字** / 廢文塗鴉
- **單格客製重抽**：點該格可改字再重抽
- **複製 prompt 到 Gemini**：跳過 worker、自己跑省 API 額度
- **客戶端去背**：`@imgly/background-removal` 在瀏覽器跑、原圖不上傳到任何伺服器
- **ZIP 直接符合 LINE 規格**：370×320 貼圖 + 240×240 main + 96×74 tab + 上架說明 README

## 🏗 架構

```
┌────────────────────────┐         ┌──────────────────────────┐
│  Static frontend       │  POST   │  Cloudflare Worker       │
│  (GitHub Pages)        ├────────►│  line-sticker-gemini     │
│  index.html / app.js   │  JSON   │  src/index.js            │
│  styles.css            │         │  + VERTEX_API_KEY secret │
│                        │         └────────┬─────────────────┘
│  ↓ split → preview     │                  │
│  ↓ @imgly bg removal   │                  ▼
│  ↓ JSZip pack          │         ┌──────────────────────────┐
│  ↓ download .zip       │         │  Vertex AI               │
└────────────────────────┘         │  gemini-3.1-flash-image  │
                                   └──────────────────────────┘
```

- 前端純靜態，掛 GitHub Pages 免費
- Worker 只是 Vertex API 的 proxy + prompt 組合器（不存圖、不留 log）
- 單一 request 1 次 worker call → 1 次 Gemini call → 9 個 sticker tiles（用 8 丟 1）

## 🚀 本地開發

需要 Node.js 18+。

```bash
# Worker（本地 miniflare，不需要 Cloudflare 帳號）
cd worker
npm install
echo 'VERTEX_API_KEY="貼你 Vertex Express key"' > .dev.vars
npx wrangler dev --local --port 8787
# Worker 起在 http://127.0.0.1:8787

# 前端（另開 terminal）
cd ..
python3 -m http.server 8765
# 開 http://localhost:8765

# 把前端指向本地 worker（瀏覽器 console 跑一次）
localStorage.setItem('line-sticker-api-url', 'http://127.0.0.1:8787');
```

## ☁️ 部署

### Worker → Cloudflare

```bash
cd worker
npx wrangler login                           # OAuth in browser
npx wrangler secret put VERTEX_API_KEY       # paste your key
npx wrangler deploy
# → https://line-sticker-gemini.<subdomain>.workers.dev
```

> 💡 如果你已經有 [emoji-slot-machine](https://github.com/yazelin/emoji-slot-machine)
> 在跑，**用同一把 Vertex Express API key** 就好（兩個 worker 各自存一份 secret，
> 但值貼一樣的字串）。

### 前端 → GitHub Pages

```bash
git init
git add .
git commit -m "init"
gh repo create line-sticker-studio --public --source=. --remote=origin --push
# 然後到 GitHub Repo Settings → Pages → main branch / root
```

如果 worker URL 不是 `line-sticker-gemini.yazelinj303.workers.dev`，
改 [`app.js`](app.js) 第 11 行的 `DEFAULT_API_URL`。

## 💰 成本

| 場景 | 你的成本 |
|---|---|
| 用戶按「開始生成」（AI 路徑） | ~USD 0.04 / 用戶 |
| 用戶按「複製 prompt → 自己到 Gemini 跑 → 回來上傳」| **0** |
| 用戶 BYOG（直接傳自己準備好的 3×3）| **0** |
| 前端去背 / ZIP 打包 | 0（瀏覽器算） |

如果你怕被白嫖刷爆 quota，前端已經有「複製 prompt」按鈕引導用戶走免費路徑。
真要加防護就在 worker 前面套 Cloudflare Rate Limiting Rules。

## 📄 授權

MIT — 自由使用、改、商用。產出的貼圖版權歸**使用者**所有（你只是工具人）。
