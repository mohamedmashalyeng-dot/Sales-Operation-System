import { EMAIL_LABELS } from "@/config/crm";
import { CURRENT_SCHEMA_VERSION } from "@/store/migrations";
import { eventPhase, recordedAttendance } from "@/utils/eventAttendance";
import { createSeedState } from "@/store/seed";
import type {
  Application,
  ApplicationDoc,
  ApplicationStatus,
  Call,
  CollegeEvent,
  ActivityEntry,
  CommercialOpportunity,
  EmployerAgreement,
  DasRecord,
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
  currentUserId?: string;
  integrationOverview: BackendIntegrationOverview | null;
}

export interface BackendLeadPageOptions {
  cursor?: string;
  limit?: number;
  search?: string;
  stage?: string;
  ownerId?: string;
  programmeId?: string;
  source?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: "created_at" | "name";
  dir?: "asc" | "desc";
  includeTotal?: boolean;
}

export interface BackendLeadPageResult {
  leads: Lead[];
  total: number | null;
  nextCursor: string;
  hasMore: boolean;
  limit: number;
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
  | "calls"
  | "emails"
  | "activity";

interface BackendWorkspaceLoadOptions {
  throwOnFailure?: boolean;
  fast?: boolean;
  sections?: BackendWorkspaceSection[];
}

interface BackendPage<T = AnyRecord> {
  source?: string | null;
  call_provenance_version?: number | null;
  items?: T[];
  leads?: T[];
  tasks?: T[];
  applications?: T[];
  events?: T[];
  calls?: T[];
  emails?: T[];
  activity?: T[];
  has_more?: boolean;
  hasMore?: boolean;
  next_cursor?: string;
  nextCursor?: string;
  next_offset?: number;
  total?: number | null;
  total_count?: number | null;
  limit?: number;
}

export class BackendAuthRequiredError extends Error {
  constructor() {
    super("AUTH_REQUIRED");
    this.name = "BackendAuthRequiredError";
  }
}

export class BackendRequestError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string) {
    super(status >= 500 ? `The server could not load this data (HTTP ${status}). Please retry.`
      : status === 403 ? 'You do not have permission to view this data.'
      : status === 404 ? 'The requested data is not available.' : `The request failed (HTTP ${status}). Please retry.`);
    this.name = "BackendRequestError";
    this.status = status;
    this.path = path;
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

const BACKEND_REQUEST_TIMEOUT_MS = 45000;
const BACKEND_BOOTSTRAP_TIMEOUT_MS = 60000;

function backendAbortError(path: string): BackendRequestTimeoutError {
  return new BackendRequestTimeoutError(path);
}

async function api<T>(path: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? BACKEND_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    options.signal?.throwIfAborted();
    const response = await fetch(path, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401) {
      window.dispatchEvent(new Event("kbc:session-expired"));
      throw new BackendAuthRequiredError();
    }
    if (!response.ok) throw new BackendRequestError(response.status, path);
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

export async function loadBackendToday<T>(params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const data = await api<T & { totals?: object; daily?: unknown[]; priority?: unknown[]; options?: object }>(`/api/dashboard/today?${params}`, { signal });
  if (!data.totals || !Array.isArray(data.daily) || !Array.isArray(data.priority) || !data.options) throw new Error("Today response is incomplete.");
  return data;
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
  if (raw === "call_analysis") return "Call analysis";
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
  if (permissions?.developer || permissions?.admin) return "admin";
  if (/^(enrolment|enrollment|staff[ _](enrolment|enrollment))$/i.test(txt(user.role))) return "enrolment";
  return permissions.review ? "manager" : "sales";
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

function mapEligibility(lead: AnyRecord): Lead["eligibility"] {
  const eligibility = lead.eligibility;
  if (!eligibility || typeof eligibility !== "object") return undefined;
  const status = txt(eligibility.status, eligibility.decision, "Not Assessed") as NonNullable<Lead["eligibility"]>["status"];
  const recommendation = eligibility.aiRecommendation;
  const strings = (value: unknown): string[] => arr<unknown>(value).filter((item): item is string => typeof item === "string");
  return {
    status,
    responses: arr(eligibility.responses),
    decision: eligibility.decision === "Verified Eligible" || eligibility.decision === "Not Eligible for Funding"
      ? eligibility.decision
      : undefined,
    verificationDate: txt(eligibility.verificationDate, eligibility.verification_date) || undefined,
    decisionMakerId: txt(eligibility.decisionMakerId, eligibility.decision_maker_id) || undefined,
    decisionReasons: txt(eligibility.decisionReasons, eligibility.decision_reasons) || undefined,
    aiRecommendation: recommendation && typeof recommendation === "object" ? {
      status: txt(recommendation.status, "Information Required") as NonNullable<Lead["eligibility"]>["status"],
      confidence: typeof recommendation.confidence === "number" && Number.isFinite(recommendation.confidence)
        ? Math.max(0, Math.min(1, recommendation.confidence)) : 0,
      summary: txt(recommendation.summary),
      reasons: strings(recommendation.reasons),
      missing_information: strings(recommendation.missing_information),
      evidence: strings(recommendation.evidence),
      screening_checks: arr(recommendation.screening_checks).map((item) => ({
        question_id: txt(item.question_id),
        assessment: ["met", "not_met", "unknown", "review"].includes(item.assessment) ? item.assessment : "unknown",
        evidence: strings(item.evidence),
      })),
      source: txt(recommendation.source, "unknown"),
      provider_warning: txt(recommendation.provider_warning) || undefined,
      analysed_at: toIso(recommendation.analysed_at, eligibility.updatedAt, eligibility.updated_at),
    } : undefined,
    updatedAt: toIso(eligibility.updatedAt, eligibility.updated_at, eligibility.aiRecommendation?.analysed_at),
  };
}

function mapLead(lead: AnyRecord, users: User[]): Lead {
  const id = txt(lead.id, lead.lead_id, crypto.randomUUID());
  const first = txt(lead.first_name);
  const last = txt(lead.last_name);
  const name = txt(lead.name, [first, last].filter(Boolean).join(" "), lead.contact_name, lead.email, id);
  const ownerId = txt(lead.owner_id, users[0]?.id);
  const createdAt = toIso(lead.created_at, lead.createdAt);
  const source = txt(lead.source_first_touch, lead.source_lead_capture, lead.source, "Website");
  const nextActionDate = txt(lead.next_action_at, lead.nextActionAt, lead.due_at);
  return {
    id,
    name,
    contactName: txt(lead.contact_name, name),
    email: txt(lead.email),
    phone: txt(lead.phone),
    employer: txt(lead.employer),
    programme: txt(lead.programme, lead.programme_name, "Programme not identified"),
    intake: mapLeadIntake(lead),
    source,
    ownerId,
    stage: toLeadStage(lead.stage),
    journeyStage: txt(lead.stage),
    priority: toPriority(lead.priority),
    value: Number(lead.value || lead.estimated_value || 0),
    createdAt,
    lastContactAt: toIso(lead.last_contact_at, lead.updated_at, createdAt),
    nextAction: txt(lead.next_action, lead.nextAction),
    nextActionAt: nextActionDate && Number.isFinite(Date.parse(nextActionDate)) ? new Date(nextActionDate).toISOString() : "",
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
    eligibility: mapEligibility(lead),
  };
}

function mapCommercialOpportunity(item: AnyRecord, users: User[]): CommercialOpportunity {
  const now = new Date().toISOString();
  return {
    id: txt(item.id, crypto.randomUUID()),
    leadId: txt(item.leadId, item.lead_id),
    fundingEligibilityOutcome: txt(item.fundingEligibilityOutcome, item.funding_eligibility_outcome, "Not Eligible for Funding"),
    referralReason: txt(item.referralReason, item.referral_reason, "Not eligible for government funding"),
    programmeInterest: txt(item.programmeInterest, item.programme_interest, "Programme not identified"),
    suggestedProgramme: txt(item.suggestedProgramme, item.suggested_programme, "Commercial course"),
    optionType: txt(item.optionType, item.option_type, "Commercial course"),
    fundingInterest: txt(item.fundingInterest, item.funding_interest, "Self-funded"),
    budgetStatus: txt(item.budgetStatus, item.budget_status, "Not discussed"),
    quoteStatus: txt(item.quoteStatus, item.quote_status, "To prepare"),
    commercialOwnerId: txt(item.commercialOwnerId, item.commercial_owner_id, users[0]?.id),
    nextFollowUpAt: txt(item.nextFollowUpAt, item.next_follow_up_at) ? toIso(item.nextFollowUpAt, item.next_follow_up_at) : "",
    notes: txt(item.notes),
    stage: txt(item.stage, "Referred") as CommercialOpportunity["stage"],
    referredAt: toIso(item.referredAt, item.referred_at, now),
    updatedAt: toIso(item.updatedAt, item.updated_at, now),
  };
}

export interface EmployerDirectoryRow {
  leadCount?: number;
  id?: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  ownerId: string;
  leadIds: string[];
  agreementStatus: EmployerAgreement["status"];
  dasStatus: DasRecord["status"];
  followUpAt: string;
}

export interface BackendBusinessData {
  employerTotal?: number;
  employerMetrics?: { total: number; signed: number; dasConfirmed: number; attention: number };
  employers: EmployerDirectoryRow[];
  commercialOpportunities: CommercialOpportunity[];
  employerAgreements: EmployerAgreement[];
  dasRecords: DasRecord[];
  leads: Lead[];
}

export type BusinessQuery = { section?: string; limit?: number; offset?: number; search?: string; agreement?: string; das?: string };
export async function loadBackendBusiness(users: User[], signal?: AbortSignal, employerName?: string, query: BusinessQuery = {}): Promise<BackendBusinessData> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([name,value])=>{ if(value!==undefined) params.set(name,String(value)); });
  if(employerName) params.set('employer',employerName);
  const data = await api<AnyRecord>(`/api/business?${params}`, { signal });
  return {
    employerTotal: data.employerTotal,
    employerMetrics: data.employerMetrics,
    employers: arr<EmployerDirectoryRow>(data.employers),
    commercialOpportunities: arr(data.commercialOpportunities).map(item => mapCommercialOpportunity(item, users)),
    employerAgreements: arr<EmployerAgreement>(data.employerAgreements),
    dasRecords: arr<DasRecord>(data.dasRecords),
    leads: arr(data.leads).map(item => mapLead(item, users)),
  };
}

export async function loadBackendEmployerApplications(name: string, users: User[], signal?: AbortSignal): Promise<Application[]> {
  const data = await api<AnyRecord>(`/api/employers/${encodeURIComponent(name)}`, { signal });
  return arr(data.applications).map(item => mapApplication(item, users));
}

export async function saveBusinessRecord<T>(path: string, body: unknown, id?: string): Promise<T> {
  const response = await fetch(`/api/${path}${id ? `/${encodeURIComponent(id)}` : ""}`, {
    method: id ? "PATCH" : "POST", credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(BACKEND_REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401) throw new BackendAuthRequiredError();
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The record could not be saved. Please try again.");
  if (!payload.record?.id) throw new Error("The server did not return a saved record.");
  return payload.record as T;
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
    sourceEventId: txt(task.source_event_id) || undefined,
    evaluationId: txt(task.evaluation_id) || undefined,
    sourceKey: txt(task.source_key) || undefined,
    callVerified: task.call_verified === true,
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
    status: !status || status === "pending" || status === "rejected" ? "Pending" : status === "verified" ? "Verified" : "Received",
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
    enrolmentSource: app.enrolment_evidence?.source === 'gmail_label'
      ? `Gmail: ${txt(app.enrolment_evidence.label, 'Enrolled')}`
      : txt(app.enrolment_evidence?.source, app.learner?.source, 'Recorded enrolled status'),
    contractStatus: txt(app.contract?.status, 'Not recorded'),
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

export async function loadBackendApplicationPage(users: User[], params: URLSearchParams, signal?: AbortSignal) {
  const data = await api<AnyRecord>(`/api/applications?${params}`, { signal });
  return { applications: arr(data.applications).map(item => mapApplication(item, users)), total: Number(data.total || 0) };
}

export async function loadBackendApplicationDetail(id: string, users: User[], signal?: AbortSignal) {
  const data = await api<AnyRecord>(`/api/applications/${encodeURIComponent(id)}`, { signal });
  return { application: mapApplication(data.application, users), lead: data.lead ? mapLead(data.lead, users) : undefined };
}

export async function reconcileBackendEnrolledApplications(): Promise<number> {
  const response = await fetch('/api/applications/reconcile-enrolled', { method: 'POST', credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Applications could not be created.');
  return Number(data.created || 0);
}

function mapEmail(thread: AnyRecord, users: User[], leads: Lead[] | Map<string, Lead>): EmailThread {
  const id = txt(thread.id, crypto.randomUUID());
  const receivedAt = toIso(thread.received_at, thread.created_at);
  const response = txt(thread.response_state).toLowerCase();
  const relatedLeadId = txt(thread.lead_id, thread.relatedLeadId) || undefined;
  const relatedLead = relatedLeadId
    ? Array.isArray(leads)
      ? leads.find((lead) => lead.id === relatedLeadId)
      : leads.get(relatedLeadId)
    : undefined;
  const senderEmail = txt(thread.senderEmail, thread.sender_email, thread.from_email, thread.email, thread.from);
  const senderName = txt(leadDisplayName(relatedLead), emailContactName(thread, users));
  const ownerId = txt(thread.owner_id, thread.owner, users[0]?.id) || null;
  const body = visibleTxt(thread.body, thread.preview, thread.snippet);
  const existingMessages: EmailMessage[] = arr(thread.messages).map((message, index) => ({
    id: txt(message.id, `${id}-message-${index}`),
    subject: txt(message.subject, thread.subject),
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
          subject: txt(thread.subject),
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
          subject: txt(thread.subject),
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
  const startInput = txt(event.start_at, event.startAt);
  const startAt = Number.isFinite(Date.parse(startInput)) ? new Date(startInput).toISOString() : "";
  const endInput = txt(event.end_at, event.endAt);
  const duration = Number(event.duration_mins || event.duration || 0);
  const endAt = Number.isFinite(Date.parse(endInput)) ? new Date(endInput).toISOString()
    : startAt && Number.isFinite(duration) && duration > 0 ? new Date(Date.parse(startAt) + duration * 60000).toISOString() : "";
  const eventSource = txt(
    event.source,
    event.zoom_meeting_id || event.zoom_meeting_uuid ? "Zoom" : "",
    event.eventbrite_event_id ? "Eventbrite" : "",
    event.campaign,
  ).toLowerCase();
  const status = txt(event.status).toLowerCase();
  return {
    id: eventId,
    name: txt(event.name, event.title, "Event"),
    startAt,
    endAt,
    source: eventSource.includes("zoom") ? "Zoom" : eventSource.includes("eventbrite") ? "Eventbrite" : "Manual",
    // Eventbrite 'live' is a publication status; the schedule determines completion.
    status: eventPhase({ startAt, endAt, status: status === "live" ? "" : status }),
    location: txt(event.location, event.venue, "Online"),
    meetingLink: txt(event.meeting_link, event.zoom_link, event.join_url) || undefined,
    description: txt(event.description),
    eventbriteRef: txt(event.eventbrite_event_id) || undefined,
    zoomMeetingId: txt(event.zoom_meeting_id) || undefined,
    campaignId: txt(event.campaign_id) || undefined,
    registrationMetrics: event.metrics ? {
      booked: Number(event.metrics.booked || 0), confirmed: Number(event.metrics.confirmed || 0),
      attended: Number(event.metrics.attended || 0), declined: Number(event.metrics.declined || 0), pending: Number(event.metrics.pending || 0),
    } : undefined,
    registrations: arr(event.attendees).map((attendee, index) => {
      const outcome = txt(attendee.outcome, attendee.status).toLowerCase();
      const attendance = recordedAttendance(attendee);
      const isDeclined = /declined|cancel|no show|absent/.test(outcome);
      const isConfirmed = /confirm|registered|approved|active/.test(outcome);
      return {
        id: txt(attendee.id, `${eventId}-attendee-${index}`),
        name: txt(attendee.name, [attendee.first_name, attendee.last_name].filter(Boolean).join(" "), attendee.email, "Attendee"),
        email: txt(attendee.email),
        phone: txt(attendee.phone),
        programme: txt(attendee.programme, event.programme, "Programme not identified"),
        attendance,
        outcome: (attendance === "Attended"
          ? "attended"
          : attendance === "Did Not Attend" ? "no-show"
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

export async function loadBackendEventPage(params: URLSearchParams, signal?: AbortSignal) {
  const data = await api<AnyRecord>(`/api/events?${params}`, { signal });
  return { events: arr(data.items).map(mapEvent), total: data.total == null ? null : Number(data.total), nextCursor: txt(data.next_cursor, data.nextCursor) };
}

export async function loadBackendEventDetail(id: string, signal?: AbortSignal): Promise<CollegeEvent> {
  const data = await api<AnyRecord>(`/api/events/${encodeURIComponent(id)}`, { signal });
  return mapEvent(data.event);
}

export interface BackendEventPerson {
  id: string; name: string; email: string; phone: string; status: string; attendance: string;
  attended_at: string | null; registered_at: string | null; lead_id: string | null;
}

export async function loadBackendEventPeople(id: string, offset: number, signal?: AbortSignal) {
  return api<{ items: BackendEventPerson[]; total: number; has_more: boolean }>(
    `/api/events/${encodeURIComponent(id)}/people?limit=50&offset=${offset}`, { signal });
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
  const startDate = txt(meeting.start_at, meeting.startAt);
  const startAt = startDate && Number.isFinite(Date.parse(startDate)) ? new Date(startDate).toISOString() : "";
  return {
    id: txt(meeting.id, meeting.zoom_meeting_id, meeting.zoom_meeting_uuid, crypto.randomUUID()),
    topic: txt(meeting.topic, meeting.name, "Meeting"),
    hostId: txt(meeting.host_id, meeting.zoom_host_id),
    hostName: txt(meeting.zoom_host_label, meeting.host_name) || undefined,
    account: txt(meeting.account, meeting.zoom_account_label, meeting.zoom_account_id, "Zoom"),
    startAt,
    durationMins: Number(meeting.duration_mins || meeting.duration || 0),
    joinUrl: txt(meeting.join_url, meeting.zoom_link, meeting.meeting_link) || undefined,
    relatedEventId: txt(meeting.related_event_id, meeting.event_id, meeting.id) || undefined,
    status: txt(meeting.status).toLowerCase().includes("past") || new Date(startAt).getTime() < Date.now()
      ? "completed"
      : "scheduled",
    participants: Number(meeting.participants || meeting.attendee_count || 0),
    zoomMeetingId: txt(meeting.zoom_meeting_id) || undefined,
    attendanceRecorded: meeting.attendance_recorded === true,
  };
}
export function mapBackendMeeting(meeting: AnyRecord, users: User[]): Meeting { return mapMeeting(meeting, users); }

export interface BackendZoomOverview {
  metrics: { total_meetings: number; upcoming_meetings: number; meetings_today: number; calls_logged: number; missed_calls: number };
  nextMeetings: Meeting[]; recentCalls: Call[];
}
export async function loadBackendZoomOverview(users: User[], params: URLSearchParams, signal?: AbortSignal): Promise<BackendZoomOverview> {
  const data = await api<AnyRecord>(`/api/zoom/overview?${params}`, { signal });
  if (!data.metrics || !Array.isArray(data.next_meetings) || !Array.isArray(data.recent_calls)) throw new Error("Zoom overview response is incomplete.");
  return { metrics: data.metrics, nextMeetings: data.next_meetings.map(item => mapMeeting(item, users)), recentCalls: data.recent_calls.map(item => mapCall(item, users)) };
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
      : /no[ _-]?answer|not[ _-]?answer|missed|cancel|busy|failed/.test(result) ? "no-answer"
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

export function mapBackendCall(call: AnyRecord, users: User[]): Call {
  return mapCall(call, users);
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
    route: txt(item.route) || undefined,
    tone: type.includes("fail") || type.includes("overdue") ? "danger" : "primary",
  };
}

export async function loadBackendNotifications(): Promise<Notification[]> {
  const data = await api<AnyRecord>("/api/notifications?limit=50");
  return arr(data.items || data.notifications).map(mapNotification);
}
export async function loadBackendCallDetail(id: string, users: User[], signal?: AbortSignal): Promise<Call> {
  const data = await api<AnyRecord>(`/api/zoom/calls/${encodeURIComponent(id)}`, { signal });
  if (!data.call?.id) throw new Error("Call not found.");
  return mapCall(data.call, users);
}
export async function loadBackendLeadTasks(id: string, users: User[]): Promise<Task[]> {
  const data = await api<AnyRecord>(`/api/tasks?lead_id=${encodeURIComponent(id)}&status=all&limit=200`);
  return arr(data.items).map(item => mapTask(item, users));
}

function activityModule(entity: unknown): string {
  const raw = txt(entity).toLowerCase();
  if (raw === "lead") return "Leads";
  if (raw === "task") return "Planner";
  if (raw === "application") return "Applications";
  if (raw === "email") return "Inbox";
  if (raw === "event") return "Events";
  if (raw === "integration") return "Integrations";
  return txt(entity, "Workspace");
}

function activityIcon(entity: unknown): string {
  const raw = txt(entity).toLowerCase();
  if (raw === "lead") return "ri-user-follow-line";
  if (raw === "task") return "ri-checkbox-circle-line";
  if (raw === "application") return "ri-file-list-line";
  if (raw === "email") return "ri-mail-line";
  if (raw === "event") return "ri-calendar-event-line";
  if (raw === "integration") return "ri-plug-line";
  return "ri-pulse-line";
}

function mapActivity(item: AnyRecord, users: User[]): ActivityEntry {
  const actorText = txt(item.actor_id, item.actor, item.user_id, item.user, "Workspace");
  const actor = users.find((user) =>
    [user.id, user.name, user.email].some((value) => value.toLowerCase() === actorText.toLowerCase()),
  );
  const entityType = txt(item.entity_type, item.entity, item.type, "workspace");
  return {
    id: txt(item.id, crypto.randomUUID()),
    actorId: actor?.id ?? actorText,
    action: txt(item.action, "updated"),
    target: txt(item.target, item.entity_id, entityType),
    module: txt(item.module, activityModule(entityType)),
    entityType,
    entityId: txt(item.entity_id, item.id),
    createdAt: toIso(item.created_at, item.occurred_at, item.at),
    icon: txt(item.icon, activityIcon(entityType)),
    tone: txt(item.tone).toLowerCase().includes("danger") ? "danger" : "secondary",
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
  for (const rows of [page.items, page.leads, page.tasks, page.applications, page.events, page.calls, page.emails, page.activity]) {
    const list = arr<T>(rows);
    if (list.length) return list;
  }
  return [];
}

const FULL_PAGE_SAFETY_LIMIT = 5000;

function hasMore(page: BackendPage): boolean {
  return Boolean(page.has_more || page.hasMore);
}

function withQuery(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  const suffix = query.toString();
  if (!suffix) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${suffix}`;
}

async function loadCursorPages<T = AnyRecord>(path: string, limit: number, validate?: (page: BackendPage<T>) => void): Promise<T[]> {
  const items: T[] = [];
  let cursor = "";
  for (let pageNumber = 0; pageNumber < FULL_PAGE_SAFETY_LIMIT; pageNumber += 1) {
    const page = await fetchBackendPage<T>(withQuery(path, { limit, cursor }));
    validate?.(page);
    const rows = pageItems(page);
    items.push(...rows);
    cursor = txt(page.next_cursor, page.nextCursor);
    if (!hasMore(page) || !cursor || rows.length === 0) break;
    if (pageNumber === FULL_PAGE_SAFETY_LIMIT - 1) {
      console.warn(`[backend-sync] Stopped ${path} after ${FULL_PAGE_SAFETY_LIMIT.toLocaleString()} pages.`);
    }
  }
  return items;
}

async function loadOffsetPages<T = AnyRecord>(path: string, limit: number): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  for (let pageNumber = 0; pageNumber < FULL_PAGE_SAFETY_LIMIT; pageNumber += 1) {
    const page = await fetchBackendPage<T>(withQuery(path, { limit, offset }));
    const rows = pageItems(page);
    items.push(...rows);
    const nextOffset = Number(page.next_offset ?? offset + rows.length);
    if (!page.has_more || rows.length === 0 || nextOffset <= offset) break;
    offset = nextOffset;
    if (pageNumber === FULL_PAGE_SAFETY_LIMIT - 1) {
      console.warn(`[backend-sync] Stopped ${path} after ${FULL_PAGE_SAFETY_LIMIT.toLocaleString()} pages.`);
    }
  }
  return items;
}

async function loadBackendLeads(users: User[], options: { fast?: boolean } = {}): Promise<Lead[]> {
  const rows = options.fast
    ? pageItems(await api<BackendPage>("/api/leads?limit=50&include_total=true"))
    : await loadCursorPages("/api/leads?include_total=true", 200);
  return rows.map((lead) => mapLead(lead, users));
}

export async function loadBackendLeadDetail(id: string, users: User[], signal?: AbortSignal): Promise<Lead> {
  const payload = await api<{ lead?: AnyRecord }>(`/api/leads/${encodeURIComponent(id)}`, { signal });
  if (!payload.lead || !txt(payload.lead.id)) throw new Error("The backend returned an invalid lead record.");
  return mapLead(payload.lead, users);
}

export async function loadBackendLeadPage(
  users: User[],
  options: BackendLeadPageOptions = {},
): Promise<BackendLeadPageResult> {
  const path = withQuery("/api/leads", {
    limit: options.limit ?? 50,
    cursor: options.cursor,
    search: options.search,
    stage: options.stage && options.stage !== "all" ? options.stage : undefined,
    owner_id: options.ownerId && options.ownerId !== "all" ? options.ownerId : undefined,
    programme_id: options.programmeId && options.programmeId !== "all" ? options.programmeId : undefined,
    lead_source: options.source && options.source !== "all" ? options.source : undefined,
    created_from: options.createdFrom,
    created_to: options.createdTo,
    sort: options.sort,
    dir: options.dir,
    include_total: options.includeTotal,
  });
  const page = await api<BackendPage>(path);
  return {
    leads: pageItems(page).map((lead) => mapLead(lead, users)),
    total: typeof page.total === "number" ? page.total : null,
    nextCursor: txt(page.next_cursor, page.nextCursor),
    hasMore: hasMore(page),
    limit: Number(page.limit || options.limit || 50),
  };
}

export async function loadBackendTasks(users: User[], options: { fast?: boolean; zoomCalls?: boolean } = {}): Promise<Task[]> {
  const source = options.zoomCalls ? '&source=zoom_calls' : '';
  const validate = options.zoomCalls ? (page: BackendPage) => {
    if (page.source !== 'zoom_calls' || page.call_provenance_version !== 1) {
      throw new Error('Call tasks need a workspace update. Ask your administrator to update the server, then retry.');
    }
  } : undefined;
  let rows: AnyRecord[];
  if (options.fast) {
    const page = await api<BackendPage>(`/api/tasks?status=all&limit=50&include_counts=true${source}`);
    validate?.(page); rows = pageItems(page);
  } else rows = await loadCursorPages(`/api/tasks?status=all&include_counts=true${source}`, 200, validate);
  return rows.map((task) => mapTask(task, users));
}

async function loadBackendApplications(users: User[], options: { fast?: boolean } = {}): Promise<Application[]> {
  const rows = options.fast
    ? pageItems(await api<BackendPage>("/api/applications?limit=50"))
    : await loadCursorPages("/api/applications", 100);
  return rows.map((application) => mapApplication(application, users));
}

async function loadBackendEvents(options: { fast?: boolean } = {}): Promise<CollegeEvent[]> {
  const events = options.fast
    ? pageItems(await fetchBackendPage("/api/events?limit=50"))
    : await loadCursorPages("/api/events", 100);
  return mapEventsWithDetails(events, { prefetchDetails: !options.fast });
}

async function loadBackendMeetings(users: User[], options: { fast?: boolean } = {}): Promise<Meeting[]> {
  const meetings = options.fast
    ? pageItems(await api<BackendPage>("/api/meetings?limit=50"))
    : await loadCursorPages("/api/meetings", 200);
  return meetings.map((meeting) => mapMeeting(meeting, users));
}

async function loadBackendCalls(users: User[], options: { fast?: boolean } = {}): Promise<Call[]> {
  const calls = options.fast
    ? pageItems(await api<BackendPage>("/api/zoom/calls?limit=50&offset=0"))
    : await loadOffsetPages("/api/zoom/calls", 250);
  return calls.map((call) => mapCall(call, users));
}

async function loadBackendEmails(users: User[], leads: Lead[], options: { fast?: boolean } = {}): Promise<EmailThread[]> {
  const rows = options.fast
    ? pageItems(await api<BackendPage>("/api/emails?limit=50&include_total=false"))
    : await loadCursorPages("/api/emails?include_total=false", 100);
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  return rows.map((thread) => mapEmail(thread, users, leadById));
}

async function loadBackendActivity(users: User[], options: { fast?: boolean } = {}): Promise<ActivityEntry[]> {
  const page = await api<BackendPage>(`/api/activity?limit=${options.fast ? 15 : 20}`);
  return pageItems(page).map((item) => mapActivity(item, users));
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
  return options.sections?.includes(section) === true;
}

const workspaceRequests = new Map<string, Promise<BackendWorkspaceResult | null>>();

export function loadBackendWorkspace(options: BackendWorkspaceLoadOptions = {}): Promise<BackendWorkspaceResult | null> {
  const key = JSON.stringify({ fast: Boolean(options.fast), sections: [...(options.sections || [])].sort(), throwOnFailure: Boolean(options.throwOnFailure) });
  const pending = workspaceRequests.get(key);
  if (pending) return pending;
  const request = loadBackendWorkspaceRequest(options).finally(() => {
    if (workspaceRequests.get(key) === request) workspaceRequests.delete(key);
  });
  workspaceRequests.set(key, request);
  return request;
}

async function loadBackendWorkspaceRequest(options: BackendWorkspaceLoadOptions): Promise<BackendWorkspaceResult | null> {
  try {
    const bootstrap = await api<AnyRecord>("/api/bootstrap", {
      timeoutMs: BACKEND_BOOTSTRAP_TIMEOUT_MS,
    });
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
    const [emails, activity] = await Promise.all([
      shouldLoadSection(options, "emails")
        ? loadWorkspaceSection("Emails", () => loadBackendEmails(workspaceUsers, leads, { fast: options.fast }))
        : Promise.resolve([]),
      shouldLoadSection(options, "activity")
        ? loadWorkspaceSection("Activity", () => loadBackendActivity(workspaceUsers, { fast: options.fast }))
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
      commercialOpportunities: arr<AnyRecord>(bootstrap.commercialOpportunities).map((item) =>
        mapCommercialOpportunity(item, workspaceUsers),
      ),
      employerAgreements: [],
      dasRecords: [],
      threads: emails,
      labels: EMAIL_LABELS,
      tasks,
      events,
      campaigns: [],
      applications,
      meetings,
      calls,
      activity,
      notifications: [],
      audit: [],
      integrationStatuses: mapIntegrationStatuses(bootstrap),
    };
    return { state, loadedAt: new Date().toISOString(), currentUserId: txt(bootstrap.user?.id), integrationOverview: null };
  } catch (error) {
    if (isBackendAuthRequiredError(error)) throw error;
    if (options.throwOnFailure) throw error;
    console.warn("[backend-sync] Backend workspace load failed; using empty local workspace.", error);
    return null;
  }
}
