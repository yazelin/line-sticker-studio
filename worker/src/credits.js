// Prepaid credits via redeem codes, stored in the same QUOTA KV.
//
//   code:<CORE>  → {"credits":N,"redeemedBy":null|uid}   (minted, no TTL)
//   bal:<uid>    → "N"                                    (remaining credits)
//
// Codes are minted by POST /admin/make-codes (ADMIN_TOKEN) and handed to
// buyers manually or by the payment webhook. Redeeming binds the code to an
// anonymous frontend uid (localStorage randomUUID) and bumps the balance.
// KV is last-write-wins, same tradeoff as the daily quota — the per-IP
// in-flight lock already serializes the spend path.
// ponytail: no HMAC/signatures; unguessability = 16 random base32 chars
// (~78 bits). Modulo bias from `byte % 30` costs <1 bit, irrelevant here.

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no I/L/O/U/0/1

export function balKey(uid) {
  return `bal:${uid}`;
}

export function codeKey(core) {
  return `code:${core}`;
}

// Anonymous uid from the frontend (crypto.randomUUID). Reject anything
// that doesn't look like one so KV keys stay clean.
export function normalizeUid(raw) {
  if (typeof raw !== "string") return null;
  const uid = raw.trim();
  return /^[a-zA-Z0-9-]{8,64}$/.test(uid) ? uid : null;
}

// Accept "LSS-ABCD-EFGH-JKMN-PQRS", lowercase, extra spaces/dashes… and
// reduce to the 16-char core. Returns null if it can't be a code.
export function normalizeCode(raw) {
  if (typeof raw !== "string") return null;
  const flat = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!flat.startsWith("LSS")) return null;
  const core = flat.slice(3);
  if (core.length !== 16) return null;
  for (const ch of core) if (!CODE_ALPHABET.includes(ch)) return null;
  return core;
}

export function formatCode(core) {
  return `LSS-${core.slice(0, 4)}-${core.slice(4, 8)}-${core.slice(8, 12)}-${core.slice(12, 16)}`;
}

function randomCore() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

// Mint `count` codes worth `credits` each. Returns display-formatted codes.
export async function mintCodes(env, credits, count) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const core = randomCore();
    await env.QUOTA.put(
      codeKey(core),
      JSON.stringify({ credits, redeemedBy: null }),
    );
    codes.push(formatCode(core));
  }
  return codes;
}

export async function readBalance(env, uid) {
  if (!env || !env.QUOTA || !uid) return 0;
  return parseInt((await env.QUOTA.get(balKey(uid))) || "0", 10);
}

// Redeem a code for a uid. Returns { ok:true, credits, balance } or
// { ok:false, error } with a user-facing reason.
export async function redeemCode(env, rawCode, uid) {
  const core = normalizeCode(rawCode);
  if (!core) return { ok: false, error: "bad code format" };
  const key = codeKey(core);
  const rec = JSON.parse((await env.QUOTA.get(key)) || "null");
  if (!rec) return { ok: false, error: "unknown code" };
  if (rec.redeemedBy) return { ok: false, error: "code already redeemed" };
  rec.redeemedBy = uid;
  rec.redeemedAt = new Date().toISOString();
  await env.QUOTA.put(key, JSON.stringify(rec));
  const balance = (await readBalance(env, uid)) + rec.credits;
  await env.QUOTA.put(balKey(uid), String(balance));
  return { ok: true, credits: rec.credits, balance };
}

// Pre-emptively spend one credit (mirror of bumpQuota's charge-first
// policy). Returns the remaining balance, or null if there was nothing
// to spend — caller then falls back to the daily free slot.
export async function spendCredit(env, uid) {
  if (!env || !env.QUOTA || !uid) return null;
  const balance = await readBalance(env, uid);
  if (balance <= 0) return null;
  const next = balance - 1;
  await env.QUOTA.put(balKey(uid), String(next));
  return next;
}

// Refund one credit after a failed upstream call. Returns new balance.
export async function refundCredit(env, uid) {
  if (!env || !env.QUOTA || !uid) return null;
  const balance = (await readBalance(env, uid)) + 1;
  await env.QUOTA.put(balKey(uid), String(balance));
  return balance;
}
