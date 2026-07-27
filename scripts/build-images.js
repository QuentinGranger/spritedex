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
  const outDir = path.join(OUT_BASE, slug);
  fs.mkdirSync(outDir, { recursive: true });

  for (const [variant, srcRelative] of Object.entries(variants)) {
    const srcAbs = path.join(ROOT, srcRelative);
    const ext = path.extname(srcRelative); // .webp ou .png
    const outFile = path.join(outDir, outVariantName(variant) + ".webp");

    // Si la source est un PNG, on pointe quand même vers elle (pas de conversion)
    const outFileActual = path.join(outDir, outVariantName(variant) + ext);

    if (!fs.existsSync(srcAbs)) {
      console.warn(`[SKIP] Source manquante : ${srcRelative}`);
      skipped++;
      continue;
    }

    // Supprime le lien existant si besoin
    if (fs.existsSync(outFileActual)) {
      fs.unlinkSync(outFileActual);
    }
    // Symlink relatif
    const relSrc = path.relative(outDir, srcAbs);
    fs.symlinkSync(relSrc, outFileActual);
    created++;
  }
}

console.log(`Done. ${created} symlinks créés, ${skipped} sources manquantes.`);
