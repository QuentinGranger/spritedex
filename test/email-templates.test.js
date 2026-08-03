// Smoke checks for transactional email HTML/text templates.
const assert = require("assert");
const { EMAIL_COPY, emailCopy, emailLocale, emailShell, emailText } = require("../src/app/http/email-templates");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const REQUIRED_KEYS = [
  "brandTagline",
  "brandKicker",
  "verifySubject",
  "verifyEyebrow",
  "verifyHeading",
  "verifyIntro",
  "verifyCta",
  "verifyIgnore",
  "resetSubject",
  "resetEyebrow",
  "resetHeading",
  "resetIntro",
  "resetCta",
  "resetIgnore",
  "notifOpen",
  "notifEyebrow",
  "linkFallback",
  "footerNote",
  "fanDisclaimer"
];

console.log("\nEmail template tests\n");

test("EMAIL_COPY has identical key sets for fr/en/nl", () => {
  const frKeys = Object.keys(EMAIL_COPY.fr).sort();
  assert.deepStrictEqual(Object.keys(EMAIL_COPY.en).sort(), frKeys);
  assert.deepStrictEqual(Object.keys(EMAIL_COPY.nl).sort(), frKeys);
  for (const key of REQUIRED_KEYS) {
    assert.ok(EMAIL_COPY.fr[key], `missing fr.${key}`);
    assert.ok(EMAIL_COPY.en[key], `missing en.${key}`);
    assert.ok(EMAIL_COPY.nl[key], `missing nl.${key}`);
  }
});

test("fr/en/nl verify subjects and CTAs are localized", () => {
  assert.match(EMAIL_COPY.fr.verifySubject, /Confirme/);
  assert.match(EMAIL_COPY.en.verifySubject, /Confirm/);
  assert.match(EMAIL_COPY.nl.verifySubject, /Bevestig/);
  assert.match(EMAIL_COPY.fr.verifyCta, /Confirmer/);
  assert.match(EMAIL_COPY.en.verifyCta, /Confirm my email/);
  assert.match(EMAIL_COPY.nl.verifyCta, /bevestigen/i);
  assert.notStrictEqual(EMAIL_COPY.fr.verifyIntro, EMAIL_COPY.en.verifyIntro);
  assert.notStrictEqual(EMAIL_COPY.fr.verifyIntro, EMAIL_COPY.nl.verifyIntro);
  assert.notStrictEqual(EMAIL_COPY.en.resetHeading, EMAIL_COPY.nl.resetHeading);
});

test("emailLocale maps language tags to fr/en/nl", () => {
  assert.strictEqual(emailLocale("fr-FR"), "fr");
  assert.strictEqual(emailLocale("en-US"), "en");
  assert.strictEqual(emailLocale("nl-NL"), "nl");
  assert.strictEqual(emailLocale("nl-BE"), "nl");
  assert.strictEqual(emailLocale("de"), "fr");
});

test("emailShell renders each locale with matching lang attribute", () => {
  for (const lang of ["fr", "en", "nl"]) {
    const copy = emailCopy(lang);
    const html = emailShell({
      eyebrow: copy.verifyEyebrow,
      heading: copy.verifyHeading,
      intro: copy.verifyIntro,
      ctaLabel: copy.verifyCta,
      href: "https://example.com/verify",
      footer: copy.verifyIgnore,
      linkFallback: copy.linkFallback,
      footerNote: copy.footerNote,
      brandTagline: copy.brandTagline,
      brandKicker: copy.brandKicker,
      fanDisclaimer: copy.fanDisclaimer,
      lang,
      appUrl: "https://sprite-index.example"
    });
    assert.match(html, new RegExp(`lang="${lang}"`));
    assert.match(html, /js\/MainLogo\.png/);
    assert.match(html, /LogoApp\.png/);
    assert.ok(html.includes(copy.verifyHeading));
    assert.ok(html.includes(copy.verifyCta));
    assert.ok(html.includes(copy.fanDisclaimer));
  }
});

test("emailText is localized per language", () => {
  for (const lang of ["fr", "en", "nl"]) {
    const copy = emailCopy(lang);
    const text = emailText({
      eyebrow: copy.verifyEyebrow,
      heading: copy.verifyHeading,
      intro: copy.verifyIntro,
      ctaLabel: copy.verifyCta,
      href: "https://example.com/v",
      footer: copy.verifyIgnore,
      linkFallback: copy.linkFallback,
      footerNote: copy.footerNote,
      brandTagline: copy.brandTagline,
      brandKicker: copy.brandKicker,
      fanDisclaimer: copy.fanDisclaimer
    });
    assert.ok(text.includes(copy.verifyHeading));
    assert.ok(text.includes(copy.fanDisclaimer));
  }
});

console.log("\nAll email template tests passed.\n");
