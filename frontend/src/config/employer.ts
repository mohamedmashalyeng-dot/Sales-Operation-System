import type { BadgeTone } from "@/components/base/Badge";

/**
 * Employer onboarding configuration — the Kent Business College employer
 * agreement and the employer's Apprenticeship Service / DAS readiness.
 *
 * The workspamce never claims a real signature or a real government-account
 * action has taken place. Everything here is a fictional demonstration state.
 */

export type EmployerAgreementStatus =
  | "Not Sent"
  | "Sent"
  | "Awaiting Signature"
  | "Signed"
  | "Rejected"
  | "Requires Amendment";

export const EMPLOYER_AGREEMENT_STATUSES: EmployerAgreementStatus[] = [
  "Not Sent",
  "Sent",
  "Awaiting Signature",
  "Signed",
  "Rejected",
  "Requires Amendment",
];

export const AGREEMENT_TONES: Record<EmployerAgreementStatus, BadgeTone> = {
  "Not Sent": "neutral",
  Sent: "primary",
  "Awaiting Signature": "accent",
  Signed: "success",
  Rejected: "danger",
  "Requires Amendment": "warning",
};

export type DasStatus =
  | "Not Started"
  | "Employer Account Required"
  | "Awaiting Employer Action"
  | "Provider Addition Requested"
  | "Awaiting Confirmation"
  | "Confirmed"
  | "Blocked / Needs Help";

export const DAS_STATUSES: DasStatus[] = [
  "Not Started",
  "Employer Account Required",
  "Awaiting Employer Action",
  "Provider Addition Requested",
  "Awaiting Confirmation",
  "Confirmed",
  "Blocked / Needs Help",
];

export const DAS_TONES: Record<DasStatus, BadgeTone> = {
  "Not Started": "neutral",
  "Employer Account Required": "warning",
  "Awaiting Employer Action": "accent",
  "Provider Addition Requested": "primary",
  "Awaiting Confirmation": "secondary",
  Confirmed: "success",
  "Blocked / Needs Help": "danger",
};

export interface DasChecklistItem {
  id: string;
  label: string;
  help: string;
}

export const DAS_CHECKLIST: DasChecklistItem[] = [
  {
    id: "das-account",
    label: "Employer has an Apprenticeship Service account",
    help: "The employer has registered for the apprenticeship service.",
  },
  {
    id: "das-help",
    label: "Account setup assistance needed",
    help: "Kent Business College support is required to set up the account.",
  },
  {
    id: "das-ukprn",
    label: "Employer given the Kent UKPRN",
    help: "The employer has been given UKPRN 10093689.",
  },
  {
    id: "das-requested",
    label: "Provider addition requested",
    help: "The employer has been asked to add Kent Business College as a provider.",
  },
  {
    id: "das-confirmed",
    label: "Provider addition confirmed",
    help: "The employer has confirmed Kent Business College as a provider.",
  },
  {
    id: "das-funding",
    label: "Funding & employer actions reviewed",
    help: "Relevant apprenticeship funding and employer actions have been reviewed.",
  },
];