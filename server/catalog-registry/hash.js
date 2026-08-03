"use strict";

const crypto = require("crypto");

/**
 * Deterministic JSON: sorted object keys, arrays keep order, no undefined.
 */
function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalValue(value[key]);
    }
    return out;
  }
  return String(value);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Content hash for one registry version (links to prev via prevContentHash).
 */
function computeContentHash({
  entityType,
  entityId,
  parentSpriteId = null,
  seq,
  eventType,
  occurredAt,
  source,
  payload,
  prevContentHash = null
}) {
  return sha256Hex(
    canonicalJson({
      entityType,
      entityId,
      parentSpriteId: parentSpriteId || null,
      seq: Number(seq),
      eventType,
      occurredAt,
      source,
      payload: payload == null ? null : payload,
      prevContentHash: prevContentHash || null
    })
  );
}

module.exports = { canonicalJson, canonicalValue, sha256Hex, computeContentHash };
