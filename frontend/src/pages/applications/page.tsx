import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "@/components/base/Button";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import PaginationFooter from "@/components/base/PaginationFooter";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import { usePermissions } from "@/hooks/usePermissions";
import ApplicationFilters, {
  DEFAULT_APPLICATION_FILTERS,
  type ApplicationFilterState,
} from "@/pages/applications/components/ApplicationFilters";
import ApplicationFormModal from "@/pages/applications/components/ApplicationFormModal";
import ApplicationTable from "@/pages/applications/components/ApplicationTable";
import { useWorkspace, type ApplicationInput } from "@/store/WorkspaceProvider";
import type { Application } from "@/store/types";

const PER_PAGE = 8;

export default function ApplicationsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, createApplication, updateApplication } = useWorkspace();
  const { canSeeOwner, seesAll, currentUserId } = usePermissions();
  const [searchParams] = useSearchParams();

  const [filters, setFilters] = useState<ApplicationFilterState>({ ...DEFAULT_APPLICATION_FILTERS });
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);

  useEffect(() => {
    const status = searchParams.get("status");
    if (status) {
      setFilters((prev) => ({ ...prev, status }));
      setPage(1);
    }
  }, [searchParams]);

  // A sales user may see applications linked to their own leads (restricted).
  const canSeeApplication = (app: Application) => {
    if (seesAll) return true;
    if (canSeeOwner(app.ownerId)) return true;
    if (app.leadId) {
      const lead = state.leads.find((l) => l.id === app.leadId);
      if (lead && lead.ownerId === currentUserId) return true;
    }
    return false;
  };

  const visible = useMemo(
    () => state.applications.filter(canSeeApplication),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.applications, state.leads, seesAll, currentUserId],
  );

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return visible.filter((app) => {
      if (filters.status !== "all" && app.status !== filters.status) return false;
      if (filters.programme !== "all" && app.programme !== filters.programme) return false;
      if (filters.intake !== "all" && app.intake !== filters.intake) return false;
      if (filters.owner !== "all" && app.ownerId !== filters.owner) return false;
      if (q) {
        const haystack = `${app.applicantName} ${app.email} ${app.programme} ${app.id}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [visible, filters]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  const count = (status: Application["status"]) =>
    visible.filter((a) => a.status === status).length;
  const offering = visible.filter((a) => a.status === "Offer" || a.status === "Enrolled").length;

  const ownerOptions = [
    { value: "all", label: "All owners" },
    ...state.users.map((u) => ({ value: u.id, label: u.name })),
  ];

  const handleSubmit = (input: ApplicationInput) => {
    if (editing) {
      updateApplication(editing.id, {
        applicantName: input.applicantName,
        email: input.email,
        phone: input.phone,
        programme: input.programme,
        intake: input.intake,
        status: input.status,
        ownerId: input.ownerId,
        leadId: input.leadId,
      });
      toast({ title: "Application updated", message: `${input.applicantName} was saved.`, tone: "success" });
    } else {
      const created = createApplication(input);
      toast({
        title: "Application created",
        message: `${created.applicantName} — ${created.programme}.`,
        tone: "success",
      });
    }
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">
            Admissions pipeline
          </p>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">
            Applications
          </h1>
          <p className="mt-1 text-[13px] text-foreground-500">
            {visible.length} applications visible to you · {filtered.length} match the filters
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
          <PermissionGate capability="applications.edit">
            <Button
              leftIcon={<i className="ri-file-add-line"></i>}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              New application
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Submitted" value={count("Submitted")} icon="ri-file-add-line" tone="primary" />
        <MetricCard label="Under review" value={count("Under review")} icon="ri-search-eye-line" tone="secondary" />
        <MetricCard label="Interviews" value={count("Interview")} icon="ri-chat-check-line" tone="accent" />
        <MetricCard label="Offers / enrolled" value={offering} icon="ri-award-line" tone="success" />
      </div>

      <ApplicationFilters
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        ownerOptions={ownerOptions}
      />

      <div className="rounded-lg border border-background-200 bg-background-50">
        <PaginationFooter
          position="top"
          currentPage={currentPage}
          pageCount={pageCount}
          total={filtered.length}
          itemLabel="applications"
          onPageChange={setPage}
        />

        {paged.length === 0 ? (
          <EmptyState
            icon="ri-file-search-line"
            title="No applications match your filters"
            message="Try clearing the search or widening the status, programme or owner filters."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters({ ...DEFAULT_APPLICATION_FILTERS })}
              >
                Reset filters
              </Button>
            }
          />
        ) : (
          <ApplicationTable
            applications={paged}
            onOpen={(id) => navigate(`/applications/${id}`)}
            onEdit={(app) => {
              setEditing(app);
              setFormOpen(true);
            }}
          />
        )}

        <PaginationFooter
          currentPage={currentPage}
          pageCount={pageCount}
          total={filtered.length}
          itemLabel="applications"
          onPageChange={setPage}
        />
      </div>

      <ApplicationFormModal
        open={formOpen}
        application={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
