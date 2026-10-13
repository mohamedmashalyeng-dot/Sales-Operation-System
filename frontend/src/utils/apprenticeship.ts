import type { WorkspaceState } from "@/store/types";
import { OPEN_COMMERCIAL_STAGES } from "@/config/commercial";

/**
 * Apprenticeship metrics derived from the single shared workspace store.
 *
 * Every count respects the caller's visibility predicate so the same helpers
 * power Today, each module and the management reports without double-counting.
 * The dimensions are deliberately kept apart: funding eligibility, intake
 * planning, sales conversion, enrolment and confirmed starts are never merged.
 */
export interface ApprenticeshipMetrics {
  eligibilityNotAssessed: number;
  screeningInProgress: number;
  informationRequired: number;
  reviewRequired: number;
  provisionallyEligible: number;
  verifiedEligible: number;
  notEligibleFunding: number;
  eligibleCurrentIntake: number;
  eligibleDeferred: number;
  futureIntakePipeline: number;
  futureIntakeOverdue: number;
  commercialReferrals: number;
  commercialOpen: number;
  commercialClosedWon: number;
  awaitingEmployerAgreement: number;
  awaitingDasConfirmation: number;
  applicationsInProgress: number;
  completedEnrolments: number;
  confirmedStarts: number;
}

export type Visibility = (ownerId?: string | null) => boolean;

const OPEN_AGREEMENT = ["Sent", "Awaiting Signature", "Requires Amendment"];
const OPEN_DAS = ["Provider Addition Requested", "Awaiting Confirmation"];

export function computeApprenticeshipMetrics(
  state: WorkspaceState,
  canSee: Visibility,
): ApprenticeshipMetrics {
  const leads = state.leads.filter((l) => canSee(l.ownerId));
  const apps = state.applications.filter((a) => canSee(a.ownerId));
  const now = Date.now();

  const eligStatus = (l: (typeof leads)[number]) => l.eligibility?.status ?? "Not Assessed";
  const eligibleNow = (l: (typeof leads)[number]) =>
    eligStatus(l) === "Verified Eligible" || eligStatus(l) === "Provisionally Eligible";

  const futureLeadIds = new Set(leads.map((l) => l.id));
  const visibleIntakes = state.futureIntakes.filter((f) => futureLeadIds.has(f.leadId));
  const visibleCommercial = state.commercialOpportunities.filter((c) => futureLeadIds.has(c.leadId));
  const visibleAgreements = state.employerAgreements.filter(
    (a) => !a.leadId || canSee(state.leads.find((l) => l.id === a.leadId)?.ownerId),
  );
  const visibleDas = state.dasRecords.filter(
    (d) => !d.leadId || canSee(state.leads.find((l) => l.id === d.leadId)?.ownerId),
  );

  return {
    eligibilityNotAssessed: leads.filter((l) => eligStatus(l) === "Not Assessed").length,
    screeningInProgress: leads.filter((l) => eligStatus(l) === "Screening In Progress").length,
    informationRequired: leads.filter((l) => eligStatus(l) === "Information Required").length,
    reviewRequired: leads.filter((l) => eligStatus(l) === "Review Required").length,
    provisionallyEligible: leads.filter((l) => eligStatus(l) === "Provisionally Eligible").length,
    verifiedEligible: leads.filter((l) => l.eligibility?.decision === "Verified Eligible").length,
    notEligibleFunding: leads.filter((l) => l.eligibility?.decision === "Not Eligible for Funding").length,
    eligibleCurrentIntake: leads.filter((l) => eligibleNow(l) && l.intakePlanning === "Current Intake").length,
    eligibleDeferred: leads.filter((l) => eligibleNow(l) && l.intakePlanning === "Future Intake").length,
    futureIntakePipeline: visibleIntakes.length,
    futureIntakeOverdue: visibleIntakes.filter((f) => new Date(f.nextFollowUpAt).getTime() < now).length,
    commercialReferrals: visibleCommercial.length,
    commercialOpen: visibleCommercial.filter((c) => OPEN_COMMERCIAL_STAGES.includes(c.stage)).length,
    commercialClosedWon: visibleCommercial.filter((c) => c.stage === "Closed Won").length,
    awaitingEmployerAgreement: visibleAgreements.filter((a) => OPEN_AGREEMENT.includes(a.status)).length,
    awaitingDasConfirmation: visibleDas.filter((d) => OPEN_DAS.includes(d.status)).length,
    applicationsInProgress: apps.filter(
      (a) => a.status === "Submitted" || a.status === "Under review" || a.status === "Interview" || a.status === "Offer",
    ).length,
    completedEnrolments: leads.filter((l) => l.enrolment === "Enrolled").length,
    confirmedStarts: leads.filter((l) => l.enrolment === "Apprenticeship Started").length,
  };
}

/** Groups an array of records by a key selector, preserving a sorted key order. */
export function groupCount<T>(items: T[], key: (item: T) => string): { key: string; count: number }[] {
  const map = new Map<string, number>();
  items.forEach((item) => {
    const k = key(item) || "Not recorded";
    map.set(k, (map.get(k) ?? 0) + 1);
  });
  return Array.from(map.entries())
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count);
}

/** Groups records and counts how many hit a secondary "success" predicate. */
export function groupWithSecondary<T>(
  items: T[],
  key: (item: T) => string,
  secondary: (item: T) => boolean,
): { key: string; count: number; secondary: number }[] {
  const map = new Map<string, { count: number; secondary: number }>();
  items.forEach((item) => {
    const k = key(item) || "Not recorded";
    const current = map.get(k) ?? { count: 0, secondary: 0 };
    current.count += 1;
    if (secondary(item)) current.secondary += 1;
    map.set(k, current);
  });
  return Array.from(map.entries())
    .map(([k, v]) => ({ key: k, count: v.count, secondary: v.secondary }))
    .sort((a, b) => b.count - a.count);
}