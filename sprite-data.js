// Static reference data for SpriteDex (sprites, their variants and images).
// Shared by seed.js (CLI seeding) and server.js (auto-seed on boot when the
// database is empty), so the dataset lives in exactly one place.

const VARIANT_META = [
  { name: "Base",     label: "Base",     bonus: "Pouvoir normal du sprite." },
  { name: "Gold",     label: "Gold",     bonus: "Bonus XP Sprite sur les éliminations." },
  { name: "Gummy",    label: "Gummy",    bonus: "Bonus Sprite Dust à l'extraction." },
  { name: "Galaxy",   label: "Galaxy",   bonus: "Bonus de munitions ramassées." },
  { name: "Gem",      label: "Gem",      bonus: "Variante spéciale liée aux anomalies/événements." },
  { name: "Holofoil", label: "Holofoil", bonus: "Variante spéciale liée aux anomalies/événements." },
  { name: "Rift",     label: "Rift",     bonus: "Variante rare/spéciale liée aux événements Rift." }
];

const SPRITES = [
  {
    id: "sprite_water", name: "Water Sprite", rarity: "unknown",
    color: "rgba(36, 167, 255, 0.42)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_earth", name: "Earth Sprite", rarity: "unknown",
    color: "rgba(83, 220, 132, 0.42)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_fire", name: "Fire Sprite", rarity: "unknown",
    color: "rgba(255, 105, 54, 0.46)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_air", name: "Air Sprite", rarity: "unknown",
    color: "rgba(127, 235, 255, 0.38)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_fishy", name: "Fishy Sprite", rarity: "unknown",
    color: "rgba(37, 201, 255, 0.42)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_duck", name: "Duck Sprite", rarity: "unknown",
    color: "rgba(255, 210, 78, 0.42)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_demon", name: "Demon Sprite", rarity: "unknown",
    color: "rgba(196, 67, 255, 0.42)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_ghost", name: "Ghost Sprite", rarity: "unknown",
    color: "rgba(222, 232, 255, 0.34)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_king", name: "King Sprite", rarity: "unknown",
    color: "rgba(255, 197, 77, 0.48)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_striker", name: "Striker Sprite", rarity: "unknown",
    color: "rgba(255, 236, 73, 0.4)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_aura", name: "Aura Sprite", rarity: "unknown",
    color: "rgba(128, 90, 255, 0.44)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_punk", name: "Punk Sprite", rarity: "unknown",
    color: "rgba(255, 70, 147, 0.45)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_dream", name: "Dream Sprite", rarity: "unknown",
    color: "rgba(150, 128, 255, 0.46)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_boss", name: "Boss Sprite", rarity: "unknown",
    color: "rgba(255, 121, 70, 0.42)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_seven", name: "Seven Sprite", rarity: "unknown",
    color: "rgba(92, 207, 255, 0.42)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_batman", name: "Batman Sprite", rarity: "unknown",
    color: "rgba(50, 54, 60, 0.55)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_zero_point", name: "Zero Point Sprite", rarity: "unknown",
    color: "rgba(73, 105, 255, 0.48)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_grim", name: "Grim Sprite", rarity: "unknown",
    color: "rgba(210, 215, 230, 0.32)",
    effect: "unknown",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "unknown", added_date: null
  },
  {
    id: "sprite_burnt_peanut", name: "Burnt Peanut Sprite", rarity: "unknown",
    color: "rgba(159, 96, 48, 0.46)",
    effect: "unknown",
    variants: ["Base"],
    available: "unknown", added_date: null
  }
];

const SPRITE_IMAGES = {
  "sprite_water":       { Base: "Sprite/Water/WaterSprite.webp", Gold: "Sprite/Water/WaterSprite_Gold.webp", Gummy: "Sprite/Water/WaterSprite_Gummy.webp", Galaxy: "Sprite/Water/WaterSprite_Galaxy.webp", Holofoil: "Sprite/Water/WaterSprite_Holofoil.webp" },
  "sprite_earth":       { Base: "Sprite/Earth/SpriteEarth.webp", Gold: "Sprite/Earth/SpriteEarth_Gold.webp", Gummy: "Sprite/Earth/SpriteEarth_Gummy.webp", Galaxy: "Sprite/Earth/SpriteEarth_Galaxy.webp" },
  "sprite_fire":        { Base: "Sprite/Fire/FireSprite.webp", Gold: "Sprite/Fire/FireSprite_Gold.webp", Gummy: "Sprite/Fire/FireSprite_Gummy.webp", Galaxy: "Sprite/Fire/FireSprite_Galaxy.webp", Holofoil: "Sprite/Fire/SpriteFire_Holofoil.webp" },
  "sprite_air":         { Base: "Sprite/Air/Air.webp", Gold: "Sprite/Air/Air_Gold.webp", Gummy: "Sprite/Air/Air_Gummy.webp", Galaxy: "Sprite/Air/Air_Galaxy.webp", Holofoil: "Sprite/Air/Air_Holofoil.webp" },
  "sprite_fishy":       { Base: "Sprite/Fishy/SpriteFishy.webp", Gold: "Sprite/Fishy/SpriteFishy_Gold.webp", Gummy: "Sprite/Fishy/SpriteFishy_Gummy.webp", Galaxy: "Sprite/Fishy/SpriteFishy_Galaxy.webp" },
  "sprite_duck":        { Base: "Sprite/Ducky/Duck.webp", Gold: "Sprite/Ducky/Duck_Gold.webp", Gummy: "Sprite/Ducky/Duck_Gummy.webp", Galaxy: "Sprite/Ducky/Duck_Galaxy.webp" },
  "sprite_demon":       { Base: "Sprite/Demon/Demon.webp", Gold: "Sprite/Demon/Demon_Gold.webp", Gummy: "Sprite/Demon/Demon_Gummy.webp", Galaxy: "Sprite/Demon/Demon_Galaxy.webp" },
  "sprite_ghost":       { Base: "Sprite/Ghost/Ghost.webp", Gold: "Sprite/Ghost/Ghost_Gold.webp", Gummy: "Sprite/Ghost/Ghost_Gummy.webp", Galaxy: "Sprite/Ghost/Ghost_Galaxy.webp", Holofoil: "Sprite/Ghost/Ghost_Holofoil.webp" },
  "sprite_king":        { Base: "Sprite/King/King.webp", Gold: "Sprite/King/King_gold.webp", Gummy: "Sprite/King/King_Gummy.webp", Galaxy: "Sprite/King/King_Galaxy.webp", Holofoil: "Sprite/King/King_Holofoil.webp" },
  "sprite_striker":     { Base: "Sprite/Striker/Striker.webp", Gold: "Sprite/Striker/Striker_gold.webp", Gummy: "Sprite/Striker/Striker_Gummy.webp", Galaxy: "Sprite/Striker/Striker_Galaxy.webp", Holofoil: "Sprite/Striker/Striker_Holofoil.webp" },
  "sprite_aura":        { Base: "Sprite/Aura/Aura.webp", Gold: "Sprite/Aura/Aura_Gold.webp", Gummy: "Sprite/Aura/Aura_Gummy.webp", Galaxy: "Sprite/Aura/Aura_Galaxy.webp" },
  "sprite_punk":        { Base: "Sprite/Punk/Punk.webp", Gold: "Sprite/Punk/Punk_Gold.webp", Gummy: "Sprite/Punk/Punk_Gummy.webp", Galaxy: "Sprite/Punk/Punk_Galaxy.webp" },
  "sprite_dream":       { Base: "Sprite/Dream/Dream.webp", Gold: "Sprite/Dream/Dream_Gold.webp", Gummy: "Sprite/Dream/Dream_Gummy.webp", Galaxy: "Sprite/Dream/Dream_Galaxy.webp" },
  "sprite_boss":        { Base: "Sprite/Boss/Boss.webp", Gold: "Sprite/Boss/Boss_Gold.webp", Gummy: "Sprite/Boss/Boss_Gummy.webp", Galaxy: "Sprite/Boss/Boss_Galaxy.webp" },
  "sprite_seven":       { Base: "Sprite/Seven/Seven.webp", Gold: "Sprite/Seven/Seven_Gold.webp", Gummy: "Sprite/Seven/Seven_Gummy.webp", Galaxy: "Sprite/Seven/Seven_Galaxy.webp", Holofoil: "Sprite/Seven/Seven_Holofoil.webp" },
  "sprite_batman":      { Base: "Sprite/Batman/Batman.webp", Gold: "Sprite/Batman/Batman_Gold.webp", Gummy: "Sprite/Batman/Batman_Gummy.webp", Galaxy: "Sprite/Batman/Batman_Galaxy.webp", Holofoil: "Sprite/Batman/Batman_Holofoil.webp" },
  "sprite_grim":        { Base: "Sprite/Grim/Grim.webp", Gold: "Sprite/Grim/Grim_Gold.webp", Gummy: "Sprite/Grim/Grim_Gummy.webp", Galaxy: "Sprite/Grim/Grim_Galaxy.webp" },
  "sprite_zero_point":  { Base: "Sprite/ZeroPoint/ZeroPoint.webp", Gold: "Sprite/ZeroPoint/ZeroPoint_Gold.webp", Gummy: "Sprite/ZeroPoint/ZeroPoint_Gummy.webp", Galaxy: "Sprite/ZeroPoint/ZeroPoint_Galaxy.webp" },
  "sprite_burnt_peanut":{ Base: "Sprite/Peannut/BurntPeanut.webp" }
};

// Seeds reference data using a provided pool/client. Idempotent (upserts).
async function seedReferenceData(db) {
  for (const v of VARIANT_META) {
    await db.query(
      `INSERT INTO variant_meta (name, label, bonus) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      [v.name, v.label, v.bonus]
    );
  }
  for (const s of SPRITES) {
    const slug = s.slug || s.id.replace(/^sprite_/, "").replace(/_/g, "-");
    const baseImage = SPRITE_IMAGES[s.id]?.Base;
    await db.query(
      `INSERT INTO sprites (
        id, name, rarity, color, effect, variants, available, added_date,
        slug, image, data_status, availability, acquisition, sources
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO NOTHING`,
      [
        s.id, s.name, s.rarity, s.color, s.effect, s.variants, s.available, s.added_date,
        slug,
        baseImage || null,
        "incomplete",
        JSON.stringify({ status: "unknown", startDate: null, endDate: null, recurrence: "unknown", confidence: "unknown" }),
        JSON.stringify({ type: "unknown", description: null, location: null, requirements: [], confidence: "unknown" }),
        JSON.stringify([]),
      ]
    );
  }
  let imgCount = 0;
  for (const [spriteId, variants] of Object.entries(SPRITE_IMAGES)) {
    for (const [variant, imgPath] of Object.entries(variants)) {
      await db.query(
        `INSERT INTO sprite_images (sprite_id, variant, image_path) VALUES ($1, $2, $3)
         ON CONFLICT (sprite_id, variant) DO NOTHING`,
        [spriteId, variant, imgPath]
      );
      imgCount++;
    }
  }
  return { variants: VARIANT_META.length, sprites: SPRITES.length, images: imgCount };
}

module.exports = { VARIANT_META, SPRITES, SPRITE_IMAGES, seedReferenceData };
