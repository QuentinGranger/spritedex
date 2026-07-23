// news.js — extracted from server.js

const pushService = require("../push-service");
const { buildDates, buildRecurrence, ensureSource } = require("./catalog");
const { app } = require("./core");
const { pool } = require("./db");
const { broadcastNewsUpdate } = require("./ws");
const crypto = require("crypto");
const puppeteer = require("puppeteer-core");
const { invalidateSquadAnalysisCache } = require("./squad-analysis-cache");

// ── News : sprite update system ──
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

async function fetchFortniteAPINews() {
  const results = [];
  try {
    const res = await fetch("https://fortnite-api.com/v2/news/br?language=fr");
    if (!res.ok) return results;
    const json = await res.json();
    const motds = json.data?.motds || [];
    for (const item of motds) {
      const text = `${item.title || ""} ${item.body || ""}`;
      if (matchesSpriteKeywords(text)) {
        results.push({
          source: "fortnite-api",
          title: item.title || "News Fortnite",
          description: item.body || "",
          image: item.image || null,
          date: new Date().toISOString(),
          link: "https://fortnite.com/news?lang=fr",
          hash: newsHash("fortnite-api", item.title || "", item.id || "")
        });
      }
    }
  } catch (err) {
    console.error("Fortnite-API news fetch failed:", err.message);
  }
  return results;
}

async function fetchFortniteAPINewsEN() {
  const results = [];
  try {
    const res = await fetch("https://fortnite-api.com/v2/news/br?language=en");
    if (!res.ok) return results;
    const json = await res.json();
    const motds = json.data?.motds || [];
    for (const item of motds) {
      const text = `${item.title || ""} ${item.body || ""}`;
      if (matchesSpriteKeywords(text)) {
        results.push({
          source: "fortnite-api-en",
          title: item.title || "Fortnite News",
          description: item.body || "",
          image: item.image || null,
          date: new Date().toISOString(),
          link: "https://fortnite.com/news?lang=en",
          hash: newsHash("fortnite-api-en", item.title || "", item.id || "")
        });
      }
    }
  } catch (err) {
    console.error("Fortnite-API EN news fetch failed:", err.message);
  }
  return results;
}

async function fetchFortniteGGNews() {
  const results = [];
  let browser = null;
  try {
    const executablePath = process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    browser = await puppeteer.launch({
      executablePath,
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");
    await page.goto("https://fortnite.gg/news", { waitUntil: "networkidle2", timeout: 30000 });

    const items = await page.evaluate(() => {
      const entries = [];
      const articles = document.querySelectorAll("article, .news-item, [class*='news']");
      if (articles.length > 0) {
        articles.forEach(el => {
          const title = (el.querySelector("h2, h3, .title, [class*='title']") || {}).textContent || "";
          const desc = (el.querySelector("p, .desc, .description, [class*='desc']") || {}).textContent || "";
          const date = (el.querySelector("time, .date, [class*='date']") || {}).textContent || "";
          const img = (el.querySelector("img") || {}).src || null;
          if (title.trim()) entries.push({ title: title.trim(), desc: desc.trim(), date: date.trim(), img });
        });
      }
      if (entries.length === 0) {
        const body = document.body.innerText;
        const lines = body.split("\n").map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          if (/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(lines[i])) {
            const title = lines[i + 1] || "";
            const desc = lines[i + 2] || "";
            if (title.trim()) entries.push({ title: title.trim(), desc: desc.trim(), date: lines[i], img: null });
          }
        }
      }
      return entries;
    });

    for (const item of items) {
      const text = `${item.title} ${item.desc}`;
      if (matchesSpriteKeywords(text)) {
        const dateStr = safeIsoDate(item.date);
        results.push({
          source: "fortnite.gg",
          title: item.title,
          description: item.desc.slice(0, 300),
          image: item.img,
          date: dateStr,
          link: "https://fortnite.gg/news",
          hash: newsHash("fortnite.gg", item.title, item.date || "")
        });
      }
    }
    console.log(`Fortnite.gg scraped: ${items.length} items, ${results.length} matched`);
  } catch (err) {
    console.error(`[NEWS][fortnite.gg] Scrape failed at ${new Date().toISOString()}:`, err.name, err.message);
  } finally {
    if (browser) await browser.close();
  }
  return results;
}

async function fetchFortniteSTWNews() {
  const results = [];
  try {
    const res = await fetch("https://fortnite-api.com/v2/news/stw?language=fr");
    if (!res.ok) return results;
    const json = await res.json();
    const motds = json.data?.messages || [];
    for (const item of motds) {
      const text = `${item.title || ""} ${item.body || ""}`;
      if (matchesSpriteKeywords(text)) {
        results.push({
          source: "fortnite-stw",
          title: item.title || "News STW",
          description: item.body || "",
          image: item.image || null,
          date: new Date().toISOString(),
          link: null,
          hash: newsHash("fortnite-stw", item.title || "", item.title || "")
        });
      }
    }
  } catch (err) {
    console.error("Fortnite STW news fetch failed:", err.message);
  }
  return results;
}

async function extractEventsFromNews(newsItems) {
  const spritesRes = await pool.query("SELECT id, name FROM sprites");
  const sprites = spritesRes.rows;
  const seasonRes = await pool.query("SELECT id FROM seasons ORDER BY start_date DESC NULLS LAST LIMIT 1");
  const fallbackSeasonId = seasonRes.rows[0]?.id || null;

  const insertedEventIds = new Set();
  for (const item of newsItems) {
    const text = `${item.title || ""} ${item.description || ""}`;
    const eventInfo = detectEventInfo(text);
    if (!eventInfo) continue;

    const eventId = "event_" + crypto.createHash("md5").update(`${eventInfo.name}|${item.date || ""}|${item.source}`).digest("hex").slice(0, 16);
    if (insertedEventIds.has(eventId)) continue;
    insertedEventIds.add(eventId);

    const startDate = item.date || new Date().toISOString();
    const endDate = estimateEventEndDate(eventInfo, startDate, text);

    try {
      await pool.query(
        `INSERT INTO events (id, name, type, season_id, start_date, end_date, data_status, sources)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, type = $3, season_id = $4, start_date = COALESCE($5::timestamptz, events.start_date), end_date = COALESCE($6, events.end_date), data_status = $7, sources = $8`,
        [
          eventId,
          eventInfo.name,
          eventInfo.type,
          fallbackSeasonId,
          startDate,
          endDate,
          "observed",
          JSON.stringify([item.source]),
        ]
      );
    } catch (err) {
      console.error("[EVENTS] failed to insert event", eventId, err.message);
      continue;
    }

    // Link explicitly mentioned sprites to this event (only if they have no event yet)
    if (["content_update", "catch_up_event", "seasonal_event"].includes(eventInfo.type)) {
      const normalizedText = text.toLowerCase();
      for (const sprite of sprites) {
        if (!sprite.name) continue;
        const spriteNameLower = sprite.name.toLowerCase();
        const shortName = spriteNameLower.replace(" sprite", "").trim();
        if (normalizedText.includes(spriteNameLower) || (shortName.length > 2 && normalizedText.includes(shortName))) {
          await pool.query(
            `UPDATE sprites SET event_id = $1 WHERE id = $2 AND event_id IS NULL`,
            [eventId, sprite.id]
          ).catch(() => {});
        }
      }
    }
  }

  if (insertedEventIds.size > 0) {
    console.log(`[EVENTS] ${insertedEventIds.size} events extracted from news`);
    invalidateSquadAnalysisCache();
  }
  return { count: insertedEventIds.size, eventIds: Array.from(insertedEventIds) };
}

async function extractAvailabilityFromNews(newsItems) {
  const spritesRes = await pool.query("SELECT id, name, availability, dates, first_observed_at, officially_announced_at FROM sprites");
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
    if (/new sprites?|have arrived|now appearing|are appearing|sont apparus|sont arriv[eé]s|disponible maintenant|available now|hit the island|drop into|now in/i.test(normalizedText)) {
      status = "available";
    } else if (/coming soon|bientôt disponible|announced|annonce officielle|kicks off|coming to the island/i.test(normalizedText)) {
      status = "upcoming";
    } else if (/no longer|n'?est plus|removed|leaves the island|leaving the island|gone from|disappeared/i.test(normalizedText)) {
      status = "not_observed";
    }
    if (!status) continue;

    const newsDate = item.date ? new Date(item.date).toISOString() : new Date().toISOString();
    const confidence = (item.source && (item.source.includes("official") || item.source.includes("fortnite-api"))) ? "official" : "observed";

    for (const sprite of sprites) {
      if (!sprite.name) continue;
      const spriteNameLower = sprite.name.toLowerCase();
      const shortName = spriteNameLower.replace(" sprite", "").trim();
      if (!normalizedText.includes(spriteNameLower) && !(shortName.length > 2 && normalizedText.includes(shortName))) continue;

      const current = sprite.availability || {};
      const newAvailability = {
        ...current,
        status,
        confidence,
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
      await pool.query(
        `UPDATE sprites SET availability = $1, dates = $2, last_verified_at = $3 WHERE id = $4`,
        [JSON.stringify(newAvailability), JSON.stringify(newDates), newsDate, sprite.id]
      );

      const periodStart = status === "upcoming" ? null : (newAvailability.startDate || newsDate);
      const eventKey = "";
      const periodId = "availability_" + crypto.createHash("md5").update(`${sprite.id}|${periodStart || "unknown"}|${eventKey}`).digest("hex").slice(0, 16);
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
             sources = COALESCE($9, availability_periods.sources)`,
          [periodId, sprite.id, periodStart, newAvailability.endDate, status, null, confidence, "complete", JSON.stringify([item.source])]
        );
      }
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[AVAILABILITY] ${updated} sprite availability updates extracted from news`);
    invalidateSquadAnalysisCache();
  }
}

async function extractRecurrenceFromNews(newsItems) {
  const spritesRes = await pool.query("SELECT id, name, recurrence, dates, first_observed_at, officially_announced_at FROM sprites");
  const sprites = spritesRes.rows;
  let updated = 0;

  for (const item of newsItems) {
    const text = `${item.title || ""} ${item.description || ""}`;
    const normalizedText = text.toLowerCase();
    const newsDate = item.date ? new Date(item.date).toISOString() : new Date().toISOString();

    const officiallyConfirmed = /officially|epic games confirms|confirmed by epic|announced by epic|officiellement/i.test(normalizedText);
    let status = null;

    if (/confirmed recurring|confirmed to return|officially returning|will return|epic games confirms.*return/i.test(normalizedText)) {
      status = "confirmed_recurring";
    } else if (/never returning|won'?t return|not returning|exclusive|limited time only|gone for good|last chance forever|n'?est plus disponible|n'?est plus de retour/i.test(normalizedText)) {
      status = "not_confirmed";
    } else if (/returns|de retour|returning|back|back in|may return|could return|possible return|retour possible/i.test(normalizedText)) {
      status = officiallyConfirmed ? "confirmed_recurring" : "possible_return";
    }

    if (!status) continue;

    const evidence = item.title || item.description || null;
    for (const sprite of sprites) {
      if (!sprite.name) continue;
      const spriteNameLower = sprite.name.toLowerCase();
      const shortName = spriteNameLower.replace(" sprite", "").trim();
      if (!normalizedText.includes(spriteNameLower) && !(shortName.length > 2 && normalizedText.includes(shortName))) continue;

      const current = buildRecurrence(sprite.recurrence);
      // Do not downgrade a confirmed recurrence to a possible one unless official
      if (current.status === "confirmed_recurring" && status !== "confirmed_recurring") continue;

      const newRecurrence = {
        status,
        officiallyConfirmed: status === "confirmed_recurring" || officiallyConfirmed,
        evidence,
      };

      const newDates = buildDates(sprite.dates, sprite.first_observed_at, newsDate, sprite.officially_announced_at);
      await pool.query(
        `UPDATE sprites SET recurrence = $1, dates = $2, last_verified_at = $3 WHERE id = $4`,
        [JSON.stringify(newRecurrence), JSON.stringify(newDates), newsDate, sprite.id]
      );
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[RECURRENCE] ${updated} sprite recurrence updates extracted from news`);
    invalidateSquadAnalysisCache();
  }
}

async function refreshNews() {
  const [frNews, enNews, stwNews, ggNews] = await Promise.all([
    fetchFortniteAPINews(),
    fetchFortniteAPINewsEN(),
    fetchFortniteSTWNews(),
    fetchFortniteGGNews()
  ]);
  const all = [...frNews, ...enNews, ...stwNews, ...ggNews];
  const insertedItems = [];
  for (const item of all) {
    try {
      const result = await pool.query(
        `INSERT INTO sprite_news (hash, source, title, description, image, link, news_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (hash) DO NOTHING
         RETURNING id, title`,
        [item.hash, item.source, item.title, item.description.slice(0, 500), item.image, item.link, item.date]
      );
      if (result.rows.length > 0) {
        insertedItems.push(item);
      }
    } catch (err) {
      // duplicate or error, skip
    }
  }
  if (insertedItems.length > 0) {
    console.log(`News: ${insertedItems.length} new items inserted`);
    notifyNewsSubscribers(insertedItems);
  }

  // Extract events, availability and recurrence from scraped news (existing + newly inserted)
  const existingNews = await pool.query(
    "SELECT source, title, description, image, link, news_date AS date FROM sprite_news ORDER BY news_date DESC LIMIT 500"
  );
  for (const item of existingNews.rows) {
    await ensureSource(item.source, {
      title: item.title,
      url: item.link,
      publishedAt: item.date,
    });
  }
  const eventExtraction = await extractEventsFromNews(existingNews.rows);
  await extractAvailabilityFromNews(existingNews.rows);
  await extractRecurrenceFromNews(existingNews.rows);

  broadcastNewsUpdate({
    newItems: insertedItems.map(i => ({ source: i.source, title: i.title, link: i.link, image: i.image, date: i.date })).slice(0, 5),
    newCount: insertedItems.length,
    extractedEvents: eventExtraction.eventIds.slice(0, 5),
    extractedEventCount: eventExtraction.count,
    timestamp: new Date().toISOString()
  });
}

async function notifyNewsSubscribers(items) {
  if (!items.length) return;
  const title = items.length === 1
    ? "Nouvelle actu SPRITNEX"
    : `${items.length} nouvelles actus`;
  const body = items.length === 1
    ? items[0].title || "Un article vient d'être ajouté"
    : items[0].title || `${items.length} articles sur les sprites`;
  try {
    const results = await pushService.notifyNewsSubscribers(pool, {
      title,
      body,
      icon: items[0].image || "/icons/icon-192x192.png",
      url: items[0].link || "/"
    });
    const ok = results.filter(r => r.ok).length;
    console.log(`[PUSH] News notification sent to ${ok}/${results.length} devices`);
  } catch (err) {
    console.error("[PUSH] Failed to send news notification:", err);
  }
}

let newsInterval = null;
async function startNewsCron() {
  await pool.query(`UPDATE sprite_news SET link = 'https://fortnite.com/news?lang=fr' WHERE (link IS NULL OR link = 'https://www.fortnite.com/news') AND source LIKE 'fortnite-api%'`).catch(() => {});
  await pool.query(`UPDATE sprite_news SET link = 'https://fortnite.gg/news' WHERE link IS NULL AND source = 'fortnite.gg'`).catch(() => {});
  refreshNews().catch(err => console.error("[NEWS] initial refresh failed:", err.message));
  newsInterval = setInterval(() => refreshNews().catch(err => console.error("[NEWS] cron refresh failed:", err.message)), 30 * 60 * 1000);
}

// ── News : API endpoint ──
app.get("/api/news", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const result = await pool.query(
      `SELECT id, source, title, description, image, link, news_date, created_at
       FROM sprite_news
       ORDER BY news_date DESC, created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await pool.query(`SELECT COUNT(*) FROM sprite_news`);
    const total = parseInt(countResult.rows[0].count);
    res.json({ news: result.rows, total, hasMore: offset + result.rows.length < total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = { EVENT_PATTERNS, SPRITE_KEYWORDS, detectEventInfo, extractAvailabilityFromNews, extractEventsFromNews, extractRecurrenceFromNews, fetchFortniteAPINews, fetchFortniteAPINewsEN, fetchFortniteGGNews, fetchFortniteSTWNews, matchesSpriteKeywords, newsHash, newsInterval, notifyNewsSubscribers, refreshNews, startNewsCron };
