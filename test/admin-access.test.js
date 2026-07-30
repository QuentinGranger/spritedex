"use strict";

process.env.NODE_ENV = "test";
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;

const assert = require("node:assert");
const {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  consumeAdminTicket,
  hashAdminPassword,
  isAdminSession,
  issueAdminTicket,
  revokeAdminSession,
  verifyAdminPassword
} = require("../server/admin-access");

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
  const password = "terminal-admin-password";
  const encoded = hashAdminPassword(password);
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.strictEqual(verifyAdminPassword(password, encoded), true);
  assert.strictEqual(verifyAdminPassword("wrong-password", encoded), false);

  const oneTimeTicket = issueAdminTicket();
  const oneTimeSession = consumeAdminTicket(oneTimeTicket);
  assert.match(oneTimeSession, /^[a-f0-9]{64}$/);
  assert.strictEqual(consumeAdminTicket(oneTimeTicket), null, "a ticket must be consumed once");
  const fakeRequest = { cookies: { [ADMIN_SESSION_COOKIE]: oneTimeSession } };
  assert.strictEqual(isAdminSession(fakeRequest), true);
  revokeAdminSession(fakeRequest);
  assert.strictEqual(isAdminSession(fakeRequest), false);
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
    assert.deepStrictEqual(await session.json(), { authenticated: true });

    const adminPage = await fetch(`${base}/admin`, { headers: { Cookie: cookie } });
    assert.strictEqual(adminPage.status, 200);
    const adminHtml = await adminPage.text();
    assert.match(adminHtml, /Vue d’ensemble/);
    assert.match(adminHtml, /data-admin-tab="privacy"/);

    const logout = await fetch(`${base}/api/admin/logout`, { method: "POST", headers: { Cookie: cookie } });
    assert.strictEqual(logout.status, 204);
    const afterLogout = await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } });
    assert.strictEqual(afterLogout.status, 401);
  } finally {
    await close(server);
  }

  console.log("admin terminal access: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
