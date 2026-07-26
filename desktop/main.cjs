const { app, BrowserWindow, protocol, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const APP_SCHEME = "sprite-index";
const APP_HOST = "app";
const STATIC_DIR = path.resolve(__dirname, "..", "www");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://spritedex.onrender.com wss://spritedex.onrender.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'"
].join("; ");

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    allowServiceWorkers: true
  }
}]);

function isAppUrl(requestUrl) {
  try {
    const url = new URL(requestUrl);
    return url.protocol === `${APP_SCHEME}:` &&
      url.hostname === APP_HOST &&
      !url.port &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

function resolveStaticFile(requestUrl) {
  if (!isAppUrl(requestUrl)) {
    throw new Error("Blocked invalid application origin");
  }
  const url = new URL(requestUrl);
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(STATIC_DIR, relativePath);
  if (target !== STATIC_DIR && !target.startsWith(`${STATIC_DIR}${path.sep}`)) {
    throw new Error("Blocked path traversal attempt");
  }
  return target;
}

async function registerStaticProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const file = resolveStaticFile(request.url);
      const type = MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
      return new Response(await fs.readFile(file), {
        headers: {
          "Content-Type": type,
          "Content-Security-Policy": CONTENT_SECURITY_POLICY,
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function isPrivateOrLocalHostname(value) {
  const host = String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return true;
  return host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".home")
    || host.endsWith(".lan")
    || host.endsWith(".test")
    || host === "nip.io"
    || host.endsWith(".nip.io")
    || host === "sslip.io"
    || host.endsWith(".sslip.io")
    || host === "localtest.me"
    || host.endsWith(".localtest.me");
}

function openExternalHttps(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || isPrivateOrLocalHostname(url.hostname)) return;
    shell.openExternal(url.toString()).catch(() => {});
  } catch {
    // Invalid and non-HTTPS destinations stay blocked inside the application.
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0a0e1a",
    title: "SPRITE-INDEX",
    icon: path.join(__dirname, "logoImg", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttps(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalHttps(url);
  });

  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  window.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
}

app.whenReady().then(async () => {
  await registerStaticProtocol();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
