// Transactional email copy + HTML/text shells for Resend.
// Visual language: Sprite-Index brand (logo + cyan) with a Fortnite-inspired
// fan homage (storm purple, bold italic type, yellow CTA). Not affiliated
// with Epic Games.

const EMAIL_COPY = Object.freeze({
  fr: Object.freeze({
    brandTagline: "Loot. Collecte. Index.",
    brandKicker: "Créée par des fans · Collection Fortnite",
    verifySubject: "Confirme ton email — SPRITE-INDEX",
    verifyEyebrow: "Mission active",
    verifyHeading: "Confirme ton email pour entrer",
    verifyIntro:
      "Ton compte SPRITE-INDEX est presque prêt. Valide ton adresse pour débloquer ta collection, tes variantes et tes squads.",
    verifyCta: "Confirmer mon email",
    verifyIgnore: "Si tu n’as pas créé de compte, ignore cet email — rien ne sera activé.",
    resetSubject: "Réinitialisation de mot de passe — SPRITE-INDEX",
    resetEyebrow: "Sécurité du compte",
    resetHeading: "Réinitialise ton mot de passe",
    resetIntro:
      "Une demande de réinitialisation a été faite sur ton compte. Ce lien expire dans 1 heure — après, il faudra en demander un nouveau.",
    resetCta: "Choisir un nouveau mot de passe",
    resetIgnore: "Si tu n’es pas à l’origine de cette demande, ignore cet email — ton mot de passe reste inchangé.",
    notifOpen: "Ouvrir SPRITE-INDEX",
    notifEyebrow: "Notification",
    linkFallback: "Le bouton ne fonctionne pas ? Copie ce lien :",
    footerNote: "Ne partage jamais ce lien. Email envoyé par SPRITE-INDEX.",
    fanDisclaimer:
      "SPRITE-INDEX est une application fan de suivi de collection. Elle n’est pas affiliée, sponsorisée ni approuvée par Epic Games. Fortnite est une marque d’Epic Games."
  }),
  en: Object.freeze({
    brandTagline: "Loot. Collect. Index.",
    brandKicker: "Fan-made · Fortnite collection",
    verifySubject: "Confirm your email — SPRITE-INDEX",
    verifyEyebrow: "Mission active",
    verifyHeading: "Confirm your email to drop in",
    verifyIntro:
      "Your SPRITE-INDEX account is almost ready. Confirm your address to unlock your collection, variants, and squads.",
    verifyCta: "Confirm my email",
    verifyIgnore: "If you did not create an account, ignore this email — nothing will be activated.",
    resetSubject: "Password reset — SPRITE-INDEX",
    resetEyebrow: "Account security",
    resetHeading: "Reset your password",
    resetIntro:
      "A password reset was requested for your account. This link expires in 1 hour — after that, request a new one.",
    resetCta: "Choose a new password",
    resetIgnore: "If you did not make this request, ignore this email — your password remains unchanged.",
    notifOpen: "Open SPRITE-INDEX",
    notifEyebrow: "Notification",
    linkFallback: "Button not working? Copy this link:",
    footerNote: "Never share this link. Sent by SPRITE-INDEX.",
    fanDisclaimer:
      "SPRITE-INDEX is a fan-made collection tracker. Not affiliated with, sponsored by, or endorsed by Epic Games. Fortnite is a trademark of Epic Games."
  }),
  nl: Object.freeze({
    brandTagline: "Loot. Verzamel. Index.",
    brandKicker: "Gemaakt door fans · Fortnite-collectie",
    verifySubject: "Bevestig je e-mailadres — SPRITE-INDEX",
    verifyEyebrow: "Missie actief",
    verifyHeading: "Bevestig je e-mail om binnen te komen",
    verifyIntro:
      "Je SPRITE-INDEX-account is bijna klaar. Bevestig je adres om je collectie, varianten en squads te ontgrendelen.",
    verifyCta: "Mijn e-mail bevestigen",
    verifyIgnore: "Heb je geen account aangemaakt? Negeer deze e-mail — er wordt niets geactiveerd.",
    resetSubject: "Wachtwoord opnieuw instellen — SPRITE-INDEX",
    resetEyebrow: "Accountbeveiliging",
    resetHeading: "Stel je wachtwoord opnieuw in",
    resetIntro:
      "Er is een verzoek gedaan om je wachtwoord opnieuw in te stellen. Deze link verloopt over 1 uur — daarna vraag je een nieuwe aan.",
    resetCta: "Nieuw wachtwoord kiezen",
    resetIgnore: "Heb je dit verzoek niet gedaan? Negeer deze e-mail — je wachtwoord blijft ongewijzigd.",
    notifOpen: "SPRITE-INDEX openen",
    notifEyebrow: "Melding",
    linkFallback: "Werkt de knop niet? Kopieer deze link:",
    footerNote: "Deel deze link nooit. Verzonden door SPRITE-INDEX.",
    fanDisclaimer:
      "SPRITE-INDEX is een fan-made collectietracker. Niet gelieerd aan, gesponsord of goedgekeurd door Epic Games. Fortnite is een handelsmerk van Epic Games."
  })
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailLocale(lang) {
  const locale = String(lang || "fr")
    .toLowerCase()
    .slice(0, 2);
  return locale === "en" || locale === "nl" ? locale : "fr";
}

function emailCopy(lang) {
  return EMAIL_COPY[emailLocale(lang)];
}

function emailShell({
  heading,
  intro,
  ctaLabel,
  href,
  footer,
  eyebrow = "",
  linkFallback = "",
  footerNote = "",
  brandTagline = "",
  brandKicker = "",
  fanDisclaimer = "",
  lang = "fr",
  appUrl = "https://sprite-index.app"
} = {}) {
  const preheader = [heading, intro].filter(Boolean).join(" — ");
  const safeHref = escapeHtml(href);
  const base = String(appUrl || "https://sprite-index.app").replace(/\/$/, "");
  // Full wordmark (login logo) + square mascot — both are publicly served.
  const wordmarkUrl = escapeHtml(new URL("/js/MainLogo.png", `${base}/`).toString());
  const mascotUrl = escapeHtml(new URL("/LogoApp.png", `${base}/`).toString());
  const homeUrl = escapeHtml(base);
  const htmlLang = escapeHtml(emailLocale(lang));
  const fontStack = "Impact,'Arial Black','Helvetica Neue',Arial,sans-serif";
  const bodyStack = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>SPRITE-INDEX</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#07041a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07041a;margin:0;padding:0;width:100%;">
    <tr>
      <td align="center" style="padding:0;">
        <!-- Storm / sky atmosphere -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;margin:0 auto;">
          <tr>
            <td style="padding:28px 18px 10px;text-align:center;background:linear-gradient(180deg,#1a0a3e 0%,#0b1230 42%,#07041a 100%);background-color:#12082c;">
              ${brandKicker ? `<p style="margin:0 0 14px;font-family:${bodyStack};font-size:11px;font-weight:800;letter-spacing:0.22em;text-transform:uppercase;color:#f5e04a;">${escapeHtml(brandKicker)}</p>` : ""}
              <a href="${homeUrl}" style="text-decoration:none;display:inline-block;">
                <img src="${wordmarkUrl}" width="320" alt="Sprite-Index" style="display:block;margin:0 auto;width:320px;max-width:88%;height:auto;border:0;">
              </a>
              ${brandTagline ? `<p style="margin:14px 0 0;font-family:${fontStack};font-size:18px;font-style:italic;font-weight:900;letter-spacing:0.06em;text-transform:uppercase;color:#7ef9ff;text-shadow:0 0 18px rgba(0,241,255,0.35);">${escapeHtml(brandTagline)}</p>` : ""}
            </td>
          </tr>

          <!-- Accent stripe (battle-pass bar) -->
          <tr>
            <td style="padding:0 18px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="28%" style="height:6px;line-height:6px;font-size:0;background:#f5e04a;">&nbsp;</td>
                  <td width="44%" style="height:6px;line-height:6px;font-size:0;background:#00f1ff;">&nbsp;</td>
                  <td width="28%" style="height:6px;line-height:6px;font-size:0;background:#9b5cff;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 18px 8px;">
              <!-- Main panel -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;background:#0b1024;border:2px solid #00e8ff;border-radius:6px;overflow:hidden;box-shadow:0 0 0 1px rgba(155,92,255,0.35),0 22px 50px rgba(0,0,0,0.55);">
                <tr>
                  <td style="padding:22px 22px 8px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td width="64" valign="top" style="padding:0 14px 0 0;">
                          <img src="${mascotUrl}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border:2px solid #00e8ff;border-radius:12px;background:#050816;">
                        </td>
                        <td valign="middle" style="font-family:${bodyStack};">
                          ${eyebrow ? `<p style="margin:0 0 4px;font-family:${fontStack};font-size:13px;font-style:italic;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:#f5e04a;">${escapeHtml(eyebrow)}</p>` : ""}
                          <p style="margin:0;font-family:${bodyStack};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#7adfff;">SPRITE-INDEX</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 22px 0;">
                    ${heading ? `<h1 style="margin:0 0 14px;font-family:${fontStack};font-size:30px;line-height:1.05;font-style:italic;font-weight:900;letter-spacing:0.01em;text-transform:uppercase;color:#ffffff;">${escapeHtml(heading)}</h1>` : ""}
                    <p style="margin:0 0 22px;font-family:${bodyStack};font-size:15px;line-height:1.55;color:#b7c7e0;white-space:pre-line;">${escapeHtml(intro || "")}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 22px 20px;" align="center">
                    <!-- Yellow Fortnite-style CTA -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td align="center" bgcolor="#f5e04a" style="border-radius:4px;background:#f5e04a;border:2px solid #ffe96a;box-shadow:0 6px 0 #c4a800;">
                          <a href="${safeHref}" style="display:block;padding:16px 22px;font-family:${fontStack};font-size:20px;font-style:italic;font-weight:900;letter-spacing:0.04em;text-transform:uppercase;color:#1a1200;text-decoration:none;text-align:center;">${escapeHtml(ctaLabel || "")}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${
                  linkFallback
                    ? `
                <tr>
                  <td style="padding:0 22px 18px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(0,232,255,0.06);border:1px solid rgba(0,232,255,0.18);border-radius:4px;">
                      <tr>
                        <td style="padding:12px 14px;font-family:${bodyStack};">
                          <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#8bfbdf;">${escapeHtml(linkFallback)}</p>
                          <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;">
                            <a href="${safeHref}" style="color:#7adfff;text-decoration:underline;">${safeHref}</a>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`
                    : ""
                }
                ${
                  footer
                    ? `
                <tr>
                  <td style="padding:0 22px 8px;font-family:${bodyStack};">
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#8093b0;">${escapeHtml(footer)}</p>
                  </td>
                </tr>`
                    : ""
                }
                <tr>
                  <td style="padding:14px 22px 20px;border-top:1px solid rgba(255,255,255,0.07);font-family:${bodyStack};">
                    <p style="margin:0;font-size:11px;line-height:1.5;color:#667892;">${escapeHtml(footerNote || "SPRITE-INDEX")}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 22px 28px;text-align:center;font-family:${bodyStack};">
              ${fanDisclaimer ? `<p style="margin:0 0 12px;font-size:10px;line-height:1.5;color:#5a6f8c;">${escapeHtml(fanDisclaimer)}</p>` : ""}
              <a href="${homeUrl}" style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#7adfff;text-decoration:none;">sprite-index</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailText({
  heading,
  intro,
  ctaLabel,
  href,
  footer,
  eyebrow = "",
  linkFallback = "",
  footerNote = "",
  brandTagline = "",
  brandKicker = "",
  fanDisclaimer = ""
} = {}) {
  return [
    "SPRITE-INDEX",
    brandKicker ? String(brandKicker) : null,
    brandTagline ? String(brandTagline) : null,
    "",
    eyebrow ? String(eyebrow) : null,
    heading ? String(heading) : null,
    heading || eyebrow ? "" : null,
    String(intro || ""),
    "",
    `${String(ctaLabel || "")}: ${href}`,
    linkFallback ? "" : null,
    linkFallback ? String(linkFallback) : null,
    linkFallback ? String(href) : null,
    "",
    footer ? String(footer) : null,
    footerNote ? String(footerNote) : null,
    fanDisclaimer ? "" : null,
    fanDisclaimer ? String(fanDisclaimer) : null
  ]
    .filter((value) => value !== null)
    .join("\n");
}

module.exports = {
  EMAIL_COPY,
  emailCopy,
  emailLocale,
  emailShell,
  emailText,
  escapeHtml
};
