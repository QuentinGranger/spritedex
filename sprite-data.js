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
    id: "water", name: "Water Sprite", rarity: "Rare",
    color: "rgba(36, 167, 255, 0.42)",
    effect: "Donne un avantage défensif et du bouclier autour de l'eau selon la situation.",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "available", added_date: "2025-02-01"
  },
  {
    id: "earth", name: "Earth Sprite", rarity: "Rare",
    color: "rgba(83, 220, 132, 0.42)",
    effect: "Améliore le loot et favorise les récompenses rares dans les containers/coffres.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-02-01"
  },
  {
    id: "fire", name: "Fire Sprite", rarity: "Rare",
    color: "rgba(255, 105, 54, 0.46)",
    effect: "Déclenche un bonus offensif ou une explosion de feu après assez de dégâts.",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "available", added_date: "2025-02-01"
  },
  {
    id: "air", name: "Air Sprite", rarity: "Rare",
    color: "rgba(127, 235, 255, 0.38)",
    effect: "Améliore la mobilité : sprint, saut ou déplacement selon le niveau du sprite.",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "available", added_date: "2025-02-01"
  },
  {
    id: "fishy", name: "Fishy Sprite", rarity: "Rare",
    color: "rgba(37, 201, 255, 0.42)",
    effect: "Améliore la nage et peut donner un boost de survie/mobilité sous pression.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-02-01"
  },
  {
    id: "duck", name: "Duck Sprite", rarity: "Épique",
    color: "rgba(255, 210, 78, 0.42)",
    effect: "Interagit avec les emotes/jams pour récupérer du bouclier ou créer une ouverture.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-02-15"
  },
  {
    id: "demon", name: "Demon Sprite", rarity: "Épique",
    color: "rgba(196, 67, 255, 0.42)",
    effect: "Donne un effet de siphon ou d'avantage agressif après une élimination.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-02-15"
  },
  {
    id: "ghost", name: "Ghost Sprite", rarity: "Épique",
    color: "rgba(222, 232, 255, 0.34)",
    effect: "Déclenche une courte invisibilité ou un avantage furtif après certaines actions.",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "available", added_date: "2025-02-15"
  },
  {
    id: "king", name: "King Sprite", rarity: "Épique",
    color: "rgba(255, 197, 77, 0.48)",
    effect: "Augmente les dégâts de pioche ou donne un avantage de domination rapprochée.",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "available", added_date: "2025-03-01"
  },
  {
    id: "striker", name: "Striker Sprite", rarity: "Épique",
    color: "rgba(255, 236, 73, 0.4)",
    effect: "Déclenche un effet d'overdrive après mantle/hurdle ou mouvements agressifs.",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "available", added_date: "2025-03-01"
  },
  {
    id: "aura", name: "Aura Sprite", rarity: "Épique",
    color: "rgba(128, 90, 255, 0.44)",
    effect: "Charge un effet type Shock Rock ou boost après assez de dégâts infligés.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-03-15"
  },
  {
    id: "punk", name: "Punk Sprite", rarity: "Légendaire",
    color: "rgba(255, 70, 147, 0.45)",
    effect: "Peut donner un buff puissant, notamment autour des munitions au niveau élevé.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-04-01"
  },
  {
    id: "dream", name: "Dream Sprite", rarity: "Légendaire",
    color: "rgba(150, 128, 255, 0.46)",
    effect: "Récompense la montée en niveau avec des objets, jusqu'à du très bon loot au max.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-04-01"
  },
  {
    id: "boss", name: "Boss Sprite", rarity: "Légendaire",
    color: "rgba(255, 121, 70, 0.42)",
    effect: "Augmente la résistance, les PV ou le bouclier maximum selon son niveau.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-04-15"
  },
  {
    id: "seven", name: "Seven Sprite", rarity: "Légendaire",
    color: "rgba(92, 207, 255, 0.42)",
    effect: "Aide l'escouade à repérer les traces ou mouvements ennemis.",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "available", added_date: "2025-04-15"
  },
  {
    id: "batman", name: "Batman Sprite", rarity: "Épique",
    color: "rgba(50, 54, 60, 0.55)",
    effect: "Augmente la furtivité et la résistance dans les zones d'ombre pour un avantage tactique.",
    variants: ["Base", "Gold", "Gummy", "Galaxy", "Holofoil"],
    available: "available", added_date: "2026-07-18"
  },
  {
    id: "zero-point", name: "Zero Point Sprite", rarity: "Mythique",
    color: "rgba(73, 105, 255, 0.48)",
    effect: "Déclenche un effet défensif type Shield Bubble Jr. autour des soins.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-05-01"
  },
  {
    id: "grim", name: "Grim Sprite", rarity: "Mythique",
    color: "rgba(210, 215, 230, 0.32)",
    effect: "Marque ou révèle les joueurs qui te touchent, utile pour retourner le fight.",
    variants: ["Base", "Gold", "Gummy", "Galaxy"],
    available: "available", added_date: "2025-05-15"
  },
  {
    id: "burnt-peanut", name: "Burnt Peanut Sprite", rarity: "Mythique",
    color: "rgba(159, 96, 48, 0.46)",
    effect: "Sprite unique avec chance de bonus de loot puissant après élimination.",
    variants: ["Base"],
    available: "available", added_date: "2025-06-01"
  }
];

const SPRITE_IMAGES = {
  "water":       { Base: "Sprite/Water/WaterSprite.webp", Gold: "Sprite/Water/WaterSprite_Gold.webp", Gummy: "Sprite/Water/WaterSprite_Gummy.webp", Galaxy: "Sprite/Water/WaterSprite_Galaxy.webp", Holofoil: "Sprite/Water/WaterSprite_Holofoil.webp" },
  "earth":       { Base: "Sprite/Earth/SpriteEarth.webp", Gold: "Sprite/Earth/SpriteEarth_Gold.webp", Gummy: "Sprite/Earth/SpriteEarth_Gummy.webp", Galaxy: "Sprite/Earth/SpriteEarth_Galaxy.webp" },
  "fire":        { Base: "Sprite/Fire/FireSprite.webp", Gold: "Sprite/Fire/FireSprite_Gold.webp", Gummy: "Sprite/Fire/FireSprite_Gummy.webp", Galaxy: "Sprite/Fire/FireSprite_Galaxy.webp", Holofoil: "Sprite/Fire/SpriteFire_Holofoil.webp" },
  "air":         { Base: "Sprite/Air/Air.webp", Gold: "Sprite/Air/Air_Gold.webp", Gummy: "Sprite/Air/Air_Gummy.webp", Galaxy: "Sprite/Air/Air_Galaxy.webp", Holofoil: "Sprite/Air/Air_Holofoil.webp" },
  "fishy":       { Base: "Sprite/Fishy/SpriteFishy.webp", Gold: "Sprite/Fishy/SpriteFishy_Gold.webp", Gummy: "Sprite/Fishy/SpriteFishy_Gummy.webp", Galaxy: "Sprite/Fishy/SpriteFishy_Galaxy.webp" },
  "duck":        { Base: "Sprite/Ducky/Duck.webp", Gold: "Sprite/Ducky/Duck_Gold.webp", Gummy: "Sprite/Ducky/Duck_Gummy.webp", Galaxy: "Sprite/Ducky/Duck_Galaxy.webp" },
  "demon":       { Base: "Sprite/Demon/Demon.webp", Gold: "Sprite/Demon/Demon_Gold.webp", Gummy: "Sprite/Demon/Demon_Gummy.webp", Galaxy: "Sprite/Demon/Demon_Galaxy.webp" },
  "ghost":       { Base: "Sprite/Ghost/Ghost.webp", Gold: "Sprite/Ghost/Ghost_Gold.webp", Gummy: "Sprite/Ghost/Ghost_Gummy.webp", Galaxy: "Sprite/Ghost/Ghost_Galaxy.webp", Holofoil: "Sprite/Ghost/Ghost_Holofoil.webp" },
  "king":        { Base: "Sprite/King/King.webp", Gold: "Sprite/King/King_gold.webp", Gummy: "Sprite/King/King_Gummy.webp", Galaxy: "Sprite/King/King_Galaxy.webp", Holofoil: "Sprite/King/King_Holofoil.webp" },
  "striker":     { Base: "Sprite/Striker/Striker.webp", Gold: "Sprite/Striker/Striker_gold.webp", Gummy: "Sprite/Striker/Striker_Gummy.webp", Galaxy: "Sprite/Striker/Striker_Galaxy.webp", Holofoil: "Sprite/Striker/Striker_Holofoil.webp" },
  "aura":        { Base: "Sprite/Aura/Aura.webp", Gold: "Sprite/Aura/Aura_Gold.webp", Gummy: "Sprite/Aura/Aura_Gummy.webp", Galaxy: "Sprite/Aura/Aura_Galaxy.webp" },
  "punk":        { Base: "Sprite/Punk/Punk.webp", Gold: "Sprite/Punk/Punk_Gold.webp", Gummy: "Sprite/Punk/Punk_Gummy.webp", Galaxy: "Sprite/Punk/Punk_Galaxy.webp" },
  "dream":       { Base: "Sprite/Dream/Dream.webp", Gold: "Sprite/Dream/Dream_Gold.webp", Gummy: "Sprite/Dream/Dream_Gummy.webp", Galaxy: "Sprite/Dream/Dream_Galaxy.webp" },
  "boss":        { Base: "Sprite/Boss/Boss.webp", Gold: "Sprite/Boss/Boss_Gold.webp", Gummy: "Sprite/Boss/Boss_Gummy.webp", Galaxy: "Sprite/Boss/Boss_Galaxy.webp" },
  "seven":       { Base: "Sprite/Seven/Seven.webp", Gold: "Sprite/Seven/Seven_Gold.webp", Gummy: "Sprite/Seven/Seven_Gummy.webp", Galaxy: "Sprite/Seven/Seven_Galaxy.webp", Holofoil: "Sprite/Seven/Seven_Holofoil.webp" },
  "batman":      { Base: "Sprite/Batman/Batman.webp", Gold: "Sprite/Batman/Batman_Gold.webp", Gummy: "Sprite/Batman/Batman_Gummy.webp", Galaxy: "Sprite/Batman/Batman_Galaxy.webp", Holofoil: "Sprite/Batman/Batman_Holofoil.webp" },
  "grim":        { Base: "Sprite/Grim/Grim.webp", Gold: "Sprite/Grim/Grim_Gold.webp", Gummy: "Sprite/Grim/Grim_Gummy.webp", Galaxy: "Sprite/Grim/Grim_Galaxy.webp" },
  "zero-point":  { Base: "Sprite/ZeroPoint/ZeroPoint.webp", Gold: "Sprite/ZeroPoint/ZeroPoint_Gold.webp", Gummy: "Sprite/ZeroPoint/ZeroPoint_Gummy.webp", Galaxy: "Sprite/ZeroPoint/ZeroPoint_Galaxy.webp" },
  "burnt-peanut":{ Base: "Sprite/Peannut/BurntPeanut.webp" }
};

// Seeds reference data using a provided pool/client. Idempotent (upserts).
async function seedReferenceData(db) {
  for (const v of VARIANT_META) {
    await db.query(
      `INSERT INTO variant_meta (name, label, bonus) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET label = $2, bonus = $3`,
      [v.name, v.label, v.bonus]
    );
  }
  for (const s of SPRITES) {
    await db.query(
      `INSERT INTO sprites (id, name, rarity, color, effect, variants, available, added_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = $2, rarity = $3, color = $4, effect = $5,
         variants = $6, available = $7, added_date = $8`,
      [s.id, s.name, s.rarity, s.color, s.effect, s.variants, s.available, s.added_date]
    );
  }
  let imgCount = 0;
  for (const [spriteId, variants] of Object.entries(SPRITE_IMAGES)) {
    for (const [variant, imgPath] of Object.entries(variants)) {
      await db.query(
        `INSERT INTO sprite_images (sprite_id, variant, image_path) VALUES ($1, $2, $3)
         ON CONFLICT (sprite_id, variant) DO UPDATE SET image_path = $3`,
        [spriteId, variant, imgPath]
      );
      imgCount++;
    }
  }
  return { variants: VARIANT_META.length, sprites: SPRITES.length, images: imgCount };
}

module.exports = { VARIANT_META, SPRITES, SPRITE_IMAGES, seedReferenceData };
