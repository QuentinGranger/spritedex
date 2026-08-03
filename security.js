// ── SPRITE-INDEX : Security helpers (rate limiting, headers, validation, env checks) ──
const crypto = require("crypto");
const { z } = require("zod");
const path = require("path");
const { consumeRateLimit, validRedisUrl } = require("./server/rate-limit-store");

// ─────────────────────────────────────────────────────────────────
// Environment variable validation
// ─────────────────────────────────────────────────────────────────
function validateEnv() {
  const missing = [];
  const warnings = [];

  // Required for core app to run
  if (!process.env.APP_URL && !process.env.OAUTH_REDIRECT_BASE && !process.env.RENDER_EXTERNAL_URL) {
    missing.push("APP_URL ou OAUTH_REDIRECT_BASE");
  }

  // OAuth is optional but must be consistent (both id+secret or neither)
  if (
    (process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_SECRET) ||
    (!process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  ) {
    warnings.push("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET : un des deux est manquant, Google OAuth sera désactivé.");
  }
  if (
    (process.env.DISCORD_CLIENT_ID && !process.env.DISCORD_CLIENT_SECRET) ||
    (!process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)
  ) {
    warnings.push(
      "DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET : un des deux est manquant, Discord OAuth sera désactivé."
    );
  }
  if (!process.env.RESEND_API_KEY) {
    warnings.push("RESEND_API_KEY manquant : les emails de vérification/réinitialisation ne seront pas envoyés.");
  } else if (!process.env.FROM_EMAIL) {
    warnings.push("FROM_EMAIL manquant : Resend est configuré mais aucun e-mail transactionnel ne sera envoyé.");
  }
  if (process.env.REPLY_TO_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.REPLY_TO_EMAIL.trim())) {
    warnings.push("REPLY_TO_EMAIL invalide : configure une boîte de réponse surveillée au format adresse@domaine.");
  }
  if (process.env.ERROR_WEBHOOK_URL) {
    try {
      const webhook = new URL(process.env.ERROR_WEBHOOK_URL);
      if (
        webhook.username ||
        webhook.password ||
        (process.env.NODE_ENV === "production" && webhook.protocol !== "https:")
      ) {
        warnings.push("ERROR_WEBHOOK_URL invalide : utilise un webhook HTTPS sans identifiants dans l’URL.");
      }
    } catch {
      warnings.push("ERROR_WEBHOOK_URL invalide : indique une URL HTTPS complète.");
    }
  }
  if (
    process.env.RESEND_FROM_DOMAIN &&
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
      process.env.RESEND_FROM_DOMAIN.trim()
    )
  ) {
    warnings.push(
      "RESEND_FROM_DOMAIN invalide : indique uniquement le domaine vérifié dans Resend, sans protocole ni adresse e-mail."
    );
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    warnings.push("VAPID keys non définis : des clés VAPID seront générées automatiquement au premier démarrage.");
  }
  if (!process.env.FCM_SERVER_KEY) {
    warnings.push("FCM_SERVER_KEY manquant : les notifications push Android natif ne seront pas envoyées.");
  }
  if (!process.env.APNS_KEY || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APNS_TOPIC) {
    warnings.push("APNS credentials manquantes : les notifications push iOS natif ne seront pas envoyées.");
  }
  if (process.env.NODE_ENV === "production") {
    if (process.env.EMAIL_VERIFICATION_REQUIRED === "0") {
      missing.push("EMAIL_VERIFICATION_REQUIRED ne peut pas être désactivé (0) en production");
    }
    if (!process.env.DATABASE_URL) {
      warnings.push(
        "DATABASE_URL manquant en production : la connexion Postgres locale par défaut sera utilisée (déconseillé)."
      );
    }
    if (!process.env.CORS_ORIGIN && !process.env.APP_URL) {
      warnings.push("CORS_ORIGIN / APP_URL manquant en production : CORS pourrait rester trop permissif.");
    }
    if (process.env.RESEND_API_KEY && !process.env.RESEND_FROM_DOMAIN) {
      warnings.push(
        "RESEND_FROM_DOMAIN manquant : configure le domaine Resend vérifié pour empêcher un expéditeur mal aligné."
      );
    }
    if (
      (process.env.APP_URL || process.env.OAUTH_REDIRECT_BASE || process.env.RENDER_EXTERNAL_URL || "").startsWith(
        "http://"
      )
    ) {
      missing.push("APP_URL / OAUTH_REDIRECT_BASE en HTTPS");
    }
    if (!process.env.REDIS_URL) {
      warnings.push(
        "REDIS_URL manquant : les rate limits restent locaux à chaque instance. Configure Redis avant de multiplier les services web."
      );
    } else if (!validRedisUrl(process.env.REDIS_URL.trim())) {
      missing.push("REDIS_URL valide (redis:// ou rediss://)");
    }
  }

  if (missing.length) {
    console.error(`[ENV] Variables requises manquantes : ${missing.join(", ")}`);
    process.exit(1);
  }
  if (warnings.length) {
    warnings.forEach((w) => console.warn(`[ENV][WARN] ${w}`));
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
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
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
  "/security-logger.js",
  "/push-service.js",
  "/analytics.js",
  "/sprite-data.js",
  "/seed.js",
  "/migrate-auth.sql",
  "/package.json",
  "/package-lock.json",
  "/capacitor.config.json",
  "/render.yaml",
  "/readme.md"
]);

// Server-side directories that must never be exposed by the static file handler.
const BLOCKED_STATIC_PREFIXES = [
  "/node_modules",
  "/.git",
  "/.idea",
  "/.devin",
  "/.env",
  "/android/",
  "/ios/",
  "/desktop/",
  "/server/",
  "/scripts/",
  "/test/"
];

// The app used to serve the repository root. Keep a positive allowlist for
// actual browser assets so a newly added source/config directory is private by
// default rather than relying on every sensitive path being remembered here.
const PUBLIC_STATIC_ROOT_FILES = new Set([
  "/",
  "/index.html",
  "/404.html",
  "/manifest.json",
  "/manifest.webmanifest",
  "/sw.js",
  "/logoapp.png",
  "/logobackoffice.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg",
  "/app-logo.png",
  "/applogo.png",
  "/logo.png",
  "/iconeapplicationmobile.png"
]);
const PUBLIC_STATIC_DIRECTORIES = new Map([
  ["/css/", new Set([".css"])],
  ["/js/", new Set([".js", ".png", ".webp", ".jpg", ".jpeg", ".svg", ".ico"])],
  ["/favicon/", new Set([".png", ".ico", ".svg", ".webmanifest", ".json"])],
  ["/sprite/", new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"])],
  ["/images/", new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"])],
  ["/personna/", new Set([".png", ".jpg", ".jpeg", ".webp"])],
  ["/icons/", new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"])],
  ["/assets/", new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"])],
  ["/logo/", new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"])],
  ["/trophet/", new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"])]
]);

function normalizeStaticPath(requestPath) {
  try {
    const decoded = decodeURIComponent(requestPath);
    if (decoded.includes("\0")) return null;
    return path.posix.normalize(`/${decoded.replace(/\\/g, "/").replace(/^\/+/, "")}`).toLowerCase();
  } catch {
    return null;
  }
}

function isPublicStaticPath(requestPath) {
  const p = normalizeStaticPath(requestPath);
  if (!p || PUBLIC_STATIC_ROOT_FILES.has(p)) return !!p;
  for (const [prefix, extensions] of PUBLIC_STATIC_DIRECTORIES) {
    if (!p.startsWith(prefix)) continue;
    return extensions.has(path.posix.extname(p));
  }
  return false;
}

function blockSensitiveFiles(req, res, next) {
  // Only guard non-API GET/HEAD asset requests; API routes are handled above.
  // Express leaves encoded separators such as %2f untouched in req.path, while
  // serve-static decodes them later. Decode and normalize first so a request
  // such as /server%2fcore.js cannot bypass the source-file denylist.
  const p = normalizeStaticPath(req.path);
  if (!p) return res.status(404).send("Not found");
  if (
    BLOCKED_STATIC.has(p) ||
    BLOCKED_STATIC_PREFIXES.some((prefix) => p === prefix.slice(0, -1) || p.startsWith(prefix)) ||
    p.endsWith(".sql") ||
    p.endsWith(".env") ||
    p.endsWith(".md")
  ) {
    return res.status(404).send("Not found");
  }
  next();
}

// ─────────────────────────────────────────────────────────────────
// CORS origin resolution
// ─────────────────────────────────────────────────────────────────
const NATIVE_CORS_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  "sprite-index://app"
]);

function normalizeCorsOrigin(value) {
  if (NATIVE_CORS_ORIGINS.has(value)) return value;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function resolveCorsOrigins() {
  const raw =
    process.env.CORS_ORIGIN || process.env.APP_URL || process.env.OAUTH_REDIRECT_BASE || "http://localhost:3000";
  const configured = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeCorsOrigin)
    .filter(Boolean);
  if (!configured.length) {
    throw new Error("CORS_ORIGIN invalide : configure une ou plusieurs origines http(s), jamais '*'.");
  }
  // Native app (Capacitor) webview origins. The mobile app is a first-party
  // client authenticated by Bearer token, so these fixed origins are always
  // allowed for the JSON API (they never carry ambient cookies).
  return [...new Set([...configured, ...NATIVE_CORS_ORIGINS])];
}

// Public URLs are used in OAuth callbacks, emails and share links. Never build
// them from an incoming Host header: proxies can forward attacker-controlled
// Host values, turning redirects and generated links into phishing vectors.
function resolvePublicAppUrl({ fallback = "http://localhost:3000" } = {}) {
  const candidate =
    process.env.APP_URL || process.env.OAUTH_REDIRECT_BASE || process.env.RENDER_EXTERNAL_URL || fallback;
  try {
    const url = new URL(candidate);
    if (
      !/^https?:$/.test(url.protocol) ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new Error("invalid public app URL");
    }
    return url.origin;
  } catch (err) {
    throw new Error(
      "APP_URL / OAUTH_REDIRECT_BASE invalide : utilise une URL HTTPS en production, sans chemin ni identifiants."
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// Rate limiter (per IP or route-specific identity). Redis is shared between
// instances when REDIS_URL is present; local memory remains the deliberate
// development/single-instance fallback.
// ─────────────────────────────────────────────────────────────────
function positiveEnvInteger(name, fallback, { min = 1, max = 100_000 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  // Do not let a typo such as "NaN", "0" or "10 requests" silently
  // disable a sensitive limiter through JavaScript's NaN comparisons.
  if (!/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

function rateLimit({ windowMs, max, keyPrefix = "rl", message, keyGenerator = null }) {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(max) || max <= 0) {
    throw new Error(`Configuration de limite invalide pour ${keyPrefix}`);
  }
  return async (req, res, next) => {
    // Use Express's req.ip, which honors the app's "trust proxy" setting. This
    // avoids trusting a spoofable X-Forwarded-For header unless the deployment
    // has been explicitly configured to sit behind a trusted proxy.
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const suffix = typeof keyGenerator === "function" ? keyGenerator(req, ip) : ip;
    try {
      const result = await consumeRateLimit({
        prefix: keyPrefix,
        identifier: String(suffix || ip).slice(0, 200),
        windowMs
      });
      if (result.unavailable) {
        return res.status(503).json({ error: "Protection temporairement indisponible. Réessaie dans un instant." });
      }
      if (result.count > max) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        return res.status(429).json({ error: message || "Trop de tentatives, réessaie plus tard." });
      }
      return next();
    } catch (error) {
      console.error(`[rate-limit] Échec inattendu (${keyPrefix}):`, error);
      return res.status(503).json({ error: "Protection temporairement indisponible. Réessaie dans un instant." });
    }
  };
}

// Preconfigured limiters for sensitive routes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "login",
  message: "Trop de tentatives de connexion. Réessaie dans 15 minutes."
});
// Secondary cap keyed on a digest of the email so credential stuffing against
// one inbox is throttled even across many source IPs / proxies.
const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: "login-email",
  message: "Trop de tentatives de connexion. Réessaie dans 15 minutes.",
  keyGenerator: (req) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!email) return "missing-email";
    return crypto.createHash("sha256").update(`login:${email}`).digest("hex").slice(0, 40);
  }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: positiveEnvInteger("REGISTER_RATE_LIMIT_MAX", process.env.NODE_ENV === "production" ? 5 : 500),
  keyPrefix: "register",
  message: "Trop de comptes créés depuis cette adresse. Réessaie plus tard."
});
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyPrefix: "pwreset",
  message: "Trop de demandes de réinitialisation. Réessaie plus tard."
});
const squadCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: positiveEnvInteger("SQUAD_CREATE_RATE_LIMIT_MAX", process.env.NODE_ENV === "production" ? 10 : 100),
  keyPrefix: "squad-create",
  message: "Trop d'escouades créées. Réessaie plus tard."
});
const squadJoinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: positiveEnvInteger("SQUAD_JOIN_RATE_LIMIT_MAX", process.env.NODE_ENV === "production" ? 20 : 200),
  keyPrefix: "squad-join",
  message: "Trop de tentatives pour rejoindre une escouade. Réessaie plus tard."
});
const squadCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  keyPrefix: "squad-code",
  message: "Trop de régénérations de code. Réessaie plus tard."
});
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: "sync",
  message: "Trop de synchronisations. Ralentis un peu."
});
const emailVerifLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyPrefix: "email-verif",
  message: "Trop de renvois d'email. Réessaie plus tard."
});
const oauthExchangeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyPrefix: "oauth-exchange",
  message: "Trop de tentatives OAuth. Réessaie dans quelques minutes."
});
const capabilityLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyPrefix: "capability-link",
  message: "Trop de liens créés. Réessaie plus tard."
});
const pushRegistrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyPrefix: "push-register",
  message: "Trop d'enregistrements d'appareil. Réessaie plus tard."
});
const analyticsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  keyPrefix: "analytics",
  message: "Trop d'événements analytiques. Réessaie plus tard."
});

// ─────────────────────────────────────────────────────────────────
// Zod validation schemas
// ─────────────────────────────────────────────────────────────────
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;
const DISPLAY_NAME_RE = /^[^<>"']{1,50}$/;
const RESERVED_USERNAMES = [
  "admin",
  "administrator",
  "root",
  "support",
  "sprite-index",
  "sprite",
  "api",
  "www",
  "null",
  "undefined"
];

function isReservedUsername(name) {
  const lower = name.toLowerCase();
  return RESERVED_USERNAMES.includes(lower) || lower.startsWith("admin") || lower.includes("@");
}

const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_RE, "Pseudo invalide (3-24 caractères : lettres, chiffres, - _)")
  .refine((v) => !isReservedUsername(v), { message: "Pseudo réservé ou interdit" });

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Nom affiché requis")
  .max(50, "Nom affiché trop long (max 50)")
  .regex(DISPLAY_NAME_RE, "Nom affiché invalide");

const emailSchema = z.string().trim().email("Email invalide").max(254);
const passwordSchema = z.string().min(8, "Mot de passe trop court (min 8)").max(200);
const visibilitySchema = z.enum(["private", "friends", "squad", "public"]);
const legacyPrivacySchema = z.enum(["private", "friends_only", "squad_only", "public"]);
const privacySchema = z.enum(["private", "friends_only", "squad_only", "public"]); // kept for backward compatibility
const friendInvitesFromSchema = z.enum(["everyone", "mutual_squad_members", "nobody"]);
const squadInvitesFromSchema = z.enum(["everyone", "mutual_squad_members", "friends", "nobody"]);
const statusSchema = z.enum(["new", "owned", "missing", "priority", "unsure", "unknown", "unavailable", "spotted"]);
const prioritySchema = z.enum(["none", "urgent", "important", "medium", "low", "ignored"]);
const noteSchema = z.string().max(500).optional();
const squadNameSchema = z.string().trim().min(1).max(50);
const squadCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(30)
  .regex(/^[A-Z0-9\-]+$/i, "Format de code invalide");
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

// Validate raw JSON before Zod builds its output.  Some object constructors
// silently discard __proto__, which would otherwise make a malicious payload
// appear valid while leaving downstream code exposed to unsafe object writes.
function containsUnsafeObjectKey(value) {
  if (!value || typeof value !== "object") return false;
  const seen = new WeakSet();
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const key of Object.keys(current)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) return true;
      const child = current[key];
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return false;
}

function rejectUnsafeBodyKeys(req, res, next) {
  if (containsUnsafeObjectKey(req.body)) {
    return res.status(400).json({ error: "Clé d'objet invalide" });
  }
  return next();
}

function isPrivateOrLocalHostname(value) {
  const host = String(value || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!host) return true;
  // Do not make an application client automatically load a literal IP. This
  // blocks loopback, link-local and private-network probes in addition to
  // avoiding ambiguous IPv6 handling.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return true;
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home") ||
    host.endsWith(".lan") ||
    host.endsWith(".test") ||
    host === "nip.io" ||
    host.endsWith(".nip.io") ||
    host === "sslip.io" ||
    host.endsWith(".sslip.io") ||
    host === "localtest.me" ||
    host.endsWith(".localtest.me")
  );
}

function isSafeRemoteHttpsUrl(value) {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !isPrivateOrLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema.optional(),
  displayName: displayNameSchema.optional(),
  cguAccepted: z.boolean().optional(),
  cguVersion: z.string().max(32).optional(),
  ageConfirmed: z
    .boolean()
    .refine((v) => v === true, { message: "Tu dois avoir au moins 15 ans pour créer un compte." }),
  cookieConsent: z.any().optional()
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200)
});

const forgotPasswordSchema = z
  .object({
    email: emailSchema
  })
  .strict();

const resetPasswordSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/i, "Token invalide"),
    newPassword: passwordSchema
  })
  .strict();

// Avatars come either from the built-in local picker (Personna/*.png|webp) or
// from an OAuth provider's https picture URL. Never accept javascript:/data:
// URIs or arbitrary strings to avoid link-based XSS or open redirect abuse.
const avatarUrlSchema = z
  .string()
  .max(500)
  .refine((val) => val === "" || /^Personna\/[\w\-. ]+\.(png|webp|jpe?g)$/i.test(val) || isSafeRemoteHttpsUrl(val), {
    message: "URL d'avatar invalide"
  });

const visibilityObjectSchema = z
  .object({
    profile: visibilitySchema.optional(),
    collection: visibilitySchema.optional(),
    priorities: visibilitySchema.optional(),
    statistics: visibilitySchema.optional(),
    activity: visibilitySchema.optional(),
    notes: visibilitySchema.optional()
  })
  .strict()
  .optional();

const profilePatchSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: displayNameSchema.optional(),
    avatarUrl: avatarUrlSchema.optional(),
    privacy: legacyPrivacySchema.optional(),
    visibility: visibilityObjectSchema,
    profileVisibility: visibilitySchema.optional(),
    collectionVisibility: visibilitySchema.optional(),
    priorityVisibility: visibilitySchema.optional(),
    notesVisibility: visibilitySchema.optional(),
    friendInvitesFrom: friendInvitesFromSchema.optional(),
    squadInvitesFrom: squadInvitesFromSchema.optional(),
    pushPrefFriendCollectionUpdates: z.boolean().optional(),
    pushPrefFriendPriorityMatches: z.boolean().optional()
  })
  .strict();

const collectionEntrySchema = z
  .object({
    status: statusSchema.optional(),
    note: noteSchema,
    priority: prioritySchema.optional(),
    masteryLevel: z.number().int().min(0).max(5).optional(),
    obtainedAt: z.string().datetime().nullable().optional().or(z.literal(""))
  })
  .strict();

const collectionSyncEntrySchema = z.object({
  status: statusSchema.optional(),
  note: z.string().max(500).optional(),
  priority: prioritySchema.optional(),
  masteryLevel: z.number().int().min(0).max(5).optional(),
  obtainedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

// Local state also stores simple booleans for favorites under "fav_<spriteId>"
// keys, alongside real collection entry objects — accept both shapes.
const collectionSyncValueSchema = z.union([z.boolean(), collectionSyncEntrySchema]);

const collectionSyncSchema = z.object({
  collection: z
    .record(z.string().max(120), collectionSyncValueSchema)
    .refine((obj) => Object.keys(obj).length <= 2000, { message: "Collection trop volumineuse" })
});

const squadCreateSchema = z
  .object({
    name: squadNameSchema.optional()
  })
  .strict(); // userId must come from the session, never from the body

const squadJoinSchema = z
  .object({
    code: squadCodeSchema
  })
  .strict();

const friendSearchSchema = z
  .object({
    q: z.string().trim().min(2).max(50)
  })
  .passthrough();

const friendRequestSchema = z
  .object({
    addresseeId: z.string().trim().min(1).or(z.number()),
    invitationMethod: z.enum(["username", "invite_link", "qr_code", "squad_member", "passport"]).optional(),
    invitationSource: z.string().trim().min(1).max(80).optional(),
    source: z.string().trim().min(1).max(80).optional()
  })
  .strict();

const profileSuspendSchema = z
  .object({
    durationMinutes: z.number().int().min(1).max(525600).optional()
  })
  .strict();

const friendInviteLinkCreateSchema = z
  .object({
    duration: z.enum(["permanent", "24h", "7d", "single_use"])
  })
  .strict();

function validateBody(schema) {
  return (req, res, next) => {
    if (containsUnsafeObjectKey(req.body)) {
      return res.status(400).json({ error: "Clé d'objet invalide" });
    }
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
  isPublicStaticPath,
  resolveCorsOrigins,
  resolvePublicAppUrl,
  positiveEnvInteger,
  isPrivateOrLocalHostname,
  isSafeRemoteHttpsUrl,
  rejectUnsafeBodyKeys,
  rateLimit,
  loginLimiter,
  loginEmailLimiter,
  registerLimiter,
  passwordResetLimiter,
  squadCreateLimiter,
  squadJoinLimiter,
  squadCodeLimiter,
  syncLimiter,
  emailVerifLimiter,
  oauthExchangeLimiter,
  capabilityLinkLimiter,
  pushRegistrationLimiter,
  analyticsLimiter,
  validateBody,
  schemas: {
    registerSchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    profilePatchSchema,
    profileSuspendSchema,
    collectionEntrySchema,
    collectionSyncSchema,
    squadCreateSchema,
    squadJoinSchema,
    friendSearchSchema,
    friendRequestSchema,
    friendInviteLinkCreateSchema,
    usernameSchema,
    displayNameSchema,
    privacySchema,
    friendInvitesFromSchema,
    squadInvitesFromSchema,
    statusSchema,
    prioritySchema
  }
};
