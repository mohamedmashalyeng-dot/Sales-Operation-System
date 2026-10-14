import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BarList, { type BarListItem } from "@/components/base/BarList";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import MetricCard from "@/components/base/MetricCard";
import Select from "@/components/base/Select";
import { usePermissions } from "@/hooks/usePermissions";
import { buildJourney } from "@/config/attribution";
import { OPEN_COMMERCIAL_STAGES } from "@/config/commercial";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Lead, Touchpoint } from "@/store/types";
import { computeApprenticeshipMetrics, groupCount, groupWithSecondary } from "@/utils/apprenticeship";
import { leadProgrammeOptions, ownerOptions } from "@/utils/filterOptions";

interface ReportSection {
  title: string;
  subtitle: string;
  icon: string;
  items: BarListItem[];
  tone: "primary" | "accent" | "secondary";
  showSecondary?: boolean;
  onSelect?: (label: string) => void;
}

export default function ApprenticeshipReportsPage() {
  const navigate = useNavigate();
  const { state, userName } = useWorkspace();
  const { canSeeOwner } = usePermissions();
  const [programme, setProgramme] = useState("all");
  const [owner, setOwner] = useState("all");
  const [range, setRange] = useState("all");
  const programmes = useMemo(() => leadProgrammeOptions(state), [state]);
  const owners = useMemo(() => ownerOptions(state), [state]);

  const metrics = useMemo(() => computeApprenticeshipMetrics(state, canSeeOwner), [state, canSeeOwner]);

  const leads = useMemo(() => {
    const now = Date.now();
    const days = range === "30d" ? 30 : range === "90d" ? 90 : 0;
    return state.leads
      .filter((l) => canSeeOwner(l.ownerId))
      .filter((l) => (programme === "all" ? true : l.programme === programme))
      .filter((l) => (owner === "all" ? true : l.ownerId === owner))
      .filter((l) => (days ? now - new Date(l.createdAt).getTime() <= days * 86400000 : true));
  }, [state.leads, canSeeOwner, programme, owner, range]);

  const touchByLead = useMemo(() => {
    const map = new Map<string, Touchpoint[]>();
    state.touchpoints.forEach((t) => {
      const list = map.get(t.leadId) ?? [];
      list.push(t);
      map.set(t.leadId, list);
    });
    return map;
  }, [state.touchpoints]);

  const journeyFor = (lead: Lead) => buildJourney(touchByLead.get(lead.id) ?? []);

  const enrolmentOwnerFor = (lead: Lead): string => {
    const fi = state.futureIntakes.find((f) => f.leadId === lead.id);
    if (fi) return userName(fi.enrolmentOwnerId);
    const app = state.applications.find((a) => a.leadId === lead.id);
    if (app) return userName(app.ownerId);
    return "Unassigned";
  };

  const employerFor = (lead: Lead): string => {
    const agreement = state.employerAgreements.find((a) => a.leadId === lead.id);
    if (agreement) return agreement.employerName;
    if (lead.tags.includes("Corporate") || lead.tags.includes("Apprenticeship")) return lead.name;
    return "No employer recorded";
  };

  const fundingRouteFor = (lead: Lead): string =>
    lead.eligibility?.decision ?? lead.eligibility?.status ?? "Not Assessed";

  const toItems = (groups: { key: string; count: number; secondary?: number }[]): BarListItem[] =>
    groups.map((g) => ({ label: g.key, value: g.count, secondary: g.secondary }));

  const wonLeads = leads.filter((l) => l.stage === "Won");

  const intakeRows = state.futureIntakes.filter((f) => leads.some((l) => l.id === f.leadId));
  const commercialRows = state.commercialOpportunities.filter((c) => leads.some((l) => l.id === c.leadId));

  const sections: ReportSection[] = [
    {
      title: "Leads by programme",
      subtitle: "Where demand is concentrated",
      icon: "ri-book-open-line",
      tone: "primary",
      items: toItems(groupCount(leads, (l) => l.programme)),
    },
    {
      title: "Leads by intake",
      subtitle: "Intake planning across the funnel",
      icon: "ri-calendar-line",
      tone: "secondary",
      items: toItems(groupCount(leads, (l) => l.intake)),
    },
    {
      title: "Leads by acquisition source",
      subtitle: "Closed-won shown as the secondary bar",
      icon: "ri-flow-chart",
      tone: "accent",
      showSecondary: true,
      items: toItems(groupWithSecondary(leads, (l) => l.source, (l) => l.stage === "Won")),
      onSelect: (label) => navigate(`/leads?source=${encodeURIComponent(label)}`),
    },
    {
      title: "First touch",
      subtitle: "Acquisition attribution (first interaction)",
      icon: "ri-fingerprint-line",
      tone: "primary",
      items: toItems(groupCount(leads, (l) => journeyFor(l).first?.source ?? "No touchpoints")),
    },
    {
      title: "Second touch",
      subtitle: "The next recorded interaction",
      icon: "ri-route-line",
      tone: "secondary",
      items: toItems(groupCount(leads, (l) => journeyFor(l).second?.source ?? "No second touch")),
    },
    {
      title: "Closing touch",
      subtitle: "Only ever set by the closing workflow",
      icon: "ri-flag-2-line",
      tone: "accent",
      items: toItems(groupCount(leads, (l) => l.closing?.channel ?? "Not closed")),
    },
    {
      title: "By Staff Sales owner",
      subtitle: "Lead ownership",
      icon: "ri-user-star-line",
      tone: "primary",
      items: toItems(groupCount(leads, (l) => userName(l.ownerId))),
    },
    {
      title: "By Staff Enrolment owner",
      subtitle: "Enrolment responsibility",
      icon: "ri-file-user-line",
      tone: "secondary",
      items: toItems(groupCount(leads, (l) => enrolmentOwnerFor(l))),
    },
    {
      title: "By employer",
      subtitle: "Employer engagement",
      icon: "ri-building-2-line",
      tone: "accent",
      items: toItems(groupCount(leads, (l) => employerFor(l))),
    },
    {
      title: "By funding route",
      subtitle: "Verified decision, else screening status",
      icon: "ri-shield-check-line",
      tone: "primary",
      items: toItems(groupCount(leads, (l) => fundingRouteFor(l))),
    },
    {
      title: "Deferral reasons",
      subtitle: "Why learners choose a later intake",
      icon: "ri-calendar-schedule-line",
      tone: "secondary",
      items: toItems(groupCount(intakeRows, (f) => f.reason)),
    },
    {
      title: "Commercial by stage",
      subtitle: "Reported separately from funded starts",
      icon: "ri-briefcase-4-line",
      tone: "accent",
      items: toItems(groupCount(commercialRows, (c) => c.stage)),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">Reporting</p>
        <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">Apprenticeship Reports</h1>
        <p className="mt-1 text-[13px] text-foreground-500">
          Funding eligibility, intake, sales, enrolment and commercial conversion — kept as separate dimensions.
        </p>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            value={range}
            onChange={setRange}
            options={[
              { value: "all", label: "All time" },
              { value: "30d", label: "Last 30 days" },
              { value: "90d", label: "Last 90 days" },
            ]}
          />
          <Select
            value={programme}
            onChange={setProgramme}
            options={programmes}
          />
          <Select
            value={owner}
            onChange={setOwner}
            options={owners}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Eligibility not assessed" value={metrics.eligibilityNotAssessed} icon="ri-question-line" tone="secondary" />
        <MetricCard label="Screening in progress" value={metrics.screeningInProgress} icon="ri-loader-4-line" tone="primary" />
        <MetricCard label="Verified eligible" value={metrics.verifiedEligible} icon="ri-verified-badge-line" tone="success" />
        <MetricCard label="Review required" value={metrics.reviewRequired} icon="ri-eye-line" tone="accent" />
        <MetricCard label="Not eligible for funding" value={metrics.notEligibleFunding} icon="ri-close-circle-line" tone="danger" />
        <MetricCard label="Eligible for current intake" value={metrics.eligibleCurrentIntake} icon="ri-checkbox-circle-line" tone="primary" />
        <MetricCard label="Eligible but deferred" value={metrics.eligibleDeferred} icon="ri-time-line" tone="accent" />
        <MetricCard label="Future intake pipeline" value={metrics.futureIntakePipeline} icon="ri-calendar-schedule-line" tone="secondary" />
        <MetricCard label="Commercial referrals" value={metrics.commercialReferrals} icon="ri-briefcase-4-line" tone="accent" />
        <MetricCard label="Commercial closed won" value={metrics.commercialClosedWon} icon="ri-trophy-line" tone="success" />
        <MetricCard label="Awaiting employer agreement" value={metrics.awaitingEmployerAgreement} icon="ri-file-paper-2-line" tone="primary" />
        <MetricCard label="Awaiting DAS confirmation" value={metrics.awaitingDasConfirmation} icon="ri-government-line" tone="secondary" />
        <MetricCard label="Applications in progress" value={metrics.applicationsInProgress} icon="ri-file-list-3-line" tone="accent" />
        <MetricCard label="Completed enrolments" value={metrics.completedEnrolments} icon="ri-user-follow-line" tone="success" />
        <MetricCard label="Confirmed apprenticeship starts" value={metrics.confirmedStarts} icon="ri-flag-2-line" tone="primary" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader icon={section.icon} iconTone={section.tone} title={section.title} subtitle={section.subtitle} />
            <CardBody>
              <BarList
                items={section.items}
                tone={section.tone}
                showSecondary={section.showSecondary}
                onSelect={section.onSelect}
              />
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader icon="ri-trophy-line" iconTone="primary" title="Closed Won — first touch" subtitle="Acquisition source of won leads" />
          <CardBody>
            <BarList
              tone="primary"
              items={toItems(groupCount(wonLeads, (l) => journeyFor(l).first?.source ?? "No touchpoints"))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon="ri-flag-2-line" iconTone="accent" title="Closed Won — closing channel" subtitle="Channel of the closing interaction" />
          <CardBody>
            <BarList tone="accent" items={toItems(groupCount(wonLeads, (l) => l.closing?.channel ?? "Not recorded"))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon="ri-flow-chart" iconTone="secondary" title="Commercial pipeline" subtitle="Open vs decided" />
          <CardBody>
            <BarList
              tone="secondary"
              items={toItems(
                groupCount(commercialRows, (c) => (OPEN_COMMERCIAL_STAGES.includes(c.stage) ? "Open pipeline" : "Decided")),
              )}
            />
          </CardBody>
        </Card>
      </div>

      <p className="text-[11px] leading-snug text-foreground-400">
        Attribution method: acquisition is attributed to the first touch and conversion to the closing touch.
        A touchpoint before closing is never assumed to have caused it. Deferred learners are never counted
        as lost, verified-eligible learners are never counted as enrolments or starts, and commercial
        acceptance is never counted as a funded apprenticeship start. All records are fictional.
      </p>
    </div>
  );
}
