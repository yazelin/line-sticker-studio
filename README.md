# LINE 貼圖製造機 ｜ LINE Sticker Studio

上傳一張角色圖 → AI 自動產出整組 LINE 貼圖 → 下載 ZIP 後拖去
[LINE Creators Market](https://creator.line.me/zh-hant/) 上架。

支援 LINE 全部套組張數（**8 / 16 / 24 / 32 / 40**）：最小 8 張 1 次
Gemini 呼叫就完成（~USD 0.04、約 50 秒）；大套組用「貼圖池」把多張
3×3 的格子湊起來出。

> 🟢 線上版：<https://yazelin.github.io/line-sticker-studio/>

## 與姊妹專案 emoji-slot-machine 的差異

兩個專案共用**同一套核心引擎**（上傳角色圖 → 打 gemini-web `/api/edit` → 取回
3×3 → 前端拆格），但長成兩個不同產品：

| | 本專案 line-sticker-studio | 姊妹 [emoji-slot-machine](https://github.com/yazelin/emoji-slot-machine) |
|---|---|---|
| 定位 | 靜態 **LINE 貼圖 → 去背 → 上架** | 表情**拉霸 → 動態 reel 影片** |
| 每格內容 | 8 格**可帶文字短語** + 表情，有 AI 主題產短語 | 9 種表情（36 情緒 + 9 天氣隨機配對），**不印文字** |
| 輸出 | **chroma-key 去背 → 透明 PNG → JSZip 打包** → LINE Creators Market 上架 | `MediaRecorder` 錄成 **WebM 拉霸影片** |
| 格數 | 3×3 產 9、取 **8**（LINE 套組） | 3×3 = 9 |
| 人機驗證 | **有 Turnstile** | **無 Turnstile**（靠每日配額 + in-flight 鎖限流） |
| Prompt | LINE 審核合規規則 + 風格轉換 + 每格印字 | 表情 + 天氣配對、強制沿用原圖畫風 |

**共通後端**（兩邊皆已遷移）：Cloudflare Worker → 自架 gemini-web `/api/edit`；
gemini-web 內部先走**免費瀏覽器路**，失敗時自動頂替**官方 Gemini API**（付費、需 key）。
Worker 層有每日配額 5 次/IP + in-flight 鎖 + `AI_DISABLED` 急停開關。

## ✨ 特色

### 兩條輸入路徑

- **🅰 主路徑**：上傳一張角色圖（自拍 / 手繪 / Q 版頭像）讓 AI 產一切
  - **免登入**（Cloudflare Turnstile 無感人機驗證即可）
  - 每天免費 **5 次** AI 生成（per IP、UTC 0 點重置）
- **🅱 替代路徑**：自己用 Gemini 跑好 3×3 圖直接上傳
  - 免登入、免 API 額度、不限次，**可一次選多張 3×3 圖批次匯入**
  - 工具仍會幫你切張、去背、打包成 LINE 規格 ZIP

### 大套組與貼圖池

- **8 / 16 / 24 / 32 / 40 張套組**：LINE 靜態貼圖的五種套組張數全支援。
  一張 3×3 出 9 格，想出大套組就把多張 grid 的格子湊進「貼圖池」——
  歷史區每張 grid 都有「＋」一鍵入池，或 BYOG 一次上傳多張圖自動湊
  （AI 路徑每天 5 次 = 45 格，一天就湊得出 40 張套組）
- **自選主圖 / 聊天室標籤**：每格可指定當 `main.png`（商店門面）或 `tab.png`，不再固定第一張
- **貼圖排序**：每格 ▲▼ 調整順序，決定 ZIP 內 `01…NN` 的上架排列
- **單張放大檢視 + 單張重去背**：點 ⤢ 開放大視窗（棋盤格透明底），
  這張單獨換 key 色 / 強度重跑去背或還原原圖——永遠從原始切圖重算，不疊髒邊
- **單張下載 / 分享**：放大視窗內可存單張透明 PNG，手機直接叫出系統分享面板傳 LINE / IG（做 1 張傳朋友，不必打包 ZIP）

### 上架防呆

- **匯出前透明度檢查**：下載前逐張審計，背景沒去乾淨（LINE 第一大退件原因）的張會被點名警告；單張 >1MB 也會提醒
- **BYOG 背景偵測**：匯入時自動辨識綠幕 / 洋紅幕（自動切 key 色）；不是 chroma 背景會先警告「去背可能失敗」

### 離線可用（PWA）

- 上線開過一次後，**斷網也能用**：匯入圖片 → 切圖 → 去背 → 組包 → 下載 ZIP、歷史庫全程本機
- AI 生成 / 主題產生器 / 複製 prompt 需要網路，離線時會明確停用（不會壞掉）
- 已知取捨：離線時介面字型回落系統字型；首次使用需連線載入一次；iOS 對久未使用的網站可能回收快取，重新上線一次即恢復

### 內容自訂

- **8 格逐格自訂**：每格可固定預設 50 句之一 / 自訂任何語言文字 / 留隨機
- **✨ AI 主題產生器**：描述一個主題（例「上班崩潰」「我家貓」），AI 同時產 8 句短語 + 8 個英文 pose 描述
- **職業/場景快速入口**：上班族、老師、健身教練、貓奴…16 個 chips 一鍵帶入主題，語錄仍由 AI 動態產生
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
- **🤖 Cloudflare Turnstile**：無感人機驗證、防刷 quota
- **⚖ LINE 規則確認 gate**：上傳前必須勾選確認，避免上架被退件

## 🏗 架構

```
┌────────────────────────┐         ┌────────────────────────────┐
│  Static frontend       │  POST   │  Cloudflare Worker         │
│  (GitHub Pages)        ├────────►│  line-sticker-gemini       │
│  index.html / app.js   │  JSON   │  src/index.js              │
│  styles.css            │         │  + VERTEX_API_KEY secret   │
│  + Turnstile widget    │         │  + TURNSTILE_SECRET secret │
│                        │         │  + QUOTA KV namespace      │
│  ↓ split (chroma-key)  │         └────────┬───────────────────┘
│  ↓ fitWithPadding 10px │                  │
│  ↓ JSZip pack          │      ┌───────────┴──────┐
│  ↓ download .zip       │      ▼                  ▼
└────────────────────────┘  ┌────────────┐  ┌──────────────────────┐
                            │ Cloudflare │  │ Vertex AI            │
                            │ Turnstile  │  │ gemini-3.1-flash-    │
                            │ siteverify │  │ image-preview (圖)   │
                            └────────────┘  │ gemini-2.5-flash (字)│
                                            └──────────────────────┘
```

- 前端純靜態，掛 GitHub Pages 免費
- Worker 是 Vertex API 的 proxy + prompt 組合器 + 配額守門員（不存圖、不留 log）
- 配額計數靠 Cloudflare KV，key 是 `quota:<ip>:<UTC date>`（IP 來自 `CF-Connecting-IP`，Cloudflare 自動帶、外部不可偽造），TTL 36h 自清
- 一次 AI 生成 = 1 次 worker call → 1 次 Gemini call → 9 個 sticker tiles（給用戶 9 選 8）

## 🔐 防刷機制

**Cloudflare Turnstile + 每 IP 每日配額 + 並發鎖 + 先扣後跑** — 沒有登入。四道防線疊起來。

### Layer 1：Cloudflare Turnstile（擋機器人）
- 前端載 Turnstile widget（`Managed` mode，多數情況無感），每次 AI 呼叫帶一個 single-use token
- Worker 收到請求 → 打 Cloudflare `siteverify` 驗 token → 通過才往 Vertex 送
- 前端 token 用過自動 reset 並 mint 下一顆，403 時自動重試一次抓 race condition

### Layer 2：每 IP 每日配額（擋一般刷）
- 配額按 `CF-Connecting-IP` 計數（CF 自動帶、外部不可偽造），每天 5 次（`DAILY_LIMIT` 在 worker 開頭可改）
- KV key `quota:<ip>:<UTC date>`，TTL 36h 自清

### Layer 3：每 IP in-flight lock（擋並發狂點）
- 進 worker 第一件事：檢查 KV `inflight:<ip>` 在不在 → 在的話直接 429，不打 Vertex
- TTL 180 秒做 safety net（worker 中途死掉也會自動釋放）
- 沒這層的話：使用者狂點 5 次「生成」，5 個 request 同時飛、各自看到 `used=0`、各自打 Vertex → 燒 5 次錢，quota 卻只 +1（KV 是 last-write-wins、不是 atomic increment）

### Layer 4：先扣後跑（擋假裝沒成功的 abuse）
- 進 worker → 通過 Turnstile + lock + quota check → **馬上 bump quota +1** → 才打 Vertex
- 狂點不等回應沒用，第 6 次就會在 worker 入口 429
- 上游 502/524/連線失敗 → 自動 `decrementQuota` 退回，使用者沒吃虧

### 管理員 reset
- `POST /admin/reset-quota` with `Authorization: Bearer <ADMIN_TOKEN>`，body `{"ip":"x.x.x.x"}` 指定 IP（省略 → 用 caller 的 IP）

> 🚫 **沒驗證路徑也限額？** 故意不做。BYOG 路徑（自己用 Gemini 跑）天生不耗 worker 額度、不限次、無 Turnstile；要 AI 產就過一次無感驗證。

## 🛡 內容合規（LINE Creators Market 退件雷區）

Worker 的 prompt 把 LINE [審核準則](https://creator.line.me/zh-hant/review_guideline/) 12 大類退件原因全部寫進 `CONTENT COMPLIANCE` 區塊，模型生圖時就主動避開：

| 類別 | 擋什麼 |
|---|---|
| A 肖像權 | 真人明星 / 政治人物 / KOL — 強制畫成原創卡通角色 |
| B 版權 IP | Pokemon / Sanrio / Disney / Ghibli / Nintendo / 鬼滅 / 哆啦 A 夢 / Line Friends 自家也禁 / Snoopy / Rilakkuma / Miffy 等 |
| C 商標 | 真 logo（Chanel CC、LV monogram、Gucci GG、Hermès H、Nike swoosh⋯）+ 假 logo 文字（避免 GUVICY / PRADO 等模型幻覺品牌字） |
| C+ 包款 silhouette | 即使無 logo，也避開 Hermès Birkin/Kelly turn-lock 鎖扣、Chanel Classic Flap quilted、LV Speedy/Neverfull、Dior Lady、Prada Galleria 三角牌、Gucci Bamboo、Goyard chevron、Fendi Baguette 等可識別輪廓（依台灣新式樣專利範圍） |
| D 色情 | 露點、貼身、性暗示姿勢 |
| E 暴力 | 血、武器威脅、自殘 |
| F 仇恨 | 種族 / 性別 / 宗教歧視 |
| G 宗教 | 佛像、十字架、可蘭經、神職服飾 |
| H 政治 | 黨徽、政治人物、競選口號 |
| I 毒/酒/賭 | 注射針筒、賭場、大麻葉 |
| J 個資 | 真名、電話、QR code、URL |
| K 醫療詐騙 | 減肥前後對比、療效宣稱 |
| L 兒少/動物 | 兒童不當、虐待動物、條碼 |

**「Compliance > style > theme > user wording」** — 即使使用者 prompt 提到禁項，prompt builder 仍然會覆寫。

> 雖然不能 100% 保證每張都過審（特別是包款 silhouette 是 grey area），但同個 prompt 比沒有 compliance block 之前安全度高 5~10 倍。實際上架被退件的話 LINE 會列具體理由，再針對該張重抽即可。

## 🚀 本地開發

需要 Node.js 18+。

```bash
# Worker（本地 miniflare，不需要 Cloudflare 帳號）
cd worker
npm install
cat > .dev.vars <<'EOF'
VERTEX_API_KEY="貼你 Vertex Express key"
TURNSTILE_SECRET="1x0000000000000000000000000000000AA"
ADMIN_TOKEN="dev-admin-token"
EOF
# 上面的 TURNSTILE_SECRET 是 Cloudflare 官方測試 secret（永遠驗證通過）
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
npx wrangler secret put TURNSTILE_SECRET     # 拿到下一步 (2) 之後再做
npx wrangler secret put ADMIN_TOKEN          # 隨機字串、自己記住就好

# 建配額用的 KV namespace（一次性）
npx wrangler kv namespace create QUOTA
# → 印出類似 { binding = "QUOTA", id = "abc123..." }
# 把 id 貼進 wrangler.toml 對應位置

npx wrangler deploy
# → https://line-sticker-gemini.<subdomain>.workers.dev
```

### 2. Cloudflare Turnstile site

到 [Cloudflare Dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) 按「Add site」：

- **Domain**：你 GitHub Pages 的網域（例 `yazelin.github.io`），本機開發再加一行 `localhost`
- **Widget mode**：選 **Managed**（無感人機驗證）
- 拿到一組 Site Key / Secret Key：
  - **Site Key** 寫進 `worker/src/index.js` 的 `TURNSTILE_SITE_KEY` 常數，重 deploy
  - **Secret Key** `npx wrangler secret put TURNSTILE_SECRET`

### 3. 前端 → GitHub Pages

```bash
git push origin main   # GitHub Pages 從 main branch 自動 deploy
```

如果 worker URL 不是 `line-sticker-gemini.yazelinj303.workers.dev`，改 `app.js` 的 `DEFAULT_API_URL`。

## 💰 成本

| 場景 | 你的成本 |
|---|---|
| 用戶按「開始生成」（AI 路徑） | ~USD 0.04 / IP / 次（最高 5 次/天） |
| AI 主題產生器（gemini-2.5-flash） | ~USD 0.0005 / 次 |
| 用戶按「複製 prompt → 自己到 Gemini 跑 → 回來上傳」| **0** |
| 用戶 BYOG（直接傳自己準備好的 3×3）| **0** |
| 前端去背 / ZIP 打包 / IndexedDB 歷史 | 0（瀏覽器算 + 瀏覽器存） |
| KV 配額讀寫 + Turnstile siteverify | 在 Cloudflare free tier 內 |

最壞情況：100 個 IP 每天用滿 5 次 = 500 次 = ~USD 20/天 = ~USD 600/月。
真擔心被刷爆可以調低 `DAILY_LIMIT` 或在 worker 前套 Cloudflare Rate Limiting。

## 📁 檔案結構

```
.
├── index.html        # UI 結構 + LINE 規則 banner + dialog (settings, camera, tile zoom)
├── app.js            # 全部前端邏輯：auth、splitGrid、chroma-key、貼圖池、IndexedDB 歷史、ZIP
├── styles.css        # LINE 綠 #06c755 配色、所有 component CSS
├── sw.js             # service worker：離線 precache + worker 設定 SWR 快取
├── vendor/jszip.min.js # 本地 JSZip（離線打包用，不走 CDN）
├── manifest.json     # PWA manifest
├── tests/            # Playwright E2E（BYOG 全流程、池、去背、離線）
└── worker/
    ├── wrangler.toml # KV binding + worker name
    └── src/
        └── index.js  # prompt 組合器、Gemini proxy、auth、quota、CAMPAIGNS、STYLE_PRESETS
```

## 🧪 測試

```bash
npm install
npx playwright install chromium   # 第一次
npm test                          # 桌面 + iPhone 模擬雙 project
```

外部依賴（worker API / Turnstile / 字型）在測試中全部 stub，可離線執行。
CI（GitHub Actions）在每個 PR 與 main push 跑全套。

## 📄 授權

MIT — 自由使用、改、商用。產出的貼圖版權歸**使用者**所有（你只是工具人）。
