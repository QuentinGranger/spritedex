"use strict";

const fs = require("fs");
const puppeteer = require("puppeteer-core");
const { matchesSpriteKeywords, newsHash, safeIsoDate, parseFortniteGGNewsHtml } = require("./parsing");

async function fetchFortniteGGNewsViaHtml() {
  const response = await fetch("https://fortnite.gg/news", {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; sprite-index-news/1.0; +https://sprite-index.app)",
      accept: "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (html.length > 3_000_000) throw new Error("HTML trop volumineux");
  return parseFortniteGGNewsHtml(html);
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
          // tileImage is the compact card art used in the in-game news rail.
          image: item.tileImage || item.image || null,
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
          image: item.tileImage || item.image || null,
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
    // Most deployments do not contain a browser binary. Prefer the safe HTML
    // fetch, then use puppeteer only when the operator explicitly provides a
    // verified executable (local development / a Chromium-enabled worker).
    let directItems = [];
    try {
      directItems = await fetchFortniteGGNewsViaHtml();
    } catch (error) {
      console.warn(`[NEWS][fortnite.gg] Fallback HTML indisponible : ${error.message}`);
    }
    for (const item of directItems) {
      const text = `${item.title} ${item.desc}`;
      if (!matchesSpriteKeywords(text)) continue;
      results.push({
        source: "fortnite.gg",
        title: item.title,
        description: item.desc.slice(0, 300),
        image: item.img,
        date: safeIsoDate(item.date),
        link: "https://fortnite.gg/news",
        hash: newsHash("fortnite.gg", item.title, item.date || "")
      });
    }
    if (results.length) {
      console.log(`Fortnite.gg fetched: ${directItems.length} items, ${results.length} matched`);
      return results;
    }

    const executablePath = String(process.env.CHROME_PATH || "").trim();
    if (!executablePath || !fs.existsSync(executablePath)) {
      console.warn("[NEWS][fortnite.gg] Aucun Chromium configuré ; fallback HTML sans résultat.");
      return results;
    }
    browser = await puppeteer.launch({
      executablePath,
      headless: "new",
      // This browser renders content from a third-party site. Never disable
      // Chromium's OS sandbox here: a renderer exploit in a compromised news
      // page must not gain the privileges of the application server. Some
      // minimal containers cannot run Chromium with its sandbox enabled; in
      // that case this non-essential scrape simply fails and the fixed API
      // sources continue to supply news.
      args: ["--disable-dev-shm-usage"]
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );
    await page.goto("https://fortnite.gg/news", { waitUntil: "networkidle2", timeout: 30000 });

    const items = await page.evaluate(() => {
      const doc = globalThis.document;
      const pickImg = (el) => {
        const img = el.querySelector("img");
        if (!img) {
          const styled = el.querySelector("[style*='background-image']");
          const bg = styled && /url\(\s*['"]?([^)'"]+)['"]?\s*\)/i.exec(styled.getAttribute("style") || "");
          return bg ? bg[1] : null;
        }
        return (
          img.currentSrc ||
          img.src ||
          img.getAttribute("data-src") ||
          img.getAttribute("data-lazy-src") ||
          img.getAttribute("data-original") ||
          null
        );
      };
      const entries = [];
      const articles = doc.querySelectorAll("article, .news-item, [class*='news']");
      if (articles.length > 0) {
        articles.forEach((el) => {
          const title = (el.querySelector("h2, h3, .title, [class*='title']") || {}).textContent || "";
          const desc = (el.querySelector("p, .desc, .description, [class*='desc']") || {}).textContent || "";
          const date = (el.querySelector("time, .date, [class*='date']") || {}).textContent || "";
          const img = pickImg(el);
          if (title.trim()) entries.push({ title: title.trim(), desc: desc.trim(), date: date.trim(), img });
        });
      }
      if (entries.length === 0) {
        const body = doc.body.innerText;
        const lines = body
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
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

module.exports = { fetchFortniteAPINews, fetchFortniteAPINewsEN, fetchFortniteGGNews, fetchFortniteSTWNews };
