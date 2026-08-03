// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Variant mastery persistence regression tests
// Run against a live server: node server.js, then node test/mastery.test.js
// ─────────────────────────────────────────────────────────────────
const assert = require("node:assert");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = `${BASE}/api`;

function randomToken() {
  return Math.random().toString(36).slice(2, 10);
}

function headers(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function register() {
  const nonce = randomToken();
  const response = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `mastery_${nonce}@example.com`,
      password: "password123",
      username: `Mastery${nonce}`,
      ageConfirmed: true,
      cguAccepted: true
    })
  });
  const body = await response.json();
  assert.ok(response.ok, `registration failed: ${JSON.stringify(body)}`);
  return { id: body.id, token: body.token };
}

async function firstVariantId(token) {
  const response = await fetch(`${API}/sprites`, { headers: headers(token) });
  const body = await response.json();
  assert.ok(response.ok, `catalogue fetch failed: ${JSON.stringify(body)}`);
  for (const sprite of body.sprites || []) {
    const variant = Object.values(sprite.variantDetails || {}).find((item) => item?.id);
    if (variant) return variant.id;
  }
  assert.fail("the catalogue did not contain a variant id");
}

async function entry(user, variantId, patch) {
  const response = await fetch(`${API}/collection/${user.id}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: headers(user.token),
    body: JSON.stringify(patch)
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function collection(user) {
  const response = await fetch(`${API}/collection/${user.id}`, { headers: headers(user.token) });
  const body = await response.json();
  assert.ok(response.ok, `collection fetch failed: ${JSON.stringify(body)}`);
  return body;
}

async function cleanup(user) {
  if (!user) return;
  await fetch(`${API}/profile/${user.id}`, {
    method: "DELETE",
    headers: headers(user.token)
  }).catch(() => {});
}

async function run() {
  console.log(`\nRunning SPRITE-INDEX mastery tests against ${BASE}\n`);
  let user;
  try {
    user = await register();
    const variantId = await firstVariantId(user.token);

    let result = await entry(user, variantId, { status: "owned", masteryLevel: 5 });
    assert.strictEqual(result.response.status, 200, `Master write failed: ${JSON.stringify(result.body)}`);
    assert.strictEqual(result.body.masteryLevel, 5, "the write response must confirm Master level");
    assert.strictEqual(
      (await collection(user))[variantId]?.masteryLevel,
      5,
      "Master level must persist in GET collection"
    );
    console.log("  ✓ owned variant persists level 5 (Master)");

    result = await entry(user, variantId, { status: "missing" });
    assert.strictEqual(result.response.status, 200, `status change failed: ${JSON.stringify(result.body)}`);
    assert.strictEqual((await collection(user))[variantId]?.masteryLevel, 0, "non-owned variants must have level 0");
    console.log("  ✓ losing ownership clears mastery to level 0");

    result = await entry(user, variantId, { status: "missing", masteryLevel: 3 });
    assert.strictEqual(result.response.status, 400, "a non-owned variant cannot receive a mastery level");
    console.log("  ✓ invalid non-owned mastery is rejected");

    const syncResponse = await fetch(`${API}/collection/${user.id}/sync`, {
      method: "POST",
      headers: headers(user.token),
      body: JSON.stringify({ collection: { [variantId]: { status: "owned", masteryLevel: 4 } } })
    });
    assert.strictEqual(syncResponse.status, 200, `sync failed: ${await syncResponse.text()}`);
    assert.strictEqual((await collection(user))[variantId]?.masteryLevel, 4, "bulk sync must persist mastery");
    console.log("  ✓ bulk sync persists mastery");
  } finally {
    await cleanup(user);
  }
}

run().catch((error) => {
  console.error(`  ✗ ${error.message}`);
  process.exitCode = 1;
});
