// ─────────────────────────────────────────────────────────────────
// SPRITNEX — Collection goals integration tests
// Run against a live server: node server.js, then node test/goals.test.js
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

async function createSquad(token, name) {
  const res = await fetch(`${API}/squads`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ name })
  });
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

async function leaveSquad(token, code) {
  const res = await fetch(`${API}/squads/${code}/leave`, {
    method: "POST",
    headers: auth(token)
  });
  return res.ok;
}

async function sendFriendRequest(token, friendId) {
  const res = await fetch(`${API}/friends/${friendId}/request`, { method: "POST", headers: auth(token) });
  assert.strictEqual(res.status, 200, `send friend request failed: ${await res.text()}`);
}

async function acceptFriendRequest(token, friendId) {
  const res = await fetch(`${API}/friends/${friendId}/accept`, { method: "POST", headers: auth(token) });
  assert.strictEqual(res.status, 200, `accept friend request failed: ${await res.text()}`);
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
  const res = await fetch(`${API}/collection/${userId}`, {
    method: "DELETE",
    headers: auth(token)
  });
  return res.ok;
}

async function createGoal(token, { title, description, squadId, variantId }) {
  const res = await fetch(`${API}/collection-goals`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ title, description, squadId, variantId })
  });
  if (!res.ok) assert.fail(`create goal failed: ${await res.text()}`);
  return res.json();
}

async function listGoals(token) {
  const res = await fetch(`${API}/collection-goals`, { headers: auth(token) });
  if (!res.ok) assert.fail(`list goals failed: ${await res.text()}`);
  return res.json();
}

async function getNotifications(token) {
  const res = await fetch(`${API}/notifications`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get notifications failed: ${await res.text()}`);
  return res.json();
}

async function getVariantSamples(token) {
  const res = await fetch(`${API}/sprites`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get sprites failed: ${await res.text()}`);
  const { sprites } = await res.json();

  const excludedRelease = new Set(["unreleased", "upcoming", "coming_soon", "soon", "unknown"]);
  for (const sprite of sprites) {
    const details = sprite.variantDetails || {};
    for (const variant of Object.values(details)) {
      const release = (variant.releaseStatus || "").toLowerCase();
      if (variant.available !== false && !excludedRelease.has(release)) {
        return { activeId: variant.id };
      }
    }
  }
  assert.fail("no active variant found");
}

async function run() {
  console.log(`\nRunning SPRITNEX goals tests against ${BASE}\n`);

  const alice = await register(`GoAlice${rnd()}`);
  const bob = await register(`GoBob${rnd()}`);
  const samples = await getVariantSamples(alice.token);

  try {
    await test("un objectif peut être créé entre amis", async () => {
      await sendFriendRequest(alice.token, bob.id);
      await acceptFriendRequest(bob.token, alice.id);

      const goal = await createGoal(alice.token, { title: "Obtenir ensemble", variantId: samples.activeId });
      assert.ok(goal.goalId, "goal id missing");

      const list = await listGoals(alice.token);
      assert.ok(list.goals.some(g => g.id === goal.goalId), "personal goal not listed");
      assert.ok(list.goals.some(g => g.id === goal.goalId && String(g.userId) === String(alice.id)), "goal should belong to creator");
    });

    await test("un objectif peut appartenir à une squad", async () => {
      const squad = await createSquad(alice.token, "Goal Squad");
      const goal = await createGoal(alice.token, { title: "Squad Goal", squadId: squad.id, variantId: samples.activeId });

      const list = await listGoals(alice.token);
      const found = list.goals.find(g => g.id === goal.goalId);
      assert.ok(found, "squad goal not listed");
      assert.strictEqual(String(found.squadId), String(squad.id), "goal should belong to squad");
    });

    await test("les progrès sont recalculés", async () => {
      const squad = await createSquad(alice.token, "Progress Squad");
      await joinSquad(bob.token, squad.code);

      const goal = await createGoal(alice.token, { title: "Progress Goal", squadId: squad.id, variantId: samples.activeId });

      let list = await listGoals(alice.token);
      let found = list.goals.find(g => g.id === goal.goalId);
      assert.strictEqual(found.status, "active", "goal should start active");

      await setEntry(bob.token, bob.id, samples.activeId, "owned");

      list = await listGoals(alice.token);
      found = list.goals.find(g => g.id === goal.goalId);
      assert.strictEqual(found.status, "completed", "squad goal should complete when variant is owned");
    });

    await test("un membre quittant la squad perd l'accès aux objectifs de celle-ci", async () => {
      const squad = await createSquad(alice.token, "Leave Squad");
      await joinSquad(bob.token, squad.code);

      const goal = await createGoal(alice.token, { title: "Leave Goal", squadId: squad.id, variantId: samples.activeId });

      let list = await listGoals(bob.token);
      assert.ok(list.goals.some(g => g.id === goal.goalId), "bob should see squad goal");

      const left = await leaveSquad(bob.token, squad.code);
      assert.ok(left, "leave squad failed");

      list = await listGoals(bob.token);
      assert.ok(!list.goals.some(g => g.id === goal.goalId), "bob should no longer see squad goal after leaving");
    });

    await test("un objectif terminé déclenche une notification", async () => {
      const charlie = await register(`GoCharlie${rnd()}`);
      try {
        const squad = await createSquad(charlie.token, "Notify Squad");
        await sendFriendRequest(charlie.token, bob.id);
        await acceptFriendRequest(bob.token, charlie.id);
        await joinSquad(bob.token, squad.code);

        // Clear old notifications
        await fetch(`${API}/notifications/read-all`, { method: "POST", headers: auth(charlie.token) });

        const goal = await createGoal(charlie.token, { title: "Notify Goal", squadId: squad.id, variantId: samples.activeId });

        await setEntry(bob.token, bob.id, samples.activeId, "owned");

        const notifications = await getNotifications(charlie.token);
        const goalNotification = notifications.notifications.find(n => n.type === "goal_completed" || (n.metadata && n.metadata.type === "goal_completed"));
        assert.ok(goalNotification, "goal completion should create a notification");
      } finally {
        await cleanup(charlie);
      }
    });
  } finally {
    await cleanup(alice);
    await cleanup(bob);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nTest runner crashed:", err.message);
  process.exit(1);
});
