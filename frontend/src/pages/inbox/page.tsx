import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import Checkbox from "@/components/base/Checkbox";
import EmptyState from "@/components/base/EmptyState";
import PaginationFooter from "@/components/base/PaginationFooter";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import Tabs, { type TabItem } from "@/components/base/Tabs";
import { useToast } from "@/components/base/Toast";
import { labelById } from "@/config/crm";
import { usePermissions } from "@/hooks/usePermissions";
import ComposeModal from "@/pages/inbox/components/ComposeModal";
import { mapBackendEmailThread } from "@/store/backendSync";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { EmailThread, ThreadStatusKey } from "@/store/types";
import {
  THREAD_STATUS_LABELS,
  THREAD_STATUS_ORDER,
  durationLabel,
  isAwaitingReply,
  isOverdue,
  matchesStatus,
  threadStatusCounts,
} from "@/utils/inbox";
import { relativeTime } from "@/utils/format";

const PER_PAGE = 50;

type BackendEmailPage = {
  emails?: Record<string, any>[];
  items?: Record<string, any>[];
  total?: number | null;
  next_cursor?: string;
  has_more?: boolean;
};

export default function InboxPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    state,
    currentUserId,
    userName,
    backendLoadedAt,
    composeThread,
    refreshBackendWorkspace,
    toggleThreadFlag,
    bulkThreadAction,
  } = useWorkspace();

  const { canSeeOwner } = usePermissions();
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<ThreadStatusKey>("all");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [label, setLabel] = useState("all");
  const [sort, setSort] = useState("urgency");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [backendPages, setBackendPages] = useState<Record<number, EmailThread[]>>({});
  const [, setBackendCursors] = useState<Record<number, string>>({ 1: "" });
  const [backendTotal, setBackendTotal] = useState<number | null>(null);
  const [backendHasMore, setBackendHasMore] = useState(false);
  const [backendEmailLoading, setBackendEmailLoading] = useState(false);
  const [backendEmailError, setBackendEmailError] = useState<string | null>(null);
  const loadedEmailPageKeys = useRef(new Set<string>());
  const backendCursorsRef = useRef<Record<number, string>>({ 1: "" });
  const emailRequestRef = useRef<{ key: string; controller: AbortController } | null>(null);

  useEffect(() => {
    const next = searchParams.get("status");
    if (next && THREAD_STATUS_ORDER.includes(next as ThreadStatusKey)) {
      setStatus(next as ThreadStatusKey);
    }
  }, [searchParams]);

  const backendInboxMode = Boolean(backendLoadedAt);
  const loadedBackendThreads = useMemo(() => Object.values(backendPages).flat(), [backendPages]);
  const sourceThreads = backendInboxMode ? loadedBackendThreads : state.threads;

  const loadEmailPage = useCallback(
    async (pageNumber: number, force = false) => {
      if (!backendLoadedAt) return;
      if (pageNumber > 1 && !backendCursorsRef.current[pageNumber]) {
        await loadEmailPage(pageNumber - 1);
      }
      const cursor = backendCursorsRef.current[pageNumber] ?? "";
      if (pageNumber > 1 && !cursor) return;
      const key = `${pageNumber}:${cursor}`;
      if (!force && loadedEmailPageKeys.current.has(key)) return;
      if (emailRequestRef.current?.key === key) return;
      emailRequestRef.current?.controller.abort();
      const controller = new AbortController();
      emailRequestRef.current = { key, controller };
      setBackendEmailLoading(true);
      setBackendEmailError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PER_PAGE),
          include_total: pageNumber === 1 ? "true" : "false",
        });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/emails?${params.toString()}`, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as BackendEmailPage & { error?: string; message?: string };
        if (!response.ok) throw new Error(payload.error || payload.message || "Could not load emails.");
        const rows = Array.isArray(payload.emails) ? payload.emails : Array.isArray(payload.items) ? payload.items : [];
        const mapped = rows.map((item) => mapBackendEmailThread(item, state.users));
        loadedEmailPageKeys.current.add(key);
        setBackendPages((prev) => ({ ...prev, [pageNumber]: mapped }));
        setBackendHasMore(Boolean(payload.has_more));
        if (pageNumber === 1 && typeof payload.total === "number") setBackendTotal(payload.total);
        if (payload.next_cursor) {
          const nextCursors = { ...backendCursorsRef.current, [pageNumber + 1]: String(payload.next_cursor) };
          backendCursorsRef.current = nextCursors;
          setBackendCursors(nextCursors);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setBackendEmailError(error instanceof Error ? error.message : "Could not load emails.");
        }
      } finally {
        if (emailRequestRef.current?.key === key) emailRequestRef.current = null;
        if (!controller.signal.aborted) setBackendEmailLoading(false);
      }
    },
    [backendLoadedAt, state.users],
  );

  useEffect(() => {
    if (!backendLoadedAt) return;
    void loadEmailPage(page);
    return () => {
      emailRequestRef.current?.controller.abort();
      emailRequestRef.current = null;
    };
  }, [backendLoadedAt, loadEmailPage, page]);

  const counts = useMemo(() => threadStatusCounts(sourceThreads), [sourceThreads]);

  const tabItems: TabItem[] = THREAD_STATUS_ORDER.map((key) => ({
    value: key,
    label: THREAD_STATUS_LABELS[key],
    count: counts[key],
  }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = sourceThreads.filter((thread) => {
      if (!canSeeOwner(thread.ownerId)) return false;
      if (!matchesStatus(thread, status)) return false;
      if (owner === "mine" && thread.ownerId !== currentUserId) return false;
      else if (owner === "unassigned" && thread.ownerId) return false;
      else if (owner !== "all" && owner !== "mine" && owner !== "unassigned" && thread.ownerId !== owner)
        return false;
      if (label !== "all" && !thread.labelIds.includes(label)) return false;
      if (q) {
        const haystack = `${thread.subject} ${thread.senderName} ${thread.senderEmail} ${thread.preview} ${thread.labelIds
          .map((id) => labelById(id)?.name ?? "")
          .join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sort === "received") return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
      if (sort === "deadline") return new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime();
      const aScore = (isOverdue(a) ? 0 : isAwaitingReply(a) ? 1 : 2) * 1000 + new Date(a.receivedAt).getTime() / 1e9;
      const bScore = (isOverdue(b) ? 0 : isAwaitingReply(b) ? 1 : 2) * 1000 + new Date(b.receivedAt).getTime() / 1e9;
      return aScore - bScore;
    });
    return list;
  }, [sourceThreads, status, owner, label, search, sort, currentUserId, canSeeOwner]);

  const usingServerPaging = backendInboxMode && !search.trim() && status === "all" && owner === "all" && label === "all";
  const serverEmailCount = backendTotal ?? (backendHasMore ? page * PER_PAGE + 1 : filtered.length);
  const pageCount = Math.max(1, Math.ceil((usingServerPaging ? serverEmailCount : filtered.length) / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const currentBackendPage = backendPages[currentPage] ?? [];
  const paged = usingServerPaging
    ? currentBackendPage
    : filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const runBulk = (action: "resolve" | "trash" | "read" | "restore") => {
    bulkThreadAction(selected, action);
    toast({ title: `${selected.length} emails updated`, message: `Bulk action: ${action}.`, tone: "success" });
    setSelected([]);
  };

  const syncAllGmail = async () => {
    setSyncingGmail(true);
    try {
      let totalImported = 0;
      let totalScanned = 0;
      let lastResult: Record<string, any> | null = null;
      for (let batch = 0; batch < 5; batch += 1) {
        const response = await fetch("/api/integrations/gmail/sync", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            latest: true,
            skip_trash: false,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || payload?.message || "Gmail sync failed.");
        lastResult = payload;
        totalImported += Number(payload.imported || 0);
        totalScanned += Number(payload.scanned || 0);
        if (!payload.has_more || payload.quota_limited) break;
      }
      await refreshBackendWorkspace();
      loadedEmailPageKeys.current.clear();
      setBackendPages({});
      backendCursorsRef.current = { 1: "" };
      setBackendCursors({ 1: "" });
      setBackendTotal(null);
      setBackendHasMore(false);
      setStatus("all");
      setSearch("");
      setPage(1);
      await loadEmailPage(1, true);
      toast({
        title: lastResult?.quota_limited ? "Gmail paused by quota" : "Gmail sync complete",
        message: `${totalImported} imported, ${totalScanned} scanned. Inbox refreshed from backend.`,
        tone: lastResult?.quota_limited ? "info" : "success",
      });
    } catch (error) {
      toast({
        title: "Gmail sync failed",
        message: error instanceof Error ? error.message : "Could not pull Gmail emails.",
        tone: "error",
      });
    } finally {
      setSyncingGmail(false);
    }
  };

  return (
    <div className="w-full space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">Communication</p>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">Inbox</h1>
          <p className="mt-1 text-[13px] text-foreground-500">
            All conversations · {counts.overdue} past SLA · {counts.unanswered} awaiting reply
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            leftIcon={<i className={syncingGmail ? "ri-loader-4-line" : "ri-mail-download-line"}></i>}
            onClick={syncAllGmail}
            disabled={syncingGmail}
          >
            {syncingGmail ? "Syncing..." : "Sync Gmail"}
          </Button>
          <Button leftIcon={<i className="ri-edit-line"></i>} onClick={() => setComposeOpen(true)}>
            Compose
          </Button>
        </div>
      </div>

      <div className="kbc-no-scrollbar overflow-x-auto pb-1">
        <Tabs
          items={tabItems}
          value={status}
          onChange={(v) => {
            setStatus(v as ThreadStatusKey);
            setPage(1);
            setSelected([]);
          }}
        />
      </div>

      <div className="rounded-lg border border-background-200 bg-background-50">
        <div className="flex flex-wrap items-end gap-2.5 border-b border-background-200 p-3 md:p-4">
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <Select
              label="Owner"
              size="sm"
              className="w-full sm:w-[12rem]"
              value={owner}
              onChange={(v) => {
                setOwner(v);
                setPage(1);
              }}
              options={[
                { value: "all", label: "All owners" },
                { value: "mine", label: "Assigned to me" },
                { value: "unassigned", label: "Unassigned" },
                ...state.users.map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          </div>
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <Select
              label="Label"
              size="sm"
              className="w-full sm:w-[13rem]"
              value={label}
              onChange={(v) => {
                setLabel(v);
                setPage(1);
              }}
              options={[
                { value: "all", label: "All labels" },
                ...state.labels.map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
          </div>
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <Select
              label="Sort by"
              size="sm"
              className="w-full sm:w-[12rem]"
              value={sort}
              onChange={setSort}
              options={[
                { value: "urgency", label: "Urgency" },
                { value: "received", label: "Received date" },
                { value: "deadline", label: "Response deadline" },
              ]}
            />
          </div>
          <div className="flex-1 basis-full lg:basis-auto lg:min-w-[14rem]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
              Search
            </label>
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search sender, email, subject or label…"
            />
          </div>
        </div>

        {selected.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-background-200 bg-primary-50/60 px-4 py-2.5">
            <span className="text-[13px] font-semibold text-foreground-900">
              {selected.length} selected
            </span>
            <Button variant="outline" size="xs" onClick={() => runBulk("read")}>
              Mark read
            </Button>
            <Button variant="outline" size="xs" onClick={() => runBulk("resolve")}>
              Resolve
            </Button>
            {status === "trash" ? (
              <Button variant="outline" size="xs" onClick={() => runBulk("restore")}>
                Restore
              </Button>
            ) : (
              <Button variant="outline" size="xs" onClick={() => runBulk("trash")}>
                Move to trash
              </Button>
            )}
            <Button variant="ghost" size="xs" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
        ) : null}

        <PaginationFooter
          position="top"
          currentPage={currentPage}
          pageCount={pageCount}
          total={usingServerPaging ? serverEmailCount : filtered.length}
          itemLabel="emails"
          onPageChange={setPage}
        />

        {backendEmailError ? (
          <EmptyState
            icon="ri-error-warning-line"
            title="Emails could not load"
            message={backendEmailError}
          />
        ) : paged.length === 0 ? (
          <EmptyState
            icon={backendEmailLoading ? "ri-loader-4-line" : "ri-inbox-archive-line"}
            title={backendEmailLoading ? "Loading emails" : "Nothing here"}
            message={backendEmailLoading ? "Pulling this inbox page from the backend." : "No emails match this status and filter combination."}
          />
        ) : (
          <ul className="divide-y divide-background-200">
            {paged.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                selected={selected.includes(thread.id)}
                onToggle={() => toggleSelect(thread.id)}
                onOpen={() => navigate(`/inbox/${thread.id}`)}
                ownerName={userName(thread.ownerId)}
                onStar={() => toggleThreadFlag(thread.id, "starred")}
              />
            ))}
          </ul>
        )}

        <PaginationFooter
          currentPage={currentPage}
          pageCount={pageCount}
          total={usingServerPaging ? serverEmailCount : filtered.length}
          itemLabel="emails"
          onPageChange={setPage}
        />
      </div>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={(input) => {
          const thread = composeThread(input);
          toast({
            title: "Email recorded (simulated)",
            message: `No message was actually delivered. Thread ${thread.id} added to Sent.`,
            tone: "success",
          });
          setStatus("sent");
        }}
      />
    </div>
  );
}

interface ThreadRowProps {
  thread: EmailThread;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  ownerName: string;
  onStar: () => void;
}

function ThreadRow({ thread, selected, onToggle, onOpen, ownerName, onStar }: ThreadRowProps) {
  const overdue = isOverdue(thread);
  const labels = thread.labelIds
    .filter((id) => !["lbl-inbox", "lbl-unread", "lbl-sent", "lbl-resolved", "lbl-trash"].includes(id))
    .slice(0, 3);

  return (
    <li className={selected ? "bg-primary-50/50" : undefined}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="pt-0.5">
          <Checkbox checked={selected} onChange={onToggle} />
        </div>
        <button
          type="button"
          onClick={onStar}
          aria-label="Star email"
          className={`mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center text-base ${
            thread.starred ? "text-accent-500" : "text-foreground-300 hover:text-foreground-500"
          }`}
        >
          <i className={thread.starred ? "ri-star-fill" : "ri-star-line"}></i>
        </button>
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-left">
          <Avatar name={thread.senderName} size="md" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={`truncate text-[13px] ${
                  thread.readState === "unread"
                    ? "font-bold text-foreground-950"
                    : "font-semibold text-foreground-800"
                }`}
              >
                {thread.senderName}
              </span>
              {thread.important ? (
                <span className="flex h-4 w-4 items-center justify-center text-[12px] text-red-500" title="Important">
                  <i className="ri-flag-2-fill"></i>
                </span>
              ) : null}
              {overdue ? (
                <Badge tone="danger" dot>
                  Overdue {durationLabel(thread.deadlineAt)}
                </Badge>
              ) : isAwaitingReply(thread) ? (
                <Badge tone="warning">Awaiting reply</Badge>
              ) : null}
            </span>
            <span
              className={`mt-0.5 block truncate text-[13px] ${
                thread.readState === "unread" ? "font-semibold text-foreground-900" : "text-foreground-700"
              }`}
            >
              {thread.subject}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-foreground-400">{thread.preview}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {labels.map((id) => {
                const lbl = labelById(id);
                if (!lbl) return null;
                return (
                  <Badge key={id} tone={lbl.tone}>
                    {lbl.name}
                  </Badge>
                );
              })}
            </span>
          </span>
        </button>
        <div className="hidden w-[10rem] shrink-0 flex-col items-end gap-1 lg:flex">
          <span className="text-[12px] text-foreground-500">{relativeTime(thread.receivedAt)}</span>
          <span className="text-[11px] text-foreground-400">{ownerName}</span>
          <span
            className={`text-[11px] font-semibold ${
              overdue ? "text-red-600" : thread.responseState === "resolved" ? "text-green-600" : "text-foreground-400"
            }`}
          >
            {thread.responseState === "resolved"
              ? "Resolved"
              : overdue
                ? `SLA breached ${durationLabel(thread.deadlineAt)}`
                : thread.responseState === "replied"
                  ? "Replied"
                  : `Due in ${durationLabel(thread.deadlineAt)}`}
          </span>
        </div>
      </div>
    </li>
  );
}
