import Badge from "@/components/base/Badge";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import { formatRate, type SessionGroupStats } from "@/utils/conversion";

interface SessionComparisonProps {
  groups: SessionGroupStats[];
  onDrill: (group: string) => void;
}

const METRICS: { key: keyof SessionGroupStats; label: string }[] = [
  { key: "uniqueLeads", label: "Unique leads" },
  { key: "qualifiedLeads", label: "Qualified" },
  { key: "applications", label: "Applications" },
  { key: "enrolments", label: "Enrolments" },
  { key: "starts", label: "Starts" },
];

export default function SessionComparison({ groups, onDrill }: SessionComparisonProps) {
  const comparable = groups.filter((g) => g.meta.id !== "cancelled");
  const maxValue = Math.max(
    1,
    ...comparable.flatMap((g) => METRICS.map((m) => Number(g[m.key]) || 0)),
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon="ri-group-line"
          iconTone="accent"
          title="Information-session comparison"
          subtitle="Four mutually exclusive groups within the selected cohort"
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {comparable.map((g) => (
              <button
                key={g.group}
                type="button"
                onClick={() => onDrill(g.group)}
                className="flex cursor-pointer flex-col rounded-lg border border-background-200 bg-background-50 p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={g.meta.tone}>{`Group ${g.meta.letter}`}</Badge>
                  <span className="text-[11px] font-semibold text-foreground-400">{g.meta.label}</span>
                </div>
                <p className="mt-3 font-heading text-2xl font-bold leading-none text-foreground-900">
                  {g.uniqueLeads}
                </p>
                <p className="mt-1 text-[12px] font-medium text-foreground-600">unique leads</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-foreground-500">
                  <span>Apps: <strong className="text-foreground-800">{g.applications}</strong></span>
                  <span>Starts: <strong className="text-foreground-800">{g.starts}</strong></span>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-foreground-400">{g.meta.description}</p>
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon="ri-bar-chart-grouped-line"
          title="Outcomes by group"
          subtitle={`Grouped comparison across ${METRICS.map((m) => m.label.toLowerCase()).join(", ")}`}
        />
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            {comparable.map((g) => (
              <span key={g.group} className="flex items-center gap-1.5 text-[12px] text-foreground-600">
                <span className={`h-3 w-3 rounded-sm ${g.meta.bar}`}></span>
                {g.meta.label}
              </span>
            ))}
          </div>
          <div className="space-y-5">
            {METRICS.map((metric) => (
              <div key={metric.key} className="space-y-1.5">
                <p className="text-[12px] font-bold uppercase tracking-wide text-foreground-500">
                  {metric.label}
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                  {comparable.map((g) => {
                    const value = Number(g[metric.key]) || 0;
                    const pct = Math.max(value > 0 ? 4 : 0, (value / maxValue) * 100);
                    return (
                      <div key={g.group} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 truncate text-[11px] text-foreground-500">
                          {g.meta.label}
                        </span>
                        <span className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-background-200">
                          <span
                            className={`absolute inset-y-0 left-0 rounded-full ${g.meta.bar}`}
                            style={{ width: `${pct}%` }}
                          ></span>
                        </span>
                        <span className="w-6 shrink-0 text-right text-[12px] font-semibold text-foreground-700">
                          {value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon="ri-percent-line"
          iconTone="secondary"
          title="Conversion-rate comparison"
          subtitle="Lead-to-application and lead-to-start rates per group"
        />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {comparable.map((g) => (
            <div key={g.group} className="rounded-lg border border-background-200 bg-background-50 p-4">
              <Badge tone={g.meta.tone}>{g.meta.label}</Badge>
              <dl className="mt-3 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-foreground-500">Lead-to-application</dt>
                  <dd className="text-[14px] font-bold text-foreground-900">
                    {formatRate(g.leadToApplicationRate)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-foreground-500">Lead-to-start</dt>
                  <dd className="text-[14px] font-bold text-foreground-900">
                    {formatRate(g.leadToStartRate)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-foreground-500">Avg call attempts</dt>
                  <dd className="text-[13px] font-semibold text-foreground-700">
                    {g.avgCallAttempts.toFixed(1)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-foreground-500">Avg answered</dt>
                  <dd className="text-[13px] font-semibold text-foreground-700">
                    {g.avgAnsweredConversations.toFixed(1)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-foreground-500">Avg days to conversion</dt>
                  <dd className="text-[13px] font-semibold text-foreground-700">
                    {g.avgDaysToConversion == null ? "N/A" : g.avgDaysToConversion.toFixed(0)}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => onDrill(g.group)}
                className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-background-300 bg-background-50 px-2 py-1.5 text-[12px] font-semibold text-primary-700 hover:bg-primary-50"
              >
                <i className="ri-external-link-line"></i> Open Leads
              </button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon="ri-table-line"
          title="Detailed comparison"
          subtitle="Counts of unique leads only — never a sum of touchpoints"
        />
        <TableWrap>
          <Table className="min-w-[980px]">
            <THead>
              <Th>Metric</Th>
              {groups.map((g) => (
                <Th key={g.group} className="text-right">
                  {g.meta.letter === "—" ? g.meta.label : `Group ${g.meta.letter}`}
                </Th>
              ))}
            </THead>
            <TBody>
              {[
                ["Unique leads", (g: SessionGroupStats) => g.uniqueLeads],
                ["Qualified leads", (g: SessionGroupStats) => g.qualifiedLeads],
                ["Verified eligible", (g: SessionGroupStats) => g.verifiedEligible],
                ["Future intake", (g: SessionGroupStats) => g.futureIntake],
                ["Employer commitments", (g: SessionGroupStats) => g.employerCommitments],
                ["Submitted applications", (g: SessionGroupStats) => g.applications],
                ["Completed enrolments", (g: SessionGroupStats) => g.enrolments],
                ["Confirmed starts", (g: SessionGroupStats) => g.starts],
                ["Commercial referrals", (g: SessionGroupStats) => g.commercialReferrals],
                ["Avg call attempts", (g: SessionGroupStats) => g.avgCallAttempts.toFixed(1)],
                ["Avg answered conversations", (g: SessionGroupStats) => g.avgAnsweredConversations.toFixed(1)],
                ["Avg days to conversion", (g: SessionGroupStats) => (g.avgDaysToConversion == null ? "N/A" : g.avgDaysToConversion.toFixed(0))],
                ["Lead-to-application rate", (g: SessionGroupStats) => formatRate(g.leadToApplicationRate)],
                ["Lead-to-start rate", (g: SessionGroupStats) => formatRate(g.leadToStartRate)],
              ].map(([label, getter]) => (
                <Tr key={label as string}>
                  <Td className="font-semibold text-foreground-800">{label as string}</Td>
                  {groups.map((g) => (
                    <Td key={g.group} className="text-right text-foreground-700">
                      {(getter as (x: SessionGroupStats) => string | number)(g)}
                    </Td>
                  ))}
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
        <div className="border-t border-background-200 px-5 py-3">
          <p className="text-[11px] leading-snug text-foreground-500">
            <strong>Classification precedence:</strong> confirmed attendance → Did Not Attend → registered
            but unknown → cancelled-only (reported separately) → never registered. Groups are mutually
            exclusive. Information sessions are entirely optional — a prospect can progress through
            Website enquiry → Sales contact → Eligibility → Application → Enrolment without ever attending a
            Zoom information session. Direct applicants are never penalised or excluded.
          </p>
        </div>
      </Card>

      <div className="rounded-lg border border-accent-200 bg-accent-50/60 p-4">
        <p className="flex items-start gap-2 text-[12px] leading-snug text-accent-900">
          <i className="ri-information-line mt-0.5 text-base"></i>
          <span>
            Any difference between attendees and non-attendees is a <strong>descriptive correlation</strong>,
            not proof that attending a session caused conversion. Groups may differ in size, source mix and
            timing.
          </span>
        </p>
      </div>
    </div>
  );
}