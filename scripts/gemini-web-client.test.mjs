import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiWebJsonClient } from "./gemini-web-client.mjs";

const campaign = {
  id: "cute_chibi",
  label: "可愛貼圖",
  fullName: "可愛角色貼圖特輯活動",
  submitTag: "可愛角色貼圖特輯活動",
  submitDeadline: "2026-12-31",
  bannerPeriod: "2027/01/01 ~ 01/31",
  blurb: "以圓潤可愛的角色表現日常情緒。",
};

function apiResponse(modelText, { status = 200, finishReason = "STOP" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 503 ? "Service Unavailable" : "OK",
    text: async () =>
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: modelText }] },
            finishReason,
          },
        ],
      }),
  };
}

test("gemini-web JSON 文字端點送出相容請求並解析活動資料", async () => {
  let request;
  const client = createGeminiWebJsonClient({
    baseUrl: "https://gemini.example.test/service/",
    apiKey: "gmw_test_key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return apiResponse(JSON.stringify(campaign));
    },
  });

  assert.deepEqual(await client("請抽取活動資料"), campaign);
  assert.equal(
    request.url,
    "https://gemini.example.test/service/v1beta/models/gemini-2.5-flash:generateContent",
  );
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["x-goog-api-key"], "gmw_test_key");
  assert.deepEqual(JSON.parse(request.options.body), {
    contents: [{ role: "user", parts: [{ text: "請抽取活動資料" }] }],
    generationConfig: { responseMimeType: "application/json" },
  });
});

test("HTTP 200 的截斷模型 JSON 會以明確原因失敗", async () => {
  const client = createGeminiWebJsonClient({
    baseUrl: "https://gemini.example.test",
    apiKey: "gmw_test_key",
    fetchImpl: async () => apiResponse('{"id":"cute_chibi",'),
  });

  await assert.rejects(client("prompt"), /不是合法 JSON，可能遭截斷/);
});

test("gemini-web 回 5xx 會以 HTTP 狀態失敗", async () => {
  const client = createGeminiWebJsonClient({
    baseUrl: "https://gemini.example.test",
    apiKey: "gmw_test_key",
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "服務暫時無法使用",
    }),
  });

  await assert.rejects(client("prompt"), /HTTP 503 Service Unavailable：服務暫時無法使用/);
});

test("HTTP 200 的服務錯誤本文會顯示服務原因", async () => {
  const client = createGeminiWebJsonClient({
    baseUrl: "https://gemini.example.test",
    apiKey: "gmw_test_key",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ error: { message: "佇列暫時已滿" } }),
    }),
  });

  await assert.rejects(client("prompt"), /回報服務錯誤：佇列暫時已滿/);
});

test("HTTP 200 的截斷服務本文會以疑似截斷失敗", async () => {
  const client = createGeminiWebJsonClient({
    baseUrl: "https://gemini.example.test",
    apiKey: "gmw_test_key",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => '{"candidates":[',
    }),
  });

  await assert.rejects(client("prompt"), /本文不是合法 JSON，可能遭截斷/);
});

test("HTTP 200 但模型以 MAX_TOKENS 結束會視為疑似截斷", async () => {
  const client = createGeminiWebJsonClient({
    baseUrl: "https://gemini.example.test",
    apiKey: "gmw_test_key",
    fetchImpl: async () => apiResponse(JSON.stringify(campaign), { finishReason: "MAX_TOKENS" }),
  });

  await assert.rejects(client("prompt"), /MAX_TOKENS.*疑似截斷/);
});

test("缺少活動欄位時不會被當成沒有活動", async () => {
  const client = createGeminiWebJsonClient({
    baseUrl: "https://gemini.example.test",
    apiKey: "gmw_test_key",
    fetchImpl: async () => apiResponse('{"id":"cute_chibi"}'),
  });

  await assert.rejects(client("prompt"), /缺少必要欄位：label、fullName、submitTag/);
});

test("只有明確的 JSON null 代表不是活動文章", async () => {
  const client = createGeminiWebJsonClient({
    baseUrl: "https://gemini.example.test",
    apiKey: "gmw_test_key",
    fetchImpl: async () => apiResponse("null"),
  });

  assert.equal(await client("prompt"), null);
});

test("截止日格式不對時丟出可辨識的單篇驗證錯誤", async () => {
  const { validateCampaignResult, CampaignValidationError } = await import("./gemini-web-client.mjs");
  const bad = { id: "x", label: "x", fullName: "x", submitTag: "x", submitDeadline: "未公布", bannerPeriod: "x", blurb: "x" };
  assert.throws(() => validateCampaignResult(bad), (e) => e instanceof CampaignValidationError && e.name === "CampaignValidationError");
});
