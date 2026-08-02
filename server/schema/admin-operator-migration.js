"use strict";

async function applyAdminOperatorMigration(pool) {
    await pool.query(
      `INSERT INTO security_migrations (name)
       VALUES ('admin_named_operators_v1')
       ON CONFLICT (name) DO NOTHING`
    );
}

module.exports = { applyAdminOperatorMigration };
