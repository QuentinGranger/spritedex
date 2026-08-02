"use strict";

async function applyAuthTokenHardening(pool) {
    // Password-reset and email-verification values used to be persisted as
    // raw URL tokens.  New values are SHA-256 digests, but both formats are
    // hexadecimal and therefore cannot be safely distinguished in-place.
    // Invalidate the one pre-hardening generation once rather than leaving a
    // replayable secret in a database backup or a mistakenly rolled-back
    // process. Affected users can simply request a new email.
    const authTokenMigrationClient = await pool.connect();
    try {
      await authTokenMigrationClient.query("BEGIN");
      const authTokenMigration = await authTokenMigrationClient.query(
        `INSERT INTO security_migrations (name)
         VALUES ('opaque_auth_token_hashing_v1')
         ON CONFLICT (name) DO NOTHING
         RETURNING name`
      );
      if (authTokenMigration.rows.length) {
        await authTokenMigrationClient.query(
          `UPDATE users
           SET reset_token = NULL,
               reset_token_expires = NULL,
               email_verify_token = NULL,
               email_verify_token_expires = NULL
           WHERE reset_token IS NOT NULL OR email_verify_token IS NOT NULL`
        );
        console.warn("[SECURITY] Existing password-reset and verification links were invalidated to migrate bearer tokens to hashed storage.");
      }
      await authTokenMigrationClient.query("COMMIT");
    } catch (err) {
      await authTokenMigrationClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      authTokenMigrationClient.release();
    }
}

module.exports = { applyAuthTokenHardening };
