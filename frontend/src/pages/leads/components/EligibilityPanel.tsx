import { useEffect, useMemo, useState } from "react";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import ProgressBar from "@/components/base/ProgressBar";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import {
  ANSWER_TONES,
  ELIGIBILITY_QUESTIONS,
  ELIGIBILITY_TONES,
  EVIDENCE_STATUSES,
  EVIDENCE_TONES,
  SCREENING_ANSWERS,
  deriveScreeningStatus,
} from "@/config/eligibility";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { EligibilityResponse, Lead, ScreeningAnswer, EvidenceStatus } from "@/store/types";
import { formatDateTime, relativeTime } from "@/utils/format";

function blankResponse(questionId: string): EligibilityResponse {
  return { questionId, answer: "Unknown", evidence: "Not Requested", notes: "" };
}

function seedResponses(lead: Lead): Record<string, EligibilityResponse> {
  const map: Record<string, EligibilityResponse> = {};
  ELIGIBILITY_QUESTIONS.forEach((q) => {
    const existing = lead.eligibility?.responses.find((r) => r.questionId === q.id);
    map[q.id] = existing ? { ...existing } : blankResponse(q.id);
  });
  return map;
}

export default function EligibilityPanel({ lead }: { lead: Lead }) {
  const { toast } = useToast();
  const { state, userName, updateEligibility, recordEligibilityDecision, createTask } = useWorkspace();
  const { can } = usePermissions();

  const [responses, setResponses] = useState<Record<string, EligibilityResponse>>(() =>
    seedResponses(lead),
  );
  const [decision, setDecision] = useState<"Verified Eligible" | "Not Eligible for Funding">(
    lead.eligibility?.decision ?? "Verified Eligible",
  );
  const [reasons, setReasons] = useState(lead.eligibility?.decisionReasons ?? "");

  useEffect(() => {
    setResponses(seedResponses(lead));
    setDecision(lead.eligibility?.decision ?? "Verified Eligible");
    setReasons(lead.eligibility?.decisionReasons ?? "");
  }, [lead.id, lead.eligibility?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => Object.values(responses), [responses]);
  const answered = list.filter((r) => r.answer !== "Unknown").length;
  const status = deriveScreeningStatus(list);
  const missingEvidence = list.filter(
    (r) => r.answer === "Yes" && (r.evidence === "Not Requested" || r.evidence === "Requested"),
  ).length;

  const patch = (questionId: string, next: Partial<EligibilityResponse>) => {
    setResponses((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...next } }));
  };

  const save = () => {
    updateEligibility({ leadId: lead.id, responses: Object.values(responses) });
    toast({ title: "Screening saved", message: "The eligibility status was recalculated.", tone: "success" });
  };

  const escalate = () => {
    // Escalation is a demonstration routing action only — it never makes a
    // funding decision. It flags the case for Enrolment review and raises a task.
    updateEligibility({ leadId: lead.id, responses: Object.values(responses), status: "Review Required" });
    const enrolmentOwner = state.users.find((u) => /enrol/i.test(u.role))?.id ?? lead.ownerId;
    createTask({
      title: `Enrolment review: ${lead.name}`,
      description: `Eligibility screening flagged for Enrolment review.${
        missingEvidence > 0 ? ` ${missingEvidence} item(s) still missing evidence.` : ""
      }`,
      ownerId: enrolmentOwner,
      priority: "High",
      dueAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      source: "Manual",
      relatedLeadId: lead.id,
      programme: lead.programme,
    });
    toast({
      title: "Escalated to Enrolment review",
      message: "Status set to Review Required and a review task was created.",
      tone: "info",
    });
  };

  const scheduleFollowUp = () => {
    createTask({
      title: `Eligibility follow-up: ${lead.name}`,
      description: "Follow up on outstanding eligibility screening information.",
      ownerId: lead.ownerId,
      priority: "Medium",
      dueAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      source: "Manual",
      relatedLeadId: lead.id,
      programme: lead.programme,
    });
    toast({ title: "Follow-up scheduled", message: "A Planner task was created.", tone: "info" });
  };

  const requestEvidence = (questionId: string, question: string, ownerId: string) => {
    patch(questionId, { evidence: "Requested" });
    createTask({
      title: `Request evidence: ${question}`,
      description: `Evidence requested for ${lead.name} during eligibility screening.`,
      ownerId,
      priority: "Medium",
      dueAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      source: "Manual",
      relatedLeadId: lead.id,
      programme: lead.programme,
    });
    toast({ title: "Evidence requested", message: "A Planner follow-up was created.", tone: "info" });
  };

  const verification = lead.eligibility?.decision ? (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={lead.eligibility.decision === "Verified Eligible" ? "success" : "danger"}>
          {lead.eligibility.decision}
        </Badge>
        <span className="text-[12px] text-foreground-600">
          Verified funding eligibility decision
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-3">
        <Field label="Decision-maker" value={userName(lead.eligibility.decisionMakerId)} />
        <Field
          label="Verification date"
          value={lead.eligibility.verificationDate ? formatDateTime(lead.eligibility.verificationDate) : "Not recorded"}
        />
        <Field label="Reasons" value={lead.eligibility.decisionReasons || "Not recorded"} />
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon="ri-shield-check-line"
          iconTone="secondary"
          title="Funding eligibility"
          subtitle="Initial screening — configurable, not an authoritative funding decision"
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={ELIGIBILITY_TONES[status]}>{status}</Badge>
            <span className="text-[12px] text-foreground-500">
              Updated {lead.eligibility ? relativeTime(lead.eligibility.updatedAt) : "never"}
            </span>
            {missingEvidence > 0 ? (
              <Badge tone="warning" icon="ri-error-warning-line">
                {missingEvidence} item{missingEvidence > 1 ? "s" : ""} missing evidence
              </Badge>
            ) : null}
            {status === "Review Required" ? (
              <Badge tone="accent" icon="ri-shield-check-line">
                Queued for Enrolment review
              </Badge>
            ) : null}
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12px] text-foreground-500">
              <span>Screening progress</span>
              <span className="font-semibold text-foreground-700">
                {answered} / {ELIGIBILITY_QUESTIONS.length} answered
              </span>
            </div>
            <ProgressBar value={answered} max={ELIGIBILITY_QUESTIONS.length} tone="primary" />
          </div>
          <div className="rounded-md bg-background-100 px-3 py-2 text-[11px] leading-snug text-foreground-500">
            Residency and immigration cases may have exceptions and require specialist review. No visa
            category is automatically eligible or ineligible, and nobody is automatically rejected for
            working fewer than 30 hours.
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon="ri-list-check-2"
          title="Initial screening checklist"
          subtitle={`${ELIGIBILITY_QUESTIONS.length} screening questions`}
          action={
            <PermissionGate capability="eligibility.screen">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<i className="ri-calendar-check-line"></i>}
                  onClick={scheduleFollowUp}
                >
                  Schedule follow-up
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<i className="ri-shield-star-line"></i>}
                  disabled={status === "Review Required"}
                  onClick={escalate}
                >
                  Escalate to Enrolment review
                </Button>
                <Button size="sm" leftIcon={<i className="ri-save-line"></i>} onClick={save}>
                  Save screening
                </Button>
              </div>
            </PermissionGate>
          }
        />
        <ul className="divide-y divide-background-200">
          {ELIGIBILITY_QUESTIONS.map((q) => {
            const r = responses[q.id];
            return (
              <li key={q.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 max-w-2xl">
                    <p className="text-[13px] font-semibold text-foreground-900">
                      {q.order}. {q.question}
                    </p>
                    <p className="mt-0.5 text-[12px] text-foreground-500">{q.help}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={ANSWER_TONES[r.answer]} dot>
                      {r.answer}
                    </Badge>
                    <Badge tone={EVIDENCE_TONES[r.evidence]}>{r.evidence}</Badge>
                  </div>
                </div>
                <PermissionGate
                  capability="eligibility.screen"
                  fallback={<p className="mt-2 text-[12px] text-foreground-400">Your demo role cannot edit screening.</p>}
                >
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Select
                      size="sm"
                      label="Answer"
                      value={r.answer}
                      onChange={(v) => patch(q.id, { answer: v as ScreeningAnswer })}
                      options={SCREENING_ANSWERS.map((a) => ({ value: a, label: a }))}
                    />
                    <Select
                      size="sm"
                      label="Evidence"
                      value={r.evidence}
                      onChange={(v) => patch(q.id, { evidence: v as EvidenceStatus })}
                      options={EVIDENCE_STATUSES.map((e) => ({ value: e, label: e }))}
                    />
                    {q.kind === "hours" ? (
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                          Weekly hours
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={r.weeklyHours ?? ""}
                          onChange={(e) =>
                            patch(q.id, {
                              weeklyHours: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                          className="h-8 w-full rounded-md border border-background-300 bg-background-50 px-3 text-[13px] text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                        />
                      </div>
                    ) : (
                      <div className="hidden lg:block" />
                    )}
                    <div className="sm:col-span-2 lg:col-span-1">
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                        Staff notes
                      </label>
                      <input
                        value={r.notes}
                        onChange={(e) => patch(q.id, { notes: e.target.value.slice(0, 240) })}
                        placeholder="Optional note…"
                        className="h-8 w-full rounded-md border border-background-300 bg-background-50 px-3 text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                      />
                    </div>
                  </div>
                  {r.evidence !== "Verified" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-foreground-400">
                        {r.checkedById ? `Checked by ${userName(r.checkedById)} · ${formatDateTime(r.checkedAt ?? "")}` : "Not yet checked"}
                      </span>
                      <Button
                        size="xs"
                        variant="ghost"
                        leftIcon={<i className="ri-attachment-line"></i>}
                        onClick={() => requestEvidence(q.id, q.question, lead.ownerId)}
                      >
                        Request evidence &amp; follow-up
                      </Button>
                    </div>
                  ) : null}
                </PermissionGate>
              </li>
            );
          })}
        </ul>
      </Card>

      {verification ? <Card><CardBody>{verification}</CardBody></Card> : null}

      <Card>
        <CardHeader
          icon="ri-verified-badge-line"
          iconTone="accent"
          title="Verified funding eligibility decision"
          subtitle="Only authorised Enrolment staff or Admin may record this"
        />
        <CardBody className="space-y-3">
          <PermissionGate
            capability="eligibility.verify"
            fallback={
              <p className="rounded-md bg-background-100 px-3 py-2 text-[12px] text-foreground-500">
                Your demo role can screen a lead, but recording a verified funding decision is restricted
                to authorised Enrolment staff or Admin.
              </p>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Decision"
                value={decision}
                onChange={(v) => setDecision(v as "Verified Eligible" | "Not Eligible for Funding")}
                options={[
                  { value: "Verified Eligible", label: "Verified Eligible" },
                  { value: "Not Eligible for Funding", label: "Not Eligible for Funding" },
                ]}
              />
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                  Reasons for the decision
                </label>
                <input
                  value={reasons}
                  onChange={(e) => setReasons(e.target.value.slice(0, 300))}
                  placeholder="Required — why this decision was reached"
                  className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                leftIcon={<i className="ri-verified-badge-line"></i>}
                disabled={!reasons.trim()}
                onClick={() => {
                  const ok = recordEligibilityDecision(lead.id, decision, reasons.trim());
                  if (ok) {
                    toast({ title: "Verified decision recorded", tone: "success" });
                  } else {
                    toast({ title: "Not permitted", message: "Your role cannot verify eligibility.", tone: "error" });
                  }
                }}
              >
                Record verified decision
              </Button>
            </div>
          </PermissionGate>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-foreground-800">{value}</p>
    </div>
  );
}