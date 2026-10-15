import LoadingState from "@/components/base/LoadingState";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import Input from "@/components/base/Input";
import Modal from "@/components/base/Modal";
import { useToast } from "@/components/base/Toast";
import { useBusinessData } from "@/hooks/useBusinessData";
import { usePermissions } from "@/hooks/usePermissions";
import { loadBackendEmployerApplications, saveBusinessRecord } from "@/store/backendSync";
import type { Application } from "@/store/types";
import { AGREEMENT_TONES, DAS_TONES } from "@/config/employer";
import OnboardingPanel from "@/pages/employers/components/OnboardingPanel";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { formatDate } from "@/utils/format";

export default function EmployerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state, userName } = useWorkspace();
  const { data, loading, error, reload } = useBusinessData(true, id);
  const { can } = usePermissions();
  const { toast } = useToast();
  const [editingContact, setEditingContact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contact, setContact] = useState({ contactName: "", email: "", phone: "" });
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const employer = data?.employers.find(row => normalize(row.name) === normalize(id));
  const name = employer?.name || id;
  const [relatedApps, setRelatedApps] = useState<Application[]>([]);
  const [appsState, setAppsState] = useState("loading");
  useEffect(() => {
    if (!employer?.name) return;
    const controller = new AbortController();
    setRelatedApps([]); setAppsState("loading");
    void loadBackendEmployerApplications(employer.name, state.users, controller.signal).then(apps => {
      if (!controller.signal.aborted) { setRelatedApps(apps); setAppsState("ready"); }
    }).catch(() => { if (!controller.signal.aborted) setAppsState("error"); });
    return () => controller.abort();
  }, [employer?.name, state.users]);

  const agreement = state.employerAgreements.find((a) => normalize(a.employerName) === normalize(name));
  const das = state.dasRecords.find((d) => normalize(d.employerName) === normalize(name));

  const relatedLeadIds = useMemo(() => {
    const ids = new Set<string>(employer?.leadIds || []);
    if (agreement?.leadId) ids.add(agreement.leadId);
    if (das?.leadId) ids.add(das.leadId);
    state.leads.filter((l) => normalize(l.employer || "") === normalize(name)).forEach((l) => ids.add(l.id));
    return ids;
  }, [agreement, das, state.leads, name, employer]);

  const relatedLeads = state.leads.filter((l) => relatedLeadIds.has(l.id));
  const activity = state.activity
    .filter((a) => relatedLeadIds.has(a.entityId) || a.target.includes(name))
    .slice(0, 8);

  if (loading || error || !employer) return <div className="mx-auto max-w-[1200px] p-6"><Card><CardBody>
    {loading ? <LoadingState>Loading employer...</LoadingState> : error ? <><p role="alert">{error}</p><Button onClick={() => void reload()}>Try again</Button></>
      : <EmptyState icon="ri-building-2-line" title="Employer not found" message="This employer is unavailable or you do not have access to it." action={<Button onClick={() => navigate('/employers')}>Back to employers</Button>} />}
  </CardBody></Card></div>;

  const saveContact = async () => {
    setSaving(true);
    try {
      await saveBusinessRecord("employers", { name, ...contact }, employer.id);
      setEditingContact(false); await reload(); toast({ title: "Employer contact saved", tone: "success" });
    } catch (reason) { toast({ title: "Could not save contact", message: reason instanceof Error ? reason.message : "Please try again.", tone: "error" }); }
    finally { setSaving(false); }
  };

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
                {employer.contactName || agreement?.employerContact || "No primary contact recorded"}
              </p>
              {employer.email ? <a className="mt-1 block text-sm text-primary-700" href={`mailto:${employer.email}`}>{employer.email}</a> : null}
              {employer.phone ? <p className="text-sm text-foreground-500">{employer.phone}</p> : null}
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

      {can("employer.manage") ? <Button size="sm" variant="outline" onClick={() => { setContact({ contactName: employer.contactName, email: employer.email, phone: employer.phone }); setEditingContact(true); }}>Edit contact</Button> : null}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_20rem]">
        <OnboardingPanel
          dataLoaded
          employerName={name}
          employerContact={employer.contactName || agreement?.employerContact || ""}
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
                {appsState === "loading" ? <LoadingState className="text-[12px] text-foreground-500">Loading linked applications...</LoadingState>
                  : appsState === "error" ? <p role="alert" className="text-[12px] text-red-700">Applications could not be loaded. Reopen this employer to try again.</p>
                    : relatedApps.length === 0 ? (
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
      <Modal open={editingContact} onClose={() => { if (!saving) setEditingContact(false); }} title="Edit employer contact" footer={<><Button variant="outline" disabled={saving} onClick={() => setEditingContact(false)}>Cancel</Button><Button loading={saving} disabled={saving} onClick={() => void saveContact()}>{saving ? "Saving..." : "Save contact"}</Button></>}>
        <div className="space-y-4">
          <Input id="contact-name" label="Primary contact" value={contact.contactName} onChange={event => setContact({ ...contact, contactName: event.target.value })} />
          <Input id="contact-email" label="Contact email" type="email" value={contact.email} onChange={event => setContact({ ...contact, email: event.target.value })} />
          <Input id="contact-phone" label="Contact phone" type="tel" value={contact.phone} onChange={event => setContact({ ...contact, phone: event.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
