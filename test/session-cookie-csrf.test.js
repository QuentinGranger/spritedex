"use strict";

const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, urlPath, { headers = {}, body, cookies } = {}) {
  const payload = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const cookieHeader = Array.isArray(cookies) ? cookies.join("; ") : cookies;
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE}${urlPath}`,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            json,
            setCookies: [].concat(res.headers["set-cookie"] || [])
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieMap(setCookies) {
  const map = {};
  for (const line of setCookies) {
    const [pair] = String(line).split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) map[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return map;
}

function cookieHeaderFromMap(map) {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function waitForServer(child, timeoutMs = 20000) {
  const started = Date.now();
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  child.stdout.on("data", () => {});
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await request("GET", "/health/live");
      if (res.status === 200) return;
    } catch (_) {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not start:\n${stderr.slice(-2000)}`);
}

(async () => {
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      EMAIL_VERIFICATION_REQUIRED: "0",
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForServer(child);
    const email = `cookie_${crypto.randomBytes(4).toString("hex")}@example.com`;
    const password = "CookieTestPass1!";
    const username = `cookie_${crypto.randomBytes(3).toString("hex")}`;

    const register = await request("POST", "/api/auth/register", {
      headers: { "X-Auth-Mode": "cookie" },
      body: {
        email,
        password,
        username,
        cguAccepted: true,
        cguVersion: "1.0",
        ageConfirmed: true,
        cookieConsent: { necessary: true, analytics: false, version: "1.0" },
        authMode: "cookie"
      }
    });
    assert.equal(register.status, 200, `register ${register.status} ${JSON.stringify(register.json)}`);
    assert.equal(register.json.authMode, "cookie");
    assert.ok(!register.json.token, "cookie register must not return bearer token");
    const cookies = cookieMap(register.setCookies);
    assert.ok(cookies.sprite_index_session, "session cookie set");
    assert.ok(cookies.sprite_index_csrf, "csrf cookie set");
    assert.ok(
      /HttpOnly/i.test(register.setCookies.find((c) => c.startsWith("sprite_index_session")) || ""),
      "session HttpOnly"
    );

    const me = await request("GET", "/api/auth/me", {
      cookies: cookieHeaderFromMap(cookies)
    });
    assert.equal(me.status, 200, `me ${me.status}`);
    assert.equal(String(me.json.id), String(register.json.id));

    const blocked = await request("POST", "/api/auth/logout", {
      cookies: cookieHeaderFromMap({
        sprite_index_session: cookies.sprite_index_session
        // missing csrf on purpose — but logout is exempt? Check CSRF_EXEMPT - logout is NOT exempt!
      })
    });
    // Logout without CSRF while cookie-authed should fail.
    assert.equal(blocked.status, 403, `logout without csrf should 403, got ${blocked.status}`);

    const logout = await request("POST", "/api/auth/logout", {
      headers: { "X-CSRF-Token": cookies.sprite_index_csrf },
      cookies: cookieHeaderFromMap(cookies)
    });
    assert.equal(logout.status, 200, `logout ${logout.status}`);

    // Bearer mode still returns a token and skips CSRF.
    const email2 = `bearer_${crypto.randomBytes(4).toString("hex")}@example.com`;
    const username2 = `bearer_${crypto.randomBytes(3).toString("hex")}`;
    const bearerReg = await request("POST", "/api/auth/register", {
      headers: { "X-Auth-Mode": "bearer" },
      body: {
        email: email2,
        password,
        username: username2,
        cguAccepted: true,
        cguVersion: "1.0",
        ageConfirmed: true,
        cookieConsent: { necessary: true, analytics: false, version: "1.0" }
      }
    });
    assert.equal(bearerReg.status, 200);
    assert.equal(bearerReg.json.authMode, "bearer");
    assert.ok(bearerReg.json.token);
    const bearerLogout = await request("POST", "/api/auth/logout", {
      headers: { Authorization: `Bearer ${bearerReg.json.token}` }
    });
    assert.equal(bearerLogout.status, 200);

    console.log("session-cookie-csrf: ok");
  } finally {
    child.kill("SIGTERM");
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
