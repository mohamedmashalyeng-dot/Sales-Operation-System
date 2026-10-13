import { useState } from "react";
import { Link } from "react-router-dom";
import Badge from "@/components/base/Badge";
import type { BadgeTone } from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Select from "@/components/base/Select";
import { ROLE_LIST } from "@/config/permissions";
import type { ScenarioDef } from "@/config/scenarios";
import {
  describeEvidence,
  useScenarioEvidence,
  type ManualStatus,
} from "@/hooks/useScenarioEvidence";
import { useScenarioWalkthrough } from "@/hooks/useScenarioWalkthrough";
import { formatDateTime } from "@/utils/format";
import type { ScenarioRecordLink, ScenarioValidation } from "@/utils/scenarios";

const STATUS_META: Record<ManualStatus, { label: string; tone: BadgeTone; icon: string }> = {
  passed: { label: "Passed", tone: "success", icon: "ri-checkbox-circle-fill" },
  failed: { label: "Failed", tone: "danger", icon: "ri-close-circle-fill" },
  blocked: { label: "Blocked", tone: "warning", icon: "ri-error-warning-fill" },
  "not-tested": { label: "Not tested", tone: "neutral", icon: "ri-question-line" },
};

/**
 * The QA evidence panel. It keeps FOUR genuinely different things apart, exactly
 * as the review process requires:
 *   1. Automated data validation (evaluated live against the store).
 *   2. Pages visited during the walkthrough.
 *   3. Actions the reviewer actually performed.
 *   4. The manual UAT result — recorded ONLY by an explicit human action, and
 *      versioned against the dataset / schema / scenario revision so stale
 *      evidence can never masquerade as current.
 */
export default function QaResultPanel({
  scenario,
  validation,
  records,
  scenarioRevision,
}: {
  scenario: ScenarioDef;
  validation: ScenarioValidation;
  records: ScenarioRecordLink[];
  scenarioRevision: string;
}) {
  const { history, record } = useScenarioEvidence();
  const { getStep } = useScenarioWalkthrough();

  const list = history(scenario.id);
  const latest = list[0];
  const view = latest ? describeEvidence(latest, scenarioRevision) : null;

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ManualStatus>("passed");
  const [role, setRole] = useState(ROLE_LIST[0]?.name ?? "Manager");
  const [notes, setNotes] = useState("");
  const [defect, setDefect] = useState("");

  const visited = scenario.steps.filter((s) => getStep(scenario.id, s.id).visited).length;
  const performed = scenario.steps.filter((s) => getStep(scenario.id, s.id).actionPerformed).length;
  const firstBroken = records.find((r) => !r.found);

  const save = () => {
    record(scenario.id, { status, role, notes: notes.trim(), defect: defect.trim(), scenarioRevision });
    setOpen(false);
    setNotes("");
    setDefect("");
  };

  return (
    <Card>
      <CardHeader
        icon="ri-clipboard-line"
        iconTone="secondary"
        title="QA evidence"
        subtitle="Automated check · walkthrough progress · manual UAT result — kept separate"
      />
      <CardBody className="space-y-3">
        {/* 1. automated */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">
            1 · Automated data validation
          </span>
          <Badge
            tone={validation.failed > 0 ? "danger" : "success"}
            icon={validation.failed > 0 ? "ri-close-circle-fill" : "ri-checkbox-circle-fill"}
          >
            {validation.failed > 0 ? `${validation.failed} failed` : "Passed"}
          </Badge>
        </div>

        {/* 2 & 3. walkthrough progress */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">
            2 · Walkthrough
          </span>
          <Badge tone="secondary" icon="ri-eye-line">
            {visited} page{visited === 1 ? "" : "s"} visited
          </Badge>
          <Badge tone="accent" icon="ri-cursor-line">
            {performed} action{performed === 1 ? "" : "s"} performed
          </Badge>
        </div>

        {/* 4. manual UAT result */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">
            4 · Manual UAT result
          </span>
          {view ? (
            view.current ? (
              <Badge tone={STATUS_META[view.record.status].tone} icon={STATUS_META[view.record.status].icon}>
                {STATUS_META[view.record.status].label}
              </Badge>
            ) : (
              <Badge tone="warning" icon="ri-history-line">
                Needs retest
              </Badge>
            )
          ) : (
            <Badge tone="neutral" icon="ri-question-line">
              Not tested
            </Badge>
          )}
        </div>

        {view ? (
          <div
            className={`rounded-md border px-3 py-2.5 text-[12px] ${
              view.current
                ? "border-background-200 bg-background-50 text-foreground-600"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            <p>
              <strong>{(view.record.status === "not-tested" ? "Not tested" : STATUS_META[view.record.status].label)}</strong>{" "}
              recorded {formatDateTime(view.record.testedAt)} as <strong>{view.record.role}</strong>.
            </p>
            {!view.current ? <p className="mt-1 font-semibold">{view.reason}</p> : null}
            {view.record.notes ? <p className="mt-1">Notes: {view.record.notes}</p> : null}
            {view.record.defect ? (
              <p className="mt-1">
                Defect: {view.record.defect}
                {firstBroken ? (
                  <>
                    {" · "}
                    <Link to={firstBroken.route ?? "#"} className="font-semibold text-primary-600 hover:underline">
                      Open {firstBroken.label}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        {open ? (
          <div className="space-y-2.5 rounded-md border border-background-300 bg-background-100/60 p-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Select
                label="Manual result"
                size="sm"
                value={status}
                onChange={(v) => setStatus(v as ManualStatus)}
                options={[
                  { value: "passed", label: "Passed" },
                  { value: "failed", label: "Failed" },
                  { value: "blocked", label: "Blocked" },
                  { value: "not-tested", label: "Not tested" },
                ]}
              />
              <Select
                label="Tester role"
                size="sm"
                value={role}
                onChange={setRole}
                options={ROLE_LIST.map((r) => ({ value: r.name, label: r.name }))}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                Reviewer notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="What did you observe?"
                className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                Defect description (only needed if failed/blocked)
              </label>
              <textarea
                value={defect}
                onChange={(e) => setDefect(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="Describe what broke…"
                className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={save} leftIcon={<i className="ri-save-line"></i>}>
                Save manual result
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" leftIcon={<i className="ri-cursor-line"></i>} onClick={() => setOpen(true)}>
            Record a manual browser test result
          </Button>
        )}

        {list.length > 1 ? (
          <div className="border-t border-background-200 pt-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-foreground-400">
              History ({list.length - 1} earlier result{list.length - 1 === 1 ? "" : "s"})
            </p>
            <ul className="space-y-1.5">
              {list.slice(1).map((entry) => {
                const ev = describeEvidence(entry, scenarioRevision);
                return (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-background-200 bg-background-50 px-2.5 py-1.5 text-[11px] text-foreground-500"
                  >
                    <Badge tone={STATUS_META[entry.status].tone}>{STATUS_META[entry.status].label}</Badge>
                    <span>{formatDateTime(entry.testedAt)}</span>
                    <span>· {entry.role}</span>
                    {!ev.current ? <Badge tone="warning">Outdated</Badge> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <p className="text-[11px] leading-snug text-foreground-400">
          A manual result is only ever set by an explicit reviewer action — never inferred from the
          automated check or a successful build. Each result is stamped with the dataset generation,
          schema version and a signature of the scenario data, so stale evidence is flagged rather
          than presented as current.
        </p>
      </CardBody>
    </Card>
  );
}