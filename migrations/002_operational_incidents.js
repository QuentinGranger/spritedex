module.exports = {
  id: "002_operational_incidents",
  description: "Persist deduplicated operational incidents for monitoring",
  async up({ client }) {
    await client.query(`
      CREATE TABLE operational_incidents (
        id BIGSERIAL PRIMARY KEY,
        fingerprint CHAR(64) NOT NULL UNIQUE,
        component VARCHAR(80) NOT NULL,
        environment VARCHAR(40) NOT NULL,
        message TEXT NOT NULL,
        context JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
        last_alerted_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ
      );
      CREATE INDEX idx_operational_incidents_open
        ON operational_incidents (resolved_at, last_seen_at DESC);
      CREATE INDEX idx_operational_incidents_component
        ON operational_incidents (component, last_seen_at DESC);
    `);
  },
  async down({ client }) {
    await client.query("DROP TABLE IF EXISTS operational_incidents");
  }
};
