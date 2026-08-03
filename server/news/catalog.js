"use strict";

const crypto = require("crypto");
const { pool } = require("../db");
const { buildDates, buildRecurrence } = require("../catalog");
const { invalidateSquadAnalysisCache } = require("../squad-analysis-cache");
const { classifyAvailabilityStatus } = require("../notification-gates");
const { emitVariantAvailableForSprite } = require("../notification-variant-available");
const { detectEventInfo } = require("./parsing");

async function extractAvailabilityFromNews(newsItems) {
  const spritesRes = await pool.query(
    "SELECT id, name, availability, dates, first_observed_at, officially_announced_at FROM sprites"
  );
  const sprites = spritesRes.rows;
  let updated = 0;
  const insertedPeriodIds = new Set();

  for (const item of newsItems) {
    const text = `${item.title || ""} ${item.description || ""}`;
    const normalizedText = text.toLowerCase();

    // Skip recurring weekly events (they don't change a sprite's base availability)
    const eventInfo = detectEventInfo(text);
    if (eventInfo && eventInfo.type === "weekly_event") continue;

    let status = null;
    if (
      /new sprites?|have arrived|now appearing|are appearing|sont apparus|sont arriv[eé]s|disponible maintenant|available now|hit the island|drop into|now in/i.test(
        normalizedText
      )
    ) {
      status = "available";
    } else if (
      /coming soon|bientôt disponible|announced|annonce officielle|kicks off|coming to the island/i.test(normalizedText)
    ) {
      status = "upcoming";
    } else if (
      /no longer|n'?est plus|removed|leaves the island|leaving the island|gone from|disappeared/i.test(normalizedText)
    ) {
      status = "not_observed";
    }
    if (!status) continue;

    const newsDate = item.date ? new Date(item.date).toISOString() : new Date().toISOString();
    const confidence =
      item.source && (item.source.includes("official") || item.source.includes("fortnite-api"))
        ? "official"
        : "observed";

    for (const sprite of sprites) {
      if (!sprite.name) continue;
      const spriteNameLower = sprite.name.toLowerCase();
      const shortName = spriteNameLower.replace(" sprite", "").trim();
      if (!normalizedText.includes(spriteNameLower) && !(shortName.length > 2 && normalizedText.includes(shortName)))
        continue;

      const current = sprite.availability || {};
      const previousStatus = classifyAvailabilityStatus(current.status);
      const newAvailability = {
        ...current,
        status,
        confidence
      };

      if (status === "available") {
        newAvailability.startDate = current.startDate || newsDate;
        newAvailability.endDate = null;
      } else if (status === "upcoming") {
        newAvailability.startDate = null;
        newAvailability.endDate = null;
      } else if (status === "not_observed") {
        // Keep existing start/end and only mark as no longer observed
        if (current.endDate) newAvailability.endDate = current.endDate;
      }

      const newDates = buildDates(sprite.dates, sprite.first_observed_at, newsDate, sprite.officially_announced_at);
      const registry = require("../catalog-registry");
      await registry.patchEntity(pool, {
        entityType: "sprite",
        entityId: sprite.id,
        patch: {
          availability: newAvailability,
          dates: newDates,
          last_verified_at: newsDate
        },
        source: registry.SOURCES.NEWS,
        actorLabel: item.source || "news",
        reason: "availability extracted from news"
      });

      const periodStart = status === "upcoming" ? null : newAvailability.startDate || newsDate;
      const eventKey = "";
      const periodId =
        "availability_" +
        crypto
          .createHash("md5")
          .update(`${sprite.id}|${periodStart || "unknown"}|${eventKey}`)
          .digest("hex")
          .slice(0, 16);
      if (!insertedPeriodIds.has(periodId)) {
        insertedPeriodIds.add(periodId);
        await pool.query(
          `INSERT INTO availability_periods (id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources)
           VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             end_date = COALESCE($4::timestamptz, availability_periods.end_date),
             status = COALESCE($5, availability_periods.status),
             confidence = COALESCE($7, availability_periods.confidence),
             data_status = COALESCE($8, availability_periods.data_status),
             sources = COALESCE($9, availability_periods.sources),
             updated_at = NOW()`,
          [
            periodId,
            sprite.id,
            periodStart,
            newAvailability.endDate,
            status,
            null,
            confidence,
            "complete",
            JSON.stringify([item.source])
          ]
        );
      }

      // Étape 28 — reliable catalogue update → available_now triggers notifications.
      if (status === "available") {
        await emitVariantAvailableForSprite(sprite.id, {
          previousStatus,
          newStatus: "available",
          confidence,
          availableFrom: newAvailability.startDate,
          availableUntil: newAvailability.endDate,
          availabilityPeriodId: periodId,
          spriteName: sprite.name
        }).catch((err) => console.error("[AVAILABILITY] variant_available emit failed", err.message));
      }

      // Keep in-memory status in sync so the same news item doesn't re-emit.
      sprite.availability = newAvailability;
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[AVAILABILITY] ${updated} sprite availability updates extracted from news`);
    invalidateSquadAnalysisCache();
  }
}

async function extractRecurrenceFromNews(newsItems) {
  const spritesRes = await pool.query(
    "SELECT id, name, recurrence, dates, first_observed_at, officially_announced_at FROM sprites"
  );
  const sprites = spritesRes.rows;
  let updated = 0;

  for (const item of newsItems) {
    const text = `${item.title || ""} ${item.description || ""}`;
    const normalizedText = text.toLowerCase();
    const newsDate = item.date ? new Date(item.date).toISOString() : new Date().toISOString();

    const officiallyConfirmed =
      /officially|epic games confirms|confirmed by epic|announced by epic|officiellement/i.test(normalizedText);
    let status = null;

    if (
      /confirmed recurring|confirmed to return|officially returning|will return|epic games confirms.*return/i.test(
        normalizedText
      )
    ) {
      status = "confirmed_recurring";
    } else if (
      /never returning|won'?t return|not returning|exclusive|limited time only|gone for good|last chance forever|n'?est plus disponible|n'?est plus de retour/i.test(
        normalizedText
      )
    ) {
      status = "not_confirmed";
    } else if (
      /returns|de retour|returning|back|back in|may return|could return|possible return|retour possible/i.test(
        normalizedText
      )
    ) {
      status = officiallyConfirmed ? "confirmed_recurring" : "possible_return";
    }

    if (!status) continue;

    const evidence = item.title || item.description || null;
    for (const sprite of sprites) {
      if (!sprite.name) continue;
      const spriteNameLower = sprite.name.toLowerCase();
      const shortName = spriteNameLower.replace(" sprite", "").trim();
      if (!normalizedText.includes(spriteNameLower) && !(shortName.length > 2 && normalizedText.includes(shortName)))
        continue;

      const current = buildRecurrence(sprite.recurrence);
      // Do not downgrade a confirmed recurrence to a possible one unless official
      if (current.status === "confirmed_recurring" && status !== "confirmed_recurring") continue;

      const newRecurrence = {
        status,
        officiallyConfirmed: status === "confirmed_recurring" || officiallyConfirmed,
        evidence
      };

      const newDates = buildDates(sprite.dates, sprite.first_observed_at, newsDate, sprite.officially_announced_at);
      const registry = require("../catalog-registry");
      await registry.patchEntity(pool, {
        entityType: "sprite",
        entityId: sprite.id,
        patch: {
          recurrence: newRecurrence,
          dates: newDates,
          last_verified_at: newsDate
        },
        source: registry.SOURCES.NEWS,
        actorLabel: item.source || "news",
        reason: "recurrence extracted from news"
      });
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[RECURRENCE] ${updated} sprite recurrence updates extracted from news`);
    invalidateSquadAnalysisCache();
  }
}

module.exports = { extractAvailabilityFromNews, extractRecurrenceFromNews };
