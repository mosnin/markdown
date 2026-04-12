import {
  LegalLastUpdated,
  LegalSection,
  SUPPORT_EMAIL,
} from "./primitives";

export function RefundContent() {
  return (
    <div>
      <LegalLastUpdated />

      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        We want you to be satisfied with Poggle. This Refund Policy explains
        when and how refunds may be issued. This policy forms part of our
        Terms of Service.
      </p>

      <LegalSection heading="1. Free Trial">
        <p>
          Paid plans include a fourteen (14) day free trial for new customers.
          You can cancel at any time during the trial through your account
          settings without being charged. If you do not cancel before the
          trial ends, your payment method will be charged for the subscription
          you selected.
        </p>
      </LegalSection>

      <LegalSection heading="2. Monthly Subscriptions">
        <p>
          Monthly subscriptions are billed in advance each month. You may
          cancel at any time; cancellation stops future renewals. You will
          retain access to the paid features through the end of the current
          billing period. Monthly subscription fees are non-refundable for
          partial months of service.
        </p>
      </LegalSection>

      <LegalSection heading="3. Annual Subscriptions">
        <p>
          Annual subscriptions are billed once per year at the discounted
          annual rate. If you cancel within thirty (30) days of your initial
          annual purchase or renewal, you may request a prorated refund for
          the unused portion of the year, subject to a reasonable
          administrative fee. Refund requests after thirty (30) days are not
          typically granted except at our discretion or where required by
          applicable consumer protection law.
        </p>
      </LegalSection>

      <LegalSection heading="4. Statutory Rights (EU, UK, and Other Jurisdictions)">
        <p>
          If you reside in a jurisdiction that grants statutory cancellation
          or withdrawal rights for digital services (for example, the
          fourteen-day right of withdrawal in the European Union), you may
          exercise those rights as provided by applicable law by contacting
          us at {SUPPORT_EMAIL}. By starting to use the Service during any
          cancellation period, you may be deemed to have waived the right of
          withdrawal to the extent permitted by law.
        </p>
      </LegalSection>

      <LegalSection heading="5. How to Request a Refund">
        <p>
          Email {SUPPORT_EMAIL} from the email address associated with your
          account. Include your account email, the subscription in question,
          and the reason for the request. We generally respond within five
          (5) business days. Approved refunds are issued to the original
          payment method and may take up to ten (10) business days to appear
          on your statement.
        </p>
      </LegalSection>

      <LegalSection heading="6. Exceptions and Abuse">
        <p>
          We reserve the right to deny refund requests if we have reason to
          believe the Service was used in violation of our Terms, in
          connection with fraud, or where a refund would be inconsistent with
          fair use of the Service. Accounts found abusing our refund policy
          may be suspended or terminated.
        </p>
      </LegalSection>

      <LegalSection heading="7. Taxes">
        <p>
          Any refund will be net of applicable taxes and any refund-related
          fees charged by our payment processor.
        </p>
      </LegalSection>

      <LegalSection heading="8. Changes">
        <p>
          We may update this Refund Policy from time to time. Changes apply
          to purchases made after the updated policy&rsquo;s effective date.
        </p>
      </LegalSection>

      <LegalSection heading="9. Contact">
        <p>
          Questions about this Refund Policy? Email {SUPPORT_EMAIL}.
        </p>
      </LegalSection>
    </div>
  );
}
