"use strict";

const { pool } = require("./db");

const DEFAULT_RETENTION_DAYS = 30;

function retentionDays(value = process.env.ACCOUNT_PURGE_RETENTION_DAYS) {
  const days = Number(value);
  return Number.isFinite(days) && days >= 0 ? Math.min(3650, Math.floor(days)) : DEFAULT_RETENTION_DAYS;
}

async function buildUserDataExport(userId, { allowDeleted = false } = {}) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error("Utilisateur invalide");
    error.status = 400;
    throw error;
  }

  const userResult = await pool.query(
    `SELECT id, username, email, avatar_url, privacy, created_at, last_active_at, deleted_at,
            email_verified, cgu_accepted, cgu_version, cgu_accepted_at,
            cookie_consent, age_confirmed, push_enabled, share_token,
            profile_visibility, collection_visibility, priority_visibility, notes_visibility,
            push_pref_new_sprites, push_pref_new_variants, push_pref_squad_activity,
            push_pref_session_summary, push_pref_goals, push_pref_sync,
            suspended_at, suspended_until, suspension_source, suspension_reason
     FROM users WHERE id = $1 ${allowDeleted ? "" : "AND deleted_at IS NULL"}`,
    [id]
  );
  if (!userResult.rows.length) {
    const error = new Error("Utilisateur introuvable");
    error.status = 404;
    throw error;
  }
  const user = userResult.rows[0];

  const [
    collectionResult,
    squadsResult,
    activityResult,
    historyResult,
    pushTokensResult,
    friendshipsResult,
    blocksResult,
    reportsFiled,
    reportsReceived,
    communityOptIn
  ] = await Promise.all([
    pool.query(
      "SELECT variant_id, sprite_id, status, note, priority, obtained_at, updated_at FROM sprite_entries WHERE user_id = $1",
      [id]
    ),
    pool.query(
      `SELECT s.id, s.code, s.name, s.join_open, s.visibility, s.created_at, sm.role, sm.status, sm.joined_at, sm.left_at
       FROM squads s
       JOIN squad_members sm ON sm.squad_id = s.id
       WHERE sm.user_id = $1
       ORDER BY sm.joined_at DESC`,
      [id]
    ),
    pool.query(
      `SELECT squad_id, sprite_id, type, action, created_at
       FROM squad_activity
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [id]
    ),
    pool.query(
      `SELECT sprite_id, old_status, new_status, created_at
       FROM collection_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [id]
    ),
    pool.query(
      `SELECT platform, is_active AS enabled, created_at, updated_at
       FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
      [id]
    ),
    pool.query(
      `SELECT id, status, created_at, responded_at,
              CASE WHEN requester_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction,
              CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS peer_id
       FROM friendships
       WHERE requester_id = $1 OR addressee_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [id]
    ),
    pool.query(
      `SELECT id, reason, created_at,
              CASE WHEN blocker_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction,
              CASE WHEN blocker_id = $1 THEN blocked_id ELSE blocker_id END AS peer_id
       FROM user_blocks
       WHERE blocker_id = $1 OR blocked_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [id]
    ),
    pool.query(
      `SELECT id, reported_id, reason, status, resolution, created_at, reviewed_at
       FROM user_reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [id]
    ),
    pool.query(
      `SELECT id, reporter_id, reason, status, resolution, created_at, reviewed_at
       FROM user_reports WHERE reported_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [id]
    ),
    require("./sprite-graph-governance")
      .getCommunityStatsOptIn(pool, id)
      .catch(() => null)
  ]);

  const collection = Object.create(null);
  for (const row of collectionResult.rows) {
    collection[row.variant_id] = {
      spriteId: row.sprite_id,
      status: row.status,
      note: row.note || "",
      priority: row.priority || "none",
      obtainedAt: row.obtained_at || null,
      updatedAt: row.updated_at
    };
  }

  return {
    exportedAt: new Date().toISOString(),
    exportSource: "admin",
    profile: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatar_url,
      privacy: user.privacy,
      profileVisibility: user.profile_visibility,
      collectionVisibility: user.collection_visibility,
      priorityVisibility: user.priority_visibility,
      notesVisibility: user.notes_visibility,
      createdAt: user.created_at,
      lastActiveAt: user.last_active_at,
      deletedAt: user.deleted_at,
      emailVerified: user.email_verified,
      suspendedAt: user.suspended_at,
      suspendedUntil: user.suspended_until,
      suspensionSource: user.suspension_source,
      suspensionReason: user.suspension_reason
    },
    settings: {
      privacy: user.privacy,
      pushEnabled: user.push_enabled,
      pushPreferences: {
        newSprites: user.push_pref_new_sprites,
        newVariants: user.push_pref_new_variants,
        squadActivity: user.push_pref_squad_activity,
        sessionSummary: user.push_pref_session_summary,
        goals: user.push_pref_goals,
        sync: user.push_pref_sync
      }
    },
    consent: {
      cguAccepted: user.cgu_accepted,
      cguVersion: user.cgu_version,
      cguAcceptedAt: user.cgu_accepted_at,
      ageConfirmed: user.age_confirmed,
      cookieConsent: user.cookie_consent,
      communityStatsOptIn: communityOptIn?.communityStatsOptIn ?? null
    },
    shareLinkActive: !!user.share_token,
    collection,
    squads: squadsResult.rows,
    squadActivity: activityResult.rows,
    collectionHistory: historyResult.rows,
    pushTokens: pushTokensResult.rows,
    friendships: friendshipsResult.rows,
    blocks: blocksResult.rows,
    reportsFiled: reportsFiled.rows,
    reportsReceived: reportsReceived.rows
  };
}

async function listDeletionQueue({ limit = 50, status = "all" } = {}) {
  const count = Math.max(1, Math.min(100, Number(limit) || 50));
  const days = retentionDays();
  const filter = ["ready", "pending"].includes(String(status)) ? String(status) : "all";
  const statusClause =
    filter === "ready"
      ? "AND deleted_at < NOW() - ($1::text || ' days')::interval"
      : filter === "pending"
        ? "AND deleted_at >= NOW() - ($1::text || ' days')::interval"
        : "";
  const [result, summary] = await Promise.all([
    pool.query(
      `SELECT u.id, u.username, u.email, u.created_at, u.last_active_at, u.deleted_at,
              (u.deleted_at < NOW() - ($1::text || ' days')::interval) AS ready_for_purge,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (u.deleted_at + ($1::text || ' days')::interval - NOW())) / 86400.0))::int AS days_until_purge,
              (SELECT COUNT(*)::int FROM sprite_entries se WHERE se.user_id = u.id) AS collection_entries,
              (SELECT COUNT(*)::int FROM squad_members sm WHERE sm.user_id = u.id AND sm.status = 'active') AS active_squads
       FROM users u
       WHERE u.deleted_at IS NOT NULL
         ${statusClause}
       ORDER BY CASE WHEN u.deleted_at < NOW() - ($1::text || ' days')::interval THEN 0 ELSE 1 END,
                u.deleted_at ASC
       LIMIT $2`,
      [String(days), count]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE deleted_at < NOW() - ($1::text || ' days')::interval)::int AS ready,
              COUNT(*) FILTER (WHERE deleted_at >= NOW() - ($1::text || ' days')::interval)::int AS pending
       FROM users
       WHERE deleted_at IS NOT NULL`,
      [String(days)]
    )
  ]);
  return {
    retentionDays: days,
    filter,
    summary: summary.rows[0] || { total: 0, ready: 0, pending: 0 },
    items: result.rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      deletedAt: row.deleted_at,
      readyForPurge: row.ready_for_purge === true,
      daysUntilPurge: row.ready_for_purge ? 0 : Number(row.days_until_purge) || 0,
      collectionEntries: Number(row.collection_entries) || 0,
      activeSquads: Number(row.active_squads) || 0
    }))
  };
}

async function restoreDeletedAccount(userId, { db = pool } = {}) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error("Utilisateur invalide");
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `UPDATE users
     SET deleted_at = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING id, username, email, created_at, last_active_at`,
    [id]
  );
  if (!result.rows.length) {
    const error = new Error("Compte introuvable ou non marqué pour suppression");
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function purgeDeletedAccounts({
  db = pool,
  olderThanDays = retentionDays(),
  userId = null,
  limit = 50,
  force = false
} = {}) {
  const days = force && userId ? 0 : retentionDays(olderThanDays);
  const max = Math.max(1, Math.min(100, Number(limit) || 50));
  const id = userId == null ? null : Number(userId);
  if (userId != null && (!Number.isSafeInteger(id) || id <= 0)) {
    const error = new Error("Utilisateur invalide");
    error.status = 400;
    throw error;
  }

  const result = id
    ? await db.query(
        `DELETE FROM users
       WHERE id = $1
         AND deleted_at IS NOT NULL
         AND deleted_at < NOW() - ($2::text || ' days')::interval
       RETURNING id, username, deleted_at`,
        [id, String(days)]
      )
    : await db.query(
        `DELETE FROM users
       WHERE id IN (
         SELECT id FROM users
         WHERE deleted_at IS NOT NULL
           AND deleted_at < NOW() - ($1::text || ' days')::interval
         ORDER BY deleted_at ASC
         LIMIT $2
       )
       RETURNING id, username, deleted_at`,
        [String(days), max]
      );

  if (result.rows.length > 0) {
    console.log(`[PURGE] ${result.rows.length} deleted account(s) permanently removed.`);
  }
  return {
    retentionDays: days,
    purged: result.rows.map((row) => ({
      id: row.id,
      username: row.username,
      deletedAt: row.deleted_at
    }))
  };
}

async function revokeActiveShareCapabilities({ db = pool } = {}) {
  const [passport, compare, invites] = await Promise.all([
    db.query(
      `UPDATE users
       SET share_token = NULL
       WHERE share_token IS NOT NULL AND deleted_at IS NULL
       RETURNING id`
    ),
    db.query(
      `UPDATE compare_share_tokens
       SET revoked_at = NOW()
       WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
       RETURNING id`
    ),
    db.query(
      `UPDATE friend_invite_links
       SET revoked_at = NOW()
       WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
       RETURNING id`
    )
  ]);
  return {
    passportLinks: passport.rowCount || 0,
    compareLinks: compare.rowCount || 0,
    friendInviteLinks: invites.rowCount || 0
  };
}

async function purgeUnverifiedPasswordAccounts({
  db = pool,
  olderThanDays = Number(process.env.UNVERIFIED_ACCOUNT_RETENTION_DAYS) || 7,
  limit = 100
} = {}) {
  const days = Number.isFinite(Number(olderThanDays))
    ? Math.max(1, Math.min(90, Math.floor(Number(olderThanDays))))
    : 7;
  const max = Math.max(1, Math.min(500, Number(limit) || 100));

  // Soft-delete frees the email for the legitimate owner while keeping an audit trail.
  const result = await db.query(
    `UPDATE users
     SET deleted_at = NOW()
     WHERE id IN (
       SELECT id FROM users
       WHERE deleted_at IS NULL
         AND email_verified = FALSE
         AND password_hash IS NOT NULL
         AND (oauth_provider IS NULL OR BTRIM(oauth_provider) = '')
         AND created_at < NOW() - ($1::text || ' days')::interval
       ORDER BY created_at ASC
       LIMIT $2
     )
     RETURNING id, username, email, created_at`,
    [String(days), max]
  );

  if (result.rows.length) {
    const ids = result.rows.map((row) => row.id);
    await db.query("DELETE FROM sessions WHERE user_id = ANY($1::int[])", [ids]);
    console.log(`[PURGE] ${result.rows.length} unverified password account(s) soft-deleted after ${days}d.`);
  }

  return {
    retentionDays: days,
    purged: result.rows.map((row) => ({
      id: row.id,
      username: row.username,
      createdAt: row.created_at
    }))
  };
}

module.exports = {
  retentionDays,
  buildUserDataExport,
  listDeletionQueue,
  purgeDeletedAccounts,
  purgeUnverifiedPasswordAccounts,
  restoreDeletedAccount,
  revokeActiveShareCapabilities
};
