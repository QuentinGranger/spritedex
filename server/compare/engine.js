"use strict";

// ── Server-side comparison engine (mirrors js/compare.js logic) ──
const COMPARE_SERVER_RULES = {
  owned: ["owned"],
  missing: ["missing", "priority", "spotted", "unavailable"],
  recommend: ["missing", "priority", "spotted"],
  unknown: ["new", "unknown", "unsure"]
};

function compareServerIsOwned(status) {
  return COMPARE_SERVER_RULES.owned.includes(status);
}
function compareServerIsMissing(status) {
  return COMPARE_SERVER_RULES.missing.includes(status);
}
function compareServerIsUnknown(status) {
  return !status || COMPARE_SERVER_RULES.unknown.includes(status);
}
function compareServerIsRecommend(status) {
  return COMPARE_SERVER_RULES.recommend.includes(status);
}

function compareServerIsPriority(entry) {
  if (!entry) return false;
  const s = entry.status;
  if (s === "unavailable" || compareServerIsOwned(s) || compareServerIsUnknown(s)) return false;
  if (s === "priority") return true;
  return !!(entry.priority && entry.priority !== "none" && entry.priority !== "ignored");
}

function compareServerClassify(entry) {
  const s = entry?.status;
  if (compareServerIsOwned(s)) return "owned";
  if (compareServerIsMissing(s)) return "missing";
  return "unknown";
}

function compareServerIsExplicitEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.status && !COMPARE_SERVER_RULES.unknown.includes(entry.status)) return true;
  if (entry.note && String(entry.note).trim()) return true;
  if (entry.priority && entry.priority !== "none" && entry.priority !== "ignored") return true;
  return false;
}

function countServerExplicitCollectionEntries(collection) {
  if (!collection || typeof collection !== "object") return 0;
  let count = 0;
  for (const [key, entry] of Object.entries(collection)) {
    if (key.startsWith("fav_")) continue;
    if (compareServerIsExplicitEntry(entry)) count++;
  }
  return count;
}

function compareServerDefaultEntry() {
  return { status: "new", priority: "none", note: "" };
}

module.exports = {
  compareServerIsOwned,
  compareServerIsMissing,
  compareServerIsUnknown,
  compareServerIsRecommend,
  compareServerIsPriority,
  compareServerClassify,
  compareServerIsExplicitEntry,
  countServerExplicitCollectionEntries,
  compareServerDefaultEntry,
  COMPARE_SERVER_RULES
};
