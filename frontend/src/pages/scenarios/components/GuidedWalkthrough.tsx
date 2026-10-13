import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import ProgressBar from "@/components/base/ProgressBar";
import type { ScenarioDef } from "@/config/scenarios";
import { useScenarioWalkthrough, type StepResult } from "@/hooks/useScenarioWalkthrough";
import { cn } from "@/utils/format";

const RESULT_META: Record<StepResult, { label: string; tone: "neutral" | "success" | "danger" | "warning"; icon: string }> = {
  none: { label: "Not tested", tone: "neutral", icon: "ri-question-line" },
  passed: { label: "Passed", tone: "success", icon: "ri-checkbox-circle-fill" },
  failed: { label: "Failed", tone: "danger", icon: "ri-close-circle-fill" },
  blocked: { label: "Blocked", tone: "warning", icon: "ri-error-warning-fill" },
};

/**
 * Optional guided mode for a scenario. It walks a reviewer through the real
 * steps, lets them open each related record, and records — SEPARATELY — whether
 * a page was visited, whether an action was performed, and the manual result.
 * Position is persisted, so guided mode can be exited and resumed later.
 */
export default function GuidedWalkthrough({
  scenario,
  onExit,
}: {
  scenario: ScenarioDef;
  onExit: () => void;
}) {
  const { ensure, getStep, setStepState, setCurrentStep, resetWalkthrough } = useScenarioWalkthrough();

  const firstStepId = scenario.steps[0]?.id ?? "";
  const walk = ensure(scenario.id, firstStepId);

  const currentIndex = useMemo(() => {
    const idx = scenario.steps.findIndex((s) => s.id === walk.currentStepId);
    return idx < 0 ? 0 : idx;
  }, [scenario.steps, walk.currentStepId]);
  const currentStep = scenario.steps[currentIndex] ?? scenario.steps[0];
  const currentStepId = currentStep?.id ?? "";
  const currentState = getStep(scenario.id, currentStepId);

  const [note, setNote] = useState(currentState.note);
  useEffect(() => {
    setNote(getStep(scenario.id, currentStepId).note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, currentStepId]);

  const visitedCount = scenario.steps.filter((s) => getStep(scenario.id, s.id).visited).length;
  const passedCount = scenario.steps.filter((s) => getStep(scenario.id, s.id).result === "passed").length;
  const failedCount = scenario.steps.filter((s) => getStep(scenario.id, s.id).result === "failed").length;
  const blockedCount = scenario.steps.filter((s) => getStep(scenario.id, s.id).result === "blocked").length;

  const update = (patch: Parameters<typeof setStepState>[2]) =>
    setStepState(scenario.id, currentStepId, patch, firstStepId);

  const goTo = (index: number) => {
    const step = scenario.steps[index];
    if (step) setCurrentStep(scenario.id, step.id, firstStepId);
  };

  if (!currentStep) return null;

  return (
    <Card className="border-primary-200">
      <CardHeader
        icon="ri-play-circle-line"
        iconTone="primary"
        title={`Guided walkthrough — Scenario ${scenario.id}`}
        subtitle={`Step ${currentIndex + 1} of ${scenario.steps.length} · ${scenario.title}`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone="primary" icon="ri-link">
              Guide active
            </Badge>
            <Button size="sm" variant="ghost" onClick={onExit}>
              Exit guided mode
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-4">
        {/* progress */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">
              Progress
            </span>
            <Badge tone="secondary" icon="ri-eye-line">
              {visitedCount} visited
            </Badge>
            <Badge tone="success" icon="ri-checkbox-circle-fill">
              {passedCount} passed
            </Badge>
            {failedCount > 0 ? (
              <Badge tone="danger" icon="ri-close-circle-fill">
                {failedCount} failed
              </Badge>
            ) : null}
            {blockedCount > 0 ? (
              <Badge tone="warning" icon="ri-error-warning-fill">
                {blockedCount} blocked
              </Badge>
            ) : null}
          </div>
          <ProgressBar value={visitedCount} max={scenario.steps.length} tone="primary" />
          <p className="text-[11px] text-foreground-400">
            Visiting a page ({visitedCount}) is tracked separately from a step you manually passed
            ({passedCount}). Opening a page never counts as testing its functionality.
          </p>
        </div>

        {/* current step */}
        <div className="rounded-lg border border-background-200 bg-background-50 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary-100 text-lg text-secondary-900">
              <i className={currentStep.icon}></i>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-bold text-foreground-900">
                  Step {currentIndex + 1}. {currentStep.label}
                </p>
                <Badge tone="neutral">{currentStep.module}</Badge>
                <Badge tone={RESULT_META[currentState.result].tone} icon={RESULT_META[currentState.result].icon}>
                  {RESULT_META[currentState.result].label}
                </Badge>
                {currentState.actionPerformed ? (
                  <Badge tone="accent" icon="ri-cursor-line">
                    Action performed
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1.5 text-[13px] text-foreground-600">
                <span className="font-semibold text-foreground-700">Expected behaviour: </span>
                {currentStep.detail}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {currentStep.route ? (
              <Link
                to={currentStep.route}
                onClick={() => update({ visited: true })}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 text-[12px] font-semibold text-background-50 hover:bg-primary-600"
              >
                <i className="ri-external-link-line"></i> Open related record
              </Link>
            ) : (
              <span className="text-[12px] text-foreground-400">No screen for this step</span>
            )}
            <Button
              size="sm"
              variant={currentState.actionPerformed ? "accent" : "outline"}
              leftIcon={<i className="ri-cursor-line"></i>}
              onClick={() => update({ actionPerformed: !currentState.actionPerformed })}
            >
              {currentState.actionPerformed ? "Action performed" : "Mark action performed"}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-background-200 pt-3">
            <Button
              size="sm"
              variant={currentState.result === "passed" ? "primary" : "outline"}
              leftIcon={<i className="ri-checkbox-circle-line"></i>}
              onClick={() => update({ result: currentState.result === "passed" ? "none" : "passed" })}
            >
              Mark step passed
            </Button>
            <Button
              size="sm"
              variant={currentState.result === "failed" ? "danger" : "outline"}
              leftIcon={<i className="ri-close-circle-line"></i>}
              onClick={() => update({ result: currentState.result === "failed" ? "none" : "failed" })}
            >
              Mark step failed
            </Button>
            <Button
              size="sm"
              variant={currentState.result === "blocked" ? "secondary" : "outline"}
              leftIcon={<i className="ri-error-warning-line"></i>}
              onClick={() => update({ result: currentState.result === "blocked" ? "none" : "blocked" })}
            >
              Mark blocked
            </Button>
          </div>

          <div className="mt-3">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-foreground-500">
              Issue / observation note
            </label>
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                update({ note: e.target.value });
              }}
              rows={2}
              maxLength={300}
              placeholder="Record what actually happened on this step…"
              className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
        </div>

        {/* navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              leftIcon={<i className="ri-arrow-left-line"></i>}
              disabled={currentIndex === 0}
              onClick={() => goTo(currentIndex - 1)}
            >
              Previous step
            </Button>
            <Button
              size="sm"
              variant="outline"
              rightIcon={<i className="ri-arrow-right-line"></i>}
              disabled={currentIndex >= scenario.steps.length - 1}
              onClick={() => goTo(currentIndex + 1)}
            >
              Next step
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<i className="ri-restart-line"></i>}
            onClick={() => {
              resetWalkthrough(scenario.id);
              setNote("");
            }}
          >
            Reset progress
          </Button>
        </div>

        {/* step ledger */}
        <div className="border-t border-background-200 pt-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-foreground-400">
            Step ledger
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {scenario.steps.map((step, index) => {
              const state = getStep(scenario.id, step.id);
              const meta = RESULT_META[state.result];
              const active = step.id === currentStep.id;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => goTo(index)}
                    title={`${step.label} — ${meta.label}${state.visited ? " · visited" : ""}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                      active
                        ? "border-primary-400 bg-primary-50 text-primary-700"
                        : "border-background-300 bg-background-50 text-foreground-600 hover:bg-background-100",
                    )}
                  >
                    <span className="font-bold">{index + 1}</span>
                    <i className={cn("text-[13px]", meta.icon)}></i>
                    {state.visited ? <i className="ri-eye-line text-[12px] text-foreground-400"></i> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}