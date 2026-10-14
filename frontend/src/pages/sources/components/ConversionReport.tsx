import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Select from "@/components/base/Select";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { leadProgrammeOptions, ownerOptions } from "@/utils/filterOptions";
import RateCard from "@/pages/sources/components/RateCard";
import SessionComparison from "@/pages/sources/components/SessionComparison";
import {
  computeConversionMetrics,
  computeSessionGroups,
  DEFAULT_CONVERSION_FILTERS,
  type ConversionFilters,
  type ConversionMetrics,
} from "@/utils/conversion";

interface DrillableTile {
  label: string;
  value: number;
  hint: string;
  to?: string;
}

interface MetricSection {
  title: string;
  subtitle: string;
  icon: string;
  tone: "primary" | "accent" | "secondary";
  tiles: DrillableTile[];
}

function MetricTile({ label, value, hint, onDrill }: DrillableTile & { onDrill?: () => void }) {
  if (onDrill) {
    return (
      <button
        type="button"
        onClick={onDrill}
        className="group flex w-full cursor-pointer flex-col rounded-lg border border-primary-200 bg-primary-50/50 p-3.5 text-left transition-colors hover:border-primary-300 hover:bg-primary-50"
      >
        <span className="flex items-center justify-between">
          <span className="font-heading text-2xl font-bold leading-none text-foreground-900">{value}</span>
          <i className="ri-arrow-right-up-line text-base text-primary-600 transition-transform group-hover:translate-x-0.5"></i>
        </span>
        <span className="mt-1.5 text-[13px] font-medium text-foreground-700">{label}</span>
        <span className="mt-0.5 text-[11px] leading-snug text-foreground-400">{hint}</span>
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3.5">
      <p className="font-heading text-2xl font-bold leading-none text-foreground-900">{value}</p>
      <p className="mt-1.5 text-[13px] font-medium text-foreground-700">{label}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-foreground-400">{hint}</p>
    </div>
  );
}

export default function ConversionReport() {
  const navigate = useNavigate();
  const { state } = useWorkspace();
  const { canSeeOwner } = usePermissions();
  const [filters, setFilters] = useState<ConversionFilters>({ ...DEFAULT_CONVERSION_FILTERS });

  const set = (patch: Partial<ConversionFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const programmes = useMemo(() => leadProgrammeOptions(state), [state]);
  const owners = useMemo(() => ownerOptions(state), [state]);

  const metrics: ConversionMetrics = useMemo(
    () => computeConversionMetrics(state, filters, canSeeOwner),
    [state, filters, canSeeOwner],
  );

  const groups = useMemo(
    () => computeSessionGroups(state, filters, canSeeOwner),
    [state, filters, canSeeOwner],
  );

  // Builds a Leads-list URL that carries the SAME cohort scope as the report,
  // so the report's unique-lead figures and the drill-down list reconcile.
  const leadQuery = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    if (filters.programme !== "all") params.set("programme", filters.programme);
    if (filters.owner !== "all") params.set("owner", filters.owner);
    if (filters.acquisitionFrom) params.set("acqFrom", filters.acquisitionFrom);
    if (filters.acquisitionTo) params.set("acqTo", filters.acquisitionTo);
    Object.entries(extra).forEach(([key, value]) => params.set(key, value));
    return `/leads?${params.toString()}`;
  };

  const drillGroup = (group: string) => navigate(leadQuery({ segment: group }));

  const sections: MetricSection[] = [
    {
      title: "Acquisition",
      subtitle: "Unique contacts by original acquisition source (cohort)",
      icon: "ri-radar-line",
      tone: "primary",
      tiles: [
        { label: "Apollo.io sourced", value: metrics.apolloSourced, hint: "Unique leads with Apollo.io as original source" },
        { label: "Website enquiries", value: metrics.websiteEnquiries, hint: "Direct enquiries via the website" },
        { label: "Direct email enquiries", value: metrics.directEmailEnquiries, hint: "Inbound email to admissions" },
        { label: "Eventbrite listing enquiries", value: metrics.eventbriteListings, hint: "Registered via a public Eventbrite listing" },
        { label: "Contacts managed in Zoho CRM", value: metrics.contactsInZoho, hint: "Leads with a CRM sync record" },
        { label: "Exported from Zoho for marketing", value: metrics.contactsExportedForMarketing, hint: "Unique emails imported into a campaign audience" },
      ],
    },
    {
      title: "Apollo.io cohort",
      subtitle:
        "Apollo-sourced contacts in an audience are NOT the same as Apollo CRM Leads — and audience membership is never engagement",
      icon: "ri-radar-line",
      tone: "primary",
      tiles: [
        { label: "Apollo audience contacts", value: metrics.apollo.audienceContacts, hint: "Unique contacts in an Apollo-provider campaign audience (membership only)" },
        { label: "Apollo CRM leads", value: metrics.apollo.crmLeads, hint: "Leads whose own original acquisition source is Apollo.io — click to filter", to: leadQuery({ filter: "apollo" }) },
        { label: "Apollo leads invited", value: metrics.apollo.invited, hint: "Apollo leads who received a campaign invitation — click to filter", to: leadQuery({ filter: "eventbrite-invited" }) },
        { label: "Apollo leads registered", value: metrics.apollo.registered, hint: "Apollo leads who registered for an information session" },
        { label: "Apollo leads reached (Zoom Phone)", value: metrics.apollo.reached, hint: "Apollo leads with an answered call" },
        { label: "Apollo leads qualified", value: metrics.apollo.qualified, hint: "Apollo leads at Qualified, Proposal sent or Won" },
        { label: "Apollo leads with applications", value: metrics.apollo.withApplication, hint: "Apollo leads with a submitted application" },
        { label: "Apollo leads enrolled", value: metrics.apollo.enrolled, hint: "Apollo leads at Enrolled or beyond" },
        { label: "Apollo leads with confirmed starts", value: metrics.apollo.starts, hint: "Apollo leads at Apprenticeship Started" },
      ],
    },
    {
      title: "Campaign",
      subtitle: "Eventbrite email campaigns — invitation is not registration",
      icon: "ri-megaphone-line",
      tone: "accent",
      tiles: [
        { label: "Unique imported recipients", value: metrics.uniqueImportedRecipients, hint: "Distinct email addresses in audiences" },
        { label: "Invitations sent", value: metrics.invitationsSent, hint: "Campaign email sends (count, not unique)" },
        { label: "Explicitly recorded deliveries", value: metrics.recordedDeliveries, hint: "Only where fictional data records delivery" },
        { label: "Unique event registrations", value: metrics.uniqueEventRegistrations, hint: "Distinct people registered for an event" },
        { label: "Registration cancellations", value: metrics.registrationCancellations, hint: "Cancelled registrations (separate fact)" },
        { label: "Campaign-attributed registrations", value: metrics.campaignAttributedRegistrations, hint: "Only where a link is explicitly recorded" },
      ],
    },
    {
      title: "Zoom Information Sessions",
      subtitle: "Registrations and attendance kept separate",
      icon: "ri-vidicon-line",
      tone: "secondary",
      tiles: [
        { label: "Confirmed attendees", value: metrics.confirmedAttendees, hint: "Explicit attendance confirmed" },
        { label: "Confirmed non-attendees", value: metrics.confirmedNonAttendees, hint: "Recorded 'Did Not Attend'" },
        { label: "Attendance unknown", value: metrics.attendanceUnknown, hint: "Registered, outcome not recorded" },
        { label: "Registrants without outcome", value: metrics.registrantsWithoutOutcome, hint: "No attendance outcome yet" },
        { label: "Never registered", value: metrics.neverRegistered, hint: "No info-session registration (includes direct)" },
      ],
    },
    {
      title: "Zoom Phone",
      subtitle: "Sales calling — attempts distinct from answered conversations",
      icon: "ri-phone-line",
      tone: "primary",
      tiles: [
        { label: "Calls attempted", value: metrics.callsAttempted, hint: "Every logged dial" },
        { label: "Calls answered", value: metrics.callsAnswered, hint: "Answered or connected" },
        { label: "Calls unanswered", value: metrics.callsUnanswered, hint: "No answer or voicemail" },
        { label: "Unique leads called", value: metrics.uniqueLeadsCalled, hint: "Distinct leads dialled" },
        { label: "Unique leads reached", value: metrics.uniqueLeadsReached, hint: "Distinct leads answered" },
        { label: "Follow-ups scheduled", value: metrics.followUpsScheduled, hint: "Planner tasks linked to a call" },
        { label: "Future Intake outcomes", value: metrics.futureIntakeOutcomes, hint: "Call outcome = Wants Future Intake" },
        { label: "Eligibility Review outcomes", value: metrics.eligibilityReviewOutcomes, hint: "Call outcome = Eligibility Review Required" },
      ],
    },
    {
      title: "Apprenticeship funnel",
      subtitle: "Each outcome is kept separate — Closed Won is not a start",
      icon: "ri-graduation-cap-line",
      tone: "accent",
      tiles: [
        { label: "Qualified leads", value: metrics.qualifiedLeads, hint: "Stage Qualified, Proposal sent or Won" },
        { label: "Provisionally eligible", value: metrics.provisionallyEligible, hint: "Screening status Provisionally Eligible" },
        { label: "Verified eligible", value: metrics.verifiedEligible, hint: "A verified funding decision" },
        { label: "Future Intake opportunities", value: metrics.futureIntakeOpportunities, hint: "Deferred — never counted as lost" },
        { label: "Commercial referrals", value: metrics.commercialReferrals, hint: "Referred for a commercial review" },
        { label: "Commercial Closed Won", value: metrics.commercialClosedWon, hint: "Commercial wins, separate from funded starts" },
        { label: "Employer commitments", value: metrics.employerCommitments, hint: "Agreement signed or awaiting signature" },
        { label: "Closed Won opportunities", value: metrics.closedWon, hint: "Sales stage closed won" },
        { label: "Applications submitted", value: metrics.applicationsSubmitted, hint: "Application records (not leads)" },
        { label: "Enrolments completed", value: metrics.enrolmentsCompleted, hint: "Enrolment dimension Enrolled or beyond" },
        { label: "Confirmed apprenticeship starts", value: metrics.confirmedStarts, hint: "Enrolment dimension Apprenticeship Started" },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
              Acquisition from
            </label>
            <input
              type="date"
              value={filters.acquisitionFrom}
              onChange={(e) => set({ acquisitionFrom: e.target.value })}
              className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
              Acquisition to
            </label>
            <input
              type="date"
              value={filters.acquisitionTo}
              onChange={(e) => set({ acquisitionTo: e.target.value })}
              className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
          <Select
            label="Programme"
            value={filters.programme}
            onChange={(v) => set({ programme: v })}
            options={programmes}
          />
          <Select
            label="Sales owner"
            value={filters.owner}
            onChange={(v) => set({ owner: v })}
            options={owners}
          />
          <Select
            label="Campaign"
            value={filters.campaign}
            onChange={(v) => set({ campaign: v })}
            options={[
              { value: "all", label: "All campaigns" },
              ...state.campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setFilters({ ...DEFAULT_CONVERSION_FILTERS })}
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-background-300 bg-background-50 px-3 text-[13px] font-semibold text-foreground-600 hover:bg-background-100"
            >
              <i className="ri-refresh-line"></i> Reset filters
            </button>
          </div>
        </CardBody>
        <div className="border-t border-background-200 px-5 py-2.5">
          <p className="text-[11px] text-foreground-500">
            Cohort: {metrics.cohortSize} acquired leads · acquisition date range{" "}
            {filters.acquisitionFrom || filters.acquisitionTo
              ? `${filters.acquisitionFrom || "…"} → ${filters.acquisitionTo || "…"}`
              : "all time"}
            . Acquisition, session and funnel figures reflect the acquisition cohort; campaign and call
            figures reflect the selected scope.
          </p>
        </div>
      </Card>

      {sections.map((section) => (
        <Card key={section.title}>
          <CardHeader
            icon={section.icon}
            iconTone={section.tone}
            title={section.title}
            subtitle={section.subtitle}
          />
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {section.tiles.map((tile) => (
              <MetricTile
                key={tile.label}
                label={tile.label}
                value={tile.value}
                hint={tile.hint}
                onDrill={tile.to ? () => navigate(tile.to as string) : undefined}
              />
            ))}
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader
          icon="ri-percent-line"
          iconTone="secondary"
          title="Conversion denominators"
          subtitle="Every percentage shows its numerator, denominator and business definition"
        />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.rates.map((spec, index) => (
            <RateCard
              key={spec.key}
              spec={spec}
              tone={index % 3 === 0 ? "primary" : index % 3 === 1 ? "accent" : "secondary"}
            />
          ))}
        </CardBody>
      </Card>

      <SessionComparison groups={groups} onDrill={drillGroup} />

      <p className="text-[11px] leading-snug text-foreground-400">
        All figures derive from the active workspace dataset and keep people, leads, registrations,
        invitations, call attempts, applications and apprenticeship starts as distinct entities. Campaign
        recipients are never counted as registrations, a campaign invitation never overwrites the original
        acquisition source, an unanswered call is never an answered conversation, and a commercial
        acceptance is never a funded apprenticeship start. Clicking an Apollo or session-group metric opens
        the Leads list carrying the same acquisition date range, programme and owner, so the two views
        reconcile. Acquisition cohort filters use each lead&apos;s original acquisition date — never the
        campaign invitation date.
      </p>
    </div>
  );
}
