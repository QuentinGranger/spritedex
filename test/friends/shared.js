"use strict";

const assert = require("node:assert");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = `${BASE}/api`;

function rnd() {
  return Math.random().toString(36).slice(2, 10);
}

async function register(username, displayName) {
  const email = `${username}_${rnd()}@example.com`;
  const body = { email, password: "password123", username, ageConfirmed: true, cguAccepted: true };
  if (displayName) body.displayName = displayName;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, email, username, displayName: data.displayName };
}

function auth(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function cleanup(user) {
  if (!user) return;
  await fetch(`${API}/profile/${user.id}`, { method: "DELETE", headers: auth(user.token) });
}

async function setVisibility(user, settings) {
  const res = await fetch(`${API}/profile/${user.id}`, {
    method: "PATCH",
    headers: auth(user.token),
    body: JSON.stringify(settings)
  });
  assert.ok(res.ok, `set visibility failed: ${await res.text()}`);
}

async function setEntry(token, userId, variantId, status, priority) {
  const body = { status };
  if (priority !== undefined) body.priority = priority;
  const res = await fetch(`${API}/collection/${userId}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify(body)
  });
  assert.ok(res.ok, `setEntry failed: ${await res.text()}`);
}

async function becomeFriends(a, b) {
  let res = await fetch(`${API}/friends/${b.id}/request`, { method: "POST", headers: auth(a.token) });
  if (!res.ok) assert.fail(`request failed: ${await res.text()}`);
  res = await fetch(`${API}/friends/${a.id}/accept`, { method: "POST", headers: auth(b.token) });
  if (!res.ok) assert.fail(`accept failed: ${await res.text()}`);
}

async function okJson(res, label) {
  const text = await res.text();
  if (!res.ok) assert.fail(`${label}: ${res.status} ${text}`);
  return JSON.parse(text);
}

module.exports = { assert, BASE, API, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson };
