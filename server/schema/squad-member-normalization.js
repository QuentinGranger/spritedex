"use strict";

async function normalizeSquadMemberSchema(pool) {
  // ── Migration: normalize squad_members table ──
  // Existing tables (pre-normalization) lack id/role/status/left_at. This block
  // upgrades them idempotently without breaking current integer FKs on users/squads.
  await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'squad_members')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'squad_members' AND column_name = 'id') THEN

          ALTER TABLE squad_members ADD COLUMN id UUID DEFAULT gen_random_uuid();
          ALTER TABLE squad_members ADD COLUMN role VARCHAR(30) NOT NULL DEFAULT 'member';
          ALTER TABLE squad_members ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'active';
          ALTER TABLE squad_members ADD COLUMN left_at TIMESTAMPTZ;

          ALTER TABLE squad_members ALTER COLUMN id SET NOT NULL;
          ALTER TABLE squad_members ALTER COLUMN squad_id SET NOT NULL;
          ALTER TABLE squad_members ALTER COLUMN user_id SET NOT NULL;
          ALTER TABLE squad_members ALTER COLUMN joined_at SET NOT NULL;

          ALTER TABLE squad_members DROP CONSTRAINT IF EXISTS squad_members_pkey;
          ALTER TABLE squad_members ADD PRIMARY KEY (id);
          ALTER TABLE squad_members ADD CONSTRAINT unique_squad_member UNIQUE (squad_id, user_id);

          UPDATE squad_members SET role = 'owner'
          WHERE user_id = (SELECT created_by FROM squads WHERE squads.id = squad_members.squad_id);
        END IF;
      END
      $$;
    `);
}

module.exports = { normalizeSquadMemberSchema };
