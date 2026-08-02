// Smoke checks for transactional email HTML/text templates.
const assert = require("assert");
const {
  EMAIL_COPY,
  emailCopy,
  emailShell,
  emailText
} = require("../src/app/http/email-templates");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("\nEmail template tests\n");

test("EMAIL_COPY covers fr/en/nl with Fortnite-homage keys", () => {
  for (const lang of ["fr", "en", "nl"]) {
    const copy = EMAIL_COPY[lang];
    assert.ok(copy.verifyHeading);
    assert.ok(copy.resetHeading);
    assert.ok(copy.linkFallback);
    assert.ok(copy.brandTagline);
    assert.ok(copy.brandKicker);
    assert.ok(copy.fanDisclaimer);
    assert.ok(copy.footerNote);
  }
});

test("emailShell renders Fortnite-homage layout with both logos", () => {
  const copy = emailCopy("fr");
  const html = emailShell({
    eyebrow: copy.verifyEyebrow,
    heading: "Confirm <script>alert(1)</script>",
    intro: copy.verifyIntro,
    ctaLabel: copy.verifyCta,
    href: "https://example.com/verify?token=abc&x=1",
    footer: copy.verifyIgnore,
    linkFallback: copy.linkFallback,
    footerNote: copy.footerNote,
    brandTagline: copy.brandTagline,
    brandKicker: copy.brandKicker,
    fanDisclaimer: copy.fanDisclaimer,
    lang: "fr",
    appUrl: "https://sprite-index.example"
  });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /lang="fr"/);
  assert.match(html, /js\/MainLogo\.png/);
  assert.match(html, /LogoApp\.png/);
  assert.match(html, /#f5e04a/);
  assert.match(html, /#00e8ff|#00f1ff/);
  assert.match(html, /font-style:italic/);
  assert.match(html, /Confirm &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /https:\/\/example\.com\/verify\?token=abc&amp;x=1/);
  assert.match(html, /Epic Games/);
  assert.match(html, /Fan-made/);
});

test("emailText includes homage tagline and disclaimer", () => {
  const copy = emailCopy("en");
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
  assert.match(text, /SPRITE-INDEX/);
  assert.match(text, /Loot\. Collect\. Index\./);
  assert.match(text, /Fan-made/);
  assert.match(text, /https:\/\/example\.com\/v/);
  assert.match(text, /Epic Games/);
});

console.log("\nAll email template tests passed.\n");
