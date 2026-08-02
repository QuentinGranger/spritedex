"use strict";

// RFC 6238 TOTP (HMAC-SHA1, 30s step) for terminal-admin MFA.
// No external dependency: secret is base32, codes are 6 digits.

const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function normalizeBase32(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/=+$/g, "")
    .toUpperCase();
}

function decodeBase32(value) {
  const cleaned = normalizeBase32(value);
  if (!cleaned || /[^A-Z2-7]/.test(cleaned)) return null;
  let bits = "";
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function encodeBase32(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

function generateTotpSecret(bytes = 20) {
  return encodeBase32(crypto.randomBytes(Math.max(10, Number(bytes) || 20)));
}

function hotp(secret, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter & 0xffffffff, 4);
  const digest = crypto.createHmac("sha1", secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function totpAt(secret, timeMs = Date.now(), stepSeconds = 30) {
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  return hotp(secret, counter);
}

function configuredTotpSecret(raw = process.env.ADMIN_TOTP_SECRET || "") {
  const decoded = decodeBase32(raw);
  if (!decoded || decoded.length < 10) return null;
  return decoded;
}

function isAdminMfaConfigured() {
  return !!configuredTotpSecret();
}

function isAdminMfaRequired() {
  if (isAdminMfaConfigured()) return true;
  const flag = String(process.env.ADMIN_REQUIRE_MFA || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function verifyTotpCode(code, options = {}) {
  return matchTotpCode(code, options) != null;
}

function matchTotpCode(code, {
  secret = process.env.ADMIN_TOTP_SECRET || "",
  window = 1,
  stepSeconds = 30,
  now = Date.now()
} = {}) {
  const key = configuredTotpSecret(secret);
  if (!key) return null;
  const digits = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const counter = Math.floor(now / 1000 / stepSeconds);
  const skew = Math.max(0, Math.min(2, Number(window) || 1));
  for (let offset = -skew; offset <= skew; offset += 1) {
    const candidate = counter + offset;
    const expected = hotp(key, candidate);
    const left = Buffer.from(expected);
    const right = Buffer.from(digits);
    if (left.length === right.length && crypto.timingSafeEqual(left, right)) {
      return candidate;
    }
  }
  return null;
}

async function consumeTotpCode(code, {
  db = null,
  purpose = "login",
  secret = process.env.ADMIN_TOTP_SECRET || "",
  window = 1,
  now = Date.now()
} = {}) {
  const key = configuredTotpSecret(secret);
  if (!key) return { ok: false, reason: "not_configured" };
  const matched = matchTotpCode(code, { secret, window, now });
  if (matched == null) return { ok: false, reason: "invalid" };
  const replayKey = crypto.createHash("sha256")
    .update(Buffer.concat([key, Buffer.from(`:${matched}`)]))
    .digest("hex");

  const run = async (client) => {
    await client.query(
      `DELETE FROM admin_totp_replays WHERE used_at < NOW() - INTERVAL '15 minutes'`
    );
    const inserted = await client.query(
      `INSERT INTO admin_totp_replays (replay_key, counter_value, purpose)
       VALUES ($1, $2, $3)
       ON CONFLICT (replay_key) DO NOTHING
       RETURNING replay_key`,
      [replayKey, matched, String(purpose || "login").slice(0, 40)]
    );
    if (!inserted.rows.length) return { ok: false, reason: "replay" };
    return { ok: true, counter: matched };
  };

  if (db) return run(db);
  const { pool } = require("./db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    if (!result.ok) {
      await client.query("ROLLBACK");
      return result;
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function buildTotpUri({
  secret = process.env.ADMIN_TOTP_SECRET || "",
  label = "SPRITE-INDEX Backoffice",
  issuer = "SPRITE-INDEX"
} = {}) {
  const normalized = normalizeBase32(secret);
  if (!normalized) return null;
  const params = new URLSearchParams({
    secret: normalized,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = {
  decodeBase32,
  encodeBase32,
  generateTotpSecret,
  totpAt,
  isAdminMfaConfigured,
  isAdminMfaRequired,
  verifyTotpCode,
  matchTotpCode,
  consumeTotpCode,
  buildTotpUri,
  configuredTotpSecret
};
