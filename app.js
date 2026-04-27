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
// LINE Creators Market accepts only 8/16/24/32/40 stickers per pack.
// We hard-code 8 (the minimum) so one Gemini grid covers a whole pack:
// 1 API call → 9 tiles → keep first 8.
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
};

function getStoredToken() {
  return localStorage.getItem(LINE_TOKEN_KEY);
}

function clearAuth() {
  localStorage.removeItem(LINE_TOKEN_KEY);
  auth.user = null;
  auth.quota = null;
  auth.token = null;
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
  $("step-config").hidden = false;
  refreshEstimate();
  // Lazy-load campaigns the first time step-config opens.
  ensureCampaignsLoaded().then(renderCampaignPicker);
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
  $("step-config").hidden = true;
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
  for (let i = 0; i < PACK_SIZE; i++) {
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
    const tiles = await splitGrid(gridImg);
    // Gemini gives 9 tiles in a 3×3 grid. LINE's minimum pack is 8 — we
    // keep tiles 0..7 and discard the 9th.
    for (let i = 0; i < PACK_SIZE; i++) {
      const tile = {
        canvas: tiles[i],
        transparent: false,
        phrase: result.phrases?.[i] || "",
        busy: false,
      };
      state.tiles.push(tile);
      renderTileIntoCell(i, tile);
    }

    setGenProgress(100, `完成！產出 ${PACK_SIZE} 張貼圖。`);
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

  // Hide AI-only step-config (style/phrases controls); they don't apply.
  $("step-config").hidden = true;

  $("step-preview").hidden = false;
  const grid = $("stickers-grid");
  grid.innerHTML = "";
  for (let i = 0; i < PACK_SIZE; i++) grid.appendChild(buildPlaceholderCell(i));

  const tiles = await splitGrid(img);
  for (let i = 0; i < PACK_SIZE; i++) {
    const tile = {
      canvas: tiles[i],
      transparent: false,
      phrase: "",
      busy: false,
    };
    state.tiles.push(tile);
    renderTileIntoCell(i, tile);
  }
  $("step-download").hidden = false;
  $("step-preview").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ------------------------------------------------------------------
// Grid splitting

async function splitGrid(img) {
  const tileW = Math.floor(img.naturalWidth / 3);
  const tileH = Math.floor(img.naturalHeight / 3);
  const out = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = STICKER_W;
      tileCanvas.height = STICKER_H;
      const tctx = tileCanvas.getContext("2d");
      // Fill white in case Gemini left some near-white pixels.
      tctx.fillStyle = "#ffffff";
      tctx.fillRect(0, 0, STICKER_W, STICKER_H);

      // contain-fit the source tile (which is square) into 370×320 (a
      // landscape rectangle). Center it.
      const sx = c * tileW;
      const sy = r * tileH;
      const scale = Math.min(STICKER_W / tileW, STICKER_H / tileH);
      const dw = tileW * scale;
      const dh = tileH * scale;
      const dx = (STICKER_W - dw) / 2;
      const dy = (STICKER_H - dh) / 2;
      tctx.drawImage(img, sx, sy, tileW, tileH, dx, dy, dw, dh);
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
  cell.innerHTML = "";
  const img = document.createElement("img");
  img.src = tile.canvas.toDataURL("image/png");
  img.alt = `sticker ${idx + 1}`;
  cell.appendChild(img);
  // Re-roll only available when we have the original source image (i.e.
  // not in BYOG mode where the user uploaded a pre-made grid).
  if (state.sourceFile) {
    const overlay = document.createElement("div");
    overlay.className = "edit-overlay";
    overlay.textContent = "點我重抽";
    cell.appendChild(overlay);
    cell.onclick = () => promptRerollTile(idx);
  }
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

async function ensureBgLib() {
  if (state.removeBackgroundFn) return state.removeBackgroundFn;
  setBgProgress(5, "首次需要下載 ~30MB 去背模型，之後會用瀏覽器快取…");
  // @imgly/background-removal — runs onnxruntime-web in browser. Cached
  // by the browser after first load.
  const mod = await import(
    "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm"
  );
  state.removeBackgroundFn = mod.removeBackground || mod.default?.removeBackground;
  if (!state.removeBackgroundFn) {
    throw new Error("無法載入 @imgly/background-removal");
  }
  return state.removeBackgroundFn;
}

async function removeAllBackgrounds() {
  if (state.tiles.length === 0) return;
  bgRemoveBtn.disabled = true;
  bgProgress.hidden = false;

  let removeBackground;
  try {
    removeBackground = await ensureBgLib();
  } catch (err) {
    setBgProgress(0, `載入失敗：${err.message}`);
    bgRemoveBtn.disabled = false;
    return;
  }

  try {
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      if (tile.transparent) continue;
      setBgProgress(
        ((i + 0.1) / state.tiles.length) * 100,
        `去背中 ${i + 1}/${state.tiles.length}…`,
      );
      const blob = await new Promise((res) =>
        tile.canvas.toBlob(res, "image/png"),
      );
      const cleanedBlob = await removeBackground(blob);
      const cleanedImg = await loadImage(URL.createObjectURL(cleanedBlob));
      const c = document.createElement("canvas");
      c.width = STICKER_W;
      c.height = STICKER_H;
      c.getContext("2d").drawImage(cleanedImg, 0, 0, STICKER_W, STICKER_H);
      tile.canvas = c;
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
  // Re-fetch from current state isn't possible — the original white-bg
  // canvas was overwritten. So restoring just paints white behind any
  // transparent pixels (visually equivalent to the AI-original).
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (!tile.transparent) continue;
    const c = document.createElement("canvas");
    c.width = STICKER_W;
    c.height = STICKER_H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, STICKER_W, STICKER_H);
    ctx.drawImage(tile.canvas, 0, 0);
    tile.canvas = c;
    tile.transparent = false;
    renderTileIntoCell(i, tile);
  }
  state.bgRemoved = false;
  bgRestoreBtn.hidden = true;
  setBgProgress(0, "已還原白底（注意：邊緣去背過的細節不會回來）");
}

function setBgProgress(pct, text) {
  bgBarFill.style.width = `${pct}%`;
  bgProgressText.textContent = text;
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
  const zip = new JSZip();

  // Each sticker — 370 × 320, PNG.
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    const blob = await canvasToBlob(tile.canvas, "image/png");
    const name = `${String(i + 1).padStart(2, "0")}.png`;
    zip.file(name, blob);
  }

  // Main image — 240 × 240, derived from sticker 01 cropped square.
  const mainCanvas = makeMainImage(state.tiles[0].canvas);
  zip.file("main.png", await canvasToBlob(mainCanvas, "image/png"));

  // Tab image — 96 × 74, derived from sticker 01.
  const tabCanvas = makeTabImage(state.tiles[0].canvas);
  zip.file("tab.png", await canvasToBlob(tabCanvas, "image/png"));

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

authLoginBtn.addEventListener("click", () => startLineLogin());
authLogoutBtn.addEventListener("click", () => {
  if (!confirm("登出 LINE? 之後 AI 生成需要重新登入。")) return;
  clearAuth();
  refreshAuthUi();
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
  } else {
    authLoginBtn.hidden = false;
    authUserBox.hidden = true;
  }
}

// ------------------------------------------------------------------
// Init

refreshEstimate();
refreshSlotStatus();
(async () => {
  // Handle redirect-back from LINE OAuth (if URL has ?code=...).
  await handleOAuthCallback();
  // Hydrate user from any stored token (validates against worker /me).
  await refreshAuth();
  refreshAuthUi();
})();
