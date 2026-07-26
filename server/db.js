const { Pool } = require("pg");

function getDatabaseHost(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

function isLocalDatabaseUrl(url) {
  const host = getDatabaseHost(url);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isRenderInternalDatabaseUrl(url) {
  const host = getDatabaseHost(url);
  // Render injects internal Postgres URLs in the form `dpg-<id>-a`. They are
  // reachable only over Render's private network and do not present the public
  // TLS certificate used by external `*.render.com` database endpoints.
  return /^dpg-[a-z0-9]+-a$/i.test(host || "");
}

function shouldUseSSL(url) {
  if (!url) return false;
  if (isLocalDatabaseUrl(url)) return false;
  if (isRenderInternalDatabaseUrl(url)) return false;
  if (process.env.PGSSL === "disable") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[DB] PGSSL=disable is only permitted outside production");
    }
    return false;
  }
  return true;
}

function sanitizeConnectionString(url) {
  // `pg` lets URL query parameters such as sslmode=no-verify override the
  // explicit `ssl` option. Strip them so the application's TLS policy cannot
  // accidentally be weakened by a DATABASE_URL value.
  try {
    const parsed = new URL(url);
    for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    // Keep the original value; pg will provide the connection-string error.
    return url;
  }
}

function databasePoolConfig(url) {
  return {
    connectionString: sanitizeConnectionString(url),
    // TLS is enabled with certificate validation for every external URL. Local
    // and Render-private connections stay on their private network.
    ssl: shouldUseSSL(url) ? { rejectUnauthorized: true } : false
  };
}

const pool = process.env.DATABASE_URL
  ? new Pool(databasePoolConfig(process.env.DATABASE_URL))
  : new Pool({
      database: "sprite-index",
      host: "localhost",
      port: 5432,
    });

module.exports = { databasePoolConfig, getDatabaseHost, isLocalDatabaseUrl, isRenderInternalDatabaseUrl, pool, sanitizeConnectionString, shouldUseSSL };
