// Génère la structure images/sprites/<slug>/<variant>.webp
// en créant des symlinks vers les fichiers source dans Sprite/
// Idempotent — peut être relancé sans risque.
const fs = require("fs");
const path = require("path");
const { SPRITE_IMAGES } = require("../sprite-data");

const ROOT = path.join(__dirname, "..");
const OUT_BASE = path.join(ROOT, "images", "sprites");

// Slug par sprite_id (retire le préfixe sprite_ et remplace _ par -)
function slugFromId(id) {
  return id.replace(/^sprite_/, "").replace(/_/g, "-");
}

// Normalise le nom de variante en nom de fichier de sortie
function outVariantName(variant) {
  return variant.toLowerCase();
}

let created = 0;
let skipped = 0;

for (const [spriteId, variants] of Object.entries(SPRITE_IMAGES)) {
  const slug = slugFromId(spriteId);
  // L'API peut retourner des paths avec tiret OU underscore selon la source
  // (catalogue JSON = underscore, slug = tiret). On crée les deux si différents.
  const slugUnderscore = spriteId.replace(/^sprite_/, "");
  const outDirs = [path.join(OUT_BASE, slug)];
  if (slugUnderscore !== slug) outDirs.push(path.join(OUT_BASE, slugUnderscore));

  for (const outDir of outDirs) {
    fs.mkdirSync(outDir, { recursive: true });

    for (const [variant, srcRelative] of Object.entries(variants)) {
      const srcAbs = path.join(ROOT, srcRelative);
      const ext = path.extname(srcRelative); // .webp ou .png
      const outFileActual = path.join(outDir, outVariantName(variant) + ext);

      if (!fs.existsSync(srcAbs)) {
        console.warn(`[SKIP] Source manquante : ${srcRelative}`);
        skipped++;
        continue;
      }

      if (fs.existsSync(outFileActual)) {
        fs.unlinkSync(outFileActual);
      }
      const relSrc = path.relative(outDir, srcAbs);
      fs.symlinkSync(relSrc, outFileActual);
      created++;
    }
  }
}

console.log(`Done. ${created} symlinks créés, ${skipped} sources manquantes.`);
