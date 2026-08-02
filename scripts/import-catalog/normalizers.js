"use strict";

const RARITY_COLORS = {
  common: "rgba(168, 168, 168, 0.42)",
  uncommon: "rgba(88, 179, 71, 0.42)",
  rare: "rgba(36, 167, 255, 0.42)",
  epic: "rgba(196, 67, 255, 0.42)",
  legendary: "rgba(255, 165, 0, 0.42)",
  mythic: "rgba(255, 215, 0, 0.42)",
};

function defaultColor(rarity) {
  return RARITY_COLORS[(rarity || "").toLowerCase()] || "rgba(128, 128, 128, 0.42)";
}

function titleCaseVariant(type) {
  if (!type) return "Base";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

const HONEST_AVAILABILITY_STATUSES = new Set(["available", "upcoming", "ended", "not_observed", "unknown"]);

function normalizeAvailabilityStatus(status, startDate, endDate) {
  const s = (status || "").toLowerCase();
  if (HONEST_AVAILABILITY_STATUSES.has(s)) return s;

  const now = new Date().toISOString();
  const start = startDate ? new Date(startDate).toISOString() : null;
  const end = endDate ? new Date(endDate).toISOString() : null;

  if (s === "available" || s === "active" || s === "live") {
    if (end && end < now) return "ended";
    return "available";
  }
  if (s === "unreleased" || s === "coming_soon" || s === "soon") {
    if (start && start > now) return "upcoming";
    return "unknown";
  }
  if (s === "unavailable" || s === "inactive" || s === "discontinued" || s === "expired" || s === "removed" || s === "over") {
    if (end && end < now) return "ended";
    return "not_observed";
  }
  if (s === "not_observed" || s === "missing" || s === "not_seen") return "not_observed";

  if (end && end < now) return "ended";
  if (start && start > now) return "upcoming";
  return "unknown";
}

function normalizeAvailability(availability) {
  const a = availability || {};
  return {
    ...a,
    status: normalizeAvailabilityStatus(a.status, a.startDate, a.endDate),
  };
}

const RECURRENCE_STATUSES = new Set(["confirmed_recurring", "possible_return", "not_confirmed", "unknown"]);

function normalizeRecurrenceStatus(status) {
  const s = (status || "").toLowerCase().replace(/\s+/g, "_");
  if (RECURRENCE_STATUSES.has(s)) return s;
  if (s.includes("recurring") || s.includes("confirmed_return") || s === "yes") return "confirmed_recurring";
  if (s.includes("possible") || s.includes("maybe") || s.includes("return")) return "possible_return";
  if (s.includes("never") || s.includes("not_confirmed") || s.includes("no_return") || s.includes("exclusive")) return "not_confirmed";
  return "unknown";
}

function buildRecurrence(recurrence) {
  if (recurrence && typeof recurrence === "object" && !Array.isArray(recurrence)) {
    const status = normalizeRecurrenceStatus(recurrence.status);
    return {
      status,
      officiallyConfirmed: recurrence.officiallyConfirmed ?? (status === "confirmed_recurring"),
      evidence: recurrence.evidence || null,
    };
  }
  const status = normalizeRecurrenceStatus(recurrence);
  return {
    status,
    officiallyConfirmed: status === "confirmed_recurring",
    evidence: null,
  };
}

function buildDates(dates, firstObservedAt, lastVerifiedAt, officiallyAnnouncedAt) {
  if (dates && typeof dates === "object" && !Array.isArray(dates)) {
    return {
      firstObservedAt: dates.firstObservedAt || firstObservedAt || null,
      officiallyAnnouncedAt: dates.officiallyAnnouncedAt || officiallyAnnouncedAt || null,
      lastVerifiedAt: dates.lastVerifiedAt || lastVerifiedAt || null,
    };
  }
  return {
    firstObservedAt: firstObservedAt || null,
    officiallyAnnouncedAt: officiallyAnnouncedAt || null,
    lastVerifiedAt: lastVerifiedAt || null,
  };
}

const VALID_DATA_STATUSES = new Set(["complete", "incomplete", "needs_review", "unverified", "disputed", "archived"]);

function normalizeDataStatus(status, missingFields = []) {
  let s = (status || "").toLowerCase();
  if (!VALID_DATA_STATUSES.has(s)) {
    if (s === "confirmed") s = "complete";
    else if (s === "observed") s = "unverified";
    else if (s === "legacy") s = "archived";
    else if (missingFields.length > 0) s = "incomplete";
    else s = "complete";
  }
  if (s === "complete" && missingFields.length > 0) s = "incomplete";
  return s;
}

function computeMissingFields(sprite) {
  const missing = [];
  const a = sprite.acquisition || {};
  const av = sprite.availability || {};
  const r = sprite.recurrence || {};
  const d = sprite.dates || {};

  if (!sprite.officialName) missing.push("officialName");
  if (!sprite.seasonId) missing.push("seasonId");
  if (!sprite.image) missing.push("image");
  if (a.type === "unknown") missing.push("acquisitionMethod.type");
  if (!a.description) missing.push("acquisitionMethod.description");
  if (av.status === "unknown") missing.push("availability.status");
  if (!av.startDate && av.status !== "unknown" && av.status !== "upcoming") missing.push("availability.startDate");
  if (av.status === "ended" && !av.endDate) missing.push("availability.endDate");
  if (r.status === "unknown") missing.push("recurrence.status");
  if (!d.firstObservedAt) missing.push("dates.firstObservedAt");
  if (!d.lastVerifiedAt) missing.push("dates.lastVerifiedAt");
  if (!d.officiallyAnnouncedAt) missing.push("dates.officiallyAnnouncedAt");
  if (!Array.isArray(sprite.sources) || sprite.sources.length === 0) missing.push("sources");
  if (!Array.isArray(sprite.availabilityPeriods) || sprite.availabilityPeriods.length === 0) missing.push("availabilityPeriods");

  return missing;
}

module.exports = {
  defaultColor, titleCaseVariant, normalizeAvailabilityStatus, normalizeAvailability,
  normalizeRecurrenceStatus, buildRecurrence, buildDates, normalizeDataStatus, computeMissingFields
};
