"use strict";

const crypto = require("crypto");

const SPRITE_KEYWORDS = [
  "sprite", "sprites", "esprit", "esprits",
  "gummy", "gold", "galaxy", "holofoil", "rift",
  "legendary", "mythic", "légendaire", "mythique",
  "mastery monday", "catch up",
  "gold hours", "gummy hours", "galaxy hours",
  "collecte effrénée", "pouvoir d'esprit"
];

const EVENT_PATTERNS = [
  { regex: /mastery monday|lundi de la maîtrise/i, type: "weekly_event", name: "Mastery Monday" },
  { regex: /holofoil hours/i, type: "weekly_event", name: "Holofoil Hours" },
  { regex: /gold\s*(?:&\s*gummy|\s*hours|fish)|gummy\s*hours|mythic goldfish/i, type: "weekly_event", name: "Gold & Gummy Hours" },
  { regex: /galaxy hours/i, type: "weekly_event", name: "Galaxy Hours" },
  { regex: /catch up day|catch up/i, type: "catch_up_event", name: "Catch Up Day" },
  { regex: /gone wild/i, type: "seasonal_event", name: "Gone Wild" },
  { regex: /summer hits|summer adventure|fun in the sun/i, type: "seasonal_event", name: "Summer Event" },
];

function detectEventInfo(text) {
  const normalized = (text || "").toLowerCase();
  for (const pattern of EVENT_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return { type: pattern.type, name: pattern.name };
    }
  }
  const newSpriteMatch = text.match(/new sprites?[:—]\s*(.+)/i);
  if (newSpriteMatch) {
    return { type: "content_update", name: `New Sprites: ${newSpriteMatch[1].trim().slice(0, 60)}` };
  }
  return null;
}

function addHours(date, hours) {
  const d = new Date(date);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d.toISOString();
}

function addDays(date, days) {
  return addHours(date, days * 24);
}

const MONTH_NAMES = {
  en: "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec",
  fr: "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec"
};
const MONTHS_REGEX = new RegExp(`(${MONTH_NAMES.en}|${MONTH_NAMES.fr})`, "i");

function parseMonth(monthStr) {
  const m = String(monthStr).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  for (let i = 0; i < months.length; i++) {
    if (months[i].startsWith(m) || months[i].slice(0, 3) === m.slice(0, 3)) return i;
  }
  return -1;
}

function normalizeYearDate(day, month, year, now) {
  let y = year ? parseInt(year, 10) : now.getFullYear();
  const candidate = new Date(y, month, day);
  if (!year && candidate < now) {
    candidate.setFullYear(y + 1);
  }
  return candidate;
}

function parseAbsoluteDate(text, now) {
  const normalized = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // "July 23" or "23 July" or "Jul 23, 2025" or "23 juillet 2025"
  let m = normalized.match(/(\d{1,2})\s+([a-z]{3,9})\s*(?:,\s*(\d{4}))?/i);
  if (m) {
    const month = parseMonth(m[2]);
    if (month >= 0) return normalizeYearDate(parseInt(m[1], 10), month, m[3], now);
  }
  m = normalized.match(/([a-z]{3,9})\s+(\d{1,2})\s*(?:,\s*(\d{4}))?/i);
  if (m) {
    const month = parseMonth(m[1]);
    if (month >= 0) return normalizeYearDate(parseInt(m[2], 10), month, m[3], now);
  }

  // ISO / numeric: 2025-07-23, 23/07/2025, 23.07.2025, 07/23/2025 (if year at end)
  m = normalized.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  m = normalized.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));

  return null;
}

function parseRelativeDurationHours(text) {
  const normalized = (text || "").toLowerCase();

  const dayMatch = normalized.match(/(?:in|for|lasts?|during)\s+(\d+(?:\.\d+)?)\s*(?:j|jours?|d|days?|jour)/);
  if (dayMatch) return Math.round(parseFloat(dayMatch[1]) * 24);

  const hourMatch = normalized.match(/(?:in|for|lasts?|during)\s+(\d+(?:\.\d+)?)\s*(?:h|heures?|hours?|hr?)/);
  if (hourMatch) return Math.round(parseFloat(hourMatch[1]));

  const weekMatch = normalized.match(/(?:in|for|lasts?|during)\s+(\d+(?:\.\d+)?)\s*(?:semaines?|weeks?|sem\.?)/);
  if (weekMatch) return Math.round(parseFloat(weekMatch[1]) * 7 * 24);

  return null;
}

function parseEndDateFromText(text, start, now) {
  const normalized = (text || "").toLowerCase();

  // Relative duration near "lasts" / "for" / "during" / "in"
  const relHours = parseRelativeDurationHours(text);
  if (relHours !== null) return addHours(start, relHours);

  // Phrase "until ..." or "through ..."
  const untilRegex = /(?:until|through|till|jusqu'au|jusqu'à|jusque|se termine(?:\s+le)?|ends?(?:\s+on)?|fin(?:\s+le)?)\s*[:\-]?\s*(.+?)(?:\.|,|;|$|and\s|with\s)/i;
  const untilMatch = normalized.match(untilRegex);
  if (untilMatch) {
    const parsed = parseAbsoluteDate(untilMatch[1], now);
    if (parsed) {
      parsed.setHours(23, 59, 59, 999);
      return parsed.toISOString();
    }
  }

  // Any standalone date in the text as a last resort
  const dateMatch = normalized.match(/(?:\d{1,2}\s+[a-z]{3,9}|[a-z]{3,9}\s+\d{1,2}|\d{4}[-/](?:0?\d|1[0-2])[-/]\d{1,2})/i);
  if (dateMatch) {
    const parsed = parseAbsoluteDate(dateMatch[0], now);
    if (parsed && parsed > start) {
      parsed.setHours(23, 59, 59, 999);
      return parsed.toISOString();
    }
  }

  return null;
}

function estimateEventEndDate(eventInfo, startDate, text) {
  const start = startDate ? new Date(startDate) : new Date();
  const now = new Date();

  // First try to extract an explicit end date from the text
  const parsedEnd = parseEndDateFromText(text, start, now);
  if (parsedEnd) return parsedEnd;

  // Fallback by event type
  switch (eventInfo.type) {
    case "weekly_event":
      return addHours(start, 24);
    case "catch_up_event":
      return addHours(start, 24);
    case "seasonal_event":
      return addDays(start, 14);
    case "content_update":
      return addDays(start, 7);
    default:
      return null;
  }
}

function matchesSpriteKeywords(text) {
  const lower = text.toLowerCase();
  return SPRITE_KEYWORDS.some(kw => lower.includes(kw));
}

function newsHash(source, title, date) {
  return crypto.createHash("md5").update(`${source}|${title}|${date}`).digest("hex");
}

function safeIsoDate(value) {
  const fallback = new Date().toISOString();
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlText(value) {
  return decodeHtmlEntities(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function htmlAttribute(fragment, name) {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(fragment);
  if (quoted) return decodeHtmlEntities(quoted[2]).trim();
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(fragment);
  return bare ? decodeHtmlEntities(bare[1]).trim() : "";
}

function firstHtmlTagText(fragment, selector) {
  const match = new RegExp(`<${selector}\\b[^>]*>([\\s\\S]*?)<\\/${selector}>`, "i").exec(fragment);
  return match ? htmlText(match[1]) : "";
}

function resolveAbsoluteUrl(raw, base = "https://fortnite.gg") {
  const value = String(raw || "").trim();
  if (!value || value.startsWith("data:") || value.startsWith("javascript:")) return null;
  try {
    const parsed = new URL(value, base);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.href.slice(0, 2048);
  } catch {
    return null;
  }
}

/** Pick the largest candidate from a srcset / data-srcset attribute. */
function pickBestSrcsetUrl(srcset, base = "https://fortnite.gg") {
  const parts = String(srcset || "").split(",").map((part) => part.trim()).filter(Boolean);
  let bestUrl = null;
  let bestScore = -1;
  for (const part of parts) {
    const bits = part.split(/\s+/);
    const url = resolveAbsoluteUrl(bits[0], base);
    if (!url) continue;
    const descriptor = bits[1] || "";
    let score = 1;
    const width = /^(\d+)w$/i.exec(descriptor);
    const density = /^(\d+(?:\.\d+)?)x$/i.exec(descriptor);
    if (width) score = Number(width[1]);
    else if (density) score = Number(density[1]) * 1000;
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }
  return bestUrl;
}

function extractImageFromHtmlBlock(block, base = "https://fortnite.gg") {
  const source = String(block || "");
  const imgTags = source.match(/<img\b[^>]*>/gi) || [];
  const scored = [];
  for (const tag of imgTags) {
    const attrs = tag.slice(4, -1);
    const srcsetBest = pickBestSrcsetUrl(
      htmlAttribute(attrs, "srcset") || htmlAttribute(attrs, "data-srcset"),
      base
    );
    const candidates = [
      { url: srcsetBest, score: 3000 },
      { url: resolveAbsoluteUrl(htmlAttribute(attrs, "data-src"), base), score: 2000 },
      { url: resolveAbsoluteUrl(htmlAttribute(attrs, "data-lazy-src"), base), score: 1900 },
      { url: resolveAbsoluteUrl(htmlAttribute(attrs, "data-original"), base), score: 1800 },
      { url: resolveAbsoluteUrl(htmlAttribute(attrs, "data-url"), base), score: 1700 },
      { url: resolveAbsoluteUrl(htmlAttribute(attrs, "src"), base), score: 1000 }
    ];
    for (const candidate of candidates) {
      const url = candidate.url;
      if (!url) continue;
      if (/sprite|1x1|pixel|blank|placeholder|data:image\/gif/i.test(url)) continue;
      scored.push({ url, score: candidate.score + Math.min(url.length, 200) });
    }
  }
  if (scored.length) {
    scored.sort((a, b) => b.score - a.score);
    return scored[0].url;
  }
  const bg = /background-image\s*:\s*url\(\s*['"]?([^)'"]+)['"]?\s*\)/i.exec(source);
  if (bg) return resolveAbsoluteUrl(bg[1], base);
  return null;
}

// Render-free fallback for platforms such as Render where puppeteer-core does
// not ship a Chromium binary. It intentionally extracts only plain text and
// never evaluates third-party scripts.
function parseFortniteGGNewsHtml(html) {
  const source = String(html || "");
  const blocks = source.match(/<article\b[^>]*>[\s\S]*?<\/article>/gi)
    || source.match(/<(?:li|div)\b[^>]*class=["'][^"']*(?:news|article)[^"']*["'][^>]*>[\s\S]*?<\/(?:li|div)>/gi)
    || [];
  const seen = new Set();
  const entries = [];
  for (const block of blocks.slice(0, 80)) {
    const title = firstHtmlTagText(block, "h2") || firstHtmlTagText(block, "h3") || "";
    if (!title || title.length > 300) continue;
    const key = title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const description = firstHtmlTagText(block, "p").slice(0, 500);
    const timeMatch = /<time\b([^>]*)>([\s\S]*?)<\/time>/i.exec(block);
    const date = timeMatch ? (htmlAttribute(timeMatch[1], "datetime") || htmlText(timeMatch[2])) : "";
    const image = extractImageFromHtmlBlock(block, "https://fortnite.gg");
    entries.push({ title, desc: description, date, img: image || null });
  }
  return entries;
}

module.exports = { EVENT_PATTERNS, SPRITE_KEYWORDS, detectEventInfo, estimateEventEndDate, matchesSpriteKeywords, newsHash, safeIsoDate, parseFortniteGGNewsHtml };
