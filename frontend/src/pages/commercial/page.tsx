import LoadingState from "@/components/base/LoadingState";
import { useState } from "react";
import Button from "@/components/base/Button";
import BusinessLeadPlanning from "@/components/feature/BusinessLeadPlanning";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import Input from "@/components/base/Input";
import MetricCard from "@/components/base/MetricCard";
import Modal from "@/components/base/Modal";
import PaginationFooter from "@/components/base/PaginationFooter";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import Tabs from "@/components/base/Tabs";
import { useToast } from "@/components/base/Toast";
import { BUDGET_STATUSES, QUOTE_STATUSES, COMMERCIAL_STAGES, OPEN_COMMERCIAL_STAGES } from "@/config/commercial";
import { useBusinessData } from "@/hooks/useBusinessData";
import { usePermissions } from "@/hooks/usePermissions";
import CommercialBoard from "@/pages/commercial/components/CommercialBoard";
import CommercialTable from "@/pages/commercial/components/CommercialTable";
import CommercialReferralModal from "@/pages/leads/components/CommercialReferralModal";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { CommercialOpportunity, CommercialStage, Lead } from "@/store/types";

export default function CommercialPage() {
  const { loading, error, reload } = useBusinessData(true, undefined, { section: 'commercial' });
  const { state, updateCommercial } = useWorkspace();
  const { can, canAny } = usePermissions();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [owner, setOwner] = useState("all");
  const [view, setView] = useState("list");
  const [page, setPage] = useState(1);
  const [chooseLead, setChooseLead] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editing, setEditing] = useState<CommercialOpportunity | null>(null);
  const [saving, setSaving] = useState(false);
  const opportunities = state.commercialOpportunities;
  const leads = new Map(state.leads.map(lead => [lead.id, lead]));
  const filtered = opportunities.map(opp => ({ opp, lead: leads.get(opp.leadId) })).filter(({ opp, lead }) =>
    (stage === "all" || opp.stage === stage) && (owner === "all" || opp.commercialOwnerId === owner)
    && `${lead?.name || opp.leadId} ${opp.suggestedProgramme} ${opp.referralReason}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pageCount);
  const update = async (record: CommercialOpportunity, patch: Partial<CommercialOpportunity>) => {
    setSaving(true);
    try { await updateCommercial(record.id, patch); toast({ title: "Commercial opportunity saved", tone: "success" }); setEditing(null); }
    catch (reason) { toast({ title: "Update failed", message: reason instanceof Error ? reason.message : "Please try again.", tone: "error" }); }
    finally { setSaving(false); }
  };
  const availableLeads = state.leads.filter(lead => !opportunities.some(opp => opp.leadId === lead.id)
    && `${lead.name} ${lead.email}`.toLowerCase().includes(leadSearch.trim().toLowerCase()));
  return <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div>
      <h1 className="font-heading text-2xl font-extrabold text-foreground-950">Commercial</h1>
      <p className="mt-1 text-sm text-foreground-500">Manage commercial referrals, proposals and privately funded opportunities.</p>
    </div>{canAny(["commercial.refer", "commercial.manage"]) ? <Button disabled={loading || Boolean(error)} onClick={() => setChooseLead(true)} leftIcon={<i className="ri-add-line" />}>New referral</Button> : null}</div>
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <MetricCard label="Opportunities" value={opportunities.length} icon="ri-briefcase-4-line" />
      <MetricCard label="Open pipeline" value={opportunities.filter(opp => OPEN_COMMERCIAL_STAGES.includes(opp.stage)).length} icon="ri-flow-chart" tone="secondary" />
      <MetricCard label="Closed won" value={opportunities.filter(opp => opp.stage === "Closed Won").length} icon="ri-checkbox-circle-line" tone="success" />
      <MetricCard label="Overdue follow-ups" value={opportunities.filter(opp => OPEN_COMMERCIAL_STAGES.includes(opp.stage) && Date.parse(opp.nextFollowUpAt) < Date.now()).length} icon="ri-alarm-warning-line" tone="danger" />
    </div>
    <BusinessLeadPlanning section="commercial" />
    <Card><CardHeader title="Commercial pipeline" icon="ri-briefcase-4-line" action={<Button size="sm" variant="outline" loading={loading} disabled={loading} onClick={() => void reload()}>Refresh</Button>} />
      <CardBody className="space-y-4"><p className="text-sm text-foreground-500">These opportunities come from recorded commercial referrals. AI suggestions stay in Needs review until you choose a destination. A referral does not confirm a purchase, budget or funding eligibility.</p><div className="grid gap-3 md:grid-cols-3">
        <SearchInput value={search} onChange={value => { setSearch(value); setPage(1); }} placeholder="Search leads or programmes..." />
        <Select label="Stage" value={stage} onChange={value => { setStage(value); setPage(1); }} options={[{ value: "all", label: "All stages" }, ...COMMERCIAL_STAGES.map(value => ({ value, label: value }))]} />
        <Select label="Owner" value={owner} onChange={value => { setOwner(value); setPage(1); }} options={[{ value: "all", label: "All owners" }, ...state.users.map(user => ({ value: user.id, label: user.name }))]} />
      </div><Tabs value={view} onChange={setView} items={[{ value: "list", label: "List", icon: "ri-list-check" }, { value: "board", label: "Board", icon: "ri-layout-column-line" }]} /></CardBody>
      {loading ? <CardBody><LoadingState>Loading commercial opportunities...</LoadingState></CardBody>
        : error ? <CardBody><p role="alert" className="text-red-700">{error}</p><Button variant="outline" onClick={() => void reload()}>Try again</Button></CardBody>
          : !filtered.length ? <EmptyState icon="ri-briefcase-4-line" title={opportunities.length ? "No opportunities match your filters" : "No commercial opportunities yet"} message="Create a referral from an existing lead to start the commercial review." />
            : view === "board" ? <CardBody><CommercialBoard rows={filtered} onEdit={can("commercial.manage") ? setEditing : undefined} saving={saving} onStageChange={(record, next) => { if (!saving) void update(record, { stage: next }); }} /></CardBody>
              : <><CommercialTable rows={filtered.slice((currentPage - 1) * 50, currentPage * 50)} onEdit={can("commercial.manage") ? setEditing : undefined} /><PaginationFooter currentPage={currentPage} pageCount={pageCount} total={filtered.length} itemLabel="opportunities" onPageChange={setPage} /></>}
    </Card>
    <Modal open={chooseLead} onClose={() => setChooseLead(false)} title="Choose a lead for commercial review">
      <SearchInput value={leadSearch} onChange={setLeadSearch} placeholder="Search lead name or email..." />
      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{availableLeads.slice(0, 50).map(lead => <button type="button" key={lead.id} className="w-full rounded-md border border-background-200 p-3 text-left hover:bg-primary-50" onClick={() => { setChooseLead(false); setSelectedLead(lead); }}><span className="block text-sm font-semibold">{lead.name}</span><span className="text-xs text-foreground-500">{lead.email || lead.programme}</span></button>)}
        {!availableLeads.length ? <p className="text-sm text-foreground-500">No matching leads available for a new referral.</p> : null}
      </div>
    </Modal>
    {selectedLead ? <CommercialReferralModal open onClose={() => setSelectedLead(null)} lead={selectedLead} /> : null}
    <Modal open={Boolean(editing)} onClose={() => { if (!saving) setEditing(null); }} title="Update commercial opportunity" footer={<><Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button><Button loading={saving} disabled={saving || !editing?.suggestedProgramme.trim()} onClick={() => editing && void update(editing, editing)}>{saving ? "Saving..." : "Save opportunity"}</Button></>}>
      {editing ? <div className="grid gap-4 sm:grid-cols-2">
        <Input id="commercial-programme" label="Suggested programme" value={editing.suggestedProgramme} onChange={event => setEditing({ ...editing, suggestedProgramme: event.target.value })} />
        <Select label="Opportunity stage" value={editing.stage} onChange={value => setEditing({ ...editing, stage: value as CommercialStage })} options={COMMERCIAL_STAGES.map(value => ({ value, label: value }))} />
        <Select label="Budget" value={editing.budgetStatus} onChange={value => setEditing({ ...editing, budgetStatus: value })} options={BUDGET_STATUSES.map(value => ({ value, label: value }))} />
        <Select label="Quote" value={editing.quoteStatus} onChange={value => setEditing({ ...editing, quoteStatus: value })} options={QUOTE_STATUSES.map(value => ({ value, label: value }))} />
        <Select label="Commercial owner" value={editing.commercialOwnerId} onChange={value => setEditing({ ...editing, commercialOwnerId: value })} options={state.users.map(user => ({ value: user.id, label: user.name }))} />
        <Input id="commercial-followup" type="date" label="Next follow-up" value={editing.nextFollowUpAt?.slice(0, 10) || ""} onChange={event => setEditing({ ...editing, nextFollowUpAt: event.target.value ? new Date(event.target.value).toISOString() : "" })} />
        <div className="sm:col-span-2"><Input id="commercial-notes" label="Notes" value={editing.notes} onChange={event => setEditing({ ...editing, notes: event.target.value })} maxLength={2000} /></div>
      </div> : null}
    </Modal>
  </div>;
}
