"use strict";

const { pool } = require("../db");

/**
 * Étape 5–6 — central append-only event table + corrections ledger.
 */
async function ensureGraphEventsTable(db = pool) {
  await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      event_type VARCHAR(100) NOT NULL,
      event_version INTEGER NOT NULL DEFAULT 1,

      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

      sprite_id VARCHAR(50),
      variant_id VARCHAR(100),

      squad_id INTEGER REFERENCES squads(id) ON DELETE SET NULL,
      comparison_id UUID,
      friendship_id UUID,
      goal_id UUID,
      notification_id INTEGER,

      source VARCHAR(50) NOT NULL,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,

      occurred_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      deduplication_key VARCHAR(255) UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_graph_events_type_occurred
      ON graph_events (event_type, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_events_actor_occurred
      ON graph_events (actor_user_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_events_variant_occurred
      ON graph_events (variant_id, occurred_at DESC)
      WHERE variant_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_graph_events_squad_occurred
      ON graph_events (squad_id, occurred_at DESC)
      WHERE squad_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_graph_events_recorded
      ON graph_events (recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_events_source
      ON graph_events (source, occurred_at DESC);
  `);

  // Étape 6 — corrections ledger (never mutate the cancelled row).
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_event_corrections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cancelled_event_id UUID NOT NULL REFERENCES graph_events(id),
      corrective_event_id UUID REFERENCES graph_events(id),
      reason TEXT NOT NULL,
      corrected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (cancelled_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_graph_event_corrections_corrective
      ON graph_event_corrections (corrective_event_id)
      WHERE corrective_event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_graph_event_corrections_at
      ON graph_event_corrections (corrected_at DESC);
  `);

  // Append-only enforcement: refuse UPDATE/DELETE on graph_events.
  await db.query(`
    CREATE OR REPLACE FUNCTION graph_events_reject_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'graph_events is append-only; use graph_event_corrections';
    END;
    $$;
  `);
  await db.query(`DROP TRIGGER IF EXISTS trg_graph_events_append_only ON graph_events`);
  await db.query(`
    CREATE TRIGGER trg_graph_events_append_only
      BEFORE UPDATE OR DELETE ON graph_events
      FOR EACH ROW
      EXECUTE PROCEDURE graph_events_reject_mutation()
  `);

  // Effective history view (Étape 6–7): raw events minus cancelled ones.
  await db.query(`
    CREATE OR REPLACE VIEW graph_events_effective AS
    SELECT e.*
    FROM graph_events e
    LEFT JOIN graph_event_corrections c ON c.cancelled_event_id = e.id
    WHERE c.id IS NULL
  `);

  // Étape 31–32 — outbox + aggregate tables.
  await require("../sprite-graph-outbox").ensureEventOutboxTables(db);
  // Étape 36–40 — daily / community specialized aggregates.
  await require("../sprite-graph-community").ensureCommunityStatsTables(db);
  // Étape 46–60 — comparison / interest / trends / squad stats / daily pipeline.
  await require("../sprite-graph-comparison-stats").ensureComparisonStatsTables(db);
  await require("../sprite-graph-trends").ensureTrendTables(db);
  await require("../sprite-graph-squad-stats").ensureSquadDailyStatsTables(db);
  await require("../sprite-graph-catalogue").ensureCatalogueVersionColumns(db);
  await require("../sprite-graph-daily").ensureDailyPipelineTables(db);
  // Étape 61–65 — realtime counters + retention tables.
  await require("../sprite-graph-counters").ensureMetricCounterTables(db);
  // Étape 66–70 — governance (consent column already on users via community module).
  await require("../sprite-graph-community").ensureCommunityStatsTables(db);
}

module.exports = { ensureGraphEventsTable };
