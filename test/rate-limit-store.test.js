const assert = require("assert");
const {
  buildBucketKey,
  consumeInMemory,
  getRateLimitStoreHealth,
  validRedisUrl
} = require("../server/rate-limit-store");

const identity = "person@example.test";
const key = buildBucketKey("password-reset", identity);
assert.ok(key.startsWith("sprite-index:rate-limit:v1:password-reset:"));
assert.ok(!key.includes(identity), "les identifiants ne doivent pas être stockés dans les clés Redis");
assert.strictEqual(key, buildBucketKey("password-reset", identity), "la clé doit être stable entre instances");
assert.notStrictEqual(key, buildBucketKey("password-reset", "other@example.test"));

const localKey = buildBucketKey(`test-${Date.now()}`, "127.0.0.1");
assert.strictEqual(consumeInMemory(localKey, 10_000).count, 1);
assert.strictEqual(consumeInMemory(localKey, 10_000).count, 2);
assert.strictEqual(getRateLimitStoreHealth().distributed, Boolean(process.env.REDIS_URL));
assert.strictEqual(validRedisUrl("redis://localhost:6379"), true);
assert.strictEqual(validRedisUrl("rediss://cache.example.test:6380"), true);
assert.strictEqual(validRedisUrl("https://cache.example.test"), false);

console.log("rate-limit store: OK");
