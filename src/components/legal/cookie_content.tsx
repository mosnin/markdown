import {
  LegalLastUpdated,
  LegalList,
  LegalSection,
  PRIVACY_EMAIL,
} from "./primitives";

export function CookieContent() {
  return (
    <div>
      <LegalLastUpdated />

      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        This Cookie Policy explains how Poggle uses cookies and similar
        technologies. It supplements our Privacy Policy.
      </p>

      <LegalSection heading="1. What Are Cookies?">
        <p>
          Cookies are small text files stored on your device by your browser
          when you visit a website. They are widely used to make websites
          work, to remember preferences, and to understand how the website is
          used. Similar technologies include local storage, session storage,
          and web beacons.
        </p>
      </LegalSection>

      <LegalSection heading="2. Types of Cookies We Use">
        <LegalList>
          <li>
            <strong>Strictly necessary cookies</strong> are required for the
            Service to function: authentication, session management, load
            balancing, and security. You cannot opt out of these without
            breaking the Service.
          </li>
          <li>
            <strong>Preference cookies</strong> remember choices you make
            (such as light or dark theme, collapsed sidebar state, and
            language).
          </li>
          <li>
            <strong>Analytics cookies</strong> help us understand how the
            Service is used, which pages are most visited, and where errors
            occur. We use these to improve the Service.
          </li>
        </LegalList>
        <p>
          We do not use advertising cookies, behavioral retargeting, or
          cross-site tracking for advertising purposes.
        </p>
      </LegalSection>

      <LegalSection heading="3. Third-Party Cookies">
        <p>
          Some cookies are set by third-party services we integrate, such as
          our authentication provider (Supabase) and payment processor.
          These third parties are independently responsible for their own
          cookies and privacy practices.
        </p>
      </LegalSection>

      <LegalSection heading="4. How to Control Cookies">
        <p>
          You can control and delete cookies through your browser settings.
          Most browsers let you refuse or accept cookies, delete existing
          cookies, or be notified before a cookie is stored. Note that
          blocking strictly necessary cookies will prevent core Service
          features, including login, from working.
        </p>
        <p>
          Where required by law, we will ask for your consent before placing
          non-essential cookies.
        </p>
      </LegalSection>

      <LegalSection heading="5. Changes">
        <p>
          We may update this Cookie Policy from time to time. The
          &ldquo;Last updated&rdquo; date at the top of this page will reflect
          any changes.
        </p>
      </LegalSection>

      <LegalSection heading="6. Contact">
        <p>
          Questions about cookies? Email {PRIVACY_EMAIL}.
        </p>
      </LegalSection>
    </div>
  );
}
