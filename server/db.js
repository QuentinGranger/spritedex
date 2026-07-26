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

function shouldUseSSL(url) {
  if (!url) return false;
  if (isLocalDatabaseUrl(url)) return false;
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
    // TLS is enabled for every non-local URL and certificate validation is on
    // by default. A development-only plaintext opt-out is handled above.
    ssl: shouldUseSSL(url) ? { rejectUnauthorized: true } : false
  };
}

const pool = process.env.DATABASE_URL
  ? new Pool(databasePoolConfig(process.env.DATABASE_URL))
  : new Pool({
      database: "spritedex",
      host: "localhost",
      port: 5432,
    });

module.exports = { databasePoolConfig, getDatabaseHost, isLocalDatabaseUrl, pool, sanitizeConnectionString, shouldUseSSL };
