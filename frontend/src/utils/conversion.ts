import type { BadgeTone } from "@/components/base/Badge";
import { normaliseEmail } from "@/config/marketing";
import type {
  Call,
  CollegeEvent,
  EventRegistration,
  Lead,
  WorkspaceState,
} from "@/store/types";
import { resolveAttendance } from "@/utils/events";

/**
 * Acquisition-to-conversion reporting for the KBC demonstration workspace.
 *
 * Every figure is derived from the active workspace dataset. The reporting model
 * deliberately keeps DIFFERENT entities apart so they are never summed as if
 * interchangeable:
 *   - unique people    (one human being)
 *   - unique leads     (one CRM record)
 *   - registrations    (one event sign-up)
 *   - invitations      (one campaign email)
 *   - call attempts    (one dial)
 *   - applications     (one submitted application)
 *   - apprenticeship starts (one confirmed start)
 * A Closed Won deal is NOT an application, an enrolment or a start.
 */

export interface ConversionFilters {
  acquisitionFrom: string;
  acquisitionTo: string;
  programme: string;
  owner: string;
  campaign: string;
}

export const DEFAULT_CONVERSION_FILTERS: ConversionFilters = {
  acquisitionFrom: "",
  acquisitionTo: "",
  programme: "all",
  owner: "all",
  campaign: "all",
};

export interface RateSpec {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  unit: string;
  definition: string;
}

/** Returns a percentage, or null when the denominator is zero (rendered "N/A"). */
export function rateValue(spec: RateSpec): number | null {
  if (spec.denominator === 0) return null;
  return (spec.numerator / spec.denominator) * 100;
}

export function formatRate(value: number | null): string {
  return value == null ? "N/A" : `${value.toFixed(1)}%`;
}

/* ------------------------------ cohort scope ------------------------------ */

export function filterCohortLeads(
  state: WorkspaceState,
  filters: ConversionFilters,
  canSeeOwner: (ownerId: string | null | undefined) => boolean,
): Lead[] {
  const from = filters.acquisitionFrom
    ? new Date(`${filters.acquisitionFrom}T00:00:00`).getTime()
    : null;
  const to = filters.acquisitionTo
    ? new Date(`${filters.acquisitionTo}T23:59:59`).getTime()
    : null;
  const leads = Array.isArray(state.leads) ? state.leads : [];
  return leads.filter((lead) => {
    if (!canSeeOwner(lead.ownerId)) return false;
    if (filters.programme !== "all" && lead.programme !== filters.programme) return false;
    if (filters.owner !== "all" && lead.ownerId !== filters.owner) return false;
    if (filters.campaign !== "all" && (lead.campaignId ?? "") !== filters.campaign) return false;
    const acquired = new Date(lead.acquisitionDate).getTime();
    if (from != null && acquired < from) return false;
    if (to != null && acquired > to) return false;
    return true;
  });
}

/* ------------------------ session classification ------------------------- */

export type SessionGroupId =
  | "attended"
  | "did-not-attend"
  | "never-registered"
  | "attendance-unknown"
  | "cancelled";

export interface SessionGroupMeta {
  id: SessionGroupId;
  letter: string;
  label: string;
  tone: BadgeTone;
  bar: string;
  description: string;
}

/**
 * Classification precedence (documented for the UI so groups are mutually
 * exclusive even when a prospect has several event registrations):
 *   1. Any confirmation of attendance            → Attended        (Group A)
 *   2. Otherwise, any recorded non-attendance    → Did Not Attend   (Group B)
 *   3. Otherwise, a live (non-cancelled) reg.    → Attendance Unknown (Group D)
 *   4. Otherwise, only cancelled registrations   → Cancelled Registration (reported separately)
 *   5. Otherwise (no registration at all)        → Never Registered (Group C)
 */
export const SESSION_GROUPS: SessionGroupMeta[] = [
  {
    id: "attended",
    letter: "A",
    label: "Attended",
    tone: "primary",
    bar: "bg-primary-500",
    description: "Confirmed Zoom information-session attendance.",
  },
  {
    id: "did-not-attend",
    letter: "B",
    label: "Did Not Attend",
    tone: "accent",
    bar: "bg-accent-500",
    description: "A recorded non-attendance and no confirmed attendance.",
  },
  {
    id: "never-registered",
    letter: "C",
    label: "Never Registered",
    tone: "secondary",
    bar: "bg-secondary-500",
    description: "No information-session registration at all (includes direct routes).",
  },
  {
    id: "attendance-unknown",
    letter: "D",
    label: "Attendance Unknown",
    tone: "neutral",
    bar: "bg-foreground-300",
    description: "Registered, but no confirmed attendance or non-attendance outcome.",
  },
  {
    id: "cancelled",
    letter: "—",
    label: "Cancelled Registration",
    tone: "danger",
    bar: "bg-foreground-200",
    description: "Only ever cancelled a registration — reported separately from Never Registered.",
  },
];

export function sessionGroupMeta(id: SessionGroupId): SessionGroupMeta {
  return SESSION_GROUPS.find((g) => g.id === id) ?? SESSION_GROUPS[2];
}

/** Indexes every event registration by normalised email so a person is counted once. */
export function buildRegistrationIndex(
  events: CollegeEvent[],
): Map<string, { regular: EventRegistration[]; event: CollegeEvent }[]> {
  const map = new Map<string, { regular: EventRegistration[]; event: CollegeEvent }[]>();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const regs = Array.isArray(event.registrations) ? event.registrations : [];
    regs.forEach((reg) => {
      const key = normaliseEmail(reg.email);
      const list = map.get(key) ?? [];
      list.push({ regular: [reg], event });
      map.set(key, list);
    });
  });
  return map;
}

/** Flattens the registration index into one registration list per email. */
export function registrationsByEmail(events: CollegeEvent[]): Map<string, EventRegistration[]> {
  const map = new Map<string, EventRegistration[]>();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const regs = Array.isArray(event.registrations) ? event.registrations : [];
    regs.forEach((reg) => {
      const key = normaliseEmail(reg.email);
      const list = map.get(key) ?? [];
      list.push(reg);
      map.set(key, list);
    });
  });
  return map;
}

export function leadSessionGroup(
  lead: Lead,
  index: Map<string, EventRegistration[]>,
): SessionGroupId {
  const regs = index.get(normaliseEmail(lead.email)) ?? [];
  if (regs.length === 0) return "never-registered";
  if (regs.some((r) => resolveAttendance(r) === "Attended")) return "attended";
  if (regs.some((r) => resolveAttendance(r) === "Did Not Attend")) return "did-not-attend";
  if (regs.some((r) => r.outcome !== "declined")) return "attendance-unknown";
  return "cancelled";
}

/* ------------------------------- metrics -------------------------------- */

export interface ApolloMetrics {
  /** Unique contacts inside a campaign audience whose provider was Apollo.io. */
  audienceContacts: number;
  /** Cohort leads whose OWN original acquisition source is Apollo.io. */
  crmLeads: number;
  /** Apollo CRM leads who were invited by a campaign. */
  invited: number;
  /** Apollo CRM leads who registered for an information session. */
  registered: number;
  /** Apollo CRM leads reached by Zoom Phone (an answered conversation). */
  reached: number;
  qualified: number;
  withApplication: number;
  enrolled: number;
  starts: number;
}

export interface ConversionMetrics {
  cohortSize: number;
  /* acquisition */
  apolloSourced: number;
  websiteEnquiries: number;
  directEmailEnquiries: number;
  eventbriteListings: number;
  contactsInZoho: number;
  contactsExportedForMarketing: number;
  /* campaign */
  uniqueImportedRecipients: number;
  uniqueInvitedRecipients: number;
  invitationsSent: number;
  recordedDeliveries: number;
  uniqueEventRegistrations: number;
  registrationCancellations: number;
  campaignAttributedRegistrations: number;
  /* information sessions */
  confirmedAttendees: number;
  confirmedNonAttendees: number;
  attendanceUnknown: number;
  registrantsWithoutOutcome: number;
  neverRegistered: number;
  knownAttendanceRegistrations: number;
  totalValidRegistrations: number;
  /* zoom phone */
  callsAttempted: number;
  callsAnswered: number;
  callsUnanswered: number;
  uniqueLeadsCalled: number;
  uniqueLeadsReached: number;
  followUpsScheduled: number;
  futureIntakeOutcomes: number;
  eligibilityReviewOutcomes: number;
  /* apprenticeship funnel */
  qualifiedLeads: number;
  provisionallyEligible: number;
  verifiedEligible: number;
  futureIntakeOpportunities: number;
  commercialReferrals: number;
  commercialClosedWon: number;
  employerCommitments: number;
  closedWon: number;
  applicationsSubmitted: number;
  enrolmentsCompleted: number;
  confirmedStarts: number;
  leadsWithApplication: number;
  leadsWithStart: number;
  /* Apollo.io cohort — audience membership vs genuine Apollo CRM leads */
  apollo: ApolloMetrics;
  /* rates */
  rates: RateSpec[];
}

const QUALIFIED_STAGES = new Set(["Qualified", "Proposal sent", "Won"]);

function uniqueEmails(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean).map(normaliseEmail)));
}

function ownerScopeOf(state: WorkspaceState, canSeeOwner: (id: string | null | undefined) => boolean) {
  return (ownerId: string | null | undefined) => canSeeOwner(ownerId);
}

export function computeConversionMetrics(
  state: WorkspaceState,
  filters: ConversionFilters,
  canSeeOwner: (ownerId: string | null | undefined) => boolean,
): ConversionMetrics {
  const cohort = filterCohortLeads(state, filters, canSeeOwner);
  const cohortIds = new Set(cohort.map((l) => l.id));
  const cohortEmails = new Set(cohort.map((l) => normaliseEmail(l.email)));
  const canOwner = ownerScopeOf(state, canSeeOwner);

  /* ---- acquisition (from the cohort itself) ---- */
  const countSource = (label: string) => cohort.filter((l) => l.source === label).length;

  /* ---- campaigns (scoped by owner + campaign + date) ---- */
  const campaigns = (Array.isArray(state.campaigns) ? state.campaigns : []).filter((c) => {
    if (!canOwner(c.ownerId)) return false;
    if (filters.campaign !== "all" && c.id !== filters.campaign) return false;
    return true;
  });
  const importEmails: string[] = [];
  const invitedEmails: string[] = [];
  const deliveredEmails: string[] = [];
  const apolloRecipientEmails: string[] = [];
  const zohoRecipientEmails: string[] = [];
  let invitationsSent = 0;
  let attributed = 0;
  campaigns.forEach((campaign) => {
    const fromApollo = /apollo/i.test(campaign.acquisitionProvider);
    const fromZoho = /zoho/i.test(campaign.crmSystem);
    const recipients = Array.isArray(campaign.recipients) ? campaign.recipients : [];
    recipients.forEach((r) => {
      importEmails.push(r.email);
      if (fromApollo) apolloRecipientEmails.push(r.email);
      if (fromZoho) zohoRecipientEmails.push(r.email);
      if (r.invitedAt) {
        invitationsSent += 1;
        invitedEmails.push(r.email);
      }
      if (r.delivered) deliveredEmails.push(r.email);
      if (r.registrationRef) attributed += 1;
    });
  });
  const uniqueImportedRecipients = uniqueEmails(importEmails).length;
  const uniqueInvitedRecipients = uniqueEmails(invitedEmails).length;

  // Apollo.io is the ORIGINAL acquisition provider for contacts sourced by the
  // outreach team, even though they are managed in Zoho CRM and invited through
  // Eventbrite. Contacts are the union of Apollo-provider campaign audiences and
  // leads whose own original source is Apollo.io — a campaign invite never
  // replaces a lead's existing original source.
  const apolloSourced = uniqueEmails([
    ...apolloRecipientEmails,
    ...cohort.filter((l) => l.source === "Apollo.io").map((l) => l.email),
  ]).length;
  const contactsInZoho = uniqueEmails([
    ...zohoRecipientEmails,
    ...cohort.filter((l) => l.zohoSynced || Boolean(l.zohoId)).map((l) => l.email),
  ]).length;

  /* ---- events / information sessions ---- */
  const events = Array.isArray(state.events) ? state.events : [];
  const regsAll: EventRegistration[] = [];
  events.forEach((e) => {
    (Array.isArray(e.registrations) ? e.registrations : []).forEach((r) => regsAll.push(r));
  });
  const liveRegs = regsAll.filter((r) => r.outcome !== "declined");
  const registrationCancellations = regsAll.filter((r) => r.outcome === "declined").length;
  const attendedEmails = uniqueEmails(
    regsAll.filter((r) => resolveAttendance(r) === "Attended").map((r) => r.email),
  );
  const nonAttendEmails = uniqueEmails(
    regsAll.filter((r) => resolveAttendance(r) === "Did Not Attend").map((r) => r.email),
  );
  const unknownEmails = uniqueEmails(
    regsAll
      .filter((r) => r.outcome !== "declined" && resolveAttendance(r) === "Attendance Unknown")
      .map((r) => r.email),
  );
  const validRegs = liveRegs.length;
  const knownAttendanceRegistrations = regsAll.filter(
    (r) => resolveAttendance(r) !== "Attendance Unknown",
  ).length;

  const regIndex = registrationsByEmail(events);
  const neverRegistered = cohort.filter(
    (l) => leadSessionGroup(l, regIndex) === "never-registered",
  ).length;

  /* ---- zoom phone calls (scoped by owner + date) ---- */
  const calls = (Array.isArray(state.calls) ? state.calls : []).filter((c: Call) =>
    canOwner(c.salesOwnerId ?? (c.leadId ? state.leads.find((l) => l.id === c.leadId)?.ownerId : null)),
  );
  const isAnswered = (c: Call) => c.status === "answered" || c.status === "connected";
  const callsAttempted = calls.length;
  const callsAnswered = calls.filter(isAnswered).length;
  const callsUnanswered = callsAttempted - callsAnswered;
  const calledLeadIds = new Set(calls.map((c) => c.leadId).filter((id): id is string => Boolean(id)));
  const reachedLeadIds = new Set(
    calls.filter(isAnswered).map((c) => c.leadId).filter((id): id is string => Boolean(id)),
  );
  const followUpsScheduled = (Array.isArray(state.tasks) ? state.tasks : []).filter((t) =>
    Boolean(t.relatedCallId),
  ).length;
  const futureIntakeOutcomes = calls.filter((c) => c.outcome === "Wants Future Intake").length;
  const eligibilityReviewOutcomes = calls.filter(
    (c) => c.outcome === "Eligibility Review Required",
  ).length;

  /* ---- apprenticeship funnel ---- */
  const qualifiedLeads = cohort.filter((l) => QUALIFIED_STAGES.has(l.stage)).length;
  const provisionallyEligible = cohort.filter(
    (l) => l.eligibility?.status === "Provisionally Eligible",
  ).length;
  const verifiedEligible = cohort.filter((l) => l.eligibility?.decision === "Verified Eligible").length;
  const futureIntakeOpportunities = new Set(
    (Array.isArray(state.futureIntakes) ? state.futureIntakes : [])
      .filter((f) => cohortIds.has(f.leadId))
      .map((f) => f.leadId),
  ).size;
  const commercialRows = (Array.isArray(state.commercialOpportunities)
    ? state.commercialOpportunities
    : []
  ).filter((c) => cohortIds.has(c.leadId));
  const commercialReferrals = new Set(commercialRows.map((c) => c.leadId)).size;
  const commercialClosedWon = commercialRows.filter((c) => c.stage === "Closed Won").length;
  const employerCommitments = new Set(
    (Array.isArray(state.employerAgreements) ? state.employerAgreements : [])
      .filter(
        (a) =>
          cohortIds.has(a.leadId ?? "") &&
          (a.status === "Signed" || a.status === "Awaiting Signature"),
      )
      .map((a) => a.leadId),
  ).size;
  const closedWon = cohort.filter((l) => l.stage === "Won" || l.closing?.outcome === "won").length;

  const applications = (Array.isArray(state.applications) ? state.applications : []).filter(
    (a) => (a.leadId ? cohortIds.has(a.leadId) : false) && canOwner(a.ownerId),
  );
  const applicationsSubmitted = applications.length;
  const leadsWithApplication = new Set(applications.map((a) => a.leadId)).size;
  const enrolmentsCompleted = cohort.filter(
    (l) => l.enrolment === "Enrolled" || l.enrolment === "Apprenticeship Started",
  ).length;
  const confirmedStarts = cohort.filter((l) => l.enrolment === "Apprenticeship Started").length;
  const leadsWithStart = confirmedStarts;

  /* ---- Apollo.io cohort (audience vs genuine CRM leads) ---- */
  const apolloCohort = cohort.filter((l) => l.source === "Apollo.io");
  const apolloCohortIds = new Set(apolloCohort.map((l) => l.id));
  const apolloCohortEmails = new Set(apolloCohort.map((l) => normaliseEmail(l.email)));
  const apolloInvitedEmails = new Set<string>();
  campaigns.forEach((campaign) => {
    (Array.isArray(campaign.recipients) ? campaign.recipients : []).forEach((r) => {
      const key = normaliseEmail(r.email);
      const isApolloLead = r.leadId ? apolloCohortIds.has(r.leadId) : apolloCohortEmails.has(key);
      if (r.invitedAt && isApolloLead) apolloInvitedEmails.add(key);
    });
  });
  const apollo: ApolloMetrics = {
    audienceContacts: uniqueEmails(apolloRecipientEmails).length,
    crmLeads: apolloCohort.length,
    invited: apolloInvitedEmails.size,
    registered: apolloCohort.filter((l) => {
      const regs = regIndex.get(normaliseEmail(l.email)) ?? [];
      return regs.some((r) => r.outcome !== "declined");
    }).length,
    reached: new Set(
      calls
        .filter((c) => isAnswered(c) && c.leadId && apolloCohortIds.has(c.leadId))
        .map((c) => c.leadId),
    ).size,
    qualified: apolloCohort.filter((l) => QUALIFIED_STAGES.has(l.stage)).length,
    withApplication: new Set(
      (Array.isArray(state.applications) ? state.applications : [])
        .filter((a) => a.leadId && apolloCohortIds.has(a.leadId))
        .map((a) => a.leadId),
    ).size,
    enrolled: apolloCohort.filter(
      (l) => l.enrolment === "Enrolled" || l.enrolment === "Apprenticeship Started",
    ).length,
    starts: apolloCohort.filter((l) => l.enrolment === "Apprenticeship Started").length,
  };

  const rates: RateSpec[] = [
    {
      key: "call-answer-rate",
      label: "Call answer rate",
      numerator: callsAnswered,
      denominator: callsAttempted,
      unit: "answered call attempts / total call attempts",
      definition: "Answered call attempts divided by all attempted calls.",
    },
    {
      key: "lead-qualification-rate",
      label: "Lead qualification rate",
      numerator: qualifiedLeads,
      denominator: cohort.length,
      unit: "unique qualified leads / acquired leads (cohort)",
      definition: "Qualified unique leads divided by unique acquired leads in the cohort.",
    },
    {
      key: "lead-to-application-rate",
      label: "Lead-to-application rate",
      numerator: leadsWithApplication,
      denominator: cohort.length,
      unit: "unique leads with applications / acquired leads (cohort)",
      definition: "Unique acquired leads with a submitted application divided by the cohort.",
    },
    {
      key: "lead-to-start-rate",
      label: "Lead-to-start rate",
      numerator: leadsWithStart,
      denominator: cohort.length,
      unit: "unique leads with confirmed starts / acquired leads (cohort)",
      definition: "Unique acquired leads with a confirmed apprenticeship start divided by the cohort.",
    },
    {
      key: "known-attendance-rate",
      label: "Known-outcome attendance rate",
      numerator: attendedEmails.length,
      denominator: attendedEmails.length + nonAttendEmails.length,
      unit: "confirmed attendees / (attendees + confirmed non-attendees)",
      definition: "Confirmed attendees over registrations with a known attendance outcome.",
    },
    {
      key: "attendance-coverage",
      label: "Attendance data coverage",
      numerator: knownAttendanceRegistrations,
      denominator: validRegs,
      unit: "registrations with known attendance / total valid registrations",
      definition: "How much of the registration base has an explicit attendance outcome.",
    },
    {
      key: "campaign-registration-rate",
      label: "Campaign-attributed registration rate",
      numerator: attributed,
      denominator: uniqueInvitedRecipients,
      unit: "invited recipients with linked registrations / unique invited recipients",
      definition:
        "Only counts recipients with an explicitly linked registration — never inferred from a matching email.",
    },
  ];

  return {
    cohortSize: cohort.length,
    apolloSourced,
    websiteEnquiries: countSource("Website"),
    directEmailEnquiries: countSource("Direct Email Enquiry"),
    eventbriteListings: cohort.filter(
      (l) => l.source === "Eventbrite Listing" || l.source === "Eventbrite",
    ).length,
    contactsInZoho,
    contactsExportedForMarketing: uniqueImportedRecipients,
    uniqueImportedRecipients,
    uniqueInvitedRecipients,
    invitationsSent,
    recordedDeliveries: uniqueEmails(deliveredEmails).length,
    uniqueEventRegistrations: uniqueEmails(liveRegs.map((r) => r.email)).length,
    registrationCancellations,
    campaignAttributedRegistrations: attributed,
    confirmedAttendees: attendedEmails.length,
    confirmedNonAttendees: nonAttendEmails.length,
    attendanceUnknown: unknownEmails.length,
    registrantsWithoutOutcome: unknownEmails.length,
    neverRegistered,
    knownAttendanceRegistrations,
    totalValidRegistrations: validRegs,
    callsAttempted,
    callsAnswered,
    callsUnanswered,
    uniqueLeadsCalled: calledLeadIds.size,
    uniqueLeadsReached: reachedLeadIds.size,
    followUpsScheduled,
    futureIntakeOutcomes,
    eligibilityReviewOutcomes,
    qualifiedLeads,
    provisionallyEligible,
    verifiedEligible,
    futureIntakeOpportunities,
    commercialReferrals,
    commercialClosedWon,
    employerCommitments,
    closedWon,
    applicationsSubmitted,
    enrolmentsCompleted,
    confirmedStarts,
    leadsWithApplication,
    leadsWithStart,
    apollo,
    rates,
  };
}

/* --------------------- information-session comparison -------------------- */

export interface SessionGroupStats {
  group: SessionGroupId;
  meta: SessionGroupMeta;
  uniqueLeads: number;
  qualifiedLeads: number;
  verifiedEligible: number;
  futureIntake: number;
  employerCommitments: number;
  applications: number;
  enrolments: number;
  starts: number;
  commercialReferrals: number;
  leadToApplicationRate: number | null;
  leadToStartRate: number | null;
  avgCallAttempts: number;
  avgAnsweredConversations: number;
  avgDaysToConversion: number | null;
  leadIds: string[];
}

function averageOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((n, v) => n + v, 0) / values.length;
}

function daysToConversion(lead: Lead): number | null {
  const start = new Date(lead.acquisitionDate).getTime();
  if (lead.closing) {
    const end = new Date(lead.closing.closingDate).getTime();
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.abs(end - start) / 86400000;
  }
  if (lead.enrolment === "Enrolled" || lead.enrolment === "Apprenticeship Started") {
    return null;
  }
  return null;
}

export function computeSessionGroups(
  state: WorkspaceState,
  filters: ConversionFilters,
  canSeeOwner: (ownerId: string | null | undefined) => boolean,
): SessionGroupStats[] {
  const cohort = filterCohortLeads(state, filters, canSeeOwner);
  const cohortIds = new Set(cohort.map((l) => l.id));
  const regIndex = registrationsByEmail(Array.isArray(state.events) ? state.events : []);
  const calls = Array.isArray(state.calls) ? state.calls : [];
  const applications = (Array.isArray(state.applications) ? state.applications : []).filter((a) =>
    a.leadId ? cohortIds.has(a.leadId) : false,
  );
  const agreements = Array.isArray(state.employerAgreements) ? state.employerAgreements : [];
  const futureIntakes = Array.isArray(state.futureIntakes) ? state.futureIntakes : [];
  const commercial = Array.isArray(state.commercialOpportunities)
    ? state.commercialOpportunities
    : [];

  const grouped = new Map<SessionGroupId, Lead[]>();
  SESSION_GROUPS.forEach((g) => grouped.set(g.id, []));
  cohort.forEach((lead) => {
    const g = leadSessionGroup(lead, regIndex);
    grouped.get(g)?.push(lead);
  });

  return SESSION_GROUPS.map((meta) => {
    const leads = grouped.get(meta.id) ?? [];
    const leadIds = leads.map((l) => l.id);
    const idSet = new Set(leadIds);
    const leadCalls = calls.filter((c) => c.leadId && idSet.has(c.leadId));
    const answered = leadCalls.filter(
      (c) => c.status === "answered" || c.status === "connected",
    );
    const apps = applications.filter((a) => a.leadId && idSet.has(a.leadId));
    const leadsWithApp = new Set(apps.map((a) => a.leadId)).size;
    const starts = leads.filter((l) => l.enrolment === "Apprenticeship Started").length;
    const enrolments = leads.filter(
      (l) => l.enrolment === "Enrolled" || l.enrolment === "Apprenticeship Started",
    ).length;
    const employerCommitments = new Set(
      agreements
        .filter(
          (a) => idSet.has(a.leadId ?? "") && (a.status === "Signed" || a.status === "Awaiting Signature"),
        )
        .map((a) => a.leadId),
    ).size;
    const conversionDays = leads
      .map((l) => daysToConversion(l))
      .filter((d): d is number => d != null);

    return {
      group: meta.id,
      meta,
      uniqueLeads: leads.length,
      qualifiedLeads: leads.filter((l) => QUALIFIED_STAGES.has(l.stage)).length,
      verifiedEligible: leads.filter((l) => l.eligibility?.decision === "Verified Eligible").length,
      futureIntake: new Set(
        futureIntakes.filter((f) => idSet.has(f.leadId)).map((f) => f.leadId),
      ).size,
      employerCommitments,
      applications: apps.length,
      enrolments,
      starts,
      commercialReferrals: new Set(
        commercial.filter((c) => idSet.has(c.leadId)).map((c) => c.leadId),
      ).size,
      leadToApplicationRate: leads.length ? (leadsWithApp / leads.length) * 100 : null,
      leadToStartRate: leads.length ? (starts / leads.length) * 100 : null,
      avgCallAttempts: leads.length ? leadCalls.length / leads.length : 0,
      avgAnsweredConversations: leads.length ? answered.length / leads.length : 0,
      avgDaysToConversion: conversionDays.length ? averageOf(conversionDays) : null,
      leadIds,
    };
  });
}
