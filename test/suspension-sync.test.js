// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Suspension enforcement + import (replace) sync tests
// Run against a live server: node server.js, then node test/suspension-sync.test.js
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
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 ${name}\n      ${err.message}`);
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
    body: JSON.stringify({ email, password: "password123", username, ageConfirmed: true, cguAccepted: true })
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, email, username };
}

async function cleanup(user) {
  if (!user) return;
  await fetch(`${API}/profile/${user.id}`, { method: "DELETE", headers: auth(user.token) }).catch(() => {});
}

async function getTwoVariantIds(token) {
  const res = await fetch(`${API}/sprites`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get sprites failed: ${res.status} ${await res.text()}`);
  const { sprites } = await res.json();
  const ids = [];
  for (const sprite of sprites) {
    for (const variant of Object.values(sprite.variantDetails || {})) {
      if (variant.id) ids.push(variant.id);
      if (ids.length >= 2) return ids;
    }
  }
  assert.ok(ids.length >= 2, "need at least two variant ids");
  return ids;
}

async function setEntry(user, variantId, status) {
  return fetch(`${API}/collection/${user.id}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: auth(user.token),
    body: JSON.stringify({ status })
  });
}

async function getCollection(user) {
  const res = await fetch(`${API}/collection/${user.id}`, { headers: auth(user.token) });
  if (!res.ok) assert.fail(`get collection failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function suspend(user, minutes) {
  return fetch(`${API}/profile/${user.id}/suspend`, {
    method: "POST",
    headers: auth(user.token),
    body: JSON.stringify({ durationMinutes: minutes })
  });
}

async function unsuspend(user) {
  return fetch(`${API}/profile/${user.id}/unsuspend`, { method: "POST", headers: auth(user.token) });
}

async function run() {
  console.log(`\nRunning SPRITE-INDEX suspension + sync tests against ${BASE}\n`);

  const user = await register(`SuspUser${rnd()}`);
  const [v1, v2] = await getTwoVariantIds(user.token);

  // ── Suspension enforcement ──
  await test("active user can write their collection", async () => {
    const res = await setEntry(user, v1, "owned");
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  });

  await test("partial collection updates preserve unspecified fields", async () => {
    const res = await fetch(`${API}/collection/${user.id}/${encodeURIComponent(v1)}`, {
      method: "PUT",
      headers: auth(user.token),
      body: JSON.stringify({ note: "Ne pas perdre le statut" })
    });
    assert.strictEqual(res.status, 200, `partial update failed: ${res.status}: ${await res.text()}`);
    const coll = await getCollection(user);
    assert.strictEqual(coll[v1]?.status, "owned", "an omitted status must not be reset to new");
    assert.strictEqual(coll[v1]?.note, "Ne pas perdre le statut", "the supplied note should be saved");
  });

  await test("suspend succeeds for the owner", async () => {
    const res = await suspend(user, 10);
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${await res.text()}`);
  });

  await test("suspended user cannot write their collection (403)", async () => {
    const res = await setEntry(user, v2, "owned");
    assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
  });

  await test("suspended user cannot create a goal (403)", async () => {
    const res = await fetch(`${API}/collection-goals`, {
      method: "POST",
      headers: auth(user.token),
      body: JSON.stringify({ title: "Test", targetVariantIds: [v1] })
    });
    assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
  });

  await test("suspended user cannot create or join a squad (403)", async () => {
    const owner = await register(`SuspSquadOwner${rnd()}`);
    try {
      const blockedCreate = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(user.token),
        body: JSON.stringify({ name: "Escouade bloquée" })
      });
      assert.strictEqual(blockedCreate.status, 403, `squad create expected 403, got ${blockedCreate.status}`);

      const ownerCreate = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(owner.token),
        body: JSON.stringify({ name: "Escouade de test" })
      });
      if (!ownerCreate.ok) {
        assert.fail(`owner squad create failed: ${ownerCreate.status}: ${await ownerCreate.text()}`);
      }
      const squad = await ownerCreate.json();

      const blockedJoin = await fetch(`${API}/squads/join`, {
        method: "POST",
        headers: auth(user.token),
        body: JSON.stringify({ code: squad.code })
      });
      assert.strictEqual(blockedJoin.status, 403, `squad join expected 403, got ${blockedJoin.status}`);
    } finally {
      await cleanup(owner);
    }
  });

  await test("suspended user cannot accept or decline squad invitations (403)", async () => {
    const paths = [
      "/squads/invitations/999999/accept",
      "/squads/invitations/999999/decline",
      "/squad-invitations/999999/accept",
      "/squad-invitations/999999/decline"
    ];
    for (const path of paths) {
      const res = await fetch(`${API}${path}`, { method: "POST", headers: auth(user.token) });
      assert.strictEqual(res.status, 403, `${path} expected 403, got ${res.status}`);
    }
  });

  await test("suspended user cannot mutate friendships, push, or notification settings (403)", async () => {
    const peer = await register(`SuspPeer${rnd()}`);
    try {
      const friendRequest = await fetch(`${API}/friends/${peer.id}/request`, {
        method: "POST",
        headers: auth(user.token)
      });
      assert.strictEqual(friendRequest.status, 403, `friend request expected 403, got ${friendRequest.status}`);

      const pushPreferences = await fetch(`${API}/push/preferences`, {
        method: "PATCH",
        headers: auth(user.token),
        body: JSON.stringify({ enabled: false })
      });
      assert.strictEqual(pushPreferences.status, 403, `push preferences expected 403, got ${pushPreferences.status}`);

      const notificationPreferences = await fetch(`${API}/notification-preferences`, {
        method: "PATCH",
        headers: auth(user.token),
        body: JSON.stringify({ pushEnabled: false })
      });
      assert.strictEqual(
        notificationPreferences.status,
        403,
        `notification preferences expected 403, got ${notificationPreferences.status}`
      );
    } finally {
      await cleanup(peer);
    }
  });

  await test("suspended user can still call /auth/me and sees suspended flag", async () => {
    const res = await fetch(`${API}/auth/me`, { headers: auth(user.token) });
    assert.strictEqual(res.status, 200, `me should work while suspended, got ${res.status}`);
    const me = await res.json();
    assert.strictEqual(me.suspended, true, "me.suspended should be true");
  });

  await test("owner can unsuspend and write again", async () => {
    const un = await unsuspend(user);
    assert.strictEqual(un.status, 200, `unsuspend failed: ${un.status}`);
    const res = await setEntry(user, v2, "owned");
    assert.strictEqual(res.status, 200, `write after unsuspend failed: ${res.status}`);
  });

  // ── Import is a REPLACE (deletion propagates) ──
  await test("import replaces the collection and removes absent entries", async () => {
    // Start from a known state: v1 + v2 owned.
    await setEntry(user, v1, "owned");
    await setEntry(user, v2, "owned");
    let coll = await getCollection(user);
    assert.ok(coll[v1] && coll[v2], "both entries should exist before import");

    // Import a file that only contains v1 → v2 must be dropped server-side.
    const res = await fetch(`${API}/collection/${user.id}/import`, {
      method: "POST",
      headers: auth(user.token),
      body: JSON.stringify({ collection: { [v1]: { status: "owned" } } })
    });
    assert.strictEqual(res.status, 200, `import failed: ${res.status}: ${await res.text()}`);

    coll = await getCollection(user);
    assert.ok(coll[v1], "v1 should remain after import");
    assert.ok(!coll[v2], "v2 should be removed after import (replace semantics)");
  });

  await cleanup(user);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner crashed:", err.message);
  console.error("Is the server running? Start it with: node server.js");
  process.exit(1);
});
