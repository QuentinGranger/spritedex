"use strict";

const { pool } = require("../db");
const { normalizeIntId } = require("./normalization");

/**
 * Étape 23–24 — coverage + complementarity impact of a new squad member.
 * Call after the member row is active. previousMemberIds = active members minus joiner.
 */
async function computeSquadJoinImpact(squadId, joinerUserId, {
  previousMemberIds = null,
  db = pool
} = {}) {
  const squad = normalizeIntId(squadId);
  const joiner = normalizeIntId(joinerUserId);
  if (!squad || !joiner) {
    return {
      memberCountAfterJoin: null,
      collectiveCompletionBefore: null,
      collectiveCompletionAfter: null,
      newVariantsAddedToSquad: 0,
      sharedVariantsAdded: 0
    };
  }

  let previous = Array.isArray(previousMemberIds)
    ? previousMemberIds.map(normalizeIntId).filter(Boolean).filter((id) => id !== joiner)
    : null;
  if (!previous) {
    const membersRes = await db.query(
      `SELECT user_id FROM squad_members
       WHERE squad_id = $1 AND status = 'active' AND user_id <> $2`,
      [squad, joiner]
    );
    previous = membersRes.rows.map((r) => Number(r.user_id));
  }

  const compare = require("../compare");
  const beforeSummary = await compare.getSquadCollectiveCompletionSummary(previous);
  const afterMemberIds = previous.concat([joiner]);
  const afterSummary = await compare.getSquadCollectiveCompletionSummary(afterMemberIds);

  const previousOwned = previous.length
    ? await db.query(
      `SELECT DISTINCT variant_id FROM sprite_entries
       WHERE user_id = ANY($1::int[]) AND status = 'owned'`,
      [previous]
    )
    : { rows: [] };
  const joinerOwned = await db.query(
    `SELECT DISTINCT variant_id FROM sprite_entries
     WHERE user_id = $1 AND status = 'owned'`,
    [joiner]
  );
  const previousSet = new Set(previousOwned.rows.map((r) => String(r.variant_id)));
  let newVariantsAddedToSquad = 0;
  let sharedVariantsAdded = 0;
  for (const row of joinerOwned.rows) {
    const vid = String(row.variant_id);
    if (previousSet.has(vid)) sharedVariantsAdded += 1;
    else newVariantsAddedToSquad += 1;
  }

  const memberCountRes = await db.query(
    `SELECT COUNT(*)::int AS n FROM squad_members
     WHERE squad_id = $1 AND status = 'active'`,
    [squad]
  );

  return {
    memberCountAfterJoin: memberCountRes.rows[0]?.n || afterMemberIds.length,
    collectiveCompletionBefore: beforeSummary.collectiveCompletionRate != null
      ? Number(beforeSummary.collectiveCompletionRate)
      : 0,
    collectiveCompletionAfter: afterSummary.collectiveCompletionRate != null
      ? Number(afterSummary.collectiveCompletionRate)
      : 0,
    newVariantsAddedToSquad,
    sharedVariantsAdded
  };
}

/**
 * Étape 23–24 — squad.joined context.
 */
function buildSquadJoinedContext({
  inviterId = null,
  memberRole = "member",
  memberCountAfterJoin = null,
  collectiveCompletionBefore = null,
  collectiveCompletionAfter = null,
  newVariantsAddedToSquad = 0,
  sharedVariantsAdded = 0,
  joinSource = null,
  squadName = null,
  squadCode = null,
  invitationId = null
} = {}) {
  const ctx = {
    inviterId: normalizeIntId(inviterId),
    memberRole: String(memberRole || "member").slice(0, 40),
    memberCountAfterJoin: Number.isFinite(Number(memberCountAfterJoin))
      ? Number(memberCountAfterJoin)
      : null,
    collectiveCompletionBefore: collectiveCompletionBefore != null
      ? Number(collectiveCompletionBefore)
      : null,
    collectiveCompletionAfter: collectiveCompletionAfter != null
      ? Number(collectiveCompletionAfter)
      : null,
    newVariantsAddedToSquad: Number(newVariantsAddedToSquad) || 0,
    sharedVariantsAdded: Number(sharedVariantsAdded) || 0
  };
  if (joinSource) ctx.joinSource = String(joinSource).slice(0, 80);
  if (squadName) ctx.squadName = String(squadName).slice(0, 120);
  if (squadCode) ctx.squadCode = String(squadCode).slice(0, 40);
  if (invitationId != null) ctx.invitationId = invitationId;
  return ctx;
}

module.exports = { computeSquadJoinImpact, buildSquadJoinedContext };
