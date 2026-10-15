import LoadingState from "@/components/base/LoadingState";
﻿import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "@/components/base/Button";
import EmptyState from "@/components/base/EmptyState";
import PaginationFooter from "@/components/base/PaginationFooter";
import { useToast } from "@/components/base/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import ApplicationFilters, { DEFAULT_APPLICATION_FILTERS, type ApplicationFilterState } from "./components/ApplicationFilters";
import ApplicationTable from "./components/ApplicationTable";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { loadBackendApplicationPage, reconcileBackendEnrolledApplications } from "@/store/backendSync";
import type { Application } from "@/store/types";

const PER_PAGE = 50;
export default function ApplicationsPage() {
  const navigate = useNavigate();
  const { state } = useWorkspace();
  const usersRef = useRef(state.users); usersRef.current = state.users;
  const { seesAll, can } = usePermissions();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<ApplicationFilterState>({ ...DEFAULT_APPLICATION_FILTERS, status: searchParams.get('status') || 'all' });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: String(PER_PAGE), offset: String((page - 1) * PER_PAGE), include_total: 'true', search: filters.search });
      for (const key of ['status', 'programme', 'intake', 'owner'] as const) if (filters[key] !== 'all') params.set(key, filters[key]);
      void loadBackendApplicationPage(usersRef.current, params, controller.signal).then(result => {
        if (!controller.signal.aborted) { setRows(result.applications); setTotal(result.total); }
      }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Applications could not be loaded.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, filters, revision]);
  const reconcile = async () => {
    setSaving(true);
    try {
      const created = await reconcileBackendEnrolledApplications();
      toast({ title: 'Enrolled learner applications updated', message: `${created} missing applications created.`, tone: 'success' });
      setRevision(value => value + 1);
    } catch (err) { toast({ title: 'Applications could not be updated', message: err instanceof Error ? err.message : 'Please try again.', tone: 'error' }); }
    finally { setSaving(false); }
  };
  return <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="font-heading text-2xl font-extrabold">Applications</h1>
        <p className="mt-1 text-sm text-foreground-500">Enrolled learners from recorded enrolment sources. Contract and document verification are tracked separately.</p>
        {!loading && !error && <p className="mt-1 text-sm text-foreground-500">{total} applications match your filters</p>}
      </div>
      <div className="flex gap-2"><Button variant="outline" loading={loading} disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</Button>
        {seesAll && can('applications.edit') && <Button loading={saving} disabled={saving} onClick={() => void reconcile()}>{saving ? 'Creating applications...' : 'Create missing applications'}</Button>}
      </div>
    </div>
    <ApplicationFilters filters={filters} onChange={next => { setFilters(next); setPage(1); }} ownerOptions={[{ value: 'all', label: 'All owners' }, ...state.users.map(user => ({ value: user.id, label: user.name }))]} />
    <div className="rounded-lg border border-background-200 bg-background-50">
      {loading ? <LoadingState className="p-6">Loading applications...</LoadingState> : error ? <div className="p-6" role="alert">{error}<Button variant="outline" onClick={() => setRevision(value => value + 1)}>Retry</Button></div> : <>
        <PaginationFooter position="top" currentPage={page} pageCount={Math.max(1, Math.ceil(total / PER_PAGE))} total={total} itemLabel="applications" onPageChange={setPage} />
        {rows.length ? <ApplicationTable applications={rows} onOpen={id => navigate(`/applications/${encodeURIComponent(id)}`)} /> : <EmptyState icon="ri-file-search-line" title="No enrolled learner applications match" message="Try clearing your filters, or create applications for learners with a recorded Enrolled status." />}
        <PaginationFooter currentPage={page} pageCount={Math.max(1, Math.ceil(total / PER_PAGE))} total={total} itemLabel="applications" onPageChange={setPage} />
      </>}
    </div>
  </div>;
}
