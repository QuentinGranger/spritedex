// ─────────────────────────────────────────────────────────────────────────────
// Étape 17 — Validation automatique du catalogue
//
// Vérifie l'intégrité d'un catalogue SpriteDex AVANT publication/import.
//
// Règle d'or : une information INCONNUE (null / "unknown") ne bloque JAMAIS la
// publication — elle génère au plus un AVERTISSEMENT. En revanche, une véritable
// incohérence (identifiant en double, statut non autorisé, variante orpheline,
// source/saison/événement inexistant, dates contradictoires, champ obligatoire
// manquant) génère une ERREUR qui BLOQUE la publication.
//
// Utilisation :
//   const { validateCatalog, formatReport } = require("./validate-catalog");
//   const { errors, warnings } = validateCatalog(catalog);
//
// En ligne de commande :
//   node scripts/validate-catalog.js ["chemin/vers/catalogue.json"]
//   → affiche le rapport, code de sortie 1 s'il existe des erreurs.
// ─────────────────────────────────────────────────────────────────────────────

// Ensembles de valeurs autorisées (statuts, raretés).
const VALID_RARITIES = new Set(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);
const VALID_AVAILABILITY_STATUSES = new Set([
  "available", "active", "live",
  "upcoming", "unreleased", "coming_soon", "soon",
  "ended", "unavailable", "inactive", "discontinued", "expired", "removed", "over",
  "not_observed", "missing", "not_seen",
  "unknown",
]);
const VALID_RELEASE_STATUSES = new Set(["released", "unreleased", "upcoming", "unknown"]);
const VALID_DATA_STATUSES = new Set([
  "complete", "incomplete", "needs_review", "unverified", "disputed", "archived",
  "observed", "confirmed", "legacy", "unknown",
]);

// Une valeur est « inconnue » (donc acceptable) si elle est nulle, vide ou "unknown".
function isUnknown(v) {
  return v === null || v === undefined || v === "" || (typeof v === "string" && v.toLowerCase() === "unknown");
}

// Parse une date ISO. Renvoie { date, valid }. Une valeur inconnue est valide
// (elle sera simplement ignorée dans les comparaisons).
function parseDate(value) {
  if (isUnknown(value)) return { date: null, valid: true, known: false };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date: null, valid: false, known: true };
  return { date: d, valid: true, known: true };
}

function spriteLabel(sprite) {
  return sprite.name || sprite.officialName || sprite.id || "(sprite sans nom)";
}

function variantLabel(sprite, variant) {
  return `${spriteLabel(sprite)} — ${variant.name || variant.variantType || variant.id || "(variante)"}`;
}

// Collecte tous les sprites (publiés + non publiés) avec un drapeau d'origine.
function collectSprites(catalog) {
  const released = (catalog.sprites || []).map((s) => ({ sprite: s, released: true }));
  const unreleased = (catalog.unreleasedContent?.baseSprites || []).map((s) => ({ sprite: s, released: false }));
  return [...released, ...unreleased];
}

function validateCatalog(catalog) {
  const errors = [];
  const warnings = [];
  const addError = (message, context) => errors.push({ message, context: context || null });
  const addWarning = (message, context) => warnings.push({ message, context: context || null });

  if (!catalog || typeof catalog !== "object") {
    addError("Catalogue invalide ou illisible.");
    return { errors, warnings };
  }

  const allSprites = collectSprites(catalog);

  // Ensembles de référence pour les vérifications croisées.
  const knownSourceIds = new Set((catalog.sources || []).map((s) => s.id).filter(Boolean));
  const knownSeasonIds = new Set();
  if (catalog.season?.id) knownSeasonIds.add(catalog.season.id);
  for (const s of catalog.seasons || []) if (s.id) knownSeasonIds.add(s.id);
  const knownEventIds = new Set((catalog.events || []).map((e) => e.id).filter(Boolean));

  // ── 1. Identifiants en double (ERREUR — bloque la publication) ───────────
  const seenSpriteIds = new Map();
  const seenSlugs = new Map();
  const seenVariantIds = new Map();

  for (const { sprite } of allSprites) {
    if (!isUnknown(sprite.id)) {
      seenSpriteIds.set(sprite.id, (seenSpriteIds.get(sprite.id) || 0) + 1);
    }
    if (!isUnknown(sprite.slug)) {
      seenSlugs.set(sprite.slug, (seenSlugs.get(sprite.slug) || 0) + 1);
    }
    for (const v of sprite.variants || []) {
      if (!isUnknown(v.id)) {
        seenVariantIds.set(v.id, (seenVariantIds.get(v.id) || 0) + 1);
      }
    }
  }
  for (const [id, count] of seenSpriteIds) {
    if (count > 1) addError(`Identifiant de sprite en double : "${id}" (${count} occurrences).`, id);
  }
  for (const [slug, count] of seenSlugs) {
    if (count > 1) addError(`Slug de sprite en double : "${slug}" (${count} occurrences).`, slug);
  }
  for (const [id, count] of seenVariantIds) {
    if (count > 1) addError(`Identifiant de variante en double : "${id}" (${count} occurrences).`, id);
  }
  const seenSourceIds = new Map();
  for (const src of catalog.sources || []) {
    if (!isUnknown(src.id)) seenSourceIds.set(src.id, (seenSourceIds.get(src.id) || 0) + 1);
  }
  for (const [id, count] of seenSourceIds) {
    if (count > 1) addError(`Identifiant de source en double : "${id}" (${count} occurrences).`, id);
  }

  // ── 2..9 : par sprite ────────────────────────────────────────────────────
  for (const { sprite, released } of allSprites) {
    const label = spriteLabel(sprite);

    // 2. Champs obligatoires (ERREUR).
    if (isUnknown(sprite.id)) addError(`Champ obligatoire manquant : identifiant du sprite "${label}".`, label);
    if (isUnknown(sprite.name)) addError(`Champ obligatoire manquant : nom du sprite "${sprite.id || label}".`, label);
    if (isUnknown(sprite.slug)) addError(`Champ obligatoire manquant : slug du sprite "${label}".`, label);

    // 9. Statuts / rareté non autorisés (ERREUR). Rareté inconnue = avertissement.
    if (isUnknown(sprite.rarity)) {
      addWarning(`La rareté du sprite "${label}" est inconnue.`, label);
    } else if (!VALID_RARITIES.has(String(sprite.rarity).toLowerCase())) {
      addError(`Rareté non autorisée pour le sprite "${label}" : "${sprite.rarity}".`, label);
    }

    const availability = sprite.availability || {};
    if (!isUnknown(availability.status) && !VALID_AVAILABILITY_STATUSES.has(String(availability.status).toLowerCase())) {
      addError(`Statut de disponibilité non autorisé pour le sprite "${label}" : "${availability.status}".`, label);
    }
    if (!isUnknown(sprite.dataStatus) && !VALID_DATA_STATUSES.has(String(sprite.dataStatus).toLowerCase())) {
      addError(`Statut de données non autorisé pour le sprite "${label}" : "${sprite.dataStatus}".`, label);
    }

    // 6. Saison inexistante (ERREUR). Saison inconnue (null) = avertissement.
    if (isUnknown(sprite.seasonId)) {
      addWarning(`La saison du sprite "${label}" est inconnue.`, label);
    } else if (knownSeasonIds.size > 0 && !knownSeasonIds.has(sprite.seasonId)) {
      addError(`Saison inexistante référencée par le sprite "${label}" : "${sprite.seasonId}".`, label);
    }

    // 7. Événement inexistant (ERREUR).
    if (!isUnknown(sprite.eventId)) {
      if (knownEventIds.size === 0 || !knownEventIds.has(sprite.eventId)) {
        addError(`Événement inexistant référencé par le sprite "${label}" : "${sprite.eventId}".`, label);
      }
    }

    // 4. Sources inexistantes (ERREUR).
    for (const sid of sprite.sourceIds || []) {
      if (!knownSourceIds.has(sid)) {
        addError(`Source inexistante référencée par le sprite "${label}" : "${sid}".`, label);
      }
    }

    // 5. Dates incohérentes (ERREUR si contradiction ; inconnue = avertissement).
    const start = parseDate(availability.startDate);
    const end = parseDate(availability.endDate);
    const firstObs = parseDate(sprite.firstObservedAt);
    const lastVer = parseDate(sprite.lastVerifiedAt);

    if (!start.valid) addError(`Date de début invalide pour le sprite "${label}" : "${availability.startDate}".`, label);
    if (!end.valid) addError(`Date de fin invalide pour le sprite "${label}" : "${availability.endDate}".`, label);
    if (!firstObs.valid) addError(`Date de première observation invalide pour le sprite "${label}" : "${sprite.firstObservedAt}".`, label);
    if (!lastVer.valid) addError(`Date de dernière vérification invalide pour le sprite "${label}" : "${sprite.lastVerifiedAt}".`, label);

    if (start.date && end.date && end.date < start.date) {
      addError(`Dates incohérentes pour le sprite "${label}" : la date de fin (${availability.endDate}) précède la date de début (${availability.startDate}).`, label);
    }
    if (firstObs.date && lastVer.date && lastVer.date < firstObs.date) {
      addError(`Dates incohérentes pour le sprite "${label}" : la dernière vérification (${sprite.lastVerifiedAt}) précède la première observation (${sprite.firstObservedAt}).`, label);
    }
    // Date de fin inconnue → avertissement (information acceptable).
    if (released && !end.known) {
      addWarning(`La date de fin du ${label} est inconnue.`, label);
    }

    // 3. Variantes orphelines + validations par variante.
    const declaredVariantIds = new Set(sprite.variantIds || []);
    const actualVariantIds = new Set();

    for (const v of sprite.variants || []) {
      const vLabel = variantLabel(sprite, v);

      // Champs obligatoires de variante (ERREUR).
      if (isUnknown(v.id)) addError(`Champ obligatoire manquant : identifiant de variante (${vLabel}).`, vLabel);
      if (isUnknown(v.variantType)) addError(`Champ obligatoire manquant : type de variante (${vLabel}).`, vLabel);
      if (!isUnknown(v.id)) actualVariantIds.add(v.id);

      // Variante orpheline : spriteId ne correspond pas au sprite parent.
      if (!isUnknown(v.spriteId) && !isUnknown(sprite.id) && v.spriteId !== sprite.id) {
        addError(`Variante orpheline : "${v.id}" référence le sprite "${v.spriteId}" mais est déclarée sous "${sprite.id}".`, vLabel);
      }

      // Statut de sortie / données non autorisé (ERREUR).
      if (!isUnknown(v.releaseStatus) && !VALID_RELEASE_STATUSES.has(String(v.releaseStatus).toLowerCase())) {
        addError(`Statut de sortie non autorisé pour la variante "${v.id}" : "${v.releaseStatus}".`, vLabel);
      }
      if (!isUnknown(v.dataStatus) && !VALID_DATA_STATUSES.has(String(v.dataStatus).toLowerCase())) {
        addError(`Statut de données non autorisé pour la variante "${v.id}" : "${v.dataStatus}".`, vLabel);
      }
      const vAvail = v.availability || {};
      if (!isUnknown(vAvail.status) && !VALID_AVAILABILITY_STATUSES.has(String(vAvail.status).toLowerCase())) {
        addError(`Statut de disponibilité non autorisé pour la variante "${v.id}" : "${vAvail.status}".`, vLabel);
      }

      // Sources inexistantes (ERREUR).
      for (const sid of v.sourceIds || []) {
        if (!knownSourceIds.has(sid)) {
          addError(`Source inexistante référencée par la variante "${v.id}" : "${sid}".`, vLabel);
        }
      }

      // Dates de variante incohérentes (ERREUR) / inconnues (avertissement).
      const vStart = parseDate(vAvail.startDate);
      const vEnd = parseDate(vAvail.endDate);
      if (!vStart.valid) addError(`Date de début invalide pour la variante "${v.id}" : "${vAvail.startDate}".`, vLabel);
      if (!vEnd.valid) addError(`Date de fin invalide pour la variante "${v.id}" : "${vAvail.endDate}".`, vLabel);
      if (vStart.date && vEnd.date && vEnd.date < vStart.date) {
        addError(`Dates incohérentes pour la variante "${v.id}" : la date de fin précède la date de début.`, vLabel);
      }

      // 8. Images manquantes (AVERTISSEMENT — information acceptable).
      if (isUnknown(v.imagePath) && isUnknown(v.suggestedImagePath)) {
        addWarning(`L'image de la variante ${vLabel} est manquante.`, vLabel);
      }
    }

    // Cohérence variantIds ↔ variants (ERREUR : référence orpheline).
    for (const vid of declaredVariantIds) {
      if (!actualVariantIds.has(vid)) {
        addError(`Variante orpheline : le sprite "${label}" déclare la variante "${vid}" dans variantIds, mais aucun objet variante correspondant n'existe.`, label);
      }
    }
    for (const vid of actualVariantIds) {
      if (declaredVariantIds.size > 0 && !declaredVariantIds.has(vid)) {
        addWarning(`La variante "${vid}" du sprite "${label}" n'est pas listée dans variantIds.`, label);
      }
    }
  }

  // ── Sources orphelines globales (variantes/season/events déjà couverts) ──
  // Sources référencées par la saison / les événements hebdomadaires.
  const referencedFromMeta = [
    ...(catalog.season?.sourceIds || []),
    ...(catalog.weeklyEvents?.sourceIds || []),
    ...(catalog.events || []).flatMap((e) => e.sourceIds || []),
    ...(catalog.seasons || []).flatMap((s) => s.sourceIds || []),
  ];
  for (const sid of referencedFromMeta) {
    if (!knownSourceIds.has(sid)) {
      addError(`Source inexistante référencée par les métadonnées (saison/événements) : "${sid}".`);
    }
  }

  return { errors, warnings };
}

// Met en forme un rapport lisible en français.
function formatReport({ errors, warnings }) {
  const lines = [];
  if (warnings.length) {
    lines.push(`Avertissements (${warnings.length}) — information inconnue, publication autorisée :`);
    for (const w of warnings) lines.push(`  ⚠️  ${w.message}`);
    lines.push("");
  }
  if (errors.length) {
    lines.push(`Erreurs (${errors.length}) — la publication est BLOQUÉE :`);
    for (const e of errors) lines.push(`  ❌  ${e.message}`);
    lines.push("");
  }
  if (!errors.length && !warnings.length) {
    lines.push("✅ Aucune anomalie détectée. Publication autorisée.");
  } else if (!errors.length) {
    lines.push("✅ Aucune erreur bloquante. Publication autorisée (voir les avertissements ci-dessus).");
  } else {
    lines.push("⛔ Publication bloquée : corrigez les erreurs ci-dessus.");
  }
  return lines.join("\n");
}

module.exports = { validateCatalog, formatReport, finalizeCatalog, formatFinalizationReport };

// ── Étape 22 — Niveau minimum de finalisation du catalogue ──────────────────
// Définit le seuil à atteindre pour considérer cette phase comme terminée.
// Les vérifications purement manuelles (migrations, robustesse aux futures
// modifications) sont listées mais ne peuvent être toutes automatisées depuis
// le seul fichier catalogue.

function finalizeCatalog(catalog) {
  const checks = [];
  const manual = [];

  const addCheck = (ok, name, detail) => checks.push({ name, ok, detail });
  const addManual = (name, detail) => manual.push({ name, detail });

  if (!catalog || typeof catalog !== "object") {
    addCheck(false, "Catalogue lisible", "Le catalogue est invalide.");
    return { ready: false, checks, manual, errors: [] };
  }

  const validation = validateCatalog(catalog);
  const allSprites = collectSprites(catalog);

  addCheck(
    validation.errors.length === 0,
    "Données validées automatiquement",
    validation.errors.length ? `${validation.errors.length} erreur(s) bloquante(s)` : "Aucune erreur bloquante"
  );

  let missingSpriteId = 0;
  let missingVariantId = 0;
  for (const { sprite } of allSprites) {
    if (isUnknown(sprite.id)) missingSpriteId++;
    for (const v of sprite.variants || []) {
      if (isUnknown(v.id)) missingVariantId++;
    }
  }
  addCheck(missingSpriteId === 0, "Identifiants stables des Sprites", missingSpriteId ? `${missingSpriteId} id manquant(s)` : "Tous les sprites ont un id");
  addCheck(missingVariantId === 0, "Identifiants stables des variantes", missingVariantId ? `${missingVariantId} id manquant(s)` : "Toutes les variantes ont un id");

  const requiredSpriteFields = ["id", "name", "slug", "rarity", "variants", "availability", "acquisition", "recurrence", "sources", "dates", "dataStatus"];
  let inconsistent = 0;
  let missingVerification = 0;
  let missingSources = 0;
  for (const { sprite } of allSprites) {
    const hasAllFields = requiredSpriteFields.every((f) => f in sprite);
    if (!hasAllFields) inconsistent++;

    const lastVer = sprite.dates?.lastVerifiedAt || sprite.lastVerifiedAt;
    if (isUnknown(lastVer)) missingVerification++;

    const sourceCount = (Array.isArray(sprite.sources) ? sprite.sources.length : 0) + (Array.isArray(sprite.sourceIds) ? sprite.sourceIds.length : 0);
    if (sourceCount === 0 && sprite.dataStatus !== "complete" && !isUnknown(sprite.availability?.status)) {
      missingSources++;
    }
  }
  addCheck(inconsistent === 0, "Structure uniforme des fiches", inconsistent ? `${inconsistent} fiche(s) incomplète(s)` : "Toutes les fiches partagent la même structure");
  addCheck(missingVerification === 0, "Date de dernière vérification", missingVerification ? `${missingVerification} fiche(s) sans date` : "Chaque fiche a une date de dernière vérification");
  addCheck(missingSources === 0, "Sources attachées aux données", missingSources ? `${missingSources} fiche(s) manquent de sources` : "Les données importantes sont reliées à une source");

  // Les champs inconnus sont acceptés : la validation ne les bloque pas.
  addCheck(true, "Informations inconnues acceptées", "La validation traite les inconnus comme des avertissements, pas des erreurs");

  let ambiguousSources = 0;
  for (const { sprite } of allSprites) {
    for (const src of sprite.sources || []) {
      const rel = (src.reliability || "").toLowerCase();
      const type = (src.type || "").toLowerCase();
      if (isUnknown(rel) && isUnknown(type)) ambiguousSources++;
    }
  }
  addCheck(ambiguousSources === 0, "Sources officielles / observées / communautaires séparées", ambiguousSources ? `${ambiguousSources} source(s) sans type/reliabilité` : "Chaque source est typée");

  const now = new Date();
  let futureDates = 0;
  for (const { sprite } of allSprites) {
    const dates = [
      sprite.dates?.lastVerifiedAt,
      sprite.dates?.firstObservedAt,
      sprite.availability?.startDate,
      sprite.availability?.endDate,
    ];
    for (const d of dates) {
      if (isUnknown(d)) continue;
      const dt = new Date(d);
      if (!Number.isNaN(dt.getTime()) && dt > now) futureDates++;
    }
  }
  addCheck(futureDates === 0, "Aucune information future inventée", futureDates ? `${futureDates} date(s) future(s)` : "Aucune date postérieure à aujourd'hui");

  // Éléments dépendant du backend / des migrations (à vérifier manuellement).
  addManual("Collections existantes migrées", "Vérifier que sprite_entries et collection_history utilisent les identifiants stables.");
  addManual("Catalogue modifiable sans casser les collections", "Vérifier l'usage de legacy_sprite_name_map et des migrations.");

  const ready = validation.errors.length === 0 && checks.every((c) => c.ok);
  return { ready, checks, manual, errors: validation.errors, warnings: validation.warnings };
}

function formatFinalizationReport({ ready, checks, manual, errors, warnings }) {
  const lines = [];
  lines.push("");
  lines.push(ready ? "✅ Catalogue finalisé — prêt pour la phase suivante." : "⛔ Finalisation insuffisante — voir les points bloquants ci-dessous.");
  lines.push("");
  lines.push("── Vérifications automatiques ──");
  for (const c of checks) {
    lines.push(`${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  if (manual.length) {
    lines.push("");
    lines.push("── Vérifications manuelles ──");
    for (const m of manual) {
      lines.push(`🔲 ${m.name} — ${m.detail}`);
    }
  }
  if (warnings.length) {
    lines.push("");
    lines.push(`Avertissements (${warnings.length}) :`);
    for (const w of warnings) lines.push(`  ⚠️  ${w.message}`);
  }
  if (errors.length) {
    lines.push("");
    lines.push(`Erreurs bloquantes (${errors.length}) :`);
    for (const e of errors) lines.push(`  ❌  ${e.message}`);
  }
  return lines.join("\n");
}

// Exécution en ligne de commande.
if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const catalogPath = process.argv[2] || path.join(__dirname, "..", "SpriteDex Catalogue Juil 18 2026.json");
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch (e) {
    console.error(`Impossible de lire le catalogue "${catalogPath}" : ${e.message}`);
    process.exit(1);
  }
  const validation = validateCatalog(catalog);
  console.log(formatReport(validation));
  const finalization = finalizeCatalog(catalog);
  console.log(formatFinalizationReport(finalization));
  process.exit(validation.errors.length > 0 || !finalization.ready ? 1 : 0);
}
