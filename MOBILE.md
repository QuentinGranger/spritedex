# SPRITNEX — Native mobile app (Capacitor)

The native iOS/Android apps reuse the exact same web frontend, bundled into a
native shell with [Capacitor](https://capacitorjs.com). Data still comes from the
production API at `https://spritedex.onrender.com` over HTTPS.

## Prerequisites

- **Node ≥ 18** and the project dependencies: `npm install`
- **iOS**: macOS + Xcode + CocoaPods (`sudo gem install cocoapods`), an Apple
  Developer account ($99/yr) to ship to the App Store.
- **Android**: Android Studio + JDK 17, a Google Play account ($25 once) to ship.

## One-time setup

```bash
# 1. Install deps (includes Capacitor)
npm install

# 2. Build the web bundle into ./www and create the native projects
npm run build:www
npx cap add ios
npx cap add android
```

`npx cap add` generates the `ios/` and `android/` folders (gitignored). They are
regenerated from the web bundle + `capacitor.config.json`, so you rarely edit
them directly — except the two deep-link tweaks below (needed once per project).

## Required: register the `spritedex://` deep link

OAuth (Google/Discord) runs in the system browser and returns to the app via a
custom URL scheme (`spritedex://auth?...`). Register it once in each native
project:

### iOS — `ios/App/App/Info.plist`

Add inside the top-level `<dict>`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.spritedex.app</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>spritedex</string>
    </array>
  </dict>
</array>
```

### Android — `android/app/src/main/AndroidManifest.xml`

Inside the main `<activity>` element, add:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="spritedex" android:host="auth" />
</intent-filter>
```

## OAuth provider consoles

Add the production callback URLs (already required for the web app):

- Google: `https://spritedex.onrender.com/api/auth/callback/google`
- Discord: `https://spritedex.onrender.com/api/auth/callback/discord`

No mobile-specific redirect URI is needed: the OAuth flow always redirects to the
server, which then bounces to `spritedex://auth` for native clients.

## Everyday workflow

After any change to the web app (`index.html`, `css/`, `js/`, sprites…):

```bash
npm run cap:sync        # rebuilds www/ and copies it into the native projects
npm run cap:ios         # opens Xcode  (then Run on a simulator/device)
npm run cap:android     # opens Android Studio (then Run)
```

## How it works (code map)

- `js/config.js` — resolves the backend origin. On native it targets
  `PROD_API_ORIGIN`; on web it uses the same origin. Also derives `WS_URL`.
- `js/auth.js` — `startOAuth()` opens the flow in the system browser on native.
- `js/mobile.js` — listens for the `spritedex://auth` deep link and completes
  login via `applyAuthParams()` (shared with the web flow in `js/init.js`).
- `server.js` — the OAuth initiate/callback carry a `return=app` hint (cookie)
  and redirect to `spritedex://auth?...` for native clients.
- `security.js` — CORS allows the Capacitor webview origins.
- `capacitor.config.json` — `appId`, `appName`, `webDir: www`.
- `scripts/build-www.js` — assembles the web bundle into `www/`.

## Notes

- To point the app at a custom domain later, change `PROD_API_ORIGIN` in
  `js/config.js` (or set `window.SPRITEDEX_API_ORIGIN` before scripts load).
- The service worker is disabled inside the native shell (handled automatically).
