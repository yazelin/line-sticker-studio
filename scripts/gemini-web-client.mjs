const MODEL = "gemini-2.5-flash";
const REQUIRED_CAMPAIGN_FIELDS = [
  "id",
  "label",
  "fullName",
  "submitTag",
  "submitDeadline",
  "bannerPeriod",
  "blurb",
];

export function createGeminiWebJsonClient({
  baseUrl,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 180_000,
}) {
  if (!baseUrl) throw new Error("缺少環境變數 GEMINI_WEB_BASE_URL。");
  if (!apiKey) throw new Error("缺少環境變數 GEMINI_API_KEY。");

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${MODEL}:generateContent`;

  return async function requestJson(prompt) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(`連線 gemini-web 失敗：${error.message}`);
    }

    const responseText = await response.text();
    if (!response.ok) {
      const detail = responseText.trim().slice(0, 300);
      throw new Error(
        `gemini-web 回應 HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}` +
          (detail ? `：${detail}` : "。"),
      );
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`gemini-web 回應本文不是合法 JSON，可能遭截斷：${error.message}`);
    }

    if (payload?.error) {
      const detail = typeof payload.error === "string"
        ? payload.error
        : payload.error.message || JSON.stringify(payload.error);
      throw new Error(`gemini-web 回報服務錯誤：${detail}`);
    }

    const candidate = payload?.candidates?.[0];
    if (!candidate || !Array.isArray(candidate.content?.parts)) {
      throw new Error("gemini-web 回應缺少 candidates[0].content.parts 欄位。");
    }
    if (typeof candidate.finishReason !== "string") {
      throw new Error("gemini-web 回應缺少 candidates[0].finishReason 欄位。");
    }
    if (candidate.finishReason !== "STOP") {
      const hint = candidate.finishReason === "MAX_TOKENS" ? "，疑似截斷" : "";
      throw new Error(`模型回應未正常結束（finishReason=${candidate.finishReason}）${hint}。`);
    }

    const modelText = candidate.content.parts
      .map((part) => part?.text)
      .filter((part) => typeof part === "string")
      .join("");
    if (!modelText.trim()) throw new Error("模型回應缺少文字內容。");

    let parsed;
    try {
      parsed = JSON.parse(modelText);
    } catch (error) {
      throw new Error(`模型回應不是合法 JSON，可能遭截斷：${error.message}`);
    }

    return validateCampaignResult(parsed);
  };
}

// 模型有回應、但這一篇抽出來的內容不合格式。這是單篇文章的問題，
// 呼叫端可以跳過這一篇繼續；服務連不上、回應截斷這類錯誤不用這個類別。
export class CampaignValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CampaignValidationError";
  }
}

export function validateCampaignResult(value) {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CampaignValidationError("模型回應必須是活動 JSON 物件或 null。");
  }

  const missingFields = REQUIRED_CAMPAIGN_FIELDS.filter(
    (field) => !Object.hasOwn(value, field),
  );
  if (missingFields.length > 0) {
    throw new CampaignValidationError(`活動 JSON 缺少必要欄位：${missingFields.join("、")}。`);
  }

  for (const field of REQUIRED_CAMPAIGN_FIELDS) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new CampaignValidationError(`活動 JSON 欄位 ${field} 必須是非空字串。`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.submitDeadline)) {
    throw new CampaignValidationError("活動 JSON 欄位 submitDeadline 必須使用 YYYY-MM-DD 格式。");
  }

  return value;
}
