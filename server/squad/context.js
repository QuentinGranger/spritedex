// routes-squad.js — extracted from server.js

const security = require("../../security");
const analytics = require("../../analytics");
const {
  getRequestingUser,
  isBlocked,
  requireNotSuspended,
  requireSquadMember,
  areFriends,
  getRelationship,
  shareSquad,
  canViewCollection
} = require("../auth");
const { APP_URL, app } = require("../core");
const compare = require("../compare");
const { pool } = require("../db");
const { resolveAddressee } = require("../friends/helpers");
const { getVisibleSquadMemberIds, refreshSquadStats } = require("../routes-squad-invitations");
const {
  computeCatalogueVersion,
  getCachedOrComputeSquadAnalysis,
  invalidateSquadAnalysisCache
} = require("../squad-analysis-cache");
const crypto = require("crypto");
const QRCode = require("qrcode");

const MAX_USER_ID = 2147483647;
const MAX_SQUAD_SIMULATION_CHANGES = 20;
const MAX_SQUAD_SIMULATION_VARIANTS = 100;
const MAX_SQUAD_SIMULATION_TEXT_LENGTH = 80;
const MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH = 120;
const SQUAD_SIMULATION_TYPES = new Set(["acquire", "join", "leave", "unavailable", "add_event"]);
const squadSimulationLimiter = security.rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: "squad-simulation",
  message: "Trop de simulations. Réessaie dans une minute."
});

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parsePositiveUserId(value) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^[1-9]\d*$/.test(String(value).trim())) {
    return null;
  }
  const id = Number(String(value).trim());
  return Number.isSafeInteger(id) && id <= MAX_USER_ID ? id : null;
}

function normalizeSimulationMemberId(value, { field = "memberId", required = true, allowSynthetic = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return required ? { error: `${field} requis` } : { value: null };
  }
  const numericId = parsePositiveUserId(value);
  if (numericId !== null) return { value: numericId };
  if (allowSynthetic && typeof value === "string") {
    const normalized = value.trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(normalized)) return { value: normalized };
  }
  return { error: `${field} invalide` };
}

function normalizeSimulationText(value, field) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string") return { error: `${field} invalide` };
  const normalized = value.trim();
  if (normalized.length > MAX_SQUAD_SIMULATION_TEXT_LENGTH) {
    return { error: `${field} trop long (${MAX_SQUAD_SIMULATION_TEXT_LENGTH} max)` };
  }
  return { value: normalized || null };
}

function normalizeSimulationVariantIds(value, { field = "variantIds", required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return required ? { error: `${field} requis` } : { value: [] };
  }

  let rawIds;
  if (Array.isArray(value)) {
    rawIds = value;
  } else if (typeof value === "string") {
    if (value.length > MAX_SQUAD_SIMULATION_VARIANTS * (MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH + 1)) {
      return { error: `${field} trop volumineux` };
    }
    rawIds = value.split(",");
  } else {
    return { error: `${field} invalide` };
  }

  if (rawIds.length > MAX_SQUAD_SIMULATION_VARIANTS) {
    return { error: `Trop de variantes (${MAX_SQUAD_SIMULATION_VARIANTS} max)` };
  }

  const variantIds = [];
  const seen = new Set();
  for (const rawId of rawIds) {
    if (typeof rawId !== "string" && typeof rawId !== "number") {
      return { error: "Identifiant de variante invalide" };
    }
    const variantId = String(rawId).trim();
    if (!variantId || variantId.length > MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH) {
      return { error: "Identifiant de variante invalide" };
    }
    if (!seen.has(variantId)) {
      seen.add(variantId);
      variantIds.push(variantId);
    }
  }
  if (required && !variantIds.length) return { error: `${field} requis` };
  return { value: variantIds };
}

function normalizeSimulationChange(change) {
  if (!isPlainObject(change)) return { error: "Changement de simulation invalide" };
  if (typeof change.type !== "string" || !SQUAD_SIMULATION_TYPES.has(change.type)) {
    return { error: "Type de changement invalide" };
  }

  const normalized = { type: change.type };
  if (change.type === "acquire") {
    const memberId = normalizeSimulationMemberId(change.memberId, { allowSynthetic: true });
    const variantIds = normalizeSimulationVariantIds(change.variantIds, { required: true });
    if (memberId.error || variantIds.error) return { error: memberId.error || variantIds.error };
    normalized.memberId = memberId.value;
    normalized.variantIds = variantIds.value;
  } else if (change.type === "join") {
    const memberId = normalizeSimulationMemberId(change.memberId, { required: false, allowSynthetic: true });
    const ownedVariantIds = normalizeSimulationVariantIds(change.ownedVariantIds, { required: false });
    const username = normalizeSimulationText(change.username, "username");
    const displayName = normalizeSimulationText(change.displayName, "displayName");
    if (memberId.error || ownedVariantIds.error || username.error || displayName.error) {
      return { error: memberId.error || ownedVariantIds.error || username.error || displayName.error };
    }
    if (memberId.value !== null) normalized.memberId = memberId.value;
    if (username.value) normalized.username = username.value;
    if (displayName.value) normalized.displayName = displayName.value;
    normalized.ownedVariantIds = ownedVariantIds.value;
  } else if (change.type === "leave") {
    const memberId = normalizeSimulationMemberId(change.memberId, { allowSynthetic: true });
    if (memberId.error) return memberId;
    normalized.memberId = memberId.value;
  } else {
    const variantIds = normalizeSimulationVariantIds(change.variantIds, { required: true });
    if (variantIds.error) return variantIds;
    normalized.variantIds = variantIds.value;
  }

  return { value: normalized };
}

function normalizeSimulationChanges(changes) {
  if (!Array.isArray(changes)) return { error: "changes doit être un tableau" };
  if (changes.length > MAX_SQUAD_SIMULATION_CHANGES) {
    return { error: `Trop de changements (${MAX_SQUAD_SIMULATION_CHANGES} max)` };
  }
  const normalized = [];
  for (const change of changes) {
    const result = normalizeSimulationChange(change);
    if (result.error) return result;
    normalized.push(result.value);
  }
  return { value: normalized };
}

// ── Squad : secure code generation ──
function generateSquadCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  // Thirteen base32 characters give 65 bits of entropy while keeping the
  // `SPRITE-` prefix within the existing VARCHAR(20) database column.
  const bytes = crypto.randomBytes(13);
  for (let i = 0; i < 13; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return "SPRITE-" + code;
}

// ── Squad : lookup helper accepting numeric id or code ──
async function getSquadByIdOrCode(idOrCode) {
  const raw = String(idOrCode).trim();
  if (/^\d+$/.test(raw)) {
    return await pool.query("SELECT id, code, name, created_by, join_open FROM squads WHERE id = $1", [Number(raw)]);
  }
  return await pool.query("SELECT id, code, name, created_by, join_open FROM squads WHERE code = $1", [
    raw.toUpperCase()
  ]);
}

// Resolve the visibility of every member from the perspective of the current
// viewer.  Every squad matrix must go through this helper: membership alone
// never grants access to a private collection, and priority visibility is a
// separate permission from collection visibility.
async function getViewerSafeSquadMembers(memberRows, reqUser) {
  return Promise.all(
    memberRows.map(async (row) => {
      const userId = row.userId ?? row.user_id ?? row.id;
      const isSelf = String(userId) === String(reqUser);
      const visible = isSelf || (await canViewCollection(reqUser, userId));
      const prioritiesVisible =
        visible &&
        (isSelf ||
          (await canViewCollection(reqUser, userId, {
            visibilityKey: "priorities"
          })));
      return {
        ...row,
        userId,
        username: row.username || String(userId),
        visible,
        prioritiesVisible
      };
    })
  );
}

// Never mutate the global compare collection cache when redacting a field for
// one viewer.  `status: priority` remains collection data, matching the
// existing collection/compare privacy semantics; only the granular priority
// level is removed when the owner has hidden it.
function redactCollectionPriorities(collection) {
  return Object.fromEntries(
    Object.entries(collection).map(([variantId, entry]) => [variantId, { ...entry, priority: "none" }])
  );
}

async function loadViewerSafeCollection(member) {
  if (!member?.visible) return {};
  const collection = await compare.loadServerCompareCollection(member.userId);
  return member.prioritiesVisible ? collection : redactCollectionPriorities(collection);
}

// ── Squad : create ──

module.exports = {
  APP_URL,
  MAX_SQUAD_SIMULATION_CHANGES,
  MAX_SQUAD_SIMULATION_TEXT_LENGTH,
  MAX_SQUAD_SIMULATION_VARIANTS,
  MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH,
  MAX_USER_ID,
  QRCode,
  SQUAD_SIMULATION_TYPES,
  analytics,
  app,
  areFriends,
  canViewCollection,
  compare,
  computeCatalogueVersion,
  crypto,
  generateSquadCode,
  getCachedOrComputeSquadAnalysis,
  getRelationship,
  getRequestingUser,
  getSquadByIdOrCode,
  getViewerSafeSquadMembers,
  getVisibleSquadMemberIds,
  invalidateSquadAnalysisCache,
  isBlocked,
  isPlainObject,
  loadViewerSafeCollection,
  normalizeSimulationChange,
  normalizeSimulationChanges,
  normalizeSimulationMemberId,
  normalizeSimulationText,
  normalizeSimulationVariantIds,
  parsePositiveUserId,
  pool,
  redactCollectionPriorities,
  refreshSquadStats,
  requireNotSuspended,
  requireSquadMember,
  resolveAddressee,
  security,
  shareSquad,
  squadSimulationLimiter
};
