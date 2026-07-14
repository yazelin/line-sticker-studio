// Issue #60 — prepaid credits: redeem-code flow via the header quota chip.
import { test, expect } from "@playwright/test";
import { stubExternal, WORKER_ORIGIN } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
});

test("quota chip shows the free counter and is the redeem entry point", async ({ page }) => {
  await page.goto("/");
  const chip = page.locator("#auth-quota");
  await expect(chip).toHaveText("今日免費 AI 剩 1 / 1");
  await expect(chip).toHaveAttribute("title", /兌換碼/);
});

test("redeeming a code updates the balance display", async ({ page }) => {
  await page.context().route(`${WORKER_ORIGIN}/redeem`, (r) =>
    r.fulfill({ json: { ok: true, credits: 50, balance: 50 } }));
  await page.goto("/");
  const dialogs = [];
  page.on("dialog", (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    // prompt → enter the code; alert → dismiss.
    return d.type() === "prompt"
      ? d.accept("lss-abcd-efgh-jkmn-pqrs")
      : d.accept();
  });
  await page.locator("#auth-quota").click();
  await expect(page.locator("#auth-quota")).toHaveText("額度 50｜免費 1/1");
  expect(dialogs[0].type).toBe("prompt");
  expect(dialogs[1].message).toContain("兌換成功");
});

test("failed redeem keeps the free counter and surfaces the reason", async ({ page }) => {
  await page.context().route(`${WORKER_ORIGIN}/redeem`, (r) =>
    r.fulfill({
      status: 400,
      json: { error: "code already redeemed", message: "這組兌換碼已經用過了。" },
    }));
  await page.goto("/");
  const alerts = [];
  page.on("dialog", (d) =>
    d.type() === "prompt" ? d.accept("LSS-AAAA-AAAA-AAAA-AAAA") : (alerts.push(d.message()), d.accept()));
  await page.locator("#auth-quota").click();
  await expect.poll(() => alerts.length).toBe(1);
  expect(alerts[0]).toContain("用過");
  await expect(page.locator("#auth-quota")).toHaveText("今日免費 AI 剩 1 / 1");
});
