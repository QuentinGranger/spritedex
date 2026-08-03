"use strict";

async function ensureSquadOptionsSchema(pool) {
  await pool.query(`ALTER TABLE squads ADD COLUMN IF NOT EXISTS join_open BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE squads ADD COLUMN IF NOT EXISTS logo_url TEXT`);
  await pool.query(
    `ALTER TABLE squads ADD COLUMN IF NOT EXISTS max_active_goals_per_member INTEGER NOT NULL DEFAULT 3`
  );
  await pool.query(`ALTER TABLE squads ADD COLUMN IF NOT EXISTS visibility VARCHAR(30) NOT NULL DEFAULT 'members'`);
  await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'squads_visibility_check'
        ) THEN
          ALTER TABLE squads
            ADD CONSTRAINT squads_visibility_check
            CHECK (visibility IN ('private', 'members', 'public'));
        END IF;
      END $$;
    `);
}

module.exports = { ensureSquadOptionsSchema };
