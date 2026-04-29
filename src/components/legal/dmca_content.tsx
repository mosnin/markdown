import {
  DMCA_EMAIL,
  LegalLastUpdated,
  LegalList,
  LegalSection,
} from "./primitives";

export function DMCAContent() {
  return (
    <div>
      <LegalLastUpdated />

      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        Poggle respects the intellectual property rights of others and expects
        users to do the same. This DMCA Policy explains how to submit a
        notice of alleged copyright infringement and how to counter a
        takedown notice, in accordance with the Digital Millennium Copyright
        Act (17 U.S.C. &sect; 512).
      </p>

      <LegalSection heading="1. Notice of Alleged Infringement">
        <p>
          If you believe that content on the Service infringes your copyright,
          send a written notice to our designated agent at {DMCA_EMAIL}. Your
          notice must include all of the following:
        </p>
        <LegalList>
          <li>
            a physical or electronic signature of the copyright owner or a
            person authorized to act on their behalf;
          </li>
          <li>
            identification of the copyrighted work claimed to have been
            infringed, or a representative list of such works;
          </li>
          <li>
            identification of the material that is claimed to be infringing
            and information reasonably sufficient to permit us to locate it
            (such as a direct URL or object ID);
          </li>
          <li>
            your contact information (address, telephone number, and email);
          </li>
          <li>
            a statement that you have a good-faith belief that use of the
            material in the manner complained of is not authorized by the
            copyright owner, its agent, or the law;
          </li>
          <li>
            a statement, under penalty of perjury, that the information in
            the notice is accurate and that you are the copyright owner or
            authorized to act on the copyright owner&rsquo;s behalf.
          </li>
        </LegalList>
        <p>
          Incomplete notices may not be actionable. Knowingly materially
          misrepresenting that content is infringing may subject you to
          liability for damages under 17 U.S.C. &sect; 512(f).
        </p>
      </LegalSection>

      <LegalSection heading="2. Counter-Notice">
        <p>
          If you believe your content was removed as a result of a mistake or
          misidentification, you may submit a written counter-notice to{" "}
          {DMCA_EMAIL} that includes:
        </p>
        <LegalList>
          <li>your physical or electronic signature;</li>
          <li>
            identification of the material that was removed and the location
            at which it appeared before removal;
          </li>
          <li>
            a statement, under penalty of perjury, that you have a good-faith
            belief that the material was removed as a result of a mistake or
            misidentification;
          </li>
          <li>
            your name, address, telephone number, and a statement that you
            consent to the jurisdiction of the Federal District Court for the
            judicial district in which your address is located (or, if your
            address is outside the United States, any judicial district in
            which Poggle may be found), and that you will accept service of
            process from the person who provided the original notice or that
            person&rsquo;s agent.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="3. Repeat Infringers">
        <p>
          We will terminate the accounts of users we determine, in our
          discretion, to be repeat infringers in appropriate circumstances.
        </p>
      </LegalSection>

      <LegalSection heading="4. Designated Agent">
        <p>
          DMCA notices and counter-notices should be sent to: {DMCA_EMAIL}.
        </p>
      </LegalSection>
    </div>
  );
}
