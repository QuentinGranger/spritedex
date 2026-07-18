// ─────────────────────────────────────────────────────────────────
// SPRITNEX — Security regression tests
//
// These are lightweight black-box integration tests that hit a RUNNING
// server. They verify the authorization / access-control fixes stay in place.
//
// Usage:
//   1. Start the server in one terminal:   node server.js
//   2. In another terminal, run:           node test/security.test.js
//
// Optional env: BASE_URL (defaults to http://localhost:3000)
//
// The tests create two throwaway users, exercise the security boundaries,
// then delete both users so the database is left clean.
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

async function registerUser() {
  const email = `sectest_${rnd()}@example.com`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123", username: `Sec${rnd()}` })
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, email };
}

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function run() {
  console.log(`\nRunning SPRITNEX security tests against ${BASE}\n`);

  const userA = await registerUser();
  const userB = await registerUser();

  // ── Authentication ──
  await test("unauthenticated collection write is rejected (403)", async () => {
    const res = await fetch(`${API}/collection/${userA.id}/water::Gold`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "owned" })
    });
    assert.strictEqual(res.status, 403);
  });

  await test("spoofed x-user-id header does NOT grant access (403)", async () => {
    const res = await fetch(`${API}/collection/${userA.id}/water::Gold`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": String(userA.id) },
      body: JSON.stringify({ status: "owned" })
    });
    assert.strictEqual(res.status, 403);
  });

  await test("removed legacy quick-login endpoint returns 404", async () => {
    const res = await fetch(`${API}/auth/quick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "someone" })
    });
    assert.strictEqual(res.status, 404);
  });

  await test("login with unknown email uses generic error (no enumeration)", async () => {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `nope_${rnd()}@example.com`, password: "whatever" })
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, "Email ou mot de passe incorrect");
  });

  // ── Authorization / IDOR ──
  await test("user can write to their OWN collection (200)", async () => {
    const res = await fetch(`${API}/collection/${userA.id}/water::Gold`, {
      method: "PUT", headers: authHeaders(userA.token),
      body: JSON.stringify({ status: "owned" })
    });
    assert.strictEqual(res.status, 200);
  });

  await test("user CANNOT write to another user's collection (403)", async () => {
    const res = await fetch(`${API}/collection/${userB.id}/water::Gold`, {
      method: "PUT", headers: authHeaders(userA.token),
      body: JSON.stringify({ status: "owned" })
    });
    assert.strictEqual(res.status, 403);
  });

  await test("legacy /import route now enforces ownership (403)", async () => {
    const res = await fetch(`${API}/collection/${userB.id}/import`, {
      method: "POST", headers: authHeaders(userA.token),
      body: JSON.stringify({ collection: { "water::Gold": { status: "owned" } } })
    });
    assert.strictEqual(res.status, 403);
  });

  await test("user CANNOT read another user's history (403)", async () => {
    const res = await fetch(`${API}/history/${userB.id}`, { headers: authHeaders(userA.token) });
    assert.strictEqual(res.status, 403);
  });

  await test("removed legacy /api/squad/:username leak returns 404", async () => {
    const res = await fetch(`${API}/squad/anyusername`);
    assert.strictEqual(res.status, 404);
  });

  // ── Input validation ──
  await test("invalid status enum is rejected (400)", async () => {
    const res = await fetch(`${API}/collection/${userA.id}/water::Gold`, {
      method: "PUT", headers: authHeaders(userA.token),
      body: JSON.stringify({ status: "hacked" })
    });
    assert.strictEqual(res.status, 400);
  });

  await test("note longer than 500 chars is rejected (400)", async () => {
    const res = await fetch(`${API}/collection/${userA.id}/water::Gold`, {
      method: "PUT", headers: authHeaders(userA.token),
      body: JSON.stringify({ note: "a".repeat(600) })
    });
    assert.strictEqual(res.status, 400);
  });

  await test("XSS/invalid username is rejected on register (400, or 429 if rate-limited)", async () => {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `x_${rnd()}@example.com`, password: "password123", username: "<script>alert(1)</script>" })
    });
    // 400 = validation rejected it; 429 = register rate limit already reached
    // (also a safe outcome — the malicious payload was never processed).
    assert.ok(res.status === 400 || res.status === 429, `expected 400 or 429, got ${res.status}`);
  });

  await test("malformed JSON body returns clean 400", async () => {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad"
    });
    assert.strictEqual(res.status, 400);
  });

  // ── Squad access control ──
  let squadCode;
  await test("owner can create a squad (200)", async () => {
    const res = await fetch(`${API}/squads`, {
      method: "POST", headers: authHeaders(userA.token),
      body: JSON.stringify({ name: "Sec Test Squad" })
    });
    assert.strictEqual(res.status, 200);
    squadCode = (await res.json()).code;
  });

  await test("non-member cannot read squad details (403)", async () => {
    const res = await fetch(`${API}/squads/${squadCode}`, { headers: authHeaders(userB.token) });
    assert.strictEqual(res.status, 403);
  });

  await test("non-owner cannot delete squad (403)", async () => {
    const res = await fetch(`${API}/squads/${squadCode}`, { method: "DELETE", headers: authHeaders(userB.token) });
    assert.strictEqual(res.status, 403);
  });

  await test("invalid invite code is rejected (404)", async () => {
    const res = await fetch(`${API}/squads/join`, {
      method: "POST", headers: authHeaders(userB.token),
      body: JSON.stringify({ code: "SPRITE-XXXXXXXX" })
    });
    assert.strictEqual(res.status, 404);
  });

  await test("owner CAN delete their own squad (200 — verifies await fix)", async () => {
    const res = await fetch(`${API}/squads/${squadCode}`, { method: "DELETE", headers: authHeaders(userA.token) });
    assert.strictEqual(res.status, 200);
  });

  // ── Share links (opaque tokens) ──
  let shareToken;
  await test("owner can generate an opaque share token (64 hex chars)", async () => {
    const res = await fetch(`${API}/profile/${userA.id}/share-link`, {
      method: "POST", headers: authHeaders(userA.token), body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 200);
    shareToken = (await res.json()).token;
    assert.ok(/^[a-f0-9]{64}$/.test(shareToken), "token is not a 256-bit hex string");
  });

  await test("another user cannot manage someone else's share link (403)", async () => {
    const res = await fetch(`${API}/profile/${userA.id}/share-link`, {
      method: "POST", headers: authHeaders(userB.token), body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 403);
  });

  await test("public shared view exposes status but NOT notes", async () => {
    const res = await fetch(`${API}/shared/${shareToken}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.username, "missing username");
    for (const entry of Object.values(data.collection || {})) {
      assert.ok(!("note" in entry), "note field leaked in shared view");
    }
  });

  await test("malformed share token is rejected (404)", async () => {
    const res = await fetch(`${API}/shared/not-a-real-token`);
    assert.strictEqual(res.status, 404);
  });

  await test("revoked share token no longer resolves (404)", async () => {
    const del = await fetch(`${API}/profile/${userA.id}/share-link`, { method: "DELETE", headers: authHeaders(userA.token) });
    assert.strictEqual(del.status, 200);
    const res = await fetch(`${API}/shared/${shareToken}`);
    assert.strictEqual(res.status, 404);
  });

  // ── Static file exposure ──
  await test("server source (server.js) is NOT served statically (404)", async () => {
    const res = await fetch(`${BASE}/server.js`);
    assert.strictEqual(res.status, 404);
  });

  await test(".env is NOT served statically (404)", async () => {
    const res = await fetch(`${BASE}/.env`);
    assert.strictEqual(res.status, 404);
  });

  await test("security headers are present", async () => {
    const res = await fetch(`${API}/sprites`);
    assert.ok(res.headers.get("content-security-policy"), "missing CSP");
    assert.strictEqual(res.headers.get("x-frame-options"), "DENY");
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
  });

  // ── Cleanup ──
  await fetch(`${API}/profile/${userA.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${userA.token}` } });
  await fetch(`${API}/profile/${userB.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${userB.token}` } });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nTest runner crashed:", err.message);
  console.error("Is the server running? Start it with: node server.js");
  process.exit(1);
});
