"use strict";

async function applyCapabilityHardening(pool) {
    // These URL values are bearer capabilities. Earlier versions persisted
    // them in clear text, so invalidate that one legacy generation exactly
    // once before the application starts looking up SHA-256 digests.
    const migrationClient = await pool.connect();
    try {
      await migrationClient.query("BEGIN");
      const capabilityMigration = await migrationClient.query(
        `INSERT INTO security_migrations (name)
         VALUES ('capability_token_hashing_v1')
         ON CONFLICT (name) DO NOTHING
         RETURNING name`
      );
      if (capabilityMigration.rows.length) {
        await migrationClient.query("UPDATE users SET share_token = NULL WHERE share_token IS NOT NULL");
        await migrationClient.query("UPDATE compare_share_tokens SET revoked_at = NOW() WHERE revoked_at IS NULL");
        await migrationClient.query("DELETE FROM friend_invite_links");
        console.warn("[SECURITY] Existing share and invite links were invalidated to migrate bearer tokens to hashed storage.");
      }
      await migrationClient.query("COMMIT");
    } catch (err) {
      await migrationClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      migrationClient.release();
    }
}

module.exports = { applyCapabilityHardening };
