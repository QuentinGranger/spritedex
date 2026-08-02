// Email verification gate: password accounts must confirm before using the API.
const assert = require("node:assert");
const crypto = require("node:crypto");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = `${BASE}/api`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}

function rnd() {
  return crypto.randomBytes(4).toString("hex");
}

function auth(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function registerRealish() {
  // Non-example domain stays unverified (gate must apply).
  const email = `gate_${rnd()}@spriteindex-unverified.com`;
  const username = `Gate${rnd()}`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "password123",
      username,
      ageConfirmed: true,
      cguAccepted: true,
      cookieConsent: { necessary: true, analytics: false, version: "1" }
    })
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { ...data, email };
}

async function registerExample() {
  const email = `gate_ok_${rnd()}@example.com`;
  const username = `GateOk${rnd()}`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "password123",
      username,
      ageConfirmed: true,
      cguAccepted: true,
      cookieConsent: { necessary: true, analytics: false, version: "1" }
    })
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return data;
}

async function run() {
  console.log(`\nEmail verification gate tests against ${BASE}\n`);

  await test("unverified password account cannot sync collection", async () => {
    const user = await registerRealish();
    assert.strictEqual(user.emailVerified, false);
    const me = await fetch(`${API}/auth/me`, { headers: auth(user.token) });
    assert.strictEqual(me.status, 200, "me must remain reachable");
    const meBody = await me.json();
    assert.strictEqual(meBody.email_verified, false);

    const blocked = await fetch(`${API}/collection/${user.id}/sync`, {
      method: "POST",
      headers: auth(user.token),
      body: JSON.stringify({ collection: {} })
    });
    const body = await blocked.json().catch(() => ({}));
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual(body.code, "email_not_verified");

    const resend = await fetch(`${API}/auth/resend-verification`, {
      method: "POST",
      headers: auth(user.token)
    });
    assert.ok(resend.ok, "resend must stay allowlisted");
  });

  await test("unverified password account cannot create compare share links", async () => {
    const user = await registerRealish();
    const blocked = await fetch(`${API}/compare/share`, {
      method: "POST",
      headers: auth(user.token),
      body: JSON.stringify({})
    });
    const body = await blocked.json().catch(() => ({}));
    assert.strictEqual(blocked.status, 403, `expected gate on compare/share, got ${blocked.status}`);
    assert.strictEqual(body.code, "email_not_verified");
  });

  await test("@example.com test inboxes are auto-verified outside production", async () => {
    const user = await registerExample();
    if (process.env.NODE_ENV === "production") {
      assert.strictEqual(user.emailVerified, false);
      return;
    }
    assert.strictEqual(user.emailVerified, true);
    const ok = await fetch(`${API}/sprites`, { headers: auth(user.token) });
    assert.ok(ok.ok, `verified test user should reach API: ${ok.status}`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
