// Cloudflare Worker: proxy for Vertex AI image generation, tuned to
// produce a 3×3 grid of LINE-sticker style images of the same character.
//
// Frontend calls us with { imageBase64, mimeType, phrases?, styleHint? }.
// We add the API key (Worker Secret) and forward to Vertex AI, then
// return the generated image as base64. Frontend splits the 3×3 grid
// into 9 sticker tiles, runs optional client-side background removal,
// and packages a LINE Creators Market ZIP.

const DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10 MB decoded image

// Daily AI-generation quota per LINE user. Tweak freely — this is the
// only place to change it. Counter resets at UTC midnight.
const DAILY_LIMIT = 3;

// Optional: if set, only LINE access tokens issued for this channel are
// accepted. Leave empty to accept tokens from any LINE Login channel.
const EXPECTED_LINE_CHANNEL_ID = "2009916047";

// Default Traditional-Chinese short phrases commonly used on LINE.
// Frontend can override with its own phrase list. We keep ~50 here so
// frontend can pick 9 random ones per request without dupes.
const DEFAULT_PHRASES = [
  "哈囉", "嗨", "早安", "午安", "晚安", "謝謝", "OK", "收到", "好的", "加油",
  "笑死", "拜託", "對不起", "沒關係", "在嗎", "等等", "我來了", "想你", "愛你", "比心",
  "加班中", "好餓", "想睡", "累了", "開心", "生氣", "哭哭", "害羞", "驚訝", "收工",
  "掰掰", "太棒了", "真的嗎", "衝啊", "知道了", "安安", "嘿嘿", "嗯嗯", "晚點聊", "辛苦了",
  "厲害", "可愛", "認真", "再見", "歐買尬", "跪了", "抱抱", "啾", "嘔嘔嘔", "不要",
];

// Loose pool of expressive actions/poses paired with phrases. Worker
// chooses a sensible action when frontend doesn't dictate one.
const ACTION_FOR_PHRASE = {
  "哈囉": "smiling and waving one hand high",
  "嗨": "waving with a cheerful grin",
  "早安": "stretching arms up just woken, sleepy smile",
  "午安": "holding a mug of coffee, relaxed pose",
  "晚安": "yawning with eyes half-closed, hand near mouth",
  "謝謝": "bowing with hands together in thanks",
  "OK": "making an OK sign with thumb and finger, confident smile",
  "收到": "saluting with a hand near forehead, sharp expression",
  "好的": "thumbs up with a bright smile",
  "加油": "fist pumped in the air, determined look",
  "笑死": "laughing hysterically, head thrown back",
  "拜託": "hands clasped pleading, puppy eyes",
  "對不起": "head down apologetic, hands clasped together",
  "沒關係": "shrugging with an easy smile, palms open",
  "在嗎": "leaning forward squinting, finger to chin curious",
  "等等": "one palm forward in a STOP gesture, alarmed face",
  "我來了": "running forward arms back, hair flying",
  "想你": "head tilted, hand on cheek, dreamy eyes",
  "愛你": "blowing a kiss with one hand, hearts in eyes",
  "比心": "making a finger heart with both hands",
  "加班中": "exhausted at a laptop, dark circles under eyes",
  "好餓": "holding stomach, drooling, hungry face",
  "想睡": "rubbing eyes drowsily, head drooping",
  "累了": "slumped shoulders, defeated face",
  "開心": "jumping in the air arms wide, huge smile",
  "生氣": "puffed cheeks red face, fists clenched",
  "哭哭": "tears streaming, mouth open wailing",
  "害羞": "blushing hard, hands covering face partially",
  "驚訝": "eyes huge, mouth wide open in shock",
  "收工": "wiping forehead, satisfied look, arms stretched",
  "掰掰": "waving goodbye with a soft smile",
  "太棒了": "double thumbs up, sparkling eyes",
  "真的嗎": "wide eyes, hands on cheeks in disbelief",
  "衝啊": "fist out punching forward, fired up",
  "知道了": "nodding firmly, slight serious smile",
  "安安": "small wave at chest level, gentle smile",
  "嘿嘿": "mischievous grin, eyes squinted slyly",
  "嗯嗯": "nodding with eyes closed, agreeable face",
  "晚點聊": "checking watch, polite smile",
  "辛苦了": "patting own shoulder, warm smile",
  "厲害": "clapping hands enthusiastically",
  "可愛": "cheek squish with hands, sparkly eyes",
  "認真": "wearing a serious expression, finger pointed up",
  "再見": "waving with both hands, sad smile",
  "歐買尬": "hands on top of head, jaw dropped",
  "跪了": "kneeling on the ground, defeated",
  "抱抱": "arms wide open inviting a hug",
  "啾": "puckered lips kiss, one eye winked",
  "嘔嘔嘔": "covering mouth, looking nauseated green-faced",
  "不要": "arms crossed in an X, frowning hard",
};

// LINE Creators Market themed-campaign presets. Updating: when LINE
// publishes new campaigns, append entries here. Frontend reads this via
// GET /campaigns; expired entries are flagged but not removed (callers
// decide how to display them).
//
// Each campaign overrides the relevant prompt knobs and injects a
// CAMPAIGN REQUIREMENT block into the assembled prompt so Gemini's 8/9
// tiles align with what LINE's editorial team is looking for.
const CAMPAIGNS = [
  {
    id: "no_text",
    label: "無字浮誇",
    fullName: "無字浮誇貼圖特輯",
    submitTag: "無字浮誇貼圖特輯",
    submitDeadline: "2026-07-12",
    bannerPeriod: "未公布",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30678325.html",
    blurb: "整組純表情/肢體傳達情緒、絕對不能有字。",
    forceWithText: false,
    forceStyleHint: null,
    extraPromptInstruction:
      "CAMPAIGN OVERRIDE — 「無字浮誇貼圖特輯」: This whole pack must convey emotion ENTIRELY through facial expressions and body language. ABSOLUTELY NO TEXT, LETTERS, NUMBERS, EMOJI, OR PUNCTUATION anywhere in any cell — checked strictly. Each pose must be theatrical and exaggerated, the kind that reads at a glance with zero captions. Vary head tilt, eye direction, hand position, and body posture across all 9 cells.",
  },
  {
    id: "watery",
    label: "水水（水亮亮）",
    fullName: "水水貼圖",
    submitTag: "水水貼圖",
    submitDeadline: "2026-06-14",
    bannerPeriod: "2026/06/17 ~ 06/30",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30606764.html",
    blurb: "Q 萌、果凍亮亮反光、大眼水汪汪。",
    forceWithText: null,
    forceStyleHint: "cute_chibi",
    extraPromptInstruction:
      "CAMPAIGN OVERRIDE — 「水水貼圖」: Every sticker must look glossy/dewy/translucent — like wet jelly or water droplets. Always render the eyes BIG, ROUND, GLASSY, with a bright white sparkle highlight (or 2). Skin/character surface should have a soft sheen, almost candy-like. Use a rounded, plump, bouncy character silhouette. Pastel palette with cool highlights. The whole pack should feel kawaii, dewy, three-dimensional.",
  },
  {
    id: "tears",
    label: "眼淚製造機",
    fullName: "眼淚製造機表情貼特輯",
    submitTag: "眼淚製造機表情貼特輯",
    submitDeadline: "2026-06-14",
    bannerPeriod: "2026/06/22 ~ 07/05",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30606762.html",
    blurb: "每張都要有眼淚（笑到流淚/委屈/崩潰大哭都可）。",
    forceWithText: null,
    forceStyleHint: null,
    phrasePoolOverride: [
      "哭哭", "嗚嗚", "想哭", "委屈", "淚崩",
      "笑到流淚", "我錯了", "對不起", "求求你", "別這樣",
      "心碎了", "抱抱", "好難過", "別走", "嗚嗚嗚",
    ],
    extraPromptInstruction:
      "CAMPAIGN OVERRIDE — 「眼淚製造機表情貼特輯」: EVERY single cell MUST clearly show tears or watery eyes. Vary the type — choose from: full sobbing tear streams down both cheeks, single tear running down one cheek, eyes welling up shimmering with unshed tears, laugh-tears at the corners of squeezed-shut eyes, comical waterfall tears spraying out, sparkly cute tear dots. Tears should be obvious even at chat-thumbnail size. The 9 cells must vary the tear type AND the matching emotion (sad / overwhelmed / laughing / sorry / pleading) — no two cells with identical tear placement.",
  },
  {
    id: "big_face",
    label: "大臉攻擊",
    fullName: "大臉攻擊！",
    submitTag: "大臉攻擊！",
    submitDeadline: "2026-05-10",
    bannerPeriod: "2026/05/13 ~ 05/26",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30606761.html",
    blurb: "臉佔畫面 80%+，大頭塞滿格子或像貼到螢幕上。",
    forceWithText: null,
    forceStyleHint: null,
    extraPromptInstruction:
      "CAMPAIGN OVERRIDE — 「大臉攻擊！」: TIGHT FACE CLOSE-UP framing for every single cell. The face must occupy 80%+ of the cell area — crop just above the forehead and just below the chin, with ears touching or going off the edges. NO body, NO hands, NO scenery. The character's face should look like it is pressed up against a window — alternatively, draw the face filling the entire frame edge to edge. Every cell uses a different exaggerated facial expression. Mouth, eyes, and brows are the entire performance.",
  },
  // ---- Expired (kept for record; frontend hides past-deadline entries) ----
  {
    id: "abstract_comedy",
    label: "抽象搞笑研究所",
    fullName: "抽象搞笑研究所貼圖特輯",
    submitTag: "抽象搞笑研究所貼圖特輯",
    submitDeadline: "2026-03-08",
    bannerPeriod: "2026/03/11 ~ 03/24",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30055665.html",
    blurb: "醜萌、五官抽象、比例不對稱、筆觸崩壞。",
    forceWithText: null,
    forceStyleHint: null,
    extraPromptInstruction:
      "CAMPAIGN OVERRIDE — 「抽象搞笑研究所貼圖特輯」: Off-kilter, ugly-cute, deliberately bad-on-purpose drawing style. Asymmetric features (one eye much bigger than the other), off-balance proportions, intentionally wobbly lines, exaggerated to the point of looking broken. Think marker-on-napkin doodles, but each one absurdly funny. NOT polished — the broken-ness IS the appeal.",
  },
  {
    id: "taiwan_flavor",
    label: "台味大出巡",
    fullName: "台味大出巡（神明也瘋狂 / 台灣感性）",
    submitTag: "神明也瘋狂 / 台灣感性",
    submitDeadline: "2026-04-02",
    bannerPeriod: "2026/04/16 ~ 04/29",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30416643.html",
    blurb: "台灣神明 / 日常文化感。固定價 NT$60。",
    forceWithText: null,
    forceStyleHint: null,
    extraPromptInstruction:
      "CAMPAIGN OVERRIDE — 「台味大出巡」: Strong Taiwanese cultural flavor in every cell — choose ONE of: (A) deities/folk-religion characters (Mazu, Lord Guan, Tudigong, lion dancers, Bā jiā jiàng) doing modern relatable things; (B) Taiwanese daily-life moments (boba tea, scooter culture, night-market food, betel-nut stand vibe, electric fans in hot weather, cartoony 7-11 vibes). Keep the look colorful and inviting.",
  },
];

function campaignsManifest() {
  return CAMPAIGNS.map((c) => ({
    id: c.id,
    label: c.label,
    fullName: c.fullName,
    submitTag: c.submitTag,
    submitDeadline: c.submitDeadline,
    bannerPeriod: c.bannerPeriod,
    articleUrl: c.articleUrl,
    blurb: c.blurb,
    forceWithText: c.forceWithText,
    forceStyleHint: c.forceStyleHint,
  }));
}

function campaignById(id) {
  return CAMPAIGNS.find((c) => c.id === id) || null;
}

// Visual style presets the frontend can switch between.
const STYLE_PRESETS = {
  match: "Match the reference image's exact art style — keep the same drawing technique, line weight, color palette, and rendering. If the reference is a photo, output photo-style stickers; if anime, anime; if 3D, 3D.",
  cute_chibi: "Cute chibi sticker style: oversized head, small body, big sparkling eyes, simplified rounded shapes, soft pastel palette but keep the character identifiable from the reference.",
  bold_outline: "Bold cartoon sticker style: thick black outlines, flat saturated colors, simple shapes, expressive faces — like classic LINE stickers. Keep the character recognizable from the reference.",
  watercolor: "Soft watercolor painting style: gentle washes of color, hand-painted feel, light pencil-like outlines, dreamy and warm.",
  pixel: "16-bit pixel art style: chunky pixels, limited palette, no anti-aliasing, retro game feel.",
  meme_template: "Classic internet meme / reaction-image style: keep the reference character but exaggerate the facial expression to peak meme energy. Any text on the sticker is rendered in BOLD IMPACT-style font, all caps when Latin, white fill with hard black outline, hugging the top or bottom edge of the cell. Composition leans high-contrast and immediately readable as a meme. Captions can be longer than typical sticker text (a full sentence or punchline is OK).",
  hand_drawn: "Loose hand-drawn marker doodle style: wobbly lines, casual sketchy fills, looks like it was scribbled on a napkin in 30 seconds. Charming low-effort vibe — perfect for shitpost stickers.",
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build a manifest of the default phrase pool with stable ids.
// Frontend uses these ids to pin specific phrases to specific slots.
function phrasesManifest() {
  return DEFAULT_PHRASES.map((label, id) => ({ id, label }));
}

// Resolve a per-slot config (length 0..9) into a length-9 phrase array.
// Each slot can be:
//   null              → random pick from defaults (excluding already-used)
//   { phraseId: N }   → DEFAULT_PHRASES[N]
//   { phraseCustom }  → free text
// Slots beyond the user's array are treated as null (random).
// Custom flat-array `phrases` is supported as a fallback for backward
// compat — equivalent to a length-N array of { phraseCustom: phrases[i] }
// padded out with nulls.
function pickNinePhrases({ slots, phrases, campaign }) {
  // Decide the pool used to fill un-pinned slots:
  //   campaign.phrasePoolOverride > user's `phrases` array > DEFAULT_PHRASES
  const camp = campaign ? campaignById(campaign) : null;
  const fallbackPool =
    (camp && Array.isArray(camp.phrasePoolOverride) && camp.phrasePoolOverride) ||
    (Array.isArray(phrases) && phrases.length > 0
      ? phrases.map((p) => String(p || "").trim()).filter(Boolean)
      : null) ||
    DEFAULT_PHRASES;

  // Backward-compat: no slots, only flat phrases pool — random draw 9.
  if (!Array.isArray(slots) && fallbackPool !== DEFAULT_PHRASES) {
    if (fallbackPool.length >= 9) return shuffle(fallbackPool).slice(0, 9);
    const extras = shuffle(
      DEFAULT_PHRASES.filter((d) => !fallbackPool.includes(d))
    ).slice(0, 9 - fallbackPool.length);
    return shuffle(fallbackPool.concat(extras));
  }

  const result = new Array(9).fill(null);
  const used = new Set();
  const slotArr = Array.isArray(slots) ? slots : [];

  // Pass 1: fill explicit pins (slot pins ALWAYS win, even over campaign pool).
  for (let i = 0; i < 9; i++) {
    const slot = slotArr[i];
    if (!slot) continue;
    if (typeof slot.phraseCustom === "string" && slot.phraseCustom.trim()) {
      const t = slot.phraseCustom.trim();
      result[i] = t;
      used.add(t);
    } else if (
      Number.isInteger(slot.phraseId) &&
      slot.phraseId >= 0 &&
      slot.phraseId < DEFAULT_PHRASES.length
    ) {
      const t = DEFAULT_PHRASES[slot.phraseId];
      result[i] = t;
      used.add(t);
    }
  }

  // Pass 2: fill nulls with random non-used picks from the chosen pool.
  const remaining = shuffle(fallbackPool.filter((p) => !used.has(p)));
  for (let i = 0; i < 9; i++) {
    if (result[i] === null) {
      result[i] =
        remaining.pop() ||
        fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
    }
  }
  return result;
}

function actionFor(phrase) {
  return ACTION_FOR_PHRASE[phrase]
    || "expressive sticker pose appropriate for the phrase";
}

// IMPORTANT: pass `nine` in pre-computed by the caller (NOT internally
// derived) — pickNinePhrases is non-deterministic (Math.random + shuffle),
// so calling it twice in one request yields TWO different sets. The
// prompt and the response MUST share the same nine phrases.
function buildPrompt({ nine, styleHint, withText, campaign }) {
  const camp = campaign ? campaignById(campaign) : null;
  // Campaign forces win over user input.
  const effectiveStyle = (camp && camp.forceStyleHint) || styleHint;
  const effectiveWithText =
    camp && camp.forceWithText !== null && camp.forceWithText !== undefined
      ? camp.forceWithText
      : withText;
  if (!Array.isArray(nine) || nine.length !== 9) {
    throw new Error("buildPrompt: `nine` must be a length-9 array");
  }
  const style = STYLE_PRESETS[effectiveStyle] || STYLE_PRESETS.match;
  withText = effectiveWithText; // override the local var the rest of the fn uses

  const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const NAMES = [
    "top-left", "top-centre", "top-right",
    "middle-left", "middle-centre", "middle-right",
    "bottom-left", "bottom-centre", "bottom-right",
  ];
  const layout = LETTERS.map((letter, i) => {
    const phrase = nine[i];
    const action = actionFor(phrase);
    const textRule = withText
      ? `; print the phrase "${phrase}" boldly on the sticker EXACTLY as written (preserve every character — Chinese, English, Japanese, emoji, punctuation — verbatim). Use a large rounded font with a white stroke, easy to read at thumbnail size.`
      : `; do NOT print any text on the sticker (the phrase is just the emotional cue)`;
    return withText
      ? `  [${letter}] ${NAMES[i]} cell:\n      EXACT TEXT TO PRINT (verbatim, character-by-character, no substitution): "${phrase}"\n      TEXT STYLE: Impact-meme style — PURE WHITE fill with a thick (5-8px) PURE BLACK outline hugging every glyph. Bold rounded sans-serif font. Readable on any chat background. Place text at the top OR bottom edge of the cell, edge-to-edge. The black outline matches the character's black outline for visual unity.\n      ACTION/POSE: ${action}`
      : `  [${letter}] ${NAMES[i]} cell → action: ${action}${textRule}`;
  }).join("\n");

  const diagram = `\`\`\`
+------+------+------+
|  A   |  B   |  C   |
+------+------+------+
|  D   |  E   |  F   |
+------+------+------+
|  G   |  H   |  I   |
+------+------+------+
\`\`\``;

  return `Create a single 3×3 grid image: 3 rows × 3 columns of 9 equal-size square LINE-style stickers featuring the same character from the reference image. Each tile is ONE complete chat sticker.

STYLE: ${style}

CHARACTER CONSISTENCY: every tile shows the SAME identifiable character from the reference — same face, hair, clothing, color palette, body proportions. Only the expression and pose change between tiles.

STICKER FRAMING (every tile):
- Subject is the upper body or full body of the character, fully inside the cell with comfortable margin.
- Background is plain solid PURE NEON GREEN (#00FF00) — this is a chroma-key plate that will be programmatically removed by the downstream tool. Use the brightest, most saturated, most uniform green possible. NO gradients, NO shading, NO scenery, NO patterns. Same identical green across all 9 cells.
- CRITICAL: the character itself must contain NO GREEN elements anywhere. NO green clothes, NO green hair, NO green eyes, NO green accessories, NO green objects. If the original reference has any green, substitute it with red, orange, blue, purple, or yellow. Even slight greenish tints on white clothes or skin should be avoided. This is essential — green pixels on the character will be chroma-keyed out and become holes.
- CHARACTER OUTLINE: trace the entire character silhouette with a clean, uniform 2-3px PURE BLACK outline (the boundary between character and the green background). Apply consistently and identically across ALL 9 cells. This gives the sticker pack a unified "die-cut sticker" look and lets downstream bg removal find the silhouette precisely. Even photo-realistic stickers should have this clean black outline added.
- No drop shadows touching the cell edges (small soft shadow under feet OK).
- Bold, lively poses — readable at chat-thumbnail size (~120×120 px).

LAYOUT — each cell shows EXACTLY the action mapped to its letter; do not swap, merge, or skip cells:

${diagram}

${layout}

OUTPUT RULES — strictly enforced:
- Final image is a 3×3 sticker grid. ONE seamless 1:1 image.
- No visible borders, gutters, dividers, or letter labels (A..I) drawn on the image. The layout above is for you, not text to paint.
- ${withText
    ? 'Each cell may contain ONLY the assigned phrase as overlaid text — render it in whatever script/language it was written in (Chinese / English / Japanese / Korean / emoji / mixed all OK). Do NOT add extra words, do NOT translate, do NOT add decorative letters/numbers beyond what is in the assigned phrase.'
    : 'No text, letters, numbers, captions, or watermarks anywhere on the image.'}
- Every cell must use a PURE WHITE background — uniform across all 9 cells, no off-white, no cream, no gray.
- The character must be obviously the same person/creature/style as the reference in all 9 cells.
- Two cells MUST NOT share the same pose — vary arms, head tilt, expression.
- ${withText
    ? 'TEXT FIDELITY (most important rule): the 9 phrases above are FIXED — render each phrase EXACTLY as assigned to its letter, character by character. Do NOT swap a phrase between cells. Do NOT substitute with synonyms. Do NOT translate or paraphrase. Do NOT pick alternative phrases from the same theme. The text on cell A must be the exact string after "EXACT TEXT TO PRINT" for cell A — no exceptions.'
    : 'No text means no text — zero characters anywhere.'}${
    camp && camp.extraPromptInstruction
      ? `\n\n${camp.extraPromptInstruction}`
      : ""
  }`;
}

// ---------- LINE Login authentication ----------

function getBearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Verifies a LINE access_token via the public LINE verify endpoint AND
// returns the associated profile. Returns null on any failure (expired,
// wrong channel, network error, etc.) so the caller can 401 cleanly.
async function getLineUser(accessToken) {
  if (!accessToken) return null;
  try {
    const verifyRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!verifyRes.ok) return null;
    const verify = await verifyRes.json();
    if (!verify.expires_in || verify.expires_in <= 0) return null;
    if (
      EXPECTED_LINE_CHANNEL_ID &&
      verify.client_id &&
      String(verify.client_id) !== EXPECTED_LINE_CHANNEL_ID
    ) {
      return null; // token is from a different LINE Login channel
    }

    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) return null;
    const profile = await profileRes.json();
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
    };
  } catch {
    return null;
  }
}

// ---------- Daily quota tracking via Cloudflare KV ----------
//
// Keyed `quota:<userId>:<YYYY-MM-DD UTC>`. TTL is 36 hours so old keys
// self-clean a day after the count became irrelevant. If the QUOTA KV
// binding is missing (e.g. local dev without KV), quota is reported as
// unlimited so the app still functions.

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function quotaKey(userId) {
  return `quota:${userId}:${todayUTC()}`;
}

async function readQuota(env, userId) {
  if (!env || !env.QUOTA) return { used: 0, limit: DAILY_LIMIT, kvAvailable: false };
  const used = parseInt((await env.QUOTA.get(quotaKey(userId))) || "0", 10);
  return { used, limit: DAILY_LIMIT, kvAvailable: true };
}

async function bumpQuota(env, userId) {
  if (!env || !env.QUOTA) return DAILY_LIMIT; // pretend unlimited if no KV
  const k = quotaKey(userId);
  const used = parseInt((await env.QUOTA.get(k)) || "0", 10);
  const next = used + 1;
  await env.QUOTA.put(k, String(next), { expirationTtl: 60 * 60 * 36 });
  return next;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    const cors = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method === "GET") {
      if (url.pathname === "/phrases") {
        return json({ phrases: phrasesManifest() }, 200, cors);
      }
      if (url.pathname === "/styles") {
        return json({ styles: Object.keys(STYLE_PRESETS) }, 200, cors);
      }
      if (url.pathname === "/campaigns") {
        return json({ campaigns: campaignsManifest() }, 200, cors);
      }
      if (url.pathname === "/me") {
        // Returns the current LINE user + quota. Requires Bearer token.
        const token = getBearerToken(request);
        const user = await getLineUser(token);
        if (!user) {
          return json({ error: "auth required or invalid LINE token" }, 401, cors);
        }
        const quota = await readQuota(env, user.userId);
        return json({ user, quota, lineChannelId: EXPECTED_LINE_CHANNEL_ID }, 200, cors);
      }
      if (url.pathname === "/config") {
        // Public — frontend uses this to render the LINE Login button
        // without hard-coding the channel ID in JS.
        return json({
          lineChannelId: EXPECTED_LINE_CHANNEL_ID,
          dailyLimit: DAILY_LIMIT,
        }, 200, cors);
      }
      return json({ ok: true, service: "line-sticker-gemini" }, 200, cors);
    }

    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405, cors);
    }

    // POST /prompt — returns the assembled prompt without calling Gemini.
    // Useful for letting the user copy the prompt into gemini.google.com
    // themselves to save the operator's API budget.
    if (url.pathname === "/prompt") {
      let body;
      try { body = await request.json(); } catch { body = {}; }
      const nine = pickNinePhrases({
        slots: body?.slots,
        phrases: body?.phrases,
        campaign: body?.campaign,
      });
      const promptText = buildPrompt({
        nine,
        styleHint: body?.styleHint,
        withText: body?.withText !== false,
        campaign: body?.campaign,
      });
      return json({ prompt: promptText, phrases: nine }, 200, cors);
    }

    if (!env.VERTEX_API_KEY) {
      return json(
        { error: "server misconfigured: VERTEX_API_KEY missing" },
        500,
        cors,
      );
    }

    // ---- LINE Login auth + daily quota gate ----
    const token = getBearerToken(request);
    const user = await getLineUser(token);
    if (!user) {
      return json(
        {
          error: "auth required",
          hint: "byog",
          message: "請先用 LINE 登入。或不想登入：自己用 Gemini 跑 3×3 圖、上傳到 BYOG 路徑（免費）。",
        },
        401,
        cors,
      );
    }
    const quotaBefore = await readQuota(env, user.userId);
    if (quotaBefore.used >= quotaBefore.limit) {
      return json(
        {
          error: "daily quota exceeded",
          hint: "byog",
          quota: quotaBefore,
          message: `今天的 ${quotaBefore.limit} 次 AI 生成已用完。可以複製 prompt 自己到 Gemini 跑、再丟回來走 BYOG 路徑（免費、不限次）。明天 UTC 0 點重置。`,
        },
        429,
        cors,
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400, cors);
    }

    const {
      imageBase64,
      mimeType = "image/jpeg",
      prompt,
      model,
      phrases,
      slots,
      styleHint,
      withText,
      campaign,
    } = body || {};

    if (typeof imageBase64 !== "string" || imageBase64.length < 100) {
      return json({ error: "imageBase64 is required" }, 400, cors);
    }
    if (imageBase64.length * 0.75 > MAX_INPUT_BYTES) {
      return json({ error: "image too large (max ~7.5 MB)" }, 413, cors);
    }

    const chosenModel = (model || env.DEFAULT_MODEL || DEFAULT_MODEL).trim();
    // Pick the 9 phrases ONCE per request, then use the same set both for
    // the prompt sent to Gemini AND the response we return to the client.
    // (Earlier bug: pickNinePhrases was called twice → two different
    //  random sets, so the response's `phrases` field never matched what
    //  Gemini actually saw, making fidelity testing meaningless.)
    const nine = pickNinePhrases({ slots, phrases, campaign });
    const chosenPrompt = typeof prompt === "string" && prompt.trim()
      ? prompt
      : buildPrompt({
          nine,
          styleHint,
          withText: withText !== false,
          campaign,
        });

    const apiUrl = `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(chosenModel)}:generateContent?key=${env.VERTEX_API_KEY}`;

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: chosenPrompt },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
      },
    };

    let upstream;
    try {
      upstream = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return json(
        { error: "upstream fetch failed", detail: String(err) },
        502,
        cors,
      );
    }

    if (!upstream.ok) {
      const text = await upstream.text();
      return json(
        {
          error: "upstream error",
          status: upstream.status,
          detail: text.slice(0, 1500),
        },
        502,
        cors,
      );
    }

    const data = await upstream.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData);
    if (!imagePart) {
      return json(
        {
          error: "no image in response",
          raw: JSON.stringify(data).slice(0, 1500),
        },
        502,
        cors,
      );
    }

    // Decrement only on confirmed Gemini success — don't burn the user's
    // quota for upstream failures.
    const usedAfter = await bumpQuota(env, user.userId);

    return json(
      {
        mimeType: imagePart.inlineData.mimeType || "image/png",
        data: imagePart.inlineData.data,
        model: chosenModel,
        phrases: nine,
        campaign: campaign || null,
        quota: { used: usedAfter, limit: DAILY_LIMIT },
      },
      200,
      cors,
    );
  },
};
