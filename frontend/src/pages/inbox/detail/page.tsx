import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import Menu from "@/components/base/Menu";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import { labelById } from "@/config/crm";
import { usePermissions } from "@/hooks/usePermissions";
import LabelMultiSelect from "@/pages/inbox/components/LabelMultiSelect";
import TaskFormModal from "@/pages/planner/components/TaskFormModal";
import { mapBackendEmailThread } from "@/store/backendSync";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { EmailMessage, EmailThread } from "@/store/types";
import { durationLabel, isAwaitingReply, isOverdue, responseDeadlineTone } from "@/utils/inbox";
import { formatDateTime, relativeTime } from "@/utils/format";

type BackendEmailRecord = Record<string, unknown>;
const EMAIL_DETAIL_TIMEOUT_MS = 10000;

function routeParamId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function text(...values: unknown[]): string {
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (next) return next;
  }
  return "";
}

function visibleMessageText(...values: unknown[]): string {
  for (const value of values) {
    const next = String(value ?? "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();
    if (next) return next;
  }
  return "";
}

function isoDate(...values: unknown[]): string {
  for (const value of values) {
    const raw = text(value);
    if (!raw) continue;
    const time = new Date(raw).getTime();
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return new Date().toISOString();
}

function messageFromBackendEmail(
  record: BackendEmailRecord,
  fallback: {
    id: string;
    senderName: string;
    senderEmail: string;
    ownerName: string;
    ownerEmail: string;
    receivedAt: string;
    preview: string;
  },
): EmailMessage {
  const outbound = text(record.direction).toLowerCase() === "outbound";
  return {
    id: text(record.id, record.gmail_message_id, `${fallback.id}-message`),
    direction: outbound ? "outbound" : "inbound",
    fromName: outbound
      ? text(record.from_name, record.owner, fallback.ownerName, "You")
      : text(record.from_name, record.senderName, record.sender_name, fallback.senderName),
    fromEmail: outbound
      ? text(record.from, record.from_email, fallback.ownerEmail)
      : text(record.from, record.from_email, record.email, fallback.senderEmail),
    toEmail: outbound
      ? text(record.to_email, record.email, fallback.senderEmail)
      : text(record.to_email, fallback.ownerEmail),
    body: visibleMessageText(record.body, record.text, record.preview, record.snippet, fallback.preview),
    sentAt: isoDate(record.received_at, record.date, record.created_at, fallback.receivedAt),
    authorId: outbound ? text(record.author_id, record.owner_id) || undefined : undefined,
  };
}

export default function ThreadDetailPage() {
  const { id: routeId = "" } = useParams();
  const id = routeParamId(routeId);
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    state,
    currentUserId,
    currentUser,
    userName,
    markThreadRead,
    replyToThread,
    resolveThread,
    assignThread,
    toggleThreadLabel,
    toggleThreadFlag,
    trashThread,
    logExternalResponse,
    createTask,
  } = useWorkspace();
  const { canSeeOwner } = usePermissions();

  const [reply, setReply] = useState("");
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [backendThread, setBackendThread] = useState<EmailThread | null>(null);
  const [detailMessages, setDetailMessages] = useState<EmailMessage[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(id));
  const [detailError, setDetailError] = useState<string | null>(null);

  const storedThread = state.threads.find((t) => t.id === id);
  const thread = storedThread ?? (backendThread?.id === id ? backendThread : null);
  const threadVisible = Boolean(thread && (storedThread ? canSeeOwner(thread.ownerId) : true));

  useEffect(() => {
    setReply("");
    setBackendThread(null);
    setDetailMessages(null);
    setDetailError(null);
    setDetailLoading(Boolean(id));
  }, [id]);

  useEffect(() => {
    if (storedThread && storedThread.readState === "unread" && canSeeOwner(storedThread.ownerId)) {
      markThreadRead(id, "read");
    }
  }, [id, storedThread, markThreadRead, canSeeOwner]);

  useEffect(() => {
    if (!id || (storedThread && !canSeeOwner(storedThread.ownerId))) return;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, EMAIL_DETAIL_TIMEOUT_MS);
    setDetailLoading(true);
    setDetailError(null);
    fetch(`/api/emails/${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Email detail unavailable");
        return response.json() as Promise<{ email?: BackendEmailRecord; thread?: BackendEmailRecord[] }>;
      })
      .then((payload) => {
        const records = Array.isArray(payload.thread) && payload.thread.length ? payload.thread : payload.email ? [payload.email] : [];
        if (!records.length) return;
        const baseThread = storedThread ?? mapBackendEmailThread(payload.email ?? records[0], state.users, state.leads);
        if (!storedThread) setBackendThread(baseThread);
        const owner = baseThread.ownerId ? state.users.find((user) => user.id === baseThread.ownerId) : undefined;
        const mapped = records.map((record) =>
          messageFromBackendEmail(record, {
            id: baseThread.id,
            senderName: baseThread.senderName,
            senderEmail: baseThread.senderEmail,
            ownerName: owner?.name ?? currentUser.name,
            ownerEmail: owner?.email ?? currentUser.email,
            receivedAt: baseThread.receivedAt,
            preview: baseThread.preview,
          }),
        );
        const hasOutbound = mapped.some((message) => message.direction === "outbound");
        const responseNote = text(payload.email?.response_note);
        if (responseNote && !hasOutbound) {
          mapped.push({
            id: `${baseThread.id}-reply`,
            direction: "outbound",
            fromName: owner?.name ?? currentUser.name,
            fromEmail: owner?.email ?? currentUser.email,
            toEmail: baseThread.senderEmail,
            body: responseNote,
            sentAt: isoDate(payload.email?.response_at, baseThread.receivedAt),
            authorId: owner?.id ?? currentUser.id,
          });
        }
        setDetailMessages(mapped);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setDetailMessages(null);
          setDetailError(error instanceof Error ? error.message : "Email detail unavailable");
        } else if (timedOut) {
          setDetailError("Email detail is taking too long to respond. Try opening it again.");
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        setDetailLoading(false);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [canSeeOwner, currentUser.email, currentUser.id, currentUser.name, id, state.leads, state.users, storedThread]);

  const messages = useMemo(
    () =>
      thread
        ? [...(detailMessages ?? thread.messages)].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
        : [],
    [detailMessages, thread],
  );

  if (!thread && detailLoading) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-loader-4-line"
            title="Loading email"
            message="Opening this message from the backend."
          />
        </Card>
      </div>
    );
  }

  if (!thread || !threadVisible) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Email not available"
            message={detailError || "This thread does not exist, or your demo role cannot see it."}
            action={
              <Button variant="outline" onClick={() => navigate("/inbox")}>
                Back to Inbox
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const overdue = isOverdue(thread);
  const tone = responseDeadlineTone(thread);

  const handleSend = () => {
    if (!reply.trim()) return;
    replyToThread(thread.id, reply.trim());
    setDetailMessages(null);
    setReply("");
    toast({
      title: "Reply recorded (simulated)",
      message: "No email was actually delivered in prototype mode.",
      tone: "success",
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <button
        type="button"
        onClick={() => navigate("/inbox")}
        className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-foreground-500 transition-colors hover:text-primary-600"
      >
        <i className="ri-arrow-left-line"></i> Back to Inbox
      </button>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <div className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="font-heading text-lg font-extrabold leading-snug text-foreground-950">
                    {thread.subject}
                  </h1>
                  <p className="mt-1 text-[13px] text-foreground-500">
                    {thread.senderName} · {thread.senderEmail}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {thread.important ? (
                      <Badge tone="danger" icon="ri-flag-2-fill">
                        Important
                      </Badge>
                    ) : null}
                    <Badge
                      tone={thread.responseState === "resolved" ? "success" : overdue ? "danger" : "warning"}
                      dot
                    >
                      {thread.responseState === "resolved"
                        ? "Resolved"
                        : overdue
                          ? `Overdue ${durationLabel(thread.deadlineAt)}`
                          : isAwaitingReply(thread)
                            ? "Awaiting reply"
                            : "Replied"}
                    </Badge>
                    {thread.labelIds
                      .filter((lid) => !["lbl-inbox", "lbl-unread", "lbl-sent", "lbl-resolved", "lbl-trash"].includes(lid))
                      .map((lid) => {
                        const lbl = labelById(lid);
                        return lbl ? (
                          <Badge key={lid} tone={lbl.tone}>
                            {lbl.name}
                          </Badge>
                        ) : null;
                      })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Star"
                    onClick={() => toggleThreadFlag(thread.id, "starred")}
                  >
                    <i className={thread.starred ? "ri-star-fill text-accent-500" : "ri-star-line"}></i>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Toggle important"
                    onClick={() => toggleThreadFlag(thread.id, "important")}
                  >
                    <i className={thread.important ? "ri-flag-2-fill text-red-500" : "ri-flag-2-line"}></i>
                  </Button>
                  <Menu
                    trigger={
                      <span className="flex h-8 w-8 items-center justify-center rounded-md border border-background-300 text-lg text-foreground-500 hover:bg-background-100">
                        <i className="ri-more-2-fill"></i>
                      </span>
                    }
                    items={[
                      {
                        key: "resolve",
                        label: thread.responseState === "resolved" ? "Reopen thread" : "Mark resolved",
                        icon: "ri-checkbox-circle-line",
                        onSelect: () => {
                          resolveThread(thread.id, thread.responseState !== "resolved");
                          toast({ title: thread.responseState === "resolved" ? "Thread reopened" : "Marked resolved", tone: "success" });
                        },
                      },
                      {
                        key: "external",
                        label: "Record external response",
                        icon: "ri-record-mail-line",
                        onSelect: () => {
                          logExternalResponse(thread.id);
                          toast({ title: "External response recorded", message: "Marked as handled outside the workspace.", tone: "info" });
                        },
                      },
                      {
                        key: "trash",
                        label: thread.trashed ? "Restore from trash" : "Move to trash",
                        icon: "ri-delete-bin-line",
                        tone: "danger",
                        onSelect: () => {
                          trashThread(thread.id, !thread.trashed);
                          toast({ title: thread.trashed ? "Restored" : "Moved to trash", tone: "info" });
                        },
                      },
                    ]}
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              icon="ri-chat-3-line"
              title="Conversation"
              subtitle={`${messages.length} messages`}
            />
            <CardBody className="space-y-5">
              {messages.map((message) => {
                const outbound = message.direction === "outbound";
                const messageBody = visibleMessageText(message.body);
                return (
                  <div
                    key={message.id}
                    className={`flex min-w-0 max-w-full gap-3 ${outbound ? "flex-row-reverse" : ""}`}
                  >
                    <Avatar name={message.fromName} size="sm" />
                    <div className={`min-w-0 max-w-full flex-1 lg:max-w-[46rem] ${outbound ? "text-right" : ""}`}>
                      <div className={`flex items-center gap-2 ${outbound ? "justify-end" : ""}`}>
                        <span className="text-[12px] font-semibold text-foreground-900">
                          {outbound ? "You" : message.fromName}
                        </span>
                        <span className="text-[11px] text-foreground-400">
                          {formatDateTime(message.sentAt)}
                        </span>
                      </div>
                      <div
                        className={`mt-1.5 max-w-full whitespace-pre-wrap break-words rounded-lg border px-4 py-3 text-left text-[13px] leading-relaxed ${
                          outbound
                            ? "border-primary-200 bg-primary-50 text-foreground-800"
                            : "border-background-200 bg-background-100 text-foreground-700"
                        }`}
                        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                      >
                        {messageBody || (
                          <span className="italic text-foreground-400">
                            No message body was available for this email.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon="ri-reply-line"
              iconTone="accent"
              title="Reply"
              subtitle="Replies are simulated and never delivered in prototype mode."
            />
            <CardBody>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={5}
                maxLength={500}
                placeholder={`Reply to ${thread.senderName}…`}
                className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-foreground-400">{reply.length}/500</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" leftIcon={<i className="ri-calendar-schedule-line"></i>} onClick={() => setFollowUpOpen(true)}>
                    Schedule follow-up
                  </Button>
                  <Button
                    leftIcon={<i className="ri-send-plane-line"></i>}
                    disabled={!reply.trim()}
                    onClick={handleSend}
                  >
                    Send reply
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader icon="ri-information-line" title="Details" />
            <CardBody className="space-y-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Assigned owner</p>
                <Select
                  size="sm"
                  className="mt-1.5"
                  value={thread.ownerId ?? "unassigned"}
                  onChange={(v) => assignThread(thread.id, v === "unassigned" ? null : v)}
                  options={[
                    { value: "unassigned", label: "Unassigned" },
                    ...state.users.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Received</p>
                <p className="mt-1 text-[13px] text-foreground-800">{formatDateTime(thread.receivedAt)}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Response SLA</p>
                <p className="mt-1 text-[13px] text-foreground-800">
                  {thread.slaHours}h · deadline {formatDateTime(thread.deadlineAt)}
                </p>
                <Badge
                  className="mt-1.5"
                  tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "success" ? "success" : "neutral"}
                  dot
                >
                  {tone === "danger" ? "SLA breached" : tone === "warning" ? "Due soon" : tone === "success" ? "Resolved" : "On track"}
                </Badge>
              </div>
              {thread.externalResponseAt ? (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">External response</p>
                  <p className="mt-1 text-[13px] text-foreground-800">{formatDateTime(thread.externalResponseAt)}</p>
                </div>
              ) : null}
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground-400">Labels</p>
                <LabelMultiSelect
                  selected={thread.labelIds}
                  onToggle={(labelId) => toggleThreadLabel(thread.id, labelId)}
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon="ri-history-line"
              iconTone="secondary"
              title="Recent activity"
              subtitle="Latest workspace events"
            />
            <CardBody>
              <ul className="space-y-3">
                {state.activity.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background-100 text-sm text-foreground-600">
                      <i className={entry.icon}></i>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] text-foreground-700">
                        <span className="font-semibold">{userName(entry.actorId)}</span> {entry.action} {entry.target}
                      </p>
                      <p className="text-[11px] text-foreground-400">{relativeTime(entry.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      <TaskFormModal
        open={followUpOpen}
        defaults={{
          title: `Follow up: ${thread.subject}`,
          ownerId: thread.ownerId ?? currentUserId,
          source: "Gmail / Inbox",
          relatedThreadId: thread.id,
          relatedLeadId: thread.relatedLeadId,
          dueAt: new Date(Date.now() + 86400000).toISOString(),
        }}
        onClose={() => setFollowUpOpen(false)}
        onSubmit={(input) => {
          createTask(input);
          setFollowUpOpen(false);
          toast({ title: "Follow-up scheduled", message: "A task was added to the Planner.", tone: "success" });
        }}
      />

      <p className="pb-2 text-center text-[11px] text-foreground-400">
        Signed in as {currentUser.name} · Demonstration data only
      </p>
    </div>
  );
}
