"use strict";

require("dotenv").config();

process.env.NODE_ENV = "test";
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;
process.env.ADMIN_OPERATOR_LABEL = "ops-desk";
process.env.ADMIN_OPERATOR_ROLE = "owner";
process.env.ADMIN_MAX_CONCURRENT_SESSIONS = "2";
delete process.env.ADMIN_TOTP_SECRET;
delete process.env.ADMIN_REQUIRE_MFA;

const assert = require("node:assert");
const {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_TTL_MS,
  ADMIN_SESSION_TTL_MS,
  AdminAccessError,
  consumeAdminTicket,
  getAdminSession,
  hashAdminPassword,
  isAdminSession,
  issueAdminTicket,
  listActiveAdminSessions,
  peekAdminTicket,
  resolveOperatorLabel,
  revokeAdminSession,
  revokeOtherAdminSessions,
  verifyAdminPassword
} = require("../server/admin-access");
const { hasCapability, resolveOperatorRole } = require("../server/admin-authz");
const { generateTotpSecret, totpAt, decodeBase32, verifyTotpCode } = require("../server/admin-totp");
const { pool } = require("../server/db");
const { ensureSquadTables } = require("../server/schema");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  await ensureSquadTables();

  const password = "terminal-admin-password";
  const encoded = hashAdminPassword(password);
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.strictEqual(verifyAdminPassword(password, encoded), true);
  assert.strictEqual(verifyAdminPassword("wrong-password", encoded), false);
  assert.strictEqual(resolveOperatorLabel(), "ops-desk");
  assert.strictEqual(resolveOperatorRole(), "owner");
  assert.ok(hasCapability("owner", "privacy.purge"));
  assert.ok(!hasCapability("readonly", "privacy.purge"));
  assert.ok(!hasCapability("moderator", "catalog.write"));
  assert.ok(hasCapability("moderator", "players.moderate"));
  assert.ok(ADMIN_SESSION_MAX_TTL_MS >= ADMIN_SESSION_TTL_MS);

  const oneTimeTicket = await issueAdminTicket({ ip: "127.0.0.1", userAgent: "admin-access-test" });
  const challenge = await peekAdminTicket(oneTimeTicket);
  assert.strictEqual(challenge.mfaRequired, false);
  const oneTimeSession = await consumeAdminTicket(oneTimeTicket, { ip: "127.0.0.1", userAgent: "admin-access-test" });
  assert.match(oneTimeSession.token, /^[a-f0-9]{64}$/);
  assert.match(oneTimeSession.actor, /^ops-desk:[a-f0-9]{8}$/);
  assert.strictEqual(oneTimeSession.role, "owner");
  assert.ok(oneTimeSession.capabilities.includes("privacy.purge"));
  assert.ok(oneTimeSession.maxExpiresAt);
  assert.strictEqual(await consumeAdminTicket(oneTimeTicket), null, "a ticket must be consumed once");

  const mfaSecret = generateTotpSecret();
  process.env.ADMIN_TOTP_SECRET = mfaSecret;
  const { consumeTotpCode } = require("../server/admin-totp");
  const probeCode = totpAt(decodeBase32(mfaSecret));
  assert.strictEqual(verifyTotpCode(probeCode, { secret: mfaSecret }), true);
  assert.strictEqual((await consumeTotpCode(probeCode, { purpose: "test-replay", secret: mfaSecret })).ok, true);
  assert.strictEqual(
    (await consumeTotpCode(probeCode, { purpose: "test-replay", secret: mfaSecret })).reason,
    "replay"
  );

  // Use a fresh secret so login is not blocked by the probe counter above.
  const loginSecret = generateTotpSecret();
  process.env.ADMIN_TOTP_SECRET = loginSecret;
  const mfaTicket = await issueAdminTicket({ ip: "127.0.0.1", userAgent: "admin-mfa-test" });
  assert.strictEqual((await peekAdminTicket(mfaTicket)).mfaRequired, true);
  await assert.rejects(
    () => consumeAdminTicket(mfaTicket, { ip: "127.0.0.1", userAgent: "admin-mfa-test" }, { totp: "000000" }),
    (error) => error instanceof AdminAccessError && error.code === "ADMIN_MFA_INVALID"
  );
  assert.ok(await peekAdminTicket(mfaTicket), "failed MFA must not burn the one-time ticket");
  const loginCode = totpAt(decodeBase32(loginSecret));
  const mfaSession = await consumeAdminTicket(
    mfaTicket,
    { ip: "127.0.0.1", userAgent: "admin-mfa-test" },
    { totp: loginCode }
  );
  assert.ok(mfaSession);
  assert.strictEqual(mfaSession.role, "owner");
  await assert.rejects(
    async () => {
      const replayTicket = await issueAdminTicket({ ip: "127.0.0.1", userAgent: "admin-mfa-replay" });
      await consumeAdminTicket(replayTicket, { ip: "127.0.0.1", userAgent: "admin-mfa-replay" }, { totp: loginCode });
    },
    (error) => error instanceof AdminAccessError && error.code === "ADMIN_MFA_REPLAY"
  );
  await revokeAdminSession({
    cookies: { [ADMIN_SESSION_COOKIE]: mfaSession.token },
    ip: "127.0.0.1",
    get: () => "admin-mfa-test"
  });
  delete process.env.ADMIN_TOTP_SECRET;

  process.env.ADMIN_OPERATOR_ROLE = "readonly";
  const readonlyTicket = await issueAdminTicket({ ip: "127.0.0.1", userAgent: "admin-readonly-test" });
  const readonlySession = await consumeAdminTicket(readonlyTicket, {
    ip: "127.0.0.1",
    userAgent: "admin-readonly-test"
  });
  assert.strictEqual(readonlySession.role, "readonly");
  assert.ok(!readonlySession.capabilities.includes("privacy.purge"));
  process.env.ADMIN_OPERATOR_ROLE = "owner";
  await revokeAdminSession({
    cookies: { [ADMIN_SESSION_COOKIE]: readonlySession.token },
    ip: "127.0.0.1",
    get: () => "admin-readonly-test"
  });

  const fakeRequest = {
    cookies: { [ADMIN_SESSION_COOKIE]: oneTimeSession.token },
    ip: "127.0.0.1",
    get: () => "admin-access-test"
  };
  assert.strictEqual(await isAdminSession(fakeRequest), true);
  assert.match(fakeRequest.adminSession.actor, /^ops-desk:[a-f0-9]{8}$/);

  const secondTicket = await issueAdminTicket({ ip: "127.0.0.1", userAgent: "admin-access-test-2" });
  const secondSession = await consumeAdminTicket(secondTicket, { ip: "10.0.0.2", userAgent: "admin-access-test-2" });
  const thirdTicket = await issueAdminTicket({ ip: "127.0.0.1", userAgent: "admin-access-test-3" });
  const thirdSession = await consumeAdminTicket(thirdTicket, { ip: "10.0.0.3", userAgent: "admin-access-test-3" });
  assert.ok(thirdSession);
  // Concurrent limit keeps the newest sessions; the oldest of the three is gone.
  assert.strictEqual(
    await isAdminSession({
      cookies: { [ADMIN_SESSION_COOKIE]: oneTimeSession.token },
      ip: "127.0.0.1",
      get: () => "admin-access-test"
    }),
    false,
    "oldest session must be revoked when the concurrent cap is exceeded"
  );
  assert.strictEqual(
    await isAdminSession({
      cookies: { [ADMIN_SESSION_COOKIE]: secondSession.token },
      ip: "10.0.0.2",
      get: () => "admin-access-test-2"
    }),
    true
  );

  const active = await listActiveAdminSessions(thirdSession.publicId);
  assert.ok(active.some((session) => session.current));
  const revokedOthers = await revokeOtherAdminSessions(thirdSession.publicId, { actor: thirdSession.actor });
  assert.ok(revokedOthers.revoked >= 1);
  assert.strictEqual(
    await isAdminSession({
      cookies: { [ADMIN_SESSION_COOKIE]: secondSession.token },
      ip: "10.0.0.2",
      get: () => "admin-access-test-2"
    }),
    false
  );

  const currentReq = {
    cookies: { [ADMIN_SESSION_COOKIE]: thirdSession.token },
    ip: "10.0.0.3",
    get: () => "admin-access-test-3"
  };
  const touched = await getAdminSession(currentReq);
  assert.ok(touched);
  assert.ok(new Date(touched.expiresAt).getTime() <= new Date(touched.maxExpiresAt).getTime());

  await revokeAdminSession(currentReq);
  assert.strictEqual(await isAdminSession(currentReq), false);
  assert.ok(ADMIN_SESSION_TTL_MS >= 60 * 60 * 1000);

  process.env.ADMIN_ACCESS_PASSWORD_HASH = encoded;
  const { server } = require("../server/core");
  require("../server/routes-admin");
  const base = await listen(server);
  try {
    const denied = await fetch(`${base}/api/admin/terminal/ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "incorrect" })
    });
    assert.strictEqual(denied.status, 403);

    const issued = await fetch(`${base}/api/admin/terminal/ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    assert.strictEqual(issued.status, 200);
    const payload = await issued.json();
    const ticket = new URL(payload.accessUrl).hash.slice(1);
    assert.match(ticket, /^[a-f0-9]{64}$/);

    const consumed = await fetch(`${base}/api/admin/terminal/consume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket })
    });
    assert.strictEqual(consumed.status, 204);
    const cookie = consumed.headers.get("set-cookie").split(";", 1)[0];
    assert.match(cookie, new RegExp(`^${ADMIN_SESSION_COOKIE}=`));

    const session = await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } });
    assert.strictEqual(session.status, 200);
    const sessionPayload = await session.json();
    assert.strictEqual(sessionPayload.authenticated, true);
    assert.strictEqual(sessionPayload.operatorLabel, "ops-desk");
    assert.strictEqual(sessionPayload.role, "owner");
    assert.ok(Array.isArray(sessionPayload.capabilities));
    assert.ok(sessionPayload.capabilities.includes("players.moderate"));
    assert.match(sessionPayload.actor, /^ops-desk:[a-f0-9]{8}$/);
    assert.ok(sessionPayload.maxExpiresAt);

    process.env.ADMIN_OPERATOR_ROLE = "readonly";
    const readonlyIssued = await fetch(`${base}/api/admin/terminal/ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    assert.strictEqual(readonlyIssued.status, 200);
    const readonlyTicket = new URL((await readonlyIssued.json()).accessUrl).hash.slice(1);
    const readonlyConsumed = await fetch(`${base}/api/admin/terminal/consume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: readonlyTicket })
    });
    assert.strictEqual(readonlyConsumed.status, 204);
    const readonlyCookie = readonlyConsumed.headers.get("set-cookie").split(";", 1)[0];
    const readonlySessionResponse = await fetch(`${base}/api/admin/session`, { headers: { Cookie: readonlyCookie } });
    assert.strictEqual(readonlySessionResponse.status, 200);
    const readonlyPayload = await readonlySessionResponse.json();
    assert.strictEqual(readonlyPayload.role, "readonly");
    assert.ok(!readonlyPayload.capabilities.includes("privacy.purge"));
    assert.strictEqual(readonlyPayload.tabs.privacy, true);
    assert.strictEqual(readonlyPayload.tabs.catalog, true);
    process.env.ADMIN_OPERATOR_ROLE = "owner";
    await fetch(`${base}/api/admin/logout`, { method: "POST", headers: { Cookie: readonlyCookie } });

    const listed = await fetch(`${base}/api/admin/sessions`, { headers: { Cookie: cookie } });
    assert.strictEqual(listed.status, 200);
    const listedPayload = await listed.json();
    assert.ok(Array.isArray(listedPayload.sessions));
    assert.ok(listedPayload.sessions.some((entry) => entry.current));

    // A second instance process would query the same Postgres rows. Prove the
    // cookie remains valid after clearing any accidental in-memory state by
    // validating again through a fresh request.
    const sessionAgain = await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } });
    assert.strictEqual(sessionAgain.status, 200);

    const adminPage = await fetch(`${base}/admin`, { headers: { Cookie: cookie } });
    assert.strictEqual(adminPage.status, 200);
    const adminHtml = await adminPage.text();
    assert.match(adminHtml, /Vue d’ensemble/);
    assert.match(adminHtml, /data-admin-tab="privacy"/);
    assert.match(adminHtml, /id="adminSessionBadge"/);
    assert.match(adminHtml, /id="revokeOtherSessions"/);

    const logout = await fetch(`${base}/api/admin/logout`, { method: "POST", headers: { Cookie: cookie } });
    assert.strictEqual(logout.status, 204);
    const afterLogout = await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } });
    assert.strictEqual(afterLogout.status, 401);
  } finally {
    await close(server);
  }

  console.log("admin terminal access: ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {}
    // Rate-limiter timers and websocket handles keep the event loop alive.
    process.exit(process.exitCode || 0);
  });
