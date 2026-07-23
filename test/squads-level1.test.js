// ─────────────────────────────────────────────────────────────────
// SPRITNEX — Squad level 1 completion classification tests
//
// Black-box integration tests against a RUNNING server.
// Run: node test/squads-level1.test.js
// Optional env: BASE_URL (defaults to http://localhost:3000)
// ─────────────────────────────────────────────────────────────────
const assert = require("node:assert");

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

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function registerUser(baseUsername) {
  const username = `${baseUsername}_${rnd()}`;
  const email = `squadl1_${rnd()}@example.com`;
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
  return { id: data.id, token: data.token, email };
}

async function createSquad(token, name) {
  const res = await fetch(`${API}/squads`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  assert.ok(res.ok, `createSquad failed: ${JSON.stringify(data)}`);
  return data;
}

async function inviteToSquad(token, squadId, inviteeId) {
  const res = await fetch(`${API}/squads/${squadId}/invitations`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ inviteeId })
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function acceptSquadInvitation(token, invitationId) {
  const res = await fetch(`${API}/squads/invitations/${invitationId}/accept`, {
    method: "POST",
    headers: authHeaders(token)
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function setEntry(token, userId, variantId, status) {
  const res = await fetch(`${API}/collection/${userId}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ status })
  });
  const data = await res.json();
  assert.ok(res.ok, `setEntry ${variantId} failed: ${JSON.stringify(data)}`);
  return data;
}

async function getVariantSamples(token) {
  const res = await fetch(`${API}/sprites`, { headers: authHeaders(token) });
  const data = await res.json();
  assert.ok(res.ok, `getVariantSamples failed: ${res.status}`);

  const excludedRelease = new Set(["unreleased", "upcoming", "coming_soon", "soon", "unknown"]);
  const active = [];
  const unreleased = [];

  for (const sprite of data.sprites || []) {
    const details = sprite.variantDetails || {};
    for (const variant of Object.values(details)) {
      const release = (variant.releaseStatus || "").toLowerCase();
      const available = variant.available !== false;
      const isActive = available && !excludedRelease.has(release);
      if (isActive) active.push(variant);
      else unreleased.push(variant);
    }
  }

  return { active, unreleased };
}

async function getSquadReport(token, code) {
  const res = await fetch(`${API}/squads/${code}/completion/report`, { headers: authHeaders(token) });
  const data = await res.json();
  assert.ok(res.ok, `getSquadReport failed: ${res.status}`);
  return data;
}

async function getSquadAnalysis(token, code) {
  const res = await fetch(`${API}/squads/${code}/analysis`, { headers: authHeaders(token) });
  const data = await res.json();
  assert.ok(res.ok, `getSquadAnalysis failed: ${res.status}`);
  return data;
}

async function resetCollection(token, userId) {
  const res = await fetch(`${API}/collection/${userId}`, {
    method: "DELETE",
    headers: authHeaders(token)
  });
  return res.ok;
}

function findVariantRow(report, variantId) {
  return report.analysis.allVariants.find(v => v.variantId === variantId || v.id === variantId);
}

async function run() {
  console.log("Squad level 1 completion tests\n");

  // ── setup ──────────────────────────────────────────────────────
  const alice = await registerUser("alice_l1");
  const bob = await registerUser("bob_l1");
  const charlie = await registerUser("charlie_l1");

  const squad = await createSquad(alice.token, "Level1 test squad");
  const bobInv = await inviteToSquad(alice.token, squad.id, bob.id);
  assert.strictEqual(bobInv.status, 201, `invite bob failed: ${JSON.stringify(bobInv.data)}`);
  const bobAccept = await acceptSquadInvitation(bob.token, bobInv.data.id);
  assert.strictEqual(bobAccept.status, 200, `accept bob failed: ${JSON.stringify(bobAccept.data)}`);
  const charlieInv = await inviteToSquad(alice.token, squad.id, charlie.id);
  assert.strictEqual(charlieInv.status, 201, `invite charlie failed: ${JSON.stringify(charlieInv.data)}`);
  const charlieAccept = await acceptSquadInvitation(charlie.token, charlieInv.data.id);
  assert.strictEqual(charlieAccept.status, 200, `accept charlie failed: ${JSON.stringify(charlieAccept.data)}`);

  const samples = await getVariantSamples(alice.token);
  assert.ok(samples.active.length >= 3, "need at least 3 active released variants");

  const [missingVariant, uniqueVariant, sharedVariant] = samples.active.slice(0, 3).map(v => v.id || v.variantId);
  const unreleasedVariant = samples.unreleased[0]?.id || samples.unreleased[0]?.variantId;

  // ── 1. missing ─────────────────────────────────────────────────
  await test("variant without owner is classified as missing", async () => {
    await setEntry(alice.token, alice.id, missingVariant, "missing");
    await setEntry(bob.token, bob.id, missingVariant, "missing");
    await setEntry(charlie.token, charlie.id, missingVariant, "missing");

    const report = await getSquadReport(alice.token, squad.code);
    const row = findVariantRow(report, missingVariant);
    assert.ok(row, `variant ${missingVariant} not present in report`);
    assert.strictEqual(row.ownerCount, 0, `ownerCount should be 0`);
    assert.strictEqual(row.unknownCount, 0, `unknownCount should be 0`);
    assert.strictEqual(row.isMissingAll, true, `isMissingAll should be true`);
  });

  // ── 2. unique ──────────────────────────────────────────────────
  await test("variant with one owner is classified as unique", async () => {
    await resetCollection(alice.token, alice.id);
    await resetCollection(bob.token, bob.id);
    await resetCollection(charlie.token, charlie.id);

    await setEntry(alice.token, alice.id, uniqueVariant, "owned");
    await setEntry(bob.token, bob.id, uniqueVariant, "missing");
    await setEntry(charlie.token, charlie.id, uniqueVariant, "missing");

    const report = await getSquadReport(alice.token, squad.code);
    const row = findVariantRow(report, uniqueVariant);
    assert.ok(row, `variant ${uniqueVariant} not present in report`);
    assert.strictEqual(row.ownerCount, 1, `ownerCount should be 1`);
    assert.strictEqual(row.isUniqueOwner, true, `isUniqueOwner should be true`);
    assert.strictEqual(row.isDuplicate, false, `isDuplicate should be false`);
  });

  // ── 3. shared ──────────────────────────────────────────────────
  await test("variant with several owners is classified as shared", async () => {
    await setEntry(bob.token, bob.id, sharedVariant, "owned");
    await setEntry(charlie.token, charlie.id, sharedVariant, "owned");

    const report = await getSquadReport(alice.token, squad.code);
    const row = findVariantRow(report, sharedVariant);
    assert.ok(row, `variant ${sharedVariant} not present in report`);
    assert.ok(row.ownerCount >= 2, `ownerCount should be >= 2, got ${row.ownerCount}`);
    assert.strictEqual(row.isDuplicate, true, `isDuplicate should be true`);
    assert.strictEqual(row.isUniqueOwner, false, `isUniqueOwner should be false`);
    assert.strictEqual(row.isMissingAll, false, `isMissingAll should be false`);
  });

  // ── 4. unreleased excluded ─────────────────────────────────────
  if (unreleasedVariant) {
    await test("unreleased content is excluded from completion", async () => {
      await setEntry(alice.token, alice.id, unreleasedVariant, "owned");
      await setEntry(bob.token, bob.id, unreleasedVariant, "owned");
      await setEntry(charlie.token, charlie.id, unreleasedVariant, "owned");

      const report = await getSquadReport(alice.token, squad.code);
      const row = findVariantRow(report, unreleasedVariant);
      assert.strictEqual(row, undefined, `unreleased variant ${unreleasedVariant} should not appear in active report`);

      const totalBefore = report.summary.catalogueVariantCount;
      // active variants only : unreleased must not count
      const ownedActiveCount = [uniqueVariant, sharedVariant].length;
      assert.ok(report.summary.coveredVariantCount >= ownedActiveCount, `covered count should include active owned variants`);
      assert.ok(!report.analysis.allVariants.some(v => v.variantId === unreleasedVariant || v.id === unreleasedVariant), `unreleased variant should be excluded`);
    });
  } else {
    console.log("  ⊘ unreleased content is excluded from completion (no unreleased variant found)");
  }

  // ── 5. unknown does not auto become missing ────────────────────
  await test("unknown entries are not automatically marked as missing", async () => {
    await resetCollection(alice.token, alice.id);
    await resetCollection(bob.token, bob.id);
    await resetCollection(charlie.token, charlie.id);

    // bob has an unknown entry, charlie is missing, alice has nothing
    await setEntry(bob.token, bob.id, missingVariant, "wanted");
    await setEntry(charlie.token, charlie.id, missingVariant, "missing");

    const report = await getSquadReport(alice.token, squad.code);
    const row = findVariantRow(report, missingVariant);
    assert.ok(row, `variant ${missingVariant} should be present`);
    assert.strictEqual(row.isMissingAll, false, `isMissingAll should be false because of unknown entry`);
    assert.strictEqual(row.unknownCount >= 1, true, `unknownCount should be >= 1`);
  });

  // ── 6. collective rate exact ───────────────────────────────────
  await test("collective completion rate is exact", async () => {
    await resetCollection(alice.token, alice.id);
    await resetCollection(bob.token, bob.id);
    await resetCollection(charlie.token, charlie.id);

    // Use two distinct active variants : both owned by all members => 100%
    const v1 = samples.active[0].id || samples.active[0].variantId;
    const v2 = samples.active[1].id || samples.active[1].variantId;
    await setEntry(alice.token, alice.id, v1, "owned");
    await setEntry(alice.token, alice.id, v2, "owned");

    const report = await getSquadReport(alice.token, squad.code);
    const rate = report.summary.collectiveCompletionRate;
    const expected = 100;
    assert.strictEqual(rate, expected, `collective completion rate should be ${expected}%, got ${rate}`);
  });

  // ── cleanup ────────────────────────────────────────────────────
  // reset collections only (accounts will be deleted by DB reset in CI)
  await resetCollection(alice.token, alice.id);
  await resetCollection(bob.token, bob.id);
  await resetCollection(charlie.token, charlie.id);

  console.log(`\nRésultats : ${passed} passés, ${failed} échoués`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
