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
  if (user) await fetch(`${API}/profile/${user.id}`, { method: "DELETE", headers: auth(user.token) });
}

async function createSquad(token, name) {
  const res = await fetch(`${API}/squads`, { method: "POST", headers: auth(token), body: JSON.stringify({ name }) });
  if (!res.ok) assert.fail(`create squad failed: ${await res.text()}`);
  return res.json();
}

async function joinSquad(token, code) {
  const res = await fetch(`${API}/squads/join`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ code })
  });
  if (!res.ok) assert.fail(`join squad failed: ${await res.text()}`);
  return res.json();
}

async function sendFriendRequest(token, friendId) {
  const res = await fetch(`${API}/friends/${friendId}/request`, { method: "POST", headers: auth(token) });
  assert.strictEqual(res.status, 200, `send friend request failed: ${await res.text()}`);
}

async function acceptFriendRequest(token, friendId) {
  const res = await fetch(`${API}/friends/${friendId}/accept`, { method: "POST", headers: auth(token) });
  assert.strictEqual(res.status, 200, `accept friend request failed: ${await res.text()}`);
}

async function inviteToSquad(token, squadId, inviteeId) {
  const res = await fetch(`${API}/squads/${squadId}/invitations`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ inviteeId })
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function acceptSquadInvitation(token, invitationId) {
  const res = await fetch(`${API}/squads/invitations/${invitationId}/accept`, { method: "POST", headers: auth(token) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function getSquad(token, squadCode) {
  const res = await fetch(`${API}/squads/${squadCode}`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get squad failed: ${await res.text()}`);
  return res.json();
}

async function getSquadRecommendations(token, squadCode) {
  const res = await fetch(`${API}/squads/${squadCode}/recommendations`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get recommendations failed: ${await res.text()}`);
  return res.json();
}

async function getSquadCompletion(token, squadCode) {
  const res = await fetch(`${API}/squads/${squadCode}/completion`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get completion scope failed: ${await res.text()}`);
  return res.json();
}

async function getSquadHistory(token, squadCode) {
  const res = await fetch(`${API}/squads/${encodeURIComponent(squadCode)}/history`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get squad history failed: ${await res.text()}`);
  return res.json();
}

async function setPrivacy(token, userId, collectionVisibility) {
  const res = await fetch(`${API}/profile/${userId}`, {
    method: "PATCH",
    headers: auth(token),
    body: JSON.stringify({ collectionVisibility })
  });
  if (!res.ok) assert.fail(`set collection visibility failed: ${await res.text()}`);
}

async function setEntry(token, userId, variantId, status) {
  const res = await fetch(`${API}/collection/${userId}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ status })
  });
  if (!res.ok) assert.fail(`setEntry ${variantId} failed: ${await res.text()}`);
}

async function resetCollection(token, userId) {
  const res = await fetch(`${API}/collection/${userId}`, { method: "DELETE", headers: auth(token) });
  return res.ok;
}

async function blockUser(token, userId, blockedId) {
  const res = await fetch(`${API}/users/${blockedId}/block`, { method: "POST", headers: auth(token) });
  if (!res.ok) assert.fail(`block user failed: ${await res.text()}`);
}

async function unblockUser(token, userId, blockedId) {
  const res = await fetch(`${API}/users/${blockedId}/block`, { method: "DELETE", headers: auth(token) });
  if (!res.ok) assert.fail(`unblock user failed: ${await res.text()}`);
}

async function leaveSquad(token, code) {
  const res = await fetch(`${API}/squads/${encodeURIComponent(code)}/leave`, { method: "POST", headers: auth(token) });
  if (!res.ok) assert.fail(`leave squad failed: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

async function getVariantSamples(token) {
  const res = await fetch(`${API}/sprites`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get sprites failed: ${await res.text()}`);
  const { sprites } = await res.json();
  const excludedRelease = new Set(["unreleased", "upcoming", "coming_soon", "soon", "unknown"]);
  let activeId = null,
    secondActiveId = null,
    unreleasedId = null;
  const activeIds = [];
  for (const sprite of sprites)
    for (const variant of Object.values(sprite.variantDetails || {})) {
      const release = (variant.releaseStatus || "").toLowerCase();
      const available = variant.available !== false;
      if (available && !excludedRelease.has(release)) {
        if (!activeIds.includes(variant.id)) activeIds.push(variant.id);
        if (!activeId) activeId = variant.id;
        else if (!secondActiveId && variant.id !== activeId) secondActiveId = variant.id;
      }
      if (!unreleasedId && (!available || excludedRelease.has(release))) unreleasedId = variant.id;
    }
  assert.ok(activeId, "need at least one active variant");
  return { activeId, secondActiveId, unreleasedId, activeIds };
}

async function friendshipStatus(token, otherId) {
  const res = await fetch(`${API}/friends`, { headers: auth(token) });
  if (!res.ok) assert.fail(`list friends failed: ${await res.text()}`);
  const data = await res.json();
  return data.friends.find((f) => String(f.id) === String(otherId)) ? "accepted" : "none";
}

function results() {
  return { passed, failed };
}

module.exports = {
  assert,
  BASE,
  API,
  test,
  rnd,
  register,
  auth,
  cleanup,
  createSquad,
  joinSquad,
  sendFriendRequest,
  acceptFriendRequest,
  inviteToSquad,
  acceptSquadInvitation,
  getSquad,
  getSquadRecommendations,
  getSquadCompletion,
  getSquadHistory,
  setPrivacy,
  setEntry,
  resetCollection,
  blockUser,
  unblockUser,
  leaveSquad,
  getVariantSamples,
  friendshipStatus,
  results
};
