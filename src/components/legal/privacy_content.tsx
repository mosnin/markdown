import {
  COMPANY_LEGAL_NAME,
  COMPANY_NAME,
  LegalLastUpdated,
  LegalList,
  LegalSection,
  LegalSubsection,
  PRIVACY_EMAIL,
} from "./primitives";

export function PrivacyContent() {
  return (
    <div>
      <LegalLastUpdated />

      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        This Privacy Policy explains how {COMPANY_LEGAL_NAME} (&ldquo;we,&rdquo;
        &ldquo;us,&rdquo; or &ldquo;our&rdquo;) collects, uses, discloses, and
        protects personal information when you use {COMPANY_NAME} (the
        &ldquo;Service&rdquo;). By using the Service, you consent to the
        practices described here. If you do not agree, do not use the Service.
      </p>

      <LegalSection heading="1. Information We Collect">
        <LegalSubsection heading="Information you provide">
          <LegalList>
            <li>
              <strong>Account data</strong>: email address, password hash,
              display name, and optional profile details.
            </li>
            <li>
              <strong>Billing data</strong>: name, billing address, and payment
              method details (processed and stored by our payment processor; we
              do not store full card numbers).
            </li>
            <li>
              <strong>Content</strong>: notes, files, skills, agents, folders,
              boxes, links, imports, exports, and any other content you create
              or upload.
            </li>
            <li>
              <strong>Communications</strong>: support tickets, emails, and
              feedback you send to us.
            </li>
            <li>
              <strong>Connection tokens</strong>: the name and scope you set
              for external API or MCP connections you create.
            </li>
          </LegalList>
        </LegalSubsection>

        <LegalSubsection heading="Information collected automatically">
          <LegalList>
            <li>
              <strong>Usage data</strong>: pages viewed, actions taken,
              timestamps, approximate location derived from IP, device type,
              browser, and operating system.
            </li>
            <li>
              <strong>Log and diagnostic data</strong>: IP address, request
              headers, error traces, and performance metrics.
            </li>
            <li>
              <strong>Audit events</strong>: an append-only record of writes,
              lifecycle changes, rollbacks, proposal approvals, and similar
              actions performed on your account.
            </li>
            <li>
              <strong>Cookies and similar technologies</strong>: authentication
              cookies, preference cookies, and limited analytics tracking as
              described in our Cookie Policy.
            </li>
          </LegalList>
        </LegalSubsection>

        <LegalSubsection heading="Information from third parties">
          <p>
            We may receive limited information from third-party services you
            choose to use, such as authentication providers, payment
            processors, and AI model providers. We only receive what is
            necessary to provide the Service and never receive the content of
            your communications with AI providers unless you send it through
            the Service.
          </p>
        </LegalSubsection>
      </LegalSection>

      <LegalSection heading="2. How We Use Information">
        <p>We use the information we collect to:</p>
        <LegalList>
          <li>operate, maintain, secure, and improve the Service;</li>
          <li>authenticate you and prevent unauthorized access;</li>
          <li>
            process payments, renewals, cancellations, and refunds;
          </li>
          <li>
            respond to your requests, provide support, and communicate
            important service notices;
          </li>
          <li>
            detect, investigate, and prevent fraud, abuse, and security
            incidents;
          </li>
          <li>comply with legal obligations and enforce our Terms;</li>
          <li>
            with your consent, send product updates, tips, and marketing
            communications (which you can opt out of at any time).
          </li>
        </LegalList>
        <p>
          We do not use your Content to train machine learning models. We do
          not sell your personal information. We do not share your Content
          with third parties except as strictly necessary to operate the
          Service, as described below, or as required by law.
        </p>
      </LegalSection>

      <LegalSection heading="3. Legal Bases (EEA/UK)">
        <p>
          If you are in the European Economic Area, the United Kingdom, or
          Switzerland, we rely on one or more of the following legal bases to
          process your personal data under the GDPR or UK GDPR:
        </p>
        <LegalList>
          <li>
            <strong>Contract</strong>: to provide the Service you requested.
          </li>
          <li>
            <strong>Legitimate interests</strong>: to secure, improve, and
            operate the Service, provided these interests do not override your
            rights.
          </li>
          <li>
            <strong>Consent</strong>: for optional communications and certain
            cookies.
          </li>
          <li>
            <strong>Legal obligation</strong>: to comply with applicable law
            and respond to lawful requests.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="4. How We Share Information">
        <p>
          We share personal information only as described in this policy. We
          do not sell personal information.
        </p>
        <LegalList>
          <li>
            <strong>Service providers (processors)</strong>: we use trusted
            third parties to provide hosting (Supabase), authentication, email
            delivery, payment processing, analytics, and customer support.
            They are contractually bound to protect your data and use it only
            on our instructions.
          </li>
          <li>
            <strong>Legal and safety</strong>: we may disclose information if
            required by law, subpoena, court order, or government request, or
            to protect the rights, property, or safety of{" "}
            {COMPANY_LEGAL_NAME}, our users, or the public.
          </li>
          <li>
            <strong>Business transfers</strong>: if we are involved in a
            merger, acquisition, financing, reorganization, bankruptcy, or
            sale of assets, your information may be transferred as part of
            that transaction. We will notify you of any change in ownership or
            use of your personal information.
          </li>
          <li>
            <strong>With your direction</strong>: when you connect the Service
            to third-party services (such as AI agents over MCP or API), we
            share the data you direct us to share within the scope you
            authorize.
          </li>
          <li>
            <strong>Aggregated or de-identified data</strong>: we may share
            aggregated or de-identified data that cannot reasonably be used to
            identify you.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="5. International Data Transfers">
        <p>
          We may process personal data in the United States and other
          countries that may have different data protection laws than your
          country. When we transfer personal data from the EEA, UK, or
          Switzerland, we rely on lawful transfer mechanisms such as the
          European Commission&rsquo;s Standard Contractual Clauses, supplemented
          by additional safeguards where required.
        </p>
      </LegalSection>

      <LegalSection heading="6. Data Retention">
        <p>
          We retain personal data for as long as your account is active or as
          needed to provide the Service. When you delete Content, we delete it
          from our active systems promptly and from backups in the ordinary
          course. We may retain certain information longer where required by
          law, for audit and security purposes, to resolve disputes, or to
          enforce our agreements. Version history and audit logs are retained
          according to the retention windows described in the Service.
        </p>
      </LegalSection>

      <LegalSection heading="7. Security">
        <p>
          We implement reasonable administrative, technical, and physical
          safeguards designed to protect personal data, including encryption
          in transit, encryption at rest for stored content, access controls,
          audit logging, and regular security reviews. No system is perfectly
          secure, however, and we cannot guarantee the security of
          information transmitted to or stored by the Service. You are
          responsible for keeping your account credentials confidential and
          for the security of your own devices.
        </p>
      </LegalSection>

      <LegalSection heading="8. Your Rights">
        <p>
          Depending on where you live, you may have the following rights with
          respect to your personal data:
        </p>
        <LegalList>
          <li>
            <strong>Access</strong> the personal data we hold about you.
          </li>
          <li>
            <strong>Correction</strong> of inaccurate or incomplete data.
          </li>
          <li>
            <strong>Deletion</strong> of your personal data, subject to legal
            exceptions.
          </li>
          <li>
            <strong>Portability</strong>: receive your data in a structured,
            commonly used, machine-readable format (export is built into the
            Service).
          </li>
          <li>
            <strong>Restriction</strong> or <strong>objection</strong> to
            certain processing.
          </li>
          <li>
            <strong>Withdraw consent</strong> where processing is based on
            consent.
          </li>
          <li>
            <strong>Lodge a complaint</strong> with a data protection
            authority.
          </li>
        </LegalList>
        <p>
          To exercise these rights, contact us at {PRIVACY_EMAIL}. We may
          verify your identity before fulfilling your request. We will respond
          within the timeframe required by applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="9. California Residents (CCPA/CPRA)">
        <p>
          If you are a California resident, you have the right to know what
          personal information we collect, use, disclose, and retain, to
          request deletion, to correct inaccurate information, to opt out of
          any &ldquo;sale&rdquo; or &ldquo;sharing&rdquo; of personal
          information (we do neither), and to limit the use of
          &ldquo;sensitive personal information.&rdquo; You also have the
          right not to be discriminated against for exercising these rights.
          To exercise them, contact us at {PRIVACY_EMAIL}.
        </p>
      </LegalSection>

      <LegalSection heading="10. Children">
        <p>
          The Service is not directed to children under 16. We do not
          knowingly collect personal information from children under 16. If
          you believe a child has provided us with personal information,
          contact us at {PRIVACY_EMAIL} and we will take steps to delete it.
        </p>
      </LegalSection>

      <LegalSection heading="11. Automated Decision-Making">
        <p>
          We do not use automated decision-making that produces legal or
          similarly significant effects on you without human involvement.
        </p>
      </LegalSection>

      <LegalSection heading="12. Do Not Track">
        <p>
          We do not currently respond to &ldquo;Do Not Track&rdquo; browser
          signals because no consistent industry standard has been adopted.
          You can control cookies through your browser settings; see our
          Cookie Policy for details.
        </p>
      </LegalSection>

      <LegalSection heading="13. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. If we make
          material changes, we will notify you by email or through the
          Service. Your continued use of the Service after the effective date
          constitutes acceptance of the updated policy.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact">
        <p>
          For privacy questions or to exercise your rights, contact us at{" "}
          {PRIVACY_EMAIL}.
        </p>
      </LegalSection>
    </div>
  );
}
