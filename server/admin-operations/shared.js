"use strict";

// Operational backoffice APIs. These routes are deliberately separate from
// product APIs: every request requires the terminal-admin cookie, all writes
// are auditable, and list endpoints return operational summaries instead of
// private collection notes, e-mails or bearer capabilities.

const crypto = require("crypto");
const { app } = require("../core");
const { pool } = require("../db");
const { requireAdminCapability, requireAdminStepUp } = require("../routes-admin");
const { adminActorFromReq, listActiveAdminSessions } = require("../admin-access");
const { describeAuthz, hasCapability } = require("../admin-authz");
const { isAdminMfaConfigured } = require("../admin-totp");
const { revokeUserSockets } = require("../ws");
const { invalidateSquadAnalysisCacheForUser } = require("../squad-analysis-cache");
const { enqueuePassportRecalc } = require("../passport-summary");
const { processDeliveryQueue } = require("../notification-delivery-queue");
const { syncCatalogueMetaAndFanout } = require("../passport-summary");
const { fanoutPublishedNews } = require("../news");
const { buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities } = require("../privacy-ops");
const { rateLimit } = require("../../security");
const { writeAdminAudit, withAdminAudit, AdminHttpError, notFound } = require("../admin-audit");

const adminMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyPrefix: "admin-mutation",
  message: "Trop d’actions administratives. Réessaie dans quelques minutes."
});

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_AUDIT_EXPORT_ROWS = 5000;
const REPORT_STATUSES = new Set(["open", "resolved", "dismissed"]);
const REPORT_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const APPEAL_STATUSES = new Set(["none", "received", "accepted", "rejected"]);
const NEWS_STATUSES = new Set(["draft", "published", "archived"]);
const DATA_STATUSES = new Set(["complete", "incomplete", "verified", "unknown"]);
const AVAILABILITY_STATUSES = new Set(["available", "upcoming", "ended", "not_observed", "unknown"]);
const CONFIDENCE_LEVELS = new Set(["confirmed", "high", "medium", "low", "unknown"]);
const EDITORIAL_STATUSES = new Set(["draft", "review", "published"]);

function numberId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function pagination(req) {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(Number(req.query.pageSize) || PAGE_SIZE)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function text(value, max = 500) {
  if (value == null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
}

function nullableDate(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function jsonValue(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function validUrl(value) {
  const raw = text(value, 2000);
  if (!raw) return null;
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch (_) {
    return null;
  }
}

function validAssetUrl(value) {
  const external = validUrl(value);
  if (external) return external;
  const raw = text(value, 2000);
  // Catalog assets may be shipped as a relative application path (for example
  // `Sprite/Water.png`). Keep the accepted alphabet deliberately narrow.
  return raw && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(raw) ? raw : null;
}

async function audit(action, targetType, targetId, { justification = null, details = {}, actor = "unknown", requireJustification = true } = {}) {
  // Prefer withAdminAudit() for DB mutations so write + audit commit together.
  // Side-effectful jobs (queue flush, passport enqueue) still call this after
  // the work; failures surface instead of being swallowed.
  await writeAdminAudit(pool, {
    actor,
    action,
    targetType,
    targetId,
    justification,
    details,
    requireJustification
  });
}

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error("[admin] operation failed:", error.message);
      if (res.headersSent) return;
      if (error instanceof AdminHttpError || (Number.isInteger(error.status) && error.status >= 400 && error.status < 600)) {
        return res.status(error.status).json({ error: error.message || "Requête invalide" });
      }
      res.status(500).json({ error: "Opération administrative indisponible" });
    }
  };
}

function paged(rows, count, { page, pageSize }) {
  return {
    items: rows,
    page,
    pageSize,
    total: Number(count) || 0,
    hasMore: page * pageSize < (Number(count) || 0)
  };
}

// Audit details can include operational metadata, but the journal must never
// turn into a secondary store for credentials, network identifiers or raw
// personal data. Keep the useful before/after snapshots and redact unsafe
// keys before a row leaves the API.
const AUDIT_PRIVATE_DETAIL_KEY = /(?:password|secret|token|email|\bip\b|user.?agent|mfa|totp|code)/i;
function safeAuditDetails(value, depth = 0) {
  if (depth > 4 || value == null) return value == null ? value : "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => safeAuditDetails(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [
      key,
      AUDIT_PRIVATE_DETAIL_KEY.test(key) ? "[redacted]" : safeAuditDetails(item, depth + 1)
    ]));
  }
  return typeof value === "string" ? value.slice(0, 1000) : value;
}

function auditRowForAdmin(row) {
  return { ...row, details: safeAuditDetails(jsonValue(row.details)) };
}

function auditFilters(query = {}) {
  const values = [];
  const clauses = [];
  const add = (sql, value) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
  const q = text(query.q, 120);
  const actor = text(query.actor, 80);
  const action = text(query.action, 100);
  const targetType = text(query.targetType, 60);
  const from = nullableDate(query.from);
  const rawTo = text(query.to, 40);
  let to = nullableDate(rawTo);
  // A date picker describes a complete local calendar day to the operator.
  // Make the end bound inclusive instead of silently omitting that day after
  // midnight.
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(rawTo || "")) {
    to = new Date(`${rawTo}T23:59:59.999Z`).toISOString();
  }
  if (from === undefined || to === undefined) return { error: "Date d’audit invalide" };
  if (q) {
    const pattern = `%${q}%`;
    values.push(pattern);
    const marker = `$${values.length}`;
    clauses.push(`(actor ILIKE ${marker} OR action ILIKE ${marker} OR target_type ILIKE ${marker} OR COALESCE(target_id, '') ILIKE ${marker} OR COALESCE(justification, '') ILIKE ${marker})`);
  }
  if (actor) add("actor ILIKE ?", `%${actor}%`);
  if (action) add("action = ?", action);
  if (targetType) add("target_type = ?", targetType);
  if (from) add("created_at >= ?::timestamptz", from);
  if (to) add("created_at <= ?::timestamptz", to);
  return { values, where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "" };
}

function csvCell(value) {
  const raw = String(value == null ? "" : value).replace(/\r?\n/g, " ");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}


module.exports = { crypto, app, pool, requireAdminCapability, requireAdminStepUp, adminActorFromReq, listActiveAdminSessions, describeAuthz, hasCapability, isAdminMfaConfigured, revokeUserSockets, invalidateSquadAnalysisCacheForUser, enqueuePassportRecalc, processDeliveryQueue, syncCatalogueMetaAndFanout, fanoutPublishedNews, buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities, rateLimit, writeAdminAudit, withAdminAudit, AdminHttpError, notFound, adminMutationLimiter, PAGE_SIZE, MAX_PAGE_SIZE, MAX_AUDIT_EXPORT_ROWS, REPORT_STATUSES, REPORT_PRIORITIES, APPEAL_STATUSES, NEWS_STATUSES, DATA_STATUSES, AVAILABILITY_STATUSES, CONFIDENCE_LEVELS, EDITORIAL_STATUSES, numberId, pagination, text, nullableDate, jsonValue, validUrl, validAssetUrl, audit, route, paged, safeAuditDetails, auditRowForAdmin, auditFilters, csvCell };
