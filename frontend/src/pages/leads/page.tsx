import LoadingState from "@/components/base/LoadingState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "@/components/base/Button";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import Modal from "@/components/base/Modal";
import PaginationFooter from "@/components/base/PaginationFooter";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import { usePermissions } from "@/hooks/usePermissions";
import LeadFilters, {
  DEFAULT_LEAD_FILTERS,
  type LeadFilterState,
} from "@/pages/leads/components/LeadFilters";
import LeadFormModal from "@/pages/leads/components/LeadFormModal";
import LeadTable, { type LeadSortKey } from "@/pages/leads/components/LeadTable";
import { loadBackendLeadPage } from "@/store/backendSync";
import { useWorkspace, type LeadInput } from "@/store/WorkspaceProvider";
import type { Lead } from "@/store/types";
import { leadSessionGroup, registrationsByEmail, sessionGroupMeta, type SessionGroupId } from "@/utils/conversion";

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const PER_PAGE = 50;
type ProgrammeLookupState = { programmes?: Array<{ id: string; name: string }> };

export default function LeadsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, createLead, updateLead, deleteLead } = useWorkspace();
  const { canSeeOwner } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState<LeadFilterState>({ ...DEFAULT_LEAD_FILTERS });
  const [quick, setQuick] = useState("none");
  const [sortKey, setSortKey] = useState<LeadSortKey>("lastContactAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [segment, setSegment] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [leadRows, setLeadRows] = useState<Lead[]>([]);
  const [leadTotal, setLeadTotal] = useState<number | null>(null);
  const [leadHasMore, setLeadHasMore] = useState(false);
  const [leadLoading, setLeadLoading] = useState(true);
  const pageCursorsRef = useRef<Record<number, string>>({ 1: "" });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const next = { ...DEFAULT_LEAD_FILTERS };
    let touched = false;
    const stage = searchParams.get("stage");
    const priority = searchParams.get("priority");
    const owner = searchParams.get("owner");
    const source = searchParams.get("source");
    const programme = searchParams.get("programme");
    if (stage) {
      next.stage = stage;
      touched = true;
    }
    if (priority) {
      next.priority = priority;
      touched = true;
    }
    if (owner) {
      next.owner = owner;
      touched = true;
    }
    if (source) {
      next.source = source;
      touched = true;
    }
    if (programme) {
      next.programme = programme;
      touched = true;
    }
    const acqFrom = searchParams.get("acqFrom");
    const acqTo = searchParams.get("acqTo");
    if (acqFrom) {
      next.acquisitionFrom = acqFrom;
      touched = true;
    }
    if (acqTo) {
      next.acquisitionTo = acqTo;
      touched = true;
    }
    const q = searchParams.get("q");
    if (q) {
      next.search = q;
      touched = true;
    }
    if (searchParams.get("apollo") === "1") {
      next.apolloOnly = true;
      touched = true;
    }
    const chip = searchParams.get("filter");
    if (chip === "apollo") {
      next.apolloOnly = true;
      touched = true;
    }
    if (touched) setFilters(next);
    const followup = searchParams.get("followup");
    const created = searchParams.get("created");
    if (followup === "overdue") setQuick("followup-overdue");
    else if (created === "week") setQuick("created-week");
    else setQuick("none");
    setSegment(searchParams.get("segment") ?? "all");
    setPage(1);
  }, [searchParams]);

  // Persist the active filters in the URL so a filtered view can be shared and
  // restored. It only writes when the serialised params actually change, so it
  // can never loop with the read effect above.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.stage !== "all") params.set("stage", filters.stage);
    if (filters.programme !== "all") params.set("programme", filters.programme);
    if (filters.owner !== "all") params.set("owner", filters.owner);
    if (filters.source !== "all") params.set("source", filters.source);
    if (filters.priority !== "all") params.set("priority", filters.priority);
    if (filters.apolloOnly) params.set("apollo", "1");
    if (filters.acquisitionFrom) params.set("acqFrom", filters.acquisitionFrom);
    if (filters.acquisitionTo) params.set("acqTo", filters.acquisitionTo);
    if (segment !== "all") params.set("segment", segment);
    if (filters.search) params.set("q", filters.search);
    const nextStr = params.toString();
    if (nextStr !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [filters, segment, searchParams, setSearchParams]);

  const regIndex = useMemo(() => registrationsByEmail(state.events), [state.events]);

  const programmeIdForFilter = useMemo(() => {
    if (filters.programme === "all") return "all";
    const programmes = (state as ProgrammeLookupState).programmes || [];
    return programmes.find((programme) => programme.name === filters.programme || programme.id === filters.programme)?.id ?? filters.programme;
  }, [filters.programme, state]);

  const leadSourceForFilter = filters.apolloOnly ? "Apollo.io" : filters.source;
  const apiSort = sortKey === "name" ? "name" : "created_at";

  const fetchLeadPage = useCallback(
    async (targetPage: number) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLeadLoading(true);
      const cursors = { ...pageCursorsRef.current };
      const knownPages = Object.keys(cursors).map(Number).filter((cursorPage) => cursorPage <= targetPage);
      const startPage = Math.max(1, ...knownPages);
      let cursor = cursors[startPage] ?? "";
      let rows: Lead[] = [];
      let hasMore = false;
      let total: number | null = null;

      try {
        for (let nextPage = startPage; nextPage <= targetPage; nextPage += 1) {
          const result = await loadBackendLeadPage(state.users, {
            limit: PER_PAGE,
            cursor,
            search: filters.search.trim(),
            stage: filters.stage,
            ownerId: filters.owner === "unassigned" ? "" : filters.owner,
            programmeId: programmeIdForFilter,
            source: leadSourceForFilter,
            createdFrom: filters.acquisitionFrom || undefined,
            createdTo: filters.acquisitionTo ? `${filters.acquisitionTo}T23:59:59` : undefined,
            sort: apiSort,
            dir: sortDir,
            includeTotal: !cursor,
          });
          rows = result.leads;
          hasMore = result.hasMore;
          total = result.total;
          if (result.nextCursor) cursors[nextPage + 1] = result.nextCursor;
          cursor = result.nextCursor;
          if (!result.hasMore && nextPage < targetPage) break;
        }
        if (requestIdRef.current !== requestId) return;
        pageCursorsRef.current = cursors;
        setLeadRows(rows);
        if (total !== null) setLeadTotal(total);
        setLeadHasMore(hasMore);
        setPage(targetPage);
      } catch (error) {
        if (requestIdRef.current === requestId) {
          toast({
            title: "Leads could not be loaded",
            message: error instanceof Error ? error.message : "The backend did not return this page.",
            tone: "error",
          });
        }
      } finally {
        if (requestIdRef.current === requestId) setLeadLoading(false);
      }
    },
    [
      apiSort,
      filters.acquisitionFrom,
      filters.acquisitionTo,
      filters.owner,
      filters.search,
      filters.stage,
      leadSourceForFilter,
      programmeIdForFilter,
      sortDir,
      state.users,
      toast,
    ],
  );

  useEffect(() => {
    pageCursorsRef.current = { 1: "" };
    setLeadTotal(null);
    setSelectedIds([]);
    void fetchLeadPage(1);
  }, [fetchLeadPage]);

  const filtered = useMemo(() => {
    const nowTs = Date.now();
    return leadRows.filter((lead) => {
      if (!canSeeOwner(lead.ownerId)) return false;
      if (segment !== "all" && leadSessionGroup(lead, regIndex) !== (segment as SessionGroupId)) {
        return false;
      }
      if (quick === "followup-overdue") {
        if (lead.stage === "Won" || lead.stage === "Lost") return false;
        if (new Date(lead.nextActionAt).getTime() >= nowTs) return false;
      }
      if (quick === "created-week" && nowTs - new Date(lead.createdAt).getTime() > 7 * 86400000) {
        return false;
      }
      if (filters.priority !== "all" && lead.priority !== filters.priority) return false;
      return true;
    });
  }, [leadRows, filters.priority, quick, canSeeOwner, segment, regIndex]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "value") cmp = a.value - b.value;
      else if (sortKey === "priority") cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      else if (sortKey === "lastContactAt") {
        cmp = new Date(a.lastContactAt).getTime() - new Date(b.lastContactAt).getTime();
      } else {
        cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalForPaging = leadTotal ?? (page - 1) * PER_PAGE + leadRows.length + (leadHasMore ? PER_PAGE : 0);
  const pageCount = Math.max(1, Math.ceil(totalForPaging / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const paged = sorted;

  const handleSort = (key: LeadSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "programme" ? "asc" : "desc");
    }
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAll = () => {
    const pageIds = paged.map((l) => l.id);
    const allOn = pageIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allOn ? selectedIds.filter((id) => !pageIds.includes(id)) : [...new Set([...selectedIds, ...pageIds])]);
  };

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > pageCount || nextPage === currentPage) return;
    void fetchLeadPage(nextPage);
  };

  const handleSubmit = (input: LeadInput) => {
    if (editing) {
      updateLead(editing.id, input);
      toast({ title: "Lead updated", message: `${input.name} was saved.`, tone: "success" });
    } else {
      const created = createLead(input);
      toast({
        title: "Lead created",
        message: `${created.name} was added to the CRM.`,
        tone: "success",
      });
    }
    setFormOpen(false);
    setEditing(null);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteLead(deleteTarget.id);
    setSelectedIds((prev) => prev.filter((id) => id !== deleteTarget.id));
    toast({ title: "Lead deleted", message: `${deleteTarget.name} was removed.`, tone: "info" });
    setDeleteTarget(null);
  };

  const newThisWeek = leadRows.filter(
    (l) => Date.now() - new Date(l.createdAt).getTime() < 7 * 86400000,
  ).length;
  const qualified = leadRows.filter((l) => l.stage === "Qualified").length;
  const overdueFollowUps = leadRows.filter(
    (l) =>
      l.stage !== "Won" &&
      l.stage !== "Lost" &&
      new Date(l.nextActionAt).getTime() < Date.now(),
  ).length;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">
            Admissions &amp; Sales
          </p>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">
            Leads
          </h1>
          <p className="mt-1 text-[13px] text-foreground-500">
            CRM workspace · {leadTotal?.toLocaleString() ?? totalForPaging.toLocaleString()} records · showing {paged.length} on this page
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            leftIcon={<i className="ri-download-line"></i>}
            onClick={() =>
              toast({
                title: "Export started (demonstration)",
                message: "No file was generated in prototype mode.",
                tone: "info",
              })
            }
          >
            Export
          </Button>
          <PermissionGate capability="leads.create">
            <Button
              leftIcon={<i className="ri-user-add-line"></i>}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              New lead
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total leads" value={leadTotal ?? totalForPaging} icon="ri-contacts-book-2-line" tone="primary" />
        <MetricCard label="New on page" value={newThisWeek} icon="ri-user-add-line" tone="accent" />
        <MetricCard label="Qualified on page" value={qualified} icon="ri-shield-check-line" tone="success" />
        <MetricCard label="Overdue on page" value={overdueFollowUps} icon="ri-alarm-warning-line" tone="danger" />
      </div>

      {segment !== "all" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5">
          <span className="flex items-center gap-2 text-[13px] font-medium text-primary-700">
            <i className="ri-filter-3-line"></i>
            Filtered by information-session group:{" "}
            <strong>{sessionGroupMeta(segment as SessionGroupId).label}</strong>
          </span>
          <Button variant="ghost" size="xs" onClick={() => setSegment("all")}>
            Clear group filter
          </Button>
        </div>
      ) : null}

      {filters.apolloOnly || filters.acquisitionFrom || filters.acquisitionTo ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-200 bg-accent-100/60 px-4 py-2.5">
          <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-accent-900">
            <i className="ri-filter-3-line"></i>
            Applied:{" "}
            {filters.apolloOnly ? (
              <strong>Apollo.io — original source (lead&apos;s own recorded provider)</strong>
            ) : null}
            {filters.apolloOnly && (filters.acquisitionFrom || filters.acquisitionTo) ? (
              <span>·</span>
            ) : null}
            {filters.acquisitionFrom || filters.acquisitionTo ? (
              <strong>
                Acquired {filters.acquisitionFrom || "…"} → {filters.acquisitionTo || "…"}
              </strong>
            ) : null}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              setFilters((f) => ({
                ...f,
                apolloOnly: false,
                acquisitionFrom: "",
                acquisitionTo: "",
              }))
            }
          >
            Clear quick filters
          </Button>
        </div>
      ) : null}

      <LeadFilters
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />

      <div className="rounded-lg border border-background-200 bg-background-50">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-background-200 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[13px] text-foreground-600">
            {selectedIds.length > 0 ? (
              <>
                <span className="font-semibold text-foreground-900">
                  {selectedIds.length} selected
                </span>
                <PermissionGate capability="leads.delete">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      selectedIds.forEach((id) => deleteLead(id));
                      toast({ title: `${selectedIds.length} leads deleted`, tone: "info" });
                      setSelectedIds([]);
                    }}
                  >
                    Delete
                  </Button>
                </PermissionGate>
                <Button variant="ghost" size="xs" onClick={() => setSelectedIds([])}>
                  Clear
                </Button>
              </>
            ) : (
              <span className="text-foreground-400">Select rows for bulk actions</span>
            )}
          </div>
          <span className="text-[12px] text-foreground-400">
            Sorted by {sortKey} · {sortDir === "asc" ? "ascending" : "descending"}
          </span>
        </div>

        <PaginationFooter
          position="top"
          currentPage={currentPage}
          pageCount={pageCount}
          total={totalForPaging}
          itemLabel="leads"
          onPageChange={handlePageChange}
        />

        {leadLoading ? (
          <LoadingState className="px-4 py-10 text-center text-[13px] font-medium text-foreground-500">Loading 50 leads...</LoadingState>
        ) : paged.length === 0 ? (
          <EmptyState
            icon="ri-user-search-line"
            title="No leads match your filters"
            message="Try clearing the search or widening the filters to see more records."
            action={
              <Button variant="outline" size="sm" onClick={() => setFilters({ ...DEFAULT_LEAD_FILTERS })}>
                Reset filters
              </Button>
            }
          />
        ) : (
          <LeadTable
            leads={paged}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            onOpen={(id) => navigate(`/leads/${id}`)}
            onEdit={(lead) => {
              setEditing(lead);
              setFormOpen(true);
            }}
            onDelete={(lead) => setDeleteTarget(lead)}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
          />
        )}

        <PaginationFooter
          currentPage={currentPage}
          pageCount={pageCount}
          total={totalForPaging}
          itemLabel="leads"
          onPageChange={handlePageChange}
        />
      </div>

      <LeadFormModal
        open={formOpen}
        lead={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        size="sm"
        title="Delete this lead?"
        description="This removes the record from the demonstration dataset. This cannot be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" leftIcon={<i className="ri-delete-bin-line"></i>} onClick={confirmDelete}>
              Delete lead
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-foreground-600">
          {deleteTarget ? `${deleteTarget.name} — ${deleteTarget.programme}` : ""}
        </p>
      </Modal>
    </div>
  );
}
