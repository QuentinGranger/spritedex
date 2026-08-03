"use strict";

async function importSourcesAndSeasons(client, catalog, version) {
  // 1. Import sources
  for (const src of catalog.sources || []) {
    await client.query(
      `INSERT INTO sprite_sources (id, type, publisher, title, url, published_at, observed_at, last_verified_at, reliability, catalog_version, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9, $10, NOW())
         ON CONFLICT (id) DO UPDATE SET
           type = $2, publisher = $3, title = $4, url = $5,
           published_at = $6::timestamptz, observed_at = $7::timestamptz, last_verified_at = $8::timestamptz,
           reliability = $9, catalog_version = $10, updated_at = NOW()`,
      [
        src.id,
        src.type,
        src.publisher,
        src.title,
        src.url,
        src.publishedAt,
        src.observedAt,
        src.lastVerifiedAt,
        src.reliability,
        version
      ]
    );
  }

  // 1b. Import seasons
  const catalogSeason = catalog.season;
  if (catalogSeason && catalogSeason.id) {
    await client.query(
      `INSERT INTO seasons (id, chapter, season, name, name_en, start_date, end_date, data_status, sources)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           chapter = $2, season = $3, name = $4, name_en = $5, start_date = $6, end_date = $7, data_status = $8, sources = $9`,
      [
        catalogSeason.id,
        catalogSeason.chapter,
        catalogSeason.season,
        catalogSeason.nameFr || catalogSeason.nameEn || null,
        catalogSeason.nameEn || null,
        catalogSeason.startDate,
        catalogSeason.endDate,
        catalogSeason.statusAsOfCatalogueDate || "incomplete",
        JSON.stringify(catalogSeason.sourceIds || [])
      ]
    );
  }

  // Ensure any seasonId referenced by sprites exists
  const referencedSeasonIds = new Set();
  for (const s of catalog.sprites || []) {
    if (s.seasonId) referencedSeasonIds.add(s.seasonId);
  }
  for (const s of catalog.unreleasedContent?.baseSprites || []) {
    if (s.seasonId) referencedSeasonIds.add(s.seasonId);
  }
  for (const seasonId of referencedSeasonIds) {
    await client.query(
      `INSERT INTO seasons (id, data_status) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
      [seasonId, "incomplete"]
    );
  }
}

module.exports = { importSourcesAndSeasons };
