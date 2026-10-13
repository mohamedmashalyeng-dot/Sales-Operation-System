import type { BadgeTone } from "@/components/base/Badge";

/**
 * UK apprenticeship eligibility screening for the KBC demonstration workspace.
 *
 * IMPORTANT: This is configurable INITIAL screening only — it is not an
 * authoritative government funding decision. Nothing here automatically
 * rejects a learner, and no visa category is automatically classified as
 * eligible or ineligible. Residency and immigration cases may have exceptions
 * and require specialist review. All records are fictional.
 */

export type EligibilityStatus =
  | "Not Assessed"
  | "Screening In Progress"
  | "Information Required"
  | "Review Required"
  | "Provisionally Eligible"
  | "Verified Eligible"
  | "Not Eligible for Funding";

export const ELIGIBILITY_STATUSES: EligibilityStatus[] = [
  "Not Assessed",
  "Screening In Progress",
  "Information Required",
  "Review Required",
  "Provisionally Eligible",
  "Verified Eligible",
  "Not Eligible for Funding",
];

export const ELIGIBILITY_TONES: Record<EligibilityStatus, BadgeTone> = {
  "Not Assessed": "neutral",
  "Screening In Progress": "primary",
  "Information Required": "warning",
  "Review Required": "accent",
  "Provisionally Eligible": "secondary",
  "Verified Eligible": "success",
  "Not Eligible for Funding": "danger",
};

/** The downstream funding decision is separate from the screening result. */
export type FundingDecision = "Verified Eligible" | "Not Eligible for Funding";

export type EvidenceStatus = "Not Requested" | "Requested" | "Received" | "Verified";

export const EVIDENCE_STATUSES: EvidenceStatus[] = [
  "Not Requested",
  "Requested",
  "Received",
  "Verified",
];

export const EVIDENCE_TONES: Record<EvidenceStatus, BadgeTone> = {
  "Not Requested": "neutral",
  Requested: "warning",
  Received: "accent",
  Verified: "success",
};

export type ScreeningAnswer = "Yes" | "No" | "Unknown" | "Needs Review";

export const SCREENING_ANSWERS: ScreeningAnswer[] = ["Yes", "No", "Unknown", "Needs Review"];

/**
 * Screens a set of responses into a status. This is a DEMONSTRATION heuristic,
 * not a funding rule — it never marks anyone ineligible automatically.
 */
export function deriveScreeningStatus(
  responses: { answer: ScreeningAnswer; evidence: EvidenceStatus }[],
): EligibilityStatus {
  if (responses.length === 0) return "Not Assessed";
  if (responses.some((r) => r.answer === "Needs Review")) return "Review Required";
  if (responses.some((r) => r.answer === "Unknown")) return "Information Required";
  const evidenceOutstanding = responses.some(
    (r) => r.evidence === "Not Requested" || r.evidence === "Requested",
  );
  if (evidenceOutstanding) return "Screening In Progress";
  return "Provisionally Eligible";
}

export const ANSWER_TONES: Record<ScreeningAnswer, BadgeTone> = {
  Yes: "success",
  No: "danger",
  Unknown: "warning",
  "Needs Review": "accent",
};

export interface EligibilityQuestion {
  id: string;
  order: number;
  question: string;
  help: string;
  /** Some questions record a number (e.g. weekly hours) rather than yes/no. */
  kind: "boolean" | "hours";
}

export const ELIGIBILITY_QUESTIONS: EligibilityQuestion[] = [
  {
    id: "eq-residency",
    order: 1,
    question: "UK residency history",
    help: "Has the learner been resident in the UK for the past three years? Residency cases may have exceptions and require specialist review.",
    kind: "boolean",
  },
  {
    id: "eq-immigration",
    order: 2,
    question: "Immigration permission & right to work",
    help: "Nationality, relevant leave status and any sponsorship considerations. No visa category is automatically eligible or ineligible.",
    kind: "boolean",
  },
  {
    id: "eq-other-funding",
    order: 3,
    question: "Other government-funded training",
    help: "Is the learner undertaking other government-funded training that may conflict with apprenticeship funding?",
    kind: "boolean",
  },
  {
    id: "eq-employment-type",
    order: 4,
    question: "Self-employment & employer relationship",
    help: "Self-employment, employment type and the relationship with the employer.",
    kind: "boolean",
  },
  {
    id: "eq-paid-hours",
    order: 5,
    question: "Paid employment in England",
    help: "Record the actual normal weekly hours. Typically 30+ hours; cases below 30 hours require review — never an automatic rejection.",
    kind: "hours",
  },
  {
    id: "eq-employer-england",
    order: 6,
    question: "Employer based in England",
    help: "Employer is based in England and has an Apprenticeship Service account.",
    kind: "boolean",
  },
  {
    id: "eq-hours-england",
    order: 7,
    question: "50% of working hours in England",
    help: "At least 50% of the learner's working hours take place in England.",
    kind: "boolean",
  },
];

export interface IntakePlanningStatusMeta {
  value: IntakePlanningStatus;
  tone: BadgeTone;
}

export type IntakePlanningStatus =
  | "Unassigned"
  | "Current Intake"
  | "Future Intake"
  | "Intake Confirmed"
  | "Deferred Again"
  | "Withdrawn";

export const INTAKE_PLANNING_STATUSES: IntakePlanningStatus[] = [
  "Unassigned",
  "Current Intake",
  "Future Intake",
  "Intake Confirmed",
  "Deferred Again",
  "Withdrawn",
];

export const INTAKE_PLANNING_TONES: Record<IntakePlanningStatus, BadgeTone> = {
  Unassigned: "neutral",
  "Current Intake": "primary",
  "Future Intake": "accent",
  "Intake Confirmed": "success",
  "Deferred Again": "warning",
  Withdrawn: "danger",
};

export type EnrolmentStage =
  | "Not Started"
  | "Application"
  | "Document Review"
  | "Employer Onboarding"
  | "Ready to Enrol"
  | "Enrolled"
  | "Apprenticeship Started";

export const ENROLMENT_STAGES: EnrolmentStage[] = [
  "Not Started",
  "Application",
  "Document Review",
  "Employer Onboarding",
  "Ready to Enrol",
  "Enrolled",
  "Apprenticeship Started",
];

export const ENROLMENT_TONES: Record<EnrolmentStage, BadgeTone> = {
  "Not Started": "neutral",
  Application: "primary",
  "Document Review": "primary",
  "Employer Onboarding": "accent",
  "Ready to Enrol": "secondary",
  Enrolled: "success",
  "Apprenticeship Started": "success",
};

export const DEFERRAL_REASONS = [
  "Work commitments",
  "Employer not ready",
  "Personal timing",
  "Holiday or leave",
  "Waiting for employer approval",
  "Waiting for documentation",
  "Wants a later cohort",
  "Other",
] as const;

export type DeferralReason = (typeof DEFERRAL_REASONS)[number];

export const READINESS_LEVELS = ["Not ready", "Partly ready", "Ready", "Unknown"] as const;

export type ReadinessLevel = (typeof READINESS_LEVELS)[number];

export const READINESS_TONES: Record<ReadinessLevel, BadgeTone> = {
  "Not ready": "danger",
  "Partly ready": "warning",
  Ready: "success",
  Unknown: "neutral",
};

/** Kent Business College's UK provider reference (fictional use in this demo). */
export const KBC_UKPRN = "10093689";

/** Reference links opened (read-only) from the demonstration workspace. */
export const EMPLOYER_AGREEMENT_URL = "https://kentbusinesscollege.com/employer-agreement/";
export const APPRENTICESHIP_SERVICE_URL =
  "https://www.gov.uk/sign-in-apprenticeship-service-account";