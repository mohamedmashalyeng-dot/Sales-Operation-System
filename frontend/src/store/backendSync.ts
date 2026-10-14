import { EMAIL_LABELS } from "@/config/crm";
import { CURRENT_SCHEMA_VERSION } from "@/store/migrations";
import { createSeedState } from "@/store/seed";
import type {
  Application,
  ApplicationDoc,
  ApplicationStatus,
  Call,
  CollegeEvent,
  EmailMessage,
  EmailThread,
  IntegrationStatus,
  Lead,
  LeadStage,
  Meeting,
  Notification,
  Priority,
  RegOutcome,
  Task,
  TaskSource,
  User,
  WorkspaceState,
} from "@/store/types";

type AnyRecord = Record<string, any>;

export interface BackendWorkspaceResult {
  state: WorkspaceState;
  loadedAt: string;
  integrationOverview: BackendIntegrationOverview | null;
}

export interface BackendIntegrationSummary {
  id: string;
  name: string;
  configured?: boolean;
  connected?: boolean;
  health?: "healthy" | "warning" | "error" | "disconnected" | "unknown";
  sync_status?: "idle" | "queued" | "running" | "completed" | "failed" | "retrying";
  last_success_at?: string | null;
  last_attempt_at?: string | null;
  last_error_summary?: string | null;
  records_processed?: number;
  records_stored?: number;
  current_sync_processed?: number;
  current_sync_inserted?: number;
  current_sync_updated?: number;
  current_sync_unchanged?: number;
  needs_reconnect?: boolean;
  reconnect_url?: string | null;
  detail?: string | Record<string, unknown> | null;
}

export interface BackendIntegrationOverview {
  generated_at?: string;
  integrations: BackendIntegrationSummary[];
}

export type BackendWorkspaceSection =
  | "leads"
  | "tasks"
  | "applications"
  | "events"
  | "meetings"
  | "calls";

interface BackendWorkspaceLoadOptions {
  throwOnFailure?: boolean;
  fast?: boolean;
  sections?: BackendWorkspaceSection[];
}

interface BackendPage<T = AnyRecord> {
  items?: T[];
  leads?: T[];
  tasks?: T[];
  applications?: T[];
  events?: T[];
  calls?: T[];
  has_more?: boolean;
  hasMore?: boolean;
  next_cursor?: string;
  nextCursor?: string;
  next_offset?: number;
}

export class BackendAuthRequiredError extends Error {
  constructor() {
    super("AUTH_REQUIRED");
    this.name = "BackendAuthRequiredError";
  }
}

export class BackendRequestTimeoutError extends Error {
  constructor(path: string) {
    super(`Backend is taking too long to respond (${path}). Check the database connection, then try again.`);
    this.name = "BackendRequestTimeoutError";
  }
}

export function isBackendAuthRequiredError(error: unknown): boolean {
  return error instanceof BackendAuthRequiredError;
}

const BACKEND_REQUEST_TIMEOUT_MS = 15000;

function backendAbortError(path: string): BackendRequestTimeoutError {
  return new BackendRequestTimeoutError(path);
}

async function api<T>(path: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? BACKEND_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(path, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401) throw new BackendAuthRequiredError();
    if (!response.ok) throw new Error(`Backend request failed: ${path}`);
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw backendAbortError(path);
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function fetchBackendPage<T = AnyRecord>(path: string): Promise<BackendPage<T>> {
  return api<BackendPage<T>>(path);
}

const INTEGRATION_OVERVIEW_TIMEOUT_MS = 8000;
const EVENT_DETAIL_PREFETCH_LIMIT = 8;
const EVENT_DETAIL_PREFETCH_TIMEOUT_MS = 4000;
let integrationOverviewRequest: Promise<BackendIntegrationOverview> | null = null;
let integrationOverviewCache: BackendIntegrationOverview | null = null;

export function clearBackendIntegrationOverviewCache(): void {
  integrationOverviewCache = null;
}

export function loadBackendIntegrationOverview(options: { force?: boolean } = {}): Promise<BackendIntegrationOverview> {
  if (!options.force && integrationOverviewCache) return Promise.resolve(integrationOverviewCache);
  if (integrationOverviewRequest) return integrationOverviewRequest;
  integrationOverviewRequest = api<BackendIntegrationOverview>("/api/integrations/overview", {
    timeoutMs: INTEGRATION_OVERVIEW_TIMEOUT_MS,
  }).then((overview) => {
    integrationOverviewCache = overview;
    return overview;
  }).finally(() => {
    integrationOverviewRequest = null;
  });
  return integrationOverviewRequest;
}

function arr<T = AnyRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function txt(...values: unknown[]): string {
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (next) return next;
  }
  return "";
}

function visibleTxt(...values: unknown[]): string {
  for (const value of values) {
    const next = String(value ?? "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();
    if (next) return next;
  }
  return "";
}

function toIso(...values: unknown[]): string {
  for (const value of values) {
    const raw = txt(value);
    if (!raw) continue;
    const time = new Date(raw).getTime();
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return new Date().toISOString();
}

function emailLocalPartName(email: unknown): string {
  const local = txt(email).split("@")[0] || "";
  const cleaned = local.replace(/[._-]+/g, " ").replace(/\d+/g, " ").trim();
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function leadDisplayName(lead: AnyRecord | undefined): string {
  if (!lead) return "";
  return txt(
    lead.contactName,
    lead.contact_name,
    [lead.first_name, lead.last_name].filter(Boolean).join(" "),
    lead.name,
    lead.email,
  );
}

function emailContactName(thread: AnyRecord, users: User[]): string {
  const explicit = txt(
    thread.senderName,
    thread.sender_name,
    thread.from_name,
    thread.name,
    thread.contact_name,
    [thread.first_name, thread.last_name].filter(Boolean).join(" "),
  );
  if (explicit && !explicit.includes("@")) return explicit;
  const address = txt(thread.senderEmail, thread.sender_email, thread.from_email, thread.email, thread.from);
  const user = users.find((item) => item.email.toLowerCase() === address.toLowerCase());
  return txt(user?.name, explicit, emailLocalPartName(address), address, "Sender");
}

function toPriority(value: unknown): Priority {
  const raw = txt(value).toLowerCase();
  if (raw === "high") return "High";
  if (raw === "low") return "Low";
  return "Medium";
}

function toLeadStage(value: unknown): LeadStage {
  const raw = txt(value).toLowerCase();
  if (raw.includes("lost") || raw.includes("not eligible")) return "Lost";
  if (raw.includes("won") || raw.includes("enrolled")) return "Won";
  if (raw.includes("proposal") || raw.includes("offer")) return "Proposal sent";
  if (raw.includes("qualified") || raw.includes("ready") || raw.includes("application")) return "Qualified";
  if (raw.includes("contact")) return "Contacted";
  if (raw.includes("nurture")) return "Nurture";
  return "New";
}

function toApplicationStatus(value: unknown): ApplicationStatus {
  const raw = txt(value).toLowerCase();
  if (raw.includes("enrolled")) return "Enrolled";
  if (raw.includes("reject") || raw.includes("not eligible")) return "Rejected";
  if (raw.includes("withdraw")) return "Withdrawn";
  if (raw.includes("offer") || raw.includes("eligible")) return "Offer";
  if (raw.includes("interview")) return "Interview";
  if (raw.includes("review") || raw.includes("missing") || raw.includes("pending")) return "Under review";
  return "Submitted";
}

function toTaskSource(value: unknown): TaskSource {
  const raw = txt(value).toLowerCase();
  if (raw.includes("gmail") || raw.includes("inbox") || raw.includes("email")) return "Gmail / Inbox";
  if (raw.includes("event")) return "Events";
  if (raw.includes("zoom")) return "Zoom";
  if (raw.includes("application")) return "Applications";
  if (raw.includes("zoho")) return "Zoho CRM";
  return "Manual";
}

function mapUser(user: AnyRecord, index: number): User {
  return {
    id: txt(user.id, `backend-user-${index + 1}`),
    name: txt(user.name, user.email, "Workspace user"),
    email: txt(user.email),
    role: txt(user.role, "member"),
    team: txt(user.team, "Kent Business College"),
  };
}

function backendRoleId(user: AnyRecord, permissions: AnyRecord): WorkspaceState["roleId"] {
  if (permissions?.admin || txt(user.role).toLowerCase().includes("admin")) return "admin";
  return "manager";
}

function mapLeadIntake(lead: AnyRecord): string {
  return txt(
    lead.intake,
    lead.intake_name,
    lead.intakeName,
    lead.intake_label,
    lead.intakeLabel,
    lead.preferred_intake,
    lead.preferredIntake,
    lead.current_intake,
    lead.currentIntake,
    lead.data?.intake,
    lead.data?.intake_name,
    lead.data?.intakeName,
    lead.data?.preferred_intake,
    lead.data?.preferredIntake,
    lead.intake_id,
    lead.intakeId,
    lead.data?.intake_id,
    lead.data?.intakeId,
    "Unassigned intake",
  );
}

function mapLead(lead: AnyRecord, users: User[]): Lead {
  const id = txt(lead.id, lead.lead_id, crypto.randomUUID());
  const first = txt(lead.first_name);
  const last = txt(lead.last_name);
  const name = txt(lead.name, [first, last].filter(Boolean).join(" "), lead.contact_name, lead.email, id);
  const ownerId = txt(lead.owner_id, users[0]?.id);
  const createdAt = toIso(lead.created_at, lead.createdAt);
  const source = txt(lead.source_first_touch, lead.source_lead_capture, lead.source, "Website");
  return {
    id,
    name,
    contactName: txt(lead.contact_name, name),
    email: txt(lead.email),
    phone: txt(lead.phone),
    programme: txt(lead.programme, lead.programme_name, "Programme not identified"),
    intake: mapLeadIntake(lead),
    source,
    ownerId,
    stage: toLeadStage(lead.stage),
    priority: toPriority(lead.priority),
    value: Number(lead.value || lead.estimated_value || 0),
    createdAt,
    lastContactAt: toIso(lead.last_contact_at, lead.updated_at, createdAt),
    nextAction: txt(lead.next_action, lead.nextAction, "Follow up"),
    nextActionAt: toIso(lead.next_action_at, lead.due_at, createdAt),
    tags: arr<string>(lead.tags),
    zohoSynced: Boolean(lead.zoho_id || lead.zohoSynced),
    zohoId: txt(lead.zoho_id, lead.zohoId) || undefined,
    notes: arr(lead.notes).map((note, index) => ({
      id: txt(note.id, `${id}-note-${index}`),
      body: txt(note.body, note.note),
      authorId: txt(note.author_id, ownerId),
      createdAt: toIso(note.created_at, createdAt),
    })),
    applicationIds: arr<string>(lead.application_ids),
    channel: txt(lead.channel, lead.source_channel, "Direct"),
    platform: txt(lead.platform, "Workspace"),
    campaign: txt(lead.campaign) || undefined,
    campaignId: txt(lead.campaign_id) || undefined,
    utmSource: txt(lead.utm_source) || undefined,
    utmMedium: txt(lead.utm_medium) || undefined,
    utmCampaign: txt(lead.utm_campaign) || undefined,
    acquisitionDate: toIso(lead.acquisition_date, createdAt),
    originalOwnerId: txt(lead.original_owner_id, ownerId),
  };
}

function mapTask(task: AnyRecord, users: User[]): Task {
  const id = txt(task.id, crypto.randomUUID());
  const dueAt = toIso(task.due_at, task.dueAt);
  const status = txt(task.status).toLowerCase();
  return {
    id,
    title: txt(task.title, task.kind, "Follow-up"),
    description: txt(task.description, task.note, task.notes),
    ownerId: txt(task.owner_id, users[0]?.id),
    priority: toPriority(task.priority),
    dueAt,
    source: toTaskSource(task.source || task.kind),
    status: status === "done" || status === "completed" ? "completed" : "open",
    completedAt: txt(task.completed_at) ? toIso(task.completed_at) : undefined,
    relatedLeadId: txt(task.lead_id) || undefined,
    relatedThreadId: txt(task.email_id, task.thread_id) || undefined,
    relatedEventId: txt(task.event_id) || undefined,
    relatedCallId: txt(task.call_id) || undefined,
    programme: txt(task.programme) || undefined,
    notes: txt(task.notes, task.note),
    createdAt: toIso(task.created_at, dueAt),
  };
}

function mapDoc(req: AnyRecord, index: number): ApplicationDoc {
  const latest = req.latest || {};
  const status = txt(latest.status, req.status).toLowerCase();
  return {
    id: txt(req.id, latest.id, `doc-${index}`),
    name: txt(req.title, req.name, latest.filename, "Document"),
    type: txt(req.type, req.kind, "Evidence"),
    status: status === "pending" ? "Pending" : status === "verified" ? "Verified" : "Received",
  };
}

function mapApplication(app: AnyRecord, users: User[]): Application {
  const id = txt(app.id, crypto.randomUUID());
  const first = txt(app.first_name);
  const last = txt(app.last_name);
  const ownerId = txt(app.owner_id, app.manager_id, users[0]?.id);
  const createdAt = toIso(app.created_at, app.submitted_at);
  return {
    id,
    applicantName: txt(app.applicantName, app.applicant_name, [first, last].filter(Boolean).join(" "), app.member, id),
    email: txt(app.email),
    phone: txt(app.phone),
    programme: txt(app.programme, "Programme not identified"),
    intake: txt(app.intake, app.intake_name, app.intake_id, "Unassigned intake"),
    status: toApplicationStatus(app.status),
    ownerId,
    submittedAt: createdAt,
    updateAt: toIso(app.updated_at, createdAt),
    leadId: txt(app.lead_id) || undefined,
    documents: arr(app.requirements).map(mapDoc),
    notes: txt(app.notes, app.note),
    history: arr(app.history).map((item, index) => ({
      id: txt(item.id, `${id}-history-${index}`),
      status: toApplicationStatus(item.status),
      at: toIso(item.at, item.created_at, createdAt),
      byId: txt(item.by_id, item.actor_id, ownerId),
      note: txt(item.note, item.action),
    })),
  };
}

function mapEmail(thread: AnyRecord, users: User[], leads: Lead[]): EmailThread {
  const id = txt(thread.id, crypto.randomUUID());
  const receivedAt = toIso(thread.received_at, thread.created_at);
  const response = txt(thread.response_state).toLowerCase();
  const relatedLeadId = txt(thread.lead_id, thread.relatedLeadId) || undefined;
  const relatedLead = relatedLeadId ? leads.find((lead) => lead.id === relatedLeadId) : undefined;
  const senderEmail = txt(thread.senderEmail, thread.sender_email, thread.from_email, thread.email, thread.from);
  const senderName = txt(leadDisplayName(relatedLead), emailContactName(thread, users));
  const ownerId = txt(thread.owner_id, thread.owner, users[0]?.id) || null;
  const body = visibleTxt(thread.body, thread.preview, thread.snippet);
  const existingMessages: EmailMessage[] = arr(thread.messages).map((message, index) => ({
    id: txt(message.id, `${id}-message-${index}`),
    direction: txt(message.direction).toLowerCase() === "outbound" ? "outbound" : "inbound",
    fromName: txt(message.from_name, message.fromName, message.direction === "outbound" ? users.find((u) => u.id === ownerId)?.name : senderName),
    fromEmail: txt(message.from_email, message.fromEmail, message.direction === "outbound" ? users.find((u) => u.id === ownerId)?.email : senderEmail),
    toEmail: txt(message.to_email, message.toEmail, message.direction === "outbound" ? senderEmail : users.find((u) => u.id === ownerId)?.email),
    body: visibleTxt(message.body, message.text, message.preview, message.snippet, body),
    sentAt: toIso(message.sent_at, message.created_at, receivedAt),
    authorId: txt(message.author_id, message.direction === "outbound" ? ownerId : "") || undefined,
  }));
  const baseMessages = existingMessages.length
    ? existingMessages
    : [
        {
          id: txt(thread.gmail_message_id, `${id}-inbound`),
          direction: txt(thread.direction).toLowerCase() === "outbound" ? "outbound" as const : "inbound" as const,
          fromName: txt(thread.direction).toLowerCase() === "outbound" ? txt(users.find((u) => u.id === ownerId)?.name, "Workspace") : senderName,
          fromEmail: txt(thread.direction).toLowerCase() === "outbound" ? txt(users.find((u) => u.id === ownerId)?.email) : senderEmail,
          toEmail: txt(thread.direction).toLowerCase() === "outbound" ? senderEmail : txt(users.find((u) => u.id === ownerId)?.email),
          body,
          sentAt: receivedAt,
          authorId: txt(thread.direction).toLowerCase() === "outbound" ? ownerId || undefined : undefined,
        },
      ];
  const responseNote = txt(thread.response_note);
  const responseAt = txt(thread.response_at);
  const replyAuthor = users.find((u) => u.id === ownerId) ?? users[0];
  const messages = responseNote
    ? [
        ...baseMessages,
        {
          id: `${id}-reply`,
          direction: "outbound" as const,
          fromName: txt(replyAuthor?.name, "Workspace"),
          fromEmail: txt(replyAuthor?.email),
          toEmail: senderEmail,
          body: responseNote,
          sentAt: toIso(responseAt, receivedAt),
          authorId: replyAuthor?.id,
        },
      ]
    : baseMessages;
  return {
    id,
    subject: txt(thread.subject, "Email thread"),
    senderName,
    senderEmail,
    preview: visibleTxt(thread.preview, thread.snippet, thread.body).slice(0, 180),
    labelIds: arr<string>(thread.label_ids),
    ownerId,
    readState: thread.is_read === false || txt(thread.read_state).toLowerCase() === "unread" ? "unread" : "read",
    responseState: response.includes("resolved") ? "resolved" : response.includes("replied") || responseAt ? "replied" : "unanswered",
    receivedAt,
    slaHours: Number(thread.sla_hours || 48),
    deadlineAt: toIso(thread.deadline_at, new Date(new Date(receivedAt).getTime() + 48 * 3600000).toISOString()),
    resolvedAt: txt(thread.resolved_at) ? toIso(thread.resolved_at) : undefined,
    externalResponseAt: txt(thread.external_response_at) ? toIso(thread.external_response_at) : undefined,
    starred: Boolean(thread.starred),
    important: Boolean(thread.important),
    trashed: Boolean(thread.trashed),
    relatedLeadId,
    messages,
  };
}

export function mapBackendEmailThread(thread: AnyRecord, users: User[], leads: Lead[] = []): EmailThread {
  return mapEmail(thread, users, leads);
}

function mapEvent(event: AnyRecord): CollegeEvent {
  const eventId = txt(event.id, crypto.randomUUID());
  const startAt = toIso(event.start_at, event.startAt);
  const eventSource = txt(
    event.source,
    event.campaign,
    event.eventbrite_event_id ? "Eventbrite" : "",
    event.zoom_meeting_id || event.zoom_meeting_uuid ? "Zoom" : "",
  ).toLowerCase();
  const status = txt(event.status).toLowerCase();
  return {
    id: eventId,
    name: txt(event.name, event.title, "Event"),
    startAt,
    endAt: toIso(event.end_at, event.endAt, startAt),
    source: eventSource.includes("zoom") ? "Zoom" : eventSource.includes("eventbrite") ? "Eventbrite" : "Manual",
    status: status.includes("live")
      ? "live"
      : status.includes("complete") || new Date(startAt).getTime() < Date.now()
        ? "completed"
        : "upcoming",
    location: txt(event.location, event.venue, "Online"),
    meetingLink: txt(event.meeting_link, event.zoom_link, event.join_url) || undefined,
    description: txt(event.description),
    eventbriteRef: txt(event.eventbrite_event_id) || undefined,
    zoomMeetingId: txt(event.zoom_meeting_id) || undefined,
    campaignId: txt(event.campaign_id) || undefined,
    registrations: arr(event.attendees).map((attendee, index) => {
      const outcome = txt(attendee.outcome, attendee.status).toLowerCase();
      const attendedAt = txt(attendee.attended_at, attendee.checked_in_at);
      const isDeclined = /declined|cancel|no show|absent/.test(outcome);
      const isConfirmed = /confirm|registered|approved|active/.test(outcome);
      return {
        id: txt(attendee.id, `${eventId}-attendee-${index}`),
        name: txt(attendee.name, [attendee.first_name, attendee.last_name].filter(Boolean).join(" "), attendee.email, "Attendee"),
        email: txt(attendee.email),
        phone: txt(attendee.phone),
        programme: txt(attendee.programme, event.programme, "Programme not identified"),
        outcome: (attendedAt
          ? "attended"
          : isDeclined
            ? outcome.includes("no show") ? "no-show" : "declined"
            : isConfirmed
              ? "confirmed"
              : ["confirmed", "declined", "pending", "attended", "no-show"].includes(outcome)
                ? outcome
                : "pending") as RegOutcome,
        registeredAt: toIso(attendee.registered_at, event.created_at),
        callbackAt: txt(attendee.callback_at) ? toIso(attendee.callback_at) : undefined,
        notes: txt(attendee.notes),
      };
    }),
  };
}

async function mapEventsWithDetails(events: AnyRecord[], options: { prefetchDetails?: boolean } = {}): Promise<CollegeEvent[]> {
  const prefetchLimit = options.prefetchDetails ? EVENT_DETAIL_PREFETCH_LIMIT : 0;
  const prefetchedEvents = events.slice(0, prefetchLimit);
  const remainingEvents = events.slice(prefetchLimit);
  const detailed: AnyRecord[] = [];
  for (let index = 0; index < prefetchedEvents.length; index += 8) {
    const batch = prefetchedEvents.slice(index, index + 8);
    const results = await Promise.all(
      batch.map(async (event) => {
        try {
          const detail = await api<{ event?: AnyRecord }>(`/api/events/${encodeURIComponent(txt(event.id))}`, {
            timeoutMs: EVENT_DETAIL_PREFETCH_TIMEOUT_MS,
          });
          return detail.event || event;
        } catch {
          return event;
        }
      }),
    );
    detailed.push(...results);
  }
  return [...detailed, ...remainingEvents].map(mapEvent);
}

function mapMeeting(meeting: AnyRecord, users: User[]): Meeting {
  const startAt = toIso(meeting.start_at, meeting.startAt);
  return {
    id: txt(meeting.id, meeting.zoom_meeting_id, meeting.zoom_meeting_uuid, crypto.randomUUID()),
    topic: txt(meeting.topic, meeting.name, "Meeting"),
    hostId: txt(meeting.host_id, meeting.zoom_host_id, users[0]?.id),
    account: txt(meeting.account, meeting.zoom_account_label, meeting.zoom_account_id, "Zoom"),
    startAt,
    durationMins: Number(meeting.duration_mins || meeting.duration || 30),
    joinUrl: txt(meeting.join_url, meeting.zoom_link, meeting.meeting_link) || undefined,
    relatedEventId: txt(meeting.related_event_id, meeting.event_id, meeting.id) || undefined,
    status: txt(meeting.status).toLowerCase().includes("past") || new Date(startAt).getTime() < Date.now()
      ? "completed"
      : "scheduled",
    participants: Number(meeting.participants || meeting.attendee_count || 0),
    zoomMeetingId: txt(meeting.zoom_meeting_id) || undefined,
    attendanceRecorded: Number(meeting.attendee_count || meeting.participants || 0) > 0,
  };
}

function mapCall(call: AnyRecord, users: User[]): Call {
  const direction = txt(call.direction).toLowerCase();
  const result = txt(call.result, call.status).toLowerCase();
  const caller = txt(call.caller_name, call.caller_number, "Unknown caller");
  const receiver = txt(call.callee_name, call.callee_number, "Unknown receiver");
  const phoneNumber = txt(call.matched_number, call.direction?.includes?.("out") ? call.callee_number : call.caller_number, call.caller_number, call.callee_number);
  return {
    id: txt(call.id, crypto.randomUUID()),
    direction: direction.includes("out") ? "outgoing" : "incoming",
    status: result.includes("voice")
      ? "voicemail"
      : result.includes("answer") || result.includes("connected") || Number(call.duration || call.duration_sec || 0) > 0
        ? "answered"
        : "no-answer",
    durationSec: Number(call.duration_sec || call.duration || 0),
    caller,
    receiver,
    phoneNumber,
    leadId: txt(call.lead_id) || undefined,
    occurredAt: toIso(call.occurred_at, call.started_at, call.created_at),
    notes: txt(call.notes, call.source_detail, call.path),
    matchConfidence: call.lead_id ? "verified" : "none",
    platform: "Zoom Phone",
    salesOwnerId: txt(call.sales_owner_id, call.owner_id, users[0]?.id) || undefined,
  };
}

function mapNotification(item: AnyRecord): Notification {
  const type = txt(item.type, item.module).toLowerCase();
  return {
    id: txt(item.id, crypto.randomUUID()),
    title: txt(item.title, "Notification"),
    message: txt(item.message, item.detail),
    module: txt(item.module, type.includes("integration") ? "Integrations" : "Workspace"),
    createdAt: toIso(item.created_at, item.createdAt),
    read: Boolean(item.read_at || item.read),
    tone: type.includes("fail") || type.includes("overdue") ? "danger" : "primary",
  };
}

const INTEGRATION_META: Record<string, { label: string; icon: string }> = {
  gmail: { label: "Gmail", icon: "ri-mail-line" },
  zoom: { label: "Zoom", icon: "ri-vidicon-line" },
  zoho: { label: "Zoho CRM", icon: "ri-cloud-line" },
  eventbrite: { label: "Eventbrite", icon: "ri-calendar-event-line" },
};

function integrationKey(name: unknown): string {
  const raw = txt(name).toLowerCase();
  if (raw.includes("gmail")) return "gmail";
  if (raw.includes("zoom")) return "zoom";
  if (raw.includes("zoho")) return "zoho";
  if (raw.includes("eventbrite")) return "eventbrite";
  return raw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "integration";
}

function integrationTone(status: unknown): IntegrationStatus["status"] {
  const raw = txt(status).toLowerCase();
  if (raw.includes("connected") || raw.includes("healthy")) return "connected";
  if (raw.includes("ready") || raw.includes("reconnect") || raw.includes("warning") || raw.includes("error") || raw.includes("unknown")) return "attention";
  return "disconnected";
}

function mapIntegrationStatuses(bootstrap: AnyRecord): IntegrationStatus[] {
  const rows = arr<AnyRecord>(bootstrap.integrations);
  return ["gmail", "zoom", "zoho", "eventbrite"].map((key) => {
    const source = rows.find((item) => integrationKey(item.name || item.key || item.id) === key) || {};
    const meta = INTEGRATION_META[key];
    const status = integrationTone(source.status);
    const fallback =
      status === "connected"
        ? `${meta.label} is connected.`
        : status === "attention"
          ? `${meta.label} needs setup or attention.`
          : `${meta.label} is not connected.`;
    return {
      key,
      label: meta.label,
      icon: meta.icon,
      status,
      detail: txt(source.detail, source.message, fallback),
    };
  });
}

function pageItems<T = AnyRecord>(page: BackendPage<T>): T[] {
  for (const rows of [page.items, page.leads, page.tasks, page.applications, page.events, page.calls]) {
    const list = arr<T>(rows);
    if (list.length) return list;
  }
  return [];
}

async function loadBackendLeads(users: User[], options: { fast?: boolean } = {}): Promise<Lead[]> {
  const page = await api<BackendPage>(`/api/leads?limit=${options.fast ? 50 : 200}&include_total=true`);
  return pageItems(page).map((lead) => mapLead(lead, users));
}

async function loadBackendTasks(users: User[], options: { fast?: boolean } = {}): Promise<Task[]> {
  const page = await api<BackendPage>(`/api/tasks?status=all&limit=${options.fast ? 50 : 200}&include_counts=true`);
  return pageItems(page).map((task) => mapTask(task, users));
}

async function loadBackendApplications(users: User[], options: { fast?: boolean } = {}): Promise<Application[]> {
  const page = await api<BackendPage>(`/api/applications?limit=${options.fast ? 50 : 200}`);
  return pageItems(page).map((application) => mapApplication(application, users));
}

async function loadBackendEvents(options: { fast?: boolean } = {}): Promise<CollegeEvent[]> {
  const events: AnyRecord[] = [];
  let cursor = "";
  const maxPages = options.fast ? 1 : 20;
  const limit = options.fast ? 50 : 100;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await fetchBackendPage(`/api/events?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    const rows = pageItems(page);
    events.push(...rows);
    cursor = txt(page.next_cursor, page.nextCursor);
    if (!(page.has_more || page.hasMore) || !cursor) break;
  }
  return mapEventsWithDetails(events, { prefetchDetails: !options.fast });
}

async function loadBackendMeetings(users: User[], options: { fast?: boolean } = {}): Promise<Meeting[]> {
  const meetings: AnyRecord[] = [];
  let cursor = "";
  const maxPages = options.fast ? 1 : 10;
  const limit = options.fast ? 50 : 200;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await api<BackendPage>(`/api/meetings?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    meetings.push(...pageItems(page));
    cursor = txt(page.next_cursor, page.nextCursor);
    if (!(page.has_more || page.hasMore) || !cursor) break;
  }
  return meetings.map((meeting) => mapMeeting(meeting, users));
}

async function loadBackendCalls(users: User[], options: { fast?: boolean } = {}): Promise<Call[]> {
  const calls: AnyRecord[] = [];
  let offset = 0;
  const maxPages = options.fast ? 1 : 10;
  const limit = options.fast ? 50 : 100;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await api<BackendPage>(`/api/zoom/calls?limit=${limit}&offset=${offset}`);
    const rows = pageItems(page);
    calls.push(...rows);
    offset = Number(page.next_offset || offset + rows.length);
    if (!page.has_more || !rows.length) break;
  }
  return calls.map((call) => mapCall(call, users));
}

async function loadWorkspaceSection<T>(
  label: string,
  loader: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await loader();
  } catch (error) {
    if (isBackendAuthRequiredError(error)) throw error;
    console.warn(`[backend-sync] ${label} load failed; continuing with an empty section.`, error);
    return [];
  }
}

function shouldLoadSection(options: BackendWorkspaceLoadOptions, section: BackendWorkspaceSection): boolean {
  return !options.sections || options.sections.includes(section);
}

export async function loadBackendWorkspace(options: BackendWorkspaceLoadOptions = {}): Promise<BackendWorkspaceResult | null> {
  try {
    const bootstrap = await api<AnyRecord>("/api/bootstrap");
    const seed = createSeedState();
    const users = (
      arr<AnyRecord>(bootstrap.owners).length ? arr<AnyRecord>(bootstrap.owners) : [bootstrap.user]
    ).map(mapUser);
    const workspaceUsers = users.length ? users : seed.users;
    const [leads, tasks, applications, events, meetings, calls] = await Promise.all([
      shouldLoadSection(options, "leads")
        ? loadWorkspaceSection("Leads", () => loadBackendLeads(workspaceUsers, { fast: options.fast }))
        : Promise.resolve([]),
      shouldLoadSection(options, "tasks")
        ? loadWorkspaceSection("Tasks", () => loadBackendTasks(workspaceUsers, { fast: options.fast }))
        : Promise.resolve([]),
      shouldLoadSection(options, "applications")
        ? loadWorkspaceSection("Applications", () => loadBackendApplications(workspaceUsers, { fast: options.fast }))
        : Promise.resolve([]),
      shouldLoadSection(options, "events")
        ? loadWorkspaceSection("Events", () => loadBackendEvents({ fast: options.fast }))
        : Promise.resolve([]),
      shouldLoadSection(options, "meetings")
        ? loadWorkspaceSection("Meetings", () => loadBackendMeetings(workspaceUsers, { fast: options.fast }))
        : Promise.resolve([]),
      shouldLoadSection(options, "calls")
        ? loadWorkspaceSection("Calls", () => loadBackendCalls(workspaceUsers, { fast: options.fast }))
        : Promise.resolve([]),
    ]);

    const state: WorkspaceState = {
      ...seed,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      roleId: backendRoleId(bootstrap.user || {}, bootstrap.permissions || {}),
      users: workspaceUsers,
      leads,
      touchpoints: [],
      futureIntakes: [],
      commercialOpportunities: [],
      employerAgreements: [],
      dasRecords: [],
      threads: [],
      labels: EMAIL_LABELS,
      tasks,
      events,
      campaigns: [],
      applications,
      meetings,
      calls,
      activity: [],
      notifications: [],
      audit: [],
      integrationStatuses: mapIntegrationStatuses(bootstrap),
    };
    return { state, loadedAt: new Date().toISOString(), integrationOverview: null };
  } catch (error) {
    if (isBackendAuthRequiredError(error)) throw error;
    if (options.throwOnFailure) throw error;
    console.warn("[backend-sync] Backend workspace load failed; using empty local workspace.", error);
    return null;
  }
}
