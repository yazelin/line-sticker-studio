// Self-check for credits.js — run with: node worker/test-credits.mjs
// Mock-KV in-memory; fails loudly (assert) if redeem/spend logic breaks.
import assert from "node:assert/strict";
import {
  formatCode,
  mintCodes,
  normalizeCode,
  normalizeUid,
  readBalance,
  redeemCode,
  refundCredit,
  spendCredit,
} from "./src/credits.js";

const store = new Map();
const env = {
  QUOTA: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  },
};

// --- normalize ---
assert.equal(normalizeUid("  abc-123-DEF  "), "abc-123-DEF");
assert.equal(normalizeUid("x"), null);
assert.equal(normalizeUid(42), null);
assert.equal(normalizeCode("lss-abcd-efgh-jkmn-pqrs"), "ABCDEFGHJKMNPQRS");
assert.equal(normalizeCode("LSSABCDEFGHJKMNPQRS"), "ABCDEFGHJKMNPQRS");
assert.equal(normalizeCode("LSS-ABCD"), null);          // too short
assert.equal(normalizeCode("XXX-ABCD-EFGH-JKMN-PQRS"), null); // bad prefix
assert.equal(normalizeCode("LSS-ABCD-EFGH-JKMN-PQR0"), null); // 0 not in alphabet

// --- mint ---
const codes = await mintCodes(env, 50, 2);
assert.equal(codes.length, 2);
assert.match(codes[0], /^LSS(-[A-Z2-9]{4}){4}$/);
assert.equal(formatCode(normalizeCode(codes[0])), codes[0]); // round-trip

// --- redeem ---
const uid = "11111111-2222-3333-4444-555555555555";
let r = await redeemCode(env, codes[0].toLowerCase(), uid);
assert.deepEqual(r, { ok: true, credits: 50, balance: 50 });
r = await redeemCode(env, codes[0], uid);
assert.equal(r.error, "code already redeemed"); // double-redeem blocked
r = await redeemCode(env, codes[1], uid);
assert.equal(r.balance, 100); // second code stacks
r = await redeemCode(env, "LSS-AAAA-AAAA-AAAA-AAAA", uid);
assert.equal(r.error, "unknown code");
r = await redeemCode(env, "not a code", uid);
assert.equal(r.error, "bad code format");

// --- spend / refund ---
assert.equal(await spendCredit(env, uid), 99);
assert.equal(await spendCredit(env, uid), 98);
assert.equal(await refundCredit(env, uid), 99);
assert.equal(await readBalance(env, uid), 99);
assert.equal(await spendCredit(env, "no-balance-uid"), null); // falls back to daily
assert.equal(await readBalance(env, "no-balance-uid"), 0);

console.log("credits self-check: all assertions passed");
