// tail.js — extracted from server.js

const { app, server } = require("./core");
const path = require("path");

const ROOT_DIR = require("path").join(__dirname, "..");

// ── 404 handler ──
// Reached only when no route or static asset matched. API paths get a clean
// JSON 404; everything else gets the themed 404.html page (status 404).
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Ressource introuvable" });
  }
  res.status(404).sendFile(path.join(ROOT_DIR, "404.html"));
});

// ── Global error handler ──
// Catches malformed JSON bodies, payload-too-large errors and any unexpected
// errors, returning a clean JSON message. Stack traces are never sent to the
// client (they are only logged server-side).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Requête trop volumineuse" });
  }
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "JSON invalide" });
  }
  console.error("[UNHANDLED]", err);
  res.status(500).json({ error: "Erreur serveur" });
});
