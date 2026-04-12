import {
  COMPANY_LEGAL_NAME,
  COMPANY_NAME,
  CONTACT_EMAIL,
  LegalLastUpdated,
  LegalList,
  LegalSection,
  SUPPORT_EMAIL,
} from "./primitives";

export function TermsContent() {
  return (
    <div>
      <LegalLastUpdated />

      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        These Terms of Service (the &ldquo;Terms&rdquo;) govern your access to and
        use of {COMPANY_NAME} (the &ldquo;Service&rdquo;), operated by{" "}
        {COMPANY_LEGAL_NAME} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;). By creating an account, accessing, or using the
        Service, you agree to be bound by these Terms and our Privacy Policy. If
        you do not agree, do not access or use the Service.
      </p>

      <LegalSection heading="1. Eligibility and Account Registration">
        <p>
          You must be at least 16 years old (or the age of digital consent in
          your jurisdiction, whichever is higher) and have the legal capacity to
          enter into a binding contract. If you use the Service on behalf of an
          organization, you represent that you have authority to bind that
          organization to these Terms, and &ldquo;you&rdquo; refers to that
          organization.
        </p>
        <p>
          You agree to provide accurate, current, and complete information when
          creating an account, and to update it promptly if it changes. You are
          responsible for all activity that occurs under your account,
          including keeping your credentials confidential. You must notify us
          immediately at {SUPPORT_EMAIL} of any unauthorized access or suspected
          breach.
        </p>
      </LegalSection>

      <LegalSection heading="2. The Service">
        <p>
          {COMPANY_NAME} is a structured context store for AI workflows. It
          lets you create, organize, link, and export notes, files, skills,
          agents, and folders, and grants programmatic access via REST API and
          the Model Context Protocol (MCP). Features, limits, and pricing may
          change over time. We may add, modify, or remove features at our sole
          discretion, and we may release experimental or beta functionality
          that carries no warranty and may be discontinued at any time.
        </p>
      </LegalSection>

      <LegalSection heading="3. Subscriptions, Billing, and Payment">
        <p>
          Paid plans are billed in advance on a monthly or annual basis through
          our payment processor. By subscribing, you authorize us to charge the
          payment method you provide for the applicable fees, any taxes, and
          any other charges incurred. All fees are non-refundable except as
          expressly stated in our Refund Policy.
        </p>
        <p>
          Subscriptions automatically renew at the end of each billing period
          at the then-current rates unless you cancel before the renewal date.
          You may cancel at any time through your account settings. If a
          payment fails, we may suspend or downgrade your account until
          payment is resolved. We may change prices, plan features, or billing
          intervals with at least thirty (30) days&rsquo; notice, which will
          apply at the start of the next billing period.
        </p>
        <p>
          You are responsible for all applicable taxes, including VAT, GST,
          sales tax, and similar charges, except for taxes imposed on our net
          income. Prices shown are exclusive of such taxes unless stated
          otherwise.
        </p>
      </LegalSection>

      <LegalSection heading="4. Free Plan and Plan Limits">
        <p>
          The free plan is subject to usage limits which may change over time.
          Exceeding limits may result in restricted functionality (such as
          blocking new writes) until you upgrade or reduce usage. We do not
          guarantee the availability or permanence of the free plan.
        </p>
      </LegalSection>

      <LegalSection heading="5. Your Content">
        <p>
          You retain all ownership of the content you create, upload, or import
          to the Service (your &ldquo;Content&rdquo;). You grant{" "}
          {COMPANY_LEGAL_NAME} a worldwide, non-exclusive, royalty-free,
          transferable license to host, store, copy, transmit, display, and
          create necessary derivative works of your Content solely to operate,
          maintain, secure, and improve the Service, to provide support, and to
          comply with legal obligations. This license ends when you delete your
          Content or close your account, except that we may retain copies as
          required by law or in backup systems for a reasonable period.
        </p>
        <p>
          You represent and warrant that (a) you own or have the necessary
          rights to your Content, (b) your Content and our use of it under
          these Terms does not violate any law or third-party right, and (c)
          you are solely responsible for the accuracy, quality, legality, and
          appropriateness of your Content.
        </p>
        <p>
          We do not train machine learning models on your Content. We do not
          sell your Content. We do not share your Content with third parties
          except as strictly necessary to operate the Service (for example,
          with our infrastructure, payment, and analytics processors) or as
          required by law.
        </p>
      </LegalSection>

      <LegalSection heading="6. Acceptable Use">
        <p>You agree not to, and not to permit any third party to:</p>
        <LegalList>
          <li>
            violate any applicable law, regulation, or third-party right;
          </li>
          <li>
            upload, store, or transmit Content that is illegal, infringing,
            defamatory, obscene, harassing, threatening, hateful, or otherwise
            objectionable;
          </li>
          <li>
            upload, store, or transmit malware, viruses, worms, trojans,
            ransomware, or any other malicious code;
          </li>
          <li>
            probe, scan, or test the vulnerability of the Service, or breach or
            circumvent any security or authentication measures;
          </li>
          <li>
            interfere with, disrupt, or impose an unreasonable load on the
            Service, our infrastructure, or any user&rsquo;s use of the
            Service;
          </li>
          <li>
            reverse engineer, decompile, disassemble, or attempt to derive the
            source code of the Service except to the extent expressly permitted
            by applicable law;
          </li>
          <li>
            use the Service to build a competing product or to train machine
            learning models that compete with us;
          </li>
          <li>
            resell, sublicense, or commercially exploit the Service without
            our prior written consent;
          </li>
          <li>
            impersonate any person or entity or misrepresent your affiliation
            with any person or entity;
          </li>
          <li>
            collect or harvest personal data of other users or any other party
            without consent;
          </li>
          <li>
            send unsolicited commercial messages (spam) or engage in phishing,
            fraud, or deceptive practices;
          </li>
          <li>
            use automated means to access the Service in a manner that
            interferes with normal operation or circumvents rate limits.
          </li>
        </LegalList>
        <p>
          We may investigate and take action against suspected violations,
          including removing Content, suspending or terminating accounts, and
          cooperating with law enforcement. We are not required to monitor
          Content, but we reserve the right to do so.
        </p>
      </LegalSection>

      <LegalSection heading="7. AI, Machine Writes, and Write Proposals">
        <p>
          The Service allows you to authorize external AI agents to read from
          and propose writes to your Content through connection tokens and the
          MCP adapter. You are responsible for the credentials you issue, the
          agents you connect, and any actions those agents take within the
          scope you grant. You acknowledge that AI outputs may be inaccurate,
          incomplete, or misleading, and that you are solely responsible for
          reviewing and approving any proposed changes before they are applied.
          We are not responsible for the behavior of third-party AI models or
          agents.
        </p>
      </LegalSection>

      <LegalSection heading="8. Intellectual Property">
        <p>
          The Service, including its software, design, graphics, text,
          documentation, and all other components (excluding your Content), is
          owned by {COMPANY_LEGAL_NAME} or its licensors and is protected by
          copyright, trademark, and other intellectual property laws. We grant
          you a limited, non-exclusive, non-transferable, revocable license to
          access and use the Service in accordance with these Terms. All rights
          not expressly granted are reserved.
        </p>
        <p>
          &ldquo;{COMPANY_NAME}&rdquo; and our logos are trademarks of{" "}
          {COMPANY_LEGAL_NAME}. You may not use them without our prior written
          consent.
        </p>
      </LegalSection>

      <LegalSection heading="9. Feedback">
        <p>
          If you submit ideas, suggestions, or feedback about the Service, you
          grant us a perpetual, irrevocable, royalty-free, worldwide license to
          use, reproduce, modify, and incorporate such feedback into the
          Service and our business, without compensation or attribution.
        </p>
      </LegalSection>

      <LegalSection heading="10. Third-Party Services">
        <p>
          The Service may link to or integrate with third-party services (such
          as Supabase, payment processors, and AI model providers). Your use of
          those services is governed by their own terms and privacy policies.
          We are not responsible for the availability, accuracy, or practices
          of third-party services.
        </p>
      </LegalSection>

      <LegalSection heading="11. Copyright and DMCA">
        <p>
          We respect the intellectual property rights of others. If you
          believe your copyrighted work has been copied and posted on the
          Service in a way that constitutes infringement, please send a notice
          under the Digital Millennium Copyright Act (DMCA) to our designated
          agent, including all required information. Repeat infringers will
          have their accounts terminated. See our DMCA Policy for details.
        </p>
      </LegalSection>

      <LegalSection heading="12. Suspension and Termination">
        <p>
          You may cancel your account at any time through your account
          settings. We may suspend or terminate your access, with or without
          notice, if we reasonably believe you have violated these Terms, if
          your account poses a security or legal risk to us or to others, if
          required by law, or if your payment method fails.
        </p>
        <p>
          Upon termination, your right to use the Service ends immediately.
          You may export your Content before termination. After termination,
          we may retain your Content for a limited period to allow export or
          to comply with law, after which it may be permanently deleted.
          Sections that by their nature should survive (including payment
          obligations, Your Content license for retained copies, disclaimers,
          indemnification, limitation of liability, and dispute resolution)
          will survive termination.
        </p>
      </LegalSection>

      <LegalSection heading="13. Disclaimers">
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
          AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS,
          IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING WITHOUT LIMITATION
          IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
          PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE
          SERVICE WILL BE UNINTERRUPTED, SECURE, ERROR-FREE, OR FREE FROM DATA
          LOSS. YOU USE THE SERVICE AT YOUR OWN RISK.
        </p>
        <p>
          WITHOUT LIMITING THE ABOVE, WE MAKE NO WARRANTY AS TO THE ACCURACY,
          COMPLETENESS, OR RELIABILITY OF ANY AI OUTPUT, SEARCH RESULT,
          CONTEXT BUNDLE, EXPORT, OR OTHER DATA PRODUCED BY OR THROUGH THE
          SERVICE. SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OF CERTAIN
          WARRANTIES, SO SOME OF THE ABOVE EXCLUSIONS MAY NOT APPLY TO YOU.
        </p>
      </LegalSection>

      <LegalSection heading="14. Limitation of Liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL{" "}
          {COMPANY_LEGAL_NAME.toUpperCase()}, ITS AFFILIATES, OFFICERS,
          DIRECTORS, EMPLOYEES, AGENTS, OR LICENSORS BE LIABLE FOR ANY
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE
          DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR
          BUSINESS OPPORTUNITY, ARISING OUT OF OR RELATING TO THESE TERMS OR
          YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
          DAMAGES.
        </p>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL AGGREGATE LIABILITY
          ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE WILL NOT
          EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID US IN THE TWELVE (12)
          MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM OR
          (B) ONE HUNDRED U.S. DOLLARS (US$100).
        </p>
        <p>
          SOME JURISDICTIONS DO NOT ALLOW THE LIMITATION OR EXCLUSION OF
          LIABILITY FOR INCIDENTAL OR CONSEQUENTIAL DAMAGES, SO THE ABOVE
          LIMITATIONS MAY NOT APPLY TO YOU. IN THOSE JURISDICTIONS, OUR
          LIABILITY IS LIMITED TO THE GREATEST EXTENT PERMITTED BY LAW.
        </p>
      </LegalSection>

      <LegalSection heading="15. Indemnification">
        <p>
          You agree to defend, indemnify, and hold harmless{" "}
          {COMPANY_LEGAL_NAME}, its affiliates, officers, directors, employees,
          and agents from and against any and all claims, liabilities, damages,
          losses, and expenses (including reasonable attorneys&rsquo; fees)
          arising out of or in any way connected with (a) your Content, (b)
          your use or misuse of the Service, (c) your violation of these
          Terms, or (d) your violation of any law or third-party right.
        </p>
      </LegalSection>

      <LegalSection heading="16. Governing Law and Dispute Resolution">
        <p>
          These Terms are governed by the laws of the State of Delaware, USA,
          without regard to its conflict of laws principles. You and we agree
          that any dispute, claim, or controversy arising out of or relating to
          these Terms or the Service will be resolved, at either party&rsquo;s
          election, either in the state or federal courts located in the State
          of Delaware (and you and we consent to the exclusive jurisdiction
          and venue of those courts), or by binding individual arbitration
          conducted in the English language under the rules of the American
          Arbitration Association.
        </p>
        <p>
          YOU AND WE EACH WAIVE THE RIGHT TO A TRIAL BY JURY AND THE RIGHT TO
          PARTICIPATE IN A CLASS ACTION OR CLASS ARBITRATION. You may opt out
          of the arbitration provision by sending written notice to{" "}
          {CONTACT_EMAIL} within thirty (30) days of first accepting these
          Terms. Nothing in this section prevents either party from seeking
          injunctive or other equitable relief in a court of competent
          jurisdiction to protect intellectual property or confidentiality.
        </p>
      </LegalSection>

      <LegalSection heading="17. Export Controls and Sanctions">
        <p>
          You represent that you are not located in, under the control of, or
          a national or resident of any country or region subject to U.S.
          Government embargoes or designated as a &ldquo;terrorist
          supporting&rdquo; country, and that you are not on any U.S.
          Government list of prohibited or restricted parties. You agree to
          comply with all applicable export and re-export control laws and
          regulations.
        </p>
      </LegalSection>

      <LegalSection heading="18. Changes to These Terms">
        <p>
          We may update these Terms from time to time. If we make material
          changes, we will notify you by email or through the Service at least
          thirty (30) days before the changes take effect. Your continued use
          of the Service after the effective date constitutes your acceptance
          of the updated Terms. If you do not agree, you must stop using the
          Service and may cancel your account.
        </p>
      </LegalSection>

      <LegalSection heading="19. Miscellaneous">
        <p>
          These Terms, together with the Privacy Policy, Refund Policy,
          Acceptable Use Policy, DMCA Policy, and Cookie Policy, constitute the
          entire agreement between you and us regarding the Service. If any
          provision is held invalid or unenforceable, the remaining provisions
          will remain in full force. Our failure to enforce any right or
          provision is not a waiver of that right or provision. You may not
          assign these Terms without our prior written consent; we may assign
          these Terms at any time.
        </p>
      </LegalSection>

      <LegalSection heading="20. Contact">
        <p>
          For questions about these Terms, contact us at {CONTACT_EMAIL}.
        </p>
      </LegalSection>
    </div>
  );
}
