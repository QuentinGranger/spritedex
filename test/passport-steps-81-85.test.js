// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Collector Passport Étapes 81–85
// Needs live server: npm start, then npm run test:passport
// ─────────────────────────────────────────────────────────────────
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pool } = require("../server/db");
const {
  syncEventCollectionVersions,
  recordEventCompletions,
  getEventProgressSections,
  groupReleasedVariantsByEvent,
  sameVariantSet
} = require("../server/passport-achievements");
const {
  ensurePassportBadgeTables,
  meetsCompletionThreshold,
  evaluateBadgeCondition,
  listBadgeDefinitions,
  listUserBadges,
  awardBadgeByCode,
  maybeAwardSquadFounder,
  recordCatalogueReview,
  evaluateArchivistQualified,
  evaluateEarlyCollectorQualified,
  evaluateAllRaritiesOwned,
  evaluateAndAwardComplementaryBadge,
  EARLY_COLLECTOR_BEFORE
} = require("../server/passport-badges");
const { evaluateUserBadges } = require("../server/badge-engine");
const {
  ensurePassportActivityTable,
  recordOwnedVariants,
  listRecentActivity,
  writeActivity,
  purgeExpiredActivity,
  ACTIVITY_FEED_LIMIT,
  ACTIVITY_RETENTION_DAYS
} = require("../server/passport-activity");
const { canViewPassportSection } = require("../server/auth");
const { isVariantReleasedAndActiveServer } = require("../server/compare");
const PassportRender = require("../js/passport-render");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = `${BASE}/api`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}

function rnd() {
  return Math.random().toString(36).slice(2, 10);
}

function auth(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function register(username) {
  const email = `${username}_${rnd()}@example.com`;
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
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, username };
}

async function cleanup(user) {
  if (!user) return;
  await fetch(`${API}/profile/${user.id}`, { method: "DELETE", headers: auth(user.token) }).catch(() => {});
}

async function getPassport(token, userId) {
  const res = await fetch(`${API}/profile/${userId}/passport`, { headers: auth(token) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function setEntry(token, userId, variantId, status) {
  const res = await fetch(`${API}/collection/${userId}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ status })
  });
  if (!res.ok) throw new Error(`setEntry failed: ${await res.text()}`);
}

async function patchPassportSettings(token, userId, body) {
  const res = await fetch(`${API}/profile/${userId}/passport/settings`, {
    method: "PATCH",
    headers: auth(token),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function befriend(a, b) {
  await fetch(`${API}/friends/${b.id}/request`, { method: "POST", headers: auth(a.token) });
  await fetch(`${API}/friends/${a.id}/accept`, { method: "POST", headers: auth(b.token) });
}

async function run() {
  console.log(`\nRunning SPRITE-INDEX passport étapes 81–85 against ${BASE}\n`);
  await ensurePassportBadgeTables(pool);
  await ensurePassportActivityTable(pool);

  // ── Étape 81 — events ──────────────────────────────────────────
  await test("événements : complétion, version, idempotence (Étape 81)", async () => {
    const user = await register(`Ev81${rnd()}`);
    const eventId = `ev81_${rnd()}`;
    try {
      await pool.query(
        `INSERT INTO events (id, name, start_date, end_date)
         VALUES ($1, $2, NOW() - INTERVAL '7 days', NOW() + INTERVAL '7 days')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [eventId, "Test Event 81"]
      );

      const vLive = "ev81_live";
      const vUnreleased = "ev81_unreleased";
      const catalogueV1 = [
        {
          id: vLive,
          eventId,
          releaseStatus: "released",
          dataStatus: "active",
          spriteId: "s81"
        },
        {
          id: vUnreleased,
          eventId,
          releaseStatus: "unreleased",
          dataStatus: "active",
          spriteId: "s81b"
        }
      ];
      // Only released+active items should be versioned (mirror passport filter).
      const forSync = catalogueV1.filter(isVariantReleasedAndActiveServer);
      assert.strictEqual(forSync.length, 1);
      assert.ok(!groupReleasedVariantsByEvent(forSync).get(eventId)?.has(vUnreleased));

      await syncEventCollectionVersions(forSync);
      const ver1 = await pool.query(
        `SELECT id, version, required_variant_ids, ended_at
         FROM event_collection_versions WHERE event_id = $1 ORDER BY version ASC`,
        [eventId]
      );
      assert.ok(ver1.rows.length >= 1);
      const required = ver1.rows[0].required_variant_ids;
      assert.ok(sameVariantSet(required, [vLive]));
      assert.ok(!required.includes(vUnreleased), "unreleased must not be required");

      // Not complete yet.
      let newly = await recordEventCompletions(user.id, new Set(), "cat-v1", { notify: false });
      assert.strictEqual(newly.length, 0);

      newly = await recordEventCompletions(user.id, new Set([vLive]), "cat-v1", { notify: false });
      assert.strictEqual(newly.length, 1);
      assert.strictEqual(newly[0].eventId, eventId);

      // Idempotent — second call must not re-insert.
      const again = await recordEventCompletions(user.id, new Set([vLive]), "cat-v1", { notify: false });
      assert.strictEqual(again.length, 0);

      const count = await pool.query(
        `SELECT COUNT(*)::int AS c FROM user_event_completions
         WHERE user_id = $1 AND event_id = $2`,
        [user.id, eventId]
      );
      assert.strictEqual(count.rows[0].c, 1);

      // New catalogue variant for same event → new version; historical completion kept.
      const catalogueV2 = [
        { id: vLive, eventId, releaseStatus: "released", dataStatus: "active", spriteId: "s81" },
        { id: "ev81_new", eventId, releaseStatus: "released", dataStatus: "active", spriteId: "s81c" }
      ];
      await syncEventCollectionVersions(catalogueV2.filter(isVariantReleasedAndActiveServer));
      const vers = await pool.query(
        `SELECT id, version, ended_at FROM event_collection_versions
         WHERE event_id = $1 ORDER BY version ASC`,
        [eventId]
      );
      assert.ok(vers.rows.length >= 2);
      assert.ok(vers.rows[0].ended_at, "old version must be closed");
      assert.ok(!vers.rows[vers.rows.length - 1].ended_at);

      const sections = await getEventProgressSections(user.id, new Set([vLive]));
      assert.ok(
        sections.completedCount >= 1 ||
          (sections.historical || []).length >= 1 ||
          (sections.completed || []).length >= 1
      );
      // Historical accomplishment not revoked.
      const still = await pool.query(
        `SELECT 1 FROM user_event_completions WHERE user_id = $1 AND event_id = $2 LIMIT 1`,
        [user.id, eventId]
      );
      assert.ok(still.rows.length, "historical completion must remain");
    } finally {
      await pool.query("DELETE FROM user_event_completions WHERE event_id = $1", [eventId]).catch(() => {});
      await pool.query("DELETE FROM event_collection_versions WHERE event_id = $1", [eventId]).catch(() => {});
      await pool.query("DELETE FROM events WHERE id = $1", [eventId]).catch(() => {});
      await cleanup(user);
    }
  });

  // ── Étape 82 — badges ──────────────────────────────────────────
  await test("badges : seuils, arrondis, doublons, anti-abus (Étape 82)", async () => {
    const defs = await listBadgeDefinitions();
    const codes = defs.map((d) => d.code);
    for (const code of [
      "first_collection",
      "collection_25",
      "collection_50",
      "collection_75",
      "collection_100",
      "squad_founder",
      "complementary_collection",
      "archivist",
      "early_collector",
      "all_rarities",
      "event_completed"
    ]) {
      assert.ok(codes.includes(code), `missing badge def ${code}`);
    }

    assert.ok(meetsCompletionThreshold(75, 75));
    assert.ok(meetsCompletionThreshold(75.001, 75));
    assert.ok(!meetsCompletionThreshold(74.999, 75), "display round-up must not unlock");
    assert.ok(!meetsCompletionThreshold(24.999, 25));
    assert.ok(meetsCompletionThreshold(25, 25));
    assert.ok(meetsCompletionThreshold(100, 100));

    const ctx75 = {
      ownedVariantCount: 1,
      discoveredSpriteCount: 1,
      completionRatePrecise: 74.999,
      reliabilityLevel: "usable"
    };
    assert.ok(!evaluateBadgeCondition({ type: "completion_rate", min: 75 }, ctx75));
    ctx75.completionRatePrecise = 75;
    assert.ok(evaluateBadgeCondition({ type: "completion_rate", min: 75 }, ctx75));
    assert.ok(evaluateBadgeCondition({ type: "owned_variant_count", min: 1 }, { ownedVariantCount: 1 }));

    const user = await register(`Bd82${rnd()}`);
    try {
      await setEntry(user.token, user.id, `tmp_${rnd()}`, "owned").catch(() => {});
      // Multi-eval must not duplicate first_collection.
      await evaluateUserBadges(user.id, "collection.updated", { notify: false });
      await evaluateUserBadges(user.id, "collection.updated", { notify: false });
      await awardBadgeByCode(user.id, "first_collection", {
        evidence: { catalogueVersion: "dup-test" }
      });
      const badges = await listUserBadges(user.id);
      const firsts = badges.filter((b) => b.code === "first_collection" || b.id === "first_collection");
      assert.ok(firsts.length <= 1, "no duplicate first_collection");

      // Complementary anti-abuse: no social / suspended.
      const peer = await register(`Bd82p${rnd()}`);
      try {
        const fakeCompare = {
          summary: {
            insufficientData: false,
            catalogueVariantCount: 100,
            aEnteredCount: 90,
            bEnteredCount: 90,
            onlyUserACount: 8,
            onlyUserBCount: 8,
            aOwnedCount: 40,
            bOwnedCount: 40,
            collectiveOwnedCount: 55
          }
        };
        let comp = await evaluateAndAwardComplementaryBadge(user.id, peer.id, fakeCompare);
        assert.ok(["no_social_link", "account_too_recent"].includes(comp.skippedReason));

        await pool.query("UPDATE users SET suspended_until = NOW() + INTERVAL '1 hour' WHERE id = $1", [user.id]);
        comp = await evaluateAndAwardComplementaryBadge(user.id, peer.id, fakeCompare);
        assert.strictEqual(comp.skippedReason, "suspended");
        await pool.query("UPDATE users SET suspended_until = NULL, suspended_at = NULL WHERE id = $1", [user.id]);

        // Early collector: suspended → false
        await pool.query(
          `UPDATE users SET created_at = $2::timestamptz, email_verified = TRUE,
             suspended_until = NOW() + INTERVAL '1 hour' WHERE id = $1`,
          [user.id, new Date(new Date(EARLY_COLLECTOR_BEFORE).getTime() - 86400000).toISOString()]
        );
        assert.ok(!(await evaluateEarlyCollectorQualified(user.id)));
        await pool.query("UPDATE users SET suspended_until = NULL WHERE id = $1", [user.id]);

        // Archivist: 3 reviews
        await recordCatalogueReview(user.id, "arch-v1", 95);
        await recordCatalogueReview(user.id, "arch-v2", 96);
        await recordCatalogueReview(user.id, "arch-v3", 97);
        assert.ok(await evaluateArchivistQualified(user.id, { minVersions: 3, maxGapDays: 365 }));

        // all_rarities unit
        const catalogue = ["common", "uncommon", "rare", "epic", "legendary", "mythic"].map((r, i) => ({
          id: `r${i}`,
          rarity: r,
          variantType: "Base"
        }));
        const ownedAll = new Set(catalogue.map((c) => c.id));
        assert.ok(evaluateAllRaritiesOwned(catalogue, ownedAll).qualified);
        assert.ok(!evaluateAllRaritiesOwned(catalogue, new Set(["r0"])).qualified);

        // Squad founder: create + other member + backdate 24h
        const founder = await register(`Bd82f${rnd()}`);
        const member = await register(`Bd82m${rnd()}`);
        try {
          const create = await fetch(`${API}/squads`, {
            method: "POST",
            headers: auth(founder.token),
            body: JSON.stringify({ name: `Founder ${rnd()}` })
          });
          const squad = await create.json();
          assert.ok(create.ok, JSON.stringify(squad));
          const squadId = squad.id;
          await pool.query("UPDATE squads SET created_at = NOW() - INTERVAL '25 hours' WHERE id = $1", [squadId]);
          // Join member via SQL (active)
          await pool.query(
            `INSERT INTO squad_members (squad_id, user_id, role, status)
             VALUES ($1, $2, 'member', 'active')
             ON CONFLICT (squad_id, user_id) DO UPDATE SET status = 'active'`,
            [squadId, member.id]
          );
          const awarded = await maybeAwardSquadFounder(founder.id);
          assert.ok(awarded, "squad_founder should unlock");
          const againFounder = await maybeAwardSquadFounder(founder.id);
          assert.ok(!againFounder || againFounder === null || againFounder.badge_code, "idempotent founder");
          const founderBadges = await listUserBadges(founder.id);
          assert.strictEqual(founderBadges.filter((b) => b.code === "squad_founder").length, 1);
        } finally {
          await cleanup(founder);
          await cleanup(member);
        }
      } finally {
        await cleanup(peer);
      }
    } finally {
      await cleanup(user);
    }
  });

  // ── Étape 83 — privacy ─────────────────────────────────────────
  await test("confidentialité : privé, ami, squad, blocage, carte, URL (Étape 83)", async () => {
    const owner = await register(`Pr83o${rnd()}`);
    const friend = await register(`Pr83f${rnd()}`);
    const squadMate = await register(`Pr83s${rnd()}`);
    const stranger = await register(`Pr83x${rnd()}`);
    try {
      await patchPassportSettings(owner.token, owner.id, {
        passportVisibility: "private",
        statisticsVisibility: "private",
        badgesVisibility: "private",
        activityVisibility: "private",
        comparisonsVisibility: "private"
      });
      assert.strictEqual((await getPassport(friend.token, owner.id)).status, 404);
      assert.strictEqual((await getPassport(stranger.token, owner.id)).status, 404);
      assert.ok(!(await canViewPassportSection(friend.id, owner.id, "passport")));

      await befriend(owner, friend);
      await patchPassportSettings(owner.token, owner.id, {
        passportVisibility: "friends",
        statisticsVisibility: "friends",
        badgesVisibility: "private",
        activityVisibility: "friends",
        comparisonsVisibility: "private"
      });
      const friendView = await getPassport(friend.token, owner.id);
      assert.strictEqual(friendView.status, 200);
      assert.ok(friendView.data.collection, "friend sees statistics");
      assert.strictEqual(friendView.data.permissions.badges, false);
      assert.ok(Array.isArray(friendView.data.badges));
      assert.strictEqual(friendView.data.badges.length, 0);
      assert.strictEqual(friendView.data.social.comparisonCount, null);

      // Squad mate who is NOT a friend: activity friends-only must stay hidden.
      const create = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(owner.token),
        body: JSON.stringify({ name: `Priv ${rnd()}` })
      });
      const squad = await create.json();
      if (!create.ok) throw new Error(await create.text());
      await pool.query(
        `INSERT INTO squad_members (squad_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'active')
         ON CONFLICT (squad_id, user_id) DO UPDATE SET status = 'active'`,
        [squad.id, squadMate.id]
      );
      await patchPassportSettings(owner.token, owner.id, {
        passportVisibility: "public",
        activityVisibility: "friends",
        statisticsVisibility: "public",
        badgesVisibility: "public"
      });
      assert.ok(await canViewPassportSection(squadMate.id, owner.id, "passport"));
      assert.ok(
        !(await canViewPassportSection(squadMate.id, owner.id, "activity")),
        "squad member must not see friends-only activity"
      );

      // Block
      const block = await fetch(`${API}/users/${owner.id}/block`, {
        method: "POST",
        headers: auth(stranger.token)
      });
      if (![200, 201, 409].includes(block.status)) {
        throw new Error(`block failed: ${block.status} ${await block.text()}`);
      }
      await patchPassportSettings(owner.token, owner.id, { passportVisibility: "public" });
      const blockedView = await getPassport(stranger.token, owner.id);
      assert.strictEqual(blockedView.status, 404);

      // Share card — no private fields
      const card = await fetch(`${API}/passport/share-card`, {
        method: "POST",
        headers: auth(owner.token),
        body: JSON.stringify({ showSquad: true, showBadges: true })
      });
      assert.strictEqual(card.status, 200);
      const cardData = await card.json();
      const blob = JSON.stringify(cardData);
      assert.ok(!blob.includes("@example.com"));
      assert.ok(!("email" in cardData));
      assert.ok(!("friends" in cardData));
      assert.ok(!("notes" in cardData));
      assert.ok(!("recentActivity" in cardData));

      // Old username URL must not bypass permissions
      const oldName = owner.username;
      const newName = `ren83_${rnd()}`.slice(0, 20);
      await fetch(`${API}/profile/${owner.id}`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({ username: newName })
      });
      owner.username = newName;
      await patchPassportSettings(owner.token, owner.id, { passportVisibility: "private" });
      const oldUrl = await fetch(`${API}/u/${encodeURIComponent(oldName)}/passport`, { redirect: "manual" });
      // Redirect to new slug, then private → still inaccessible to stranger
      if ([301, 302, 307, 308].includes(oldUrl.status)) {
        const loc = oldUrl.headers.get("location") || "";
        assert.ok(loc.includes(`/u/${encodeURIComponent(newName)}`) || loc.includes(newName));
      }
      const afterRedirect = await fetch(`${API}/u/${encodeURIComponent(newName)}/passport`);
      assert.ok([401, 404].includes(afterRedirect.status), "private passport stays closed via public URL");
    } finally {
      await cleanup(owner);
      await cleanup(friend);
      await cleanup(squadMate);
      await cleanup(stranger);
    }
  });

  // ── Étape 84 — activity ────────────────────────────────────────
  await test("activité : regroupement, limite, expiration, visibilité (Étape 84)", async () => {
    const owner = await register(`Act84${rnd()}`);
    const friend = await register(`Act84f${rnd()}`);
    try {
      await befriend(owner, friend);
      await patchPassportSettings(owner.token, owner.id, {
        passportVisibility: "friends",
        activityVisibility: "friends",
        showLastActivity: true
      });

      await recordOwnedVariants(owner.id, ["a1", "a2", "a3", "a4", "a5"], { visibility: "friends" });
      await recordOwnedVariants(owner.id, ["a6", "a7"], { visibility: "friends" });
      let feed = await listRecentActivity(owner.id, { limit: 50 });
      const owned = feed.filter((a) => a.activityType === "variants_owned");
      assert.ok(owned.length >= 1);
      assert.ok(owned[0].data.count >= 5, "imports must group");
      assert.ok(!JSON.stringify(owned[0].data).includes("@"), "no email in activity");
      assert.ok(!("note" in (owned[0].data || {})));
      assert.ok(!("token" in (owned[0].data || {})));

      // Fill beyond limit
      for (let i = 0; i < 15; i++) {
        await writeActivity({
          userId: owner.id,
          activityType: "completion_milestone",
          data: { percent: 10 + i },
          visibility: "friends",
          occurredAt: new Date(Date.now() - i * 1000).toISOString()
        });
      }
      feed = await listRecentActivity(owner.id, { limit: ACTIVITY_FEED_LIMIT });
      assert.ok(feed.length <= ACTIVITY_FEED_LIMIT);

      const pass = await getPassport(friend.token, owner.id);
      assert.ok(pass.status === 200);
      assert.ok((pass.data.recentActivity || []).length <= 25);

      // Private activity hidden from friend
      await writeActivity({
        userId: owner.id,
        activityType: "badge_unlocked",
        data: { label: "Secret", email: "should-not-leak@example.com" },
        visibility: "private"
      });
      const friendPass = await getPassport(friend.token, owner.id);
      const labels = (friendPass.data.recentActivity || []).map((a) => JSON.stringify(a));
      assert.ok(!labels.some((s) => s.includes("Secret") && s.includes("private")));
      assert.ok(!labels.some((s) => s.includes("should-not-leak")));

      // Expiry
      await writeActivity({
        userId: owner.id,
        activityType: "squad_joined",
        data: { squadName: "ExpiredSquad" },
        visibility: "public",
        expiresAt: new Date(Date.now() - 60_000).toISOString()
      });
      feed = await listRecentActivity(owner.id, { limit: 50 });
      assert.ok(!feed.some((a) => a.data && a.data.squadName === "ExpiredSquad"));
      await purgeExpiredActivity(pool);
      const leftover = await pool.query(
        `SELECT 1 FROM passport_activity
         WHERE user_id = $1 AND data->>'squadName' = 'ExpiredSquad'`,
        [owner.id]
      );
      assert.strictEqual(leftover.rows.length, 0);

      // Click destinations (Étape 84)
      assert.deepStrictEqual(PassportRender.passportActionDestination("open-filter").view, "checklist");
      assert.deepStrictEqual(PassportRender.passportActionDestination("event-missing").view, "checklist");
      assert.ok(PassportRender.passportActionDestination("compare_collections").view === "social");
      assert.ok(ACTIVITY_RETENTION_DAYS >= 30);
    } finally {
      await cleanup(owner);
      await cleanup(friend);
    }
  });

  // ── Étape 85 — UI contracts ────────────────────────────────────
  await test("interface : viewports, vides, noms longs, badges, squads (Étape 85)", () => {
    const accountCss = fs.readFileSync(path.join(__dirname, "../css/account.css"), "utf8");
    const css = [
      accountCss,
      ...[...accountCss.matchAll(/@import url\("\.\/account\/([^\"]+)"\);/g)].map((match) =>
        fs.readFileSync(path.join(__dirname, "../css/account", match[1]), "utf8")
      )
    ].join("\n");
    assert.ok(css.includes("@media (max-width: 480px)"), "phone breakpoint");
    assert.ok(css.includes("@media (min-width: 481px) and (max-width: 1023px)"), "tablet breakpoint");
    assert.ok(css.includes("@media (min-width: 1024px)"), "desktop breakpoint");
    assert.strictEqual(PassportRender.PASSPORT_VIEWPORTS.phone.maxWidth, 480);
    assert.strictEqual(PassportRender.PASSPORT_VIEWPORTS.desktop.minWidth, 1024);

    const longName = `User_${"x".repeat(80)}_fin`;
    const manyBadges = Array.from({ length: 40 }, (_, i) => ({
      label: `Badge très long ${i} — ${"★".repeat(20)}`,
      badgeCode: `b${i}`,
      status: "unlocked"
    }));

    for (const viewport of ["phone", "tablet", "desktop"]) {
      const html = PassportRender.renderPassportContractHtml(
        {
          user: { username: longName, displayName: longName },
          collection: { ownedVariantCount: 0, completionRateDisplay: 0, catalogueVersion: "2026.07.26-1" },
          badgeProgress: manyBadges,
          primarySquad: null,
          availableSquads: []
        },
        { viewport, showReliabilityWarning: true }
      );

      assert.ok(html.includes(`data-viewport="${viewport}"`));
      assert.ok(html.includes("Collection vide"));
      assert.ok(html.includes("Aucune squad principale"));
      assert.ok(html.includes("Collection déclarée par l’utilisateur"));
      assert.ok(html.includes("Calculé à partir de la collection déclarée"));
      assert.ok(!html.includes("<script"));
      assert.ok(html.includes("…") || html.length < longName.length + 500, "long name truncated in UI");
      assert.ok(html.includes('data-badge-count="40"'));
    }

    const multiSquad = PassportRender.renderPassportContractHtml(
      {
        user: { username: "multi" },
        collection: { ownedVariantCount: 3, completionRateDisplay: 12.5 },
        primarySquad: { name: "Bravo Six", private: false },
        availableSquads: [{ id: 1 }, { id: 2 }, { id: 3 }],
        badges: [{ label: "Première collection" }]
      },
      { viewport: "desktop" }
    );
    assert.ok(multiSquad.includes("Bravo Six"));

    const privateSquad = PassportRender.renderPassportContractHtml({
      user: { username: "x" },
      collection: { ownedVariantCount: 1, completionRateDisplay: 1 },
      primarySquad: { private: true }
    });
    assert.ok(privateSquad.includes("Squad privée"));

    const partial = PassportRender.renderPassportContractHtml({
      user: { username: "partial" },
      collection: null,
      badges: []
    });
    assert.ok(partial.includes("Statistiques masquées"));

    const longFr = PassportRender.renderPassportContractHtml(
      {
        user: { username: "fr" },
        collection: { ownedVariantCount: 1, completionRateDisplay: 12.5 }
      },
      {
        showReliabilityWarning: true,
        longCopy: "Cette collection n’est renseignée qu’à 12,5 %. Certaines statistiques peuvent être incomplètes."
      }
    );
    assert.ok(longFr.includes("12,5"));
    assert.ok(
      PassportRender.passportActivityLabel({
        activityType: "variants_owned",
        data: { count: 12 }
      }).includes("12")
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nTest runner crashed:", err);
  process.exit(1);
});
