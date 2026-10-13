import Badge from "@/components/base/Badge";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { SCENARIOS } from "@/config/scenarios";
import { describeEvidence, useScenarioEvidence, type ManualStatus } from "@/hooks/useScenarioEvidence";
import { scenarioDataRevision } from "@/utils/scenarios";
import type { WorkspaceState } from "@/store/types";

interface Bucket {
  label: string;
  value: number;
  tone: "success" | "danger" | "neutral" | "warning";
  icon: string;
  hint: string;
}

/**
 * A top-level roll-up of manual QA evidence that deliberately separates CURRENT
 * passes from failures, untested scenarios, and OUTDATED results that need a
 * retest after a dataset reset or a scenario-data change. Historical results are
 * preserved and counted, never discarded.
 */
export default function QaSummaryPanel({ state }: { state: WorkspaceState }) {
  const { store } = useScenarioEvidence();

  let passed = 0;
  let failed = 0;
  let notTested = 0;
  let outdated = 0;
  let historical = 0;

  SCENARIOS.forEach((scenario) => {
    const list = store[scenario.id] ?? [];
    if (list.length > 1) historical += list.length - 1;
    const latest = list[0];
    if (!latest) {
      notTested += 1;
      return;
    }
    const view = describeEvidence(latest, scenarioDataRevision(scenario, state));
    if (!view.current) {
      outdated += 1;
      return;
    }
    if (latest.status === "passed") passed += 1;
    else if (latest.status === "failed" || latest.status === "blocked") failed += 1;
    else notTested += 1;
  });

  const buckets: Bucket[] = [
    { label: "Current valid passes", value: passed, tone: "success", icon: "ri-checkbox-circle-fill", hint: "Passed and still matching the current data" },
    { label: "Current failures", value: failed, tone: "danger", icon: "ri-close-circle-fill", hint: "Failed or blocked against current data" },
    { label: "Not tested", value: notTested, tone: "neutral", icon: "ri-question-line", hint: "No manual result recorded yet" },
    { label: "Outdated / Needs retest", value: outdated, tone: "warning", icon: "ri-history-line", hint: "Result predates a reset or a scenario change" },
  ];

  return (
    <Card>
      <CardHeader
        icon="ri-clipboard-line"
        iconTone="accent"
        title="Manual QA evidence summary"
        subtitle="Separates current passes, failures, untested and outdated results — history is preserved"
      />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {buckets.map((bucket) => (
            <div key={bucket.label} className="rounded-lg border border-background-200 bg-background-50 p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-background-100 text-base text-foreground-600">
                  <i className={bucket.icon}></i>
                </span>
                <Badge tone={bucket.tone}>{bucket.value}</Badge>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-foreground-800">{bucket.label}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-foreground-400">{bucket.hint}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-foreground-400">
          {historical > 0
            ? `${historical} earlier result${historical === 1 ? "" : "s"} preserved in history. `
            : ""}
          A manual pass is never upgraded automatically and an old Failed is never changed to Passed. Results
          captured before a dataset reset are shown as “Previous test result — needs retest after dataset reset”.
        </p>
      </CardBody>
    </Card>
  );
}

export type { ManualStatus };