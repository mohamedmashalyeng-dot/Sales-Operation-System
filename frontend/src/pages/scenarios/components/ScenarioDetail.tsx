import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { ScenarioDef } from "@/config/scenarios";
import { scenarioDataRevision, scenarioRecords, validateScenario } from "@/utils/scenarios";
import ValidationChecklist from "@/pages/scenarios/components/ValidationChecklist";
import QaResultPanel from "@/pages/scenarios/components/QaResultPanel";
import GuidedWalkthrough from "@/pages/scenarios/components/GuidedWalkthrough";

export default function ScenarioDetail({ scenario }: { scenario: ScenarioDef }) {
  const { state } = useWorkspace();
  const [guided, setGuided] = useState(false);

  const validation = useMemo(() => validateScenario(scenario, state), [scenario, state]);
  const records = useMemo(() => scenarioRecords(scenario, state), [scenario, state]);
  const revision = useMemo(() => scenarioDataRevision(scenario, state), [scenario, state]);

  const lead = state.leads.find((l) => l.id === scenario.leadId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon="ri-route-line"
          iconTone="primary"
          title={`Scenario ${scenario.id} — ${scenario.title}`}
          subtitle={scenario.summary}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {validation.failed > 0 ? (
                <Badge tone="danger" icon="ri-alert-line">
                  {validation.failed} check{validation.failed === 1 ? "" : "s"} failing
                </Badge>
              ) : (
                <Badge tone="success" icon="ri-check-double-line">
                  Automated checks passed
                </Badge>
              )}
              <Button
                size="sm"
                variant={guided ? "ghost" : "primary"}
                leftIcon={<i className={guided ? "ri-close-line" : "ri-play-circle-line"}></i>}
                onClick={() => setGuided((g) => !g)}
              >
                {guided ? "Close guided mode" : "Start guided walkthrough"}
              </Button>
            </div>
          }
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Badge tone="secondary" icon="ri-user-3-line">
              {lead ? `${lead.name} · ${lead.id}` : "Lead missing"}
            </Badge>
            <Badge tone="neutral" icon="ri-radar-line">
              Source: {lead?.source ?? "Not recorded"}
            </Badge>
            <Badge tone="accent" icon="ri-shield-user-line">
              {scenario.roles}
            </Badge>
            <Badge tone="neutral" icon="ri-fingerprint-line">
              Data revision: {revision}
            </Badge>
          </div>

          {/* Journey diagram */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-foreground-400">
              Business journey
            </p>
            <ol className="relative space-y-2 pl-6">
              <span className="absolute left-[9px] top-3 bottom-3 w-px bg-background-300" aria-hidden="true" />
              {scenario.steps.map((step, index) => (
                <li key={step.id} className="relative">
                  <span className="absolute -left-6 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-background-300 bg-background-50">
                    <span className="text-[10px] font-bold text-primary-600">{index + 1}</span>
                  </span>
                  <div className="flex flex-col gap-2 rounded-md border border-background-200 bg-background-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary-100 text-lg text-secondary-900">
                        <i className={step.icon}></i>
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-foreground-900">{step.label}</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">{step.detail}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pl-10 sm:pl-0">
                      <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-foreground-400 md:inline">
                        {step.module}
                      </span>
                      {step.route ? (
                        <Link
                          to={step.route}
                          className="inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 text-[12px] font-semibold text-foreground-700 hover:bg-background-100"
                        >
                          <i className="ri-external-link-line"></i> Open
                        </Link>
                      ) : (
                        <span className="text-[11px] text-foreground-400">No screen</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </CardBody>
      </Card>

      {guided ? <GuidedWalkthrough scenario={scenario} onExit={() => setGuided(false)} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon="ri-links-line"
            iconTone="secondary"
            title="Linked records"
            subtitle="Every step resolves to a real shared record — missing records are shown honestly"
          />
          <CardBody>
            <ul className="space-y-1.5">
              {records.map((record) => (
                <li
                  key={`${record.label}-${record.id}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-background-200 bg-background-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-foreground-800">
                      {record.label}
                      {!record.found ? (
                        <span className="ml-2 font-normal text-foreground-400">· missing record</span>
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-foreground-500">
                      {record.id} · {record.detail}
                    </p>
                  </div>
                  {record.found && record.route ? (
                    <Link
                      to={record.route}
                      className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-background-300 px-2.5 text-[11px] font-semibold text-foreground-600 hover:bg-background-100"
                    >
                      View
                    </Link>
                  ) : (
                    <Badge tone={record.found ? "success" : "danger"} dot>
                      {record.found ? "Found" : "Missing"}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon="ri-checkbox-multiple-line"
            iconTone="accent"
            title="Validation checklist"
            subtitle="Automated data checks, kept separate from manual browser testing"
          />
          <CardBody>
            {validation.recordFound ? (
              <ValidationChecklist checks={validation.checks} />
            ) : (
              <EmptyState
                icon="ri-error-warning-line"
                tone="error"
                title="Lead record missing"
                message="This scenario's lead record does not exist in the current workspace, so it cannot be validated until backend data is loaded."
              />
            )}
          </CardBody>
        </Card>

        <QaResultPanel
          scenario={scenario}
          validation={validation}
          records={records}
          scenarioRevision={revision}
        />
      </div>

    </div>
  );
}
