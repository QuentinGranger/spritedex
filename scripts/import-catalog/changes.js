"use strict";

// Étape 19 — journalise un changement de champ dans catalog_change_history.
async function recordChange(
  client,
  { entityType = "sprite", entityId, field, previousValue, newValue, changedBy, changedAt, reason, sourceId }
) {
  await client.query(
    `INSERT INTO catalog_change_history
       (entity_type, entity_id, field, previous_value, new_value, changed_by, changed_at, reason, source_id)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)`,
    [
      entityType,
      entityId,
      field,
      JSON.stringify(previousValue ?? null),
      JSON.stringify(newValue ?? null),
      changedBy || null,
      changedAt || new Date().toISOString(),
      reason || null,
      sourceId || null
    ]
  );
}

// Compare une liste de champs {field, previousValue, newValue} pour une entité
// et journalise uniquement ceux qui ont réellement changé. Ne journalise rien
// si l'entité n'existait pas encore (création implicite) pour éviter le bruit.
async function diffAndRecord(client, { entityType, entityId, existed, fields, meta }) {
  if (!existed) return 0;
  let recorded = 0;
  for (const { field, previousValue, newValue } of fields) {
    const prev = previousValue ?? null;
    const next = newValue ?? null;
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    await recordChange(client, {
      entityType,
      entityId,
      field,
      previousValue: prev,
      newValue: next,
      changedBy: meta.changedBy,
      changedAt: meta.changedAt,
      reason: meta.reason,
      sourceId: meta.sourceId
    });
    recorded++;
  }
  return recorded;
}

module.exports = { recordChange, diffAndRecord };
