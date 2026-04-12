import {
  ABUSE_EMAIL,
  COMPANY_NAME,
  LegalLastUpdated,
  LegalList,
  LegalSection,
} from "./primitives";

export function AcceptableUseContent() {
  return (
    <div>
      <LegalLastUpdated />

      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        This Acceptable Use Policy (&ldquo;AUP&rdquo;) describes prohibited
        uses of {COMPANY_NAME} (the &ldquo;Service&rdquo;). It applies to
        everyone who accesses or uses the Service, including authorized
        users, API clients, and AI agents acting on your behalf. Violating
        this AUP is a violation of our Terms of Service.
      </p>

      <LegalSection heading="1. Prohibited Content">
        <p>
          You may not use the Service to upload, create, store, transmit, or
          distribute content that:
        </p>
        <LegalList>
          <li>
            is illegal, infringing, defamatory, obscene, pornographic
            (including sexual content involving minors), or otherwise
            unlawful;
          </li>
          <li>
            sexually exploits, abuses, or endangers children (CSAM), or any
            content that we will report to the National Center for Missing &amp;
            Exploited Children and applicable authorities;
          </li>
          <li>
            promotes violence, terrorism, self-harm, or the illegal
            manufacture of weapons, drugs, or biological agents;
          </li>
          <li>
            is hateful, discriminatory, threatening, harassing, or bullying
            toward any individual or group;
          </li>
          <li>
            infringes copyright, trademark, patent, trade secret, publicity,
            or privacy rights;
          </li>
          <li>
            contains personal or sensitive information of others collected
            without consent (doxxing);
          </li>
          <li>
            is designed to deceive, including phishing, fraud, scams, and
            misleading deepfakes;
          </li>
          <li>
            contains malware, viruses, worms, ransomware, trojans, or other
            malicious code.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="2. Prohibited Conduct">
        <p>You may not use the Service to:</p>
        <LegalList>
          <li>
            probe, scan, or test the vulnerability of the Service or breach
            security or authentication measures without our written
            permission;
          </li>
          <li>
            interfere with or disrupt the Service or servers or networks
            connected to the Service;
          </li>
          <li>
            circumvent any access controls, technical limits, or rate limits;
          </li>
          <li>
            use the Service to build, train, or fine-tune a machine learning
            model that competes with the Service;
          </li>
          <li>
            resell or sublicense the Service without our written consent;
          </li>
          <li>
            harvest, scrape, or mine data from other users&rsquo; accounts or
            from the Service;
          </li>
          <li>
            impersonate any person or entity or misrepresent your affiliation;
          </li>
          <li>
            send bulk unsolicited communications (spam) to any person;
          </li>
          <li>
            engage in cryptocurrency mining, unauthorized stress testing, or
            similar high-load operations without our written approval.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="3. AI Agent Conduct">
        <p>
          When you connect an external AI agent through API tokens or MCP,
          you are responsible for that agent&rsquo;s behavior. Agents must
          comply with this AUP. You must review and approve machine-generated
          write proposals before they are applied. We may suspend connection
          tokens or agents that we reasonably believe are being used in
          violation of this AUP.
        </p>
      </LegalSection>

      <LegalSection heading="4. Reporting Abuse">
        <p>
          If you believe someone is using the Service in violation of this
          AUP, please report it to {ABUSE_EMAIL}. Include as much detail as
          possible: URLs, object IDs, timestamps, and a description of the
          violation. We take reports seriously and investigate promptly.
        </p>
      </LegalSection>

      <LegalSection heading="5. Enforcement">
        <p>
          We may investigate suspected violations, remove or disable access
          to Content, limit or suspend connection tokens, suspend or terminate
          accounts, and cooperate with law enforcement. We may act without
          notice when necessary to protect the Service, our users, or the
          public.
        </p>
      </LegalSection>

      <LegalSection heading="6. Changes">
        <p>
          We may update this AUP from time to time. Your continued use of the
          Service after changes take effect constitutes acceptance.
        </p>
      </LegalSection>
    </div>
  );
}
