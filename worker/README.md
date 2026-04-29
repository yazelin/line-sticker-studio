# line-sticker-gemini (Cloudflare Worker)

Proxy that adds a Vertex AI API key to requests from the static frontend
and returns a 3×3 grid of LINE-sticker style images for one uploaded
character image.

## Deploy

```bash
cd worker

# 1) 一次性：登入 Cloudflare
npx wrangler login

# 2) 建 KV namespace 給每日 AI-quota 計數用，把印出的 id 貼進 wrangler.toml
npx wrangler kv namespace create QUOTA

# 3) 設 secrets
npx wrangler secret put VERTEX_API_KEY     # 跟 emoji-slot-machine 同一把
npx wrangler secret put TURNSTILE_SECRET   # Cloudflare Turnstile secret
npx wrangler secret put ADMIN_TOKEN        # 隨機字串、給 /admin/reset-quota 用

# 4) 部署
npx wrangler deploy
```

**VERTEX_API_KEY** — 不需要另外申請新的。直接貼你 `emoji-slot-machine` worker 用的同一把
Vertex Express API key 就好（Vertex API 配額是綁在 GCP 專案上、不是綁在 Cloudflare worker
上，所以兩個 worker 共用同一把 key 完全 OK，每次呼叫都會記到同一個 GCP 專案的帳單上）。

**TURNSTILE_SECRET / TURNSTILE_SITE_KEY** — 到 [Cloudflare Dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
按「Add site」，網域填你 GitHub Pages 的網域（例：`yazelin.github.io`，本機開發加 `localhost`），widget mode 選 **Managed**（無感人機驗證）。拿到一組：
- **Site key**（公開）→ 改 `src/index.js` 上面的 `TURNSTILE_SITE_KEY` 常數，重 deploy 一次。
- **Secret key**（私）→ `npx wrangler secret put TURNSTILE_SECRET`。

本機開發可以用 Cloudflare 官方測試 key（`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`，永遠驗證通過）。

**ADMIN_TOKEN** — 隨機字串。重設某個 IP 的 quota 時用：
```bash
curl -X POST https://line-sticker-gemini.<sub>.workers.dev/admin/reset-quota \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"ip":"203.0.113.45"}'
```

Wrangler prints something like:
`https://line-sticker-gemini.<your-subdomain>.workers.dev`

Put that URL into the frontend by editing `DEFAULT_API_URL` in `app.js`,
or set it at runtime via the browser console:
```js
localStorage.setItem("line-sticker-api-url", "https://line-sticker-gemini.…workers.dev")
```

## Endpoints

| Method | Path                  | Auth                | Body / Notes                                                                                | Response                                                                              |
| ------ | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST` | `/`                   | Turnstile + IP quota | `{ imageBase64, mimeType, turnstileToken, slots?, styleHint?, withText?, campaign? }`      | `{ mimeType, data, model, phrases, quota }`; 403 if Turnstile fails; 429 if quota exhausted |
| `POST` | `/generate-themes`    | Turnstile + IP quota | `{ description, lang, turnstileToken }`                                                    | `{ phrases, slots }`                                                                  |
| `POST` | `/prompt`             | none                | `{ slots?, styleHint?, withText?, campaign? }`                                              | `{ prompt, phrases }`                                                                 |
| `POST` | `/admin/reset-quota`  | **Bearer ADMIN_TOKEN** | `{ ip? }` — defaults to caller's IP                                                       | `{ ok, ip }`                                                                          |
| `GET`  | `/quota`              | none                | this caller's IP-keyed daily quota                                                          | `{ quota: {used,limit} }`                                                             |
| `GET`  | `/config`             | none                | public config for the frontend                                                              | `{ turnstileSiteKey, dailyLimit }`                                                    |
| `GET`  | `/`                   | none                | health check                                                                                | `{ ok: true }`                                                                        |
| `GET`  | `/phrases`            | none                | default phrase pool with stable ids                                                         | `{ phrases: [{id,label}, ...] }`                                                      |
| `GET`  | `/styles`             | none                | available `styleHint` keys                                                                  | `{ styles: [...] }`                                                                   |
| `GET`  | `/campaigns`          | none                | LINE Creators Market campaign manifest                                                      | `{ campaigns: [...] }`                                                                |

### Request fields

- `imageBase64` *(required)* — raw base64 (no `data:` prefix) of the
  character image. Resize/JPEG-compress on the client to keep it under
  ~7.5 MB.
- `mimeType` — defaults to `image/jpeg`.
- `phrases` — array of Traditional-Chinese short phrases. Worker picks 9
  at random per request and fits each one to a sticker action. If
  omitted, uses the built-in pool of 50.
- `styleHint` — one of: `match` (default — copy reference's art style),
  `cute_chibi`, `bold_outline`, `watercolor`, `pixel`.
- `withText` — `true` (default) prints the phrase on each sticker;
  `false` makes pure-image stickers (frontend can overlay text later).

## Environment

| Key                | Type       | Purpose                                                                  |
| ------------------ | ---------- | ------------------------------------------------------------------------ |
| `VERTEX_API_KEY`   | **Secret** | Vertex AI Express Mode API key                                           |
| `TURNSTILE_SECRET` | **Secret** | Cloudflare Turnstile secret key (paired with `TURNSTILE_SITE_KEY` const) |
| `ADMIN_TOKEN`      | **Secret** | Bearer for `POST /admin/reset-quota`                                     |
| `DEFAULT_MODEL`    | var (opt)  | defaults to `gemini-3.1-flash-image-preview`                             |

## Adding a new LINE campaign

LINE Creators Market 的特輯活動每隔幾週會換一批。新增方式：

1. 編輯 `src/index.js`，往 `CAMPAIGNS = [...]` 陣列尾端加一筆（複製旁邊的當模板）。所有欄位
   說明見既有的 `no_text` / `watery` 範例。
2. `npx wrangler deploy`。
3. 前端會在下次使用者進到 step-config 時自動 `GET /campaigns` 拿到新清單，
   **不用** 重 deploy 前端。

過期的活動可以留在陣列裡（前端會自動把 `submitDeadline < today` 的卡片灰化排到後面）—
也方便日後翻舊帳。

## Cost & rate-limit notes

Gemini image preview models charge per image — at the time of writing,
roughly USD ~0.04 per output. One sticker pack of 24 = 3 worker calls =
~USD 0.12. If you expect high concurrent traffic, either:
- enable a paid quota on the Vertex project,
- expose a "copy prompt" UI so users can run prompts in their own
  gemini.google.com session (frontend has this option built in),
- or front the worker with Cloudflare WAF rate-limiting per IP.
