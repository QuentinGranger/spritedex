"use strict";

const crypto = require("crypto");
const { normalizeAvailabilityStatus } = require("./normalizers");

async function upsertAvailabilityPeriod(client, spriteId, availability, eventId, sourceIds) {
  if (!availability || (!availability.startDate && !availability.endDate)) return;
  const startDate = availability.startDate || null;
  const endDate = availability.endDate || null;
  const eventKey = eventId || "";
  const periodId =
    "availability_" +
    crypto
      .createHash("md5")
      .update(`${spriteId}|${startDate || "unknown"}|${eventKey}`)
      .digest("hex")
      .slice(0, 16);
  const status = normalizeAvailabilityStatus(availability.status, startDate, endDate);

  await client.query(
    `INSERT INTO availability_periods (id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources)
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       sprite_id = $2,
       start_date = $3::timestamptz,
       end_date = COALESCE($4::timestamptz, availability_periods.end_date),
       status = COALESCE($5, availability_periods.status),
       event_id = $6,
       confidence = COALESCE($7, availability_periods.confidence),
       data_status = COALESCE($8, availability_periods.data_status),
       sources = COALESCE($9, availability_periods.sources)`,
    [
      periodId,
      spriteId,
      startDate,
      endDate,
      status,
      eventId || null,
      availability.confidence || "unknown",
      startDate ? "complete" : "incomplete",
      JSON.stringify(sourceIds || [])
    ]
  );
}

module.exports = { upsertAvailabilityPeriod };
