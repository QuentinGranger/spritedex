// routes-spa.js — extracted from server.js

const { compareCollectionsServer, getServerCompareCatalogItemsCached, loadCollectionForShare } = require("./compare");
const { getVisibility, hashCapabilityToken } = require("./auth");
const { APP_URL, app, escapeHtml } = require("./core");
const { pool } = require("./db");
const { renderIndexPage } = require("../scripts/index-page");

function sendIndexPage(res, status) {
  if (status) res.status(status);
  return res.type("html").send(renderIndexPage());
}

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
      return sendIndexPage(res, 404);
    }

    const username = resolved.user.username;
    const display = resolved.user.display_name || username;
    const title = `${escapeHtml(display)} — Passeport sprite-index`;
    const description = `Voir le passeport collectionneur de ${escapeHtml(display)} sur sprite-index.`;
    const image = `${APP_URL}/icon-512.png`;
    const url = `${APP_URL}/u/${encodeURIComponent(username)}`;
    const html = renderIndexPage();
    const meta = `<meta property="og:title" content="${title.replace(/"/g, "&quot;")}">
<meta property="og:description" content="${description.replace(/"/g, "&quot;")}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="profile">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title.replace(/"/g, "&quot;")}">
<meta name="twitter:description" content="${description.replace(/"/g, "&quot;")}">
<meta name="twitter:image" content="${image}">
<script>window.__SPRITE_INDEX_PASSPORT_USER__=${JSON.stringify({
      id: resolved.user.id,
      username: resolved.user.username,
      displayName: resolved.user.display_name || resolved.user.username
    })};</script>`;
    res.type("html").send(html.replace("</head>", `${meta}\n</head>`));
  } catch (err) {
    console.error("[/u/:username]", err);
    sendIndexPage(res);
  }
});

// ── SPA routes for shareable compare links ──
app.get("/compare/:userA/:userB", async (req, res) => {
  sendIndexPage(res);
});

app.get("/compare/share/:token", async (req, res) => {
  try {
    const token = req.params.token;
    if (!/^[a-f0-9]{64}$/i.test(token)) return sendIndexPage(res);
    const tokenHash = hashCapabilityToken(token);
    if (!tokenHash) return sendIndexPage(res);

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
    if (!shareRes.rows.length) return sendIndexPage(res);

    const share = shareRes.rows[0];
    // The social card is a public representation of the bearer link. It
    // must honor a privacy change made after that link was issued.
    if (getVisibility(share).collection === "private") return sendIndexPage(res);
    const ownerCollection = share.collection_visible ? await loadCollectionForShare(share.owner_user_id, share) : {};
    const catalogue = await getServerCompareCatalogItemsCached();
    const result = compareCollectionsServer(
      { id: share.owner_user_id, displayName: share.owner_username, collection: ownerCollection },
      { id: "visitor", displayName: "Visiteur", collection: {} },
      catalogue
    );

    const title = `Compare ta collection avec ${escapeHtml(share.owner_username)} — sprite-index`;
    const description = `Complétion collective : ${result.summary.collectiveCompletionRate}%. Découvre qui manque de quelles variantes sur sprite-index.`;
    const image = `${APP_URL}/icon-512.png`;
    const url = `${APP_URL}/compare/share/${token}`;

    const html = renderIndexPage();
    const meta = `<meta property="og:title" content="${title.replace(/"/g, "&quot;")}">
<meta property="og:description" content="${description.replace(/"/g, "&quot;")}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title.replace(/"/g, "&quot;")}">
<meta name="twitter:description" content="${description.replace(/"/g, "&quot;")}">
<meta name="twitter:image" content="${image}">`;
    res.type("html").send(html.replace("</head>", `${meta}\n</head>`));
  } catch (err) {
    console.error("[/compare/share/:token] social card error:", err);
    sendIndexPage(res);
  }
});
