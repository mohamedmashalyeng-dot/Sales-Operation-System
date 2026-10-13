import Badge from "@/components/base/Badge";
import type { BadgeTone } from "@/components/base/Badge";
import type { ScenarioCheck, CheckStatus } from "@/utils/scenarios";

const STATUS_META: Record<CheckStatus, { tone: BadgeTone; icon: string; label: string; row: string }> = {
  passed: { tone: "success", icon: "ri-checkbox-circle-fill", label: "Passed automated check", row: "border-green-100 bg-green-50/50" },
  failed: { tone: "danger", icon: "ri-close-circle-fill", label: "Failed automated check", row: "border-red-100 bg-red-50/50" },
  "not-tested": { tone: "neutral", icon: "ri-question-line", label: "Not yet manually tested", row: "border-background-200 bg-background-50" },
};

export default function ValidationChecklist({ checks }: { checks: ScenarioCheck[] }) {
  const passed = checks.filter((c) => c.status === "passed").length;
  const failed = checks.filter((c) => c.status === "failed").length;
  const notTested = checks.filter((c) => c.status === "not-tested").length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="success" icon="ri-checkbox-circle-fill">
          {passed} passed
        </Badge>
        <Badge tone={failed > 0 ? "danger" : "neutral"} icon="ri-close-circle-fill">
          {failed} failed
        </Badge>
        <Badge tone="neutral" icon="ri-question-line">
          {notTested} not tested
        </Badge>
      </div>

      <ul className="space-y-1.5">
        {checks.map((check) => {
          const meta = STATUS_META[check.status];
          return (
            <li
              key={check.id}
              className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${meta.row}`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 items-center justify-center text-base ${
                  check.status === "passed"
                    ? "text-green-600"
                    : check.status === "failed"
                      ? "text-red-600"
                      : "text-foreground-400"
                }`}
              >
                <i className={meta.icon}></i>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground-800">{check.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">
                  <span className="font-semibold">{meta.label}</span> · {check.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-snug text-foreground-400">
        Automated checks are evaluated against the shared dataset each time this view opens. Manual
        checks require a real browser walkthrough and are never reported as complete on the strength of a
        successful build alone.
      </p>
    </div>
  );
}