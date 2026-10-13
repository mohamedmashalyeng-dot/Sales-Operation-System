import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import PaginationFooter from "@/components/base/PaginationFooter";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import { ROLE_LIST } from "@/config/permissions";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { AuditEntry } from "@/store/types";
import { formatDateTime, relativeTime } from "@/utils/format";

const PER_PAGE = 50;

const ENTITY_LABELS: Record<string, string> = {
  lead: "Lead",
  application: "Application",
  event: "Event",
  thread: "Email",
  task: "Task",
  touchpoint: "Touchpoint",
  zoho: "Integration",
};

function recordRoute(entry: AuditEntry): string | null {
  switch (entry.entityType) {
    case "lead":
      return `/leads/${entry.entityId}`;
    case "application":
      return `/applications/${entry.entityId}`;
    case "event":
      return `/events/${entry.entityId}`;
    case "thread":
      return `/inbox/${entry.entityId}`;
    case "task":
      return "/planner";
    default:
      return null;
  }
}

export default function AuditPage() {
  const navigate = useNavigate();
  const { state, userName } = useWorkspace();
  const { can } = usePermissions();

  const [search, setSearch] = useState("");
  const [entity, setEntity] = useState("all");
  const [actor, setActor] = useState("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const allowed = can("audit.view");

  const entityTypes = useMemo(
    () => Array.from(new Set(state.audit.map((a) => a.entityType))),
    [state.audit],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = state.audit.filter((entry) => {
      if (entity !== "all" && entry.entityType !== entity) return false;
      if (actor !== "all" && entry.actorId !== actor) return false;
      if (q) {
        const haystack = `${userName(entry.actorId)} ${entry.action} ${entry.entityType} ${entry.entityId} ${entry.before} ${entry.after}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      const cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [state.audit, entity, actor, search, sortDir, userName]);

  const roleFor = (userId: string) => ROLE_LIST.find((r) => r.userId === userId);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Audit trail is restricted"
            message="The audit trail is available to Managers and Admins."
            action={
              <Button variant="outline" onClick={() => navigate("/")}>
                Back to Today
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">Administration</p>
        <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">Audit Trail</h1>
        <p className="mt-1 text-[13px] text-foreground-500">
          Every meaningful mutation writes an audit entry — record creation, edits, status changes,
          owner reassignment, task completion, replies, attendance, stage changes and attribution
          corrections. {state.audit.length} entries recorded in this session.
        </p>
      </div>

      <div className="rounded-lg border border-background-200 bg-background-50 p-3">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search actor, action or record…"
          />
          <Select
            value={entity}
            onChange={(value) => {
              setEntity(value);
              setPage(1);
            }}
            options={[
              { value: "all", label: "All entity types" },
              ...entityTypes.map((t) => ({ value: t, label: ENTITY_LABELS[t] ?? t })),
            ]}
          />
          <Select
            value={actor}
            onChange={(value) => {
              setActor(value);
              setPage(1);
            }}
            options={[
              { value: "all", label: "All actors" },
              ...state.users.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="md"
              fullWidth
              leftIcon={<i className={sortDir === "asc" ? "ri-arrow-up-line" : "ri-arrow-down-line"}></i>}
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {sortDir === "asc" ? "Oldest first" : "Newest first"}
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader
          icon="ri-history-line"
          iconTone="secondary"
          title="Record changes"
          subtitle={`${filtered.length} entries match the filters`}
        />
        <PaginationFooter
          position="top"
          currentPage={currentPage}
          pageCount={pageCount}
          total={filtered.length}
          itemLabel="entries"
          onPageChange={setPage}
        />
        {filtered.length === 0 ? (
          <EmptyState
            icon="ri-history-line"
            title="No audit entries match"
            message="Try clearing the search or widening the filters. Entries appear as you use the workspace."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <Th>Timestamp</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Before</Th>
                <Th>After</Th>
              </THead>
              <TBody>
                {paged.map((entry) => {
                  const role = roleFor(entry.actorId);
                  const route = recordRoute(entry);
                  return (
                    <Tr key={entry.id}>
                      <Td>
                        <div>
                          <p className="text-[13px] font-medium text-foreground-800">
                            {formatDateTime(entry.createdAt)}
                          </p>
                          <p className="text-[11px] text-foreground-400">
                            {relativeTime(entry.createdAt)}
                          </p>
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Avatar name={userName(entry.actorId)} size="xs" />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-foreground-800">
                              {userName(entry.actorId)}
                            </p>
                            {role ? (
                              <p className="text-[11px] text-foreground-400">{role.name}</p>
                            ) : null}
                          </div>
                        </div>
                      </Td>
                      <Td className="font-semibold text-foreground-900">{entry.action}</Td>
                      <Td>
                        <div className="flex flex-col gap-1">
                          <Badge tone="neutral">{ENTITY_LABELS[entry.entityType] ?? entry.entityType}</Badge>
                          <span className="text-[11px] text-foreground-400">{entry.entityId}</span>
                        </div>
                      </Td>
                      <Td className="text-foreground-500">{entry.before || "—"}</Td>
                      <Td className="text-foreground-800">{entry.after || "—"}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
        <PaginationFooter
          currentPage={currentPage}
          pageCount={pageCount}
          total={filtered.length}
          itemLabel="entries"
          onPageChange={setPage}
        />
      </Card>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-2 text-[12px] text-foreground-500">
          <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-400">
            <i className="ri-information-line"></i>
          </span>
          Audit entries are created only by real actions taken in this prototype. Clear local data from
          Settings to restore the baseline trail.
        </CardBody>
      </Card>
    </div>
  );
}
