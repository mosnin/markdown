import { type ComponentType } from "react";
import { TermsContent } from "./terms_content";
import { PrivacyContent } from "./privacy_content";
import { RefundContent } from "./refund_content";
import { CookieContent } from "./cookie_content";
import { AcceptableUseContent } from "./aup_content";
import { DMCAContent } from "./dmca_content";

export type LegalDocId =
  | "terms"
  | "privacy"
  | "refund-policy"
  | "cookies"
  | "acceptable-use"
  | "dmca";

export interface LegalDoc {
  id: LegalDocId;
  title: string;
  shortLabel: string;
  path: string;
  description: string;
  Content: ComponentType;
}

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  terms: {
    id: "terms",
    title: "Terms of Service",
    shortLabel: "Terms",
    path: "/terms",
    description:
      "The rules and commitments that govern your use of Atlas.",
    Content: TermsContent,
  },
  privacy: {
    id: "privacy",
    title: "Privacy Policy",
    shortLabel: "Privacy",
    path: "/privacy",
    description: "How we collect, use, and protect your personal information.",
    Content: PrivacyContent,
  },
  "refund-policy": {
    id: "refund-policy",
    title: "Refund Policy",
    shortLabel: "Refunds",
    path: "/refund-policy",
    description: "When and how refunds are issued.",
    Content: RefundContent,
  },
  cookies: {
    id: "cookies",
    title: "Cookie Policy",
    shortLabel: "Cookies",
    path: "/cookies",
    description: "How Atlas uses cookies and similar technologies.",
    Content: CookieContent,
  },
  "acceptable-use": {
    id: "acceptable-use",
    title: "Acceptable Use Policy",
    shortLabel: "Acceptable Use",
    path: "/acceptable-use",
    description: "Prohibited uses of the Service.",
    Content: AcceptableUseContent,
  },
  dmca: {
    id: "dmca",
    title: "DMCA Policy",
    shortLabel: "DMCA",
    path: "/dmca",
    description: "How to submit copyright infringement notices.",
    Content: DMCAContent,
  },
};

export const LEGAL_DOC_ORDER: LegalDocId[] = [
  "terms",
  "privacy",
  "cookies",
  "acceptable-use",
  "refund-policy",
  "dmca",
];
