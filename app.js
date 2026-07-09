// LINE Sticker Studio — upload one image, fetch N batches of 3×3 sticker
// grids from the worker, split into individual stickers, optionally
// background-remove client-side, and bundle into a LINE-spec ZIP.

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------
// Config

// ==================================================================
// IndexedDB grid history — stores past 3×3 grids (AI + BYOG) for
// recall, comparison, star/favorite, and rename. Cap 30 non-starred,
// unlimited starred.
// ==================================================================
const IDB_NAME = "line-sticker-history";
// v2 (2026-07-09): projects / fonts / prompts / phraseSets / styles.
// v3 (2026-07-09): stickers — FINISHED single stickers (cleaned + text
// baked into a 370×320 transparent PNG), the studio's中段產出物.
const IDB_VERSION = 3;
const IDB_STORE = "generations";
const IDB_EXTRA_STORES = ["projects", "fonts", "prompts", "phraseSets", "styles", "stickers"];

let _idbPromise = null;
function idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
      for (const name of IDB_EXTRA_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return _idbPromise;
}
function idbTx(mode, fn, storeName = IDB_STORE) {
  return idbOpen().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => res(result);
    tx.onerror = () => rej(tx.error);
  }));
}
// Generic single-record helpers for the studio stores.
async function idbPut(storeName, obj) {
  return idbTx("readwrite", (s) => s.put(obj), storeName);
}
async function idbGetFrom(storeName, id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const req = db.transaction(storeName).objectStore(storeName).get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbAllFrom(storeName) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const req = db.transaction(storeName).objectStore(storeName).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}
async function idbDelFrom(storeName, id) {
  return idbTx("readwrite", (s) => s.delete(id), storeName);
}
async function idbSaveGeneration(entry) {
  return idbTx("readwrite", (s) => s.put(entry));
}
async function idbGetGeneration(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbListGenerations() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}
async function idbDeleteGeneration(id) {
  return idbTx("readwrite", (s) => s.delete(id));
}
async function idbUpdateGeneration(id, patch) {
  const existing = await idbGetGeneration(id);
  if (!existing) return;
  return idbSaveGeneration({ ...existing, ...patch });
}

// Generate a small JPEG thumbnail from a grid blob, for fast list display.
async function generateThumbnail(blob, size = 220) {
  const img = await loadImage(URL.createObjectURL(blob));
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, size, size);
  // COVER-crop, not contain: a portrait BYOG grid used to get gray
  // letterbox bars baked into its thumbnail, so its 3×3 rendered a size
  // smaller than square AI grids on identical cards.
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
}

// One-time thumbnail regeneration (old contain-style thumbs → cover).
async function migrateThumbnailsOnce() {
  const FLAG = "lss-thumbs-cover-v1";
  if (localStorage.getItem(FLAG)) return;
  localStorage.setItem(FLAG, "1");
  try {
    const all = await idbListGenerations();
    for (const e of all) {
      const thumb = await generateThumbnail(e.gridBlob);
      await idbSaveGeneration({ ...e, thumbnailBlob: thumb });
    }
    if (all.length > 0) {
      await renderHistoryUi();
      await renderCurrentGridUi();
    }
  } catch { /* best-effort */ }
}

function genHistoryId() {
  return `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function shortStamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "剛剛";
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  if (s < 604800) return `${Math.floor(s / 86400)} 天前`;
  return new Date(ts).toLocaleDateString();
}

const API_URL_KEY = "line-sticker-api-url";
const SLOT_CONFIG_KEY = "line-sticker-slots";
const DEFAULT_API_URL = "https://line-sticker-gemini.yazelinj303.workers.dev";
const LANG_KEY = "line-sticker-lang";
// Sticker-text language: separate from UI language. Controls (a) the
// language AI uses when brainstorming 8 phrases and (b) the script AI
// uses when rendering text onto the sticker. Default zh-TW (Taiwan).
const TEXT_LANG_KEY = "line-sticker-text-lang";
const SUPPORTED_TEXT_LANGS = ["zh-TW", "zh-CN", "en", "ja", "ko"];
const CHROMA_KEY_PREF = "line-sticker-chroma-key";
const CHROMA_KEYS = {
  green: { label: "綠幕", hex: "#00FF00", rgb: [0, 255, 0] },
  magenta: { label: "洋紅幕", hex: "#FF00FF", rgb: [255, 0, 255] },
};
function loadTextLang() {
  const v = localStorage.getItem(TEXT_LANG_KEY);
  return SUPPORTED_TEXT_LANGS.includes(v) ? v : "zh-TW";
}
function saveTextLang(lang) {
  if (SUPPORTED_TEXT_LANGS.includes(lang)) {
    localStorage.setItem(TEXT_LANG_KEY, lang);
  }
}
function normalizeChromaKey(key) {
  return CHROMA_KEYS[key] ? key : "green";
}
function loadChromaKey() {
  return normalizeChromaKey(localStorage.getItem(CHROMA_KEY_PREF));
}
function saveChromaKey(key) {
  localStorage.setItem(CHROMA_KEY_PREF, normalizeChromaKey(key));
}
function chromaKeyColor(key = state?.chromaKey) {
  return CHROMA_KEYS[normalizeChromaKey(key)];
}

// ------------------------------------------------------------------
// i18n — minimal multi-language for the most visible UI strings.
// Keys are by element id with `data-i18n` attribute, set in HTML.
// Languages: zh-TW (default), zh-CN, en, ja, ko.

const I18N = {
  brand_subtitle: {
    "zh-TW": "上傳一張角色圖 → AI 產一整組貼圖 → 下載 ZIP 直接上架到 LINE Creators Market",
    "zh-CN": "上传一张角色图 → AI 产一整组贴图 → 下载 ZIP 直接上架到 LINE Creators Market",
    "en": "Upload one character image → AI generates a full sticker pack → download ZIP, ready for LINE Creators Market",
    "ja": "1 枚のキャラ画像をアップロード → AI がスタンプ一式を生成 → ZIP をダウンロードして LINE Creators Market へ",
    "ko": "캐릭터 이미지 한 장 업로드 → AI가 스티커 팩 생성 → ZIP 다운로드 → LINE Creators Market 업로드",
  },
  step_a_title: {
    "zh-TW": "主路徑 A：上傳角色圖讓 AI 產（每天 5 次免費，免登入）",
    "zh-CN": "主路径 A：上传角色图让 AI 产（每天 5 次免费，免登入）",
    "en": "Path A: upload a character image, let AI generate (5 free/day, no login)",
    "ja": "メイン A: キャラ画像をアップ、AI に生成させる（1日5回無料、ログイン不要）",
    "ko": "경로 A: 캐릭터 업로드 → AI 생성 (하루 5회 무료, 로그인 불필요)",
  },
  step_b_title: {
    "zh-TW": "替代路徑 B：直接上傳 3×3 圖（省 API、自己跑 Gemini）",
    "zh-CN": "替代路径 B：直接上传 3×3 图（省 API、自己跑 Gemini）",
    "en": "Path B: upload your own 3×3 grid (saves API cost, run Gemini yourself)",
    "ja": "代替 B: 自分で作った 3×3 グリッドをアップ (API節約、Geminiを自分で実行)",
    "ko": "경로 B: 직접 만든 3×3 그리드 업로드 (API 절약, Gemini 직접 실행)",
  },
  step_config_title: {
    "zh-TW": "② 選樣式 + 短語（兩條路徑共用）",
    "zh-CN": "② 选样式 + 短语（两条路径共用）",
    "en": "② Style + phrases (shared by both paths)",
    "ja": "② スタイル + フレーズ (両経路共通)",
    "ko": "② 스타일 + 문구 (양 경로 공통)",
  },
  step_preview_title: {
    "zh-TW": "貼圖池：挑選・去背・排序",
    "zh-CN": "贴图池：挑选・去背・排序",
    "en": "Pool: pick, key-out, arrange",
    "ja": "プール：選択・背景除去・並べ替え",
    "ko": "풀: 선택·배경 제거·정렬",
  },
  step_download_title: {
    "zh-TW": "出貨：檢查 + 下載",
    "zh-CN": "出货：检查 + 下载",
    "en": "Ship: check + download",
    "ja": "出荷：チェック + ダウンロード",
    "ko": "출고: 점검 + 다운로드",
  },
  generate_btn: {
    "zh-TW": "開始生成貼圖",
    "zh-CN": "开始生成贴图",
    "en": "Generate Stickers",
    "ja": "スタンプを生成",
    "ko": "스티커 생성",
  },
  bg_remove_btn: {
    "zh-TW": "一鍵全部去背（整池）",
    "zh-CN": "一键全部去背（整池）",
    "en": "Key out ALL backgrounds (whole pool)",
    "ja": "全タイルの背景を一括除去",
    "ko": "전체 배경 일괄 제거",
  },
  bg_restore_btn: {
    "zh-TW": "還原 Key 底",
    "zh-CN": "还原 Key 底",
    "en": "Restore key bg",
    "ja": "キー背景に戻す",
    "ko": "키 배경 복원",
  },
  download_grid_btn: {
    "zh-TW": "下載原始 grid",
    "zh-CN": "下载原始 grid",
    "en": "Download raw grid",
    "ja": "元のグリッドをダウンロード",
    "ko": "원본 그리드 다운로드",
  },
  download_zip_btn: {
    "zh-TW": "下載 LINE 套組 ZIP（貼圖 + main + tab + 說明）",
    "zh-CN": "下载 LINE 套组 ZIP（贴图 + main + tab + 说明）",
    "en": "Download LINE pack ZIP (stickers + main + tab + README)",
    "ja": "LINE セット ZIP をダウンロード (スタンプ + main + tab + 説明)",
    "ko": "LINE 팩 ZIP 다운로드 (스티커 + main + tab + README)",
  },
  open_camera_btn: {
    "zh-TW": "用相機現拍",
    "zh-CN": "用相机现拍",
    "en": "Use camera",
    "ja": "カメラを使う",
    "ko": "카메라 사용",
  },
  upload_or: {
    "zh-TW": "或", "zh-CN": "或", "en": "or", "ja": "または", "ko": "또는",
  },
  drop_zone_text: {
    "zh-TW": "點擊或拖曳圖片到這裡",
    "zh-CN": "点击或拖曳图片到这里",
    "en": "Click or drop an image here",
    "ja": "クリックまたは画像をドロップ",
    "ko": "클릭하거나 이미지를 드롭",
  },
  grid_drop_zone_text: {
    "zh-TW": "點擊或拖曳「3×3 圖」到這裡",
    "zh-CN": "点击或拖曳「3×3 图」到这里",
    "en": "Click or drop your 3×3 grid here",
    "ja": "3×3 グリッドをクリックまたはドロップ",
    "ko": "3×3 그리드를 클릭하거나 드롭",
  },
};

function getLang() {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored && I18N.brand_subtitle[stored]) return stored;
  const nav = (navigator.language || "zh-TW").toLowerCase();
  if (nav.startsWith("zh-tw") || nav.startsWith("zh-hant")) return "zh-TW";
  if (nav.startsWith("zh")) return "zh-CN";
  if (nav.startsWith("ja")) return "ja";
  if (nav.startsWith("ko")) return "ko";
  if (nav.startsWith("en")) return "en";
  return "zh-TW";
}
let currentLang = getLang();
function t(key) {
  return I18N[key]?.[currentLang] || I18N[key]?.["en"] || key;
}
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const v = t(key);
    if (v) el.textContent = v;
  });
}
function setLang(lang) {
  if (!I18N.brand_subtitle[lang]) return;
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  applyI18n();
  renderThemeChips();
}
const ESTIMATED_GRID_SECONDS = 50; // per 3×3 grid
// LINE Creators Market accepts only 8/16/24/32/40 stickers per pack —
// 8 is the minimum we ship. Gemini gives us a 3×3 grid (9 tiles), so
// we show all 9 and let the user de-select 1 they like least before ZIP.
const GRID_SIZE = 9;
// PACK_SIZE is the GENERATION-side constant: one 3×3 grid carries 8
// user-configurable phrase slots (9th tile = spare). The PACKAGING-side
// pack size is variable — LINE static packs accept 8/16/24/32/40 —
// tracked in state.packSize and fed by pooling multiple grids.
const PACK_SIZE = 8;
const PACK_SIZES = [8, 16, 24, 32, 40];
// One 3×3 grid has 9 cells — ALL of them user-pinnable. (Was 8: the 9th
// cell always got a random phrase the user never asked for. In the pool
// world you pick 8/16/24/32/40 freely, so pin all 9. issue #38)
const SLOT_COUNT = 9;

// Per-slot config persisted in localStorage. length-8 array, each entry:
//   null              → fully random (worker picks)
//   { phraseId: N }   → pin to default-phrase #N
//   { phraseCustom }  → free text
function loadSlotConfig() {
  try {
    const raw = localStorage.getItem(SLOT_CONFIG_KEY);
    if (!raw) return new Array(SLOT_COUNT).fill(null);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Array(SLOT_COUNT).fill(null);
    // Migrate legacy 8-slot configs (and any short array) by padding.
    const cfg = parsed.slice(0, SLOT_COUNT);
    while (cfg.length < SLOT_COUNT) cfg.push(null);
    return cfg;
  } catch {
    return new Array(SLOT_COUNT).fill(null);
  }
}

function saveSlotConfig(cfg) {
  const allRandom = cfg.every((s) => s === null);
  if (allRandom) localStorage.removeItem(SLOT_CONFIG_KEY);
  else localStorage.setItem(SLOT_CONFIG_KEY, JSON.stringify(cfg));
}

// Phrase manifest cache (fetched lazily from worker /phrases on first
// settings open). Each item is { id, label }.
const poolCache = { loaded: false, items: [] };

// ------------------------------------------------------------------
// IP-based daily quota + Cloudflare Turnstile (no LINE login)
//
// Flow:
//   1. On page load we load the Turnstile script (added in index.html);
//      its `onload=onTurnstileApiReady` callback hits window.turnstile,
//      which we use to render an invisible/managed widget in #cf-turnstile.
//   2. The widget's success callback stores a token in `auth.tsToken`.
//      Tokens are single-use, so after every API call we call
//      `turnstile.reset()` to mint a fresh one in the background.
//   3. /generate and /generate-themes both require the token in the
//      request body. Worker calls Cloudflare siteverify before forwarding
//      to Vertex AI. Frontend never holds anything secret.
//   4. Quota is keyed by CF-Connecting-IP on the worker side; we just
//      display whatever `quota` field comes back.

const auth = {
  quota: null,       // { used, limit }
  tsToken: null,     // current Turnstile token (single-use)
  tsWidgetId: null,  // returned by turnstile.render()
  tsSiteKey: null,   // hydrated from worker /config
};

// Wait for a fresh Turnstile token. Resolves immediately if one is
// already cached; otherwise polls every 200 ms until the widget's
// success callback fires (or `timeoutMs` elapses).
function awaitTurnstileToken(timeoutMs = 8000) {
  if (auth.tsToken) return Promise.resolve(auth.tsToken);
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = setInterval(() => {
      if (auth.tsToken) {
        clearInterval(poll);
        resolve(auth.tsToken);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(poll);
        reject(new Error("Turnstile 驗證超時，請重新整理頁面再試。"));
      }
    }, 200);
  });
}

// Mint a new token for the next request. Called after every successful
// API hit (Turnstile tokens are single-use).
function resetTurnstile() {
  auth.tsToken = null;
  if (typeof window !== "undefined" && window.turnstile && auth.tsWidgetId !== null) {
    try { window.turnstile.reset(auth.tsWidgetId); } catch {}
  }
}

// Cross-tab quota sync — when one tab generates / hits 429, broadcast
// the new quota to all other open tabs so their "今日剩 X/N" counter
// stays accurate without polling.
const authBroadcast = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("line-sticker-auth")
  : null;
if (authBroadcast) {
  authBroadcast.onmessage = (e) => {
    if (e.data?.type === "quota-update" && e.data.quota) {
      auth.quota = e.data.quota;
      refreshAuthUi();
    }
  };
}
function broadcastQuota(quota) {
  if (authBroadcast && quota) {
    authBroadcast.postMessage({ type: "quota-update", quota });
  }
}

async function refreshQuota() {
  const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
  try {
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/quota");
    if (!resp.ok) throw new Error(`/quota ${resp.status}`);
    const data = await resp.json();
    auth.quota = data.quota;
  } catch (err) {
    console.warn("refreshQuota failed:", err);
  }
}

async function loadTurnstileConfig() {
  const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
  try {
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/config");
    if (!resp.ok) throw new Error(`/config ${resp.status}`);
    const data = await resp.json();
    auth.tsSiteKey = data.turnstileSiteKey || null;
  } catch (err) {
    console.warn("loadTurnstileConfig failed:", err);
  }
}

// Wait for the Turnstile global to appear, then render the widget.
// We deliberately DON'T use the api.js?onload=fn pattern — Cloudflare's
// script can finish loading before app.js executes, and at that point
// `window.onTurnstileApiReady` is still undefined → it logs a console
// error and skips render → no token ever appears → every /generate
// gets 403'd. Polling is uglier but has no race window.
async function setupTurnstileWidget() {
  if (!auth.tsSiteKey) return; // /config hasn't returned yet — caller will retry
  const started = Date.now();
  while (!window.turnstile) {
    if (Date.now() - started > 10000) {
      console.error("Turnstile script failed to load within 10s");
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (auth.tsWidgetId !== null) return; // already rendered
  auth.tsWidgetId = window.turnstile.render("#cf-turnstile", {
    sitekey: auth.tsSiteKey,
    // Hidden while the check passes non-interactively (the usual case);
    // only surfaces when Cloudflare actually needs the user to interact.
    // NOT the same as hard-hiding a Managed widget (that deadlocks the
    // interactive challenge → 403). No dashboard change needed. issue #39
    appearance: "interaction-only",
    callback: (token) => { auth.tsToken = token; },
    "expired-callback": () => { auth.tsToken = null; },
    "error-callback": () => { auth.tsToken = null; },
  });
}

// Campaign manifest cache (fetched lazily on first config-step open).
const campaignCache = { loaded: false, items: [] };

async function ensureCampaignsLoaded() {
  if (campaignCache.loaded) return;
  try {
    const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/campaigns");
    if (!resp.ok) throw new Error(`/campaigns ${resp.status}`);
    const data = await resp.json();
    campaignCache.items = Array.isArray(data.campaigns) ? data.campaigns : [];
    campaignCache.loaded = true;
  } catch (err) {
    console.warn("campaign list fetch failed", err);
    campaignCache.items = [];
    campaignCache.loaded = true;
  }
}

async function ensurePoolLoaded() {
  if (poolCache.loaded) return;
  try {
    const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/phrases");
    if (!resp.ok) throw new Error(`/phrases ${resp.status}`);
    const data = await resp.json();
    poolCache.items = Array.isArray(data.phrases) ? data.phrases : [];
    poolCache.loaded = true;
  } catch (err) {
    console.warn("phrase pool fetch failed; will retry on next settings open", err);
    poolCache.items = [];
    // Deliberately NOT latching loaded=true: a failed fetch (e.g. first
    // visit raced the SW, or offline before cache warmed) retries the
    // next time the dialog opens, so it self-heals once online.
  }
}

// LINE Creators Market sticker spec
const STICKER_W = 370;
const STICKER_H = 320;
const MAIN_SIZE = 240;
const TAB_W = 96;
const TAB_H = 74;

// ------------------------------------------------------------------
// State

const state = {
  sourceImage: null,     // HTMLImageElement
  sourceFile: null,      // original File (for resize)
  styleHint: "match",
  withText: true,
  textLang: loadTextLang(), // "zh-TW" | "zh-CN" | "en" | "ja" | "ko"
  chromaKey: loadChromaKey(), // "green" | "magenta"
  campaign: null,        // null or campaign id
  slotConfig: loadSlotConfig(), // length-PACK_SIZE
  tiles: [],             // sticker POOL — tiles from one or more grids (makeTile)
  projectId: null,       // active project (autosaved draft); null = unsaved
  projectName: "",
  projectCreatedAt: 0,
  packSize: 8,           // target LINE pack size (8/16/24/32/40)
  mainTile: null,        // tile ref chosen as main.png (null = first included)
  tabTile: null,         // tile ref chosen as tab.png (null = follow main)
  bgRemoved: false,
  removeBackgroundFn: null, // lazy-loaded @imgly/background-removal
  lastGridPng: null,     // raw Gemini 3×3 grid PNG blob (for backup/re-split)
  currentGridId: null,   // IndexedDB id of the currently-loaded grid
};

// ------------------------------------------------------------------
// Step 1 — upload

const fileInput = $("file-input");
const dropZone = $("drop-zone");
const sourcePreview = $("source-preview");
const sourceImg = $("source-img");
const clearBtn = $("clear-btn");

fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
  })
);
dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});
clearBtn.addEventListener("click", resetAll);

// ------------------------------------------------------------------
// Camera capture (getUserMedia → canvas → File → handleFile)

const cameraDialog = $("camera-dialog");
const cameraVideo = $("camera-video");
const cameraPreview = $("camera-preview");
const cameraCanvas = $("camera-canvas");
const cameraError = $("camera-error");
const cameraOpenBtn = $("open-camera-btn");
const cameraCloseBtn = $("camera-close-btn");
const cameraShootBtn = $("camera-shoot-btn");
const cameraRetakeBtn = $("camera-retake-btn");
const cameraUseBtn = $("camera-use-btn");
let cameraStream = null;
let cameraCapturedBlob = null;

cameraOpenBtn?.addEventListener("click", openCamera);
cameraCloseBtn?.addEventListener("click", closeCamera);
cameraShootBtn?.addEventListener("click", shootCamera);
cameraRetakeBtn?.addEventListener("click", retakeCamera);
cameraUseBtn?.addEventListener("click", useCameraShot);

async function openCamera() {
  if (dropZone.classList.contains("locked")) {
    alert("請先勾選最上方的 LINE 規定確認");
    return;
  }
  cameraError.hidden = true;
  cameraPreview.hidden = true;
  cameraVideo.hidden = false;
  cameraShootBtn.hidden = false;
  cameraRetakeBtn.hidden = true;
  cameraUseBtn.hidden = true;
  cameraDialog.showModal();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 1280 }, facingMode: "user" },
    });
    cameraVideo.srcObject = cameraStream;
  } catch (err) {
    cameraError.hidden = false;
    cameraError.textContent = `相機存取失敗：${err.message}。請確認瀏覽器權限。`;
  }
}

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
}

function closeCamera() {
  stopCameraStream();
  cameraDialog.close();
}

function shootCamera() {
  if (!cameraVideo.videoWidth) return;
  const w = cameraVideo.videoWidth;
  const h = cameraVideo.videoHeight;
  cameraCanvas.width = w;
  cameraCanvas.height = h;
  const ctx = cameraCanvas.getContext("2d");
  // Mirror to match the live preview (which is mirrored via CSS).
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(cameraVideo, 0, 0, w, h);
  cameraCanvas.toBlob((blob) => {
    cameraCapturedBlob = blob;
    cameraPreview.src = URL.createObjectURL(blob);
    cameraPreview.hidden = false;
    cameraVideo.hidden = true;
    cameraShootBtn.hidden = true;
    cameraRetakeBtn.hidden = false;
    cameraUseBtn.hidden = false;
  }, "image/png");
}

function retakeCamera() {
  cameraCapturedBlob = null;
  cameraPreview.hidden = true;
  cameraVideo.hidden = false;
  cameraShootBtn.hidden = false;
  cameraRetakeBtn.hidden = true;
  cameraUseBtn.hidden = true;
}

function useCameraShot() {
  if (!cameraCapturedBlob) return;
  const file = new File([cameraCapturedBlob], `camera-${Date.now()}.png`, {
    type: "image/png",
  });
  closeCamera();
  handleFile(file);
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    alert("請上傳圖片檔。");
    return;
  }
  const img = await loadImage(URL.createObjectURL(file));
  state.sourceImage = img;
  state.sourceFile = file;
  sourceImg.src = img.src;
  dropZone.hidden = true;
  sourcePreview.hidden = false;
  refreshEstimate();
  $("step-config").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetAll() {
  state.sourceImage = null;
  state.sourceFile = null;
  state.tiles = [];
  state.mainTile = null;
  state.tabTile = null;
  state.bgRemoved = false;
  fileInput.value = "";
  sourcePreview.hidden = true;
  dropZone.hidden = false;
  $("step-preview").hidden = true;
  $("step-download").hidden = true;
  $("gen-progress").hidden = true;
  $("bg-progress").hidden = true;
  $("stickers-grid").innerHTML = "";
  document.body.classList.remove("byog-mode");
}

// ------------------------------------------------------------------
// Step 2 — config + generate

const styleHintSel = $("style-hint");
const withTextSel = $("with-text");
const textLangSel = $("text-lang");
const chromaKeySel = $("chroma-key");
const generateBtn = $("generate-btn");

if (textLangSel) {
  textLangSel.value = state.textLang;
  textLangSel.addEventListener("change", () => {
    state.textLang = textLangSel.value;
    saveTextLang(state.textLang);
  });
}
function setChromaKey(key, { persist = true } = {}) {
  state.chromaKey = normalizeChromaKey(key);
  if (persist) saveChromaKey(state.chromaKey);
  if (chromaKeySel) chromaKeySel.value = state.chromaKey;
  if (bgKeySelect) bgKeySelect.value = state.chromaKey;
}
if (chromaKeySel) {
  chromaKeySel.value = state.chromaKey;
  chromaKeySel.addEventListener("change", () => setChromaKey(chromaKeySel.value));
}
// Dim the language picker while 無字模式 — text-lang is irrelevant then.
function refreshTextLangAvailability() {
  if (!textLangSel) return;
  const isNoText = withTextSel.value === "false";
  textLangSel.disabled = isNoText;
  textLangSel.parentElement?.classList.toggle("locked", isNoText);
}
withTextSel?.addEventListener("change", refreshTextLangAvailability);
const genProgress = $("gen-progress");
const genBarFill = $("gen-bar-fill");
const genProgressText = $("gen-progress-text");
const estimateEl = $("estimate");

function refreshEstimate() {
  estimateEl.innerHTML =
    `預估：<strong>1</strong> 次 API 呼叫、約 <strong>${ESTIMATED_GRID_SECONDS}</strong> 秒，產出 <strong>${GRID_SIZE}</strong> 格 LINE 規格貼圖（370 × 320，預設打包 ${PACK_SIZE} 張、可入池湊大套組）。`;
}

generateBtn.addEventListener("click", () => generateAll());

// Toggle the custom style input when user picks "✏️ 自訂…".
styleHintSel.addEventListener("change", () => {
  const wrap = $("style-custom-wrap");
  if (!wrap) return;
  wrap.hidden = styleHintSel.value !== "__custom__";
  if (!wrap.hidden) $("style-custom-input")?.focus();
});

// Pull style / withText / chroma from the live controls into state. Both
// generateAll and the BYOG copy-prompt button call this so the copied prompt
// always matches what the user currently sees — without it, copy read stale
// state (e.g. withText from a previous run) and the per-cell text vanished.
// Returns "" on success, or an error message to surface to the user.
function syncConfigFromControls() {
  // styleHint: if user picked __custom__, use the free-form text verbatim.
  if (styleHintSel.value === "__custom__") {
    const customStyle = $("style-custom-input")?.value.trim();
    if (!customStyle || customStyle.length < 2) {
      return "請填入至少 2 個字的風格描述（例：「梵谷風」「cyberpunk」）";
    }
    state.styleHint = customStyle;
  } else if (styleHintSel.value.startsWith("saved:")) {
    state.styleHint = styleHintSel.value.slice(6);
  } else {
    state.styleHint = styleHintSel.value;
  }
  state.withText = withTextSel.value === "true";
  setChromaKey(chromaKeySel?.value || state.chromaKey);
  return "";
}

async function generateAll() {
  if (!state.sourceImage) return;
  const styleErr = syncConfigFromControls();
  if (styleErr) { alert(styleErr); return; }
  if (auth.quota && auth.quota.used >= auth.quota.limit) {
    showQuotaExceededModal();
    return;
  }
  if (!confirmPoolReplace()) return;
  state.tiles = [];
  state.mainTile = null;
  state.tabTile = null;
  state.bgRemoved = false;
  startNewProjectIdentity();

  const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;

  generateBtn.disabled = true;
  genProgress.hidden = false;
  setGenProgress(2, "縮圖中…");

  // Resize source to 1280px max so worker stays under 7.5 MB.
  const { base64, mimeType } = await fileToResizedBase64(
    state.sourceFile,
    1280,
  );

  $("step-preview").hidden = false;
  const grid = $("stickers-grid");
  grid.innerHTML = "";
  for (let i = 0; i < GRID_SIZE; i++) {
    grid.appendChild(buildPlaceholderCell(i));
  }
  // Stay HERE while generating — the progress bar lives in this tab.
  // 產料完成後和 BYOG 上傳一樣回素材庫(P1:產出物先進倉庫)。

  const callStart = Date.now();
  const ticker = setInterval(() => {
    const elapsed = (Date.now() - callStart) / 1000;
    const pct = Math.min(95, (elapsed / ESTIMATED_GRID_SECONDS) * 100);
    const remain = Math.max(0, Math.ceil(ESTIMATED_GRID_SECONDS - elapsed));
    setGenProgress(
      pct,
      `Gemini 作畫中… 已 ${Math.ceil(elapsed)}s，預估還有約 ${remain}s`,
    );
  }, 500);

  try {
    let tsToken;
    try { tsToken = await awaitTurnstileToken(); }
    catch (err) {
      clearInterval(ticker);
      setGenProgress(0, err.message);
      return;
    }
    const result = await fetchGrid(apiUrl, {
      imageBase64: base64,
      mimeType,
      slots: state.slotConfig,
      styleHint: state.styleHint,
      withText: state.withText,
      chromaKey: state.chromaKey,
      campaign: state.campaign,
      lang: state.textLang,
      turnstileToken: tsToken,
    });
    clearInterval(ticker);

    const gridImg = await loadImage(
      `data:${result.mimeType};base64,${result.data}`,
    );
    // Save raw grid as Blob for backup-download / future re-splitting.
    const binStr = atob(result.data);
    const binBytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) binBytes[i] = binStr.charCodeAt(i);
    state.lastGridPng = new Blob([binBytes], { type: result.mimeType });
    showGridDownload();
    // Persist to history (IndexedDB) — appears in 🅱 carousel + current preview.
    await saveCurrentGridToHistory("ai", {
      styleHint: state.styleHint,
      campaign: state.campaign,
      withText: state.withText,
      chromaKey: state.chromaKey,
      phrases: result.phrases,
    });
    const tiles = await splitGrid(gridImg, state.chromaKey);
    // Gemini gives 9 tiles. LINE only accepts 8 per pack, so we show all
    // 9 and pre-select the first 8 — user can swap which one to drop.
    for (let i = 0; i < GRID_SIZE; i++) {
      state.tiles.push(makeTile(tiles[i], {
        phrase: result.phrases?.[i] || "",
        included: i < PACK_SIZE,
        srcGridId: state.currentGridId,
        srcIdx: i,
        srcKey: tiles.key,
      }));
    }
    renderPool();

    setGenProgress(100, `完成！產出 ${GRID_SIZE} 格，已存入素材庫。`);
    $("step-download").hidden = false;
    showToast("AI 生成完成，已存入素材庫；9 格也已進貼圖池",
      { label: "→ 去打包", onClick: () => switchTab("pack") });
    switchTab("assets");
  } catch (err) {
    clearInterval(ticker);
    console.error(err, err.detail ? `detail=${err.detail}` : "");
    if (err.code === "AI_DISABLED") {
      setGenProgress(0, err.detail || "AI 生成暫停中，請走 BYOG 自己跑。");
      showByogHandoff(err.detail);
    } else if (err.code === "QUOTA_EXCEEDED") {
      setGenProgress(0, `今日 ${auth.quota?.limit || 5} 次免費 AI 生成已用完`);
      showQuotaExceededModal();
    } else if (err.code === "INFLIGHT") {
      setGenProgress(0, "上一個生成還在跑，等它完成或失敗再點。狂點不會更快、會被擋。");
    } else if (err.code === "TURNSTILE_FAILED") {
      const reason = err.detail ? `（${err.detail}）` : "";
      setGenProgress(0, `人機驗證失敗${reason}，重新整理頁面再試一次。`);
    } else if (/\b524\b|timeout/i.test(err.message)) {
      setGenProgress(0,
        `Gemini 太慢沒回應（524 timeout）— 你的 quota 沒被扣，直接再按一次「開始生成」就好。85% 機率立刻成功。`,
      );
    } else if (/\b502\b|upstream/i.test(err.message)) {
      setGenProgress(0,
        `Vertex AI 上游錯誤（502）— 你的 quota 沒被扣，等 30 秒再按「開始生成」。`,
      );
    } else {
      setGenProgress(0, `失敗：${err.message}`);
    }
  } finally {
    generateBtn.disabled = false;
  }
}

function showQuotaExceededModal() {
  showByogHandoff(`今天的 ${auth.quota?.limit || 5} 次 AI 生成已用完`);
}

// Hand off to the free BYOG path. The critical, easy-to-miss step is that the
// reference image must be attached in Gemini/ChatGPT alongside the prompt —
// the prompt alone won't reproduce the user's character.
function showByogHandoff(headline) {
  const proceed = confirm(
    (headline ? headline + "\n\n" : "") +
    "免費替代方案：自己到 gemini.google.com 或 ChatGPT 跑，再把 3×3 圖丟到 BYOG 上傳框。\n\n" +
    "關鍵步驟（少了就生不出你的角色）：\n" +
    "  1. 複製 prompt\n" +
    "  2. 在 Gemini／ChatGPT「先上傳你的參考圖」，再貼上 prompt\n" +
    "     —— prompt 是描述「對這張圖做什麼」，沒附圖 prompt 就無從套用\n" +
    "  3. 下載它產的 3×3 圖，回來上傳\n\n" +
    "→ 確定：開「自訂 9 格」dialog 複製 prompt\n" +
    "→ 取消：直接捲到 BYOG 上傳框",
  );
  if (proceed) {
    openSettings();
  } else {
    switchTab("create");
    $("step-byog").scrollIntoView({ behavior: "smooth", block: "start" });
    $("step-byog").classList.add("flash-highlight");
    setTimeout(() => $("step-byog").classList.remove("flash-highlight"), 2000);
  }
}

function setGenProgress(pct, text) {
  genBarFill.style.width = `${pct}%`;
  genProgressText.textContent = text;
}

async function fetchGrid(apiUrl, body) {
  // Single auto-retry on Turnstile 403: the most common failure is
  // "timeout-or-duplicate" — the token got consumed by a parallel call
  // (e.g. the user fired theme-gen while waiting). A fresh token from
  // the widget normally fixes it without the user noticing.
  const sendOnce = async (turnstileToken) => fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, turnstileToken }),
  });

  let resp = await sendOnce(body.turnstileToken);
  resetTurnstile();
  if (resp.status === 403) {
    let firstReason = "";
    try { firstReason = (await resp.clone().json())?.detail || ""; } catch {}
    // Wait for the widget to mint a new token, then try once more.
    let freshToken;
    try { freshToken = await awaitTurnstileToken(8000); }
    catch {
      const e = new Error("TURNSTILE_FAILED");
      e.code = "TURNSTILE_FAILED";
      e.detail = firstReason || "no fresh token after reset";
      throw e;
    }
    resp = await sendOnce(freshToken);
    resetTurnstile();
    if (resp.status === 403) {
      let secondReason = firstReason;
      try { secondReason = (await resp.clone().json())?.detail || firstReason; } catch {}
      const e = new Error("TURNSTILE_FAILED");
      e.code = "TURNSTILE_FAILED";
      e.detail = secondReason;
      throw e;
    }
  }
  if (resp.status === 429) {
    let payload = {};
    try { payload = await resp.json(); } catch {}
    auth.quota = payload.quota || auth.quota;
    refreshAuthUi();
    broadcastQuota(payload.quota);
    // Worker returns two flavors of 429:
    //   { error: "in flight" }            → another request is still running
    //   { error: "daily quota exceeded" } → out of free generations today
    const isInflight = payload?.error === "in flight";
    const e = new Error(isInflight ? "INFLIGHT" : "QUOTA_EXCEEDED");
    e.code = isInflight ? "INFLIGHT" : "QUOTA_EXCEEDED";
    e.payload = payload;
    throw e;
  }
  if (resp.status === 503) {
    let payload = {};
    try { payload = await resp.json(); } catch {}
    if (payload?.hint === "byog") {
      const e = new Error("AI_DISABLED");
      e.code = "AI_DISABLED";
      e.detail = payload.message || "";
      throw e;
    }
  }
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${detail.slice(0, 300)}`);
  }
  const json = await resp.json();
  if (json.quota) {
    auth.quota = json.quota;
    refreshAuthUi();
    broadcastQuota(json.quota);
  }
  return json;
}

// ------------------------------------------------------------------
// BYOG (Bring Your Own Grid) — user uploaded a 3×3 image they generated
// themselves (free to them, free to operator). We skip the worker call
// entirely, just split → preview → ZIP.

const gridFileInput = $("grid-file-input");
const gridDropZone = $("grid-drop-zone");

gridFileInput.addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  queuePoolOp(() => handleGridUploads(files));
});
["dragenter", "dragover"].forEach((ev) =>
  gridDropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    gridDropZone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  gridDropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    gridDropZone.classList.remove("dragover");
  })
);
gridDropZone.addEventListener("drop", (e) => {
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) queuePoolOp(() => handleGridUploads(files));
});

// Entry for the BYOG input — 1 file keeps the classic replace flow;
// multiple files bulk-load into the pool and auto-pick the biggest
// LINE pack size that fits (拍板: 批次匯入是池的第一級來源).
async function handleGridUploads(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
  if (files.length === 0) {
    alert("請傳圖片檔");
    return;
  }
  if (files.length === 1) return handleGridUpload(files[0]);

  if (!confirmPoolReplace()) { gridFileInput.value = ""; return; }
  state.sourceFile = null;
  state.tiles = [];
  state.mainTile = null;
  state.tabTile = null;
  state.bgRemoved = false;
  startNewProjectIdentity();
  document.body.classList.add("byog-mode");

  for (const file of files) {
    const img = await loadImage(URL.createObjectURL(file));
    state.lastGridPng = file;
    await saveCurrentGridToHistory("byog", {
      fileName: file.name,
      aspectRatio: img.naturalWidth / img.naturalHeight,
      chromaKey: state.chromaKey,
    });
    const tiles = await splitGrid(img); // per-file corner detection
    for (let i = 0; i < tiles.length; i++) {
      state.tiles.push(makeTile(tiles[i], {
        included: false,
        srcGridId: state.currentGridId,
        srcIdx: i,
        srcKey: tiles.key,
      }));
    }
  }
  // Auto-fit pack size, pre-select from the front.
  state.packSize = bestPackSizeFor(state.tiles.length);
  state.tiles.forEach((t, i) => { t.included = i < state.packSize; });

  $("step-preview").hidden = false;
  $("step-download").hidden = false;
  renderPool();
  gridFileInput.value = "";
  showToast(`已存入素材庫 ${files.length} 張；${state.tiles.length} 格已進貼圖池、套組張數自動設 ${state.packSize}`,
    { label: "→ 去打包", onClick: () => switchTab("pack") });
  switchTab("assets");
}

// Sample the 4 corner patches of an uploaded grid and classify the
// backdrop: "green" | "magenta" | "#rrggbb" (unknown solid-ish color).
// BYOG uploads with a non-chroma background are the #1 cause of opaque
// stickers → LINE rejection, so we warn (or auto-pick the right key)
// at import time instead of letting the user find out after upload.
function detectGridKeyColor(img) {
  const P = 8; // patch size
  const c = document.createElement("canvas");
  c.width = P * 2;
  c.height = P * 2;
  const ctx = c.getContext("2d");
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  // 4 corners → 4 quadrants of a 16×16 canvas.
  ctx.drawImage(img, 0, 0, P, P, 0, 0, P, P);
  ctx.drawImage(img, w - P, 0, P, P, P, 0, P, P);
  ctx.drawImage(img, 0, h - P, P, P, 0, P, P, P);
  ctx.drawImage(img, w - P, h - P, P, P, P, P, P, P);
  const d = ctx.getImageData(0, 0, P * 2, P * 2).data;
  let r = 0, g = 0, b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]; g += d[i + 1]; b += d[i + 2];
  }
  r /= n; g /= n; b /= n;
  const greenScore = (g - Math.max(r, b)) / 255;
  const magentaScore = (Math.min(r, b) - g) / 255;
  if (greenScore > 0.25) return "green";
  if (magentaScore > 0.25) return "magenta";
  const hex = "#" + [r, g, b]
    .map((v) => Math.round(v).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return hex;
}

// Heuristic: did background removal actually bite on this sticker?
// Two failure signatures (both = LINE's #1 rejection reason):
//   a. zero transparent pixels anywhere (e.g. user restored the raw tile)
//   b. the opaque region is a near-uniform-colored CARD — a white/solid
//      backdrop that chroma-key couldn't touch. Detected by walking the
//      opaque bbox perimeter: a card has ~every perimeter pixel opaque
//      in one flat color; a properly keyed character only touches the
//      bbox edge at a few extremes.
// (A plain "fully opaque" check is not enough: splitGrid fills the
// contain-fit padding bars with the key color, so even a white-bg grid
// ends up with transparent bars after keying.)
function tileBackgroundNotRemoved(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const d = canvas.getContext("2d").getImageData(0, 0, w, h).data;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  let anyTransparent = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = d[(y * w + x) * 4 + 3];
      if (a < 255) anyTransparent = true;
      if (a > 32) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!anyTransparent) return true;      // signature (a)
  if (maxX < minX) return false;         // fully transparent tile — other checks handle

  // Walk the bbox perimeter, collect opaque pixels + their colors.
  const perim = [];
  const pushIf = (x, y) => {
    const i = (y * w + x) * 4;
    if (d[i + 3] > 32) perim.push([d[i], d[i + 1], d[i + 2]]);
  };
  let perimTotal = 0;
  for (let x = minX; x <= maxX; x++) { pushIf(x, minY); pushIf(x, maxY); perimTotal += 2; }
  for (let y = minY + 1; y < maxY; y++) { pushIf(minX, y); pushIf(maxX, y); perimTotal += 2; }
  if (perimTotal === 0) return false;
  const opaqueFrac = perim.length / perimTotal;
  if (opaqueFrac < 0.85) return false;

  let mr = 0, mg = 0, mb = 0;
  for (const [r, g, b] of perim) { mr += r; mg += g; mb += b; }
  mr /= perim.length; mg /= perim.length; mb /= perim.length;
  let dev = 0;
  for (const [r, g, b] of perim) {
    dev += Math.abs(r - mr) + Math.abs(g - mg) + Math.abs(b - mb);
  }
  dev /= perim.length * 3;
  return dev < 18;                        // signature (b): uniform card
}

async function handleGridUpload(file) {
  if (!file || !file.type.startsWith("image/")) {
    alert("請傳圖片檔");
    return;
  }
  const img = await loadImage(URL.createObjectURL(file));
  // Backdrop sanity check — auto-switch key color when the grid clearly
  // uses the other chroma plate; warn when it's neither (white/photo bg).
  const detected = detectGridKeyColor(img);
  let uploadNote = "";
  if (detected === "green" || detected === "magenta") {
    if (detected !== state.chromaKey) {
      setChromaKey(detected, { persist: false });
      uploadNote = `偵測到${CHROMA_KEYS[detected].label}背景，已自動切換 key 色。`;
    }
  } else {
    uploadNote = `來源背景色 ${detected} 看起來不是綠幕/洋紅幕 — 去背可能失敗，LINE 上架需要透明背景。`;
  }
  const ratio = img.naturalWidth / img.naturalHeight;
  if (ratio < 0.85 || ratio > 1.18) {
    if (
      !confirm(
        `這張圖長寬比 ${ratio.toFixed(2)} 看起來不像 3×3 圖（應該是正方形）。還是要當 3×3 圖切嗎？`,
      )
    ) {
      gridFileInput.value = "";
      return;
    }
  }

  if (!confirmPoolReplace()) { gridFileInput.value = ""; return; }

  // BYOG mode: discard any AI-mode source so reroll is correctly disabled.
  state.sourceFile = null;
  state.tiles = [];
  state.mainTile = null;
  state.tabTile = null;
  state.bgRemoved = false;
  startNewProjectIdentity();
  document.body.classList.add("byog-mode");

  // Save the uploaded file as the current grid + add to history.
  state.lastGridPng = file;
  await saveCurrentGridToHistory("byog", {
    fileName: file.name,
    aspectRatio: img.naturalWidth / img.naturalHeight,
    chromaKey: state.chromaKey,
  });

  $("step-preview").hidden = false;
  const grid = $("stickers-grid");
  grid.innerHTML = "";
  for (let i = 0; i < GRID_SIZE; i++) grid.appendChild(buildPlaceholderCell(i));

  const tiles = await splitGrid(img, state.chromaKey);
  for (let i = 0; i < GRID_SIZE; i++) {
    state.tiles.push(makeTile(tiles[i], {
      included: i < PACK_SIZE,
      srcGridId: state.currentGridId,
      srcIdx: i,
      srcKey: tiles.key,
    }));
  }
  renderPool();
  $("step-download").hidden = false;
  showToast(`${uploadNote}已存入素材庫；9 格也已進貼圖池`,
    { label: "→ 去打包", onClick: () => switchTab("pack") });
  switchTab("assets");
}

// ------------------------------------------------------------------
// Tile model — every tile keeps its pristine split (`originalCanvas`);
// cleaning ALWAYS recomputes from that original (never re-keys an
// already-keyed result — despill would stack into dirty edges).

function makeTile(canvas, { phrase = "", included = false, srcGridId = null, srcIdx = -1, srcStickerId = null, srcKey = null } = {}) {
  return {
    canvas,                  // current pixels (may be cleaned)
    originalCanvas: canvas,  // pristine split — the only cleanup input
    srcStickerId,            // set when this tile IS a finished sticker
    srcKey,                  // this grid's own backdrop (green|magenta)
    transparent: false,
    cleanParams: null,       // { key, tune } when cleaned
    textParams: null,        // text overlay (issue #8)
    srcGridId,               // history/asset grid this tile came from
    srcIdx,                  // 0-8 position inside that grid
    phrase,
    busy: false,
    included,
    _url: null,              // cached toDataURL of `canvas`
  };
}

function tileDataUrl(tile) {
  if (!tile._url) tile._url = composeTile(tile).toDataURL("image/png");
  return tile._url;
}

// ------------------------------------------------------------------
// Text layer (issue #8) — text is a per-tile PARAMETER, composited at
// preview/export time. Never baked into tile.canvas, so edits are free.

const TEXT_DEFAULTS = {
  text: "",
  font: '"Noto Sans TC"',
  sizePct: 18,           // % of tile width
  color: "#1f2d24",
  strokeColor: "#ffffff",
  strokePct: 18,         // stroke width as % of font size
  anchor: "hor_bottom",  // preset position; x/y (free drag) overrides
  x: null,               // 0-100 (% of width) — free position
  y: null,
  rotate: 0,             // degrees, -90..90 — tilted text is cute
  layer: "above",        // "above" | "below" the character
};

function ensureTextParams(tile) {
  if (!tile.textParams) tile.textParams = { ...TEXT_DEFAULTS };
  return tile.textParams;
}

function textIsVertical(tp) {
  return tp.anchor?.startsWith("ver") || tp.verticalFree === true;
}

// Compute the draw origin + alignment for a text params object.
function textLayout(tp, w, h) {
  const margin = Math.round(w * 0.06);
  if (tp.x != null && tp.y != null) {
    return { x: (tp.x / 100) * w, y: (tp.y / 100) * h, align: "center", baseline: "middle" };
  }
  switch (tp.anchor) {
    case "hor_tl": return { x: margin, y: margin, align: "left", baseline: "top" };
    case "hor_top": return { x: w / 2, y: margin, align: "center", baseline: "top" };
    case "hor_tr": return { x: w - margin, y: margin, align: "right", baseline: "top" };
    case "hor_bl": return { x: margin, y: h - margin, align: "left", baseline: "bottom" };
    case "hor_br": return { x: w - margin, y: h - margin, align: "right", baseline: "bottom" };
    case "ver_tl": return { x: margin + (w * tp.sizePct) / 200, y: margin, align: "center", baseline: "top" };
    case "ver_tr": return { x: w - margin - (w * tp.sizePct) / 200, y: margin, align: "center", baseline: "top" };
    case "hor_bottom":
    default: return { x: w / 2, y: h - margin, align: "center", baseline: "bottom" };
  }
}

function drawTileText(ctx, tp, w, h) {
  const px = Math.max(8, (w * tp.sizePct) / 100);
  const lines = String(tp.text).split("\n").filter((l, i, a) => l !== "" || i < a.length - 1);
  if (lines.length === 0) return;
  ctx.save();
  ctx.font = `900 ${px}px ${tp.font}, "Noto Sans TC", sans-serif`;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.fillStyle = tp.color;
  ctx.strokeStyle = tp.strokeColor;
  ctx.lineWidth = (px * tp.strokePct) / 100;
  const pos = textLayout(tp, w, h);
  // Rotate the whole text block around its anchor point.
  ctx.translate(pos.x, pos.y);
  ctx.rotate(((tp.rotate || 0) * Math.PI) / 180);
  ctx.textAlign = pos.align;
  const paint = (str, x, y) => {
    if (ctx.lineWidth > 0.1) ctx.strokeText(str, x, y);
    ctx.fillText(str, x, y);
  };
  if (textIsVertical(tp)) {
    // Each line = one vertical column; columns run right→left (直書慣例),
    // except ver_tl which grows rightward from the left edge.
    const colW = px * 1.15;
    const dir = tp.anchor === "ver_tl" ? 1 : -1;
    ctx.textAlign = "center";
    ctx.textBaseline = pos.baseline === "bottom" ? "bottom" : (pos.baseline === "middle" ? "middle" : "top");
    lines.forEach((line, li) => {
      const chars = Array.from(line);
      const xoff = (tp.x != null)
        ? (li - (lines.length - 1) / 2) * -colW           // free pos: center the block
        : li * dir * colW;
      let yStart = 0;
      if (pos.baseline === "bottom") yStart = -(chars.length - 1) * px * 1.08;
      if (pos.baseline === "middle") yStart = -((chars.length - 1) * px * 1.08) / 2;
      chars.forEach((ch, ci) => paint(ch, xoff, yStart + ci * px * 1.08));
    });
  } else {
    const lineH = px * 1.15;
    const total = (lines.length - 1) * lineH;
    ctx.textBaseline = pos.baseline;
    let yStart = 0;
    if (pos.baseline === "bottom") yStart = -total;
    if (pos.baseline === "middle") yStart = -total / 2;
    lines.forEach((line, li) => paint(line, 0, yStart + li * lineH));
  }
  ctx.restore();
}

// Rough text bbox for the 10px LINE-margin hint (not for export gating).
function textBounds(tp, w, h) {
  const px = Math.max(8, (w * tp.sizePct) / 100);
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `900 ${px}px ${tp.font}, "Noto Sans TC", sans-serif`;
  const pos = textLayout(tp, w, h);
  const lines = String(tp.text).split("\n");
  let tw, th;
  if (textIsVertical(tp)) {
    const maxChars = Math.max(...lines.map((l) => Array.from(l).length), 1);
    tw = lines.length * px * 1.15;
    th = maxChars * px * 1.08;
  } else {
    tw = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
    th = lines.length * px * 1.15;
  }
  let left = pos.align === "left" ? 0 : pos.align === "right" ? -tw : -tw / 2;
  let top = pos.baseline === "top" ? 0 : pos.baseline === "bottom" ? -th : -th / 2;
  const pad = (px * tp.strokePct) / 200;
  // Corners relative to the anchor, rotated, then shifted to canvas space.
  const rad = ((tp.rotate || 0) * Math.PI) / 180;
  const cosr = Math.cos(rad), sinr = Math.sin(rad);
  const corners = [
    [left - pad, top - pad], [left + tw + pad, top - pad],
    [left - pad, top + th + pad], [left + tw + pad, top + th + pad],
  ].map(([x, y]) => [pos.x + x * cosr - y * sinr, pos.y + x * sinr + y * cosr]);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

function composeTile(tile) {
  const tp = tile.textParams;
  if (!tp || !tp.text) return tile.canvas;
  const w = tile.canvas.width;
  const h = tile.canvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (tp.layer === "below") {
    drawTileText(ctx, tp, w, h);
    ctx.drawImage(tile.canvas, 0, 0);
  } else {
    ctx.drawImage(tile.canvas, 0, 0);
    drawTileText(ctx, tp, w, h);
  }
  return out;
}

async function cleanTile(tile, { key, tune } = {}) {
  const useKey = normalizeChromaKey(key || tile.srcKey || state.chromaKey);
  const useTune = tune || bgTuneSelect?.value || "balanced";
  tile.canvas = await bgRemoveWithTextPreserve(tile.originalCanvas, useTune, useKey);
  tile.transparent = true;
  tile.cleanParams = { key: useKey, tune: useTune };
  tile._url = null;
}

function restoreTile(tile) {
  const c = document.createElement("canvas");
  c.width = tile.originalCanvas.width;
  c.height = tile.originalCanvas.height;
  c.getContext("2d").drawImage(tile.originalCanvas, 0, 0);
  tile.canvas = c;
  tile.transparent = false;
  tile.cleanParams = null;
  tile._url = null;
}

// ------------------------------------------------------------------
// Grid splitting

// Inset each tile's crop region by this fraction on each side. Gemini's
// 3×3 grid lines aren't pixel-perfect — a tight 1/3 crop sometimes
// catches a sliver of the neighbor cell. 3% inset = ~20px on a 683px
// tile, enough to dodge bleed without losing the character.
const SPLIT_INSET_RATIO = 0.03;

async function splitGrid(img, keyName = null) {
  // Which backdrop does THIS grid use? Explicit metadata wins; otherwise
  // detect from the corners. The old behavior (whatever the GLOBAL key
  // happened to be at split time) painted green padding bars onto
  // magenta grids the moment you pooled them from history.
  let key = normalizeChromaKey(keyName);
  if (!keyName) {
    const det = detectGridKeyColor(img);
    key = (det === "green" || det === "magenta") ? det : state.chromaKey;
  }
  const tileW = Math.floor(img.naturalWidth / 3);
  const tileH = Math.floor(img.naturalHeight / 3);
  const insetX = Math.round(tileW * SPLIT_INSET_RATIO);
  const insetY = Math.round(tileH * SPLIT_INSET_RATIO);
  const out = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = STICKER_W;
      tileCanvas.height = STICKER_H;
      const tctx = tileCanvas.getContext("2d");
      // Fill with the selected chroma-key color so downstream removal
      // catches the unfilled padding (left/right 25px when contain-fitting
      // a square cell into landscape 370×320). Was: white — which chroma
      // key didn't recognize → showed up as opaque white bars.
      tctx.fillStyle = CHROMA_KEYS[key].hex;
      tctx.fillRect(0, 0, STICKER_W, STICKER_H);

      // Crop with inset on each side, then contain-fit the cropped
      // region into 370×320 (landscape rectangle). Centered.
      const sx = c * tileW + insetX;
      const sy = r * tileH + insetY;
      const sw = tileW - 2 * insetX;
      const sh = tileH - 2 * insetY;
      const scale = Math.min(STICKER_W / sw, STICKER_H / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const dx = (STICKER_W - dw) / 2;
      const dy = (STICKER_H - dh) / 2;
      tctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      out.push(tileCanvas);
    }
  }
  out.key = key; // callers read which backdrop was used
  return out;
}

// ------------------------------------------------------------------
// Preview cells

function buildPlaceholderCell(idx) {
  const cell = document.createElement("div");
  cell.className = "sticker-cell placeholder";
  cell.dataset.num = String(idx + 1).padStart(2, "0");
  cell.dataset.idx = String(idx);
  return cell;
}

function renderTileIntoCell(idx, tile) {
  const grid = $("stickers-grid");
  const cell = grid.children[idx];
  if (!cell) return;
  cell.classList.remove("placeholder");
  cell.classList.toggle("excluded", !tile.included);
  cell.classList.toggle("is-main", state.mainTile === tile);
  cell.classList.toggle("is-tab", state.tabTile === tile);
  cell.dataset.num = String(idx + 1).padStart(2, "0");
  cell.dataset.idx = String(idx);
  cell.innerHTML = "";
  // Art area: NOTHING overlays the sticker itself.
  const art = document.createElement("div");
  art.className = "tile-art";
  const img = document.createElement("img");
  img.src = tileDataUrl(tile);
  img.alt = `sticker ${idx + 1}`;
  img.draggable = false;
  img.addEventListener("dragstart", (e) => e.preventDefault());
  art.appendChild(img);
  cell.appendChild(art);

  // Info bar below the art: number · main/tab badges · include toggle.
  const bar = document.createElement("div");
  bar.className = "tile-bar";
  const num = document.createElement("span");
  num.className = "tile-num";
  num.textContent = String(idx + 1).padStart(2, "0");
  bar.appendChild(num);
  if (tile.srcStickerId) {
    const fin = document.createElement("span");
    fin.className = "tile-badge tile-badge-final";
    fin.textContent = "稿";
    fin.title = "已定稿的成品(在素材庫可 re-edit,會同步回這格)";
    bar.appendChild(fin);
  }
  if (state.mainTile === tile) {
    const b = document.createElement("span");
    b.className = "tile-badge";
    b.textContent = "主圖";
    bar.appendChild(b);
  }
  if (state.tabTile === tile) {
    const b = document.createElement("span");
    b.className = "tile-badge";
    b.textContent = "標籤";
    bar.appendChild(b);
  }
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tile-include-toggle";
  toggle.title = tile.included ? "點掉 = 從打包中排除這張" : "勾起 = 納入打包";
  toggle.textContent = tile.included ? "✓" : "✗";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleIncluded(idx);
  });
  bar.appendChild(toggle);
  cell.appendChild(bar);

  // The image itself is the whole interaction surface:
  //   click / tap        → zoom dialog (download, main/tab, reroll, text…)
  //   drag (long-press on touch) → reorder within the pool
  img.style.cursor = "zoom-in";
  attachTileDragAndZoom(cell, img, idx);
}

// ------------------------------------------------------------------
// Drag-to-reorder + click-to-zoom on one pointer surface (issue: the
// old per-tile button bar covered the artwork and clipped on narrow
// cells). Mouse: drag past a small threshold lifts the tile. Touch:
// long-press (350ms) lifts, so normal scrolling still works.

let _justDragged = false;

function attachTileDragAndZoom(cell, img, idx) {
  let startX = 0, startY = 0, tracking = false, lifted = false;
  let pressTimer = null;
  const THRESH = 8;

  const onDocMove = (ev) => {
    ev.preventDefault();
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const over = el?.closest?.(".sticker-cell");
    if (over && over !== cell && over.parentElement === cell.parentElement) {
      const grid = cell.parentElement;
      const kids = [...grid.children];
      const from = kids.indexOf(cell);
      const to = kids.indexOf(over);
      if (from > -1 && to > -1) {
        grid.insertBefore(cell, from < to ? over.nextSibling : over);
      }
    }
  };

  const onDocUp = () => {
    document.removeEventListener("pointermove", onDocMove);
    document.removeEventListener("pointerup", onDocUp);
    document.removeEventListener("pointercancel", onDocUp);
    if (!lifted) return;
    lifted = false;
    tracking = false;
    cell.classList.remove("dragging");
    // Commit the DOM order back into state.tiles (dataset.idx holds the
    // pre-drag index of every cell).
    const grid = cell.parentElement;
    const order = [...grid.children].map((c) => Number(c.dataset.idx));
    state.tiles = order.map((i) => state.tiles[i]);
    _justDragged = true;
    setTimeout(() => { _justDragged = false; }, 0);
    renderPool();
  };

  // Lift = the drag session starts. Move/up handling shifts to the
  // DOCUMENT: after insertBefore the pointer is over OTHER cells, and
  // (unlike setPointerCapture) document listeners also work for
  // synthetic pointer events in tests.
  const lift = () => {
    if (lifted) return;
    lifted = true;
    cell.classList.add("dragging");
    document.addEventListener("pointermove", onDocMove);
    document.addEventListener("pointerup", onDocUp);
    document.addEventListener("pointercancel", onDocUp);
  };

  img.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    tracking = true;
    lifted = false;
    startX = ev.clientX;
    startY = ev.clientY;
    if (ev.pointerType === "touch" && state.tiles.length > 1) {
      pressTimer = setTimeout(lift, 350);
    }
  });

  img.addEventListener("pointermove", (ev) => {
    if (!tracking || lifted) return;
    const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
    if (ev.pointerType === "touch") {
      // Moving before the long-press fires = the user is scrolling.
      if (dist > THRESH && pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
        tracking = false;
      }
      return;
    }
    if (dist > THRESH && state.tiles.length > 1) lift();
  });

  const stopTracking = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    tracking = false;
  };
  img.addEventListener("pointerup", stopTracking);
  img.addEventListener("pointercancel", stopTracking);

  img.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_justDragged) return;
    openTileDialog(Number(cell.dataset.idx));
  });
}

// ------------------------------------------------------------------
// Tile zoom dialog — per-sticker inspect + re-key/restore (issue #6)

const tileDialog = $("tile-dialog");
const tileDialogImg = $("tile-dialog-img");
const tileDialogTitle = $("tile-dialog-title");
const tileDialogStatus = $("tile-dialog-status");
const tileKeySelect = $("tile-key-select");
const tileTuneSelect = $("tile-tune-select");
const tileCleanBtn = $("tile-clean-btn");
const tileRestoreBtn = $("tile-restore-btn");
let tileDialogIdx = -1;
// Detached mode (issue: 素材庫直通編輯器 / 成品 re-edit): the editor works
// on a tile that is NOT in the pool. Pool-only controls hide themselves.
let editorDetachedTile = null;
let editorDetachedTitle = "";

// --- Editor history (undo/redo) — parameter-level snapshots ---
let _hist = [];
let _histIdx = -1;
let _histTextTimer = null;

function snapOf(tile) {
  return JSON.stringify({
    clean: tile.cleanParams || null,
    text: tile.textParams || null,
  });
}

function refreshHistoryButtons() {
  const u = $("tile-undo");
  const r = $("tile-redo");
  if (u) u.disabled = _histIdx <= 0;
  if (r) r.disabled = _histIdx >= _hist.length - 1;
}

function historyReset(tile) {
  _hist = [snapOf(tile)];
  _histIdx = 0;
  refreshHistoryButtons();
}

function historyPush() {
  const tile = editorTile();
  if (!tile) return;
  const snap = snapOf(tile);
  if (snap === _hist[_histIdx]) return;
  _hist = _hist.slice(0, _histIdx + 1);
  _hist.push(snap);
  _histIdx = _hist.length - 1;
  refreshHistoryButtons();
}

function historyPushDebounced() {
  clearTimeout(_histTextTimer);
  _histTextTimer = setTimeout(historyPush, 450);
}

async function applyHistorySnap(snapStr) {
  const tile = editorTile();
  if (!tile || tile.busy) return;
  tile.busy = true;
  try {
    const snap = JSON.parse(snapStr);
    if (snap.clean) {
      await cleanTile(tile, snap.clean);
    } else if (tile.cleanParams) {
      restoreTile(tile);
    }
    tile.textParams = snap.text ? { ...TEXT_DEFAULTS, ...snap.text } : null;
    tile._url = null;
    refreshEditorCell();
    refreshTileDialog();
    syncTextPanelFromTile(tile);
    syncAdvSliders(tile);
    refreshTextMarginWarn(tile);
    if (editorInPool()) scheduleProjectSave();
  } finally {
    tile.busy = false;
  }
}

async function historyStep(delta) {
  const target = _histIdx + delta;
  if (target < 0 || target >= _hist.length) return;
  _histIdx = target;
  refreshHistoryButtons();
  await applyHistorySnap(_hist[_histIdx]);
}

function editorTile() {
  return editorDetachedTile || state.tiles[tileDialogIdx];
}
function editorInPool() {
  return editorDetachedTile === null;
}
function refreshEditorCell() {
  if (editorInPool() && editorTile()) {
    renderTileIntoCell(tileDialogIdx, editorTile());
  }
}
function setEditorPoolControlsHidden(hidden) {
  for (const id of ["tile-prev", "tile-next", "tile-include-btn",
    "tile-set-main-btn", "tile-set-tab-btn"]) {
    const el = $(id);
    if (el) el.hidden = hidden;
  }
  if (hidden) { const r = $("tile-reroll-btn"); if (r) r.hidden = true; }
}

function openDetachedEditor(tile, title) {
  editorDetachedTile = tile;
  editorDetachedTitle = title || "素材編輯";
  tileDialogIdx = -1;
  setEditorPoolControlsHidden(true);
  tileKeySelect.value = tile.cleanParams?.key || tile.srcKey || state.chromaKey;
  tileTuneSelect.value = (typeof tile.cleanParams?.tune === "string" && tile.cleanParams.tune) || "balanced";
  if (tileShareBtn) tileShareBtn.hidden = typeof navigator.canShare !== "function";
  refreshTileDialog();
  syncTextPanelFromTile(tile);
  syncAdvSliders(tile);
  refreshTextMarginWarn(tile);
  historyReset(tile);
  if (!tileDialog.open) tileDialog.showModal();
}

tileDialog?.addEventListener("close", () => {
  editorDetachedTile = null;
  editorDetachedTitle = "";
  setEditorPoolControlsHidden(false);
});

function openTileDialog(idx) {
  editorDetachedTile = null;
  editorDetachedTitle = "";
  setEditorPoolControlsHidden(false);
  const tile = state.tiles[idx];
  if (!tile || !tileDialog) return;
  tileDialogIdx = idx;
  // Seed controls from this tile's own params, falling back to globals.
  tileKeySelect.value = tile.cleanParams?.key || tile.srcKey || state.chromaKey;
  tileTuneSelect.value = tile.cleanParams?.tune || bgTuneSelect?.value || "balanced";
  if (tileShareBtn) tileShareBtn.hidden = typeof navigator.canShare !== "function";
  refreshTileDialog();
  syncTextPanelFromTile(tile);
  syncAdvSliders(tile);
  refreshTextMarginWarn(tile);
  historyReset(tile);
  if (!tileDialog.open) tileDialog.showModal();
}

function refreshTileDialog() {
  const tile = editorTile();
  if (!tile) return;
  tileDialogImg.src = tileDataUrl(tile);
  tileDialogTitle.textContent = editorInPool()
    ? `第 ${String(tileDialogIdx + 1).padStart(2, "0")} / ${String(state.tiles.length).padStart(2, "0")} 張`
    : editorDetachedTitle;
  const incBtn = $("tile-include-btn");
  if (incBtn) {
    incBtn.textContent = tile.included ? "✓ 已選入" : "✗ 未選入";
    incBtn.classList.toggle("off", !tile.included);
  }
  $("tile-set-main-btn")?.classList.toggle("active", state.mainTile === tile);
  $("tile-set-tab-btn")?.classList.toggle("active", state.tabTile === tile);
  const rerollBtn = $("tile-reroll-btn");
  if (rerollBtn) rerollBtn.hidden = !state.sourceFile;
  if (tileCleanBtn) {
    tileCleanBtn.textContent = tile.cleanParams ? "重新去背（只這張）" : "去背（只這張）";
  }
  if (tile.cleanParams) {
    const keyLabel = CHROMA_KEYS[tile.cleanParams.key]?.label || tile.cleanParams.key;
    const t = tile.cleanParams.tune;
    const tuneLabel = typeof t === "object" ? "自訂細調"
      : ({ safe: "保守", balanced: "標準", aggressive: "積極" }[t] || t);
    tileDialogStatus.textContent = `狀態：已去背（${keyLabel}・${tuneLabel}）`;
  } else {
    tileDialogStatus.textContent = "狀態：原始切圖（未去背）";
  }
}

tileCleanBtn?.addEventListener("click", async () => {
  const tile = editorTile();
  if (!tile || tile.busy) return;
  tile.busy = true;
  tileCleanBtn.disabled = true;
  try {
    await cleanTile(tile, {
      key: tileKeySelect.value,
      tune: tileTuneSelect.value,
    });
    if (editorInPool()) renderPool();
    refreshTileDialog();
    historyPush();
  } finally {
    tile.busy = false;
    tileCleanBtn.disabled = false;
  }
});

tileRestoreBtn?.addEventListener("click", () => {
  const tile = editorTile();
  if (!tile) return;
  restoreTile(tile);
  if (editorInPool()) renderPool();
  refreshTileDialog();
  historyPush();
});

// --- Advanced chroma fine-tuning (issue #7) ---
const ADV_FIELDS = [
  ["adv-hard", "hard"], ["adv-soft", "soft"], ["adv-minkey", "minKey"],
  ["adv-dominance", "dominance"], ["adv-erode", "erode"],
];

function advProfileFromSliders() {
  const p = {};
  for (const [id, key] of ADV_FIELDS) p[key] = Number($(id).value);
  p.maxOther = Math.round(110 + (p.dominance - 1.7) * -60); // follow dominance loosely
  return p;
}

function syncAdvSliders(tile) {
  const base = (tile.cleanParams && typeof tile.cleanParams.tune === "object")
    ? tile.cleanParams.tune
    : { ...resolveChromaTuneProfile(tileTuneSelect?.value || "balanced"), erode: 1 };
  const set = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  set("adv-hard", base.hard);
  set("adv-soft", base.soft);
  set("adv-minkey", base.minKey);
  set("adv-dominance", base.dominance);
  set("adv-erode", base.erode ?? 1);
}

let _advTimer = null;
function scheduleAdvApply() {
  clearTimeout(_advTimer);
  _advTimer = setTimeout(async () => {
    const tile = editorTile();
    if (!tile || tile.busy) return;
    tile.busy = true;
    try {
      await cleanTile(tile, { key: tileKeySelect.value, tune: advProfileFromSliders() });
      if (editorInPool()) renderPool();
      refreshTileDialog();
      historyPush();
    } finally {
      tile.busy = false;
    }
  }, 250);
}
for (const [id] of ADV_FIELDS) {
  $(id)?.addEventListener("input", scheduleAdvApply);
}
$("tile-adv-reset")?.addEventListener("click", () => {
  const tile = editorTile();
  if (!tile) return;
  // Back to the preset profile of the current strength dropdown.
  tile.cleanParams = null;
  syncAdvSliders(tile);
  scheduleAdvApply();
});

$("tile-dialog-close")?.addEventListener("click", () => tileDialog.close());
$("tile-dialog-x")?.addEventListener("click", () => tileDialog.close());

// --- Editor navigation: flip through the whole pool without closing ---
function navTile(delta) {
  if (!editorInPool() || state.tiles.length === 0) return;
  const n = state.tiles.length;
  openTileDialog((tileDialogIdx + delta + n) % n);
}
$("tile-prev")?.addEventListener("click", () => navTile(-1));
$("tile-next")?.addEventListener("click", () => navTile(1));
$("tile-undo")?.addEventListener("click", () => historyStep(-1));
$("tile-redo")?.addEventListener("click", () => historyStep(1));
tileDialog?.addEventListener("keydown", (e) => {
  // Don't hijack keys while typing text or sliding a range control.
  const t = e.target;
  const tag = t?.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
  if (e.key === "ArrowLeft") { e.preventDefault(); navTile(-1); }
  if (e.key === "ArrowRight") { e.preventDefault(); navTile(1); }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
    e.preventDefault(); historyStep(-1);
  }
  if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")) {
    e.preventDefault(); historyStep(1);
  }
});
$("tile-save-sticker-btn")?.addEventListener("click", async () => {
  const tile = editorTile();
  if (!tile) return;
  const composed = composeTile(tile);
  // 定稿守門:背景沒去乾淨的成品 = 未來每個套組的退件地雷。
  if (tileBackgroundNotRemoved(composed)) {
    const ok = confirm(
      "注意：這張的背景疑似還沒去乾淨（LINE 上架會被退件）。\n\n" +
      "→ 確定：仍要定稿成成品\n→ 取消：先去背再定稿",
    );
    if (!ok) return;
  }
  const blob = await canvasToBlob(composed, "image/png");
  const id = tile.srcStickerId || `stk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const existing = tile.srcStickerId ? await idbGetFrom("stickers", tile.srcStickerId) : null;
  await idbPut("stickers", {
    id,
    name: existing?.name || null,
    tag: existing?.tag || null,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    srcGridId: tile.srcGridId ?? existing?.srcGridId ?? null,
    srcIdx: tile.srcIdx ?? existing?.srcIdx ?? -1,
    cleanParams: tile.cleanParams || null,
    textParams: tile.textParams || null,
    pngBlob: blob,
  });
  // P2: single source of truth — pool slots bound to this sticker (and,
  // when saving FROM a pool tile, that tile itself) now carry the baked
  // finished PNG.
  const bakeInto = (t) => {
    const c = document.createElement("canvas");
    c.width = composed.width;
    c.height = composed.height;
    c.getContext("2d").drawImage(composed, 0, 0);
    t.canvas = c;
    t.originalCanvas = c;
    t.transparent = true;
    t.cleanParams = null;
    t.textParams = null;
    t.srcStickerId = id;
    t._url = null;
  };
  if (editorInPool()) bakeInto(tile);
  for (const t of state.tiles) {
    if (t !== tile && t.srcStickerId === id) bakeInto(t);
  }
  renderPool();
  if (editorInPool() || editorDetachedTile) {
    refreshTileDialog();
    syncTextPanelFromTile(editorTile());
  }
  await renderStickerLibrary();
  await renderHistoryUi();
  showToast(editorInPool()
    ? "已定稿成成品，池中這格已連結成品（之後 re-edit 成品會同步）"
    : "已定稿存入素材庫「成品貼圖」— 隨時可挑進任何套組");
});

$("tile-include-btn")?.addEventListener("click", () => {
  toggleIncluded(tileDialogIdx);
  refreshTileDialog();
});
// Backdrop click closes too — the bottom close button needed scrolling
// on short screens. e.target === dialog only for clicks OUTSIDE the
// content wrapper (.tile-dialog-body).
tileDialog?.addEventListener("click", (e) => {
  if (e.target === tileDialog) tileDialog.close();
});
$("tile-set-main-btn")?.addEventListener("click", () => {
  const tile = editorTile();
  if (!tile) return;
  setMainTile(tile);
  refreshTileDialog();
});
$("tile-set-tab-btn")?.addEventListener("click", () => {
  const tile = editorTile();
  if (!tile) return;
  setTabTile(tile);
  refreshTileDialog();
});
$("tile-reroll-btn")?.addEventListener("click", () => {
  tileDialog.close();
  promptRerollTile(tileDialogIdx);
});

// --- Text layer controls (issue #8) ---
const BUILTIN_FONTS = [
  { label: "Noto Sans TC（預設）", family: '"Noto Sans TC"' },
  { label: "M PLUS Rounded 1c（圓體）", family: '"M PLUS Rounded 1c"' },
  { label: "系統黑體", family: "system-ui" },
  { label: "系統明體", family: "serif" },
  { label: "手寫感（系統）", family: "cursive" },
];
const uploadedFonts = new Map(); // family → true
const localFontFamilies = [];

function rebuildFontSelect(selected) {
  const sel = $("text-font");
  if (!sel) return;
  sel.innerHTML = "";
  const g1 = document.createElement("optgroup");
  g1.label = "內建";
  for (const f of BUILTIN_FONTS) g1.appendChild(new Option(f.label, f.family));
  sel.appendChild(g1);
  if (uploadedFonts.size > 0) {
    const g2 = document.createElement("optgroup");
    g2.label = "上傳字型";
    for (const fam of uploadedFonts.keys()) g2.appendChild(new Option(fam.replace(/"/g, ""), fam));
    sel.appendChild(g2);
  }
  if (localFontFamilies.length > 0) {
    const g3 = document.createElement("optgroup");
    g3.label = "本機字型";
    for (const fam of localFontFamilies) g3.appendChild(new Option(fam, `"${fam}"`));
    sel.appendChild(g3);
  }
  if (selected) sel.value = selected;
  if (!sel.value) sel.value = BUILTIN_FONTS[0].family;
}

async function registerUploadedFont(name, blob) {
  const family = `"${name}"`;
  const face = new FontFace(name, await blob.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  uploadedFonts.set(family, true);
  return family;
}

async function loadStoredFonts() {
  try {
    const all = await idbAllFrom("fonts");
    for (const f of all) {
      try { await registerUploadedFont(f.name, f.blob); } catch { /* corrupt font — skip */ }
    }
  } catch { /* store missing pre-upgrade */ }
  rebuildFontSelect();
}

$("text-font-file")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  const status = $("text-font-status");
  if (!file) return;
  const name = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, "").replace(/["\\]/g, "").trim() || "uploaded-font";
  try {
    const family = await registerUploadedFont(name, file);
    await idbPut("fonts", { id: name, name, blob: file });
    rebuildFontSelect(family);
    applyTextInput({ font: family });
    if (status) { status.hidden = false; status.textContent = `已載入字型「${name}」（已存進瀏覽器，下次還在）`; }
  } catch (err) {
    if (status) { status.hidden = false; status.textContent = `字型載入失敗：${err.message || "檔案不是有效字型"}`; }
  }
  e.target.value = "";
});

$("text-local-fonts")?.addEventListener("click", async () => {
  const status = $("text-font-status");
  try {
    const fonts = await window.queryLocalFonts();
    const seen = new Set(localFontFamilies);
    for (const f of fonts) {
      if (!seen.has(f.family)) { seen.add(f.family); localFontFamilies.push(f.family); }
    }
    localFontFamilies.sort((a, b) => a.localeCompare(b));
    rebuildFontSelect($("text-font").value);
    if (status) { status.hidden = false; status.textContent = `已列出 ${localFontFamilies.length} 個本機字型（只在本機合成，不會上傳）`; }
  } catch (err) {
    if (status) { status.hidden = false; status.textContent = `讀取本機字型失敗：${err.message}`; }
  }
});

// Apply a partial patch to the CURRENT dialog tile's text params, then
// refresh that one cell + the dialog preview + autosave.
function applyTextInput(patch) {
  const tile = editorTile();
  if (!tile) return;
  const tp = ensureTextParams(tile);
  Object.assign(tp, patch);
  tile._url = null;
  refreshEditorCell();
  refreshTileDialogPreviewOnly();
  refreshTextMarginWarn(tile);
  scheduleProjectSave();
  historyPushDebounced();
}

function refreshTileDialogPreviewOnly() {
  const tile = editorTile();
  if (tile) tileDialogImg.src = tileDataUrl(tile);
}

// Scale the 10px (canvas-space) safe inset into on-screen pixels and
// paint it as a dashed frame ON the preview — no scrolling down to a
// text warning to know you're out of bounds.
function updateSafeGuide(tile) {
  const g = $("tile-safe-guide");
  if (!g || !tileDialogImg) return;
  const cw = tile?.canvas.width || STICKER_W;
  const ch = tile?.canvas.height || STICKER_H;
  const dw = tileDialogImg.clientWidth;
  const dh = tileDialogImg.clientHeight;
  if (!dw || !dh) return;
  const ix = (10 * dw) / cw;
  const iy = (10 * dh) / ch;
  g.style.left = `${ix}px`;
  g.style.top = `${iy}px`;
  g.style.right = `${ix}px`;
  g.style.bottom = `${iy}px`;
}

function refreshTextMarginWarn(tile) {
  const warn = $("text-margin-warn");
  const guide = $("tile-safe-guide");
  if (!warn) return;
  updateSafeGuide(tile);
  const tp = tile.textParams;
  if (!tp || !tp.text) {
    warn.hidden = true;
    guide?.classList.remove("violate");
    return;
  }
  const w = tile.canvas.width;
  const h = tile.canvas.height;
  const b = textBounds(tp, w, h);
  const out = b.left < 10 || b.top < 10 || b.right > w - 10 || b.bottom > h - 10;
  warn.hidden = !out;
  guide?.classList.toggle("violate", out);
}
tileDialogImg?.addEventListener("load", () => updateSafeGuide(editorTile()));
window.addEventListener("resize", () => {
  if (tileDialog?.open) updateSafeGuide(editorTile());
});

function syncTextPanelFromTile(tile) {
  const tp = tile.textParams || TEXT_DEFAULTS;
  $("text-content").value = tp.text || "";
  rebuildFontSelect(tp.font);
  $("text-size").value = tp.sizePct;
  const rot = $("text-rotate");
  if (rot) rot.value = tp.rotate || 0;
  $("text-stroke").value = tp.strokePct;
  $("text-color").value = tp.color;
  $("text-stroke-color").value = tp.strokeColor;
  $("text-layer-below").checked = tp.layer === "below";
  document.querySelectorAll("#text-anchors button").forEach((b) =>
    b.classList.toggle("selected", tp.x == null && b.dataset.anchor === tp.anchor));
  $("text-local-fonts").hidden = !("queryLocalFonts" in window);
  refreshTextMarginWarn(tile);
}

$("text-content")?.addEventListener("input", (e) => applyTextInput({ text: e.target.value }));
$("text-font")?.addEventListener("change", (e) => applyTextInput({ font: e.target.value }));
$("text-size")?.addEventListener("input", (e) => applyTextInput({ sizePct: Number(e.target.value) }));
$("text-rotate")?.addEventListener("input", (e) => applyTextInput({ rotate: Number(e.target.value) }));
$("text-rotate")?.addEventListener("dblclick", (e) => { e.target.value = 0; applyTextInput({ rotate: 0 }); });
$("text-stroke")?.addEventListener("input", (e) => applyTextInput({ strokePct: Number(e.target.value) }));
$("text-color")?.addEventListener("input", (e) => applyTextInput({ color: e.target.value }));
$("text-stroke-color")?.addEventListener("input", (e) => applyTextInput({ strokeColor: e.target.value }));
$("text-layer-below")?.addEventListener("change", (e) =>
  applyTextInput({ layer: e.target.checked ? "below" : "above" }));
document.querySelectorAll("#text-anchors button").forEach((b) =>
  b.addEventListener("click", () => {
    applyTextInput({ anchor: b.dataset.anchor, x: null, y: null });
    document.querySelectorAll("#text-anchors button").forEach((x) =>
      x.classList.toggle("selected", x === b));
  }));

// Free drag: pointer on the zoom image moves the text to any spot.
(() => {
  const img = tileDialogImg;
  if (!img) return;
  let dragging = false;
  const toPct = (ev) => {
    const r = img.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)),
      y: Math.min(100, Math.max(0, ((ev.clientY - r.top) / r.height) * 100)),
    };
  };
  // Kill the browser's native image drag-and-drop — it hijacks the
  // pointer after a few px of movement (translucent ghost image) and the
  // text stops following. Click-to-place still works; drag now stays ours.
  img.addEventListener("dragstart", (ev) => ev.preventDefault());
  img.addEventListener("pointerdown", (ev) => {
    const tile = editorTile();
    if (!tile?.textParams?.text) return;
    ev.preventDefault();
    dragging = true;
    img.classList.add("dragging-text");
    try { img.setPointerCapture(ev.pointerId); } catch { /* synthetic events */ }
    const p = toPct(ev);
    applyTextInput({ x: p.x, y: p.y });
    document.querySelectorAll("#text-anchors button").forEach((x) => x.classList.remove("selected"));
  });
  img.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const p = toPct(ev);
    applyTextInput({ x: p.x, y: p.y });
  });
  const stop = () => { dragging = false; img.classList.remove("dragging-text"); };
  img.addEventListener("pointerup", stop);
  img.addEventListener("pointercancel", stop);
})();
$("tile-single-dl-btn")?.addEventListener("click", async () => {
  const tile = editorTile();
  if (!tile) return;
  const blob = await canvasToBlob(composeTile(tile), "image/png");
  triggerDownload(blob, `sticker-${editorInPool() ? String(tileDialogIdx + 1).padStart(2, "0") : "edit"}.png`);
});
const tileShareBtn = $("tile-share-btn");
tileShareBtn?.addEventListener("click", async () => {
  const tile = editorTile();
  if (!tile) return;
  const blob = await canvasToBlob(composeTile(tile), "image/png");
  const name = editorInPool()
    ? `sticker-${String(tileDialogIdx + 1).padStart(2, "0")}.png`
    : "sticker-edit.png";
  const file = new File([blob], name, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (err) { if (err?.name === "AbortError") return; }
  }
  triggerDownload(blob, file.name);
});

function toggleIncluded(idx) {
  const tile = state.tiles[idx];
  if (!tile) return;
  // If user is trying to INCLUDE this one but the pack is already full,
  // prompt to swap (or bump the pack size).
  const currentlyIncluded = state.tiles.filter((t) => t.included).length;
  if (!tile.included && currentlyIncluded >= state.packSize) {
    alert(
      `已經選滿 ${state.packSize} 張了。先取消另一張，或把上方「LINE 套組張數」調大（16/24/32/40）。`,
    );
    return;
  }
  tile.included = !tile.included;
  renderTileIntoCell(idx, tile);
  refreshSelectionStatus();
}

function refreshSelectionStatus() {
  const sel = $("selection-status");
  if (!sel) return;
  const n = state.packSize;
  const included = state.tiles.filter((t) => t.included).length;
  if (included === n) {
    sel.textContent = `已選 ${n}/${n} 張，可以下載 ZIP`;
    sel.className = "selection-status ready";
  } else if (included < n) {
    sel.textContent = `還差 ${n - included} 張才能打包（目前 ${included}/${n}）` +
      (state.tiles.length < n ? ` — 池裡只有 ${state.tiles.length} 格，從歷史按「＋」再加一張 grid` : "");
    sel.className = "selection-status short";
  } else {
    sel.textContent = `多選了 ${included - n} 張（最多 ${n}）`;
    sel.className = "selection-status over";
  }
  renderPackSizeChips();
  scheduleProjectSave();
}

// ------------------------------------------------------------------
// Sticker pool — pack-size chips, append-from-history / multi-upload,
// reorder, main/tab pickers. (issues #4 / #5)

function renderPackSizeChips() {
  const wrap = $("pack-size-chips");
  if (!wrap) return;
  if (wrap.childElementCount === 0) {
    for (const n of PACK_SIZES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pack-size-chip";
      b.dataset.size = String(n);
      b.textContent = String(n);
      b.addEventListener("click", () => setPackSize(n));
      wrap.appendChild(b);
    }
  }
  wrap.querySelectorAll(".pack-size-chip").forEach((b) => {
    b.classList.toggle("selected", Number(b.dataset.size) === state.packSize);
  });
}

function setPackSize(n) {
  if (!PACK_SIZES.includes(n)) return;
  state.packSize = n;
  // Auto-top-up: if fewer tiles are selected than the new target, fill
  // from the front of the pool (user can still swap afterwards).
  let included = state.tiles.filter((t) => t.included).length;
  if (included < n) {
    for (const t of state.tiles) {
      if (included >= n) break;
      if (!t.included) { t.included = true; included++; }
    }
    renderPool();
  } else {
    refreshSelectionStatus();
  }
}

// Largest LINE pack size that fits `count` tiles (min 8).
function bestPackSizeFor(count) {
  let best = PACK_SIZES[0];
  for (const n of PACK_SIZES) if (n <= count) best = n;
  return best;
}

// Re-render the whole pool grid from state.tiles.
function renderPool() {
  const grid = $("stickers-grid");
  grid.innerHTML = "";
  state.tiles.forEach((tile, i) => {
    grid.appendChild(buildPlaceholderCell(i));
    renderTileIntoCell(i, tile);
  });
  refreshSelectionStatus();
  refreshPoolPresence();
}

function moveTile(idx, delta) {
  const j = idx + delta;
  if (j < 0 || j >= state.tiles.length) return;
  const [t] = state.tiles.splice(idx, 1);
  state.tiles.splice(j, 0, t);
  renderPool();
}

function setMainTile(tile) {
  state.mainTile = state.mainTile === tile ? null : tile;
  renderPool();
}
function setTabTile(tile) {
  state.tabTile = state.tabTile === tile ? null : tile;
  renderPool();
}

// Append all 9 tiles of a history grid into the pool (does NOT clear).
async function appendFromHistory(id) {
  const e = await idbGetGeneration(id);
  if (!e) return;
  const img = await loadImage(URL.createObjectURL(e.gridBlob));
  const tiles = await splitGrid(img, e.metadata?.chromaKey || null);
  for (let i = 0; i < tiles.length; i++) {
    state.tiles.push(makeTile(tiles[i], {
      phrase: e.metadata?.phrases?.[i] || "",
      included: false,
      srcGridId: e.id,
      srcIdx: i,
      srcKey: tiles.key,
    }));
  }
  $("step-preview").hidden = false;
  $("step-download").hidden = false;
  renderPool();
  showToast(`已加入 9 格（貼圖池共 ${state.tiles.length} 格）— 勾選要打包的張`);
  switchTab("pack");
}

// ------------------------------------------------------------------
// Studio shell — three workspaces on one page (issue #24).
// body[data-tab] + CSS decide visibility; hash makes tabs deep-linkable.

const WORKSPACES = ["create", "assets", "pack"];

const _tabScroll = { create: 0, assets: 0, pack: 0 };

function switchTab(tab, { push = true, resume = false } = {}) {
  if (!WORKSPACES.includes(tab)) tab = "create";
  const prev = document.body.dataset.tab;
  if (prev && WORKSPACES.includes(prev)) _tabScroll[prev] = window.scrollY;
  document.body.dataset.tab = tab;
  document.querySelectorAll(".studio-tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab));
  if (push && location.hash !== `#${tab}`) {
    // replaceState keeps back-button history sane (no tab-spam entries).
    history.replaceState(null, "", `#${tab}`);
  }
  // Manual tab clicks RESUME where you left off (studio muscle memory);
  // flow-driven switches (upload done, go pack…) land at the top.
  window.scrollTo({ top: resume ? (_tabScroll[tab] || 0) : 0 });
}

document.querySelectorAll(".studio-tab").forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab, { resume: true })));
window.addEventListener("hashchange", () =>
  switchTab(location.hash.slice(1) || "create", { push: false }));
switchTab(location.hash.slice(1) || "create", { push: false });

function refreshPoolPresence() {
  document.body.classList.toggle("has-pool", state.tiles.length > 0);
}

// ------------------------------------------------------------------
// Projects — the pool persists as a project (issue #25). Slots store
// (gridId, tileIdx, params) only; pixels always re-derive from the
// source grid in history, cleanup recomputed from originals.

const LAST_PROJECT_KEY = "line-sticker-last-project";

function defaultProjectName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `未命名專案 ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function serializeProject() {
  return {
    id: state.projectId,
    name: state.projectName,
    packSize: state.packSize,
    slots: state.tiles.map((t) => (t.srcStickerId
      ? { stickerId: t.srcStickerId, included: t.included }
      : {
          gridId: t.srcGridId,
          tileIdx: t.srcIdx,
          included: t.included,
          cleanParams: t.cleanParams || null,
          textParams: t.textParams || null,
        })),
    mainSlot: state.tiles.indexOf(state.mainTile),
    tabSlot: state.tiles.indexOf(state.tabTile),
    createdAt: state.projectCreatedAt || Date.now(),
    updatedAt: Date.now(),
  };
}

let _projectSaveTimer = null;
function scheduleProjectSave() {
  if (state.tiles.length === 0) return;   // never create ghost projects
  clearTimeout(_projectSaveTimer);
  _projectSaveTimer = setTimeout(() => { saveProjectNow(); }, 700);
}

async function saveProjectNow() {
  if (state.tiles.length === 0) return;
  if (state.tiles.some((t) => !t.srcGridId && !t.srcStickerId)) return; // no provenance → skip
  if (!state.projectId) {
    state.projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.projectCreatedAt = Date.now();
    if (!state.projectName) state.projectName = defaultProjectName();
  }
  await idbPut("projects", serializeProject());
  localStorage.setItem(LAST_PROJECT_KEY, state.projectId);
  renderProjectBar();
}

// Start a fresh (unsaved) project identity — used when a replace-style
// load happens so the PREVIOUS project isn't silently overwritten.
function startNewProjectIdentity() {
  state.projectId = null;
  state.projectName = "";
  state.projectCreatedAt = 0;
  // A fresh draft starts at the default pack size — leaving a stale 16/24
  // from the previous project makes an 8-tile pool undownloadable.
  state.packSize = 8;
}

async function openProject(id) {
  const p = await idbGetFrom("projects", id);
  if (!p) return false;
  // Load each referenced grid once, split, then rebuild slots in order.
  const splits = new Map();
  for (const slot of p.slots) {
    if (slot.stickerId || splits.has(slot.gridId)) continue;
    const e = slot.gridId ? await idbGetGeneration(slot.gridId) : null;
    splits.set(slot.gridId, e
      ? await splitGrid(await loadImage(URL.createObjectURL(e.gridBlob)), e.metadata?.chromaKey || null)
      : null);
  }
  const tiles = [];
  let dropped = 0;
  for (const slot of p.slots) {
    if (slot.stickerId) {
      const entry = await idbGetFrom("stickers", slot.stickerId).catch(() => null);
      if (!entry) { dropped++; continue; }
      const t = makeTile(await stickerToCanvas(entry), {
        included: slot.included,
        srcStickerId: slot.stickerId,
      });
      t.transparent = true;
      tiles.push(t);
      continue;
    }
    const split = splits.get(slot.gridId);
    if (!split || !split[slot.tileIdx]) { dropped++; continue; }
    const t = makeTile(split[slot.tileIdx], {
      included: slot.included,
      srcGridId: slot.gridId,
      srcIdx: slot.tileIdx,
      srcKey: split.key,
    });
    t.textParams = slot.textParams || null;
    t._pendingClean = slot.cleanParams || null;
    tiles.push(t);
  }
  state.tiles = tiles;
  state.packSize = PACK_SIZES.includes(p.packSize) ? p.packSize : 8;
  state.projectId = p.id;
  state.projectName = p.name || "";
  state.projectCreatedAt = p.createdAt || Date.now();
  state.mainTile = tiles[p.mainSlot] || null;
  state.tabTile = tiles[p.tabSlot] || null;
  state.bgRemoved = false;
  // Re-apply per-tile cleanup from ORIGINALS (never persisted pixels).
  for (const t of tiles) {
    if (t._pendingClean) {
      await cleanTile(t, t._pendingClean);
      delete t._pendingClean;
    }
  }
  const has = tiles.length > 0;
  $("step-preview").hidden = !has;
  $("step-download").hidden = !has;
  renderPool();
  localStorage.setItem(LAST_PROJECT_KEY, p.id);
  if (dropped > 0) {
    showToast(tiles.length === 0
      ? `這個專案引用的來源已全部刪除（${dropped} 格）— 可直接按「刪除」清掉這個專案`
      : `有 ${dropped} 格的來源已不在素材庫，已略過`);
  }
  renderProjectBar();
  return true;
}

async function renderProjectBar() {
  const sel = $("project-select");
  const nameInput = $("project-name");
  if (!sel || !nameInput) return;
  const all = (await idbAllFrom("projects")).sort((a, b) => b.updatedAt - a.updatedAt);
  sel.innerHTML = "";
  sel.appendChild(new Option("（新草稿）", ""));
  for (const p of all) {
    sel.appendChild(new Option(`${p.name || p.id}（${p.slots.length} 格）`, p.id));
  }
  sel.value = state.projectId || "";
  if (document.activeElement !== nameInput) {
    nameInput.value = state.projectName || "";
  }
}

async function restoreLastProject() {
  const id = localStorage.getItem(LAST_PROJECT_KEY);
  if (!id) { renderProjectBar(); return; }
  const restored = await openProject(id).catch(() => false);
  if (!restored) {
    localStorage.removeItem(LAST_PROJECT_KEY);
    renderProjectBar();
  }
}

// How many projects reference a given grid — used to warn before delete
// and to protect referenced grids from history pruning.
async function projectsReferencingGrid(gridId) {
  const all = await idbAllFrom("projects");
  return all.filter((p) => p.slots.some((s) => s.gridId === gridId));
}

// Pool-mutating async loads are serialized through this queue — without
// it, clicking history「＋」while an upload is still splitting interleaves
// two loaders and the pool ends up with duplicated / half-cleared tiles.
let poolOpChain = Promise.resolve();
function queuePoolOp(fn) {
  const run = poolOpChain.then(fn, fn);
  poolOpChain = run.catch(() => {});
  return run;
}

// Guard before actions that REPLACE the pool (AI generate / single BYOG
// upload / history load). Once the user has pooled >1 grid, nuking it by
// accident hurts — confirm first.
function confirmPoolReplace() {
  if (state.tiles.length <= GRID_SIZE) return true;
  return confirm(
    `貼圖池目前有 ${state.tiles.length} 格（多張 grid 湊的）。繼續會清空重來。\n\n` +
    "→ 確定：清空並載入新的\n" +
    "→ 取消：保留現有池（想加格子請用歷史卡片上的「＋」）",
  );
}

function showGridDownload() { /* 原始 grid 下載已移至素材庫(P4) */ }
async function downloadOriginalGrid() {
  if (!state.lastGridPng) {
    alert("沒有原始 grid PNG — 先生成一次。");
    return;
  }
  triggerDownload(state.lastGridPng, `gemini-grid-${Date.now()}.png`);
}

async function downloadSingleTile(idx) {
  const tile = state.tiles[idx];
  if (!tile) return;
  const blob = await canvasToBlob(composeTile(tile), "image/png");
  triggerDownload(blob, `sticker-${String(idx + 1).padStart(2, "0")}.png`);
}

// Share ONE sticker through the OS share sheet (mobile: straight into
// LINE / IG / anywhere). Falls back to a plain download when the Web
// Share API is unavailable or rejects the payload. (issue #9 — 手機試玩
// 者做 1 張就想傳給朋友，不必打包 ZIP)
async function shareSingleTile(idx) {
  const tile = state.tiles[idx];
  if (!tile) return;
  const blob = await canvasToBlob(composeTile(tile), "image/png");
  const file = new File([blob], `sticker-${String(idx + 1).padStart(2, "0")}.png`, {
    type: "image/png",
  });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return; // user closed the sheet
      console.warn("share failed, falling back to download", err);
    }
  }
  triggerDownload(blob, file.name);
}

// Quick popup: let user override the phrase before re-calling Gemini.
// Empty input = keep original phrase. Cancel = no-op.
function promptRerollTile(idx) {
  const tile = state.tiles[idx];
  if (!tile || tile.busy) return;
  const current = tile.phrase || "(無)";
  const newPhrase = window.prompt(
    `第 ${idx + 1} 格的 phrase 是：「${current}」\n\n` +
      `想用同一個 phrase 重抽就直接按確定；\n` +
      `想換成別的字（中/英/日/梗圖台詞 OK）就在下面打：\n\n` +
      `重抽會打 1 次 Gemini API（約 50 秒、~USD 0.04）`,
    tile.phrase || "",
  );
  if (newPhrase === null) return; // cancelled
  rerollTile(idx, newPhrase.trim() || null);
}

async function rerollTile(idx, overridePhrase = null) {
  if (!state.sourceFile) return;
  const tile = state.tiles[idx];
  if (!tile || tile.busy) return;
  tile.busy = true;
  const cell = $("stickers-grid").children[idx];
  cell.classList.add("busy");

  const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
  try {
    const { base64, mimeType } = await fileToResizedBase64(
      state.sourceFile,
      1280,
    );
    // For re-roll, pin slot 0 to either the user-typed override OR the
    // existing phrase so the re-rolled candidate uses what we want.
    // The other 8 slots fall through to the saved per-slot config.
    const effectivePhrase = overridePhrase || tile.phrase;
    const rerollSlots = state.slotConfig.slice();
    // Reroll for ONE cell — pin its phrase so Gemini doesn't wander.
    // We send the same shape the worker expects (phraseCustom).
    if (effectivePhrase) rerollSlots[0] = { phraseCustom: effectivePhrase };
    const result = await fetchGrid(apiUrl, {
      imageBase64: base64,
      mimeType,
      slots: rerollSlots,
      styleHint: state.styleHint,
      withText: state.withText,
      chromaKey: state.chromaKey,
      campaign: state.campaign,
      lang: state.textLang,
    });
    const gridImg = await loadImage(
      `data:${result.mimeType};base64,${result.data}`,
    );
    // Persist the reroll grid to history too — without a gridId this
    // slot could never be saved into a project.
    const binStr = atob(result.data);
    const binBytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) binBytes[i] = binStr.charCodeAt(i);
    state.lastGridPng = new Blob([binBytes], { type: result.mimeType });
    await saveCurrentGridToHistory("ai", {
      styleHint: state.styleHint,
      reroll: true,
      phrases: result.phrases,
      chromaKey: state.chromaKey,
    });
    const tiles = await splitGrid(gridImg);
    // The pinned phrase landed in slot 0 (top-left of the new grid).
    state.tiles[idx] = makeTile(tiles[0], {
      phrase: effectivePhrase || result.phrases?.[0] || tile.phrase,
      included: tile.included,  // preserve selection
      srcGridId: state.currentGridId,
      srcIdx: 0,
    });
    // Re-rerolled tiles have white bg again — bgRemoved no longer guaranteed.
    if (state.bgRemoved) state.bgRemoved = false;
    renderTileIntoCell(idx, state.tiles[idx]);
  } catch (err) {
    console.error(err);
    alert(`重抽失敗：${err.message}`);
  } finally {
    tile.busy = false;
    cell.classList.remove("busy");
  }
}

// ------------------------------------------------------------------
// Step 3 — background removal (client-side)

const bgRemoveBtn = $("bg-remove-btn");
const bgProgress = $("bg-progress");
const bgBarFill = $("bg-bar-fill");
const bgProgressText = $("bg-progress-text");
const bgTuneSelect = $("bg-tune-select");
const bgKeySelect = $("bg-key-select");
if (bgKeySelect) {
  bgKeySelect.value = state.chromaKey;
  bgKeySelect.addEventListener("change", () => setChromaKey(bgKeySelect.value));
}

bgRemoveBtn.addEventListener("click", removeAllBackgrounds);

// (Previously ensureBgLib loaded @imgly's ISNet model for white-bg
// fallback. Removed — chroma-key is the only path now. No 30MB ML
// model download, no white-shirt-eaten edge cases.

async function removeAllBackgrounds() {
  if (state.tiles.length === 0) return;
  bgRemoveBtn.disabled = true;
  bgProgress.hidden = false;

  try {
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      setBgProgress(
        ((i + 0.1) / state.tiles.length) * 100,
        `去背中 ${i + 1}/${state.tiles.length}…`,
      );
      await cleanTile(tile);
      renderTileIntoCell(i, tile);
    }
    state.bgRemoved = true;
    setBgProgress(100, `完成！${state.tiles.length} 張已去背。`);
    scheduleProjectSave();
  } catch (err) {
    console.error(err);
    setBgProgress(0, `去背失敗：${err.message}`);
  } finally {
    bgRemoveBtn.disabled = false;
  }
}


function setBgProgress(pct, text) {
  bgBarFill.style.width = `${pct}%`;
  bgProgressText.textContent = text;
}

// Approach D — pixel-level smart bg removal that preserves Gemini's
// drawn text (and its white outline) while cleanly removing the white
// card background.
//
// Algorithm:
//   1. Build a "dark mask" from the original — pixels darker than a
//      luma threshold are likely text strokes / character details.
//   2. Dilate that mask by N pixels using a separable filter so the
//      mask covers each dark pixel's surrounding white halo (the text
//      outline + character anti-alias edges).
//   3. Run @imgly bg removal as usual.
//   4. For every pixel inside the dilated mask, force-restore from the
//      original (color + alpha=255). Outside the mask, take @imgly's
//      output verbatim — that's where the white card bg gets dropped.
//
// Result: Gemini's exact text (including stylized strokes, white halo,
// any tear-drop integration) is preserved; only the truly empty white
// card area becomes transparent. No more double text, no more ghosting.
// Always chroma-key out the selected key color from the source canvas. Returns the
// transparent-bg canvas. (Previously gated on detectBgType, which had
// a false-negative on densely-composed cells where the character
// covered most of the frame and visible key-color pixels fell below 20%.
// Always-run is safer: AI path sends a selected chroma key; BYOG without
// that key color is a no-op since chroma key matches no pixels — the
// image just stays unchanged.)
async function bgRemoveWithTextPreserve(srcCanvas, tune = "balanced", key = undefined) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const origCtx = srcCanvas.getContext("2d");
  const origData = origCtx.getImageData(0, 0, w, h);
  const orig = origData.data;
  return chromaKeyColorOut(srcCanvas, w, h, orig, "none", tune, key || state.chromaKey);
}

// Legacy ISNet path retained for reference; never called now.
// eslint-disable-next-line
async function _legacyIsnetPath(srcCanvas, removeBackground, outlineStyle) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const origCtx = srcCanvas.getContext("2d");
  const origData = origCtx.getImageData(0, 0, w, h);
  const orig = origData.data;


  // 1. Run @imgly bg removal FIRST so we can use its mask to tell apart
  //    "character dark stuff (hair, eyes)" from "text strokes":
  //      character dark = dark in orig AND kept by @imgly  → trust @imgly
  //      text strokes   = dark in orig AND removed by @imgly → restore
  const blob = await new Promise((res) =>
    srcCanvas.toBlob(res, "image/png"),
  );
  const cleanedBlob = await removeBackground(blob);
  const cleanedImg = await loadImage(URL.createObjectURL(cleanedBlob));
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const outCtx = out.getContext("2d");
  outCtx.drawImage(cleanedImg, 0, 0, w, h);
  const outData = outCtx.getImageData(0, 0, w, h);
  const od = outData.data;

  // 2. Build TEXT-ONLY dark mask. Pixels that are dark in original AND
  //    transparent-ish in @imgly's output = printed text (ISNet doesn't
  //    recognize text as foreground). Character dark features (hair,
  //    eyes, black outline) stay alpha-high in @imgly's output and
  //    DON'T get included — so we don't dilate-restore around them and
  //    don't pull in the white background bordering hair edges.
  const DARK_LUMA = 110;
  const KEPT_BY_IMGLY = 100; // alpha threshold
  const textDark = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < orig.length; i += 4, p++) {
    const lum = 0.299 * orig[i] + 0.587 * orig[i + 1] + 0.114 * orig[i + 2];
    if (lum < DARK_LUMA && od[i + 3] < KEPT_BY_IMGLY) textDark[p] = 1;
  }

  // 3. Dilate text mask by N to also capture each glyph's white outline
  //    (text in our prompt is "white fill + black outline" → we want
  //    to preserve the black outline AND the area immediately around).
  const N = 5;
  const dilated = dilateMask(textDark, w, h, N);

  // 4. Restore text-and-its-halo pixels from the original. Character
  //    pixels keep @imgly's smooth alpha — no more "white halo around
  //    hair" because we never widened the mask there.
  for (let i = 0, p = 0; i < od.length; i += 4, p++) {
    if (dilated[p]) {
      od[i] = orig[i];
      od[i + 1] = orig[i + 1];
      od[i + 2] = orig[i + 2];
      od[i + 3] = 255;
    }
  }

  // 5. Edge decontamination — remove white-bg color contamination from
  // semi-transparent edge pixels. Without this, anti-aliased edges
  // around the character look like a white halo on dark chat backgrounds.
  //
  // Math: each edge pixel is composite = α·fg + (1−α)·bg. We know
  // composite (current pixel) and α (current alpha) and bg = white.
  // Solve for fg: fg = (composite − (1−α)·white) / α.
  // Apply only to edges (0 < α < 0.95), skip fully opaque & fully
  // transparent pixels (no contamination there).
  const BG_R = 255, BG_G = 255, BG_B = 255;
  for (let i = 0; i < od.length; i += 4) {
    const a = od[i + 3] / 255;
    if (a <= 0.02 || a >= 0.95) continue;
    const inv = 1 - a;
    const r = (od[i]     - inv * BG_R) / a;
    const g = (od[i + 1] - inv * BG_G) / a;
    const b = (od[i + 2] - inv * BG_B) / a;
    od[i]     = Math.max(0, Math.min(255, r));
    od[i + 1] = Math.max(0, Math.min(255, g));
    od[i + 2] = Math.max(0, Math.min(255, b));
  }

  // 6+7. Outline + drop shadow handled by shared helper.
  outCtx.putImageData(outData, 0, 0);
  return applyOutlineAndShadow(out, w, h, outlineStyle);
}

// Detect background type by counting GREEN PIXELS over the entire image
// (not just borders — character with white shirt extending to frame
// would falsify a border-only check). If ≥20% of pixels are clearly
// green, treat as chroma-key plate.
function detectBgType(orig, w, h) {
  const total = w * h;
  let greenPx = 0;
  for (let i = 0; i < orig.length; i += 4) {
    const greenness = (orig[i + 1] - Math.max(orig[i], orig[i + 2])) / 255;
    if (greenness > 0.25) greenPx++;
  }
  const greenPct = greenPx / total;
  const result = greenPct > 0.20 ? "green" : "white";
  console.log(
    `[bg-detect] greenPx=${greenPx}/${total} (${(greenPct * 100).toFixed(1)}%) → ${result}`,
  );
  return result;
}

// `minKey` is the minimum key-channel intensity required for a pixel to
// be considered "on the bg plate". Set low (40-60) so that DARK key
// color (i.e. character shadow cast onto the backdrop — magenta/green
// bg dimmed by the character blocking studio light) also enters the
// chroma key path. Without this, the AI's stray shadow pixels stayed
// as a dark magenta/green halo glued to the character's feet.
//
// The dominance ratio (key channel must exceed non-key by 1.45-1.9×)
// is what protects character pixels from over-removal — even with a
// low minKey, skin/red/orange/yellow tones don't satisfy the ratio.
//
// "aggressive" removes shadows fully; "balanced" leaves a faint trace;
// "safe" preserves more shadow as semi-transparent. Default = balanced.
const CHROMA_TUNE_PROFILES = {
  safe: { hard: 0.32, soft: 0.12, minKey: 60, maxOther: 100, dominance: 1.9 },
  balanced: { hard: 0.25, soft: 0.05, minKey: 50, maxOther: 110, dominance: 1.7 },
  aggressive: { hard: 0.20, soft: 0.04, minKey: 40, maxOther: 125, dominance: 1.45 },
};

function resolveChromaTuneProfile(tune = "balanced") {
  // Custom profile object (issue #7 sliders) passes straight through.
  if (tune && typeof tune === "object") return tune;
  return CHROMA_TUNE_PROFILES[tune] || CHROMA_TUNE_PROFILES.balanced;
}

// Chroma-key out a selected green/magenta background with anti-alias cleanup.
// Per-pixel key-color score → linear ramp to alpha.
// Then subtract key-color contribution from semi-transparent edge pixels.
async function chromaKeyColorOut(srcCanvas, w, h, orig, outlineStyle, tune = "balanced", key = "green") {
  const TUNE = resolveChromaTuneProfile(tune);
  const keyName = normalizeChromaKey(key);
  const keyScore = (r, g, b) =>
    keyName === "magenta"
      ? (Math.min(r, b) - g) / 255
      : (g - Math.max(r, b)) / 255;
  const isPureKey = (r, g, b) => {
    if (keyName === "magenta") {
      const magenta = Math.min(r, b);
      return (
        magenta >= TUNE.minKey &&
        g <= TUNE.maxOther &&
        r >= g * TUNE.dominance &&
        b >= g * TUNE.dominance
      );
    }
    return (
      g >= TUNE.minKey &&
      r <= TUNE.maxOther &&
      b <= TUNE.maxOther &&
      g >= r * TUNE.dominance &&
      g >= b * TUNE.dominance
    );
  };
  const despill = (i, r, g, b) => {
    if (keyName === "magenta") {
      od[i] = g;
      od[i + 2] = g;
    } else {
      od[i + 1] = (r + b) >> 1;
    }
  };

  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const outCtx = out.getContext("2d");
  const outData = outCtx.createImageData(w, h);
  const od = outData.data;

  const total = w * h;
  let nKeyed = 0, nKept = 0, nPartial = 0;
  for (let i = 0; i < orig.length; i += 4) {
    const r = orig[i], g = orig[i + 1], b = orig[i + 2];
    const score = keyScore(r, g, b);
    const pureKey = isPureKey(r, g, b);
    let alpha = 255;
    if (pureKey && score > TUNE.hard) {
      alpha = 0;
    } else if (pureKey && score > TUNE.soft) {
      alpha = Math.round(255 * (TUNE.hard - score) / Math.max(0.01, (TUNE.hard - TUNE.soft)));
    }
    od[i] = r; od[i + 1] = g; od[i + 2] = b; od[i + 3] = alpha;
    if (alpha === 0) nKeyed++;
    else if (alpha === 255) nKept++;
    else nPartial++;

    // Despill only pixels confidently associated with the key color.
    if (alpha > 0 && pureKey) despill(i, r, g, b);
  }
  console.log(`[chroma-key:${keyName}] keyed=${(100*nKeyed/total).toFixed(0)}% kept=${(100*nKept/total).toFixed(0)}% partial=${(100*nPartial/total).toFixed(0)}%`);

  let nSpillCleaned = 0;
  const baseAlpha = new Uint8Array(total);
  for (let i = 0, p = 0; i < od.length; i += 4, p++) baseAlpha[p] = od[i + 3];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (baseAlpha[p] === 0) continue;
      let touchesEmpty = false;
      for (let dy = -1; dy <= 1 && !touchesEmpty; dy++) {
        for (let dx = -1; dx <= 1 && !touchesEmpty; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (baseAlpha[(y + dy) * w + (x + dx)] === 0) touchesEmpty = true;
        }
      }
      if (!touchesEmpty) continue;
      const i = p * 4;
      const r = od[i], g = od[i + 1], b = od[i + 2];
      const score = keyScore(r, g, b);
      const lightSpill = keyName === "magenta"
        ? (
            score > Math.max(TUNE.soft, 0.08) &&
            r >= 90 &&
            b >= 90 &&
            g >= 50 &&
            r > g * 1.05 &&
            b > g * 1.05
          )
        : (
            score > Math.max(TUNE.soft, 0.08) &&
            r >= 90 &&
            b >= 70 &&
            g > r * 1.05 &&
            g > b * 1.05
          );
      if (!lightSpill) continue;
      despill(i, r, g, b);
      od[i + 3] = Math.min(
        od[i + 3],
        Math.round(255 * (TUNE.hard - score) / Math.max(0.01, (TUNE.hard - TUNE.soft))),
      );
      nSpillCleaned++;
    }
  }
  console.log(`[chroma-key:${keyName}] cleaned ${nSpillCleaned} light spill pixels`);

  // Edge cleanup pass: any partial-alpha pixel adjacent to a fully-
  // transparent neighbor gets killed too. Eliminates the 1-2 px green
  // halo that survives despill — the fringe pixels nearest the bg
  // always carry the most key-color contamination.
  const ERODE_PASSES = TUNE.erode ?? 1;
  let nEroded = 0;
  for (let pass = 0; pass < ERODE_PASSES; pass++) {
    // Snapshot alpha so a single pass doesn't cascade-erode
    const alphaSnap = new Uint8Array(total);
    for (let i = 0, p = 0; i < od.length; i += 4, p++) alphaSnap[p] = od[i + 3];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const a = alphaSnap[p];
        if (a === 0 || a === 255) continue;
        // Check 8 neighbors for any fully-transparent
        let touchesEmpty = false;
        for (let dy = -1; dy <= 1 && !touchesEmpty; dy++) {
          for (let dx = -1; dx <= 1 && !touchesEmpty; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (alphaSnap[(y + dy) * w + (x + dx)] === 0) touchesEmpty = true;
          }
        }
        if (touchesEmpty) {
          od[p * 4 + 3] = 0;
          nEroded++;
        }
      }
    }
  }
  console.log(`[chroma-key] eroded ${nEroded} fringe pixels`);

  outCtx.putImageData(outData, 0, 0);
  const decorated = applyOutlineAndShadow(out, w, h, outlineStyle);
  // LINE Creators Market spec: "剪裁後的圖片與貼圖圖案之間必須有一定程度
  // （10px 左右）的留白" — find character bbox, scale-down + center if
  // any side has < 10px clearance.
  return fitWithPadding(decorated, 10);
}

// Find the character's bounding box (any pixel with alpha > 32) then
// re-render scaled-down + centered with `padding` px clearance on every
// side. Required by LINE 規格.
function fitWithPadding(canvas, padding) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, w, h).data;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 32) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return canvas;

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  // Already inside spec? leave alone.
  if (
    minX >= padding && minY >= padding &&
    (w - 1 - maxX) >= padding && (h - 1 - maxY) >= padding
  ) {
    return canvas;
  }
  const scale = Math.min(
    (w - 2 * padding) / bboxW,
    (h - 2 * padding) / bboxH,
    1,
  );
  const newW = bboxW * scale;
  const newH = bboxH * scale;
  const dx = (w - newW) / 2;
  const dy = (h - newH) / 2;

  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d").drawImage(
    canvas, minX, minY, bboxW, bboxH, dx, dy, newW, newH,
  );
  console.log(
    `[fit] bbox=${bboxW}×${bboxH} → scale ${scale.toFixed(2)} → ${padding}px margin`,
  );
  return out;
}

// Apply die-cut white outline + drop shadow to a transparent-bg canvas.
// Shared between chroma-key path and ISNet path.
function applyOutlineAndShadow(canvas, w, h, outlineStyle) {
  if (outlineStyle === "none") return canvas;
  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, w, h);
  const od = imgData.data;
  const OUTLINE_PX = 7;
  const FEATHER_PX = outlineStyle === "fancy" ? 2 : 0;
  const baseAlpha = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < od.length; i += 4, p++) {
    if (od[i + 3] >= 64) baseAlpha[p] = 1;
  }
  const dil7 = dilateMask(baseAlpha, w, h, OUTLINE_PX);
  const dil8 = FEATHER_PX > 0 ? dilateMask(baseAlpha, w, h, OUTLINE_PX + 1) : null;
  const dil9 = FEATHER_PX > 1 ? dilateMask(baseAlpha, w, h, OUTLINE_PX + FEATHER_PX) : null;
  for (let i = 0, p = 0; i < od.length; i += 4, p++) {
    if (baseAlpha[p]) continue;
    if (dil7[p]) {
      od[i] = 255; od[i + 1] = 255; od[i + 2] = 255; od[i + 3] = 255;
    } else if (dil8 && dil8[p]) {
      od[i] = 255; od[i + 1] = 255; od[i + 2] = 255; od[i + 3] = 180;
    } else if (dil9 && dil9[p]) {
      od[i] = 255; od[i + 1] = 255; od[i + 2] = 255; od[i + 3] = 100;
    }
  }
  if (outlineStyle !== "fancy") {
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }
  // Drop shadow
  const SHADOW_OFFSET_X = 2, SHADOW_OFFSET_Y = 3;
  const SHADOW_BLUR = 2, SHADOW_MAX_ALPHA = 70;
  const currentAlpha = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < od.length; i += 4, p++) currentAlpha[p] = od[i + 3];
  const blurredShadowSrc = blurMask(currentAlpha, w, h, SHADOW_BLUR);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (od[p * 4 + 3] !== 0) continue;
      const sx = x - SHADOW_OFFSET_X, sy = y - SHADOW_OFFSET_Y;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const intensity = blurredShadowSrc[sy * w + sx] / 255;
      const shadowAlpha = Math.round(intensity * SHADOW_MAX_ALPHA);
      if (shadowAlpha > 4) {
        od[p * 4] = 0; od[p * 4 + 1] = 0; od[p * 4 + 2] = 0;
        od[p * 4 + 3] = shadowAlpha;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// Separable binary dilation by `radius` (Manhattan-ish, treats edges as
// off). O(w·h·radius) instead of O(w·h·radius²) of naive 2D.
function dilateMask(mask, w, h, radius) {
  const halfH = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        if (mask[y * w + nx]) { on = 1; break; }
      }
      halfH[y * w + x] = on;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let on = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        if (halfH[ny * w + x]) { on = 1; break; }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

// Separable box blur on a single-channel mask. O(w·h·radius). Returns
// a Uint8Array same shape as input with averaged values.
function blurMask(mask, w, h, radius) {
  const halfH = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        sum += mask[y * w + nx];
        n++;
      }
      halfH[y * w + x] = sum / n;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        sum += halfH[ny * w + x];
        n++;
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

// Re-stamp the phrase onto a sticker after bg removal. Bold rounded font
// with a thick white stroke so it stays legible on any chat background.
// (No longer used by default — Approach D preserves Gemini's text — but
// kept as a fallback / for future "force re-render" option.)
function drawTextOverlay(ctx, phrase, w, h) {
  if (!phrase) return;
  // Auto-size: shrink for longer text so it fits the cell width
  let fontSize = Math.floor(h * 0.18);
  ctx.save();
  ctx.font =
    `900 ${fontSize}px "M PLUS Rounded 1c", "Noto Sans TC", sans-serif`;
  // Iteratively shrink if too wide
  while (
    fontSize > 18 &&
    ctx.measureText(phrase).width > w * 0.92
  ) {
    fontSize -= 2;
    ctx.font =
      `900 ${fontSize}px "M PLUS Rounded 1c", "Noto Sans TC", sans-serif`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  const x = w / 2;
  const y = h - Math.max(12, fontSize * 0.25);
  // Heavy white outer stroke for legibility on any bg
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(8, fontSize * 0.22);
  ctx.strokeText(phrase, x, y);
  // Dark fill on top
  ctx.fillStyle = "#1f2d24";
  ctx.fillText(phrase, x, y);
  ctx.restore();
}

// ------------------------------------------------------------------
// Step 4 — download

$("download-zip-btn").addEventListener("click", downloadZip);
$("download-stickers-only-btn")?.addEventListener("click", downloadStickersOnly);

async function downloadZip() {
  if (state.tiles.length === 0) return;
  if (!window.JSZip) {
    alert("JSZip 未載入");
    return;
  }
  const includedTiles = state.tiles.filter((t) => t.included);
  if (includedTiles.length !== state.packSize) {
    alert(
      `套組張數設為 ${state.packSize}，目前選了 ${includedTiles.length} 張。` +
      `請補勾／取消到剛好 ${state.packSize} 張，或改選其他套組張數（8/16/24/32/40）。`,
    );
    return;
  }
  // Safety: LINE requires transparent PNGs. If user hasn't clicked
  // "全部去背" yet, the canvases still have a solid white background.
  const anyTransparent = includedTiles.some((t) => t.transparent);
  if (!anyTransparent) {
    const key = chromaKeyColor();
    const proceed = confirm(
      `還沒去背！下載的 PNG 都是${key.label}（chroma-key 用的 ${key.hex}），LINE Creators Market 規定透明背景，這樣上架會被退件。\n\n` +
      "→ 確定：先去背再下載（推薦）— 我會自動執行去背\n" +
      `→ 取消：硬要下載${key.label}版本`,
    );
    if (proceed) {
      // Run bg removal then re-trigger download.
      await removeAllBackgrounds();
      // After bg removal, check again — if it succeeded, retry download.
      if (state.tiles.some((t) => t.transparent)) {
        return downloadZip();
      }
      // If still no transparency, fall through and download opaque (with no further confirm).
    }
  }
  // Per-tile transparency audit — tile.transparent only records that the
  // removal PASS ran, not that it actually bit. A white-bg BYOG grid runs
  // the pass, keys 0 pixels, and every sticker stays fully opaque → LINE
  // rejects the whole pack. Pixel-check each included tile and warn.
  const opaqueNums = [];
  includedTiles.forEach((tile, i) => {
    if (tileBackgroundNotRemoved(composeTile(tile))) opaqueNums.push(i + 1);
  });
  if (opaqueNums.length > 0) {
    const ok = confirm(
      `第 ${opaqueNums.join("、")} 張完全沒有透明背景 — LINE 上架會被退件。\n\n` +
      "常見原因：來源圖背景不是綠幕/洋紅幕，chroma-key 認不到。\n\n" +
      "→ 確定：仍要下載\n" +
      "→ 取消：回去檢查（試試換 key 色重新去背，或換來源圖）",
    );
    if (!ok) return;
  }

  const zip = new JSZip();

  // Each sticker — 370 × 320, PNG. Numbered 01..08 in the order they
  // appear in the grid (skipping excluded ones, but renumbering tightly).
  const oversizeNames = [];
  for (let i = 0; i < includedTiles.length; i++) {
    const tile = includedTiles[i];
    const blob = await canvasToBlob(composeTile(tile), "image/png");
    const name = `${String(i + 1).padStart(2, "0")}.png`;
    if (blob.size > 1024 * 1024) oversizeNames.push(name);
    zip.file(name, blob);
  }
  if (oversizeNames.length > 0) {
    const ok = confirm(
      `${oversizeNames.join("、")} 超過 1MB（LINE 單張上限）。\n\n` +
      "→ 確定：仍要下載\n→ 取消：中止",
    );
    if (!ok) return;
  }

  // Main/tab: user-picked tiles win; fall back to the first INCLUDED
  // tile (classic behavior). A picked tile that got excluded is ignored.
  const mainTile = (state.mainTile && includedTiles.includes(state.mainTile))
    ? state.mainTile : includedTiles[0];
  const tabTile = (state.tabTile && includedTiles.includes(state.tabTile))
    ? state.tabTile : mainTile;
  zip.file("main.png", await canvasToBlob(makeMainImage(composeTile(mainTile)), "image/png"));
  zip.file("tab.png", await canvasToBlob(makeTabImage(composeTile(tabTile)), "image/png"));

  zip.file("README.txt", buildReadmeText(currentCampaign(), includedTiles.length));

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `line-stickers-${Date.now()}.zip`);
}

// "Download all 9 transparent stickers" — for users who don't want to
// upload to LINE Creators Market. No main/tab/README, no 8-pick rule.
// Uses the same processed canvases (370×320, padded), so they ARE
// LINE-spec sized but freed of the bundle obligations.
async function downloadStickersOnly() {
  if (state.tiles.length === 0) return;
  if (!window.JSZip) {
    alert("JSZip 未載入");
    return;
  }
  // Same transparency safety check as the main ZIP download.
  const anyTransparent = state.tiles.some((t) => t.transparent);
  if (!anyTransparent) {
    const key = chromaKeyColor();
    const proceed = confirm(
      `還沒去背！下載的 PNG 都是${key.label}（chroma-key 用的 ${key.hex}），貼到任何地方都會看到色塊。\n\n` +
      "→ 確定：先去背再下載（推薦）— 我會自動執行去背\n" +
      `→ 取消：硬要下載${key.label}版本`,
    );
    if (proceed) {
      await removeAllBackgrounds();
      if (state.tiles.some((t) => t.transparent)) {
        return downloadStickersOnly();
      }
    }
  }
  const zip = new JSZip();
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    const blob = await canvasToBlob(composeTile(tile), "image/png");
    // Name with phrase if we have one — much easier to find later than 01.png.
    const phrase = (tile.phrase || "").replace(/[\\/:*?"<>|]/g, "").trim();
    const safePhrase = phrase ? `-${phrase}` : "";
    const name = `${String(i + 1).padStart(2, "0")}${safePhrase}.png`;
    zip.file(name, blob);
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `transparent-stickers-${Date.now()}.zip`);
}

function makeMainImage(srcCanvas) {
  const c = document.createElement("canvas");
  c.width = MAIN_SIZE;
  c.height = MAIN_SIZE;
  const ctx = c.getContext("2d");
  // Center-crop the 370×320 sticker into a square, then scale.
  const side = Math.min(srcCanvas.width, srcCanvas.height);
  const sx = (srcCanvas.width - side) / 2;
  const sy = (srcCanvas.height - side) / 2;
  ctx.drawImage(srcCanvas, sx, sy, side, side, 0, 0, MAIN_SIZE, MAIN_SIZE);
  return c;
}

function makeTabImage(srcCanvas) {
  const c = document.createElement("canvas");
  c.width = TAB_W;
  c.height = TAB_H;
  const ctx = c.getContext("2d");
  // contain-fit (preserve aspect, center).
  const scale = Math.min(TAB_W / srcCanvas.width, TAB_H / srcCanvas.height);
  const dw = srcCanvas.width * scale;
  const dh = srcCanvas.height * scale;
  ctx.drawImage(srcCanvas, (TAB_W - dw) / 2, (TAB_H - dh) / 2, dw, dh);
  return c;
}

function canvasToBlob(canvas, type) {
  return new Promise((res) => canvas.toBlob(res, type));
}

// iOS Safari doesn't reliably honor the `download` attribute on blob: URLs
// (it just navigates/previews instead of saving) — WebKit bug 167341. A
// data: URL is honored much more reliably, so read the blob through
// FileReader first. Works the same on desktop, just one extra hop.
function triggerDownload(blob, filename) {
  const reader = new FileReader();
  reader.onload = () => {
    const a = document.createElement("a");
    a.href = reader.result;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  reader.readAsDataURL(blob);
}

function buildReadmeText(camp, count = 8) {
  const key = chromaKeyColor();
  const campSection = camp
    ? `

* 對準 LINE 特輯活動：${camp.fullName}
=================================
這組貼圖的 prompt 已經依照「${camp.fullName}」的徵稿規則調整。
記得在 LINE Creators Market 投稿時做這件事：

  → 編輯貼圖時，「販售資訊」區段選擇：「${camp.submitTag}」

關鍵期程：
  - 投稿截止：${camp.submitDeadline}
  - Banner 曝光期：${camp.bannerPeriod}

完整規則：
  ${camp.articleUrl}

注意：通用條件 — 必須是新貼圖（不能改舊的）、限台灣居民、
靜態 ≥30 TWD（眼淚製造機 ≥40 TWD、台味 NT$60 固定價）、
動態 ≥60 TWD、不可含個人姓名/暱稱/個人照。
`
    : "";

  return `LINE 貼圖製造機 — 上架說明
=================================

ZIP 內容
--------
- main.png   主要圖片，240 × 240（LINE Creators Market「主要圖片」欄）
- tab.png    聊天室標籤圖，96 × 74（「聊天室標籤」欄）
- 01.png ~ ${String(count).padStart(2, "0")}.png   貼圖本體，370 × 320，共 ${count} 張（依序對應「貼圖 1～${count}」）

提醒：LINE 編輯器建立貼圖時「貼圖數量」要選 ${count}，和 ZIP 張數一致。

是否透明背景
------------
- 如果你在前端按過「全部去背」，就是透明 PNG (LINE 要求)。
- 如果跳過去背，每張會是${key.label}（${key.hex}）；上架前一定要去背，不然會被 LINE 退件。
${campSection}
上架步驟
--------
1. 到 https://creator.line.me/zh-hant/ 用 LINE 帳號登入。
2. 點「新增貼圖 → Sticker」。
3. 填寫貼圖名稱、簡介、版權所有人等基本資料。
4. 進到「貼圖管理 → 圖片編輯」，把 ZIP 裡的檔案分別上傳到對應欄位。
5. 全部上傳完成後送出申請，LINE 通常 1～7 天回覆審核結果。

退件常見原因
------------
- 肖像權：使用他人照片但沒授權。
- 商標：包含 LINE 自家或其他品牌的圖案、字體。
- 文字過多：貼圖以圖為主，整片都是字會被退。
- 解析度不符：本工具已輸出標準規格 (370×320)，正常情況不會有此問題。

祝上架順利！
`;
}

// ------------------------------------------------------------------
// Helpers

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function fileToResizedBase64(file, maxSide) {
  const img = await loadImage(URL.createObjectURL(file));
  const scale = Math.min(
    1,
    maxSide / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  const dataUrl = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = () => rej(reader.error);
    reader.readAsDataURL(blob);
  });
  return { base64: dataUrl.split(",")[1], mimeType: "image/jpeg" };
}

// ------------------------------------------------------------------
// Campaign picker — LINE Creators Market themed special features

const campaignToggle = $("campaign-toggle");
const campaignList = $("campaign-list");
const campaignActive = $("campaign-active");
const campaignCopyToWorker = $("slots-copy-prompt"); // reused — see copy fn

campaignToggle.addEventListener("click", () => {
  campaignList.hidden = !campaignList.hidden;
  campaignToggle.textContent = campaignList.hidden ? "展開" : "收起";
});

function renderCampaignPicker() {
  campaignList.innerHTML = "";
  // Keep the hint paragraph at the top
  const hint = document.createElement("p");
  hint.className = "hint mini";
  hint.textContent =
    "挑一個活動 → AI 自動套用所需風格/規則；ZIP 會附上對應投稿說明。";
  campaignList.appendChild(hint);

  // "Off" / 自由模式 card always first
  campaignList.appendChild(buildCampaignCard(null));

  const today = todayISO();
  // Show all non-expired first, then expired (faded)
  const sorted = campaignCache.items.slice().sort((a, b) => {
    const aExp = a.submitDeadline < today;
    const bExp = b.submitDeadline < today;
    if (aExp !== bExp) return aExp ? 1 : -1;
    return a.submitDeadline.localeCompare(b.submitDeadline);
  });
  for (const c of sorted) {
    campaignList.appendChild(buildCampaignCard(c));
  }
  refreshCampaignActive();
}

function buildCampaignCard(camp) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "campaign-card";

  if (camp === null) {
    btn.dataset.cid = "";
    btn.innerHTML = `
      <div class="name">自由模式</div>
      <div class="blurb">不對準特定活動，用一般 prompt</div>
      <div class="deadline">永遠可用</div>
    `;
  } else {
    const today = todayISO();
    const expired = camp.submitDeadline < today;
    const daysLeft = Math.ceil(
      (Date.parse(camp.submitDeadline + "T23:59:59") - Date.now()) / 86400000,
    );
    const urgent = !expired && daysLeft <= 14;
    const deadlineCls = expired ? "expired" : urgent ? "urgent" : "";
    const deadlineLabel = expired
      ? `已截止 ${camp.submitDeadline}`
      : `投稿截止 ${camp.submitDeadline}（剩 ${daysLeft} 天）`;
    btn.dataset.cid = camp.id;
    // Expired campaigns stay selectable — generation is still fun even
    // if you can't submit. Visual fading + clear "已過期" badge does the
    // talking; we add a warning banner in refreshCampaignActive too.
    if (expired) btn.classList.add("expired-card");
    const expiredBadge = expired
      ? `<div class="expired-badge">已過期・僅供把玩</div>`
      : "";
    btn.innerHTML = `
      <div class="name">${escapeHtml(camp.label)}</div>
      <div class="blurb">${escapeHtml(camp.blurb)}</div>
      <div class="deadline ${deadlineCls}">${escapeHtml(deadlineLabel)}</div>
      ${expiredBadge}
    `;
  }

  btn.addEventListener("click", () => {
    selectCampaign(btn.dataset.cid || null);
  });

  if ((state.campaign || "") === (btn.dataset.cid || "")) {
    btn.classList.add("selected");
  }
  return btn;
}

function selectCampaign(id) {
  state.campaign = id || null;
  // Update card selected highlights
  campaignList.querySelectorAll(".campaign-card").forEach((c) => {
    c.classList.toggle("selected", (c.dataset.cid || "") === (id || ""));
  });
  applyCampaignLocks();
  refreshCampaignActive();
}

function applyCampaignLocks() {
  const camp = currentCampaign();
  // Reset both fields' enabled state first
  styleHintSel.parentElement.classList.remove("locked");
  withTextSel.parentElement.classList.remove("locked");
  styleHintSel.disabled = false;
  withTextSel.disabled = false;

  if (!camp) return;
  if (camp.forceStyleHint) {
    styleHintSel.value = camp.forceStyleHint;
    styleHintSel.disabled = true;
    styleHintSel.parentElement.classList.add("locked");
    state.styleHint = camp.forceStyleHint;
  }
  if (camp.forceWithText !== null && camp.forceWithText !== undefined) {
    withTextSel.value = camp.forceWithText ? "true" : "false";
    withTextSel.disabled = true;
    withTextSel.parentElement.classList.add("locked");
    state.withText = camp.forceWithText;
  }
  refreshTextLangAvailability();
}

function refreshCampaignActive() {
  const camp = currentCampaign();
  if (!camp) {
    campaignActive.hidden = true;
    campaignActive.innerHTML = "";
    return;
  }
  const expired = camp.submitDeadline < todayISO();
  campaignActive.hidden = false;
  campaignActive.classList.toggle("is-expired", expired);
  const expiredWarn = expired
    ? `<div class="expired-warn">此活動已於 ${escapeHtml(camp.submitDeadline)} 截止徵稿 — 仍可用此 prompt 產出貼圖把玩 / 留念，但 LINE 不再收稿到這個特輯。</div>`
    : "";
  campaignActive.innerHTML = `
    ${expiredWarn}
    <strong>已對準：${escapeHtml(camp.fullName)}</strong><br>
    ${expired
      ? `(已過期，原投稿 tag 為「<strong>${escapeHtml(camp.submitTag)}</strong>」)`
      : `投稿時 LINE 編輯器選 →「<strong>${escapeHtml(camp.submitTag)}</strong>」`}<br>
    投稿截止：${escapeHtml(camp.submitDeadline)}・Banner 期：${escapeHtml(camp.bannerPeriod)}<br>
    <a href="${escapeAttr(camp.articleUrl)}" target="_blank" rel="noopener">看完整徵稿規則</a>
  `;
}

function currentCampaign() {
  if (!state.campaign) return null;
  return campaignCache.items.find((c) => c.id === state.campaign) || null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
function escapeAttr(s) { return escapeHtml(s); }

// ------------------------------------------------------------------
// Settings dialog (per-slot phrase config)

const settingsDialog = $("settings-dialog");
const slotGrid = $("slot-grid");
const slotsResetBtn = $("slots-reset");
const slotsCopyBtn = $("slots-copy-prompt");
const slotsCopyStatus = $("slots-copy-status");
const openSettingsLink = $("open-settings-link");
const slotStatusText = $("slot-status-text");

openSettingsLink.addEventListener("click", openSettings);
slotsResetBtn.addEventListener("click", () => {
  renderSlotGrid(new Array(SLOT_COUNT).fill(null));
});
slotsCopyBtn.addEventListener("click", copyPromptToGemini);

// AI theme generator — fill 8 custom slots from a user description.
const themeInput = $("theme-input");
const themeGenBtn = $("theme-gen-btn");
const themeGenStatus = $("theme-gen-status");

// Occupation / scene quick-entry chips (issue #10) — one tap seeds the
// theme input; generation still needs an explicit button press (it costs
// a worker call). Labels: zh for zh-* UI languages, en otherwise.
// (語錄由 /generate-themes 動態產生，非靜態文案庫。)
const THEME_CHIPS = [
  { zh: "上班族日常", en: "office worker daily life" },
  { zh: "上班摸魚中", en: "slacking off at work" },
  { zh: "老師的心聲", en: "teacher's inner voice" },
  { zh: "學生期末爆炸", en: "student during finals" },
  { zh: "健身教練", en: "fitness coach" },
  { zh: "工程師 debug 人生", en: "engineer debugging life" },
  { zh: "家庭主婦戰場", en: "stay-home parent chaos" },
  { zh: "貓奴日常", en: "cat servant daily" },
  { zh: "狗派生活", en: "dog person life" },
  { zh: "餐飲店員尖峰", en: "restaurant staff rush hour" },
  { zh: "醫護人員日常", en: "healthcare worker daily" },
  { zh: "業務衝業績", en: "sales hustle" },
  { zh: "自由工作者", en: "freelancer life" },
  { zh: "電商小編", en: "social media editor" },
  { zh: "遊戲玩家時刻", en: "gamer moments" },
  { zh: "情侶放閃", en: "lovey-dovey couple" },
];

function themeChipLabel(chip) {
  return currentLang.startsWith("zh") ? chip.zh : chip.en;
}

function renderThemeChips() {
  const wrap = $("theme-chips");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const chip of THEME_CHIPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "theme-chip";
    b.textContent = themeChipLabel(chip);
    b.addEventListener("click", () => {
      if (themeInput) {
        themeInput.value = themeChipLabel(chip);
        themeInput.focus();
      }
    });
    wrap.appendChild(b);
  }
}
themeGenBtn?.addEventListener("click", async () => {
  const description = themeInput.value.trim();
  if (!description) {
    alert("請先描述你要的主題");
    themeInput.focus();
    return;
  }
  themeGenBtn.disabled = true;
  themeGenStatus.hidden = false;
  themeGenStatus.textContent = "AI 想中…";
  try {
    const tsToken = await awaitTurnstileToken();
    const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/generate-themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        lang: state.textLang,
        turnstileToken: tsToken,
      }),
    });
    resetTurnstile();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const { phrases, slots: aiSlots } = await resp.json();
    if (!Array.isArray(phrases) || phrases.length === 0) {
      throw new Error("AI 沒回 phrases");
    }
    // Prefer the new {phrase, action} pairs if worker returned them — that
    // way withText=false stickers still get correct poses (action drives
    // the drawing even though phrase isn't rendered as text).
    const items = Array.isArray(aiSlots) && aiSlots.length > 0
      ? aiSlots
      : phrases.map((p) => ({ phrase: p }));
    const cfg = items.slice(0, SLOT_COUNT).map((s) => {
      const slot = { phraseCustom: s.phrase };
      if (s.action) slot.action = s.action;
      return slot;
    });
    while (cfg.length < SLOT_COUNT) cfg.push(null);
    renderSlotGrid(cfg);
    themeGenStatus.textContent =
      `已填入：${phrases.slice(0, SLOT_COUNT).join(" / ")}`;
    setTimeout(() => { themeGenStatus.hidden = true; }, 8000);
  } catch (err) {
    themeGenStatus.textContent = `失敗：${err.message}`;
  } finally {
    themeGenBtn.disabled = false;
  }
});
settingsDialog.addEventListener("close", () => {
  if (settingsDialog.returnValue === "save") {
    state.slotConfig = readSlotConfigFromGrid();
    saveSlotConfig(state.slotConfig);
    refreshSlotStatus();
  }
});

async function openSettings() {
  await ensurePoolLoaded();
  renderSlotGrid(state.slotConfig);
  settingsDialog.showModal();
}

function renderSlotGrid(cfg) {
  slotGrid.innerHTML = "";
  for (let i = 0; i < SLOT_COUNT; i++) {
    slotGrid.appendChild(buildSlotCell(i, cfg[i]));
  }
}

function buildSlotCell(idx, slotValue) {
  const cell = document.createElement("div");
  cell.className = "slot-cell";
  cell.dataset.idx = String(idx);

  const head = document.createElement("div");
  head.className = "slot-head";
  head.textContent = `第 ${idx + 1} 格`;
  cell.appendChild(head);

  const sel = document.createElement("select");
  sel.className = "slot-select";
  sel.appendChild(new Option("隨機", "__random__"));
  poolCache.items.forEach((p) =>
    sel.appendChild(new Option(p.label, `preset:${p.id}`)),
  );
  sel.appendChild(new Option("自訂…", "__custom__"));
  cell.appendChild(sel);

  const customInput = document.createElement("input");
  customInput.type = "text";
  customInput.className = "slot-custom";
  customInput.placeholder = "中/英/日/梗圖台詞…例：「i 人崩潰中」「好惹好惹」「勿cue」";
  customInput.maxLength = 30;
  customInput.hidden = true;
  cell.appendChild(customInput);

  // Per-slot action override (English pose/expression description). Hidden
  // by default; toggled with a small "+ 動作" link. AI theme generator
  // pre-fills this from the {phrase, action} pairs it returns.
  const actionToggle = document.createElement("button");
  actionToggle.type = "button";
  actionToggle.className = "slot-action-toggle";

  const actionInput = document.createElement("input");
  actionInput.type = "text";
  actionInput.className = "slot-action";
  actionInput.placeholder = "english pose / facial expression (optional)";
  actionInput.maxLength = 120;
  actionInput.hidden = true;

  cell.appendChild(actionToggle);
  cell.appendChild(actionInput);

  const v = slotValue || {};
  if (typeof v.phraseCustom === "string" && v.phraseCustom) {
    sel.value = "__custom__";
    customInput.value = v.phraseCustom;
    customInput.hidden = false;
  } else if (Number.isInteger(v.phraseId)) {
    sel.value = `preset:${v.phraseId}`;
  } else {
    sel.value = "__random__";
  }
  if (typeof v.action === "string" && v.action) {
    actionInput.value = v.action;
    actionInput.hidden = false;
    actionToggle.textContent = "✕ 動作";
  } else {
    actionToggle.textContent = "+ 動作";
  }

  sel.addEventListener("change", () => {
    customInput.hidden = sel.value !== "__custom__";
    if (!customInput.hidden) customInput.focus();
  });
  actionToggle.addEventListener("click", () => {
    actionInput.hidden = !actionInput.hidden;
    actionToggle.textContent = actionInput.hidden ? "+ 動作" : "✕ 動作";
    if (!actionInput.hidden) actionInput.focus();
  });

  return cell;
}

function readSlotConfigFromGrid() {
  const cfg = new Array(SLOT_COUNT).fill(null);
  slotGrid.querySelectorAll(".slot-cell").forEach((cell) => {
    const i = parseInt(cell.dataset.idx, 10);
    const sel = cell.querySelector(".slot-select");
    const custom = cell.querySelector(".slot-custom");
    const actionEl = cell.querySelector(".slot-action");
    const actionVal = actionEl?.value.trim() || "";
    if (sel.value === "__custom__") {
      const t = custom.value.trim();
      if (t) {
        cfg[i] = { phraseCustom: t };
        if (actionVal) cfg[i].action = actionVal;
      }
    } else if (sel.value.startsWith("preset:")) {
      cfg[i] = { phraseId: parseInt(sel.value.slice(7), 10) };
      if (actionVal) cfg[i].action = actionVal;
    } else if (actionVal) {
      // Pure random phrase but custom action — possible if user only
      // wanted to bias the pose. Worker treats this as random phrase
      // (no pin) so we just drop the orphan action.
    }
  });
  return cfg;
}

function refreshSlotStatus() {
  let pinned = 0;
  let custom = 0;
  let withAction = 0;
  for (const s of state.slotConfig) {
    if (!s) continue;
    if (typeof s.phraseCustom === "string") custom += 1;
    else if (Number.isInteger(s.phraseId)) pinned += 1;
    if (typeof s.action === "string" && s.action) withAction += 1;
  }
  if (pinned === 0 && custom === 0) {
    slotStatusText.textContent = "目前：9 格短語全隨機（從內建 50 句抽）";
    return;
  }
  const parts = [];
  if (pinned > 0) parts.push(`指定 ${pinned} 句預設`);
  if (custom > 0) parts.push(`自訂 ${custom} 句`);
  const remain = SLOT_COUNT - pinned - custom;
  if (remain > 0) parts.push(`其他 ${remain} 格隨機`);
  if (withAction > 0) parts.push(`${withAction} 格附動作描述`);
  slotStatusText.textContent = `你挑了：${parts.join("、")}`;
}

async function copyPromptToGemini() {
  const styleErr = syncConfigFromControls();
  slotsCopyStatus.hidden = false;
  if (styleErr) {
    slotsCopyStatus.textContent = styleErr;
    setTimeout(() => { slotsCopyStatus.hidden = true; }, 8000);
    return;
  }
  const cfg = readSlotConfigFromGrid();
  slotsCopyStatus.textContent = "正在組 prompt…";
  try {
    const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slots: cfg,
        styleHint: state.styleHint,
        withText: state.withText,
        chromaKey: state.chromaKey,
        campaign: state.campaign,
        lang: state.textLang,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { prompt } = await resp.json();
    // Record FIRST (offline-reusable), then copy — clipboard can fail on
    // some browsers without killing the record.
    savePromptRecord(prompt).catch(() => {});
    await navigator.clipboard.writeText(prompt);
    slotsCopyStatus.textContent =
      "已複製！到 Gemini／ChatGPT 時：先上傳你的參考圖，再貼這段 prompt（沒附圖 prompt 不會套用到你的角色）。";
  } catch (err) {
    console.error(err);
    slotsCopyStatus.textContent = `複製失敗：${err.message}`;
  }
  setTimeout(() => { slotsCopyStatus.hidden = true; }, 8000);
}

// ------------------------------------------------------------------
// Library — prompt records / phrase sets / saved styles (issue #27)

const PROMPT_CAP = 50;

async function savePromptRecord(prompt) {
  const rec = {
    id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    prompt,
    meta: {
      styleHint: state.styleHint,
      withText: state.withText,
      chromaKey: state.chromaKey,
      campaign: state.campaign,
      lang: state.textLang,
    },
  };
  await idbPut("prompts", rec);
  const all = (await idbAllFrom("prompts")).sort((a, b) => b.ts - a.ts);
  for (const old of all.slice(PROMPT_CAP)) await idbDelFrom("prompts", old.id);
  renderPromptHistory();
}

async function renderPromptHistory() {
  const list = $("prompt-history-list");
  if (!list) return;
  const all = (await idbAllFrom("prompts")).sort((a, b) => b.ts - a.ts).slice(0, 10);
  list.innerHTML = "";
  if (all.length === 0) {
    list.innerHTML = '<p class="hint mini">還沒有紀錄 — 在「自訂 9 格」按過「複製 prompt」就會存到這裡。</p>';
    return;
  }
  for (const r of all) {
    const row = document.createElement("div");
    row.className = "prompt-history-item";
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.title = r.prompt;
    meta.textContent = `${relativeTime(r.ts)}・${r.meta?.styleHint || ""}・${r.prompt.slice(0, 42)}…`;
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ghost";
    copyBtn.textContent = "複製";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(r.prompt);
        showToast("prompt 已複製（記得先在 Gemini 附上參考圖）");
      } catch {
        window.prompt("手動複製：", r.prompt);
      }
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "ghost";
    delBtn.innerHTML = '<svg class="icon-14"><use href="#i-trash"/></svg>';
    delBtn.addEventListener("click", async () => {
      await idbDelFrom("prompts", r.id);
      renderPromptHistory();
    });
    row.appendChild(meta);
    row.appendChild(copyBtn);
    row.appendChild(delBtn);
    list.appendChild(row);
  }
}

// Phrase sets — save/load the 8-slot config by name.
async function renderPhraseSetSelect() {
  const sel = $("phrase-set-select");
  if (!sel) return;
  const all = (await idbAllFrom("phraseSets")).sort((a, b) => b.ts - a.ts);
  sel.innerHTML = "";
  sel.appendChild(new Option("載入短語組…", ""));
  for (const p of all) sel.appendChild(new Option(p.name, p.id));
}

$("phrase-set-save")?.addEventListener("click", async () => {
  const cfg = readSlotConfigFromGrid();
  if (cfg.every((s) => s === null)) { alert("目前 9 格全是隨機，沒東西可存。先填幾格再存。"); return; }
  const name = window.prompt("短語組名稱：", "");
  if (!name || !name.trim()) return;
  await idbPut("phraseSets", {
    id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 30),
    cfg,
    ts: Date.now(),
  });
  await renderPhraseSetSelect();
  showToast(`已存短語組「${name.trim()}」`);
});

$("phrase-set-select")?.addEventListener("change", async (e) => {
  const id = e.target.value;
  if (!id) return;
  const set = await idbGetFrom("phraseSets", id);
  if (set) {
    renderSlotGrid(set.cfg);
    showToast(`已載入短語組「${set.name}」— 記得按「儲存」套用`);
  }
  e.target.value = "";
});

// Saved styles — favorite custom style strings into the style dropdown.
async function renderSavedStyles() {
  if (!styleHintSel) return;
  const current = styleHintSel.value;
  styleHintSel.querySelector('optgroup[label="我的風格"]')?.remove();
  const all = (await idbAllFrom("styles")).sort((a, b) => b.ts - a.ts);
  if (all.length === 0) return;
  const group = document.createElement("optgroup");
  group.label = "我的風格";
  for (const st of all) group.appendChild(new Option(`⭐ ${st.name.slice(0, 40)}`, `saved:${st.name}`));
  // Keep「自訂…」last: insert the group before the custom option's position.
  styleHintSel.appendChild(group);
  styleHintSel.value = current;
}

$("style-save-btn")?.addEventListener("click", async () => {
  const text = $("style-custom-input")?.value.trim();
  if (!text || text.length < 2) { alert("先在上面輸入至少 2 個字的風格描述再收藏。"); return; }
  await idbPut("styles", {
    id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: text,
    ts: Date.now(),
  });
  await renderSavedStyles();
  styleHintSel.value = `saved:${text}`;
  $("style-custom-wrap").hidden = true;
  showToast("已收藏到「我的風格」");
});

// ------------------------------------------------------------------
// Vault export / import (issue #28) — the user's data is THEIRS: one
// zip carries assets + projects + library across machines. Import is a
// MERGE: existing ids are kept, new ids are added (idempotent).

async function exportVault() {
  if (!window.JSZip) { alert("JSZip 未載入"); return; }
  const zip = new JSZip();
  const generations = await idbListGenerations();
  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    generations: [],
    projects: await idbAllFrom("projects"),
    prompts: await idbAllFrom("prompts"),
    phraseSets: await idbAllFrom("phraseSets"),
    styles: await idbAllFrom("styles"),
    stickers: [],
    fonts: [],
  };
  for (const e of generations) {
    manifest.generations.push({
      id: e.id, source: e.source, timestamp: e.timestamp,
      name: e.name, starred: e.starred, metadata: e.metadata,
      gridFile: `assets/${e.id}.png`,
      thumbFile: `assets/${e.id}.thumb.jpg`,
    });
    zip.file(`assets/${e.id}.png`, e.gridBlob);
    if (e.thumbnailBlob) zip.file(`assets/${e.id}.thumb.jpg`, e.thumbnailBlob);
  }
  try {
    for (const f of await idbAllFrom("fonts")) {
      manifest.fonts.push({ name: f.name, file: `fonts/${f.name}.bin` });
      zip.file(`fonts/${f.name}.bin`, f.blob);
    }
  } catch { /* fonts store empty */ }
  try {
    for (const st of await idbAllFrom("stickers")) {
      const { pngBlob, ...meta } = st;
      manifest.stickers.push({ ...meta, file: `stickers/${st.id}.png` });
      zip.file(`stickers/${st.id}.png`, pngBlob);
    }
  } catch { /* stickers store empty */ }
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: "blob" });
  const stamp = new Date().toISOString().slice(0, 10);
  triggerDownload(blob, `sticker-studio-vault-${stamp}.zip`);
  showToast(`已匯出整庫（${manifest.generations.length} 張 grid、${manifest.projects.length} 個專案）`);
}

async function importVault(file) {
  if (!window.JSZip) { alert("JSZip 未載入"); return; }
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    alert("這不是有效的 zip 檔");
    return;
  }
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) { alert("zip 裡沒有 manifest.json — 不是本工具匯出的整庫"); return; }
  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.async("string"));
  } catch {
    alert("manifest.json 解析失敗");
    return;
  }
  const counts = { grids: 0, projects: 0, library: 0, fonts: 0, skipped: 0 };

  for (const g of manifest.generations || []) {
    if (await idbGetGeneration(g.id)) { counts.skipped++; continue; }
    const gridEntry = zip.file(g.gridFile);
    if (!gridEntry) { counts.skipped++; continue; }
    const gridBlob = new Blob([await gridEntry.async("arraybuffer")], { type: "image/png" });
    const thumbEntry = g.thumbFile ? zip.file(g.thumbFile) : null;
    const thumbnailBlob = thumbEntry
      ? new Blob([await thumbEntry.async("arraybuffer")], { type: "image/jpeg" })
      : await generateThumbnail(gridBlob);
    await idbSaveGeneration({
      id: g.id, source: g.source || "byog", timestamp: g.timestamp || Date.now(),
      name: g.name || null, starred: Boolean(g.starred),
      metadata: g.metadata || {}, gridBlob, thumbnailBlob,
    });
    counts.grids++;
  }
  for (const p of manifest.projects || []) {
    if (await idbGetFrom("projects", p.id)) { counts.skipped++; continue; }
    await idbPut("projects", p);
    counts.projects++;
  }
  for (const [store, key] of [["prompts", "prompts"], ["phraseSets", "phraseSets"], ["styles", "styles"]]) {
    for (const item of manifest[key] || []) {
      if (await idbGetFrom(store, item.id)) { counts.skipped++; continue; }
      await idbPut(store, item);
      counts.library++;
    }
  }
  for (const st of manifest.stickers || []) {
    if (await idbGetFrom("stickers", st.id)) { counts.skipped++; continue; }
    const entry = zip.file(st.file);
    if (!entry) continue;
    const pngBlob = new Blob([await entry.async("arraybuffer")], { type: "image/png" });
    const { file, ...meta } = st;
    await idbPut("stickers", { ...meta, pngBlob });
    counts.grids++;
  }
  for (const f of manifest.fonts || []) {
    if (await idbGetFrom("fonts", f.name)) { counts.skipped++; continue; }
    const entry = zip.file(f.file);
    if (!entry) continue;
    const blob = new Blob([await entry.async("arraybuffer")]);
    await idbPut("fonts", { id: f.name, name: f.name, blob });
    try { await registerUploadedFont(f.name, blob); } catch { /* bad font */ }
    counts.fonts++;
  }

  await renderHistoryUi();
  await renderCurrentGridUi();
  await renderStickerLibrary();
  await renderProjectBar();
  await renderPromptHistory();
  await renderPhraseSetSelect();
  await renderSavedStyles();
  rebuildFontSelect();
  showToast(
    `匯入完成：grid +${counts.grids}、專案 +${counts.projects}、Library +${counts.library}、字型 +${counts.fonts}` +
    (counts.skipped ? `（已存在略過 ${counts.skipped}）` : ""),
  );
}

$("vault-export-btn")?.addEventListener("click", () => exportVault());
$("vault-import-input")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (file) await importVault(file);
  e.target.value = "";
});

// ------------------------------------------------------------------
// Quota UI wiring (no login — just a counter chip)

const authQuotaEl = $("auth-quota");

function refreshAuthUi() {
  if (!authQuotaEl) return;
  if (auth.quota) {
    const remain = Math.max(0, auth.quota.limit - auth.quota.used);
    authQuotaEl.textContent = `今日 AI 剩 ${remain} / ${auth.quota.limit}`;
    authQuotaEl.classList.toggle("full", remain === 0);
  } else {
    authQuotaEl.textContent = "今日 AI 剩 — / —";
  }
}

// ------------------------------------------------------------------
// Init

// Apply i18n on boot
document.documentElement.lang = currentLang;
applyI18n();
const langSelect = $("lang-select");
if (langSelect) {
  langSelect.value = currentLang;
  langSelect.addEventListener("change", (e) => setLang(e.target.value));
}

// === Grid history (IndexedDB) ===

const currentGridArea = $("current-grid-area");
const currentGridEmpty = $("current-grid-empty");
const currentGridImg = $("current-grid-img");
const currentGridName = $("current-grid-name");
const currentGridSourceBadge = $("current-grid-source-badge");
const currentGridTime = $("current-grid-time");
const currentGridStarBtn = $("current-grid-star");
const currentGridDownloadBtn = $("current-grid-download");
const currentGridDeleteBtn = $("current-grid-delete");
const historySection = $("history-section");
const historyCards = $("history-cards");
const historyCount = $("history-count");

function showToast(message, action = null) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = action.label;
    b.addEventListener("click", () => { t.remove(); action.onClick(); });
    t.appendChild(b);
  }
  document.body.appendChild(t);
  setTimeout(() => t.remove(), action ? 8000 : 5200);
}
function escapeHtmlSafe(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
async function saveCurrentGridToHistory(source, metadata) {
  if (!state.lastGridPng) return;
  // Ask the browser to protect our storage from eviction — once.
  if (!localStorage.getItem("lss-persist-asked")) {
    localStorage.setItem("lss-persist-asked", "1");
    navigator.storage?.persist?.().catch(() => {});
  }
  const id = genHistoryId();
  const thumb = await generateThumbnail(state.lastGridPng);
  await idbSaveGeneration({
    id, source, timestamp: Date.now(),
    gridBlob: state.lastGridPng, thumbnailBlob: thumb,
    name: null, starred: false,
    metadata: metadata || {},
  });
  state.currentGridId = id;
  await pruneHistory();
  await renderCurrentGridUi();
  await renderHistoryUi();
}
async function pruneHistory() {
  // No auto-pruning any more (拍板 2026-07-09): this is the user's own
  // library on their own device — they manage it. Storage usage is shown
  // in the assets tab and the vault export covers backup/migration.
}

// --- Finished stickers (成品) — the studio's中段 asset (issue: 工作室分段) ---

async function stickerToCanvas(entry) {
  const img = await loadImage(URL.createObjectURL(entry.pngBlob));
  const c = document.createElement("canvas");
  c.width = STICKER_W;
  c.height = STICKER_H;
  c.getContext("2d").drawImage(img, 0, 0, STICKER_W, STICKER_H);
  return c;
}

async function appendFinishedSticker(id) {
  const entry = await idbGetFrom("stickers", id);
  if (!entry) return;
  const tile = makeTile(await stickerToCanvas(entry), {
    included: false,
    srcStickerId: id,
  });
  tile.transparent = true; // baked PNG is already final
  state.tiles.push(tile);
  $("step-preview").hidden = false;
  $("step-download").hidden = false;
  renderPool();
  showToast(`已加入成品貼圖（貼圖池共 ${state.tiles.length} 格）`);
  switchTab("pack");
}

async function projectsReferencingSticker(stickerId) {
  const all = await idbAllFrom("projects");
  return all.filter((p) => p.slots.some((sl) => sl.stickerId === stickerId));
}

// Pick ONE cell of a raw grid to edit directly (素材庫 → 編輯器,不經池).
async function openGridPicker(entry) {
  const dlg = $("grid-pick-dialog");
  const wrap = $("grid-pick-cells");
  if (!dlg || !wrap) return;
  const split = await splitGrid(
    await loadImage(URL.createObjectURL(entry.gridBlob)),
    entry.metadata?.chromaKey || null,
  );
  wrap.innerHTML = "";
  split.forEach((cv, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "grid-pick-cell";
    const im = document.createElement("img");
    im.src = cv.toDataURL("image/png");
    im.alt = `格 ${i + 1}`;
    b.appendChild(im);
    b.addEventListener("click", () => {
      dlg.close();
      const tile = makeTile(cv, {
        srcGridId: entry.id,
        srcIdx: i,
        phrase: entry.metadata?.phrases?.[i] || "",
        srcKey: split.key,
      });
      openDetachedEditor(tile, `素材編輯：第 ${i + 1} 格`);
    });
    wrap.appendChild(b);
  });
  dlg.showModal();
}
$("grid-pick-close")?.addEventListener("click", () => $("grid-pick-dialog").close());
$("grid-pick-dialog")?.addEventListener("click", (e) => {
  if (e.target === $("grid-pick-dialog")) e.target.close();
});

const stickerSelection = new Set();
let stickerTagFilter = "";

function refreshStickerBatchBar(total) {
  const bar = $("sticker-batch-bar");
  if (!bar) return;
  bar.hidden = total === 0;
  $("sticker-batch-count").textContent = stickerSelection.size
    ? `已勾 ${stickerSelection.size} 張` : "";
}

async function renderStickerLibrary() {
  const wrap = $("sticker-lib-cards");
  const section = $("sticker-lib-section");
  if (!wrap || !section) return;
  let all = [];
  try { all = await idbAllFrom("stickers"); } catch { /* pre-v3 */ }
  all.sort((a, b) => b.updatedAt - a.updatedAt);
  section.hidden = all.length === 0;
  $("sticker-lib-count").textContent = `(${all.length})`;
  // Tag filter options rebuild.
  const tagSel = $("sticker-tag-filter");
  if (tagSel) {
    tagSel.hidden = all.length === 0;
    const tags = [...new Set(all.map((x) => x.tag).filter(Boolean))].sort();
    tagSel.innerHTML = "";
    tagSel.appendChild(new Option("全部 tag", ""));
    for (const tg of tags) tagSel.appendChild(new Option(tg, tg));
    tagSel.value = tags.includes(stickerTagFilter) ? stickerTagFilter : "";
    if (tagSel.value === "") stickerTagFilter = "";
  }
  for (const id of [...stickerSelection]) {
    if (!all.some((x) => x.id === id)) stickerSelection.delete(id);
  }
  refreshStickerBatchBar(all.length);
  wrap.innerHTML = "";
  const shown = stickerTagFilter ? all.filter((x) => x.tag === stickerTagFilter) : all;
  for (const e of shown) {
    const card = document.createElement("div");
    card.className = "sticker-lib-card";
    card.title = e.name || "成品貼圖";
    const img = document.createElement("img");
    img.alt = e.name || "finished sticker";
    img.src = URL.createObjectURL(e.pngBlob);
    img.style.cursor = "zoom-in";
    img.title = "點我重新編輯（原參數可調）";
    img.addEventListener("click", async () => {
      const src = e.srcGridId ? await idbGetGeneration(e.srcGridId) : null;
      let tile;
      if (src) {
        const split = await splitGrid(
          await loadImage(URL.createObjectURL(src.gridBlob)),
          e.cleanParams?.key || src.metadata?.chromaKey || null,
        );
        const cv = split[e.srcIdx];
        if (cv) {
          tile = makeTile(cv, { srcGridId: e.srcGridId, srcIdx: e.srcIdx, srcKey: split.key });
          tile.textParams = e.textParams ? { ...e.textParams } : null;
          if (e.cleanParams) await cleanTile(tile, e.cleanParams);
        }
      }
      if (!tile) {
        tile = makeTile(await stickerToCanvas(e), {});
        tile.transparent = true;
        showToast("來源 grid 已不在素材庫 — 以定稿圖為底繼續編輯");
      }
      tile.srcStickerId = e.id;
      openDetachedEditor(tile, `重新編輯：${e.name || "成品"}`);
    });
    card.appendChild(img);
    const nameRow = document.createElement("div");
    nameRow.className = "sticker-lib-name";
    nameRow.textContent = e.name || `成品 ${shortStamp(e.createdAt || e.updatedAt)}`;
    nameRow.title = "點我改名";
    nameRow.addEventListener("click", async () => {
      const n = prompt("成品名稱：", e.name || "");
      if (n === null) return;
      await idbPut("stickers", { ...e, name: n.trim() || null, updatedAt: Date.now() });
      renderStickerLibrary();
    });
    card.appendChild(nameRow);
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "sticker-check";
    check.title = "勾選做批次操作";
    check.checked = stickerSelection.has(e.id);
    check.addEventListener("change", () => {
      if (check.checked) stickerSelection.add(e.id);
      else stickerSelection.delete(e.id);
      refreshStickerBatchBar(1);
    });
    card.appendChild(check);
    if (e.tag) {
      const pill = document.createElement("span");
      pill.className = "sticker-tag-pill";
      pill.textContent = e.tag;
      card.appendChild(pill);
    }
    const bar = document.createElement("div");
    bar.className = "sticker-lib-bar";
    const mk = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = label;
      b.title = title;
      b.addEventListener("click", fn);
      bar.appendChild(b);
    };
    mk("＋", "加入貼圖池", () => queuePoolOp(() => appendFinishedSticker(e.id)));
    mk('<svg class="icon-14"><use href="#i-trash"/></svg>', "刪除", async () => {
      const refs = await projectsReferencingSticker(e.id);
      const warn = refs.length
        ? `有 ${refs.length} 個專案（${refs.map((p) => p.name || p.id).join("、")}）用到這張成品，刪除後那些格子將無法還原。\n\n仍要刪除？`
        : "刪除這張成品貼圖?";
      if (!confirm(warn)) return;
      await idbDelFrom("stickers", e.id);
      renderStickerLibrary();
      renderHistoryUi();
    });
    card.appendChild(bar);
    wrap.appendChild(card);
  }
}

let assetsFilter = "all";

function assetsFilterMatch(e) {
  if (assetsFilter === "ai") return e.source === "ai";
  if (assetsFilter === "byog") return e.source === "byog";
  if (assetsFilter === "starred") return Boolean(e.starred);
  return true;
}

async function updateStorageUsage() {
  const el = $("storage-usage");
  if (!el) return;
  // NOTE: navigator.storage.estimate() covers the WHOLE origin — on
  // GitHub Pages that's every project under yazelin.github.io (their
  // IndexedDB + caches), which reads absurdly large. Count OUR blobs.
  try {
    let bytes = 0;
    for (const e of await idbListGenerations()) {
      bytes += (e.gridBlob?.size || 0) + (e.thumbnailBlob?.size || 0);
    }
    try {
      for (const f of await idbAllFrom("fonts")) bytes += f.blob?.size || 0;
    } catch { /* store empty */ }
    el.textContent = `素材庫占用約 ${(bytes / (1024 * 1024)).toFixed(1)} MB（存在你的瀏覽器）`;
  } catch { /* ignore */ }
}

async function renderPackSources(all) {
  const wrap = $("pack-sources");
  const cards = $("pack-source-cards");
  if (!wrap || !cards) return;
  cards.innerHTML = "";
  let finished = [];
  try { finished = (await idbAllFrom("stickers")).sort((a, b) => b.updatedAt - a.updatedAt); } catch { /* pre-v3 */ }
  if (all.length === 0 && finished.length === 0) { wrap.hidden = true; return; }
  wrap.hidden = false;
  for (const e of finished.slice(0, 12)) {
    const card = document.createElement("div");
    card.className = "pack-source-card is-finished";
    card.title = `成品：${e.name || e.id}`;
    const img = document.createElement("img");
    img.alt = "";
    img.src = URL.createObjectURL(e.pngBlob);
    card.appendChild(img);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "act-add";
    add.textContent = "＋";
    add.title = "把這張成品加入貼圖池";
    add.addEventListener("click", () => queuePoolOp(() => appendFinishedSticker(e.id)));
    card.appendChild(add);
    cards.appendChild(card);
  }
  for (const e of all.slice(0, 12)) {
    const card = document.createElement("div");
    card.className = "pack-source-card";
    card.title = e.name || `${e.source === "ai" ? "AI" : "BYOG"} grid`;
    const img = document.createElement("img");
    img.alt = "";
    img.src = URL.createObjectURL(e.thumbnailBlob);
    card.appendChild(img);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "act-add";
    add.textContent = "＋";
    add.title = "把這張 grid 的 9 格加入貼圖池";
    add.addEventListener("click", () => queuePoolOp(() => appendFromHistory(e.id)));
    card.appendChild(add);
    cards.appendChild(card);
  }
}

async function renderHistoryUi() {
  const all = await idbListGenerations();
  all.sort((a, b) => b.timestamp - a.timestamp);
  renderPackSources(all);
  historyCards.innerHTML = "";
  if (all.length === 0) { historySection.hidden = true; updateStorageUsage(); return; }
  historySection.hidden = false;
  const ns = all.filter((e) => !e.starred).length;
  const st = all.filter((e) => e.starred).length;
  historyCount.textContent = `(${ns}` + (st ? ` + ⭐ ${st}` : "") + ")";
  const shown = all.filter(assetsFilterMatch);
  for (const e of shown) historyCards.appendChild(buildHistoryCard(e));
  if (shown.length === 0) {
    const p = document.createElement("p");
    p.className = "hint mini";
    p.id = "assets-filter-empty";
    p.textContent = "這個篩選目前沒有項目。";
    historyCards.appendChild(p);
  }
  updateStorageUsage();
}
function buildHistoryCard(e) {
  const card = document.createElement("div");
  card.className = "history-card";
  if (e.id === state.currentGridId) card.classList.add("selected");
  const sourceIcon = e.source === "ai" ? "AI" : "上傳";
  const styleLabel = e.metadata?.styleHint || e.metadata?.fileName ||
    (e.source === "byog" ? "BYOG" : "?");
  const displayName = e.name || `${e.source === "ai" ? "AI" : "BYOG"} ${shortStamp(e.timestamp)}`;
  card.innerHTML = `
    <div class="history-card-badges">${sourceIcon}${e.starred ? ' <svg class="icon-12"><use href="#i-star-fill"/></svg>' : ""}</div>
    <img alt="" />
    <div class="history-card-name" title="${escapeHtmlSafe(displayName)}">${escapeHtmlSafe(displayName)}</div>
    <div class="history-card-meta">${escapeHtmlSafe(String(styleLabel).slice(0,18))} · ${escapeHtmlSafe(relativeTime(e.timestamp))}</div>
    <div class="history-card-actions">
      <button class="act-load" title="載入（取代目前貼圖池）">↻</button>
      <button class="act-add" title="加入貼圖池（湊 16/24/32/40 張大套組）">＋</button>
      <button class="act-star" title="${e.starred ? "取消收藏" : "收藏"}"><svg class="icon-14"><use href="${e.starred ? "#i-star-fill" : "#i-star"}"/></svg></button>
      <button class="act-delete" title="刪除"><svg class="icon-14"><use href="#i-trash"/></svg></button>
    </div>`;
  const cardImg = card.querySelector("img");
  cardImg.src = URL.createObjectURL(e.thumbnailBlob);
  cardImg.style.cursor = "zoom-in";
  cardImg.title = "點我挑一格直接編輯（不動貼圖池）";
  cardImg.addEventListener("click", () => openGridPicker(e));
  const nameEl = card.querySelector(".history-card-name");
  nameEl.style.cursor = "text";
  nameEl.title = "點我改名";
  nameEl.onclick = async () => {
    const n = prompt("素材名稱：", e.name || "");
    if (n === null) return;
    await idbUpdateGeneration(e.id, { name: n.trim() || null });
    if (state.currentGridId === e.id) await renderCurrentGridUi();
    await renderHistoryUi();
  };
  card.querySelector(".act-load").onclick = () => queuePoolOp(() => loadFromHistory(e.id));
  card.querySelector(".act-add").onclick = () => queuePoolOp(() => appendFromHistory(e.id));
  card.querySelector(".act-star").onclick = async () => {
    await idbUpdateGeneration(e.id, { starred: !e.starred });
    if (state.currentGridId === e.id) await renderCurrentGridUi();
    await renderHistoryUi();
  };
  card.querySelector(".act-delete").onclick = async () => {
    const refs = await projectsReferencingGrid(e.id);
    const warn = refs.length
      ? `有 ${refs.length} 個專案（${refs.map((p) => p.name || p.id).join("、")}）用到這張 grid，刪除後那些格子將無法還原。\n\n仍要刪除？`
      : "刪除這張 grid?";
    if (!confirm(warn)) return;
    await idbDeleteGeneration(e.id);
    if (state.currentGridId === e.id) {
      state.currentGridId = null;
      state.lastGridPng = null;
      await renderCurrentGridUi();
    }
    await renderHistoryUi();
  };
  return card;
}
async function renderCurrentGridUi() {
  if (!state.currentGridId) {
    currentGridArea.hidden = true;
    currentGridEmpty.hidden = false;
    return;
  }
  const e = await idbGetGeneration(state.currentGridId);
  if (!e) {
    state.currentGridId = null;
    currentGridArea.hidden = true;
    currentGridEmpty.hidden = false;
    return;
  }
  currentGridArea.hidden = false;
  currentGridEmpty.hidden = true;
  currentGridImg.src = URL.createObjectURL(e.gridBlob);
  currentGridSourceBadge.textContent = e.source === "ai" ? "AI 生成" : "自上傳";
  currentGridName.value = e.name || "";
  currentGridName.placeholder = e.metadata?.styleHint || e.metadata?.fileName || "(未命名 — 點此重命名)";
  const meta = [];
  meta.push(relativeTime(e.timestamp));
  if (e.metadata?.styleHint) meta.push(e.metadata.styleHint);
  if (e.metadata?.campaign) meta.push(e.metadata.campaign);
  currentGridTime.textContent = meta.join(" · ");
  currentGridStarBtn.textContent = e.starred ? "已收藏" : "收藏";
}
currentGridName?.addEventListener("change", async (ev) => {
  if (!state.currentGridId) return;
  await idbUpdateGeneration(state.currentGridId, { name: ev.target.value.trim() || null });
  await renderHistoryUi();
});
currentGridStarBtn?.addEventListener("click", async () => {
  if (!state.currentGridId) return;
  const e = await idbGetGeneration(state.currentGridId);
  await idbUpdateGeneration(state.currentGridId, { starred: !e.starred });
  await renderCurrentGridUi();
  await renderHistoryUi();
});
currentGridDownloadBtn?.addEventListener("click", async () => {
  if (!state.currentGridId) return;
  const e = await idbGetGeneration(state.currentGridId);
  triggerDownload(e.gridBlob, `grid-${e.name || e.id}.png`);
});
currentGridDeleteBtn?.addEventListener("click", async () => {
  if (!state.currentGridId) return;
  if (!confirm("刪除目前這張 grid?")) return;
  await idbDeleteGeneration(state.currentGridId);
  state.currentGridId = null;
  state.lastGridPng = null;
  await renderCurrentGridUi();
  await renderHistoryUi();
});
async function loadFromHistory(id) {
  const e = await idbGetGeneration(id);
  if (!e) return;
  if (!confirmPoolReplace()) return;
  state.currentGridId = id;
  state.lastGridPng = e.gridBlob;
  state.tiles = [];
  state.mainTile = null;
  state.tabTile = null;
  state.bgRemoved = false;
  startNewProjectIdentity();
  if (e.metadata?.styleHint) state.styleHint = e.metadata.styleHint;
  if (e.metadata?.campaign !== undefined) state.campaign = e.metadata.campaign;
  if (e.metadata?.withText !== undefined) state.withText = e.metadata.withText;
  setChromaKey(e.metadata?.chromaKey || "green");
  const img = await loadImage(URL.createObjectURL(e.gridBlob));
  const tiles = await splitGrid(img, e.metadata?.chromaKey || null);
  $("step-preview").hidden = false;
  const grid = $("stickers-grid");
  grid.innerHTML = "";
  for (let i = 0; i < GRID_SIZE; i++) grid.appendChild(buildPlaceholderCell(i));
  for (let i = 0; i < GRID_SIZE; i++) {
    state.tiles.push(makeTile(tiles[i], {
      phrase: e.metadata?.phrases?.[i] || "",
      included: i < PACK_SIZE,
      srcGridId: e.id,
      srcIdx: i,
      srcKey: tiles.key,
    }));
  }
  renderPool();
  $("step-download").hidden = false;
  await renderCurrentGridUi();
  await renderHistoryUi();
  switchTab("pack");
}

refreshEstimate();
refreshSlotStatus();
refreshTextLangAvailability();
renderPackSizeChips();
renderThemeChips();

// --- Assets toolbar wiring (issue #26) ---
document.querySelectorAll(".assets-filter").forEach((b) =>
  b.addEventListener("click", () => {
    assetsFilter = b.dataset.filter;
    document.querySelectorAll(".assets-filter").forEach((x) =>
      x.classList.toggle("selected", x === b));
    renderHistoryUi();
  }));
$("assets-import-btn")?.addEventListener("click", () => gridFileInput.click());
$("sticker-tag-filter")?.addEventListener("change", (e) => {
  stickerTagFilter = e.target.value;
  renderStickerLibrary();
});
$("sticker-batch-pool")?.addEventListener("click", () => {
  const ids = [...stickerSelection];
  if (ids.length === 0) { showToast("先勾選幾張成品"); return; }
  queuePoolOp(async () => {
    for (const id of ids) await appendFinishedSticker(id);
  });
  stickerSelection.clear();
  renderStickerLibrary();
});
$("sticker-batch-tag")?.addEventListener("click", async () => {
  const ids = [...stickerSelection];
  if (ids.length === 0) { showToast("先勾選幾張成品"); return; }
  const tg = prompt(`為勾選的 ${ids.length} 張設定 tag（留空 = 清除）：`, "");
  if (tg === null) return;
  for (const id of ids) {
    const e = await idbGetFrom("stickers", id);
    if (e) await idbPut("stickers", { ...e, tag: tg.trim() || null, updatedAt: Date.now() });
  }
  renderStickerLibrary();
});
$("sticker-batch-delete")?.addEventListener("click", async () => {
  const ids = [...stickerSelection];
  if (ids.length === 0) { showToast("先勾選幾張成品"); return; }
  if (!confirm(`刪除勾選的 ${ids.length} 張成品？（引用它們的專案格子會失效）`)) return;
  for (const id of ids) await idbDelFrom("stickers", id);
  stickerSelection.clear();
  await renderStickerLibrary();
  renderHistoryUi();
});

// --- Project bar wiring (issue #25) ---
$("project-select")?.addEventListener("change", (e) => {
  const id = e.target.value;
  if (!id) return; //「新草稿」占位 — 用「新增」按鈕開新專案
  queuePoolOp(() => openProject(id));
});
$("project-name")?.addEventListener("change", async (e) => {
  state.projectName = e.target.value.trim();
  if (state.tiles.length > 0) await saveProjectNow();
});
$("project-new")?.addEventListener("click", () => {
  if (state.tiles.length > 0 &&
      !confirm("開新專案會清空目前貼圖池（目前專案已自動儲存，隨時可切回）。繼續？")) {
    return;
  }
  state.tiles = [];
  state.mainTile = null;
  state.tabTile = null;
  startNewProjectIdentity();
  $("step-preview").hidden = true;
  $("step-download").hidden = true;
  renderPool();
  renderProjectBar();
  showToast("已開新草稿 — 從企劃生圖或素材庫加格子進來");
});
$("project-delete")?.addEventListener("click", async () => {
  if (!state.projectId) { showToast("目前是未儲存的草稿，沒有可刪的專案"); return; }
  if (!confirm(`刪除專案「${state.projectName || state.projectId}」？素材庫的 grid 不受影響。`)) return;
  await idbDelFrom("projects", state.projectId);
  if (localStorage.getItem(LAST_PROJECT_KEY) === state.projectId) {
    localStorage.removeItem(LAST_PROJECT_KEY);
  }
  state.tiles = [];
  state.mainTile = null;
  state.tabTile = null;
  startNewProjectIdentity();
  $("step-preview").hidden = true;
  $("step-download").hidden = true;
  renderPool();
  renderProjectBar();
});
// step-config is always visible now (so BYOG users can use settings dialog
// to copy prompt for Gemini), so eager-load campaigns at boot.
ensureCampaignsLoaded().then(renderCampaignPicker);
// Eager-load the phrase pool too — costs one tiny GET, and the SW's
// stale-while-revalidate cache then keeps the dropdown usable offline.
ensurePoolLoaded();
// Eager-load grid history (will show 🅱 carousel + last loaded grid).
renderCurrentGridUi();
renderHistoryUi();
renderStickerLibrary();
migrateThumbnailsOnce();
// Restore the last active project (multi-project, issue #25).
queuePoolOp(() => restoreLastProject());
// Re-register uploaded fonts (issue #8).
loadStoredFonts();
// Library boot renders (issue #27).
renderPromptHistory();
renderPhraseSetSelect();
renderSavedStyles();

// LINE rules acknowledgment — gate both upload boxes until user checks.
const RULES_ACK_KEY = "line-sticker-rules-acked";
const rulesBanner = $("rules-banner");
const rulesAck = $("rules-ack");
function refreshRulesGate() {
  const acked = rulesAck.checked;
  rulesBanner.classList.toggle("acked", acked);
  dropZone.classList.toggle("locked", !acked);
  gridDropZone.classList.toggle("locked", !acked);
  if (acked) localStorage.setItem(RULES_ACK_KEY, "1");
  else localStorage.removeItem(RULES_ACK_KEY);
}
rulesAck.checked = localStorage.getItem(RULES_ACK_KEY) === "1";
rulesAck.addEventListener("change", refreshRulesGate);
refreshRulesGate();
// --- PWA: service worker + offline degradation (issue #3) ---
if ("serviceWorker" in navigator) {
  // Relative path → correct scope under the GitHub Pages subpath.
  navigator.serviceWorker.register("./sw.js").catch((err) => {
    console.warn("SW register failed (site still works online):", err);
  });
}

const offlineBanner = $("offline-banner");
function refreshOnlineUi() {
  const off = !navigator.onLine;
  if (offlineBanner) offlineBanner.hidden = !off;
  document.body.classList.toggle("is-offline", off);
  // Network-dependent actions pause while offline. Everything local
  // (import/split/clean/pack/history) stays untouched.
  generateBtn.disabled = off;
  if (themeGenBtn) themeGenBtn.disabled = off;
  if (slotsCopyBtn) slotsCopyBtn.disabled = off;
  if (off) {
    generateBtn.title = "離線中 — AI 生成需要網路";
  } else {
    generateBtn.title = "";
  }
}
window.addEventListener("online", refreshOnlineUi);
window.addEventListener("offline", refreshOnlineUi);
refreshOnlineUi();

(async () => {
  // Hydrate quota counter + Turnstile site key in parallel. The
  // Turnstile widget needs the site key from /config — once we have
  // it, kick off render. setupTurnstileWidget polls for the global
  // `window.turnstile` so we don't care whether the api.js script has
  // finished loading at this point.
  await Promise.all([refreshQuota(), loadTurnstileConfig()]);
  refreshAuthUi();
  setupTurnstileWidget();
})();
