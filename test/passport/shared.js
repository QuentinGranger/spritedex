// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Collector Passport (Étapes 1–10)
// Run against a live server: node server.js, then npm run test:passport
// ─────────────────────────────────────────────────────────────────
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;

const assert = require("node:assert");
const {
  passportReliability,
  buildBadges,
  computePassportProgress,
  computeOwnedRarityStats
} = require("../../server/passport");
const { sameVariantSet } = require("../../server/passport-achievements");
const { OFFICIAL_RARITY_SCORE, specialVariantScore } = require("../../server/passport-math");
const {
  resolveCompareSource,
  isCountableCompareResult,
  recordComparisonSession,
  getComparisonStatsForUser,
  ensureComparisonSessionsTable
} = require("../../server/comparison-sessions");
const {
  ensurePassportActivityTable,
  recordOwnedVariants,
  listRecentActivity,
  writeActivity,
  ALLOWED_ACTIVITY_TYPES,
  ACTIVITY_FEED_LIMIT
} = require("../../server/passport-activity");
const {
  ensurePassportBadgeTables,
  evaluateBadgeCondition,
  listBadgeDefinitions,
  listUserBadges,
  VERIFICATION_STATUSES,
  meetsCompletionThreshold,
  evaluateAndAwardComplementaryBadge
} = require("../../server/passport-badges");
const { pool } = require("../../server/db");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = `${BASE}/api`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}

function rnd() {
  return Math.random().toString(36).slice(2, 10);
}

async function register(username) {
  const email = `${username}_${rnd()}@example.com`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "password123",
      username,
      ageConfirmed: true,
      cguAccepted: true
    })
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, username };
}

function auth(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function cleanup(user) {
  if (!user) return;
  await fetch(`${API}/profile/${user.id}`, { method: "DELETE", headers: auth(user.token) });
}

async function getPassport(token, userId) {
  const res = await fetch(`${API}/profile/${userId}/passport`, { headers: auth(token) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function setEntry(token, userId, variantId, status) {
  const res = await fetch(`${API}/collection/${userId}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ status })
  });
  assert.ok(res.ok, `setEntry failed: ${await res.text()}`);
}

async function getActiveVariants(token) {
  const res = await fetch(`${API}/sprites`, { headers: auth(token) });
  assert.ok(res.ok, "sprites failed");
  const { sprites } = await res.json();
  const excluded = new Set(["unreleased", "upcoming", "coming_soon", "soon", "unknown"]);
  const ids = [];
  const bySprite = new Map();
  for (const sprite of sprites) {
    for (const variant of Object.values(sprite.variantDetails || {})) {
      const release = String(variant.releaseStatus || "").toLowerCase();
      if (variant.available === false || excluded.has(release)) continue;
      ids.push(variant.id);
      if (!bySprite.has(sprite.id)) bySprite.set(sprite.id, []);
      bySprite.get(sprite.id).push(variant.id);
    }
  }
  return { ids, bySprite };
}

function results() {
  return { passed, failed };
}

module.exports = {
  assert,
  passportReliability,
  buildBadges,
  computePassportProgress,
  computeOwnedRarityStats,
  sameVariantSet,
  OFFICIAL_RARITY_SCORE,
  specialVariantScore,
  resolveCompareSource,
  isCountableCompareResult,
  recordComparisonSession,
  getComparisonStatsForUser,
  ensureComparisonSessionsTable,
  ensurePassportActivityTable,
  recordOwnedVariants,
  listRecentActivity,
  writeActivity,
  ALLOWED_ACTIVITY_TYPES,
  ACTIVITY_FEED_LIMIT,
  ensurePassportBadgeTables,
  evaluateBadgeCondition,
  listBadgeDefinitions,
  listUserBadges,
  VERIFICATION_STATUSES,
  meetsCompletionThreshold,
  evaluateAndAwardComplementaryBadge,
  pool,
  BASE,
  API,
  test,
  rnd,
  register,
  auth,
  cleanup,
  getPassport,
  setEntry,
  getActiveVariants,
  results
};
