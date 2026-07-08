var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-Eod10n/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/campaigns.json
var campaigns_default = [
  {
    id: "no_text",
    label: "\u7121\u5B57\u6D6E\u8A87",
    fullName: "\u7121\u5B57\u6D6E\u8A87\u8CBC\u5716\u7279\u8F2F",
    submitTag: "\u7121\u5B57\u6D6E\u8A87\u8CBC\u5716\u7279\u8F2F",
    submitDeadline: "2026-07-12",
    bannerPeriod: "\u672A\u516C\u5E03",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30678325.html",
    blurb: "\u6574\u7D44\u7D14\u8868\u60C5/\u80A2\u9AD4\u50B3\u9054\u60C5\u7DD2\u3001\u7D55\u5C0D\u4E0D\u80FD\u6709\u5B57\u3002",
    forceWithText: false,
    forceStyleHint: null,
    extraPromptInstruction: "CAMPAIGN OVERRIDE \u2014 \u300C\u7121\u5B57\u6D6E\u8A87\u8CBC\u5716\u7279\u8F2F\u300D: This whole pack must convey emotion ENTIRELY through facial expressions and body language. ABSOLUTELY NO TEXT, LETTERS, NUMBERS, EMOJI, OR PUNCTUATION anywhere in any cell \u2014 checked strictly. Each pose must be theatrical and exaggerated, the kind that reads at a glance with zero captions. Vary head tilt, eye direction, hand position, and body posture across all 9 cells."
  },
  {
    id: "watery",
    label: "\u6C34\u6C34\uFF08\u6C34\u4EAE\u4EAE\uFF09",
    fullName: "\u6C34\u6C34\u8CBC\u5716",
    submitTag: "\u6C34\u6C34\u8CBC\u5716",
    submitDeadline: "2026-06-14",
    bannerPeriod: "2026/06/17 ~ 06/30",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30606764.html",
    blurb: "Q \u840C\u3001\u679C\u51CD\u4EAE\u4EAE\u53CD\u5149\u3001\u5927\u773C\u6C34\u6C6A\u6C6A\u3002",
    forceWithText: null,
    forceStyleHint: "cute_chibi",
    extraPromptInstruction: "CAMPAIGN OVERRIDE \u2014 \u300C\u6C34\u6C34\u8CBC\u5716\u300D: Every sticker must look glossy/dewy/translucent \u2014 like wet jelly or water droplets. Always render the eyes BIG, ROUND, GLASSY, with a bright white sparkle highlight (or 2). Skin/character surface should have a soft sheen, almost candy-like. Use a rounded, plump, bouncy character silhouette. Pastel palette with cool highlights. The whole pack should feel kawaii, dewy, three-dimensional."
  },
  {
    id: "tears",
    label: "\u773C\u6DDA\u88FD\u9020\u6A5F\uFF08\u8868\u60C5\u8CBC\u5C08\u7528\uFF0C\u975E\u8CBC\u5716\uFF09",
    fullName: "\u773C\u6DDA\u88FD\u9020\u6A5F\u8868\u60C5\u8CBC\u7279\u8F2F",
    submitTag: "\u773C\u6DDA\u88FD\u9020\u6A5F\u8868\u60C5\u8CBC\u7279\u8F2F",
    submitDeadline: "2026-06-14",
    bannerPeriod: "2026/06/22 ~ 07/05",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30606762.html",
    blurb: "\u26A0 \u9019\u500B\u7279\u8F2F\u53EA\u6536\u300C\u8868\u60C5\u8CBC\u300D(sticon) \u985E\u578B\uFF0C\u672C\u5DE5\u5177\u7522\u7684\u662F\u300C\u8CBC\u5716\u300D(370\xD7320) \u4E0D\u9069\u7528\u3002prompt \u4ECD\u53EF\u7528\u4F5C\u54ED\u54ED\u4E3B\u984C\u53C3\u8003\u3002",
    forceWithText: null,
    forceStyleHint: null,
    phrasePoolOverride: [
      "\u54ED\u54ED",
      "\u55DA\u55DA",
      "\u60F3\u54ED",
      "\u59D4\u5C48",
      "\u6DDA\u5D29",
      "\u7B11\u5230\u6D41\u6DDA",
      "\u6211\u932F\u4E86",
      "\u5C0D\u4E0D\u8D77",
      "\u6C42\u6C42\u4F60",
      "\u5225\u9019\u6A23",
      "\u5FC3\u788E\u4E86",
      "\u62B1\u62B1",
      "\u597D\u96E3\u904E",
      "\u5225\u8D70",
      "\u55DA\u55DA\u55DA"
    ],
    extraPromptInstruction: "CAMPAIGN OVERRIDE \u2014 \u300C\u773C\u6DDA\u88FD\u9020\u6A5F\u8868\u60C5\u8CBC\u7279\u8F2F\u300D: EVERY single cell MUST clearly show tears or watery eyes. Vary the type \u2014 choose from: full sobbing tear streams down both cheeks, single tear running down one cheek, eyes welling up shimmering with unshed tears, laugh-tears at the corners of squeezed-shut eyes, comical waterfall tears spraying out, sparkly cute tear dots. Tears should be obvious even at chat-thumbnail size. The 9 cells must vary the tear type AND the matching emotion (sad / overwhelmed / laughing / sorry / pleading) \u2014 no two cells with identical tear placement."
  },
  {
    id: "big_face",
    label: "\u5927\u81C9\u653B\u64CA",
    fullName: "\u5927\u81C9\u653B\u64CA\uFF01",
    submitTag: "\u5927\u81C9\u653B\u64CA\uFF01",
    submitDeadline: "2026-05-10",
    bannerPeriod: "2026/05/13 ~ 05/26",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30606761.html",
    blurb: "\u81C9\u4F54\u756B\u9762 80%+\uFF0C\u5927\u982D\u585E\u6EFF\u683C\u5B50\u6216\u50CF\u8CBC\u5230\u87A2\u5E55\u4E0A\u3002",
    forceWithText: null,
    forceStyleHint: null,
    extraPromptInstruction: "CAMPAIGN OVERRIDE \u2014 \u300C\u5927\u81C9\u653B\u64CA\uFF01\u300D: TIGHT FACE CLOSE-UP framing for every single cell. The face must occupy 80%+ of the cell area \u2014 crop just above the forehead and just below the chin, with ears touching or going off the edges. NO body, NO hands, NO scenery. The character's face should look like it is pressed up against a window \u2014 alternatively, draw the face filling the entire frame edge to edge. Every cell uses a different exaggerated facial expression. Mouth, eyes, and brows are the entire performance."
  },
  {
    id: "abstract_comedy",
    label: "\u62BD\u8C61\u641E\u7B11\u7814\u7A76\u6240",
    fullName: "\u62BD\u8C61\u641E\u7B11\u7814\u7A76\u6240\u8CBC\u5716\u7279\u8F2F",
    submitTag: "\u62BD\u8C61\u641E\u7B11\u7814\u7A76\u6240\u8CBC\u5716\u7279\u8F2F",
    submitDeadline: "2026-03-08",
    bannerPeriod: "2026/03/11 ~ 03/24",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30055665.html",
    blurb: "\u919C\u840C\u3001\u4E94\u5B98\u62BD\u8C61\u3001\u6BD4\u4F8B\u4E0D\u5C0D\u7A31\u3001\u7B46\u89F8\u5D29\u58DE\u3002",
    forceWithText: null,
    forceStyleHint: null,
    extraPromptInstruction: "CAMPAIGN OVERRIDE \u2014 \u300C\u62BD\u8C61\u641E\u7B11\u7814\u7A76\u6240\u8CBC\u5716\u7279\u8F2F\u300D: Off-kilter, ugly-cute, deliberately bad-on-purpose drawing style. Asymmetric features (one eye much bigger than the other), off-balance proportions, intentionally wobbly lines, exaggerated to the point of looking broken. Think marker-on-napkin doodles, but each one absurdly funny. NOT polished \u2014 the broken-ness IS the appeal."
  },
  {
    id: "taiwan_flavor",
    label: "\u53F0\u5473\u5927\u51FA\u5DE1",
    fullName: "\u53F0\u5473\u5927\u51FA\u5DE1\uFF08\u795E\u660E\u4E5F\u760B\u72C2 / \u53F0\u7063\u611F\u6027\uFF09",
    submitTag: "\u795E\u660E\u4E5F\u760B\u72C2 / \u53F0\u7063\u611F\u6027",
    submitDeadline: "2026-04-02",
    bannerPeriod: "2026/04/16 ~ 04/29",
    articleUrl: "https://creator-mag-tw.weblog.to/archives/30416643.html",
    blurb: "\u53F0\u7063\u795E\u660E / \u65E5\u5E38\u6587\u5316\u611F\u3002\u56FA\u5B9A\u50F9 NT$60\u3002",
    forceWithText: null,
    forceStyleHint: null,
    extraPromptInstruction: "CAMPAIGN OVERRIDE \u2014 \u300C\u53F0\u5473\u5927\u51FA\u5DE1\u300D: Strong Taiwanese cultural flavor in every cell \u2014 choose ONE of: (A) deities/folk-religion characters (Mazu, Lord Guan, Tudigong, lion dancers, B\u0101 ji\u0101 ji\xE0ng) doing modern relatable things; (B) Taiwanese daily-life moments (boba tea, scooter culture, night-market food, betel-nut stand vibe, electric fans in hot weather, cartoony 7-11 vibes). Keep the look colorful and inviting."
  }
];

// src/index.js
var DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
var MAX_INPUT_BYTES = 10 * 1024 * 1024;
var DAILY_LIMIT = 3;
var EXPECTED_LINE_CHANNEL_ID = "2009916047";
var ADMIN_LINE_USER_IDS = [
  "Ue9388ac5ea91bba25f76e1bd6ea766d3"
  // yazelin
];
var DEFAULT_PHRASES = [
  "\u54C8\u56C9",
  "\u55E8",
  "\u65E9\u5B89",
  "\u5348\u5B89",
  "\u665A\u5B89",
  "\u8B1D\u8B1D",
  "OK",
  "\u6536\u5230",
  "\u597D\u7684",
  "\u52A0\u6CB9",
  "\u7B11\u6B7B",
  "\u62DC\u8A17",
  "\u5C0D\u4E0D\u8D77",
  "\u6C92\u95DC\u4FC2",
  "\u5728\u55CE",
  "\u7B49\u7B49",
  "\u6211\u4F86\u4E86",
  "\u60F3\u4F60",
  "\u611B\u4F60",
  "\u6BD4\u5FC3",
  "\u52A0\u73ED\u4E2D",
  "\u597D\u9913",
  "\u60F3\u7761",
  "\u7D2F\u4E86",
  "\u958B\u5FC3",
  "\u751F\u6C23",
  "\u54ED\u54ED",
  "\u5BB3\u7F9E",
  "\u9A5A\u8A1D",
  "\u6536\u5DE5",
  "\u63B0\u63B0",
  "\u592A\u68D2\u4E86",
  "\u771F\u7684\u55CE",
  "\u885D\u554A",
  "\u77E5\u9053\u4E86",
  "\u5B89\u5B89",
  "\u563F\u563F",
  "\u55EF\u55EF",
  "\u665A\u9EDE\u804A",
  "\u8F9B\u82E6\u4E86",
  "\u53B2\u5BB3",
  "\u53EF\u611B",
  "\u8A8D\u771F",
  "\u518D\u898B",
  "\u6B50\u8CB7\u5C2C",
  "\u8DEA\u4E86",
  "\u62B1\u62B1",
  "\u557E",
  "\u5614\u5614\u5614",
  "\u4E0D\u8981"
];
var ACTION_FOR_PHRASE = {
  "\u54C8\u56C9": "smiling and waving one hand high",
  "\u55E8": "waving with a cheerful grin",
  "\u65E9\u5B89": "stretching arms up just woken, sleepy smile",
  "\u5348\u5B89": "holding a mug of coffee, relaxed pose",
  "\u665A\u5B89": "yawning with eyes half-closed, hand near mouth",
  "\u8B1D\u8B1D": "bowing with hands together in thanks",
  "OK": "making an OK sign with thumb and finger, confident smile",
  "\u6536\u5230": "saluting with a hand near forehead, sharp expression",
  "\u597D\u7684": "thumbs up with a bright smile",
  "\u52A0\u6CB9": "fist pumped in the air, determined look",
  "\u7B11\u6B7B": "laughing hysterically, head thrown back",
  "\u62DC\u8A17": "hands clasped pleading, puppy eyes",
  "\u5C0D\u4E0D\u8D77": "head down apologetic, hands clasped together",
  "\u6C92\u95DC\u4FC2": "shrugging with an easy smile, palms open",
  "\u5728\u55CE": "leaning forward squinting, finger to chin curious",
  "\u7B49\u7B49": "one palm forward in a STOP gesture, alarmed face",
  "\u6211\u4F86\u4E86": "running forward arms back, hair flying",
  "\u60F3\u4F60": "head tilted, hand on cheek, dreamy eyes",
  "\u611B\u4F60": "blowing a kiss with one hand, hearts in eyes",
  "\u6BD4\u5FC3": "making a finger heart with both hands",
  "\u52A0\u73ED\u4E2D": "exhausted at a laptop, dark circles under eyes",
  "\u597D\u9913": "holding stomach, drooling, hungry face",
  "\u60F3\u7761": "rubbing eyes drowsily, head drooping",
  "\u7D2F\u4E86": "slumped shoulders, defeated face",
  "\u958B\u5FC3": "jumping in the air arms wide, huge smile",
  "\u751F\u6C23": "puffed cheeks red face, fists clenched",
  "\u54ED\u54ED": "tears streaming, mouth open wailing",
  "\u5BB3\u7F9E": "blushing hard, hands covering face partially",
  "\u9A5A\u8A1D": "eyes huge, mouth wide open in shock",
  "\u6536\u5DE5": "wiping forehead, satisfied look, arms stretched",
  "\u63B0\u63B0": "waving goodbye with a soft smile",
  "\u592A\u68D2\u4E86": "double thumbs up, sparkling eyes",
  "\u771F\u7684\u55CE": "wide eyes, hands on cheeks in disbelief",
  "\u885D\u554A": "fist out punching forward, fired up",
  "\u77E5\u9053\u4E86": "nodding firmly, slight serious smile",
  "\u5B89\u5B89": "small wave at chest level, gentle smile",
  "\u563F\u563F": "mischievous grin, eyes squinted slyly",
  "\u55EF\u55EF": "nodding with eyes closed, agreeable face",
  "\u665A\u9EDE\u804A": "checking watch, polite smile",
  "\u8F9B\u82E6\u4E86": "patting own shoulder, warm smile",
  "\u53B2\u5BB3": "clapping hands enthusiastically",
  "\u53EF\u611B": "cheek squish with hands, sparkly eyes",
  "\u8A8D\u771F": "wearing a serious expression, finger pointed up",
  "\u518D\u898B": "waving with both hands, sad smile",
  "\u6B50\u8CB7\u5C2C": "hands on top of head, jaw dropped",
  "\u8DEA\u4E86": "kneeling on the ground, defeated",
  "\u62B1\u62B1": "arms wide open inviting a hug",
  "\u557E": "puckered lips kiss, one eye winked",
  "\u5614\u5614\u5614": "covering mouth, looking nauseated green-faced",
  "\u4E0D\u8981": "arms crossed in an X, frowning hard"
};
function campaignsManifest() {
  return campaigns_default.map((c) => ({
    id: c.id,
    label: c.label,
    fullName: c.fullName,
    submitTag: c.submitTag,
    submitDeadline: c.submitDeadline,
    bannerPeriod: c.bannerPeriod,
    articleUrl: c.articleUrl,
    blurb: c.blurb,
    forceWithText: c.forceWithText,
    forceStyleHint: c.forceStyleHint
  }));
}
__name(campaignsManifest, "campaignsManifest");
function campaignById(id) {
  return campaigns_default.find((c) => c.id === id) || null;
}
__name(campaignById, "campaignById");
var STYLE_PRESETS = {
  // === Default / Meta ===
  match: "Match the reference image's exact art style \u2014 keep the same drawing technique, line weight, color palette, and rendering. If the reference is a photo, output photo-style stickers; if anime, anime; if 3D, 3D.",
  // === Photo styles ===
  street_photography: "street photography, candid shot, natural light, urban setting, shallow depth of field, sharp focus on subject",
  dslr_portrait: "DSLR portrait, 85mm f/1.4 lens, creamy bokeh background, sharp focus on subject's eyes, professional studio look",
  film_35mm: "35mm film photography, grain, warm color cast, slight light leaks, vintage analogue feel",
  polaroid: "Polaroid instant film aesthetic, slightly faded colors, soft vignette, square frame look",
  studio_portrait: "studio portrait, clean key light + fill, neutral grey backdrop replaced with our keying green, sharp expression-focused composition",
  fashion_editorial: "high-fashion editorial photography, dramatic poses, magazine-quality lighting, glossy color grading",
  disposable_camera: "disposable film camera aesthetic, slight overexposure, flash glare, casual snapshot feel, 90s nostalgia",
  film_90s: "1990s film aesthetic, washed pastel tones, soft grain, vintage Asian magazine vibe",
  // === Painting / illustration ===
  watercolor: "soft watercolor painting, gentle washes of color, light pencil-like outlines, hand-painted feel, dreamy and warm",
  oil_painting: "oil painting, thick impasto brushstrokes, rich color palette, visible canvas texture",
  gouache: "gouache illustration, opaque matte paint, smooth flat areas with subtle brush texture",
  pencil_sketch: "pencil sketch, graphite on paper, hatching and cross-hatching, visible pencil strokes, traditional draftsman feel",
  colored_pencil: "colored pencil drawing, layered strokes, soft texture, warm hand-illustrated charm",
  chinese_ink: "Chinese ink wash painting, expressive brush strokes, minimal color, calligraphic quality, traditional East-Asian brush technique",
  ukiyoe: "Japanese woodblock print, flat color blocks, thick black outlines, traditional decorative patterns",
  impressionism: "impressionist painting, visible loose brush strokes, capture of light and color over detail, soft outdoor atmosphere",
  pop_art: "pop-art style, bold flat saturated colors, halftone dots, thick black outlines, mid-century commercial poster vibe",
  art_nouveau: "Art Nouveau illustration, ornate flowing lines, decorative botanical motifs, elegant 1900s decorative style",
  film_noir: "film noir aesthetic, high contrast black and white, dramatic shadows, smoky moody atmosphere",
  caricature: "caricature illustration, exaggerated key features, bold expression, comic portrait style",
  silhouette: "silhouette art, simple solid black/dark forms against bright background, strong shape recognition",
  // === Cartoon / anime ===
  manga: "Japanese manga style, dynamic linework, screentone shading, expressive eyes, black and white with selective color accents",
  soft_anime: "soft hand-drawn anime feature-film aesthetic, watercolor backgrounds, gentle nostalgic atmosphere, warm pastoral lighting",
  hyperreal_anime: "hyperrealistic anime style, semi-realistic proportions, detailed shading, vibrant glossy eyes",
  cel_shading: "cel-shaded animation, hard-edged shadows, flat color zones, classic 2D anime look",
  cute_chibi: "cute chibi sticker style: oversized head, small body, big sparkling eyes, simplified rounded shapes, soft pastel palette",
  bold_outline: "bold cartoon sticker style: thick black outlines, flat saturated colors, simple shapes, expressive faces, classic chat-sticker readability",
  flat_vector: "flat vector illustration, geometric shapes, no gradients, modern editorial style",
  doodle_line: "minimalist doodle line art, single-weight black outlines, ultra-clean simplification, almost icon-like",
  crayon: "crayon children's drawing aesthetic, wobbly waxy lines, scribbled fills, playful imperfect charm",
  // === 3D / craft ===
  polished_3d: "polished 3D character animation, smooth CG rendering, expressive features, warm soft global illumination, feature-film 3D animation aesthetic",
  blind_box_3d: "3D collectible-figure aesthetic, polished plastic surface, big-head proportions, designer-toy look",
  claymation: "stop-motion clay animation, sculpted clay character, visible fingerprint texture, handmade tactile charm",
  pixel_art: "16-bit pixel art, chunky pixels, limited retro palette, no anti-aliasing, classic retro game sprite feel",
  // === Trendy / niche ===
  cyberpunk: "cyberpunk aesthetic, neon-soaked night city, holographic elements, high-tech low-life mood",
  vaporwave: "vaporwave aesthetic, pink and teal pastel palette, glitchy retro 80s/90s elements, dreamy nostalgia",
  y2k: "Y2K aesthetic, chrome shiny metallic gradients, glossy bubble shapes, frosted plastic feel, early 2000s tech vibe",
  steampunk: "steampunk Victorian retro-futurism, brass gears, leather, copper pipes, ornate mechanical details",
  // === Generic chat-sticker DNA — original / no brand references ===
  classic_messenger_sticker: "classic chat-app messenger sticker aesthetic: thick clean black outline, flat saturated cute colors, simplified rounded character with big expressive eyes, soft drop shadow, friendly pop-up sticker pack readability \u2014 entirely original character, not imitating any specific brand.",
  pastel_kawaii: "minimal pastel kawaii style: thin delicate outlines, very soft pastel pink/pearl/mint palette, simplified facial features (small mouth, dot eyes), clean cute simplicity \u2014 entirely original design, no brand mascots.",
  webcomic_lineart: "modern webcomic lineart sticker style: light airy clean linework, soft cheek blush, expressive bright eyes, gentle pastel shading.",
  loose_handdrawn_doodle: "loose hand-drawn personal-doodle sticker style: relaxed wobbly lines, plain solid fills, simple character with relatable daily-life expression \u2014 original character, not imitating any published illustrator's mascot.",
  shitpost: "shitpost style: deliberately ugly-cute, asymmetric features, lazy drawing energy, like 5-second sketches that go viral exactly because they're so badly drawn.",
  retro_emoticon: "retro early-2000s messenger emoticon style: round yellow/peach face, simple dot eyes + curve mouth, glossy bubble look, nostalgic early-internet feel \u2014 generic round face, no specific app icon.",
  jelly_blob: "jelly-blob plush sticker style: glossy translucent gelatinous original character, soft 3D round form with light-reflection highlights, dewy candy aesthetic \u2014 fully original creature design.",
  glitter_sparkle: "Gen-Z glitter / sparkle aesthetic: shimmery rainbow pastel halftone backgrounds, sparkles around the character, holographic decoration, iridescent sticker-bomb energy.",
  black_marker: "black-marker zine style: hand-drawn with thick chunky black marker, cross-hatched shading, white correction-pen highlights, photocopy-zine aesthetic, 90s underground cool.",
  // === Special / meta ===
  meme_template: "Classic internet meme / reaction-image style: keep the reference character but exaggerate the facial expression to peak meme energy. Any text on the sticker is rendered in BOLD IMPACT-style font, all caps when Latin, white fill with hard black outline, hugging the top or bottom edge of the cell.",
  hand_drawn: "Loose hand-drawn marker doodle style: wobbly lines, casual sketchy fills, looks like it was scribbled on a napkin in 30 seconds."
};
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
__name(shuffle, "shuffle");
function phrasesManifest() {
  return DEFAULT_PHRASES.map((label, id) => ({ id, label }));
}
__name(phrasesManifest, "phrasesManifest");
function pickNineSlots({ slots, phrases, campaign }) {
  const camp = campaign ? campaignById(campaign) : null;
  const fallbackPool = camp && Array.isArray(camp.phrasePoolOverride) && camp.phrasePoolOverride || (Array.isArray(phrases) && phrases.length > 0 ? phrases.map((p) => String(p || "").trim()).filter(Boolean) : null) || DEFAULT_PHRASES;
  if (!Array.isArray(slots) && fallbackPool !== DEFAULT_PHRASES) {
    const picked = fallbackPool.length >= 9 ? shuffle(fallbackPool).slice(0, 9) : shuffle(
      fallbackPool.concat(
        shuffle(DEFAULT_PHRASES.filter((d) => !fallbackPool.includes(d))).slice(0, 9 - fallbackPool.length)
      )
    );
    return picked.map((phrase) => ({ phrase }));
  }
  const result = new Array(9).fill(null);
  const used = /* @__PURE__ */ new Set();
  const slotArr = Array.isArray(slots) ? slots : [];
  for (let i = 0; i < 9; i++) {
    const slot = slotArr[i];
    if (!slot)
      continue;
    const action = typeof slot.action === "string" && slot.action.trim() ? slot.action.trim() : void 0;
    if (typeof slot.phraseCustom === "string" && slot.phraseCustom.trim()) {
      const t = slot.phraseCustom.trim();
      result[i] = { phrase: t, action };
      used.add(t);
    } else if (Number.isInteger(slot.phraseId) && slot.phraseId >= 0 && slot.phraseId < DEFAULT_PHRASES.length) {
      const t = DEFAULT_PHRASES[slot.phraseId];
      result[i] = { phrase: t, action };
      used.add(t);
    }
  }
  const remaining = shuffle(fallbackPool.filter((p) => !used.has(p)));
  for (let i = 0; i < 9; i++) {
    if (result[i] === null) {
      const phrase = remaining.pop() || fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
      result[i] = { phrase };
    }
  }
  return result;
}
__name(pickNineSlots, "pickNineSlots");
function actionFor(slot) {
  if (slot && typeof slot.action === "string" && slot.action.trim()) {
    return slot.action.trim();
  }
  const phrase = slot && slot.phrase;
  return ACTION_FOR_PHRASE[phrase] || "expressive sticker pose appropriate for the phrase";
}
__name(actionFor, "actionFor");
function buildPrompt({ nine, styleHint, withText, campaign, lang }) {
  const camp = campaign ? campaignById(campaign) : null;
  const effectiveStyle = camp && camp.forceStyleHint || styleHint;
  const effectiveWithText = camp && camp.forceWithText !== null && camp.forceWithText !== void 0 ? camp.forceWithText : withText;
  if (!Array.isArray(nine) || nine.length !== 9) {
    throw new Error("buildPrompt: `nine` must be a length-9 array");
  }
  let style;
  if (STYLE_PRESETS[effectiveStyle]) {
    style = STYLE_PRESETS[effectiveStyle];
  } else if (typeof effectiveStyle === "string" && effectiveStyle.trim().length >= 2) {
    style = effectiveStyle.trim();
  } else {
    style = STYLE_PRESETS.match;
  }
  withText = effectiveWithText;
  const LANG_LABEL = {
    "zh-TW": "Traditional Chinese (\u7E41\u9AD4\u4E2D\u6587) glyphs",
    "zh-CN": "Simplified Chinese (\u7B80\u4F53\u4E2D\u6587) glyphs",
    en: "Latin alphabet English",
    ja: "Japanese kana + kanji glyphs",
    ko: "Korean Hangul glyphs"
  };
  const langScriptHint = LANG_LABEL[lang] || null;
  const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const NAMES = [
    "top-left",
    "top-centre",
    "top-right",
    "middle-left",
    "middle-centre",
    "middle-right",
    "bottom-left",
    "bottom-centre",
    "bottom-right"
  ];
  const layout = LETTERS.map((letter, i) => {
    const slot = nine[i];
    const phrase = slot.phrase;
    const action = actionFor(slot);
    if (withText) {
      return `  [${letter}] ${NAMES[i]} cell:
      EXACT TEXT TO PRINT (verbatim, character-by-character, no substitution): "${phrase}"
      TEXT STYLE: Impact-meme style \u2014 PURE WHITE fill with a thick (5-8px) PURE BLACK outline hugging every glyph. Bold rounded sans-serif font. Readable on any chat background. Place text at the top OR bottom edge of the cell, edge-to-edge. The black outline matches the character's black outline for visual unity.
      ACTION/POSE: ${action}`;
    }
    return `  [${letter}] ${NAMES[i]} cell:
      EMOTION CUE (do NOT render as text on the sticker \u2014 use ONLY as pose / facial-expression guidance): "${phrase}"
      ACTION/POSE: render a pose + facial expression that clearly conveys the feeling of "${phrase}". ${action}
      ABSOLUTELY NO TEXT, LETTERS, NUMBERS, OR EMOJI on this cell.`;
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
  return `Create a single 3\xD73 grid image: 3 rows \xD7 3 columns of 9 equal-size square LINE-style stickers featuring the same character from the reference image. Each tile is ONE complete chat sticker.

STYLE (DOMINANT \u2014 overrides the source image's medium):
${style}

This style applies to ALL 9 tiles. If the user provided a photo and the style says "anime / 3D / pixel / watercolor / etc", TRANSFORM the photo into that medium \u2014 do NOT keep it photo-realistic. If the style says "match" then keep the source medium; otherwise the style above wins. Color palette, line work, shading technique should all follow the STYLE block, not the source.

CHARACTER IDENTITY (persists across all 9 tiles, but is RE-RENDERED in the chosen style):
The character must be recognizably the same person/creature across all 9 tiles \u2014 same hair colour & shape, same clothing colour, same general face features. But identity does NOT mean keeping the source medium. If the source is a photo and the style is anime, the 9 tiles are 9 anime portraits of "this person turned anime". If the style is pixel art, the 9 tiles are 9 pixel-art versions of the same character. Only the pose / expression / phrase changes between tiles; the rendered art style stays uniform.

STICKER FRAMING (every tile):
- Subject is the upper body or full body of the character, fully inside the cell with comfortable margin.
- Background is plain solid PURE NEON GREEN (#00FF00) \u2014 this is a chroma-key plate that will be programmatically removed by the downstream tool. Use the brightest, most saturated, most uniform green possible. NO gradients, NO shading, NO scenery, NO patterns. Same identical green across all 9 cells.
- CRITICAL: the character itself must contain NO GREEN elements anywhere. NO green clothes, NO green hair, NO green eyes, NO green accessories, NO green objects. If the original reference has any green, substitute it with red, orange, blue, purple, or yellow. Even slight greenish tints on white clothes or skin should be avoided. This is essential \u2014 green pixels on the character will be chroma-keyed out and become holes.
- CHARACTER OUTLINE: trace the entire character silhouette with a clean, uniform 2-3px PURE BLACK outline (the boundary between character and the green background). Apply consistently and identically across ALL 9 cells. This gives the sticker pack a unified "die-cut sticker" look and lets downstream bg removal find the silhouette precisely. Even photo-realistic stickers should have this clean black outline added.
- No drop shadows touching the cell edges (small soft shadow under feet OK).
- Bold, lively poses \u2014 readable at chat-thumbnail size (~120\xD7120 px).

LAYOUT \u2014 each cell shows EXACTLY the action mapped to its letter; do not swap, merge, or skip cells:

${diagram}

${layout}

OUTPUT RULES \u2014 strictly enforced:
- Final image is a 3\xD73 sticker grid. ONE seamless 1:1 image.
- No visible borders, gutters, dividers, or letter labels (A..I) drawn on the image. The layout above is for you, not text to paint.
- ${withText ? `Each cell may contain ONLY the assigned phrase as overlaid text \u2014 render it in whatever script/language it was written in (Chinese / English / Japanese / Korean / emoji / mixed all OK). Do NOT add extra words, do NOT translate, do NOT add decorative letters/numbers beyond what is in the assigned phrase.${langScriptHint ? ` The user has indicated the intended sticker text language is ${langScriptHint} \u2014 render any glyphs cleanly and correctly in that script.` : ""}` : "No text, letters, numbers, captions, or watermarks anywhere on the image."}
- Every cell must use a PURE WHITE background \u2014 uniform across all 9 cells, no off-white, no cream, no gray.
- The character must be obviously the same person/creature/style as the reference in all 9 cells.
- Two cells MUST NOT share the same pose \u2014 vary arms, head tilt, expression.
- ${withText ? 'TEXT FIDELITY (most important rule): the 9 phrases above are FIXED \u2014 render each phrase EXACTLY as assigned to its letter, character by character. Do NOT swap a phrase between cells. Do NOT substitute with synonyms. Do NOT translate or paraphrase. Do NOT pick alternative phrases from the same theme. The text on cell A must be the exact string after "EXACT TEXT TO PRINT" for cell A \u2014 no exceptions.' : "NO TEXT anywhere \u2014 zero characters / letters / numbers / emoji on any tile. BUT each cell's pose and facial expression MUST clearly convey the EMOTION CUE phrase assigned to that letter. Cell A's pose expresses cell A's phrase, cell B's pose expresses cell B's phrase, etc. \u2014 do NOT shuffle which emotion goes to which cell. The phrase guides the drawing even though it is never rendered."}${camp && camp.extraPromptInstruction ? `

${camp.extraPromptInstruction}` : ""}`;
}
__name(buildPrompt, "buildPrompt");
function getBearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
__name(getBearerToken, "getBearerToken");
async function getLineUser(accessToken) {
  if (!accessToken)
    return null;
  try {
    const verifyRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!verifyRes.ok)
      return null;
    const verify = await verifyRes.json();
    if (!verify.expires_in || verify.expires_in <= 0)
      return null;
    if (EXPECTED_LINE_CHANNEL_ID && verify.client_id && String(verify.client_id) !== EXPECTED_LINE_CHANNEL_ID) {
      return null;
    }
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!profileRes.ok)
      return null;
    const profile = await profileRes.json();
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl
    };
  } catch {
    return null;
  }
}
__name(getLineUser, "getLineUser");
function todayUTC() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
__name(todayUTC, "todayUTC");
function quotaKey(userId) {
  return `quota:${userId}:${todayUTC()}`;
}
__name(quotaKey, "quotaKey");
async function readQuota(env, userId) {
  if (!env || !env.QUOTA)
    return { used: 0, limit: DAILY_LIMIT, kvAvailable: false };
  const used = parseInt(await env.QUOTA.get(quotaKey(userId)) || "0", 10);
  return { used, limit: DAILY_LIMIT, kvAvailable: true };
}
__name(readQuota, "readQuota");
async function bumpQuota(env, userId) {
  if (!env || !env.QUOTA)
    return DAILY_LIMIT;
  const k = quotaKey(userId);
  const used = parseInt(await env.QUOTA.get(k) || "0", 10);
  const next = used + 1;
  await env.QUOTA.put(k, String(next), { expirationTtl: 60 * 60 * 36 });
  return next;
}
__name(bumpQuota, "bumpQuota");
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}
__name(json, "json");
var src_default = {
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
        const token2 = getBearerToken(request);
        const user2 = await getLineUser(token2);
        if (!user2) {
          return json({ error: "auth required or invalid LINE token" }, 401, cors);
        }
        const quota = await readQuota(env, user2.userId);
        const isAdmin = ADMIN_LINE_USER_IDS.includes(user2.userId);
        return json(
          { user: user2, quota, lineChannelId: EXPECTED_LINE_CHANNEL_ID, isAdmin },
          200,
          cors
        );
      }
      if (url.pathname === "/config") {
        return json({
          lineChannelId: EXPECTED_LINE_CHANNEL_ID,
          dailyLimit: DAILY_LIMIT
        }, 200, cors);
      }
      return json({ ok: true, service: "line-sticker-gemini" }, 200, cors);
    }
    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405, cors);
    }
    if (url.pathname === "/generate-themes") {
      if (!env.VERTEX_API_KEY) {
        return json({ error: "VERTEX_API_KEY missing" }, 500, cors);
      }
      let body2;
      try {
        body2 = await request.json();
      } catch {
        body2 = {};
      }
      const description = String(body2?.description || "").trim();
      if (!description) {
        return json({ error: "description required" }, 400, cors);
      }
      const lang2 = String(body2?.lang || "zh-TW");
      const prompt2 = `\u4F60\u662F LINE \u8CBC\u5716\u6587\u6848 + \u52D5\u4F5C\u767C\u60F3\u52A9\u624B\u3002\u6839\u64DA\u4F7F\u7528\u8005\u63CF\u8FF0\u7684\u4E3B\u984C\uFF0C\u7522\u51FA 8 \u7D44\u300C\u77ED\u8A9E + \u5C0D\u61C9\u52D5\u4F5C\u63CF\u8FF0\u300D\u914D\u5C0D\u3002

\u6BCF\u7D44\u5305\u542B\uFF1A
- "phrase": 2-8 \u5B57\u77ED\u8A9E (\u8A9E\u6C23\u53E3\u8A9E\u3001\u804A\u5929\u611F\u3001\u60C5\u7DD2\u9BAE\u660E\u3001\u907F\u514D\u5EE3\u544A\u6216\u5546\u6A19)\u3002\u8A9E\u8A00\uFF1A${lang2 === "en" ? "English" : lang2 === "ja" ? "\u65E5\u672C\u8A9E" : lang2 === "ko" ? "\uD55C\uAD6D\uC5B4" : "\u7E41\u9AD4\u4E2D\u6587"}
- "action": 5-15 \u5B57\u82F1\u6587\u52D5\u4F5C + \u8868\u60C5\u63CF\u8FF0 (\u7528\u82F1\u6587\uFF0C\u56E0\u70BA Gemini image \u5C0D\u82F1\u6587 pose description \u7406\u89E3\u6700\u6E96)\u3002\u4F8B\uFF1A\u300Cslumped at desk, weary look, head in hands\u300D\u300Cjumping in the air arms wide, huge smile\u300D

\u4F7F\u7528\u8005\u4E3B\u984C\uFF1A\u300C${description}\u300D

\u8ACB\u53EA\u56DE JSON \u9663\u5217\u3001\u7121 markdown \u5305\u88DD\uFF1A
[
  {"phrase":"\u77ED\u8A9E1","action":"english action description"},
  {"phrase":"\u77ED\u8A9E2","action":"english action description"},
  ... \xD7 8
]`;
      const apiUrl2 = `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${env.VERTEX_API_KEY}`;
      const payload2 = {
        contents: [{ role: "user", parts: [{ text: prompt2 }] }],
        generationConfig: { responseMimeType: "application/json" }
      };
      try {
        const upstream2 = await fetch(apiUrl2, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload2)
        });
        if (!upstream2.ok) {
          const detail = await upstream2.text();
          return json({ error: "upstream", detail: detail.slice(0, 800) }, 502, cors);
        }
        const data2 = await upstream2.json();
        const text = data2?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          const m = text.match(/\[[\s\S]*\]/);
          parsed = m ? JSON.parse(m[0]) : [];
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return json({ error: "no phrases", raw: text.slice(0, 500) }, 502, cors);
        }
        const items = parsed.slice(0, 8).map((entry) => {
          if (typeof entry === "string")
            return { phrase: entry.trim() };
          if (entry && typeof entry === "object") {
            const phrase = String(entry.phrase || "").trim();
            const action = String(entry.action || "").trim();
            return action ? { phrase, action } : { phrase };
          }
          return { phrase: String(entry || "").trim() };
        }).filter((s) => s.phrase);
        return json(
          {
            // Back-compat field — string array of phrases only.
            phrases: items.map((s) => s.phrase),
            // New field — full {phrase, action} pairs.
            slots: items
          },
          200,
          cors
        );
      } catch (err) {
        return json({ error: "fetch failed", detail: String(err) }, 502, cors);
      }
    }
    if (url.pathname === "/admin/reset-quota") {
      const token2 = getBearerToken(request);
      const user2 = await getLineUser(token2);
      if (!user2)
        return json({ error: "auth required" }, 401, cors);
      if (!ADMIN_LINE_USER_IDS.includes(user2.userId)) {
        return json({ error: "forbidden \u2014 not an admin" }, 403, cors);
      }
      if (env.QUOTA) {
        await env.QUOTA.delete(quotaKey(user2.userId));
      }
      return json(
        { ok: true, message: "Quota reset to 0", userId: user2.userId },
        200,
        cors
      );
    }
    if (url.pathname === "/prompt") {
      let body2;
      try {
        body2 = await request.json();
      } catch {
        body2 = {};
      }
      const nine2 = pickNineSlots({
        slots: body2?.slots,
        phrases: body2?.phrases,
        campaign: body2?.campaign
      });
      const promptText = buildPrompt({
        nine: nine2,
        styleHint: body2?.styleHint,
        withText: body2?.withText !== false,
        campaign: body2?.campaign,
        lang: body2?.lang
      });
      return json(
        {
          prompt: promptText,
          phrases: nine2.map((s) => s.phrase),
          slots: nine2
        },
        200,
        cors
      );
    }
    if (!env.VERTEX_API_KEY) {
      return json(
        { error: "server misconfigured: VERTEX_API_KEY missing" },
        500,
        cors
      );
    }
    const token = getBearerToken(request);
    const user = await getLineUser(token);
    if (!user) {
      return json(
        {
          error: "auth required",
          hint: "byog",
          message: "\u8ACB\u5148\u7528 LINE \u767B\u5165\u3002\u6216\u4E0D\u60F3\u767B\u5165\uFF1A\u81EA\u5DF1\u7528 Gemini \u8DD1 3\xD73 \u5716\u3001\u4E0A\u50B3\u5230 BYOG \u8DEF\u5F91\uFF08\u514D\u8CBB\uFF09\u3002"
        },
        401,
        cors
      );
    }
    const quotaBefore = await readQuota(env, user.userId);
    if (quotaBefore.used >= quotaBefore.limit) {
      return json(
        {
          error: "daily quota exceeded",
          hint: "byog",
          quota: quotaBefore,
          message: `\u4ECA\u5929\u7684 ${quotaBefore.limit} \u6B21 AI \u751F\u6210\u5DF2\u7528\u5B8C\u3002\u53EF\u4EE5\u8907\u88FD prompt \u81EA\u5DF1\u5230 Gemini \u8DD1\u3001\u518D\u4E1F\u56DE\u4F86\u8D70 BYOG \u8DEF\u5F91\uFF08\u514D\u8CBB\u3001\u4E0D\u9650\u6B21\uFF09\u3002\u660E\u5929 UTC 0 \u9EDE\u91CD\u7F6E\u3002`
        },
        429,
        cors
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
      lang
    } = body || {};
    if (typeof imageBase64 !== "string" || imageBase64.length < 100) {
      return json({ error: "imageBase64 is required" }, 400, cors);
    }
    if (imageBase64.length * 0.75 > MAX_INPUT_BYTES) {
      return json({ error: "image too large (max ~7.5 MB)" }, 413, cors);
    }
    const chosenModel = (model || env.DEFAULT_MODEL || DEFAULT_MODEL).trim();
    const nine = pickNineSlots({ slots, phrases, campaign });
    const chosenPrompt = typeof prompt === "string" && prompt.trim() ? prompt : buildPrompt({
      nine,
      styleHint,
      withText: withText !== false,
      campaign,
      lang
    });
    const apiUrl = `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(chosenModel)}:generateContent?key=${env.VERTEX_API_KEY}`;
    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: chosenPrompt }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "2K" }
      }
    };
    let upstream;
    try {
      upstream = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      return json(
        { error: "upstream fetch failed", detail: String(err) },
        502,
        cors
      );
    }
    if (!upstream.ok) {
      const text = await upstream.text();
      return json(
        {
          error: "upstream error",
          status: upstream.status,
          detail: text.slice(0, 1500)
        },
        502,
        cors
      );
    }
    const data = await upstream.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData);
    if (!imagePart) {
      return json(
        {
          error: "no image in response",
          raw: JSON.stringify(data).slice(0, 1500)
        },
        502,
        cors
      );
    }
    const usedAfter = await bumpQuota(env, user.userId);
    return json(
      {
        mimeType: imagePart.inlineData.mimeType || "image/png",
        data: imagePart.inlineData.data,
        model: chosenModel,
        phrases: nine.map((s) => s.phrase),
        slots: nine,
        campaign: campaign || null,
        lang: lang || null,
        quota: { used: usedAfter, limit: DAILY_LIMIT }
      },
      200,
      cors
    );
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Eod10n/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Eod10n/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
