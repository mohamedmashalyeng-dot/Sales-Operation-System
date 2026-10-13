import { useMemo, useState } from "react";
import Badge from "@/components/base/Badge";
import { Card } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { SCENARIOS } from "@/config/scenarios";
import { scenarioDataRevision, scenarioSummary } from "@/utils/scenarios";
import { describeEvidence, useScenarioEvidence } from "@/hooks/useScenarioEvidence";
import ScenarioDetail from "@/pages/scenarios/components/ScenarioDetail";
import QaSummaryPanel from "@/pages/scenarios/components/QaSummaryPanel";
import IntegrityPanel from "@/pages/scenarios/components/IntegrityPanel";
import RoleUatChecklist from "@/pages/scenarios/components/RoleUatChecklist";
import { cn } from "@/utils/format";

export default function ScenariosPage() {
  const { state } = useWorkspace();
  const { can } = usePermissions();
  const { latest } = useScenarioEvidence();
  const [selectedId, setSelectedId] = useState<string>(SCENARIOS[0]?.id ?? "A");

  const allowed = can("scenarios.view");

  const summaries = useMemo(
    () => SCENARIOS.map((scenario) => ({ scenario, summary: scenarioSummary(scenario, state) })),
    [state],
  );

  const selected = SCENARIOS.find((s) => s.id === selectedId) ?? SCENARIOS[0];

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Demo scenarios are restricted"
            message="Scenario walkthroughs are not available for this demo role."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">
            Demonstration &amp; UAT
          </p>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">
            Demo Scenarios
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] text-foreground-500">
            Six clickable end-to-end apprenticeship journeys built on the real shared records. Use the
            guided walkthrough to step through each journey, open the actual screens and record honest
            manual QA evidence. Information sessions are always optional — a prospect can reach an
            application and enrolment without ever attending one.
          </p>
        </div>
        <Badge tone="warning" icon="ri-error-warning-line">
          Fictional demonstration data only
        </Badge>
      </div>

      <QaSummaryPanel state={state} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        <div className="space-y-2">
          {summaries.map(({ scenario, summary }) => {
            const active = scenario.id === selected?.id;
            const failing = summary.validation.failed;
            const record = latest(scenario.id);
            const evidence = record
              ? describeEvidence(record, scenarioDataRevision(scenario, state))
              : null;
            return (
              <button
                key={scenario.id}
                type="button"
                onClick={() => setSelectedId(scenario.id)}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-2 rounded-lg border bg-background-50 p-3 text-left transition-colors",
                  active
                    ? "border-primary-400 ring-2 ring-primary-100"
                    : "border-background-200 hover:border-primary-300 hover:bg-primary-50/40",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                      active ? "bg-primary-500 text-background-50" : "bg-background-200 text-foreground-700",
                    )}
                  >
                    {scenario.id}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900">{scenario.title}</p>
                    <p className="mt-0.5 text-[11px] text-foreground-500">
                      {summary.lead ? `${summary.lead.name} · ${summary.leadSource}` : "Lead missing"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="success" dot>
                    {summary.validation.passed} passed
                  </Badge>
                  {failing > 0 ? (
                    <Badge tone="danger" dot>
                      {failing} failed
                    </Badge>
                  ) : null}
                  {!evidence ? (
                    <Badge tone="neutral" dot>
                      UAT: not tested
                    </Badge>
                  ) : !evidence.current ? (
                    <Badge tone="warning" dot>
                      UAT: needs retest
                    </Badge>
                  ) : (
                    <Badge tone={evidence.record.status === "passed" ? "success" : evidence.record.status === "failed" ? "danger" : "warning"} dot>
                      UAT: {evidence.record.status}
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {selected ? <ScenarioDetail scenario={selected} /> : null}
      </div>

      <IntegrityPanel state={state} />

      <RoleUatChecklist currentRoleId={state.roleId} />
    </div>
  );
}