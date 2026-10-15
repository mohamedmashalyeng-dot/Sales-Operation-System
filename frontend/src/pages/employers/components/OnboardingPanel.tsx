import LoadingState from "@/components/base/LoadingState";
import { useEffect, useMemo, useState } from "react";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import { APPRENTICESHIP_SERVICE_URL, EMPLOYER_AGREEMENT_URL, KBC_UKPRN } from "@/config/eligibility";
import {
  AGREEMENT_TONES,
  DAS_CHECKLIST,
  DAS_STATUSES,
  DAS_TONES,
  EMPLOYER_AGREEMENT_STATUSES,
} from "@/config/employer";
import { usePermissions } from "@/hooks/usePermissions";
import { useBusinessData } from "@/hooks/useBusinessData";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { EmployerAgreementStatus, DasStatus } from "@/store/types";
import { formatDate, relativeTime } from "@/utils/format";

interface OnboardingPanelProps {
  employerName: string;
  employerContact?: string;
  leadId?: string;
  applicationId?: string;
  dataLoaded?: boolean;
}

export default function OnboardingPanel({
  employerName,
  employerContact = "",
  leadId,
  applicationId,
  dataLoaded = false,
}: OnboardingPanelProps) {
  const { toast } = useToast();
  const {
    state,
    currentUserId,
    createEmployerAgreement,
    updateEmployerAgreement,
    createDasRecord,
    updateDas,
  } = useWorkspace();
  const { can } = usePermissions();
  const canManage = can("employer.manage");
  const { loading, error, reload } = useBusinessData(!dataLoaded);
  const [saving, setSaving] = useState(false);
  const persist = async (work: () => Promise<unknown>, title: string) => {
    setSaving(true);
    try { await work(); toast({ title, tone: "success" }); }
    catch (reason) { toast({ title: "Save failed", message: reason instanceof Error ? reason.message : "Please try again.", tone: "error" }); }
    finally { setSaving(false); }
  };

  const agreement = useMemo(
    () =>
      state.employerAgreements.find(
        (a) =>
          (leadId && a.leadId === leadId) ||
          (applicationId && a.applicationId === applicationId) ||
          a.employerName.toLowerCase() === employerName.toLowerCase(),
      ),
    [state.employerAgreements, leadId, applicationId, employerName],
  );
  const das = useMemo(
    () =>
      state.dasRecords.find(
        (d) =>
          (leadId && d.leadId === leadId) ||
          (applicationId && d.applicationId === applicationId) ||
          d.employerName.toLowerCase() === employerName.toLowerCase(),
      ),
    [state.dasRecords, leadId, applicationId, employerName],
  );

  const [agStatus, setAgStatus] = useState<EmployerAgreementStatus>("Not Sent");
  const [agNotes, setAgNotes] = useState("");
  const [agFollowUp, setAgFollowUp] = useState("");
  const [dasStatus, setDasStatus] = useState<DasStatus>("Not Started");
  const [dasFlags, setDasFlags] = useState<Record<string, boolean>>({});
  const [dasStaff, setDasStaff] = useState(currentUserId);
  const [dasFollowUp, setDasFollowUp] = useState("");
  const [dasNotes, setDasNotes] = useState("");

  useEffect(() => {
    setAgStatus(agreement?.status ?? "Not Sent");
    setAgNotes(agreement?.notes ?? "");
    setAgFollowUp(agreement?.followUpDueAt ? agreement.followUpDueAt.slice(0, 10) : "");
  }, [agreement?.id, agreement?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!das) return;
    setDasStatus(das.status);
    setDasFlags({
      "das-account": das.accountExists ?? das.providerAdditionConfirmed,
      "das-help": das.accountSetupHelpNeeded,
      "das-ukprn": das.ukprnShared,
      "das-requested": das.providerAdditionRequested,
      "das-confirmed": das.providerAdditionConfirmed,
      "das-funding": das.fundingActionsReviewed,
    });
    setDasStaff(das.responsibleStaffId);
    setDasFollowUp(das.followUpAt ? das.followUpAt.slice(0, 10) : "");
    setDasNotes(das.notes);
  }, [das?.id, das?.lastUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAgreement = () => {
    if (!canManage) return;
    void persist(() => createEmployerAgreement({
      employerName,
      employerContact,
      status: "Not Sent",
      notes: "",
      leadId,
      applicationId,
    }), "Employer agreement opened");
  };

  const saveAgreement = () => {
    if (!agreement) return;
    void persist(() => updateEmployerAgreement(agreement.id, {
      status: agStatus,
      notes: agNotes.slice(0, 500),
      followUpDueAt: agFollowUp ? new Date(agFollowUp).toISOString() : "",
      verifiedById: currentUserId,
    }), "Agreement updated");
  };

  const openDas = () => {
    if (!canManage) return;
    void persist(() => createDasRecord({
      employerName,
      status: "Employer Account Required",
      accountSetupHelpNeeded: true,
      ukprnShared: false,
      providerAdditionRequested: false,
      providerAdditionConfirmed: false,
      fundingActionsReviewed: false,
      responsibleStaffId: currentUserId,
      notes: "",
      leadId,
      applicationId,
    }), "Apprenticeship Service tracking started");
  };

  const saveDas = () => {
    if (!das) return;
    void persist(() => updateDas(das.id, {
      status: dasStatus,
      accountExists: Boolean(dasFlags["das-account"]),
      accountSetupHelpNeeded: Boolean(dasFlags["das-help"]),
      ukprnShared: Boolean(dasFlags["das-ukprn"]),
      providerAdditionRequested: Boolean(dasFlags["das-requested"]),
      providerAdditionConfirmed: Boolean(dasFlags["das-confirmed"]),
      fundingActionsReviewed: Boolean(dasFlags["das-funding"]),
      responsibleStaffId: dasStaff,
      followUpAt: dasFollowUp ? new Date(dasFollowUp).toISOString() : "",
      notes: dasNotes.slice(0, 500),
    }), "Apprenticeship Service status updated");
  };

  if (loading) return <Card><CardBody><LoadingState>Loading employer onboarding...</LoadingState></CardBody></Card>;
  if (error) return <Card><CardBody><p role="alert">{error}</p><Button onClick={() => void reload()}>Try again</Button></CardBody></Card>;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon="ri-file-paper-2-line"
          iconTone="accent"
          title="Kent Business College employer agreement"
          subtitle="Tracked separately from other legal and training agreements"
          action={
            <a
              href={EMPLOYER_AGREEMENT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-primary-600 hover:text-primary-700"
            >
              <i className="ri-external-link-line"></i> View agreement reference
            </a>
          }
        />
        <CardBody className="space-y-4">
          {!agreement ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-background-300 bg-background-50 p-4">
              <p className="text-[13px] text-foreground-600">
                No employer agreement is being tracked for {employerName}.
              </p>
              <PermissionGate capability="employer.manage">
                <Button size="sm" disabled={saving} leftIcon={<i className="ri-add-line"></i>} onClick={openAgreement}>
                  Open agreement
                </Button>
              </PermissionGate>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={AGREEMENT_TONES[agreement.status]} dot>
                  {agreement.status}
                </Badge>
                <span className="text-[12px] text-foreground-500">
                  {agreement.dateSent ? `Sent ${formatDate(agreement.dateSent)}` : "Not sent"}
                  {agreement.dateSigned ? ` · Signed ${formatDate(agreement.dateSigned)}` : ""}
                  {agreement.followUpDueAt ? ` · Follow-up ${relativeTime(agreement.followUpDueAt)}` : ""}
                </span>
              </div>
              <PermissionGate
                capability="employer.manage"
                fallback={<p className="text-[12px] text-foreground-500">{agreement.notes || "No notes."}</p>}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Select
                    label="Agreement status"
                    value={agStatus}
                    onChange={(v) => setAgStatus(v as EmployerAgreementStatus)}
                    options={EMPLOYER_AGREEMENT_STATUSES.map((s) => ({ value: s, label: s }))}
                  />
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                      Follow-up due
                    </label>
                    <input
                      type="date"
                      value={agFollowUp}
                      onChange={(e) => setAgFollowUp(e.target.value)}
                      className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                    />
                  </div>
                  {agreement.verifiedById ? (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Verified by</p>
                      <p className="mt-1 text-[13px] font-medium text-foreground-800">
                        {state.users.find((u) => u.id === agreement.verifiedById)?.name ?? "—"}
                      </p>
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                    Notes
                  </label>
                  <textarea
                    value={agNotes}
                    onChange={(e) => setAgNotes(e.target.value.slice(0, 500))}
                    rows={2}
                    className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" loading={saving} disabled={saving} leftIcon={<i className="ri-save-line"></i>} onClick={saveAgreement}>
                    Save agreement
                  </Button>
                </div>
              </PermissionGate>
              <p className="rounded-md bg-background-100 px-3 py-2 text-[11px] text-foreground-500">
                Demonstration only — no real electronic signature is received or verified.
              </p>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon="ri-government-line"
          title="Apprenticeship Service / DAS tracking"
          subtitle={`Kent Business College UKPRN ${KBC_UKPRN}`}
          action={
            <a
              href={APPRENTICESHIP_SERVICE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-primary-600 hover:text-primary-700"
            >
              <i className="ri-external-link-line"></i> Apprenticeship Service
            </a>
          }
        />
        <CardBody className="space-y-4">
          {!das ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-background-300 bg-background-50 p-4">
              <p className="text-[13px] text-foreground-600">
                Apprenticeship Service readiness is not being tracked for {employerName} yet.
              </p>
              <PermissionGate capability="employer.manage">
                <Button size="sm" disabled={saving} leftIcon={<i className="ri-add-line"></i>} onClick={openDas}>
                  Start DAS tracking
                </Button>
              </PermissionGate>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={DAS_TONES[das.status]} dot>
                  {das.status}
                </Badge>
                <span className="text-[12px] text-foreground-500">
                  Updated {relativeTime(das.lastUpdatedAt)}
                </span>
              </div>
              <PermissionGate
                capability="employer.manage"
                fallback={
                  <ul className="space-y-1.5">
                    {DAS_CHECKLIST.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 text-[12.5px] text-foreground-700">
                        <i
                          className={
                            {
                              "das-account": das.accountExists ?? das.providerAdditionConfirmed,
                              "das-help": das.accountSetupHelpNeeded,
                              "das-ukprn": das.ukprnShared,
                              "das-requested": das.providerAdditionRequested,
                              "das-confirmed": das.providerAdditionConfirmed,
                              "das-funding": das.fundingActionsReviewed,
                            }[item.id]
                              ? "ri-checkbox-circle-fill text-green-500"
                              : "ri-checkbox-blank-circle-line text-foreground-400"
                          }
                        ></i>
                        {item.label}
                      </li>
                    ))}
                  </ul>
                }
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select
                    label="DAS status"
                    value={dasStatus}
                    onChange={(v) => setDasStatus(v as DasStatus)}
                    options={DAS_STATUSES.map((s) => ({ value: s, label: s }))}
                  />
                  <Select
                    label="Responsible staff"
                    value={dasStaff}
                    onChange={setDasStaff}
                    options={state.users.map((u) => ({ value: u.id, label: u.name }))}
                  />
                </div>
                <div className="space-y-2">
                  {DAS_CHECKLIST.map((item) => (
                    <label key={item.id} className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={Boolean(dasFlags[item.id])}
                        onChange={(e) => setDasFlags((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                        className="mt-0.5 h-4 w-4 cursor-pointer accent-primary-500"
                      />
                      <span>
                        <span className="block text-[13px] font-medium text-foreground-800">{item.label}</span>
                        <span className="block text-[11px] text-foreground-500">{item.help}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                      Follow-up date
                    </label>
                    <input
                      type="date"
                      value={dasFollowUp}
                      onChange={(e) => setDasFollowUp(e.target.value)}
                      className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                      Notes
                    </label>
                    <input
                      value={dasNotes}
                      onChange={(e) => setDasNotes(e.target.value.slice(0, 300))}
                      className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-[13px] text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" loading={saving} disabled={saving} leftIcon={<i className="ri-save-line"></i>} onClick={saveDas}>
                    Save DAS status
                  </Button>
                </div>
              </PermissionGate>
              <p className="rounded-md bg-background-100 px-3 py-2 text-[11px] text-foreground-500">
                Record progress confirmed by your team. Use the reference link to complete the
                employer's Apprenticeship Service account actions.
              </p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
