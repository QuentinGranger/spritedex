"use strict";

const { pool } = require("../db");
const { GRAPH_EVENT_TYPES, FRIEND_INVITATION_METHOD_SET } = require("./constants");
const { normalizeIntId } = require("./normalization");

/**
 * Étape 20 — unordered social pair (Quentin×Lucy === Lucy×Quentin).
 */
function normalizeComparisonPair(userAId, userBId) {
  const a = normalizeIntId(userAId);
  const b = normalizeIntId(userBId);
  if (!a || !b || a === b) return null;
  const pairUserLowId = Math.min(a, b);
  const pairUserHighId = Math.max(a, b);
  return {
    pairUserLowId,
    pairUserHighId,
    pairKey: `comparison_pair:${pairUserLowId}:${pairUserHighId}`
  };
}

function normalizeInvitationMethod(value, { fallback = "username" } = {}) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (FRIEND_INVITATION_METHOD_SET.has(raw)) return raw;
  if (raw === "username_search" || raw === "search") return "username";
  if (raw === "link" || raw === "invite" || raw === "invite-link") return "invite_link";
  if (raw === "qr" || raw === "qrcode") return "qr_code";
  if (raw === "squad" || raw === "mutual_squad") return "squad_member";
  return FRIEND_INVITATION_METHOD_SET.has(fallback) ? fallback : "username";
}

/**
 * Étape 21 — friend_invitation.sent context.
 * Canonical envelope `source` stays web|ios|android|api|…;
 * social discovery path lives in context.invitationSource.
 */
function buildFriendInvitationSentContext({
  invitationMethod = "username",
  invitationSource = null,
  status = "pending"
} = {}) {
  const method = normalizeInvitationMethod(invitationMethod);
  const sourceHint = invitationSource
    || (method === "username" ? "username_search"
      : method === "invite_link" ? "invite_link"
        : method === "qr_code" ? "qr_code"
          : method === "squad_member" ? "squad_member"
            : method === "passport" ? "passport"
              : "username_search");
  return {
    invitationMethod: method,
    invitationSource: String(sourceHint).slice(0, 80),
    status: status || "pending"
  };
}

/**
 * Étape 22 — aggregate-only public metrics for friend invitations.
 * Does not return who invited whom, pending/declined rows, or social history.
 */
async function getFriendInvitationPublicMetrics(db = pool, { windowDays = null } = {}) {
  const params = [];
  let timeFilter = "";
  if (Number.isFinite(Number(windowDays)) && Number(windowDays) > 0) {
    params.push(Math.floor(Number(windowDays)));
    timeFilter = `AND occurred_at >= NOW() - ($1::int * INTERVAL '1 day')`;
  }

  const sent = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(context->>'invitationMethod', 'unknown') AS method
     FROM graph_events
     WHERE event_type = $1
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = graph_events.id
       )
       ${timeFilter}
     GROUP BY 2`,
    [GRAPH_EVENT_TYPES.FRIEND_INVITATION_SENT, ...params]
  );

  const invitationsByMethod = {};
  let totalInvitationsSent = 0;
  for (const row of sent.rows) {
    const n = row.total || 0;
    invitationsByMethod[row.method || "unknown"] = n;
    totalInvitationsSent += n;
  }

  // Acceptance rate from friendships that originated as graph-tracked invites.
  // Aggregate counts only — no requester/addressee identifiers.
  const acceptedParams = [GRAPH_EVENT_TYPES.FRIEND_INVITATION_SENT];
  let acceptedTime = "";
  if (params.length) {
    acceptedParams.push(params[0]);
    acceptedTime = `AND ge.occurred_at >= NOW() - ($2::int * INTERVAL '1 day')`;
  }
  const accepted = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM graph_events ge
     JOIN friendships f ON f.id = ge.friendship_id
     WHERE ge.event_type = $1
       AND f.status = 'accepted'
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = ge.id
       )
       ${acceptedTime}`,
    acceptedParams
  );
  const acceptedCount = accepted.rows[0]?.n || 0;
  const acceptanceRate = totalInvitationsSent > 0
    ? Math.round((acceptedCount / totalInvitationsSent) * 1000) / 1000
    : 0;

  return {
    totalInvitationsSent,
    invitationsByMethod,
    acceptedCount,
    acceptanceRate
  };
}

/** Étape 22 — individual invitation edges are never public. */
function isFriendInvitationPubliclyExposable() {
  return false;
}

module.exports = { normalizeComparisonPair, normalizeInvitationMethod, buildFriendInvitationSentContext, getFriendInvitationPublicMetrics, isFriendInvitationPubliclyExposable };
