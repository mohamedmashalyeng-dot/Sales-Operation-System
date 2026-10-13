import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { AGREEMENT_TONES, DAS_TONES } from "@/config/employer";
import OnboardingPanel from "@/pages/employers/components/OnboardingPanel";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { formatDate } from "@/utils/format";

export default function EmployerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state, userName } = useWorkspace();
  const name = decodeURIComponent(id);

  const agreement = state.employerAgreements.find((a) => a.employerName === name);
  const das = state.dasRecords.find((d) => d.employerName === name);

  const relatedLeadIds = useMemo(() => {
    const ids = new Set<string>();
    if (agreement?.leadId) ids.add(agreement.leadId);
    if (das?.leadId) ids.add(das.leadId);
    state.leads.filter((l) => l.name === name).forEach((l) => ids.add(l.id));
    return ids;
  }, [agreement, das, state.leads, name]);

  const relatedLeads = state.leads.filter((l) => relatedLeadIds.has(l.id));
  const relatedApps = state.applications.filter((a) => a.leadId && relatedLeadIds.has(a.leadId));
  const activity = state.activity
    .filter((a) => relatedLeadIds.has(a.entityId) || a.target.includes(name))
    .slice(0, 8);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-foreground-400">
        <button type="button" onClick={() => navigate("/employers")} className="inline-flex cursor-pointer items-center gap-1 font-semibold text-foreground-600 hover:text-primary-600">
          <i className="ri-arrow-left-line"></i> Employers
        </button>
      </div>

      <Card>
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-100 text-2xl text-primary-700">
              <i className="ri-building-2-line"></i>
            </span>
            <div>
              <h1 className="font-heading text-2xl font-extrabold text-foreground-950">{name}</h1>
              <p className="mt-1 text-[13px] text-foreground-500">
                {agreement?.employerContact ?? relatedLeads[0]?.contactName ?? "No primary contact recorded"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={AGREEMENT_TONES[(agreement?.status ?? "Not Sent") as keyof typeof AGREEMENT_TONES] ?? "neutral"}>
                  Agreement: {agreement?.status ?? "Not Sent"}
                </Badge>
                <Badge tone={DAS_TONES[(das?.status ?? "Not Started") as keyof typeof DAS_TONES] ?? "neutral"}>
                  DAS: {das?.status ?? "Not Started"}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_20rem]">
        <OnboardingPanel
          employerName={name}
          employerContact={agreement?.employerContact ?? relatedLeads[0]?.contactName ?? ""}
          leadId={agreement?.leadId ?? das?.leadId ?? relatedLeads[0]?.id}
          applicationId={agreement?.applicationId}
        />

        <div className="space-y-5">
          <Card>
            <CardHeader icon="ri-links-line" iconTone="secondary" title="Related records" />
            <CardBody className="space-y-3">
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground-400">Leads</p>
                {relatedLeads.length === 0 ? (
                  <p className="text-[12px] text-foreground-500">No linked leads.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {relatedLeads.map((l) => (
                      <li key={l.id}>
                        <button type="button" onClick={() => navigate(`/leads/${l.id}`)} className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-background-200 bg-background-50 px-3 py-2 text-left text-[12.5px] text-foreground-700 hover:border-primary-300">
                          <i className="ri-contacts-book-2-line text-foreground-500"></i>
                          <span className="min-w-0 flex-1 truncate">{l.name}</span>
                          <span className="text-foreground-400">{l.stage}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground-400">Applications</p>
                {relatedApps.length === 0 ? (
                  <p className="text-[12px] text-foreground-500">No linked applications.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {relatedApps.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => navigate(`/applications/${a.id}`)} className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-background-200 bg-background-50 px-3 py-2 text-left text-[12.5px] text-foreground-700 hover:border-primary-300">
                          <i className="ri-file-list-3-line text-foreground-500"></i>
                          <span className="min-w-0 flex-1 truncate">{a.applicantName}</span>
                          <span className="text-foreground-400">{a.status}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon="ri-history-line" title="Recent activity" />
            <CardBody>
              {activity.length === 0 ? (
                <p className="text-[12px] text-foreground-500">No recorded activity yet.</p>
              ) : (
                <ul className="space-y-3">
                  {activity.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background-100 text-base text-foreground-600">
                        <i className={entry.icon}></i>
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] text-foreground-700">
                          <span className="font-semibold">{userName(entry.actorId)}</span> {entry.action} {entry.target}
                        </p>
                        <p className="text-[11px] text-foreground-400">{formatDate(entry.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Button variant="outline" fullWidth leftIcon={<i className="ri-file-paper-2-line"></i>} onClick={() => navigate("/employers")}>
            Back to employers
          </Button>
        </div>
      </div>
    </div>
  );
}