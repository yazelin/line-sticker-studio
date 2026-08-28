// 上游掛掉時，使用者看到的是一句人話，不是原始錯誤字串。
// 跑法：node worker/test-upstream-message.mjs
//
// worker 匯入 campaigns.json 沒帶 import attribute（workerd 吃得下、node 不吃），
// 所以先複製一份到暫存目錄、把那行補上再 import。不動正式檔。
import { mkdtempSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "lss-worker-"));
cpSync(join(here, "src"), dir, { recursive: true });
writeFileSync(
  join(dir, "index.js"),
  readFileSync(join(here, "src/index.js"), "utf8")
    .replace(/from\s+"\.\/campaigns\.json";/, 'from "./campaigns.json" with { type: "json" };'),
);

const worker = (await import(pathToFileURL(join(dir, "index.js")).href)).default;

const env = {
  TURNSTILE_SECRET: "stub",
  GEMINI_WEB_BASE_URL: "https://example.invalid/gemini-web",
  GEMINI_API_KEY: "k",
};

// Turnstile 放行；上游回 Cloudflare 的 522 錯誤頁（2026-08-28 那次的原樣）。
globalThis.fetch = async (url) =>
  String(url).includes("challenges.cloudflare.com")
    ? new Response(JSON.stringify({ success: true }), { status: 200 })
    : new Response("error code: 522", { status: 522 });

const resp = await worker.fetch(
  new Request("https://w/generate-themes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "工程師 debug 人生", turnstileToken: "t" }),
  }),
  env,
  { waitUntil() {} },
);
const body = await resp.json();
console.log(resp.status, JSON.stringify(body));
if (resp.status !== 502) throw new Error("狀態碼應為 502");
if (body.error !== "連線不穩，請稍後再試一次") throw new Error("沒回人話：" + body.error);
if (JSON.stringify(body).includes("522")) throw new Error("原始錯誤外洩到前端了");
console.log("ok");
