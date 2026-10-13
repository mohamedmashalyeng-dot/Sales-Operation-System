import type { BadgeTone } from "@/components/base/Badge";

/**
 * Commercial training pathway configuration.
 *
 * When a lead is not eligible for government apprenticeship funding they may be
 * referred for a commercial review. Suitability is never assumed — every
 * referral is subject to staff review, and a privately funded apprenticeship is
 * NOT automatically equivalent to a commercial short course.
 */

export type CommercialStage =
  | "Referred"
  | "Suitability Review"
  | "Interested"
  | "Proposal Required"
  | "Quote Sent"
  | "Negotiation"
  | "Accepted"
  | "Declined"
  | "Closed Won"
  | "Closed Lost";

export const COMMERCIAL_STAGES: CommercialStage[] = [
  "Referred",
  "Suitability Review",
  "Interested",
  "Proposal Required",
  "Quote Sent",
  "Negotiation",
  "Accepted",
  "Declined",
  "Closed Won",
  "Closed Lost",
];

export const COMMERCIAL_TONES: Record<CommercialStage, BadgeTone> = {
  Referred: "primary",
  "Suitability Review": "accent",
  Interested: "secondary",
  "Proposal Required": "secondary",
  "Quote Sent": "accent",
  Negotiation: "accent",
  Accepted: "success",
  Declined: "danger",
  "Closed Won": "success",
  "Closed Lost": "danger",
};

/** Open (in-pipeline) stages, used for pipeline metrics. */
export const OPEN_COMMERCIAL_STAGES: CommercialStage[] = [
  "Referred",
  "Suitability Review",
  "Interested",
  "Proposal Required",
  "Quote Sent",
  "Negotiation",
];

export type CommercialOptionType = "Commercial course" | "Privately funded apprenticeship";

export const COMMERCIAL_OPTION_TYPES: CommercialOptionType[] = [
  "Commercial course",
  "Privately funded apprenticeship",
];

export type FundingInterest = "Employer-funded" | "Self-funded";

export const FUNDING_INTERESTS: FundingInterest[] = ["Employer-funded", "Self-funded"];

export const BUDGET_STATUSES = [
  "Not discussed",
  "Discussed — no budget",
  "Budget indicated",
  "Budget approved",
] as const;

export const QUOTE_STATUSES = [
  "Not required",
  "To prepare",
  "Sent",
  "Amended",
  "Accepted",
  "Declined",
] as const;

export const COMMERCIAL_REFERRAL_REASONS = [
  "Not eligible for government funding",
  "Fails residency requirement",
  "Below minimum weekly hours",
  "Employer not levy-fundable",
  "Learner prefers private route",
  "Outside apprenticeship scope",
  "Other",
] as const;

/** Suggested commercial programmes (fictional) — kept separate from apprenticeship programmes. */
export const COMMERCIAL_PROGRAMMES = [
  "CMI Level 6 — Commercial",
  "Project Controls Professional Level 6 — Commercial",
  "Marketing Manager with CIM Level 6 — Commercial",
  "Operations Manager Level 5 — Commercial",
  "Business Administration Level 3 — Commercial",
  "Short Course — Leadership Essentials",
  "Short Course — Project Controls Fundamentals",
];