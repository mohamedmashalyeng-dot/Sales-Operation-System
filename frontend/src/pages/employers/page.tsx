import LoadingState from "@/components/base/LoadingState";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Badge from "@/components/base/Badge";
import BusinessLeadPlanning from "@/components/feature/BusinessLeadPlanning";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import Input from "@/components/base/Input";
import MetricCard from "@/components/base/MetricCard";
import Modal from "@/components/base/Modal";
import PaginationFooter from "@/components/base/PaginationFooter";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import { Table, TableWrap, THead, TBody, Th, Tr, Td } from "@/components/base/Table";
import { useToast } from "@/components/base/Toast";
import { AGREEMENT_TONES, DAS_TONES, EMPLOYER_AGREEMENT_STATUSES, DAS_STATUSES } from "@/config/employer";
import { useBusinessData } from "@/hooks/useBusinessData";
import { usePermissions } from "@/hooks/usePermissions";
import { saveBusinessRecord } from "@/store/backendSync";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { formatDate } from "@/utils/format";

export default function EmployersPage() {
  const { userName } = useWorkspace();
  const { can } = usePermissions();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [agreement, setAgreement] = useState("all");
  const [das, setDas] = useState("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", contactName: "", email: "", phone: "" });
  const { data, loading, error, reload } = useBusinessData(true, undefined, { section: 'employers', limit: 50, offset: (page-1)*50, search, agreement, das });
  const employers = data?.employers || [];
  const rows = employers.filter(row => (agreement === "all" || row.agreementStatus === agreement)
    && (das === "all" || row.dasStatus === das)
    && `${row.name} ${row.contactName} ${row.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil((data?.employerTotal ?? rows.length) / 50));
  const currentPage = Math.min(page, pageCount);
  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await saveBusinessRecord("employers", form);
      setOpen(false); setForm({ name: "", contactName: "", email: "", phone: "" });
      toast({ title: "Employer saved", tone: "success" });
      await reload();
      navigate(`/employers/${encodeURIComponent(form.name.trim())}`);
    } catch (reason) { toast({ title: "Could not save employer", message: reason instanceof Error ? reason.message : "Please try again.", tone: "error" }); }
    finally { setSaving(false); }
  };
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-heading text-2xl font-extrabold text-foreground-950">Employers</h1>
          <p className="mt-1 text-sm text-foreground-500">Employer contacts, agreements and Apprenticeship Service readiness.</p></div>
        {can("employer.manage") ? <Button onClick={() => setOpen(true)} leftIcon={<i className="ri-add-line" />}>Add employer</Button> : null}
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard label="Companies in directory" value={data?.employerMetrics?.total ?? employers.length} icon="ri-building-2-line" />
        <MetricCard label="Agreements signed" value={data?.employerMetrics?.signed ?? employers.filter(row => row.agreementStatus === "Signed").length} icon="ri-file-paper-2-line" tone="success" />
        <MetricCard label="DAS confirmed" value={data?.employerMetrics?.dasConfirmed ?? employers.filter(row => row.dasStatus === "Confirmed").length} icon="ri-government-line" tone="secondary" />
        <MetricCard label="Need attention" value={data?.employerMetrics?.attention ?? employers.filter(row => row.dasStatus === "Blocked / Needs Help" || row.agreementStatus === "Requires Amendment" || row.agreementStatus === "Rejected").length} icon="ri-alert-line" tone="danger" />
      </div>
      <BusinessLeadPlanning section="employers" />
      <Card>
        <CardHeader title="Company directory" icon="ri-building-2-line" action={<Button size="sm" variant="outline" loading={loading} disabled={loading} onClick={() => void reload()}>Refresh</Button>} />
        <CardBody><p className="mb-3 text-sm text-foreground-500">Includes company names imported on CRM leads and manually recorded employers, agreements and DAS records. A directory entry does not verify the contact's role or training interest. Confirmed leads are shown separately above.</p><div className="grid gap-3 md:grid-cols-3">
          <SearchInput value={search} onChange={value => { setSearch(value); setPage(1); }} placeholder="Search employers or contacts..." />
          <Select label="Agreement" value={agreement} onChange={value => { setAgreement(value); setPage(1); }} options={[{ value: "all", label: "All agreement statuses" }, ...EMPLOYER_AGREEMENT_STATUSES.map(value => ({ value, label: value }))]} />
          <Select label="DAS" value={das} onChange={value => { setDas(value); setPage(1); }} options={[{ value: "all", label: "All DAS statuses" }, ...DAS_STATUSES.map(value => ({ value, label: value }))]} />
        </div></CardBody>
        {loading ? <CardBody><LoadingState>Loading employers...</LoadingState></CardBody>
          : error ? <CardBody><p role="alert" className="text-red-700">{error}</p><Button variant="outline" onClick={() => void reload()}>Try again</Button></CardBody>
            : !rows.length ? <EmptyState icon="ri-building-2-line" title={employers.length ? "No employers match your filters" : "No employers yet"} message="Add an employer or record the employer on a lead to start onboarding." />
              : <><TableWrap><Table><THead><Th>Employer</Th><Th>Contact</Th><Th>Linked leads</Th><Th>Agreement</Th><Th>DAS</Th><Th>Owner</Th><Th>Follow-up</Th></THead>
                <TBody>{rows.map(row => <Tr key={row.name.toLowerCase()}>
                  <Td><Link className="font-semibold text-primary-700 hover:underline" to={`/employers/${encodeURIComponent(row.name)}`}>{row.name}</Link></Td>
                  <Td>{row.contactName || "No contact recorded"}{row.email ? <a className="block text-xs text-primary-600" href={`mailto:${row.email}`}>{row.email}</a> : null}</Td>
                  <Td>{row.leadCount ?? row.leadIds.length}</Td><Td><Badge tone={AGREEMENT_TONES[row.agreementStatus] || "neutral"}>{row.agreementStatus}</Badge></Td>
                  <Td><Badge tone={DAS_TONES[row.dasStatus] || "neutral"}>{row.dasStatus}</Badge></Td><Td>{userName(row.ownerId)}</Td><Td>{row.followUpAt ? formatDate(row.followUpAt) : "Not scheduled"}</Td>
                </Tr>)}</TBody></Table></TableWrap>
                <PaginationFooter currentPage={currentPage} pageCount={pageCount} total={data?.employerTotal ?? rows.length} itemLabel="employers" onPageChange={setPage} /></>}
      </Card>
      <Modal open={open} onClose={() => { if (!saving) setOpen(false); }} title="Add employer" footer={<><Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} disabled={saving || !form.name.trim()} onClick={() => void save()}>{saving ? "Saving..." : "Save employer"}</Button></>}>
        <div className="space-y-4">
          <Input id="employer-name" label="Employer name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} maxLength={300} autoFocus />
          <Input id="employer-contact" label="Primary contact" value={form.contactName} onChange={event => setForm({ ...form, contactName: event.target.value })} maxLength={300} />
          <Input id="employer-email" label="Contact email" type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
          <Input id="employer-phone" label="Contact phone" type="tel" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
