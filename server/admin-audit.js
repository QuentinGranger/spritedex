"use strict";

// Durable administrative audit trail. Mutation handlers must await this write
// inside the same transaction as the operational change whenever possible so a
// failed audit never leaves an unattributed successful write.

const { pool } = require("./db");

class AdminHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AdminHttpError";
    this.status = Number(status) || 500;
  }
}

function cleanText(value, max) {
  if (value == null) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
}

function cleanDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  return details;
}

function badRequest(message) {
  return new AdminHttpError(400, message);
}

function notFound(message) {
  return new AdminHttpError(404, message);
}

async function writeAdminAudit(db = pool, {
  actor = "unknown",
  action,
  targetType,
  targetId = null,
  justification = null,
  details = {},
  requireJustification = true
} = {}) {
  if (!action || !targetType) {
    throw new AdminHttpError(500, "Entrée d’audit administrative incomplète");
  }
  const cleanedJustification = cleanText(justification, 2000);
  if (requireJustification && !cleanedJustification) {
    throw badRequest("Une justification est requise");
  }
  await db.query(
    `INSERT INTO admin_audit_log (actor, action, target_type, target_id, justification, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      cleanText(actor, 80) || "unknown",
      String(action).slice(0, 100),
      String(targetType).slice(0, 60),
      targetId == null ? null : String(targetId).slice(0, 160),
      cleanedJustification,
      JSON.stringify(cleanDetails(details))
    ]
  );
}

async function withAdminAudit(work, auditFieldsOrFn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    const auditFields = typeof auditFieldsOrFn === "function"
      ? auditFieldsOrFn(result)
      : auditFieldsOrFn;
    await writeAdminAudit(client, auditFields);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // Keep the original failure; a rollback error must not mask it.
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  AdminHttpError,
  badRequest,
  notFound,
  writeAdminAudit,
  withAdminAudit
};
