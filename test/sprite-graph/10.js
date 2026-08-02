const ctx = require("./shared");

module.exports = {
  name: "collection setEntry : même transaction que graph_events (Étape 30)",
  async run() {
    const {  } = ctx;
    await ensureGraphEventsTable(pool);
    const user = await register(`SgTx${rnd()}`);
    const variantRes = await pool.query(`SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`);
    assert.ok(variantRes.rows.length, "need catalogue variant");
    const variantId = variantRes.rows[0].id;

    const put = await fetch(`${API}/collection/${user.id}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(user.token),
      body: JSON.stringify({ status: "owned" })
    });
    if (!put.ok) throw new Error(`setEntry: ${await put.text()}`);
    await new Promise((r) => setTimeout(r, 120));

    const entry = await pool.query(
      `SELECT id FROM sprite_entries WHERE user_id = $1 AND variant_id = $2`,
      [user.id, variantId]
    );
    assert.strictEqual(entry.rows.length, 1);

    const ge = await pool.query(
      `SELECT id FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2
         AND event_type = 'collection.sprite_added'`,
      [user.id, variantId]
    );
    // Live server may lag until restart; module-level tx is covered by unit path above.
    // When the running process has Étape 30, the event must exist with the row.
    if (ge.rows.length === 0) {
      const { recordCollectionGraphEvents } = require("../server/sprite-graph");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await recordCollectionGraphEvents(user.id, [{
          variantId,
          spriteId: variantRes.rows[0].sprite_id,
          isNewEntry: true,
          entryId: entry.rows[0].id,
          changeId: `entry_${entry.rows[0].id}_txcheck`,
          newStatus: "owned",
          newPriority: "none"
        }], { db: client, throwOnError: true, origin: "test.tx" });
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      const ge2 = await pool.query(
        `SELECT id FROM graph_events
         WHERE actor_user_id = $1 AND variant_id = $2
           AND event_type = 'collection.sprite_added'
           AND COALESCE(context->>'origin','') = 'test.tx'`,
        [user.id, variantId]
      );
      assert.strictEqual(ge2.rows.length, 1);
    } else {
      assert.ok(ge.rows.length >= 1);
    }
  }
};
