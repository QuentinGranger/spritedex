// ── SpriteDex : Security helpers (rate limiting, headers, validation, env checks) ──
const { z } = require("zod");

// ─────────────────────────────────────────────────────────────────
// Environment variable validation
// ─────────────────────────────────────────────────────────────────
function validateEnv() {
  const missing = [];
  const warnings = [];

  // Required for core app to run
  if (!process.env.OAUTH_REDIRECT_BASE) missing.push("OAUTH_REDIRECT_BASE");

  // OAuth is optional but must be consistent (both id+secret or neither)
  if ((process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_SECRET) ||
      (!process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
    warnings.push("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET : un des deux est manquant, Google OAuth sera désactivé.");
  }
  if ((process.env.DISCORD_CLIENT_ID && !process.env.DISCORD_CLIENT_SECRET) ||
      (!process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)) {
    warnings.push("DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET : un des deux est manquant, Discord OAuth sera désactivé.");
  }
  if (!process.env.RESEND_API_KEY) {
    warnings.push("RESEND_API_KEY manquant : les emails de vérification/réinitialisation ne seront pas envoyés.");
  }
  if (process.env.NODE_ENV === "production") {
    if (!process.env.DATABASE_URL) {
      warnings.push("DATABASE_URL manquant en production : la connexion Postgres locale par défaut sera utilisée (déconseillé).");
    }
    if (!process.env.CORS_ORIGIN && !process.env.APP_URL) {
      warnings.push("CORS_ORIGIN / APP_URL manquant en production : CORS pourrait rester trop permissif.");
    }
    if ((process.env.OAUTH_REDIRECT_BASE || "").startsWith("http://")) {
      warnings.push("OAUTH_REDIRECT_BASE utilise http:// en production : passe en https://.");
    }
  }

  if (missing.length) {
    console.error(`[ENV] Variables requises manquantes : ${missing.join(", ")}`);
    process.exit(1);
  }
  if (warnings.length) {
    warnings.forEach(w => console.warn(`[ENV][WARN] ${w}`));
  }
}

// ─────────────────────────────────────────────────────────────────
// Security headers (lightweight helmet-like middleware, no extra deps)
// ─────────────────────────────────────────────────────────────────
function securityHeaders(req, res, next) {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; ")
  );
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
}

// ─────────────────────────────────────────────────────────────────
// Static file protection
// express.static(__dirname) would otherwise serve the ENTIRE project
// directory, including server-side source (server.js, security.js, seed.js),
// the DB schema (migrate-auth.sql) and dependency manifests (package.json).
// This middleware blocks those before the static handler runs. (.env, .git and
// other dotfiles are already blocked by serve-static's dotfiles: "deny".)
// ─────────────────────────────────────────────────────────────────
const BLOCKED_STATIC = new Set([
  "/server.js",
  "/security.js",
  "/seed.js",
  "/migrate-auth.sql",
  "/package.json",
  "/package-lock.json",
  "/readme.md"
]);

function blockSensitiveFiles(req, res, next) {
  // Only guard non-API GET/HEAD asset requests; API routes are handled above.
  const p = req.path.toLowerCase();
  if (
    BLOCKED_STATIC.has(p) ||
    p.startsWith("/node_modules") ||
    p.startsWith("/.git") ||
    p.startsWith("/.devin") ||
    p.startsWith("/.env") ||
    p.endsWith(".sql") ||
    p.endsWith(".env")
  ) {
    return res.status(404).send("Not found");
  }
  next();
}

// ─────────────────────────────────────────────────────────────────
// CORS origin resolution
// ─────────────────────────────────────────────────────────────────
function resolveCorsOrigins() {
  const raw = process.env.CORS_ORIGIN || process.env.APP_URL || process.env.OAUTH_REDIRECT_BASE || "http://localhost:3000";
  const configured = raw.split(",").map(s => s.trim()).filter(Boolean);
  // Native app (Capacitor) webview origins. The mobile app is a first-party
  // client authenticated by Bearer token, so these fixed origins are always
  // allowed for the JSON API (they never carry ambient cookies).
  const nativeOrigins = ["capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost"];
  return [...new Set([...configured, ...nativeOrigins])];
}

// ─────────────────────────────────────────────────────────────────
// In-memory rate limiter (per IP, no external dependency)
// Not distributed — sufficient for a single-instance deployment.
// ─────────────────────────────────────────────────────────────────
const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000);

function rateLimit({ windowMs, max, keyPrefix = "rl", message }) {
  return (req, res, next) => {
    // Use Express's req.ip, which honors the app's "trust proxy" setting. This
    // avoids trusting a spoofable X-Forwarded-For header unless the deployment
    // has been explicitly configured to sit behind a trusted proxy.
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message || "Trop de tentatives, réessaie plus tard." });
    }
    next();
  };
}

// Preconfigured limiters for sensitive routes
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: "login", message: "Trop de tentatives de connexion. Réessaie dans 15 minutes." });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: "register", message: "Trop de comptes créés depuis cette adresse. Réessaie plus tard." });
const passwordResetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: "pwreset", message: "Trop de demandes de réinitialisation. Réessaie plus tard." });
const squadCreateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: "squad-create", message: "Trop d'escouades créées. Réessaie plus tard." });
const squadJoinLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, keyPrefix: "squad-join", message: "Trop de tentatives pour rejoindre une escouade. Réessaie plus tard." });
const squadCodeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, keyPrefix: "squad-code", message: "Trop de régénérations de code. Réessaie plus tard." });
const syncLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: "sync", message: "Trop de synchronisations. Ralentis un peu." });
const emailVerifLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: "email-verif", message: "Trop de renvois d'email. Réessaie plus tard." });

// ─────────────────────────────────────────────────────────────────
// Zod validation schemas
// ─────────────────────────────────────────────────────────────────
const USERNAME_RE = /^[a-zA-Z0-9_\-. ]{2,24}$/;

const usernameSchema = z.string().trim().regex(USERNAME_RE, "Pseudo invalide (2-24 caractères : lettres, chiffres, espace, - _ .)");
const emailSchema = z.string().trim().email("Email invalide").max(254);
const passwordSchema = z.string().min(6, "Mot de passe trop court (min 6)").max(200);
const privacySchema = z.enum(["private", "squad_only", "public"]);
const statusSchema = z.enum(["new", "owned", "missing", "priority", "unsure", "unavailable", "spotted"]);
const prioritySchema = z.enum(["none", "urgent", "important", "medium", "low", "ignored"]);
const noteSchema = z.string().max(500).optional();
const squadNameSchema = z.string().trim().min(1).max(50);
const squadCodeSchema = z.string().trim().min(4).max(30).regex(/^[A-Z0-9\-]+$/i, "Format de code invalide");

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema.optional()
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200)
});

// Avatars come either from the built-in local picker (Personna/*.png|webp) or
// from an OAuth provider's https picture URL. Never accept javascript:/data:
// URIs or arbitrary strings to avoid link-based XSS or open redirect abuse.
const avatarUrlSchema = z.string().max(500).refine(
  (val) => val === "" || /^Personna\/[\w\-. ]+\.(png|webp|jpe?g)$/i.test(val) || /^https:\/\/[^\s"'<>]+$/i.test(val),
  { message: "URL d'avatar invalide" }
);

const profilePatchSchema = z.object({
  username: usernameSchema.optional(),
  avatarUrl: avatarUrlSchema.optional(),
  privacy: privacySchema.optional()
}).strict();

const collectionEntrySchema = z.object({
  status: statusSchema.optional(),
  note: noteSchema,
  priority: prioritySchema.optional(),
  obtainedAt: z.string().datetime().nullable().optional().or(z.literal(""))
}).strict();

const collectionSyncEntrySchema = z.object({
  status: statusSchema.optional(),
  note: z.string().max(500).optional(),
  priority: prioritySchema.optional(),
  obtainedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

// Local state also stores simple booleans for favorites under "fav_<spriteId>"
// keys, alongside real collection entry objects — accept both shapes.
const collectionSyncValueSchema = z.union([z.boolean(), collectionSyncEntrySchema]);

const collectionSyncSchema = z.object({
  collection: z.record(z.string().max(120), collectionSyncValueSchema).refine(
    (obj) => Object.keys(obj).length <= 2000,
    { message: "Collection trop volumineuse" }
  )
});

const squadCreateSchema = z.object({
  name: squadNameSchema.optional()
}).passthrough(); // frontend also sends userId; ignored server-side (derived from session)

const squadJoinSchema = z.object({
  code: squadCodeSchema
}).passthrough();

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      return res.status(400).json({ error: firstIssue?.message || "Requête invalide" });
    }
    req.validatedBody = result.data;
    next();
  };
}

module.exports = {
  validateEnv,
  securityHeaders,
  blockSensitiveFiles,
  resolveCorsOrigins,
  rateLimit,
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  squadCreateLimiter,
  squadJoinLimiter,
  squadCodeLimiter,
  syncLimiter,
  emailVerifLimiter,
  validateBody,
  schemas: {
    registerSchema,
    loginSchema,
    profilePatchSchema,
    collectionEntrySchema,
    collectionSyncSchema,
    squadCreateSchema,
    squadJoinSchema,
    usernameSchema,
    privacySchema,
    statusSchema,
    prioritySchema
  }
};
