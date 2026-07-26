// ─────────────────────────────────────────────────────────────────
// SPRITNEX — Collector Passport Étapes 86–88
// a11y · analytics · validation criteria
// Needs live server for API cases: npm start, then npm run test:passport
// ─────────────────────────────────────────────────────────────────
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pool } = require("../server/db");
const analytics = require("../analytics");
const PassportRender = require("../js/passport-render");
const { ensurePassportBadgeTables, awardBadgeByCode } = require("../server/passport-badges");

const BASE = process.env.BASE_URL || process.env.APP_URL || "http://localhost:3000";
const API = `${BASE.replace(/\/$/, "")}/api`;

function auth(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function registerUser(prefix) {
  const username = `${prefix}${crypto.randomBytes(2).toString("hex")}`.slice(0, 20);
  const email = `${username}_${Date.now()}@example.com`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "password123",
      username,
      ageConfirmed: true,
      cguAccepted: true
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, username };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`\nRunning SPRITNEX passport étapes 86–88 against ${API}\n`);
  let passed = 0;
  let failed = 0;

  const ok = await run("accessibilité : textes, titres, barre, badges (Étape 86)", async () => {
    assert.strictEqual(
      PassportRender.formatCollectionProgressText(64, 82, 78.1),
      "Progression de la collection : 64 variantes sur 82, soit 78,1 %."
    );
    assert.strictEqual(
      PassportRender.PASSPORT_A11Y.progressExample,
      "Progression de la collection : 64 variantes sur 82, soit 78,1 %."
    );
    assert.match(
      PassportRender.formatBadgeAccessibleName({ label: "Fondateur de squad", status: "unlocked" }),
      /Badge Fondateur de squad, débloqué/
    );
    assert.match(
      PassportRender.formatBadgeAccessibleName({
        label: "75 %",
        status: "locked",
        progressValue: 12,
        targetValue: 20
      }),
      /verrouillé, progression 12 sur 20/
    );

    const html = PassportRender.renderPassportContractHtml({
      user: { username: "a11y_user" },
      collection: { ownedVariantCount: 64, releasedVariantCount: 82, completionRateDisplay: 78.1 },
      badgeProgress: [
        { label: "Première collection", status: "unlocked", badgeCode: "first_collection" },
        { label: "100 %", status: "locked", progressValue: 64, targetValue: 82 }
      ]
    });
    assert.ok(html.includes('role="progressbar"'));
    assert.ok(html.includes('aria-valuetext="Progression de la collection : 64 variantes sur 82, soit 78,1 %."'));
    assert.ok(html.includes('id="passport-progress-text-contract"'));
    assert.ok(html.includes("Progression de la collection : 64 variantes sur 82, soit 78,1 %."));
    assert.ok(html.includes('aria-labelledby="passport-contract-title"'));
    assert.ok(/<h2[^>]*>Passeport du collectionneur<\/h2>/.test(html));
    assert.ok(html.includes('<h3 id="passport-identity-heading">Identité</h3>'));
    assert.ok(html.includes('aria-label="Badge Première collection, débloqué"'));
    assert.ok(html.includes('collector-passport__badge-status">Débloqué'));
    assert.ok(html.includes('collector-passport__badge-status">Verrouillé'));
    assert.ok(html.includes('aria-live="polite"'));
    assert.ok(html.includes('role="list"'));

    const css = fs.readFileSync(path.join(__dirname, "../css/account.css"), "utf8");
    assert.ok(/\.sr-only\s*\{/.test(css));
    assert.ok(css.includes(":focus-visible"));
    assert.ok(css.includes(".collector-passport__progress-text"));

    const accountJs = fs.readFileSync(path.join(__dirname, "../js/account.js"), "utf8");
    assert.ok(accountJs.includes("formatCollectionProgressText"));
    assert.ok(accountJs.includes("aria-valuetext"));
    assert.ok(accountJs.includes("announcePassportStatus"));
    assert.ok(accountJs.includes("logPassportAnalytics"));
  });
  if (ok) passed++; else failed++;

  const ok2 = await run("analytics : événements produit + métriques (Étape 87)", async () => {
    const required = [
      "passport_opened",
      "passport_shared",
      "passport_comparison_started",
      "passport_badge_opened",
      "passport_badge_unlocked",
      "passport_privacy_changed",
      "passport_primary_squad_selected",
      "passport_share_card_generated"
    ];
    for (const event of required) {
      assert.ok(analytics.PRODUCT_ANALYTICS_EVENTS.has(event), `missing ${event}`);
    }
    assert.ok(analytics.PASSPORT_CLIENT_ANALYTICS_EVENTS.has("passport_shared"));
    assert.ok(analytics.PASSPORT_CLIENT_ANALYTICS_EVENTS.has("passport_comparison_started"));
    assert.ok(analytics.PASSPORT_CLIENT_ANALYTICS_EVENTS.has("passport_badge_opened"));

    await analytics.ensureProductAnalyticsTable(pool);
    await ensurePassportBadgeTables();

    const user = await registerUser("p8687");
    const open = await fetch(`${API}/profile/${user.id}/passport`, { headers: auth(user.token) });
    if (!open.ok) throw new Error(`passport open: ${await open.text()}`);

    const clientEv = await fetch(`${API}/analytics/product`, {
      method: "POST",
      headers: auth(user.token),
      body: JSON.stringify({ event: "passport_shared", details: { source: "test" } })
    });
    if (!clientEv.ok) throw new Error(`client analytics: ${await clientEv.text()}`);

    const privacy = await fetch(`${API}/profile/${user.id}/passport/settings`, {
      method: "PATCH",
      headers: auth(user.token),
      body: JSON.stringify({ statisticsVisibility: "friends" })
    });
    if (!privacy.ok) throw new Error(`privacy: ${await privacy.text()}`);

    const card = await fetch(`${API}/passport/share-card`, {
      method: "POST",
      headers: auth(user.token),
      body: JSON.stringify({ format: "1080x1080" })
    });
    if (!card.ok) throw new Error(`share-card: ${await card.text()}`);

    await awardBadgeByCode(user.id, "first_collection", {
      evidence: { source: "test_e87" },
      skipActivity: true
    });

    await new Promise((r) => setTimeout(r, 80));

    const counts = await pool.query(
      `SELECT event_type, COUNT(*)::int AS n
       FROM product_analytics
       WHERE user_id = $1
         AND event_type LIKE 'passport_%'
       GROUP BY event_type`,
      [user.id]
    );
    const byType = Object.fromEntries(counts.rows.map((r) => [r.event_type, r.n]));
    assert.ok((byType.passport_opened || 0) >= 1, "passport_opened missing");
    assert.ok((byType.passport_shared || 0) >= 1, "passport_shared missing");
    assert.ok((byType.passport_privacy_changed || 0) >= 1, "passport_privacy_changed missing");
    assert.ok((byType.passport_share_card_generated || 0) >= 1, "passport_share_card_generated missing");
    assert.ok((byType.passport_badge_unlocked || 0) >= 1, "passport_badge_unlocked missing");

    const metrics = await analytics.getPassportAnalyticsMetrics(pool, { days: 30 });
    assert.ok(typeof metrics.passportsOpened === "number");
    assert.ok(typeof metrics.shareRate === "number");
    assert.ok(typeof metrics.comparisonsStartedFromPassport === "number");
    assert.ok(typeof metrics.usersWhoUnlockedBadge === "number");
    assert.ok(typeof metrics.usersReturningAfterBadge === "number");
    assert.ok(typeof metrics.averageCompletionRate === "number");
    assert.ok(typeof metrics.collectionUpdatesPerUser === "number");

    const product = await analytics.getProductAnalyticsMetrics(pool, { days: 30 });
    assert.ok(product.passport && typeof product.passport.passportsOpened === "number");
  });
  if (ok2) passed++; else failed++;

  const ok3 = await run("validation : checklist prête (Étape 88)", async () => {
    const doc = fs.readFileSync(path.join(__dirname, "../PASSPORT_VALIDATION.md"), "utf8");
    const criteria = [
      "inscription est exacte",
      "Sprites est exact",
      "variantes est exact",
      "complétion est exact",
      "non sortis",
      "versionnés",
      "rareté maximale",
      "squad principale",
      "comparaisons ne sont pas comptées",
      "attribués une seule fois",
      "restent acquis",
      "confidentialité",
      "réglage de visibilité",
      "mobile",
      "cartes partagées"
    ];
    const docLower = doc.toLowerCase();
    for (const c of criteria) {
      assert.ok(docLower.includes(c.toLowerCase()), `missing criterion: ${c}`);
    }
    assert.match(doc, /Étape 86/);
    assert.match(doc, /Étape 87/);
    assert.match(doc, /passport_opened/);
    assert.match(doc, /npm run test:passport/);
    const rows = doc.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    assert.ok(rows.length >= 15, `expected >=15 criteria rows, got ${rows.length}`);
    assert.ok(rows.every((l) => l.includes("✅")), "all criteria should be marked ready");
  });
  if (ok3) passed++; else failed++;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
