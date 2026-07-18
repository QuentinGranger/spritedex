// ─────────────────────────────────────────────────────────────────
// SPRITNEX — Compare engine & security regression tests
//
// Lightweight black-box integration tests against a RUNNING server.
//
// Usage:
//   1. Start the server:  node server.js
//   2. Run tests:         node test/compare.test.js
//
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

async function registerUser(username) {
  const email = `cmptest_${rnd()}@example.com`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123", username })
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, email };
}

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function setPrivacy(user, privacy) {
  const res = await fetch(`${API}/profile/${user.id}`, {
    method: "PATCH",
    headers: authHeaders(user.token),
    body: JSON.stringify({ privacy })
  });
  assert.ok(res.ok, `set privacy failed: ${res.status}`);
}

async function setEntry(token, userId, variantId, status) {
  const res = await fetch(`${API}/collection/${userId}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ status })
  });
  assert.ok(res.ok, `setEntry ${variantId} failed: ${res.status}`);
}

async function resetCollection(token, userId) {
  const res = await fetch(`${API}/collection/${userId}`, {
    method: "DELETE",
    headers: authHeaders(token)
  });
  return res.ok;
}

async function compare(aId, bId, token, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${API}/comparisons/users/${aId}/${bId}${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(token)
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function cleanup(user) {
  await fetch(`${API}/profile/${user.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
}

async function run() {
  console.log(`\nRunning SPRITNEX compare tests against ${BASE}\n`);

  const quentin = await registerUser("QuentinCmp");
  const lucy = await registerUser("LucyCmp");

  // Public by default is needed for cross-user comparison
  await setPrivacy(quentin, "public");
  await setPrivacy(lucy, "public");

  // Discover active catalog variants from an empty comparison
  let empty = await compare(quentin.id, lucy.id, quentin.token);
  assert.strictEqual(empty.status, 200, `compare failed: ${JSON.stringify(empty.data)}`);
  const records = empty.data.records || [];
  assert.ok(records.length >= 5, `need at least 5 active variants, got ${records.length}`);

  const vBoth = records[0].variantId;
  const vOnlyA = records[1].variantId;
  const vOnlyB = records[2].variantId;
  const vBothMissing = records[3].variantId;
  const vUnknown = records[4].variantId;

  async function prepare() {
    await resetCollection(quentin.token, quentin.id);
    await resetCollection(lucy.token, lucy.id);
  }

  // ── Engine tests ──
  await test("both owned => bothOwned", async () => {
    await prepare();
    await setEntry(quentin.token, quentin.id, vBoth, "owned");
    await setEntry(lucy.token, lucy.id, vBoth, "owned");
    const { data } = await compare(quentin.id, lucy.id, quentin.token);
    const record = data.records.find(r => r.variantId === vBoth);
    assert.ok(record, "variant not in result");
    assert.strictEqual(record.userA.status, "owned");
    assert.strictEqual(record.userB.status, "owned");
    assert.ok(data.groups.bothOwned.some(r => r.variantId === vBoth), "not grouped as bothOwned");
  });

  await test("only Quentin owned => onlyUserA", async () => {
    await prepare();
    await setEntry(quentin.token, quentin.id, vOnlyA, "owned");
    const { data } = await compare(quentin.id, lucy.id, quentin.token);
    const record = data.records.find(r => r.variantId === vOnlyA);
    assert.ok(record, "variant not in result");
    assert.strictEqual(record.userA.status, "owned");
    assert.notStrictEqual(record.userB.status, "owned");
    assert.ok(data.groups.onlyUserA.some(r => r.variantId === vOnlyA), "not grouped as onlyUserA");
  });

  await test("only Lucy owned => onlyUserB", async () => {
    await prepare();
    await setEntry(lucy.token, lucy.id, vOnlyB, "owned");
    const { data } = await compare(quentin.id, lucy.id, quentin.token);
    const record = data.records.find(r => r.variantId === vOnlyB);
    assert.ok(record, "variant not in result");
    assert.strictEqual(record.userB.status, "owned");
    assert.notStrictEqual(record.userA.status, "owned");
    assert.ok(data.groups.onlyUserB.some(r => r.variantId === vOnlyB), "not grouped as onlyUserB");
  });

  await test("both missing => bothMissing", async () => {
    await prepare();
    await setEntry(quentin.token, quentin.id, vBothMissing, "missing");
    await setEntry(lucy.token, lucy.id, vBothMissing, "missing");
    const { data } = await compare(quentin.id, lucy.id, quentin.token);
    const record = data.records.find(r => r.variantId === vBothMissing);
    assert.ok(record, "variant not in result");
    assert.ok(data.groups.bothMissing.some(r => r.variantId === vBothMissing), "not grouped as bothMissing");
  });

  await test("unknown status is not considered missing", async () => {
    await prepare();
    await setEntry(quentin.token, quentin.id, vUnknown, "new");
    await setEntry(lucy.token, lucy.id, vUnknown, "new");
    const { data } = await compare(quentin.id, lucy.id, quentin.token);
    assert.ok(!data.groups.bothMissing.some(r => r.variantId === vUnknown), "unknown grouped as missing");
    assert.ok(data.groups.unknown.some(r => r.variantId === vUnknown), "unknown not in unknown group");
  });

  await test("unreleased variants are not counted in summary", async () => {
    const { data } = await compare(quentin.id, lucy.id, quentin.token);
    for (const rec of data.records) {
      const release = (rec.releaseStatus || "").toLowerCase();
      assert.ok(!["unreleased", "upcoming", "coming_soon", "soon", "unknown"].includes(release), `unreleased variant in result: ${rec.variantId}`);
    }
  });

  // ── Calculation tests ──
  await test("percentages and complementarity are computed correctly", async () => {
    await prepare();
    // 4 active variants engineered scenario
    await setEntry(quentin.token, quentin.id, vBoth, "owned");
    await setEntry(lucy.token, lucy.id, vBoth, "owned");
    await setEntry(quentin.token, quentin.id, vOnlyA, "owned");
    await setEntry(lucy.token, lucy.id, vOnlyB, "owned");
    await setEntry(quentin.token, quentin.id, vBothMissing, "missing");
    await setEntry(lucy.token, lucy.id, vBothMissing, "missing");
    const { data } = await compare(quentin.id, lucy.id, quentin.token);
    const s = data.summary;
    assert.strictEqual(s.aOwnedCount, 2, "A owned count");
    assert.strictEqual(s.bOwnedCount, 2, "B owned count");
    assert.strictEqual(s.bothOwnedCount, 1, "both owned count");
    assert.strictEqual(s.onlyUserACount, 1, "only A count");
    assert.strictEqual(s.onlyUserBCount, 1, "only B count");
    assert.strictEqual(s.bothMissingCount, 1, "both missing count");
    assert.strictEqual(s.aPossessionRate, 50, "A possession rate");
    assert.strictEqual(s.bPossessionRate, 50, "B possession rate");
    assert.strictEqual(s.collectiveCompletionRate, 75, "collective completion rate");
    assert.strictEqual(s.complementarityRate, +(2 / 3 * 100).toFixed(2), "complementarity rate");
  });

  await test("empty collections are flagged as insufficient data", async () => {
    await prepare();
    const { data } = await compare(quentin.id, lucy.id, quentin.token);
    assert.strictEqual(data.summary.insufficientData, true, "insufficientData should be true");
    assert.ok(!data.groups.bothOwned.length, "no owned rows with empty collections");
  });

  await test("rounding does not produce NaN or negative", async () => {
    const { data } = await compare(quentin.id, lucy.id, quentin.token);
    for (const key of ["aPossessionRate", "bPossessionRate", "collectiveCompletionRate", "complementarityRate"]) {
      const v = data.summary[key];
      assert.ok(typeof v === "number", `${key} is not a number`);
      assert.ok(!Number.isNaN(v), `${key} is NaN`);
      assert.ok(v >= 0, `${key} is negative`);
      assert.ok(v <= 100, `${key} exceeds 100`);
    }
  });

  // ── Security tests ──
  await test("private user cannot be compared", async () => {
    await setPrivacy(lucy, "private");
    const { status } = await compare(quentin.id, lucy.id, quentin.token);
    assert.strictEqual(status, 403, "expected 403 for private user");
    await setPrivacy(lucy, "public");
  });

  await test("friends-only user not befriended cannot be compared", async () => {
    await setPrivacy(lucy, "friends_only");
    const { status } = await compare(quentin.id, lucy.id, quentin.token);
    assert.strictEqual(status, 403, "expected 403 for friends_only user");
    await setPrivacy(lucy, "public");
  });

  await test("compare share link can be created, used and revoked", async () => {
    const createRes = await fetch(`${API}/compare/share`, {
      method: "POST",
      headers: authHeaders(quentin.token),
      body: JSON.stringify({ duration: "1h" })
    });
    assert.ok(createRes.ok, `create compare share failed: ${createRes.status}`);
    const { token: shareToken } = await createRes.json();
    assert.ok(/^[a-f0-9]{64}$/.test(shareToken), "share token is not 256-bit hex");

    const useRes = await fetch(`${API}/compare/share/${shareToken}`, { headers: authHeaders(lucy.token) });
    assert.ok(useRes.ok, `use compare share failed: ${useRes.status}`);
    const useData = await useRes.json();
    assert.ok(useData.result && useData.result.records, "compare share result missing");

    const listRes = await fetch(`${API}/compare/shares`, { headers: authHeaders(quentin.token) });
    assert.ok(listRes.ok, `list shares failed: ${listRes.status}`);
    const listData = await listRes.json();
    assert.ok(Array.isArray(listData.shares), "shares list missing");

    const delRes = await fetch(`${API}/compare/share/${shareToken}`, { method: "DELETE", headers: authHeaders(quentin.token) });
    assert.ok(delRes.ok, `revoke compare share failed: ${delRes.status}`);

    const expiredRes = await fetch(`${API}/compare/share/${shareToken}`, { headers: authHeaders(lucy.token) });
    assert.strictEqual(expiredRes.status, 404, "revoked share token should return 404");
  });

  await test("malformed compare share token is rejected", async () => {
    const res = await fetch(`${API}/compare/share/not-a-token`, { headers: authHeaders(lucy.token) });
    assert.strictEqual(res.status, 400, "malformed token should return 400");
  });

  await test("a player cannot modify another player's collection", async () => {
    const res = await fetch(`${API}/collection/${lucy.id}/${encodeURIComponent(vBoth)}`, {
      method: "PUT",
      headers: authHeaders(quentin.token),
      body: JSON.stringify({ status: "owned" })
    });
    assert.strictEqual(res.status, 403, "cross-user collection write should be rejected");
  });

  // ── Cleanup ──
  await cleanup(quentin);
  await cleanup(lucy);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nTest runner crashed:", err.message);
  console.error("Is the server running? Start it with: node server.js");
  process.exit(1);
});
