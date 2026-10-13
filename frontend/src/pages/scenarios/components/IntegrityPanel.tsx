import Badge from "@/components/base/Badge";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { Link } from "react-router-dom";
import { runIntegrityChecks, type IntegrityCheck } from "@/utils/integrity";
import type { WorkspaceState } from "@/store/types";
import { cn } from "@/utils/format";

const STATUS_META: Record<IntegrityCheck["status"], { tone: "success" | "danger" | "warning"; icon: string; row: string }> = {
  passed: { tone: "success", icon: "ri-checkbox-circle-fill", row: "border-background-200 bg-background-50" },
  failed: { tone: "danger", icon: "ri-close-circle-fill", row: "border-red-100 bg-red-50/60" },
  warning: { tone: "warning", icon: "ri-error-warning-fill", row: "border-amber-100 bg-amber-50/60" },
};

/**
 * Automated milestone & relationship integrity report. Failed checks come first
 * (an authoritative record contradicts a linked record), then warnings (a
 * milestone is implied but not backed by an explicit record), then passes. It
 * reports inconsistencies honestly rather than inventing a successful outcome.
 */
export default function IntegrityPanel({ state }: { state: WorkspaceState }) {
  const report = runIntegrityChecks(state);
  const ordered = [...report.checks].sort((a, b) => {
    const rank = { failed: 0, warning: 1, passed: 2 };
    return rank[a.status] - rank[b.status];
  });

  return (
    <Card>
      <CardHeader
        icon="ri-shield-check-line"
        iconTone="primary"
        title="Milestone & relationship integrity"
        subtitle="Automated checks against the live dataset — inconsistencies are reported, never hidden"
        action={
          <div className="flex items-center gap-2">
            <Badge tone={report.failed > 0 ? "danger" : "success"} icon="ri-close-circle-fill">
              {report.failed} failed
            </Badge>
            <Badge tone="warning" icon="ri-error-warning-fill">
              {report.warnings} warnings
            </Badge>
            <Badge tone="success" icon="ri-checkbox-circle-fill">
              {report.passed} passed
            </Badge>
          </div>
        }
      />
      <CardBody>
        <ul className="space-y-1.5">
          {ordered.map((check) => {
            const meta = STATUS_META[check.status];
            return (
              <li key={check.id} className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2", meta.row)}>
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 items-center justify-center text-base",
                    check.status === "passed"
                      ? "text-green-600"
                      : check.status === "failed"
                        ? "text-red-600"
                        : "text-amber-600",
                  )}
                >
                  <i className={meta.icon}></i>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground-800">{check.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">{check.detail}</p>
                </div>
                {check.leadId ? (
                  <Link
                    to={`/leads/${check.leadId}`}
                    className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-background-300 px-2.5 text-[11px] font-semibold text-foreground-600 hover:bg-background-100"
                  >
                    Open lead
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[11px] leading-snug text-foreground-400">
          Employer agreement, DAS, application, enrolment and apprenticeship start are always kept as
          distinct outcomes. A campaign invitation never rewrites an original source, and Future Intake is
          never treated as Closed Lost.
        </p>
      </CardBody>
    </Card>
  );
}