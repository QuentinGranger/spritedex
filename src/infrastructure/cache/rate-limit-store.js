// Shared rate-limit counter. Redis is optional for local development, but when
// REDIS_URL is configured every web instance consumes the same atomic bucket.
const crypto = require("crypto");
const { createClient } = require("redis");

const memoryBuckets = new Map();
const namespace = "sprite-index:rate-limit:v1";
const redisUrl = process.env.REDIS_URL?.trim();
const redisRequired = process.env.RATE_LIMIT_REDIS_REQUIRED === "1" || process.env.RATE_LIMIT_REDIS_REQUIRED === "true";
let client = null;
let connectPromise = null;
let lastError = null;
let lastErrorLogAt = 0;

const INCREMENT_SCRIPT = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  "return { count, redis.call('PTTL', KEYS[1]) }"
].join("\n");

function logRedisError(error) {
  lastError = error?.message || String(error || "unknown Redis error");
  const now = Date.now();
  if (now - lastErrorLogAt >= 60_000) {
    lastErrorLogAt = now;
    console.warn(
      `[rate-limit] Redis indisponible, repli ${redisRequired ? "bloquant" : "mémoire locale"}: ${lastError}`
    );
  }
}

function buildBucketKey(prefix, identifier) {
  const safePrefix = String(prefix || "rl")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  const digest = crypto
    .createHash("sha256")
    .update(String(identifier || "unknown"))
    .digest("hex");
  return `${namespace}:${safePrefix}:${digest}`;
}

function consumeInMemory(key, windowMs) {
  const now = Date.now();
  let entry = memoryBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    memoryBuckets.set(key, entry);
  }
  entry.count += 1;
  return {
    count: entry.count,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    store: "memory"
  };
}

function validRedisUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "redis:" || url.protocol === "rediss:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function getClient() {
  if (!validRedisUrl(redisUrl)) return null;
  if (client) return client;
  client = createClient({
    url: redisUrl,
    socket: { connectTimeout: 750, reconnectStrategy: (retries) => Math.min(500 + retries * 250, 5_000) }
  });
  client.on("error", logRedisError);
  connectPromise = client.connect().catch((error) => {
    logRedisError(error);
    return false;
  });
  return client;
}

async function waitForConnection(redisClient) {
  if (redisClient.isReady) return true;
  if (!connectPromise) return false;
  // Do not let a Redis outage consume the HTTP request timeout. The client can
  // finish reconnecting in the background for subsequent requests.
  await Promise.race([connectPromise, new Promise((resolve) => setTimeout(resolve, 200))]);
  return redisClient.isReady;
}

async function consumeRateLimit({ prefix, identifier, windowMs }) {
  const key = buildBucketKey(prefix, identifier);
  const redisClient = getClient();
  if (!redisClient) {
    if (redisRequired) return { unavailable: true, store: "redis" };
    return consumeInMemory(key, windowMs);
  }

  try {
    if (!(await waitForConnection(redisClient))) {
      if (redisRequired) return { unavailable: true, store: "redis" };
      return consumeInMemory(key, windowMs);
    }
    const result = await redisClient.eval(INCREMENT_SCRIPT, {
      keys: [key],
      arguments: [String(windowMs)]
    });
    const count = Number(result?.[0]);
    const ttlMs = Number(result?.[1]);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("Redis rate-limit response invalid");
    return {
      count,
      retryAfterSeconds: Math.max(1, Math.ceil((Number.isFinite(ttlMs) ? ttlMs : windowMs) / 1000)),
      store: "redis"
    };
  } catch (error) {
    logRedisError(error);
    if (redisRequired) return { unavailable: true, store: "redis" };
    return consumeInMemory(key, windowMs);
  }
}

function getRateLimitStoreHealth() {
  if (!redisUrl) return { mode: "memory", distributed: false, status: "not_configured" };
  if (!validRedisUrl(redisUrl)) return { mode: "redis", distributed: true, status: "invalid_configuration" };
  return {
    mode: "redis",
    distributed: true,
    required: redisRequired,
    status: client?.isReady ? "connected" : "connecting_or_unavailable",
    lastError: lastError || undefined
  };
}

setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of memoryBuckets) {
      if (entry.resetAt <= now) memoryBuckets.delete(key);
    }
  },
  5 * 60 * 1000
).unref();

module.exports = { buildBucketKey, consumeInMemory, consumeRateLimit, getRateLimitStoreHealth, validRedisUrl };
