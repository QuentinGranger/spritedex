// ── Priority variant available (Étapes 28–33) ─────────────────────────────
// Emits and handles catalogue.variant_available → priority_variant_available.
// Only trusted confidence levels generate automatic alerts; recipients are
// users who marked the variant as status=`priority` and don't own it yet.

const { pool } = require("./db");
const catalog = require("./notification-catalog");
const notifPrefs = require("./notification-preferences");
const { emitDomainEvent, DOMAIN_EVENTS } = require("./event-bus");
const { claimDedupeKey } = require("./event-idempotency");
const {
  isTrustedAvailabilityConfidence,
  isVariantAvailableTransition,
  classifyAvailabilityStatus,
  buildPriorityVariantAvailableDedupeKey,
  evaluateVariantStillAvailable
} = require("./notification-gates");

const TYPE = catalog.NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE;
const CATEGORY = catalog.NOTIFICATION_CATEGORIES.ALERTS;

async function loadVariantContext(variantId) {
  const res = await pool.query(
    `SELECT v.id, v.name, v.variant_type, v.slug, v.sprite_id, v.availability AS variant_availability,
            s.name AS sprite_name, s.availability AS sprite_availability
     FROM sprite_variants v
     LEFT JOIN sprites s ON s.id = v.sprite_id
     WHERE v.id = $1`,
    [variantId]
  );
  return res.rows[0] || null;
}

async function loadAvailabilityPeriod(periodId) {
  if (!periodId) return null;
  const res = await pool.query(
    `SELECT id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources
     FROM availability_periods WHERE id = $1`,
    [periodId]
  );
  return res.rows[0] || null;
}

// Étape 31 — still available, dates valid, source not invalidated, user not owner.
async function verifyAvailabilityForRecipient(variantId, recipientId, ctx = {}) {
  const period = ctx.availabilityPeriodId ? await loadAvailabilityPeriod(ctx.availabilityPeriodId) : null;

  if (period) {
    if (String(period.data_status || "").toLowerCase() === "invalid") {
      return { ok: false, reason: "source_invalidated" };
    }
    const periodStatus = classifyAvailabilityStatus(period.status);
    if (periodStatus === "ended" || periodStatus === "not_observed" || periodStatus === "upcoming") {
      return { ok: false, reason: "period_not_available" };
    }
  }

  const variant = await loadVariantContext(variantId);
  if (!variant) return { ok: false, reason: "variant_missing" };

  const spriteAvail = variant.sprite_availability || {};
  const variantAvail = variant.variant_availability || {};
  const liveStatus = classifyAvailabilityStatus(
    variantAvail.status || spriteAvail.status || ctx.newStatus || ctx.status
  );
  const availableFrom =
    ctx.availableFrom || period?.start_date || variantAvail.startDate || spriteAvail.startDate || null;
  const availableUntil = ctx.availableUntil || period?.end_date || variantAvail.endDate || spriteAvail.endDate || null;

  const gate = evaluateVariantStillAvailable({
    status: liveStatus,
    availableFrom,
    availableUntil
  });
  if (!gate.ok) return gate;

  const owned = await pool.query(
    `SELECT 1 FROM sprite_entries
     WHERE user_id = $1 AND variant_id = $2 AND status = 'owned'
     LIMIT 1`,
    [recipientId, variantId]
  );
  if (owned.rows.length) return { ok: false, reason: "already_owned" };

  return {
    ok: true,
    variant,
    availableFrom,
    availableUntil,
    confidence: ctx.confidence || period?.confidence || spriteAvail.confidence || "unknown",
    eventId: ctx.eventId || period?.event_id || null,
    availabilityPeriodId: ctx.availabilityPeriodId || period?.id || null
  };
}

// Étape 30 — users who marked the variant as status=`priority` (v1: not mere missing).
async function findPriorityRecipients(variantId) {
  const res = await pool.query(
    `SELECT se.user_id
     FROM sprite_entries se
     JOIN users u ON u.id = se.user_id
     WHERE se.variant_id = $1
       AND se.status = 'priority'
       AND se.status <> 'owned'
       AND u.deleted_at IS NULL`,
    [variantId]
  );
  return res.rows.map((r) => r.user_id);
}

async function handleCatalogueVariantAvailable(event) {
  const ctx = event.context || {};
  const variantId = event.entityId || ctx.variantId;
  if (!variantId) return;

  const previousStatus = ctx.previousStatus;
  const newStatus = ctx.newStatus || "available_now";
  if (previousStatus != null && !isVariantAvailableTransition(previousStatus, newStatus)) {
    return;
  }

  const confidence = String(ctx.confidence || "unknown").toLowerCase();
  // Étape 29 — no automatic push alert from rumours / unverified sources.
  const trusted = isTrustedAvailabilityConfidence(confidence);
  if (!trusted) return;

  const availabilityPeriodId = ctx.availabilityPeriodId || ctx.periodId || null;
  if (!availabilityPeriodId) return; // need a period id for étape 33 dedupe

  const digest = require("./notification-digest");
  const recipients = await findPriorityRecipients(variantId);
  for (const recipientId of recipients) {
    const resolved = await notifPrefs.resolveChannelPreferences(pool, recipientId, TYPE, { category: CATEGORY });
    if (resolved.categoryEnabled === false || !notifPrefs.evaluateTypeActive(resolved)) continue;

    const check = await verifyAvailabilityForRecipient(variantId, recipientId, {
      ...ctx,
      availabilityPeriodId,
      confidence
    });
    if (!check.ok) continue;

    const dedupeKey = buildPriorityVariantAvailableDedupeKey(recipientId, variantId, availabilityPeriodId);
    if (!(await claimDedupeKey(pool, dedupeKey, TYPE, recipientId))) continue;

    const variant = check.variant;
    const variantType = (variant.variant_type || "").toLowerCase() || null;
    const spriteId = variant.sprite_id;
    const variantName = ctx.variantName || variant.name;
    const spriteName = ctx.spriteName || variant.sprite_name;

    // Étape 50 — default immediate; daily_digest defers to the next local digest.
    await digest.deliverOrEnqueue(pool, {
      recipientId,
      type: TYPE,
      frequency: resolved.frequency,
      createArgs: {
        recipientId,
        type: TYPE,
        entityType: "variant",
        entityId: variantId,
        context: {
          variantId: String(variantId),
          variantName,
          spriteName,
          spriteId,
          variantType,
          eventId: check.eventId,
          availableFrom: check.availableFrom,
          availableUntil: check.availableUntil,
          confidence: check.confidence,
          availabilityPeriodId: String(availabilityPeriodId),
          dedupeKey
        }
      }
    });
  }
}

/**
 * Étape 28 — call when catalogue availability for a sprite becomes available_now
 * from a non-available status, with a reliable confidence level.
 * Emits one catalogue.variant_available event per variant of the sprite.
 */
async function emitVariantAvailableForSprite(
  spriteId,
  {
    previousStatus,
    newStatus = "available",
    confidence,
    availableFrom = null,
    availableUntil = null,
    availabilityPeriodId,
    eventId = null,
    spriteName = null
  } = {}
) {
  if (!spriteId || !availabilityPeriodId) return 0;
  if (!isVariantAvailableTransition(previousStatus, newStatus)) return 0;
  if (!isTrustedAvailabilityConfidence(confidence)) return 0;

  const variants = await pool.query(`SELECT id, name, variant_type, slug FROM sprite_variants WHERE sprite_id = $1`, [
    spriteId
  ]);
  let emitted = 0;
  for (const v of variants.rows) {
    await emitDomainEvent(DOMAIN_EVENTS.CATALOGUE_VARIANT_AVAILABLE, {
      entityType: "sprite_variant",
      entityId: v.id,
      context: {
        previousStatus: classifyAvailabilityStatus(previousStatus),
        newStatus: "available_now",
        variantId: v.id,
        variantName: v.name,
        variantType: v.variant_type,
        spriteId,
        spriteName,
        availableFrom,
        availableUntil,
        confidence: String(confidence).toLowerCase(),
        availabilityPeriodId,
        eventId,
        sourceValidated: true
      }
    });
    emitted++;
  }
  return emitted;
}

module.exports = {
  handleCatalogueVariantAvailable,
  emitVariantAvailableForSprite,
  verifyAvailabilityForRecipient,
  findPriorityRecipients
};
