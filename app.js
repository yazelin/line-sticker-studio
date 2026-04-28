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
const IDB_VERSION = 1;
const IDB_STORE = "generations";
const HISTORY_NONSTARRED_CAP = 30;

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
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return _idbPromise;
}
function idbTx(mode, fn) {
  return idbOpen().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, mode);
    const store = tx.objectStore(IDB_STORE);
    const result = fn(store);
    tx.oncomplete = () => res(result);
    tx.onerror = () => rej(tx.error);
  }));
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
  const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
}

function genHistoryId() {
  return `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
const LINE_TOKEN_KEY = "line-access-token";
const LINE_VERIFIER_KEY = "line-pkce-verifier";
const LINE_STATE_KEY = "line-oauth-state";
const LINE_CHANNEL_ID = "2009916047";
const DEFAULT_API_URL = "https://line-sticker-gemini.yazelinj303.workers.dev";
const LANG_KEY = "line-sticker-lang";
// Sticker-text language: separate from UI language. Controls (a) the
// language AI uses when brainstorming 8 phrases and (b) the script AI
// uses when rendering text onto the sticker. Default zh-TW (Taiwan).
const TEXT_LANG_KEY = "line-sticker-text-lang";
const SUPPORTED_TEXT_LANGS = ["zh-TW", "zh-CN", "en", "ja", "ko"];
function loadTextLang() {
  const v = localStorage.getItem(TEXT_LANG_KEY);
  return SUPPORTED_TEXT_LANGS.includes(v) ? v : "zh-TW";
}
function saveTextLang(lang) {
  if (SUPPORTED_TEXT_LANGS.includes(lang)) {
    localStorage.setItem(TEXT_LANG_KEY, lang);
  }
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
    "zh-TW": "🅰 主路徑：上傳角色圖讓 AI 產（每天 3 次免費，需 LINE 登入）",
    "zh-CN": "🅰 主路径：上传角色图让 AI 产（每天 3 次免费，需 LINE 登入）",
    "en": "🅰 Main path: upload a character image, let AI generate (3 free/day, LINE login required)",
    "ja": "🅰 メイン: キャラ画像をアップ、AI に生成させる（1日3回無料、LINE ログイン必要）",
    "ko": "🅰 메인 경로: 캐릭터 업로드 → AI 생성 (하루 3회 무료, LINE 로그인 필요)",
  },
  step_b_title: {
    "zh-TW": "🅱 替代路徑：直接上傳 3×3 圖（省 API、自己跑 Gemini）",
    "zh-CN": "🅱 替代路径：直接上传 3×3 图（省 API、自己跑 Gemini）",
    "en": "🅱 Alt path: upload your own 3×3 grid (saves API cost, run Gemini yourself)",
    "ja": "🅱 代替: 自分で作った 3×3 グリッドをアップ (API節約、Geminiを自分で実行)",
    "ko": "🅱 대체 경로: 직접 만든 3×3 그리드 업로드 (API 절약, Gemini 직접 실행)",
  },
  step_config_title: {
    "zh-TW": "② 選樣式 + 短語（兩條路徑共用）",
    "zh-CN": "② 选样式 + 短语（两条路径共用）",
    "en": "② Style + phrases (shared by both paths)",
    "ja": "② スタイル + フレーズ (両経路共通)",
    "ko": "② 스타일 + 문구 (양 경로 공통)",
  },
  step_preview_title: {
    "zh-TW": "③ 預覽 + 去背",
    "zh-CN": "③ 预览 + 去背",
    "en": "③ Preview + Background Removal",
    "ja": "③ プレビュー + 背景除去",
    "ko": "③ 미리보기 + 배경 제거",
  },
  step_download_title: {
    "zh-TW": "④ 下載 + 上架",
    "zh-CN": "④ 下载 + 上架",
    "en": "④ Download + Submit",
    "ja": "④ ダウンロード + アップロード",
    "ko": "④ 다운로드 + 업로드",
  },
  generate_btn: {
    "zh-TW": "開始生成貼圖",
    "zh-CN": "开始生成贴图",
    "en": "Generate Stickers",
    "ja": "スタンプを生成",
    "ko": "스티커 생성",
  },
  bg_remove_btn: {
    "zh-TW": "全部去背（chroma key）",
    "zh-CN": "全部去背（chroma key）",
    "en": "Remove all backgrounds (chroma key)",
    "ja": "全部の背景を除去 (chroma key)",
    "ko": "모든 배경 제거 (chroma key)",
  },
  bg_restore_btn: {
    "zh-TW": "還原綠底",
    "zh-CN": "还原绿底",
    "en": "Restore green bg",
    "ja": "緑背景に戻す",
    "ko": "녹색 배경 복원",
  },
  download_grid_btn: {
    "zh-TW": "下載原始 grid",
    "zh-CN": "下载原始 grid",
    "en": "Download raw grid",
    "ja": "元のグリッドをダウンロード",
    "ko": "원본 그리드 다운로드",
  },
  download_zip_btn: {
    "zh-TW": "下載這組 ZIP（8 張貼圖 + main + tab + 說明）",
    "zh-CN": "下载这组 ZIP（8 张贴图 + main + tab + 说明）",
    "en": "Download this set as ZIP (8 stickers + main + tab + README)",
    "ja": "このセットを ZIP でダウンロード (8 スタンプ + main + tab + 説明)",
    "ko": "이 세트 ZIP 다운로드 (8 스티커 + main + tab + README)",
  },
  open_camera_btn: {
    "zh-TW": "📷 用相機現拍",
    "zh-CN": "📷 用相机现拍",
    "en": "📷 Use camera",
    "ja": "📷 カメラを使う",
    "ko": "📷 카메라 사용",
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
  auth_login_btn: {
    "zh-TW": "用 LINE 登入解鎖 AI 生成",
    "zh-CN": "用 LINE 登入解锁 AI 生成",
    "en": "Login with LINE to unlock AI generation",
    "ja": "LINE でログインして AI 生成を解放",
    "ko": "LINE으로 로그인하여 AI 생성 해제",
  },
  auth_logout: {
    "zh-TW": "登出", "zh-CN": "登出", "en": "Log out", "ja": "ログアウト", "ko": "로그아웃",
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
}
const ESTIMATED_GRID_SECONDS = 50; // per 3×3 grid
// LINE Creators Market accepts only 8/16/24/32/40 stickers per pack —
// 8 is the minimum we ship. Gemini gives us a 3×3 grid (9 tiles), so
// we show all 9 and let the user de-select 1 they like least before ZIP.
const GRID_SIZE = 9;
const PACK_SIZE = 8;

// Per-slot config persisted in localStorage. length-8 array, each entry:
//   null              → fully random (worker picks)
//   { phraseId: N }   → pin to default-phrase #N
//   { phraseCustom }  → free text
function loadSlotConfig() {
  try {
    const raw = localStorage.getItem(SLOT_CONFIG_KEY);
    if (!raw) return new Array(PACK_SIZE).fill(null);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== PACK_SIZE) {
      return new Array(PACK_SIZE).fill(null);
    }
    return parsed;
  } catch {
    return new Array(PACK_SIZE).fill(null);
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
// LINE Login (PKCE flow, all client-side — no Channel Secret needed)

const auth = {
  user: null,        // { userId, displayName, pictureUrl } when logged in
  quota: null,       // { used, limit }
  token: null,       // LINE access_token
  isAdmin: false,    // from /me — gates the admin reset button
};

function getStoredToken() {
  return localStorage.getItem(LINE_TOKEN_KEY);
}

function clearAuth() {
  localStorage.removeItem(LINE_TOKEN_KEY);
  auth.user = null;
  auth.quota = null;
  auth.token = null;
  auth.isAdmin = false;
}

function genVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function genChallenge(verifier) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(buf));
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function redirectUri() {
  return window.location.origin + window.location.pathname;
}

// PKCE verifier + state TTL: 10 minutes is plenty for round-trip
// through LINE Login while preventing stale entries from haunting
// future sign-in attempts.
const LINE_PKCE_TTL_MS = 10 * 60 * 1000;
const LINE_PKCE_TS_KEY = "line-pkce-ts";

// Detect LINE in-app browser via UA. Only used to tweak the error
// message — both branches use the same auth flow.
function isLineInAppBrowser() {
  return /Line\//i.test(navigator.userAgent);
}

async function startLineLogin() {
  const verifier = genVerifier();
  const challenge = await genChallenge(verifier);
  const state = genVerifier();
  // IMPORTANT: localStorage, NOT sessionStorage.
  // sessionStorage is per-tab/per-webview-instance. iOS LINE in-app
  // browser opens `access.line.me` via Universal Link → kicks the user
  // into the LINE app for native auth → callback returns into a
  // potentially-new webview context. sessionStorage from the original
  // tab is gone → state mismatch. localStorage survives because it's
  // origin-scoped, not session-scoped.
  localStorage.setItem(LINE_VERIFIER_KEY, verifier);
  localStorage.setItem(LINE_STATE_KEY, state);
  localStorage.setItem(LINE_PKCE_TS_KEY, String(Date.now()));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: LINE_CHANNEL_ID,
    redirect_uri: redirectUri(),
    state,
    scope: "profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.href =
    `https://access.line.me/oauth2/v2.1/authorize?${params}`;
}

function clearPkceStorage() {
  localStorage.removeItem(LINE_VERIFIER_KEY);
  localStorage.removeItem(LINE_STATE_KEY);
  localStorage.removeItem(LINE_PKCE_TS_KEY);
}

async function handleOAuthCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");
  if (!code && !oauthErr) return false;

  // Always strip OAuth params from the URL bar — even on failure.
  const cleanUrl = url.pathname + (url.hash || "");

  if (oauthErr) {
    alert(`LINE 登入失敗：${oauthErr} ${url.searchParams.get("error_description") || ""}`);
    window.history.replaceState({}, document.title, cleanUrl);
    return false;
  }

  const expectedState = localStorage.getItem(LINE_STATE_KEY);
  const verifier = localStorage.getItem(LINE_VERIFIER_KEY);
  const startedAt = parseInt(localStorage.getItem(LINE_PKCE_TS_KEY) || "0", 10);
  const ageOk = startedAt && (Date.now() - startedAt) < LINE_PKCE_TTL_MS;

  if (!expectedState || state !== expectedState || !verifier || !ageOk) {
    const inApp = isLineInAppBrowser();
    const inAppHint = inApp
      ? "\n\n📱 偵測到你正在 LINE 內建瀏覽器中。LINE app 會把授權跳到外部 → 回來時可能跑到不同分頁，登入資料就遺失了。\n\n👉 解法：請點右上角「⋯」→「在 Safari 開啟」(iOS) /「在 Chrome 開啟」(Android)，重新登入。"
      : "\n\n如果剛剛切過分頁、或經過很長時間才回來，請重新點「用 LINE 登入」再試一次。";
    alert(`LINE 登入逾時或被中斷。${inAppHint}`);
    clearPkceStorage();
    window.history.replaceState({}, document.title, cleanUrl);
    return false;
  }

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: LINE_CHANNEL_ID,
      code_verifier: verifier,
    });
    const resp = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!resp.ok) {
      throw new Error(`token exchange failed: ${resp.status} ${await resp.text()}`);
    }
    const tok = await resp.json();
    localStorage.setItem(LINE_TOKEN_KEY, tok.access_token);
    auth.token = tok.access_token;
  } catch (err) {
    console.error(err);
    alert(`LINE 登入失敗：${err.message}`);
  } finally {
    clearPkceStorage();
    window.history.replaceState({}, document.title, cleanUrl);
  }
  return true;
}

// Cross-tab quota sync — when one tab generates / hits 429, broadcast
// the new quota numbers to all other open tabs of this app so their
// "今日剩 X/3" counter stays accurate without polling.
const authBroadcast = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("line-sticker-auth")
  : null;
if (authBroadcast) {
  authBroadcast.onmessage = (e) => {
    if (e.data?.type === "quota-update" && e.data.quota) {
      auth.quota = e.data.quota;
      refreshAuthUi();
    } else if (e.data?.type === "auth-cleared") {
      clearAuth();
      refreshAuthUi();
    }
  };
}
function broadcastQuota(quota) {
  if (authBroadcast && quota) {
    authBroadcast.postMessage({ type: "quota-update", quota });
  }
}
function broadcastAuthCleared() {
  if (authBroadcast) authBroadcast.postMessage({ type: "auth-cleared" });
}

async function refreshAuth() {
  auth.token = getStoredToken();
  if (!auth.token) {
    auth.user = null;
    auth.quota = null;
    return;
  }
  const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
  try {
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/me", {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (resp.status === 401) {
      clearAuth();
      return;
    }
    if (!resp.ok) throw new Error(`/me ${resp.status}`);
    const data = await resp.json();
    auth.user = data.user;
    auth.quota = data.quota;
    auth.isAdmin = !!data.isAdmin;
  } catch (err) {
    console.warn("refreshAuth failed:", err);
    // Don't clear token on transient network errors — only on 401.
  }
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
    console.warn("phrase pool fetch failed; user dropdown will be empty", err);
    poolCache.items = [];
    poolCache.loaded = true;
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
  campaign: null,        // null or campaign id
  slotConfig: loadSlotConfig(), // length-PACK_SIZE
  tiles: [],             // [{ canvas, transparent: false, phrase, busy: false }]
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
  state.bgRemoved = false;
  fileInput.value = "";
  sourcePreview.hidden = true;
  dropZone.hidden = false;
  $("step-preview").hidden = true;
  $("step-download").hidden = true;
  $("gen-progress").hidden = true;
  $("bg-progress").hidden = true;
  $("bg-restore-btn").hidden = true;
  $("stickers-grid").innerHTML = "";
  document.body.classList.remove("byog-mode");
}

// ------------------------------------------------------------------
// Step 2 — config + generate

const styleHintSel = $("style-hint");
const withTextSel = $("with-text");
const textLangSel = $("text-lang");
const generateBtn = $("generate-btn");

if (textLangSel) {
  textLangSel.value = state.textLang;
  textLangSel.addEventListener("change", () => {
    state.textLang = textLangSel.value;
    saveTextLang(state.textLang);
  });
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
    `預估：<strong>1</strong> 次 API 呼叫、約 <strong>${ESTIMATED_GRID_SECONDS}</strong> 秒，產出 <strong>${PACK_SIZE}</strong> 張 LINE 規格貼圖（370 × 320）。`;
}

generateBtn.addEventListener("click", () => generateAll());

// Toggle the custom style input when user picks "✏️ 自訂…".
styleHintSel.addEventListener("change", () => {
  const wrap = $("style-custom-wrap");
  if (!wrap) return;
  wrap.hidden = styleHintSel.value !== "__custom__";
  if (!wrap.hidden) $("style-custom-input")?.focus();
});

async function generateAll() {
  if (!state.sourceImage) return;
  // Resolve effective styleHint: if user picked __custom__, use the
  // free-form text input verbatim (worker accepts any string).
  if (styleHintSel.value === "__custom__") {
    const customStyle = $("style-custom-input")?.value.trim();
    if (!customStyle || customStyle.length < 2) {
      alert("請填入至少 2 個字的風格描述（例：「梵谷風」「cyberpunk」）");
      return;
    }
    state.styleHint = customStyle;
  } else {
    state.styleHint = styleHintSel.value;
  }
  if (!auth.token) {
    const ok = confirm(
      "AI 生成需要 LINE 登入（每天 3 次免費）。\n\n" +
      "→ 確定：跳轉到 LINE 登入\n" +
      "→ 取消：先下捲用「替代路徑」自己跑 Gemini、上傳 3×3 圖（免登入、免費、不限次）",
    );
    if (ok) { startLineLogin(); }
    else {
      $("step-byog").scrollIntoView({ behavior: "smooth", block: "start" });
      $("step-byog").classList.add("flash-highlight");
      setTimeout(() => $("step-byog").classList.remove("flash-highlight"), 2000);
    }
    return;
  }
  if (auth.quota && auth.quota.used >= auth.quota.limit) {
    showQuotaExceededModal();
    return;
  }
  state.styleHint = styleHintSel.value;
  state.withText = withTextSel.value === "true";
  state.tiles = [];
  state.bgRemoved = false;
  $("bg-restore-btn").hidden = true;

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
    const result = await fetchGrid(apiUrl, {
      imageBase64: base64,
      mimeType,
      slots: state.slotConfig,
      styleHint: state.styleHint,
      withText: state.withText,
      campaign: state.campaign,
      lang: state.textLang,
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
      phrases: result.phrases,
    });
    const tiles = await splitGrid(gridImg);
    // Gemini gives 9 tiles. LINE only accepts 8 per pack, so we show all
    // 9 and pre-select the first 8 — user can swap which one to drop.
    for (let i = 0; i < GRID_SIZE; i++) {
      const tile = {
        canvas: tiles[i],
        transparent: false,
        phrase: result.phrases?.[i] || "",
        busy: false,
        included: i < PACK_SIZE,
      };
      state.tiles.push(tile);
      renderTileIntoCell(i, tile);
    }
    refreshSelectionStatus();

    setGenProgress(100, `完成！產出 ${GRID_SIZE} 張、預設前 ${PACK_SIZE} 張打包。可點 9 號那張的「✓」改成它而排除其他。`);
    $("step-download").hidden = false;
    $("step-preview").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    clearInterval(ticker);
    console.error(err);
    if (err.code === "QUOTA_EXCEEDED") {
      setGenProgress(0, `今日 ${auth.quota?.limit || 3} 次免費 AI 生成已用完`);
      showQuotaExceededModal();
    } else if (err.code === "AUTH_REQUIRED") {
      setGenProgress(0, "需要重新登入 LINE");
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
  const proceed = confirm(
    `今天的 ${auth.quota?.limit || 3} 次 AI 生成已用完 🥲\n\n` +
    "免費替代方案：複製 prompt 自己到 gemini.google.com 跑、把 3×3 圖丟到 BYOG 上傳框。\n\n" +
    "→ 確定：開「自訂 8 格」dialog 複製 prompt\n" +
    "→ 取消：直接捲到 BYOG 上傳框",
  );
  if (proceed) {
    openSettings();
  } else {
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
  const headers = { "Content-Type": "application/json" };
  if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`;
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (resp.status === 401) {
    clearAuth();
    refreshAuthUi();
    const e = new Error("AUTH_REQUIRED");
    e.code = "AUTH_REQUIRED";
    throw e;
  }
  if (resp.status === 429) {
    let payload = {};
    try { payload = await resp.json(); } catch {}
    auth.quota = payload.quota || auth.quota;
    refreshAuthUi();
    broadcastQuota(payload.quota);
    const e = new Error("QUOTA_EXCEEDED");
    e.code = "QUOTA_EXCEEDED";
    e.payload = payload;
    throw e;
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

gridFileInput.addEventListener("change", (e) => handleGridUpload(e.target.files[0]));
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
  const f = e.dataTransfer.files?.[0];
  if (f) handleGridUpload(f);
});

async function handleGridUpload(file) {
  if (!file || !file.type.startsWith("image/")) {
    alert("請傳圖片檔");
    return;
  }
  const img = await loadImage(URL.createObjectURL(file));
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

  // BYOG mode: discard any AI-mode source so reroll is correctly disabled.
  state.sourceFile = null;
  state.tiles = [];
  state.bgRemoved = false;
  $("bg-restore-btn").hidden = true;
  document.body.classList.add("byog-mode");

  // Save the uploaded file as the current grid + add to history.
  state.lastGridPng = file;
  await saveCurrentGridToHistory("byog", {
    fileName: file.name,
    aspectRatio: img.naturalWidth / img.naturalHeight,
  });

  $("step-preview").hidden = false;
  const grid = $("stickers-grid");
  grid.innerHTML = "";
  for (let i = 0; i < GRID_SIZE; i++) grid.appendChild(buildPlaceholderCell(i));

  const tiles = await splitGrid(img);
  for (let i = 0; i < GRID_SIZE; i++) {
    const tile = {
      canvas: tiles[i],
      transparent: false,
      phrase: "",
      busy: false,
      included: i < PACK_SIZE,
    };
    state.tiles.push(tile);
    renderTileIntoCell(i, tile);
  }
  refreshSelectionStatus();
  $("step-download").hidden = false;
  $("step-preview").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ------------------------------------------------------------------
// Grid splitting

// Inset each tile's crop region by this fraction on each side. Gemini's
// 3×3 grid lines aren't pixel-perfect — a tight 1/3 crop sometimes
// catches a sliver of the neighbor cell. 3% inset = ~20px on a 683px
// tile, enough to dodge bleed without losing the character.
const SPLIT_INSET_RATIO = 0.03;

async function splitGrid(img) {
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
      // Fill with PURE GREEN (#00FF00) so chroma-key downstream removes
      // the unfilled padding (left/right 25px when contain-fitting a
      // square cell into landscape 370×320). Was: white — which chroma
      // key didn't recognize → showed up as opaque white bars.
      tctx.fillStyle = "#00FF00";
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
  cell.innerHTML = "";
  const img = document.createElement("img");
  img.src = tile.canvas.toDataURL("image/png");
  img.alt = `sticker ${idx + 1}`;
  cell.appendChild(img);

  // Inclusion toggle (top-right corner). Always present.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tile-include-toggle";
  toggle.title = tile.included ? "點掉 = 從打包中排除這張" : "勾起 = 納入打包";
  toggle.textContent = tile.included ? "✓" : "✗";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleIncluded(idx);
  });
  cell.appendChild(toggle);

  // Per-cell download button.
  const dl = document.createElement("button");
  dl.type = "button";
  dl.className = "tile-download";
  dl.title = "單獨下載這張 PNG";
  dl.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';
  dl.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadSingleTile(idx);
  });
  cell.appendChild(dl);

  // Re-roll only available when we have the original source image.
  if (state.sourceFile) {
    const overlay = document.createElement("div");
    overlay.className = "edit-overlay";
    overlay.textContent = "點我重抽";
    cell.appendChild(overlay);
    cell.onclick = () => promptRerollTile(idx);
  }
}

function toggleIncluded(idx) {
  const tile = state.tiles[idx];
  if (!tile) return;
  // If user is trying to INCLUDE this one but we already have PACK_SIZE
  // included, prompt to swap.
  const currentlyIncluded = state.tiles.filter((t) => t.included).length;
  if (!tile.included && currentlyIncluded >= PACK_SIZE) {
    alert(
      `已經有 ${PACK_SIZE} 張被選了。請先取消另一張，再勾這張。\n\n` +
      `(LINE 規定每包剛好 ${PACK_SIZE} 張)`,
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
  const included = state.tiles.filter((t) => t.included).length;
  if (included === PACK_SIZE) {
    sel.textContent = `✅ 已選 ${PACK_SIZE}/${PACK_SIZE} 張，可以下載 ZIP`;
    sel.className = "selection-status ready";
  } else if (included < PACK_SIZE) {
    sel.textContent = `⚠ 還差 ${PACK_SIZE - included} 張才能打包（目前 ${included}/${PACK_SIZE}）`;
    sel.className = "selection-status short";
  } else {
    sel.textContent = `❌ 多選了 ${included - PACK_SIZE} 張（最多 ${PACK_SIZE}）`;
    sel.className = "selection-status over";
  }
}

function showGridDownload() {
  const btn = $("download-grid-btn");
  if (btn) btn.hidden = false;
}
async function downloadOriginalGrid() {
  if (!state.lastGridPng) {
    alert("沒有原始 grid PNG — 先生成一次。");
    return;
  }
  const url = URL.createObjectURL(state.lastGridPng);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gemini-grid-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

async function downloadSingleTile(idx) {
  const tile = state.tiles[idx];
  if (!tile) return;
  const blob = await canvasToBlob(tile.canvas, "image/png");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sticker-${String(idx + 1).padStart(2, "0")}.png`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
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
      `⚠ 重抽會打 1 次 Gemini API（約 50 秒、~USD 0.04）`,
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
      campaign: state.campaign,
      lang: state.textLang,
    });
    const gridImg = await loadImage(
      `data:${result.mimeType};base64,${result.data}`,
    );
    const tiles = await splitGrid(gridImg);
    // The pinned phrase landed in slot 0 (top-left of the new grid).
    state.tiles[idx] = {
      canvas: tiles[0],
      transparent: false,
      phrase: effectivePhrase || result.phrases?.[0] || tile.phrase,
      busy: false,
      included: tile.included,  // preserve selection
    };
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
const bgRestoreBtn = $("bg-restore-btn");
const bgProgress = $("bg-progress");
const bgBarFill = $("bg-bar-fill");
const bgProgressText = $("bg-progress-text");

bgRemoveBtn.addEventListener("click", removeAllBackgrounds);
bgRestoreBtn.addEventListener("click", restoreAllBackgrounds);
const downloadGridBtn = $("download-grid-btn");
if (downloadGridBtn) downloadGridBtn.addEventListener("click", downloadOriginalGrid);

// (Previously ensureBgLib loaded @imgly's ISNet model for white-bg
// fallback. Removed — chroma-key on green is the only path now. No
// 30MB ML model download, no white-shirt-eaten edge cases. If user
// uploads a non-green BYOG grid, we tell them clearly.)

async function removeAllBackgrounds() {
  if (state.tiles.length === 0) return;
  bgRemoveBtn.disabled = true;
  bgProgress.hidden = false;

  try {
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      if (!tile.originalCanvas) {
        const snap = document.createElement("canvas");
        snap.width = tile.canvas.width;
        snap.height = tile.canvas.height;
        snap.getContext("2d").drawImage(tile.canvas, 0, 0);
        tile.originalCanvas = snap;
      }
      setBgProgress(
        ((i + 0.1) / state.tiles.length) * 100,
        `去背中 ${i + 1}/${state.tiles.length}…`,
      );
      tile.canvas = await bgRemoveWithTextPreserve(tile.originalCanvas);
      tile.transparent = true;
      renderTileIntoCell(i, tile);
    }
    state.bgRemoved = true;
    setBgProgress(100, `完成！${state.tiles.length} 張已去背。`);
    bgRestoreBtn.hidden = false;
  } catch (err) {
    console.error(err);
    setBgProgress(0, `去背失敗：${err.message}`);
  } finally {
    bgRemoveBtn.disabled = false;
  }
}

async function restoreAllBackgrounds() {
  // Real restore: replace each tile.canvas with the saved snapshot of
  // the pristine Gemini-cropped tile (taken before bg removal). This
  // fully undoes the bg removal — including outline / shadow / etc.
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (!tile.originalCanvas) continue;
    const c = document.createElement("canvas");
    c.width = tile.originalCanvas.width;
    c.height = tile.originalCanvas.height;
    c.getContext("2d").drawImage(tile.originalCanvas, 0, 0);
    tile.canvas = c;
    tile.transparent = false;
    renderTileIntoCell(i, tile);
  }
  state.bgRemoved = false;
  bgRestoreBtn.hidden = true;
  setBgProgress(0, "已還原成 Gemini 原圖（白底+黑邊）。可重新選邊框樣式再去背。");
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
// Always chroma-key out green from the source canvas. Returns the
// transparent-bg canvas. (Previously gated on detectBgType, which had
// a false-negative on densely-composed cells where the character
// covered most of the frame and visible green pixels fell below 20%.
// Always-run is safer: AI path always sends green; BYOG without green
// is a no-op since chroma key matches no pixels — the image just
// stays unchanged.)
async function bgRemoveWithTextPreserve(srcCanvas) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const origCtx = srcCanvas.getContext("2d");
  const origData = origCtx.getImageData(0, 0, w, h);
  const orig = origData.data;
  return chromaKeyGreen(srcCanvas, w, h, orig, "none");
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

// Chroma-key out a green (#00FF00) background with anti-alias decontamination.
// Per-pixel "green-ness" score → linear ramp to alpha.
// Then subtract green contribution from semi-transparent edge pixels.
async function chromaKeyGreen(srcCanvas, w, h, orig, outlineStyle) {
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const outCtx = out.getContext("2d");
  const outData = outCtx.createImageData(w, h);
  const od = outData.data;

  let nKeyed = 0, nKept = 0, nPartial = 0;
  for (let i = 0; i < orig.length; i += 4) {
    const r = orig[i], g = orig[i + 1], b = orig[i + 2];
    // "Greenness ratio" — how much greener than max(R,B), normalized to 0-1.
    // Pure green = 1.0, neutral = 0, more red/blue = negative.
    // Asian skin tones: typically negative or near-zero (R > G > B). Safe.
    // Edge pixels with green bleed: 0.1-0.4. We aggressively kill them
    // to avoid the green halo around the character silhouette.
    const greenness = (g - Math.max(r, b)) / 255;
    let alpha;
    if (greenness > 0.25) {
      alpha = 0;              // any meaningfully green pixel → transparent
    } else if (greenness < 0.05) {
      alpha = 255;            // not green at all → keep
    } else {
      // Tight ramp: 0.25→0 to 0.05→255 (only 4-5 pixels of soft edge)
      alpha = Math.round(255 * (0.25 - greenness) / 0.20);
    }
    od[i] = r; od[i + 1] = g; od[i + 2] = b; od[i + 3] = alpha;
    if (alpha === 0) nKeyed++;
    else if (alpha === 255) nKept++;
    else nPartial++;

    // Despill — standard chroma-key technique (also seen in Meiko's
    // line-sticker-factory): for any non-fully-transparent pixel where
    // green is the dominant channel, replace G with (R+B)/2 to kill
    // the green color contamination on edge pixels. Simpler and more
    // visually correct than inverting the alpha-blend formula.
    if (alpha > 0 && g > r && g > b) {
      od[i + 1] = (r + b) >> 1;
    }
  }
  const total = orig.length / 4;
  console.log(`[chroma-key] keyed=${(100*nKeyed/total).toFixed(0)}% kept=${(100*nKept/total).toFixed(0)}% partial=${(100*nPartial/total).toFixed(0)}%`);

  // Edge cleanup pass: any partial-alpha pixel adjacent to a fully-
  // transparent neighbor gets killed too. Eliminates the 1-2 px green
  // halo that survives despill — the fringe pixels nearest the bg
  // always carry the most green contamination.
  const ERODE_PASSES = 1;
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

async function downloadZip() {
  if (state.tiles.length === 0) return;
  if (!window.JSZip) {
    alert("JSZip 未載入");
    return;
  }
  const includedTiles = state.tiles.filter((t) => t.included);
  if (includedTiles.length !== PACK_SIZE) {
    alert(
      `LINE 規定每包剛好 ${PACK_SIZE} 張，目前選了 ${includedTiles.length} 張。請調整再下載。`,
    );
    return;
  }
  // Safety: LINE requires transparent PNGs. If user hasn't clicked
  // "全部去背" yet, the canvases still have a solid white background.
  const anyTransparent = includedTiles.some((t) => t.transparent);
  if (!anyTransparent) {
    const proceed = confirm(
      "⚠ 還沒去背！下載的 PNG 都是白底 (opaque)，LINE Creators Market 上架時可能被退件（規定透明背景）。\n\n" +
      "→ 確定：先去背再下載 (推薦) — 我會自動執行去背\n" +
      "→ 取消：硬要下載 opaque 版本\n",
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
  const zip = new JSZip();

  // Each sticker — 370 × 320, PNG. Numbered 01..08 in the order they
  // appear in the grid (skipping excluded ones, but renumbering tightly).
  for (let i = 0; i < includedTiles.length; i++) {
    const tile = includedTiles[i];
    const blob = await canvasToBlob(tile.canvas, "image/png");
    const name = `${String(i + 1).padStart(2, "0")}.png`;
    zip.file(name, blob);
  }

  // Main + tab use the first INCLUDED tile (not necessarily tiles[0]).
  const heroCanvas = includedTiles[0].canvas;
  zip.file("main.png", await canvasToBlob(makeMainImage(heroCanvas), "image/png"));
  zip.file("tab.png", await canvasToBlob(makeTabImage(heroCanvas), "image/png"));

  zip.file("README.txt", buildReadmeText(currentCampaign()));

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `line-stickers-${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
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

function buildReadmeText(camp) {
  const campSection = camp
    ? `

★ 對準 LINE 特輯活動：${camp.fullName}
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
- 01.png ~   貼圖本體，370 × 320（依序對應「貼圖 1～N」）

是否透明背景
------------
- 如果你在前端按過「全部去背」，就是透明 PNG (LINE 要求)。
- 如果跳過去背，每張會是白底；上架前建議至少對主要圖片去一次背。
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
      <div class="name">🎲 自由模式</div>
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
      <div class="name">${escapeHtml(camp.label)}${expired ? " 🕰" : ""}</div>
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
    ? `<div class="expired-warn">⚠ 此活動已於 ${escapeHtml(camp.submitDeadline)} 截止徵稿 — 仍可用此 prompt 產出貼圖把玩 / 留念，但 LINE 不再收稿到這個特輯。</div>`
    : "";
  campaignActive.innerHTML = `
    ${expiredWarn}
    <strong>📌 已對準：${escapeHtml(camp.fullName)}${expired ? " 🕰" : ""}</strong><br>
    ${expired
      ? `(已過期，原投稿 tag 為「<strong>${escapeHtml(camp.submitTag)}</strong>」)`
      : `投稿時 LINE 編輯器選 →「<strong>${escapeHtml(camp.submitTag)}</strong>」`}<br>
    投稿截止：${escapeHtml(camp.submitDeadline)}・Banner 期：${escapeHtml(camp.bannerPeriod)}<br>
    <a href="${escapeAttr(camp.articleUrl)}" target="_blank" rel="noopener">📄 看完整徵稿規則</a>
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
  renderSlotGrid(new Array(PACK_SIZE).fill(null));
});
slotsCopyBtn.addEventListener("click", copyPromptToGemini);

// AI theme generator — fill 8 custom slots from a user description.
const themeInput = $("theme-input");
const themeGenBtn = $("theme-gen-btn");
const themeGenStatus = $("theme-gen-status");
themeGenBtn?.addEventListener("click", async () => {
  const description = themeInput.value.trim();
  if (!description) {
    alert("請先描述你要的主題");
    themeInput.focus();
    return;
  }
  themeGenBtn.disabled = true;
  themeGenStatus.hidden = false;
  themeGenStatus.textContent = "✨ AI 想中…";
  try {
    const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/generate-themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, lang: state.textLang }),
    });
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
    const cfg = items.slice(0, PACK_SIZE).map((s) => {
      const slot = { phraseCustom: s.phrase };
      if (s.action) slot.action = s.action;
      return slot;
    });
    while (cfg.length < PACK_SIZE) cfg.push(null);
    renderSlotGrid(cfg);
    themeGenStatus.textContent =
      `✓ 填入：${phrases.slice(0, PACK_SIZE).join(" / ")}`;
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
  for (let i = 0; i < PACK_SIZE; i++) {
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
  sel.appendChild(new Option("🎲 隨機", "__random__"));
  poolCache.items.forEach((p) =>
    sel.appendChild(new Option(p.label, `preset:${p.id}`)),
  );
  sel.appendChild(new Option("✏️ 自訂…", "__custom__"));
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
  const cfg = new Array(PACK_SIZE).fill(null);
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
    slotStatusText.textContent = "🎲 目前：8 格短語全隨機（從內建 50 句抽）";
    return;
  }
  const parts = [];
  if (pinned > 0) parts.push(`指定 ${pinned} 句預設`);
  if (custom > 0) parts.push(`自訂 ${custom} 句`);
  const remain = PACK_SIZE - pinned - custom;
  if (remain > 0) parts.push(`其他 ${remain} 格隨機`);
  if (withAction > 0) parts.push(`${withAction} 格附動作描述`);
  slotStatusText.textContent = `🎨 你挑了：${parts.join("、")}`;
}

async function copyPromptToGemini() {
  const cfg = readSlotConfigFromGrid();
  slotsCopyStatus.hidden = false;
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
        campaign: state.campaign,
        lang: state.textLang,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { prompt } = await resp.json();
    await navigator.clipboard.writeText(prompt);
    slotsCopyStatus.textContent =
      "✓ 已複製！到 gemini.google.com 貼上 + 附原圖，自己跑可省作者的 API 額度";
  } catch (err) {
    console.error(err);
    slotsCopyStatus.textContent = `複製失敗：${err.message}`;
  }
  setTimeout(() => { slotsCopyStatus.hidden = true; }, 8000);
}

// ------------------------------------------------------------------
// Auth UI wiring

const authWidget = $("auth-widget");
const authLoginBtn = $("auth-login-btn");
const authUserBox = $("auth-user");
const authAvatar = $("auth-avatar");
const authName = $("auth-name");
const authQuotaEl = $("auth-quota");
const authLogoutBtn = $("auth-logout-btn");
const authAdminResetBtn = $("auth-admin-reset-btn");

authLoginBtn.addEventListener("click", () => {
  // Heads up the in-app browser case BEFORE redirect so the user has
  // a chance to switch to Safari/Chrome instead of bouncing through a
  // failing flow + getting a confusing error after the fact.
  if (isLineInAppBrowser()) {
    const proceed = confirm(
      "📱 偵測到你正在 LINE 內建瀏覽器中。\n\n" +
      "LINE 內建瀏覽器跑 LINE Login 常常會失敗（state mismatch），因為授權會跳到外部 app 處理、回來時可能進入新分頁。\n\n" +
      "👉 推薦解法：點右上角「⋯」→「在 Safari / Chrome 開啟」，再重新登入。\n\n" +
      "→ 確定：仍要在這個內建瀏覽器試（可能失敗）\n" +
      "→ 取消：先到外部瀏覽器開"
    );
    if (!proceed) return;
  }
  startLineLogin();
});
authLogoutBtn.addEventListener("click", () => {
  if (!confirm("登出 LINE? 之後 AI 生成需要重新登入。")) return;
  clearAuth();
  refreshAuthUi();
  broadcastAuthCleared();
});
authAdminResetBtn.addEventListener("click", async () => {
  if (!auth.token) return;
  const apiUrl = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
  authAdminResetBtn.disabled = true;
  try {
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/admin/reset-quota", {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    await refreshAuth();
    refreshAuthUi();
    broadcastQuota(auth.quota);
    authAdminResetBtn.title = `重設成功！剩餘 ${auth.quota?.limit || 3}/${auth.quota?.limit || 3}`;
  } catch (err) {
    alert(`重設失敗：${err.message}`);
  } finally {
    authAdminResetBtn.disabled = false;
  }
});

function refreshAuthUi() {
  authWidget.hidden = false;
  if (auth.user) {
    authLoginBtn.hidden = true;
    authUserBox.hidden = false;
    authAvatar.src = auth.user.pictureUrl || "";
    authName.textContent = auth.user.displayName || "(LINE user)";
    if (auth.quota) {
      const remain = Math.max(0, auth.quota.limit - auth.quota.used);
      authQuotaEl.textContent = `今日 AI 剩 ${remain} / ${auth.quota.limit}`;
      authQuotaEl.classList.toggle("full", remain === 0);
    } else {
      authQuotaEl.textContent = "";
    }
    authAdminResetBtn.hidden = !auth.isAdmin;
  } else {
    authLoginBtn.hidden = false;
    authUserBox.hidden = true;
    authAdminResetBtn.hidden = true;
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

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5200);
}
function escapeHtmlSafe(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
async function saveCurrentGridToHistory(source, metadata) {
  if (!state.lastGridPng) return;
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
  const all = await idbListGenerations();
  const nonStarred = all.filter((e) => !e.starred);
  nonStarred.sort((a, b) => b.timestamp - a.timestamp);
  for (const e of nonStarred.slice(HISTORY_NONSTARRED_CAP)) {
    await idbDeleteGeneration(e.id);
    showToast(`📌 已自動清除最舊歷史 (達 ${HISTORY_NONSTARRED_CAP} 筆上限)`);
  }
}
async function renderHistoryUi() {
  const all = await idbListGenerations();
  all.sort((a, b) => b.timestamp - a.timestamp);
  historyCards.innerHTML = "";
  if (all.length === 0) { historySection.hidden = true; return; }
  historySection.hidden = false;
  const ns = all.filter((e) => !e.starred).length;
  const st = all.filter((e) => e.starred).length;
  historyCount.textContent =
    `(${ns}/${HISTORY_NONSTARRED_CAP}` + (st ? ` + ⭐ ${st}` : "") + ")";
  historyCount.classList.toggle("warn", ns >= HISTORY_NONSTARRED_CAP - 2);
  for (const e of all) historyCards.appendChild(buildHistoryCard(e));
}
function buildHistoryCard(e) {
  const card = document.createElement("div");
  card.className = "history-card";
  if (e.id === state.currentGridId) card.classList.add("selected");
  const sourceIcon = e.source === "ai" ? "🪄" : "📤";
  const styleLabel = e.metadata?.styleHint || e.metadata?.fileName ||
    (e.source === "byog" ? "BYOG" : "?");
  const displayName = e.name || `${e.source === "ai" ? "AI" : "BYOG"} #${e.id.slice(-4)}`;
  card.innerHTML = `
    <div class="history-card-badges">${sourceIcon}${e.starred ? " ⭐" : ""}</div>
    <img alt="" />
    <div class="history-card-name" title="${escapeHtmlSafe(displayName)}">${escapeHtmlSafe(displayName)}</div>
    <div class="history-card-meta">${escapeHtmlSafe(String(styleLabel).slice(0,18))} · ${escapeHtmlSafe(relativeTime(e.timestamp))}</div>
    <div class="history-card-actions">
      <button class="act-load" title="載入">↻</button>
      <button class="act-star" title="${e.starred ? "取消收藏" : "收藏"}">${e.starred ? "⭐" : "☆"}</button>
      <button class="act-rename" title="重命名">📌</button>
      <button class="act-download" title="下載">⬇</button>
      <button class="act-delete" title="刪除">🗑</button>
    </div>`;
  card.querySelector("img").src = URL.createObjectURL(e.thumbnailBlob);
  card.querySelector(".act-load").onclick = () => loadFromHistory(e.id);
  card.querySelector(".act-star").onclick = async () => {
    await idbUpdateGeneration(e.id, { starred: !e.starred });
    if (state.currentGridId === e.id) await renderCurrentGridUi();
    await renderHistoryUi();
  };
  card.querySelector(".act-rename").onclick = async () => {
    const n = prompt("重新命名（留空 = 取消命名）:", e.name || "");
    if (n === null) return;
    await idbUpdateGeneration(e.id, { name: n.trim() || null });
    if (state.currentGridId === e.id) await renderCurrentGridUi();
    await renderHistoryUi();
  };
  card.querySelector(".act-download").onclick = () => {
    const url = URL.createObjectURL(e.gridBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grid-${e.name ? e.name.replace(/\W+/g, "_") : e.id}.png`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  };
  card.querySelector(".act-delete").onclick = async () => {
    if (!confirm("刪除這張 grid?")) return;
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
  currentGridSourceBadge.textContent = e.source === "ai" ? "🪄 AI 生成" : "📤 自上傳";
  currentGridName.value = e.name || "";
  currentGridName.placeholder = e.metadata?.styleHint || e.metadata?.fileName || "(未命名 — 點此重命名)";
  const meta = [];
  meta.push(relativeTime(e.timestamp));
  if (e.metadata?.styleHint) meta.push(e.metadata.styleHint);
  if (e.metadata?.campaign) meta.push(e.metadata.campaign);
  currentGridTime.textContent = meta.join(" · ");
  currentGridStarBtn.textContent = e.starred ? "⭐ 已收藏" : "☆ 收藏";
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
  const url = URL.createObjectURL(e.gridBlob);
  const a = document.createElement("a");
  a.href = url; a.download = `grid-${e.name || e.id}.png`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
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
  state.currentGridId = id;
  state.lastGridPng = e.gridBlob;
  state.tiles = [];
  state.bgRemoved = false;
  if (e.metadata?.styleHint) state.styleHint = e.metadata.styleHint;
  if (e.metadata?.campaign !== undefined) state.campaign = e.metadata.campaign;
  if (e.metadata?.withText !== undefined) state.withText = e.metadata.withText;
  const img = await loadImage(URL.createObjectURL(e.gridBlob));
  const tiles = await splitGrid(img);
  $("step-preview").hidden = false;
  const grid = $("stickers-grid");
  grid.innerHTML = "";
  for (let i = 0; i < GRID_SIZE; i++) grid.appendChild(buildPlaceholderCell(i));
  for (let i = 0; i < GRID_SIZE; i++) {
    const tile = {
      canvas: tiles[i], transparent: false,
      phrase: e.metadata?.phrases?.[i] || "",
      busy: false, included: i < PACK_SIZE,
    };
    state.tiles.push(tile);
    renderTileIntoCell(i, tile);
  }
  refreshSelectionStatus();
  $("step-download").hidden = false;
  $("bg-restore-btn").hidden = true;
  await renderCurrentGridUi();
  await renderHistoryUi();
  $("step-byog").scrollIntoView({ behavior: "smooth", block: "start" });
}

refreshEstimate();
refreshSlotStatus();
refreshTextLangAvailability();
// step-config is always visible now (so BYOG users can use settings dialog
// to copy prompt for Gemini), so eager-load campaigns at boot.
ensureCampaignsLoaded().then(renderCampaignPicker);
// Eager-load grid history (will show 🅱 carousel + last loaded grid).
renderCurrentGridUi();
renderHistoryUi();

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
(async () => {
  // Handle redirect-back from LINE OAuth (if URL has ?code=...).
  await handleOAuthCallback();
  // Hydrate user from any stored token (validates against worker /me).
  await refreshAuth();
  refreshAuthUi();
})();
