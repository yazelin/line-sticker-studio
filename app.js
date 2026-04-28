// LINE Sticker Studio — upload one image, fetch N batches of 3×3 sticker
// grids from the worker, split into individual stickers, optionally
// background-remove client-side, and bundle into a LINE-spec ZIP.

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------
// Config

const API_URL_KEY = "line-sticker-api-url";
const SLOT_CONFIG_KEY = "line-sticker-slots";
const LINE_TOKEN_KEY = "line-access-token";
const LINE_VERIFIER_KEY = "line-pkce-verifier";
const LINE_STATE_KEY = "line-oauth-state";
const LINE_CHANNEL_ID = "2009916047";
const DEFAULT_API_URL = "https://line-sticker-gemini.yazelinj303.workers.dev";
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

async function startLineLogin() {
  const verifier = genVerifier();
  const challenge = await genChallenge(verifier);
  const state = genVerifier();
  sessionStorage.setItem(LINE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(LINE_STATE_KEY, state);
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

  const expectedState = sessionStorage.getItem(LINE_STATE_KEY);
  const verifier = sessionStorage.getItem(LINE_VERIFIER_KEY);
  if (!expectedState || state !== expectedState || !verifier) {
    alert("LINE 登入：state mismatch，請重試。");
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
    sessionStorage.removeItem(LINE_VERIFIER_KEY);
    sessionStorage.removeItem(LINE_STATE_KEY);
    window.history.replaceState({}, document.title, cleanUrl);
  }
  return true;
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
  campaign: null,        // null or campaign id
  slotConfig: loadSlotConfig(), // length-PACK_SIZE
  tiles: [],             // [{ canvas, transparent: false, phrase, busy: false }]
  bgRemoved: false,
  removeBackgroundFn: null, // lazy-loaded @imgly/background-removal
  lastGridPng: null,     // raw Gemini 3×3 grid PNG blob (for backup/re-split)
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
const generateBtn = $("generate-btn");
const genProgress = $("gen-progress");
const genBarFill = $("gen-bar-fill");
const genProgressText = $("gen-progress-text");
const estimateEl = $("estimate");

function refreshEstimate() {
  estimateEl.innerHTML =
    `預估：<strong>1</strong> 次 API 呼叫、約 <strong>${ESTIMATED_GRID_SECONDS}</strong> 秒，產出 <strong>${PACK_SIZE}</strong> 張 LINE 規格貼圖（370 × 320）。`;
}

generateBtn.addEventListener("click", () => generateAll());

async function generateAll() {
  if (!state.sourceImage) return;
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
    if (effectivePhrase) rerollSlots[0] = { phraseCustom: effectivePhrase };
    const result = await fetchGrid(apiUrl, {
      imageBase64: base64,
      mimeType,
      slots: rerollSlots,
      styleHint: state.styleHint,
      withText: state.withText,
      campaign: state.campaign,
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
    let nonGreenTiles = 0;
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      // Snapshot pristine canvas on first pass so "restore" + re-runs
      // always start from the original Gemini output.
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
      const result = await bgRemoveWithTextPreserve(tile.originalCanvas);
      if (result === null) {
        nonGreenTiles++;
        continue; // leave tile as-is
      }
      tile.canvas = result;
      tile.transparent = true;
      renderTileIntoCell(i, tile);
    }
    if (nonGreenTiles > 0 && nonGreenTiles === state.tiles.length) {
      setBgProgress(0,
        `❌ ${nonGreenTiles} 張全部不是綠底 — 無法自動去背。請走 🅰 AI 路徑（會自動畫綠底），或先用其他工具把你的 3×3 圖去背成透明 PNG 再上傳。`,
      );
    } else if (nonGreenTiles > 0) {
      state.bgRemoved = true;
      setBgProgress(100,
        `完成！${state.tiles.length - nonGreenTiles} 張已去背、${nonGreenTiles} 張不是綠底（保留原樣）。`,
      );
      bgRestoreBtn.hidden = false;
    } else {
      state.bgRemoved = true;
      setBgProgress(100, `完成！${state.tiles.length} 張已去背。`);
      bgRestoreBtn.hidden = false;
    }
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
// Returns a transparent canvas if the source has a green bg; returns
// null if not green (caller should skip / show a message).
// Outline / shadow post-process removed — Gemini draws black character
// outline directly per the prompt, no client-side decoration needed.
async function bgRemoveWithTextPreserve(srcCanvas) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const origCtx = srcCanvas.getContext("2d");
  const origData = origCtx.getImageData(0, 0, w, h);
  const orig = origData.data;

  if (detectBgType(orig, w, h) === "green") {
    return chromaKeyGreen(srcCanvas, w, h, orig, "none");
  }
  return null;
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
    if (expired) btn.classList.add("disabled");
    btn.innerHTML = `
      <div class="name">${escapeHtml(camp.label)}</div>
      <div class="blurb">${escapeHtml(camp.blurb)}</div>
      <div class="deadline ${deadlineCls}">${escapeHtml(deadlineLabel)}</div>
    `;
  }

  btn.addEventListener("click", () => {
    if (btn.classList.contains("disabled")) return;
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
}

function refreshCampaignActive() {
  const camp = currentCampaign();
  if (!camp) {
    campaignActive.hidden = true;
    campaignActive.innerHTML = "";
    return;
  }
  campaignActive.hidden = false;
  campaignActive.innerHTML = `
    <strong>📌 已對準：${escapeHtml(camp.fullName)}</strong><br>
    投稿時 LINE 編輯器選 →「<strong>${escapeHtml(camp.submitTag)}</strong>」<br>
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
      body: JSON.stringify({ description, lang: "zh-TW" }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const { phrases } = await resp.json();
    if (!Array.isArray(phrases) || phrases.length === 0) {
      throw new Error("AI 沒回 phrases");
    }
    // Fill the 8 slots with the generated phrases.
    const cfg = phrases.slice(0, PACK_SIZE).map((p) => ({ phraseCustom: p }));
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

  sel.addEventListener("change", () => {
    customInput.hidden = sel.value !== "__custom__";
    if (!customInput.hidden) customInput.focus();
  });

  return cell;
}

function readSlotConfigFromGrid() {
  const cfg = new Array(PACK_SIZE).fill(null);
  slotGrid.querySelectorAll(".slot-cell").forEach((cell) => {
    const i = parseInt(cell.dataset.idx, 10);
    const sel = cell.querySelector(".slot-select");
    const custom = cell.querySelector(".slot-custom");
    if (sel.value === "__custom__") {
      const t = custom.value.trim();
      if (t) cfg[i] = { phraseCustom: t };
    } else if (sel.value.startsWith("preset:")) {
      cfg[i] = { phraseId: parseInt(sel.value.slice(7), 10) };
    }
  });
  return cfg;
}

function refreshSlotStatus() {
  let pinned = 0;
  let custom = 0;
  for (const s of state.slotConfig) {
    if (!s) continue;
    if (typeof s.phraseCustom === "string") custom += 1;
    else if (Number.isInteger(s.phraseId)) pinned += 1;
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

authLoginBtn.addEventListener("click", () => startLineLogin());
authLogoutBtn.addEventListener("click", () => {
  if (!confirm("登出 LINE? 之後 AI 生成需要重新登入。")) return;
  clearAuth();
  refreshAuthUi();
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

refreshEstimate();
refreshSlotStatus();
// step-config is always visible now (so BYOG users can use settings dialog
// to copy prompt for Gemini), so eager-load campaigns at boot.
ensureCampaignsLoaded().then(renderCampaignPicker);

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
