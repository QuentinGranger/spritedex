// routes-spa.js — extracted from server.js

const { compareCollectionsServer, getServerCompareCatalogItemsCached, loadCollectionForShare } = require("./compare");
const { getVisibility, hashCapabilityToken } = require("./auth");
const { APP_URL, app, escapeHtml } = require("./core");
const { pool } = require("./db");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = require("path").join(__dirname, "..");

// ── Friend invite link redirect (legacy /invite/:token → /?invite=:token) ──
app.get("/invite/:token", (req, res) => {
  const token = req.params.token;
  res.redirect(302, `${APP_URL}/?invite=${encodeURIComponent(token)}`);
});

// Étape 67 — stable public passport URL /u/:username
app.get("/u/:username", async (req, res) => {
  try {
    const { resolveUsernameSlug } = require("./username-history");
    const resolved = await resolveUsernameSlug(req.params.username);
    if (resolved.status === "redirect") {
      return res.redirect(302, `/u/${encodeURIComponent(resolved.to)}`);
    }
    if (resolved.status === "not_found") {
      return res.status(404).sendFile(path.join(ROOT_DIR, "index.html"));
    }

    const file = path.join(ROOT_DIR, "index.html");
    const username = resolved.user.username;
    const display = resolved.user.display_name || username;
    const title = `${escapeHtml(display)} — Passeport SpriteDex`;
    const description = `Voir le passeport collectionneur de ${escapeHtml(display)} sur SpriteDex.`;
    const image = `${APP_URL}/icon-512.png`;
    const url = `${APP_URL}/u/${encodeURIComponent(username)}`;
    const html = fs.readFileSync(file, "utf8");
    const meta = `<meta property="og:title" content="${title.replace(/"/g, "&quot;")}">
<meta property="og:description" content="${description.replace(/"/g, "&quot;")}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="profile">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title.replace(/"/g, "&quot;")}">
<meta name="twitter:description" content="${description.replace(/"/g, "&quot;")}">
<meta name="twitter:image" content="${image}">
<script>window.__SPRITEDEX_PASSPORT_USER__=${JSON.stringify({
  id: resolved.user.id,
  username: resolved.user.username,
  displayName: resolved.user.display_name || resolved.user.username
})};</script>`;
    res.send(html.replace("</head>", `${meta}\n</head>`));
  } catch (err) {
    console.error("[/u/:username]", err);
    res.sendFile(path.join(ROOT_DIR, "index.html"));
  }
});

// ── SPA routes for shareable compare links ──
app.get("/compare/:userA/:userB", async (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/compare/share/:token", async (req, res) => {
  try {
    const token = req.params.token;
    const file = path.join(ROOT_DIR, "index.html");
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.sendFile(file);
    const tokenHash = hashCapabilityToken(token);
    if (!tokenHash) return res.sendFile(file);

    const shareRes = await pool.query(
      `SELECT t.*, u.username as owner_username, u.collection_visibility, u.visibility
       FROM compare_share_tokens t
       JOIN users u ON u.id = t.owner_user_id
       WHERE t.token = $1 AND t.revoked_at IS NULL
         AND (t.expires_at IS NULL OR t.expires_at > NOW())
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until <= NOW())`,
      [tokenHash]
    );
    if (!shareRes.rows.length) return res.sendFile(file);

    const share = shareRes.rows[0];
    // The social card is a public representation of the bearer link. It
    // must honor a privacy change made after that link was issued.
    if (getVisibility(share).collection === "private") return res.sendFile(file);
    const ownerCollection = share.collection_visible ? await loadCollectionForShare(share.owner_user_id, share) : {};
    const catalogue = await getServerCompareCatalogItemsCached();
    const result = compareCollectionsServer(
      { id: share.owner_user_id, displayName: share.owner_username, collection: ownerCollection },
      { id: "visitor", displayName: "Visiteur", collection: {} },
      catalogue
    );

    const title = `Compare ta collection avec ${escapeHtml(share.owner_username)} — SpriteDex`;
    const description = `Complétion collective : ${result.summary.collectiveCompletionRate}%. Découvre qui manque de quelles variantes sur SpriteDex.`;
    const image = `${APP_URL}/icon-512.png`;
    const url = `${APP_URL}/compare/share/${token}`;

    const html = fs.readFileSync(file, "utf8");
    const meta = `<meta property="og:title" content="${title.replace(/"/g, "&quot;")}">
<meta property="og:description" content="${description.replace(/"/g, "&quot;")}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title.replace(/"/g, "&quot;")}">
<meta name="twitter:description" content="${description.replace(/"/g, "&quot;")}">
<meta name="twitter:image" content="${image}">`;
    res.send(html.replace("</head>", `${meta}\n</head>`));
  } catch (err) {
    console.error("[/compare/share/:token] social card error:", err);
    res.sendFile(path.join(ROOT_DIR, "index.html"));
  }
});
