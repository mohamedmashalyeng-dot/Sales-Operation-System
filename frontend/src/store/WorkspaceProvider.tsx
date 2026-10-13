import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { createSeedState } from "@/store/seed";
import {
  clearBackendIntegrationOverviewCache,
  isBackendAuthRequiredError,
  loadBackendIntegrationOverview,
  loadBackendWorkspace,
  type BackendIntegrationOverview,
} from "@/store/backendSync";
import { bumpDatasetGeneration } from "@/store/datasetIdentity";
import { sourceByName, categoryForInteractionType } from "@/config/attribution";
import type { AudienceRow, CampaignStage } from "@/config/marketing";
import {
  buildAudience,
  createCampaignRecord,
  type CampaignInput,
} from "@/store/actions/marketing";
import {
  BACKUP_STORAGE_KEY,
  bootWorkspace,
  CURRENT_SCHEMA_VERSION,
  isStructurallyUsable,
  NOTICE_STORAGE_KEY,
  runMigrations,
  type BootIssue,
  type MigrationRecord,
} from "@/store/migrations";
import BackendSignInScreen, {
  type BackendSignInResult,
} from "@/components/feature/BackendSignInScreen";
import DataRecoveryScreen from "@/components/feature/DataRecoveryScreen";
import {
  DEFAULT_ROLE_ID,
  isRoleId,
  roleById,
  roleCan,
  type RoleDefinition,
  type RoleId,
} from "@/config/permissions";
import {
  ENROLMENT_STAGES,
  deriveScreeningStatus,
  type EligibilityStatus,
  type EnrolmentStage,
} from "@/config/eligibility";
import type { CommercialStage } from "@/config/commercial";
import type { DasStatus, EmployerAgreementStatus } from "@/config/employer";
import type {
  ActivityEntry,
  ActivityTone,
  Application,
  ApplicationStatus,
  AttendanceOutcome,
  AuditEntry,
  Call,
  CallOutcome,
  CallStatus,
  CampaignRecipient,
  CommercialOpportunity,
  DasRecord,
  EventCampaign,
  EligibilityAssessment,
  EligibilityResponse,
  EmailThread,
  EmployerAgreement,
  EventRegistration,
  FutureIntakeRecord,
  Lead,
  LeadStage,
  Priority,
  ReadState,
  RegOutcome,
  Task,
  TaskSource,
  ThreadStatusKey,
  Touchpoint,
  User,
  WorkspaceState,
} from "@/store/types";

const STORAGE_KEY = "kbc-workspace-v1";

/**
 * Tracks the acting workspace user so activity and audit helpers can attribute
 * writes without threading the id through every call site.
 */
let activeActorId = "u-amara";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function now(): string {
  return new Date().toISOString();
}

function nextNumber(ids: string[], prefix: string, fallback: number): number {
  let max = fallback;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  ids.forEach((id) => {
    const match = id.match(re);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });
  return max + 1;
}

function pushActivity(
  draft: WorkspaceState,
  entry: Omit<ActivityEntry, "id" | "createdAt" | "actorId"> & { actorId?: string },
): void {
  draft.activity.unshift({
    id: uid("act"),
    actorId: entry.actorId ?? activeActorId,
    action: entry.action,
    target: entry.target,
    module: entry.module,
    entityType: entry.entityType,
    entityId: entry.entityId,
    createdAt: now(),
    icon: entry.icon,
    tone: entry.tone,
  });
  if (draft.activity.length > 400) draft.activity = draft.activity.slice(0, 400);
}

function pushAudit(
  draft: WorkspaceState,
  entry: Omit<AuditEntry, "id" | "createdAt" | "actorId"> & { actorId?: string },
): void {
  draft.audit.unshift({
    id: uid("aud"),
    actorId: entry.actorId ?? activeActorId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before,
    after: entry.after,
    createdAt: now(),
  });
  if (draft.audit.length > 400) draft.audit = draft.audit.slice(0, 400);
}

/* ------------------------------ inputs ------------------------------ */

export interface LeadInput {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  programme: string;
  intake: string;
  source: string;
  ownerId: string;
  stage: LeadStage;
  priority: Priority;
  value: number;
  nextAction: string;
  nextActionAt: string;
  tags: string[];
}

export interface TaskInput {
  title: string;
  description: string;
  ownerId: string;
  priority: Priority;
  dueAt: string;
  source: TaskSource;
  relatedLeadId?: string;
  relatedThreadId?: string;
  relatedEventId?: string;
  programme?: string;
  notes?: string;
}

export interface ComposeInput {
  toName: string;
  toEmail: string;
  subject: string;
  body: string;
  labelIds: string[];
  ownerId: string;
}

export interface ApplicationInput {
  applicantName: string;
  email: string;
  phone: string;
  programme: string;
  intake: string;
  status: ApplicationStatus;
  ownerId: string;
  leadId?: string;
}

export interface CallInput {
  direction: "incoming" | "outgoing";
  status: CallStatus;
  durationSec: number;
  caller: string;
  receiver: string;
  phoneNumber: string;
  leadId?: string;
  notes: string;
  matchConfidence: "verified" | "uncertain" | "none";
}

export interface TouchpointInput {
  leadId: string;
  timestamp: string;
  source: string;
  channel: string;
  interactionType: string;
  outcome: string;
  ownerId: string;
  notes: string;
  refType?: Touchpoint["refType"];
  refId?: string;
  campaignId?: string;
}

export interface ClosingInput {
  leadId: string;
  outcome: "won" | "lost";
  closingDate: string;
  closingOwnerId: string;
  interactionType: string;
  source: string;
  channel: string;
  campaign?: string;
  notes: string;
  lossReason?: string;
  /** When recording a brand-new closing interaction rather than selecting one. */
  newTouchpoint?: boolean;
  touchpointId?: string;
}

/* --------------------- apprenticeship progression -------------------- */

export interface EligibilityResponseInput {
  questionId: string;
  answer: EligibilityResponse["answer"];
  evidence: EligibilityResponse["evidence"];
  notes: string;
  weeklyHours?: number;
}

export interface EligibilityInput {
  leadId: string;
  responses: EligibilityResponseInput[];
  /** Optional explicit status; otherwise derived from the responses. */
  status?: EligibilityStatus;
}

export interface FutureIntakeInput {
  leadId: string;
  currentProgramme: string;
  currentIntake: string;
  preferredIntake: string;
  preferredStartMonth: string;
  reason: string;
  learnerReadiness: string;
  employerReadiness: string;
  salesOwnerId: string;
  enrolmentOwnerId: string;
  lastContactAt: string;
  nextFollowUpAt: string;
  notes: string;
  /** Only create the Planner task when the user explicitly confirms the date. */
  createFollowUpTask: boolean;
}

export interface CommercialInput {
  leadId: string;
  fundingEligibilityOutcome: string;
  referralReason: string;
  programmeInterest: string;
  suggestedProgramme: string;
  optionType: string;
  fundingInterest: string;
  budgetStatus: string;
  quoteStatus: string;
  commercialOwnerId: string;
  nextFollowUpAt: string;
  notes: string;
}

export interface AgreementInput {
  employerName: string;
  employerContact: string;
  status: EmployerAgreementStatus;
  dateSent?: string;
  followUpDueAt?: string;
  notes: string;
  leadId?: string;
  applicationId?: string;
}

export interface DasInput {
  employerName: string;
  status: DasStatus;
  accountSetupHelpNeeded: boolean;
  ukprnShared: boolean;
  providerAdditionRequested: boolean;
  providerAdditionConfirmed: boolean;
  fundingActionsReviewed: boolean;
  responsibleStaffId: string;
  followUpAt?: string;
  notes: string;
  leadId?: string;
  applicationId?: string;
}

/** Moves the enrolment dimension forward only — never regresses a record. */
function advanceEnrolment(lead: Lead, stage: EnrolmentStage): void {
  const order = ENROLMENT_STAGES;
  const current = order.indexOf((lead.enrolment ?? "Not Started") as EnrolmentStage);
  const target = order.indexOf(stage);
  if (target > current) lead.enrolment = stage;
}

function pushTouchpoint(
  draft: WorkspaceState,
  input: TouchpointInput,
  isClosing = false,
): Touchpoint | undefined {
  // De-duplicate linked records using a stable key of the source record id AND
  // the event type, so the same call/email/registration can never be recorded
  // twice and each distinct event on a record still creates its own touchpoint.
  const dedupeKey = input.refId
    ? `${input.leadId}::${input.refId}::${input.interactionType}`
    : null;
  if (dedupeKey) {
    const existing = draft.touchpoints.find(
      (t) => `${t.leadId}::${t.refId}::${t.interactionType}` === dedupeKey,
    );
    if (existing) return existing;
  }
  const point: Touchpoint = {
    id: uid("tp"),
    leadId: input.leadId,
    timestamp: input.timestamp,
    source: input.source,
    channel: input.channel,
    interactionType: input.interactionType,
    outcome: input.outcome,
    ownerId: input.ownerId,
    notes: input.notes,
    isClosing,
    refType: input.refType ?? "manual",
    refId: input.refId,
    category: categoryForInteractionType(input.interactionType),
    campaignId: input.campaignId,
  };
  draft.touchpoints.push(point);
  return point;
}

/* ------------------------------ context ----------------------------- */

export interface ImportResult {
  ok: boolean;
  error?: string;
  migrated?: boolean;
}

export interface WorkspaceContextValue {
  state: WorkspaceState;
  roleId: RoleId;
  role: RoleDefinition;
  setRole: (roleId: RoleId) => void;
  currentUserId: string;
  currentUser: User;
  getUser: (id: string | null | undefined) => User | undefined;
  userName: (id: string | null | undefined) => string;
  resetDemoData: () => void;
  // browser workspace data management
  schemaVersion: number;
  backupStorageKey: string;
  migrationNotice: MigrationRecord | null;
  dismissMigrationNotice: () => void;
  exportDemoData: () => string;
  importDemoData: (json: string) => ImportResult;
  storageAvailable: boolean;
  backendLoadedAt: string | null;
  backendAuthRequired: boolean;
  backendLoading: boolean;
  integrationOverview: BackendIntegrationOverview | null;
  refreshBackendWorkspace: () => Promise<boolean>;
  signInBackend: (email: string, password: string) => Promise<BackendSignInResult>;
  // leads
  createLead: (input: LeadInput) => Lead;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  deleteLead: (id: string) => void;
  addLeadNote: (id: string, body: string) => void;
  // tasks
  createTask: (input: TaskInput) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  completeTask: (id: string) => void;
  reopenTask: (id: string) => void;
  rescheduleTask: (id: string, dueAt: string) => void;
  deleteTask: (id: string) => void;
  // inbox
  markThreadRead: (id: string, read: ReadState) => void;
  replyToThread: (id: string, body: string) => void;
  composeThread: (input: ComposeInput) => EmailThread;
  logExternalResponse: (id: string) => void;
  resolveThread: (id: string, resolved: boolean) => void;
  assignThread: (id: string, ownerId: string | null) => void;
  toggleThreadLabel: (id: string, labelId: string) => void;
  toggleThreadFlag: (id: string, flag: "starred" | "important") => void;
  trashThread: (id: string, trashed: boolean) => void;
  bulkThreadAction: (ids: string[], action: "resolve" | "trash" | "read" | "restore") => void;
  scheduleFollowUp: (threadId: string, dueAt: string) => void;
  // events
  setRegistrationOutcome: (eventId: string, registrationId: string, outcome: RegOutcome) => void;
  setRegistrationAttendance: (
    eventId: string,
    registrationId: string,
    attendance: AttendanceOutcome,
  ) => void;
  updateRegistration: (
    eventId: string,
    registrationId: string,
    patch: Partial<EventRegistration>,
  ) => void;
  scheduleCallback: (eventId: string, registrationId: string, dueAt: string) => void;
  // campaign management
  createCampaign: (input: CampaignInput) => EventCampaign;
  importCampaignAudience: (
    campaignId: string,
    rows: AudienceRow[],
    fileName?: string,
  ) => { added: number; valid: number; duplicates: number };
  updateCampaignRecipient: (
    campaignId: string,
    recipientId: string,
    patch: Partial<CampaignRecipient>,
  ) => void;
  setCampaignStage: (campaignId: string, stage: CampaignStage) => void;
  sendCampaign: (campaignId: string) => void;
  updateCampaign: (campaignId: string, patch: Partial<EventCampaign>) => void;
  // applications
  updateApplicationStatus: (id: string, status: ApplicationStatus, note: string) => void;
  createApplication: (input: ApplicationInput) => Application;
  updateApplication: (id: string, patch: Partial<Application>) => void;
  addApplicationNote: (id: string, body: string) => void;
  // integrations
  logIntegrationEvent: (action: string, target: string, tone: ActivityTone) => void;
  // calls
  logCall: (input: CallInput) => Call;
  scheduleCallbackTask: (input: TaskInput) => Task;
  recordCallOutcome: (callId: string, outcome: CallOutcome, notes: string) => void;
  attachCallFollowUp: (callId: string, taskId: string) => void;
  // attribution
  addTouchpoint: (input: TouchpointInput) => Touchpoint;
  updateTouchpoint: (id: string, patch: Partial<Touchpoint>) => void;
  deleteTouchpoint: (id: string) => void;
  closeLead: (input: ClosingInput) => void;
  reopenLead: (leadId: string) => void;
  // apprenticeship progression
  updateEligibility: (input: EligibilityInput) => void;
  recordEligibilityDecision: (
    leadId: string,
    decision: "Verified Eligible" | "Not Eligible for Funding",
    reasons: string,
  ) => boolean;
  moveToFutureIntake: (input: FutureIntakeInput) => FutureIntakeRecord;
  updateFutureIntake: (id: string, patch: Partial<FutureIntakeRecord>) => void;
  removeFromFutureIntake: (id: string) => void;
  referCommercial: (input: CommercialInput) => CommercialOpportunity;
  updateCommercial: (id: string, patch: Partial<CommercialOpportunity>) => void;
  createEmployerAgreement: (input: AgreementInput) => EmployerAgreement;
  updateEmployerAgreement: (id: string, patch: Partial<EmployerAgreement>) => void;
  createDasRecord: (input: DasInput) => DasRecord;
  updateDas: (id: string, patch: Partial<DasRecord>) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Reads a not-yet-dismissed upgrade notification, if one is pending. */
function readPendingNotice(): MigrationRecord | null {
  try {
    const raw = localStorage.getItem(NOTICE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MigrationRecord;
    return typeof parsed?.toVersion === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/** Best-effort probe so the Settings screen can report persistence health. */
function probeStorage(): boolean {
  try {
    const key = "kbc-storage-probe";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

const LEGACY_DEMO_USER_NAMES = new Set([
  "amara whitfield",
  "tom blackwood",
  "leila haddad",
  "owen fielding",
  "hannah reid",
  "marcus bell",
]);

function removeWorkspaceStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BACKUP_STORAGE_KEY);
    localStorage.removeItem(NOTICE_STORAGE_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

function looksLikeLegacyDemoWorkspace(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { demo?: unknown; users?: unknown };
    if (parsed?.demo === true) return true;
    const users = Array.isArray(parsed?.users) ? parsed.users : [];
    return users.some((item) => {
      if (!item || typeof item !== "object") return false;
      const user = item as { name?: unknown; email?: unknown };
      const name = String(user.name ?? "").trim().toLowerCase();
      const email = String(user.email ?? "").trim().toLowerCase();
      return LEGACY_DEMO_USER_NAMES.has(name) || email.endsWith("@pathway.demo");
    });
  } catch {
    return false;
  }
}

function readStoredWorkspace(): string | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && looksLikeLegacyDemoWorkspace(raw)) {
    removeWorkspaceStorage();
    return null;
  }
  return raw;
}

function hasActiveIntegrationSync(overview: BackendIntegrationOverview | null): boolean {
  return Boolean(
    overview?.integrations?.some((integration) =>
      String(integration.sync_status || "") === "running",
    ),
  );
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [boot] = useState(() =>
    bootWorkspace(readStoredWorkspace(), createSeedState(), STORAGE_KEY),
  );
  const [state, setState] = useState<WorkspaceState>(boot.state);
  const [issue, setIssue] = useState<BootIssue | null>(boot.issue);
  const [backendLoadedAt, setBackendLoadedAt] = useState<string | null>(null);
  const [backendAuthRequired, setBackendAuthRequired] = useState(false);
  const [backendLoading, setBackendLoading] = useState(true);
  const [integrationOverview, setIntegrationOverview] = useState<BackendIntegrationOverview | null>(null);
  const activeIntegrationSyncRef = useRef(false);
  const integrationOverviewTimerRef = useRef<number | null>(null);
  const integrationOverviewMountedRef = useRef(true);
  const [migrationNotice, setMigrationNotice] = useState<MigrationRecord | null>(() =>
    readPendingNotice(),
  );

  useEffect(() => {
    integrationOverviewMountedRef.current = true;
    return () => {
      integrationOverviewMountedRef.current = false;
      if (integrationOverviewTimerRef.current !== null) {
        window.clearTimeout(integrationOverviewTimerRef.current);
        integrationOverviewTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (integrationOverviewTimerRef.current !== null) {
      window.clearTimeout(integrationOverviewTimerRef.current);
      integrationOverviewTimerRef.current = null;
    }
  }, [location.pathname]);

  useEffect(() => {
    // Never overwrite the stored copy while an unresolved recovery issue is
    // on screen — the original data must survive for export/retry.
    if (issue || backendLoadedAt) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage may be unavailable or full */
    }
  }, [state, issue, backendLoadedAt]);

  const applyBackendWorkspace = useCallback((result: Awaited<ReturnType<typeof loadBackendWorkspace>>) => {
    if (!result) return false;
      setIssue(null);
      setState(result.state);
      setBackendLoadedAt(result.loadedAt);
      setBackendAuthRequired(false);
      setIntegrationOverview(result.integrationOverview);
      setMigrationNotice(null);
    return true;
  }, []);

  const refreshBackendWorkspace = useCallback(async (): Promise<boolean> => {
    setBackendLoading(true);
    clearBackendIntegrationOverviewCache();
    try {
      const result = await loadBackendWorkspace();
      return applyBackendWorkspace(result);
    } catch (error) {
      if (isBackendAuthRequiredError(error)) {
        setBackendAuthRequired(true);
        setBackendLoadedAt(null);
        return false;
      }
      throw error;
    } finally {
      setBackendLoading(false);
    }
  }, [applyBackendWorkspace]);

  const refreshIntegrationOverview = useCallback(async (): Promise<BackendIntegrationOverview | null> => {
    try {
      const overview = await loadBackendIntegrationOverview({ force: true });
      if (integrationOverviewMountedRef.current) setIntegrationOverview(overview);
      return overview;
    } catch (error) {
      if (!isBackendAuthRequiredError(error)) {
        console.warn("[backend-sync] Integration overview load failed.", error);
      }
      return null;
    }
  }, []);

  const signInBackend = useCallback(
    async (email: string, password: string): Promise<BackendSignInResult> => {
      setBackendLoading(true);
      try {
        const response = await fetch("/api/login", {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) {
          let message = "Email or password is incorrect.";
          try {
            const payload = (await response.json()) as { error?: string; message?: string };
            message = payload.error || payload.message || message;
          } catch {
            /* keep the generic message */
          }
          return { ok: false, error: message };
        }
        const loaded = await refreshBackendWorkspace();
        if (!loaded) return { ok: false, error: "Signed in, but the backend workspace did not load." };
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unable to sign in.",
        };
      } finally {
        setBackendLoading(false);
      }
    },
    [refreshBackendWorkspace],
  );

  useEffect(() => {
    let cancelled = false;
    setBackendLoading(true);
    loadBackendWorkspace()
      .then((result) => {
        if (cancelled) return;
        applyBackendWorkspace(result);
      })
      .catch((error) => {
        if (cancelled) return;
        if (isBackendAuthRequiredError(error)) {
          setBackendAuthRequired(true);
          setBackendLoadedAt(null);
        } else {
          console.warn("[backend-sync] Initial backend load failed.", error);
        }
      })
      .finally(() => {
        if (!cancelled) setBackendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyBackendWorkspace]);

  useEffect(() => {
    if (!backendLoadedAt || integrationOverview) return;
    let cancelled = false;
    loadBackendIntegrationOverview()
      .then((overview) => {
        if (cancelled || !overview) return;
        setIntegrationOverview(overview);
        activeIntegrationSyncRef.current = hasActiveIntegrationSync(overview);
      })
      .catch((error) => {
        if (!cancelled && !isBackendAuthRequiredError(error)) {
          console.warn("[backend-sync] Integration overview load failed.", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backendLoadedAt, integrationOverview, refreshIntegrationOverview]);

  useEffect(() => {
    if (!hasActiveIntegrationSync(integrationOverview)) {
      activeIntegrationSyncRef.current = false;
      if (integrationOverviewTimerRef.current !== null) {
        window.clearTimeout(integrationOverviewTimerRef.current);
        integrationOverviewTimerRef.current = null;
      }
      return;
    }
    activeIntegrationSyncRef.current = true;
    let cancelled = false;
    const poll = () => {
      if (integrationOverviewTimerRef.current !== null) window.clearTimeout(integrationOverviewTimerRef.current);
      integrationOverviewTimerRef.current = window.setTimeout(async () => {
        integrationOverviewTimerRef.current = null;
        const overview = await refreshIntegrationOverview();
        if (cancelled || !overview) return;
        if (hasActiveIntegrationSync(overview)) {
          poll();
          return;
        }
        if (activeIntegrationSyncRef.current) {
          activeIntegrationSyncRef.current = false;
          void refreshBackendWorkspace();
        }
      }, 5000);
    };
    poll();
    return () => {
      cancelled = true;
      if (integrationOverviewTimerRef.current !== null) {
        window.clearTimeout(integrationOverviewTimerRef.current);
        integrationOverviewTimerRef.current = null;
      }
    };
  }, [integrationOverview, refreshBackendWorkspace, refreshIntegrationOverview]);

  const commit = useCallback((mutator: (draft: WorkspaceState) => void) => {
    setState((prev) => {
      const draft = JSON.parse(JSON.stringify(prev)) as WorkspaceState;
      mutator(draft);
      return draft;
    });
  }, []);

  const role = useMemo<RoleDefinition>(() => roleById(state.roleId), [state.roleId]);
  const currentUserId = role.userId;

  useEffect(() => {
    activeActorId = currentUserId;
  }, [currentUserId]);

  const setRole = useCallback((next: RoleId) => {
    setState((prev) => ({ ...prev, roleId: isRoleId(next) ? next : DEFAULT_ROLE_ID }));
  }, []);

  const currentUser = useMemo(
    () => state.users.find((u) => u.id === currentUserId) ?? state.users[0],
    [state.users, currentUserId],
  );

  const getUser = useCallback(
    (id: string | null | undefined) => (id ? state.users.find((u) => u.id === id) : undefined),
    [state.users],
  );

  const userName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return "Unassigned";
      return state.users.find((u) => u.id === id)?.name ?? "Unknown user";
    },
    [state.users],
  );

  const resetDemoData = useCallback(() => {
    // Start a new dataset generation so any manual QA evidence captured against
    // the previous dataset is flagged as "needs retest" rather than presented
    // as current. QA evidence itself is never deleted by a reset.
    bumpDatasetGeneration();
    setBackendLoadedAt(null);
    setIntegrationOverview(null);
    removeWorkspaceStorage();
    setState(createSeedState());
  }, []);

  const dismissMigrationNotice = useCallback(() => {
    setMigrationNotice(null);
    try {
      localStorage.removeItem(NOTICE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const exportDemoData = useCallback(() => JSON.stringify(state, null, 2), [state]);

  const importDemoData = useCallback(
    (json: string): ImportResult => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return { ok: false, error: "That file is not valid JSON." };
      }
      if (!isStructurallyUsable(parsed)) {
        return {
          ok: false,
          error: "That file is not a Kent Business College workspace backup.",
        };
      }
      if (looksLikeLegacyDemoWorkspace(json)) {
        return {
          ok: false,
          error: "That file contains legacy demo records and was not imported.",
        };
      }
      try {
        // Back up what is currently active before replacing it.
        try {
          localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(state));
        } catch {
          /* best-effort */
        }
        const result = runMigrations(parsed as Record<string, unknown>, createSeedState());
        setState(result.state);
        if (result.applied && result.record) {
          setMigrationNotice(result.record);
          try {
            localStorage.setItem(NOTICE_STORAGE_KEY, JSON.stringify(result.record));
          } catch {
            /* best-effort */
          }
        }
        return { ok: true, migrated: result.applied };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "The backup could not be imported safely.",
        };
      }
    },
    [state],
  );

  const retryRecovery = useCallback((): boolean => {
    const candidate = readStoredWorkspace() ?? issue?.raw ?? null;
    const raw = candidate && looksLikeLegacyDemoWorkspace(candidate) ? null : candidate;
    const result = bootWorkspace(raw, createSeedState(), STORAGE_KEY);
    if (result.issue) {
      setIssue(result.issue);
      return false;
    }
    setIssue(null);
    setState(result.state);
    setMigrationNotice(readPendingNotice());
    return true;
  }, [issue]);

  const resetFromRecovery = useCallback(() => {
    removeWorkspaceStorage();
    setState(createSeedState());
    setIssue(null);
    setMigrationNotice(null);
  }, []);

  /* ------------------------------- leads ------------------------------ */

  const createLead = useCallback(
    (input: LeadInput): Lead => {
      const id = `L-${nextNumber(state.leads.map((l) => l.id), "L", 2000)}`;
      const source = sourceByName(input.source);
      const lead: Lead = {
        id,
        ...input,
        createdAt: now(),
        lastContactAt: now(),
        zohoSynced: false,
        notes: [],
        applicationIds: [],
        channel: source?.channel ?? "Direct",
        platform: source?.platform ?? "Manual",
        acquisitionDate: now(),
        originalOwnerId: input.ownerId,
      };
      commit((draft) => {
        draft.leads.unshift(lead);
        pushActivity(draft, {
          action: "created lead",
          target: lead.name,
          module: "Leads",
          entityType: "lead",
          entityId: lead.id,
          icon: "ri-user-add-line",
          tone: "primary",
        });
        pushAudit(draft, {
          entityType: "lead",
          entityId: lead.id,
          action: "Lead created",
          before: "—",
          after: input.stage,
        });
      });
      return lead;
    },
    [commit, state.leads],
  );

  const updateLead = useCallback(
    (id: string, patch: Partial<Lead>) => {
      commit((draft) => {
        const lead = draft.leads.find((l) => l.id === id);
        if (!lead) return;
        const stageChanged = patch.stage && patch.stage !== lead.stage;
        Object.assign(lead, patch);
        if (stageChanged) {
          pushActivity(draft, {
            action: "moved",
            target: `${lead.name} → ${patch.stage}`,
            module: "Leads",
            entityType: "lead",
            entityId: id,
            icon: "ri-user-add-line",
            tone: "secondary",
          });
          pushAudit(draft, {
            entityType: "lead",
            entityId: id,
            action: "Lead stage changed",
            before: lead.stage,
            after: patch.stage ?? "",
          });
        }
      });
    },
    [commit],
  );

  const deleteLead = useCallback(
    (id: string) => {
      commit((draft) => {
        const lead = draft.leads.find((l) => l.id === id);
        draft.leads = draft.leads.filter((l) => l.id !== id);
        if (lead) {
          pushActivity(draft, {
            action: "deleted lead",
            target: lead.name,
            module: "Leads",
            entityType: "lead",
            entityId: id,
            icon: "ri-delete-bin-line",
            tone: "danger",
          });
        }
      });
    },
    [commit],
  );

  const addLeadNote = useCallback(
    (id: string, body: string) => {
      commit((draft) => {
        const lead = draft.leads.find((l) => l.id === id);
        if (!lead) return;
        lead.notes.unshift({ id: uid("note"), body, authorId: activeActorId, createdAt: now() });
        lead.lastContactAt = now();
        pushActivity(draft, {
          action: "added a note to",
          target: lead.name,
          module: "Leads",
          entityType: "lead",
          entityId: id,
          icon: "ri-sticky-note-line",
          tone: "secondary",
        });
      });
    },
    [commit],
  );

  /* ------------------------------- tasks ------------------------------ */

  const createTask = useCallback(
    (input: TaskInput): Task => {
      const id = `T-${nextNumber(state.tasks.map((t) => t.id), "T", 3000)}`;
      const task: Task = {
        id,
        title: input.title,
        description: input.description,
        ownerId: input.ownerId,
        priority: input.priority,
        dueAt: input.dueAt,
        source: input.source,
        status: "open",
        relatedLeadId: input.relatedLeadId,
        relatedThreadId: input.relatedThreadId,
        relatedEventId: input.relatedEventId,
        programme: input.programme,
        notes: input.notes ?? "",
        createdAt: now(),
      };
      commit((draft) => {
        draft.tasks.unshift(task);
        pushActivity(draft, {
          action: "created task",
          target: task.title,
          module: "Planner",
          entityType: "task",
          entityId: task.id,
          icon: "ri-add-line",
          tone: "primary",
        });
      });
      return task;
    },
    [commit, state.tasks],
  );

  const updateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      commit((draft) => {
        const task = draft.tasks.find((t) => t.id === id);
        if (task) Object.assign(task, patch);
      });
    },
    [commit],
  );

  const completeTask = useCallback(
    (id: string) => {
      commit((draft) => {
        const task = draft.tasks.find((t) => t.id === id);
        if (!task) return;
        task.status = "completed";
        task.completedAt = now();
        pushActivity(draft, {
          action: "completed task",
          target: task.title,
          module: "Planner",
          entityType: "task",
          entityId: id,
          icon: "ri-checkbox-multiple-line",
          tone: "success",
        });
        pushAudit(draft, {
          entityType: "task",
          entityId: id,
          action: "Task completed",
          before: "Open",
          after: "Completed",
        });
      });
    },
    [commit],
  );

  const reopenTask = useCallback(
    (id: string) => {
      commit((draft) => {
        const task = draft.tasks.find((t) => t.id === id);
        if (!task) return;
        task.status = "open";
        task.completedAt = undefined;
      });
    },
    [commit],
  );

  const rescheduleTask = useCallback(
    (id: string, dueAt: string) => {
      updateTask(id, { dueAt });
    },
    [updateTask],
  );

  const deleteTask = useCallback(
    (id: string) => {
      commit((draft) => {
        draft.tasks = draft.tasks.filter((t) => t.id !== id);
      });
    },
    [commit],
  );

  /* ------------------------------- inbox ------------------------------ */

  const markThreadRead = useCallback(
    (id: string, read: ReadState) => {
      commit((draft) => {
        const thread = draft.threads.find((t) => t.id === id);
        if (!thread) return;
        thread.readState = read;
        if (read === "read" && thread.responseState === "unanswered") {
          thread.responseState = "seen-no-reply";
        }
      });
    },
    [commit],
  );

  const replyToThread = useCallback(
    (id: string, body: string) => {
      commit((draft) => {
        const thread = draft.threads.find((t) => t.id === id);
        if (!thread) return;
        const msgId = uid("msg");
        thread.messages.push({
          id: msgId,
          direction: "outbound",
          fromName: currentUser.name,
          fromEmail: currentUser.email,
          toEmail: thread.senderEmail,
          body,
          sentAt: now(),
          authorId: currentUser.id,
        });
        thread.readState = "read";
        thread.responseState = "replied";
        if (!thread.labelIds.includes("lbl-sent")) thread.labelIds.push("lbl-sent");
        if (thread.relatedLeadId) {
          const lead = draft.leads.find((l) => l.id === thread.relatedLeadId);
          if (lead) {
            pushTouchpoint(
              draft,
              {
                leadId: lead.id,
                timestamp: now(),
                source: lead.source,
                channel: lead.channel,
                interactionType: "Email reply",
                outcome: "Positive",
                ownerId: currentUser.id,
                notes: `Reply sent: ${thread.subject}`,
                refType: "email",
                refId: msgId,
              },
              false,
            );
            lead.lastContactAt = now();
          }
        }
        pushActivity(draft, {
          action: "replied to",
          target: thread.subject,
          module: "Inbox",
          entityType: "thread",
          entityId: id,
          icon: "ri-mail-send-line",
          tone: "primary",
        });
        pushAudit(draft, {
          entityType: "thread",
          entityId: id,
          action: "Email reply sent",
          before: "Unanswered",
          after: "Replied",
        });
      });
    },
    [commit, currentUser],
  );

  const composeThread = useCallback(
    (input: ComposeInput): EmailThread => {
      const id = `TH-${nextNumber(state.threads.map((t) => t.id), "TH", 1100)}`;
      const thread: EmailThread = {
        id,
        subject: input.subject,
        senderName: input.toName,
        senderEmail: input.toEmail,
        preview: input.body.slice(0, 140),
        labelIds: [...input.labelIds, "lbl-sent"],
        ownerId: input.ownerId,
        readState: "read",
        responseState: "replied",
        receivedAt: now(),
        slaHours: 24,
        deadlineAt: now(),
        starred: false,
        important: false,
        trashed: false,
        messages: [
          {
            id: uid("msg"),
            direction: "outbound",
            fromName: currentUser.name,
            fromEmail: currentUser.email,
            toEmail: input.toEmail,
            body: input.body,
            sentAt: now(),
            authorId: currentUser.id,
          },
        ],
      };
      commit((draft) => {
        draft.threads.unshift(thread);
        pushActivity(draft, {
          action: "sent email to",
          target: `${input.toName} — ${input.subject}`,
          module: "Inbox",
          entityType: "thread",
          entityId: id,
          icon: "ri-mail-send-line",
          tone: "primary",
        });
      });
      return thread;
    },
    [commit, currentUser, state.threads],
  );

  const logExternalResponse = useCallback(
    (id: string) => {
      commit((draft) => {
        const thread = draft.threads.find((t) => t.id === id);
        if (!thread) return;
        thread.responseState = "replied";
        thread.readState = "read";
        thread.externalResponseAt = now();
      });
    },
    [commit],
  );

  const resolveThread = useCallback(
    (id: string, resolved: boolean) => {
      commit((draft) => {
        const thread = draft.threads.find((t) => t.id === id);
        if (!thread) return;
        if (resolved) {
          thread.responseState = "resolved";
          thread.readState = "read";
          thread.resolvedAt = now();
          pushActivity(draft, {
            action: "resolved",
            target: thread.subject,
            module: "Inbox",
            entityType: "thread",
            entityId: id,
            icon: "ri-inbox-archive-line",
            tone: "success",
          });
        } else {
          thread.responseState = "unanswered";
          thread.resolvedAt = undefined;
        }
      });
    },
    [commit],
  );

  const assignThread = useCallback(
    (id: string, ownerId: string | null) => {
      commit((draft) => {
        const thread = draft.threads.find((t) => t.id === id);
        if (thread) thread.ownerId = ownerId;
      });
    },
    [commit],
  );

  const toggleThreadLabel = useCallback(
    (id: string, labelId: string) => {
      commit((draft) => {
        const thread = draft.threads.find((t) => t.id === id);
        if (!thread) return;
        if (thread.labelIds.includes(labelId)) {
          thread.labelIds = thread.labelIds.filter((l) => l !== labelId);
        } else {
          thread.labelIds.push(labelId);
        }
      });
    },
    [commit],
  );

  const toggleThreadFlag = useCallback(
    (id: string, flag: "starred" | "important") => {
      commit((draft) => {
        const thread = draft.threads.find((t) => t.id === id);
        if (thread) thread[flag] = !thread[flag];
      });
    },
    [commit],
  );

  const trashThread = useCallback(
    (id: string, trashed: boolean) => {
      commit((draft) => {
        const thread = draft.threads.find((t) => t.id === id);
        if (thread) thread.trashed = trashed;
      });
    },
    [commit],
  );

  const bulkThreadAction = useCallback(
    (ids: string[], action: "resolve" | "trash" | "read" | "restore") => {
      commit((draft) => {
        draft.threads.forEach((thread) => {
          if (!ids.includes(thread.id)) return;
          if (action === "resolve") {
            thread.responseState = "resolved";
            thread.readState = "read";
            thread.resolvedAt = now();
          } else if (action === "trash") {
            thread.trashed = true;
          } else if (action === "restore") {
            thread.trashed = false;
          } else if (action === "read") {
            thread.readState = "read";
          }
        });
      });
    },
    [commit],
  );

  const scheduleFollowUp = useCallback(
    (threadId: string, dueAt: string) => {
      const thread = state.threads.find((t) => t.id === threadId);
      createTask({
        title: `Follow up: ${thread?.subject ?? "email thread"}`,
        description: `Scheduled follow-up from the Inbox.`,
        ownerId: thread?.ownerId ?? activeActorId,
        priority: "Medium",
        dueAt,
        source: "Gmail / Inbox",
        relatedThreadId: threadId,
        relatedLeadId: thread?.relatedLeadId,
      });
    },
    [createTask, state.threads],
  );

  /* ------------------------------- events ----------------------------- */

  const setRegistrationOutcome = useCallback(
    (eventId: string, registrationId: string, outcome: RegOutcome) => {
      commit((draft) => {
        const event = draft.events.find((e) => e.id === eventId);
        const reg = event?.registrations.find((r) => r.id === registrationId);
        if (!event || !reg) return;
        const before = reg.outcome;
        reg.outcome = outcome;
        reg.callbackAt = outcome === "pending" ? reg.callbackAt : undefined;
        if (outcome === "attended") {
          const lead = draft.leads.find((l) => l.email.toLowerCase() === reg.email.toLowerCase());
          if (lead) {
            pushTouchpoint(draft, {
              leadId: lead.id,
              timestamp: now(),
              source: lead.source,
              channel: lead.channel,
              interactionType: "Event attendance",
              outcome: "Positive",
              ownerId: activeActorId,
              notes: `Attended ${event.name}.`,
              refType: "event",
              refId: `${eventId}:${registrationId}:attendance`,
            });
          }
        }
        pushActivity(draft, {
          action: `${outcome} registration for`,
          target: `${reg.name} — ${event.name}`,
          module: "Events",
          entityType: "event",
          entityId: eventId,
          icon: outcome === "declined" ? "ri-close-circle-line" : "ri-checkbox-circle-line",
          tone: outcome === "declined" ? "danger" : "success",
        });
        pushAudit(draft, {
          entityType: "event",
          entityId: eventId,
          action: "Registration outcome set",
          before,
          after: outcome,
        });
      });
    },
    [commit],
  );

  const setRegistrationAttendance = useCallback(
    (eventId: string, registrationId: string, attendance: AttendanceOutcome) => {
      commit((draft) => {
        const event = draft.events.find((e) => e.id === eventId);
        const reg = event?.registrations.find((r) => r.id === registrationId);
        if (!event || !reg) return;
        const before = reg.attendance ?? "Attendance Unknown";
        reg.attendance = attendance;
        reg.followUpRequired = attendance === "Did Not Attend" ? true : reg.followUpRequired;
        const lead = draft.leads.find(
          (l) => l.email.toLowerCase() === reg.email.toLowerCase(),
        );
        // Attendance is recorded as its OWN touchpoint, keyed on the source
        // record + event type so it is never duplicated on repeat updates.
        if (lead) {
          if (attendance === "Attended") {
            pushTouchpoint(draft, {
              leadId: lead.id,
              timestamp: now(),
              source: lead.source,
              channel: lead.channel,
              interactionType: "Information session attended",
              outcome: "Positive",
              ownerId: activeActorId,
              notes: `Attended the information session for ${event.name}.`,
              refType: "event",
              refId: `${eventId}:${registrationId}:attendance`,
            });
          } else if (attendance === "Did Not Attend") {
            pushTouchpoint(draft, {
              leadId: lead.id,
              timestamp: now(),
              source: lead.source,
              channel: lead.channel,
              interactionType: "Did not attend",
              outcome: "Neutral",
              ownerId: activeActorId,
              notes: `Recorded as not attending the information session for ${event.name}.`,
              refType: "event",
              refId: `${eventId}:${registrationId}:did-not-attend`,
            });
          }
        }
        pushActivity(draft, {
          action: `recorded attendance (${attendance}) for`,
          target: `${reg.name} — ${event.name}`,
          module: "Events",
          entityType: "event",
          entityId: eventId,
          icon: attendance === "Attended" ? "ri-user-star-line" : "ri-user-minus-line",
          tone: attendance === "Attended" ? "success" : "accent",
        });
        pushAudit(draft, {
          entityType: "event",
          entityId: eventId,
          action: "Information session attendance recorded",
          before,
          after: attendance,
        });
      });
    },
    [commit],
  );

  const updateRegistration = useCallback(
    (eventId: string, registrationId: string, patch: Partial<EventRegistration>) => {
      commit((draft) => {
        const event = draft.events.find((e) => e.id === eventId);
        const reg = event?.registrations.find((r) => r.id === registrationId);
        if (!reg) return;
        Object.assign(reg, patch);
      });
    },
    [commit],
  );

  const scheduleCallback = useCallback(
    (eventId: string, registrationId: string, dueAt: string) => {
      commit((draft) => {
        const event = draft.events.find((e) => e.id === eventId);
        const reg = event?.registrations.find((r) => r.id === registrationId);
        if (!event || !reg) return;
        reg.callbackAt = dueAt;
        const task: Task = {
          id: `T-${nextNumber(draft.tasks.map((t) => t.id), "T", 3000)}`,
          title: `Callback: ${reg.name} (${event.name})`,
          description: "Scheduled callback to confirm event attendance.",
          ownerId: activeActorId,
          priority: "Medium",
          dueAt,
          source: "Events",
          status: "open",
          relatedEventId: eventId,
          notes: "",
          createdAt: now(),
        };
        draft.tasks.unshift(task);
      });
    },
    [commit],
  );

  /* ---------------------------- campaigns ----------------------------- */

  const createCampaign = useCallback(
    (input: CampaignInput): EventCampaign => {
      const id = `CMP-EV-${nextNumber(state.campaigns.map((c) => c.id), "CMP-EV", 3000)}`;
      const record = createCampaignRecord(id, input, now());
      commit((draft) => {
        draft.campaigns.unshift(record);
        pushActivity(draft, {
          action: "created campaign",
          target: record.name,
          module: "Campaigns",
          entityType: "campaign",
          entityId: record.id,
          icon: "ri-megaphone-line",
          tone: "primary",
        });
      });
      return record;
    },
    [commit, state.campaigns],
  );

  const importCampaignAudience = useCallback(
    (campaignId: string, rows: AudienceRow[], fileName?: string) => {
      const campaign = state.campaigns.find((c) => c.id === campaignId);
      const preview = campaign ? buildAudience(rows, state.leads, campaign.recipients) : [];
      const result = {
        added: preview.length,
        valid: preview.filter((r) => r.valid).length,
        duplicates: preview.filter((r) => r.duplicate).length,
      };
      commit((draft) => {
        const target = draft.campaigns.find((c) => c.id === campaignId);
        if (!target) return;
        const built = buildAudience(rows, draft.leads, target.recipients);
        target.recipients = [...target.recipients, ...built];
        if (fileName) target.audienceFileName = fileName;
        if (target.stage === "Draft") target.stage = "Audience Imported";
        target.updatedAt = now();
        pushActivity(draft, {
          action: "imported an audience into",
          target: target.name,
          module: "Campaigns",
          entityType: "campaign",
          entityId: target.id,
          icon: "ri-upload-2-line",
          tone: "secondary",
        });
      });
      return result;
    },
    [commit, state.campaigns, state.leads],
  );

  const updateCampaignRecipient = useCallback(
    (campaignId: string, recipientId: string, patch: Partial<CampaignRecipient>) => {
      commit((draft) => {
        const campaign = draft.campaigns.find((c) => c.id === campaignId);
        if (!campaign) return;
        const recipient = campaign.recipients.find((r) => r.id === recipientId);
        if (recipient) Object.assign(recipient, patch);
        campaign.updatedAt = now();
      });
    },
    [commit],
  );

  const setCampaignStage = useCallback(
    (campaignId: string, stage: CampaignStage) => {
      commit((draft) => {
        const campaign = draft.campaigns.find((c) => c.id === campaignId);
        if (!campaign) return;
        const before = campaign.stage;
        campaign.stage = stage;
        campaign.updatedAt = now();
        pushAudit(draft, {
          entityType: "campaign",
          entityId: campaignId,
          action: "Campaign stage changed",
          before,
          after: stage,
        });
      });
    },
    [commit],
  );

  const sendCampaign = useCallback(
    (campaignId: string) => {
      commit((draft) => {
        const campaign = draft.campaigns.find((c) => c.id === campaignId);
        if (!campaign) return;
        const stamp = now();
        campaign.sentAt = stamp;
        campaign.updatedAt = stamp;
        campaign.stage = "Sent";
        campaign.recipients = campaign.recipients.map((r) =>
          r.valid && !r.duplicate ? { ...r, invitedAt: r.invitedAt ?? stamp } : r,
        );
        pushActivity(draft, {
          action: "sent campaign (simulated)",
          target: campaign.name,
          module: "Campaigns",
          entityType: "campaign",
          entityId: campaign.id,
          icon: "ri-send-plane-line",
          tone: "primary",
        });
        pushAudit(draft, {
          entityType: "campaign",
          entityId: campaignId,
          action: "Campaign sent (simulated)",
          before: "Ready to Send",
          after: "Sent",
        });
      });
    },
    [commit],
  );

  const updateCampaign = useCallback(
    (campaignId: string, patch: Partial<EventCampaign>) => {
      commit((draft) => {
        const campaign = draft.campaigns.find((c) => c.id === campaignId);
        if (campaign) Object.assign(campaign, patch, { updatedAt: now() });
      });
    },
    [commit],
  );

  /* ---------------------------- applications -------------------------- */

  const updateApplicationStatus = useCallback(
    (id: string, status: ApplicationStatus, note: string) => {
      commit((draft) => {
        const application = draft.applications.find((a) => a.id === id);
        if (!application) return;
        const before = application.status;
        application.status = status;
        application.updateAt = now();
        application.history.unshift({
          id: uid("hist"),
          status,
          at: now(),
          byId: activeActorId,
          note,
        });
        pushActivity(draft, {
          action: "updated status of",
          target: `${application.applicantName} — ${application.programme}`,
          module: "Applications",
          entityType: "application",
          entityId: id,
          icon: "ri-file-list-3-line",
          tone: "secondary",
        });
        pushAudit(draft, {
          entityType: "application",
          entityId: id,
          action: "Application status changed",
          before,
          after: status,
        });
      });
    },
    [commit],
  );

  const createApplication = useCallback(
    (input: ApplicationInput): Application => {
      const id = `APP-${nextNumber(state.applications.map((a) => a.id), "APP", 50000)}`;
      const application: Application = {
        id,
        applicantName: input.applicantName,
        email: input.email,
        phone: input.phone,
        programme: input.programme,
        intake: input.intake,
        status: input.status,
        ownerId: input.ownerId,
        submittedAt: now(),
        updateAt: now(),
        leadId: input.leadId,
        documents: [],
        notes: "",
        history: [
          {
            id: uid("hist"),
            status: input.status,
            at: now(),
            byId: activeActorId,
            note: "Application created.",
          },
        ],
      };
      commit((draft) => {
        draft.applications.unshift(application);
        if (input.leadId) {
          const lead = draft.leads.find((l) => l.id === input.leadId);
          if (lead && !lead.applicationIds.includes(id)) lead.applicationIds.push(id);
          if (lead) {
            pushTouchpoint(draft, {
              leadId: lead.id,
              timestamp: now(),
              source: lead.source,
              channel: lead.channel,
              interactionType: "Application submitted",
              outcome: "Positive",
              ownerId: activeActorId,
              notes: `Application ${id} submitted.`,
              refType: "application",
              refId: id,
            });
          }
        }
        pushActivity(draft, {
          action: "created application for",
          target: `${application.applicantName} — ${application.programme}`,
          module: "Applications",
          entityType: "application",
          entityId: id,
          icon: "ri-file-add-line",
          tone: "accent",
        });
        pushAudit(draft, {
          entityType: "application",
          entityId: id,
          action: "Application created",
          before: "—",
          after: input.status,
        });
      });
      return application;
    },
    [commit, state.applications],
  );

  const updateApplication = useCallback(
    (id: string, patch: Partial<Application>) => {
      commit((draft) => {
        const application = draft.applications.find((a) => a.id === id);
        if (!application) return;
        Object.assign(application, patch);
        application.updateAt = now();
      });
    },
    [commit],
  );

  const addApplicationNote = useCallback(
    (id: string, body: string) => {
      commit((draft) => {
        const application = draft.applications.find((a) => a.id === id);
        if (!application) return;
        const line = `${new Date().toLocaleDateString("en-GB")} — ${body}`;
        application.notes = application.notes ? `${line}\n${application.notes}` : line;
        application.updateAt = now();
        pushActivity(draft, {
          action: "added a note to",
          target: `${application.applicantName} — ${application.programme}`,
          module: "Applications",
          entityType: "application",
          entityId: id,
          icon: "ri-sticky-note-line",
          tone: "secondary",
        });
      });
    },
    [commit],
  );

  /* --------------------------- integrations --------------------------- */

  const logIntegrationEvent = useCallback(
    (action: string, target: string, tone: ActivityTone) => {
      commit((draft) => {
        pushActivity(draft, {
          action,
          target,
          module: "Integrations",
          entityType: "zoho",
          entityId: uid("sync"),
          icon: tone === "danger" ? "ri-error-warning-line" : "ri-refresh-line",
          tone,
        });
      });
    },
    [commit],
  );

  /* -------------------------------- calls ----------------------------- */

  const logCall = useCallback(
    (input: CallInput): Call => {
      const id = `CL-${nextNumber(state.calls.map((c) => c.id), "CL", 5000)}`;
      const call: Call = { id, ...input, occurredAt: now() };
      commit((draft) => {
        draft.calls.unshift(call);
        if (input.leadId) {
          const lead = draft.leads.find((l) => l.id === input.leadId);
          if (lead) {
            pushTouchpoint(draft, {
              leadId: lead.id,
              timestamp: call.occurredAt,
              source: lead.source,
              channel: lead.channel,
              interactionType: input.direction === "incoming" ? "Inbound call" : "Outbound call",
              outcome: input.status === "connected" || input.status === "answered" ? "Positive" : "No answer",
              ownerId: activeActorId,
              notes: input.notes || "Call logged.",
              refType: "call",
              refId: id,
            });
            lead.lastContactAt = call.occurredAt;
          }
        }
        pushActivity(draft, {
          action: input.direction === "incoming" ? "received a call from" : "called",
          target: input.direction === "incoming" ? input.caller : input.receiver,
          module: "Zoom",
          entityType: "call",
          entityId: id,
          icon: "ri-phone-line",
          tone: "primary",
        });
      });
      return call;
    },
    [commit, state.calls],
  );

  const scheduleCallbackTask = useCallback(
    (input: TaskInput): Task => createTask({ ...input, source: input.source ?? "Zoom" }),
    [createTask],
  );

  const recordCallOutcome = useCallback(
    (callId: string, outcome: CallOutcome, notes: string) => {
      commit((draft) => {
        const call = draft.calls.find((c) => c.id === callId);
        if (!call) return;
        const before = call.outcome ?? "Not recorded";
        call.outcome = outcome;
        if (notes) call.notes = notes;
        if (call.leadId) {
          const lead = draft.leads.find((l) => l.id === call.leadId);
          if (lead) lead.lastContactAt = now();
        }
        pushActivity(draft, {
          action: "recorded a call outcome",
          target: `${call.direction === "incoming" ? call.caller : call.receiver} \u2014 ${outcome}`,
          module: "Zoom",
          entityType: "call",
          entityId: callId,
          icon: "ri-phone-line",
          tone: "primary",
        });
        pushAudit(draft, {
          entityType: "call",
          entityId: callId,
          action: "Call outcome recorded",
          before,
          after: outcome,
        });
      });
    },
    [commit],
  );

  const attachCallFollowUp = useCallback(
    (callId: string, taskId: string) => {
      commit((draft) => {
        const call = draft.calls.find((c) => c.id === callId);
        if (call) call.followUpTaskId = taskId;
      });
    },
    [commit],
  );

  /* ----------------------------- attribution -------------------------- */

  const addTouchpoint = useCallback(
    (input: TouchpointInput): Touchpoint => {
      const point: Touchpoint = {
        id: uid("tp"),
        leadId: input.leadId,
        timestamp: input.timestamp,
        source: input.source,
        channel: input.channel,
        interactionType: input.interactionType,
        outcome: input.outcome,
        ownerId: input.ownerId,
        notes: input.notes,
        isClosing: false,
        refType: input.refType ?? "manual",
        refId: input.refId,
        category: categoryForInteractionType(input.interactionType),
        campaignId: input.campaignId,
      };
      commit((draft) => {
        const lead = draft.leads.find((l) => l.id === input.leadId);
        draft.touchpoints.push(point);
        if (lead) lead.lastContactAt = input.timestamp;
        pushActivity(draft, {
          action: "recorded a touchpoint on",
          target: lead?.name ?? input.leadId,
          module: "Attribution",
          entityType: "touchpoint",
          entityId: point.id,
          icon: "ri-flow-chart",
          tone: "secondary",
        });
        pushAudit(draft, {
          entityType: "touchpoint",
          entityId: point.id,
          action: "Touchpoint recorded",
          before: "—",
          after: `${input.interactionType} · ${input.source}`,
        });
      });
      return point;
    },
    [commit],
  );

  const updateTouchpoint = useCallback(
    (id: string, patch: Partial<Touchpoint>) => {
      commit((draft) => {
        const point = draft.touchpoints.find((t) => t.id === id);
        if (!point) return;
        const before = `${point.interactionType} · ${point.source} · ${point.outcome}`;
        Object.assign(point, patch);
        pushAudit(draft, {
          entityType: "touchpoint",
          entityId: id,
          action: "Touchpoint corrected",
          before,
          after: `${point.interactionType} · ${point.source} · ${point.outcome}`,
        });
      });
    },
    [commit],
  );

  const deleteTouchpoint = useCallback(
    (id: string) => {
      commit((draft) => {
        draft.touchpoints = draft.touchpoints.filter((t) => t.id !== id);
      });
    },
    [commit],
  );

  const closeLead = useCallback(
    (input: ClosingInput) => {
      commit((draft) => {
        const lead = draft.leads.find((l) => l.id === input.leadId);
        if (!lead) return;
        const before = lead.stage;
        lead.stage = input.outcome === "won" ? "Won" : "Lost";
        lead.closing = {
          closingDate: input.closingDate,
          closingOwnerId: input.closingOwnerId,
          outcome: input.outcome,
          interactionType: input.interactionType,
          source: input.source,
          channel: input.channel,
          campaign: input.campaign,
          notes: input.notes,
          lossReason: input.outcome === "lost" ? input.lossReason : undefined,
          touchpointId: input.touchpointId,
          recordedAt: now(),
        };
        if (input.newTouchpoint) {
          const created = pushTouchpoint(draft, {
            leadId: lead.id,
            timestamp: input.closingDate,
            source: input.source,
            channel: input.channel,
            interactionType: input.interactionType,
            outcome: input.outcome === "won" ? "Converted" : "Rejected",
            ownerId: input.closingOwnerId,
            notes: input.notes || "Closing interaction recorded.",
            refType: "manual",
          });
          if (created && lead.closing) {
            created.isClosing = true;
            lead.closing.touchpointId = created.id;
          }
        } else if (input.touchpointId) {
          const existing = draft.touchpoints.find((t) => t.id === input.touchpointId);
          if (existing) existing.isClosing = true;
        }
        pushActivity(draft, {
          action: input.outcome === "won" ? "closed won" : "closed lost",
          target: lead.name,
          module: "Attribution",
          entityType: "lead",
          entityId: lead.id,
          icon: input.outcome === "won" ? "ri-trophy-line" : "ri-close-circle-line",
          tone: input.outcome === "won" ? "success" : "danger",
        });
        pushAudit(draft, {
          entityType: "lead",
          entityId: lead.id,
          action: input.outcome === "won" ? "Lead closed won" : "Lead closed lost",
          before,
          after: `${lead.stage} · ${input.source} / ${input.channel}`,
        });
      });
    },
    [commit],
  );

  const reopenLead = useCallback(
    (leadId: string) => {
      commit((draft) => {
        const lead = draft.leads.find((l) => l.id === leadId);
        if (!lead) return;
        const before = lead.stage;
        draft.touchpoints.forEach((t) => {
          if (t.leadId === leadId && t.isClosing) t.isClosing = false;
        });
        lead.closing = undefined;
        lead.stage = "Nurture";
        pushAudit(draft, {
          entityType: "lead",
          entityId: leadId,
          action: "Lead reopened",
          before,
          after: "Nurture",
        });
      });
    },
    [commit],
  );

  /* ------------------ apprenticeship progression actions ---------------- */

  const updateEligibility = useCallback(
    (input: EligibilityInput) => {
      commit((draft) => {
        const lead = draft.leads.find((l) => l.id === input.leadId);
        if (!lead) return;
        const before = lead.eligibility?.status ?? "Not Assessed";
        const stamp = now();
        const responses: EligibilityResponse[] = input.responses.map((r) => ({
          questionId: r.questionId,
          answer: r.answer,
          evidence: r.evidence,
          notes: r.notes,
          weeklyHours: r.weeklyHours,
          checkedById: activeActorId,
          checkedAt: stamp,
        }));
        lead.eligibility = {
          status: input.status ?? deriveScreeningStatus(responses),
          responses,
          // A verified decision is only ever set explicitly — preserve it here.
          decision: lead.eligibility?.decision,
          verificationDate: lead.eligibility?.verificationDate,
          decisionMakerId: lead.eligibility?.decisionMakerId,
          decisionReasons: lead.eligibility?.decisionReasons,
          updatedAt: stamp,
        };
        pushActivity(draft, {
          action: "updated eligibility screening for",
          target: lead.name,
          module: "Eligibility",
          entityType: "lead",
          entityId: lead.id,
          icon: "ri-shield-check-line",
          tone: "secondary",
        });
        pushAudit(draft, {
          entityType: "lead",
          entityId: lead.id,
          action: "Eligibility screening updated",
          before,
          after: lead.eligibility.status,
        });
      });
    },
    [commit],
  );

  const recordEligibilityDecision = useCallback(
    (leadId: string, decision: "Verified Eligible" | "Not Eligible for Funding", reasons: string): boolean => {
      // Simulated permission enforcement: only Enrolment / Admin may verify.
      if (!roleCan(state.roleId, "eligibility.verify")) return false;
      commit((draft) => {
        const lead = draft.leads.find((l) => l.id === leadId);
        if (!lead) return;
        const base: EligibilityAssessment =
          lead.eligibility ?? {
            status: "Not Assessed",
            responses: [],
            updatedAt: now(),
          };
        const before = base.decision ?? base.status;
        lead.eligibility = {
          ...base,
          status: decision,
          decision,
          verificationDate: now(),
          decisionMakerId: activeActorId,
          decisionReasons: reasons,
          updatedAt: now(),
        };
        pushActivity(draft, {
          action: "recorded a verified funding decision for",
          target: lead.name,
          module: "Eligibility",
          entityType: "lead",
          entityId: lead.id,
          icon: "ri-shield-check-line",
          tone: decision === "Verified Eligible" ? "success" : "danger",
        });
        pushAudit(draft, {
          entityType: "lead",
          entityId: lead.id,
          action: "Funding eligibility decision recorded",
          before,
          after: decision,
        });
      });
      return true;
    },
    [commit, state.roleId],
  );

  const moveToFutureIntake = useCallback(
    (input: FutureIntakeInput): FutureIntakeRecord => {
      const existing = state.futureIntakes.find((f) => f.leadId === input.leadId);
      const id = existing?.id ?? `FI-${nextNumber(state.futureIntakes.map((f) => f.id), "FI", 3000)}`;
      const record: FutureIntakeRecord = {
        id,
        leadId: input.leadId,
        currentProgramme: input.currentProgramme,
        currentIntake: input.currentIntake,
        preferredIntake: input.preferredIntake,
        preferredStartMonth: input.preferredStartMonth,
        reason: input.reason,
        learnerReadiness: input.learnerReadiness,
        employerReadiness: input.employerReadiness,
        salesOwnerId: input.salesOwnerId,
        enrolmentOwnerId: input.enrolmentOwnerId,
        lastContactAt: input.lastContactAt,
        nextFollowUpAt: input.nextFollowUpAt,
        notes: input.notes,
        deferredAt: existing?.deferredAt ?? now(),
        reengagementFlag: false,
      };
      commit((draft) => {
        const lead = draft.leads.find((l) => l.id === input.leadId);
        const idx = draft.futureIntakes.findIndex((f) => f.id === id);
        if (idx >= 0) draft.futureIntakes[idx] = record;
        else draft.futureIntakes.unshift(record);
        if (lead) {
          lead.intakePlanning = "Future Intake";
          lead.intake = input.preferredIntake;
        }
        pushActivity(draft, {
          action: "moved to future intake",
          target: lead?.name ?? input.leadId,
          module: "Future Intake",
          entityType: "futureIntake",
          entityId: id,
          icon: "ri-calendar-schedule-line",
          tone: "accent",
        });
        pushAudit(draft, {
          entityType: "lead",
          entityId: input.leadId,
          action: "Moved to future intake",
          before: input.currentIntake,
          after: input.preferredIntake,
        });
      });
      if (input.createFollowUpTask && input.nextFollowUpAt) {
        createTask({
          title: `Future intake follow-up: ${input.leadId}`,
          description: `Re-engage and re-verify eligibility for the ${input.preferredIntake} intake.`,
          ownerId: input.enrolmentOwnerId || input.salesOwnerId,
          priority: "Medium",
          dueAt: input.nextFollowUpAt,
          source: "Manual",
          relatedLeadId: input.leadId,
          programme: input.currentProgramme,
        });
      }
      return record;
    },
    [commit, createTask, state.futureIntakes],
  );

  const updateFutureIntake = useCallback(
    (id: string, patch: Partial<FutureIntakeRecord>) => {
      commit((draft) => {
        const record = draft.futureIntakes.find((f) => f.id === id);
        if (record) Object.assign(record, patch);
      });
    },
    [commit],
  );

  const removeFromFutureIntake = useCallback(
    (id: string) => {
      commit((draft) => {
        const record = draft.futureIntakes.find((f) => f.id === id);
        draft.futureIntakes = draft.futureIntakes.filter((f) => f.id !== id);
        if (record) {
          const lead = draft.leads.find((l) => l.id === record.leadId);
          if (lead) lead.intakePlanning = "Current Intake";
          pushActivity(draft, {
            action: "returned to active intake",
            target: lead?.name ?? record.leadId,
            module: "Future Intake",
            entityType: "futureIntake",
            entityId: id,
            icon: "ri-arrow-go-forward-line",
            tone: "primary",
          });
          pushAudit(draft, {
            entityType: "lead",
            entityId: record.leadId,
            action: "Returned from future intake",
            before: "Future Intake",
            after: "Current Intake",
          });
        }
      });
    },
    [commit],
  );

  const referCommercial = useCallback(
    (input: CommercialInput): CommercialOpportunity => {
      const id = `CO-${nextNumber(state.commercialOpportunities.map((c) => c.id), "CO", 4000)}`;
      const record: CommercialOpportunity = {
        ...input,
        id,
        stage: "Referred",
        referredAt: now(),
        updatedAt: now(),
      };
      commit((draft) => {
        draft.commercialOpportunities.unshift(record);
        const lead = draft.leads.find((l) => l.id === input.leadId);
        pushActivity(draft, {
          action: "referred to commercial review",
          target: lead?.name ?? input.leadId,
          module: "Commercial",
          entityType: "commercial",
          entityId: id,
          icon: "ri-briefcase-4-line",
          tone: "accent",
        });
        pushAudit(draft, {
          entityType: "lead",
          entityId: input.leadId,
          action: "Referred for commercial review",
          before: "Not Referred",
          after: "Referred",
        });
      });
      return record;
    },
    [commit, state.commercialOpportunities],
  );

  const updateCommercial = useCallback(
    (id: string, patch: Partial<CommercialOpportunity>) => {
      commit((draft) => {
        const record = draft.commercialOpportunities.find((c) => c.id === id);
        if (!record) return;
        const beforeStage = record.stage;
        Object.assign(record, patch, { updatedAt: now() });
        const lead = draft.leads.find((l) => l.id === record.leadId);
        if (patch.stage && patch.stage !== beforeStage) {
          pushActivity(draft, {
            action: `moved commercial opportunity to ${patch.stage} for`,
            target: lead?.name ?? record.leadId,
            module: "Commercial",
            entityType: "commercial",
            entityId: id,
            icon: "ri-briefcase-4-line",
            tone: patch.stage === "Closed Won" ? "success" : patch.stage === "Declined" || patch.stage === "Closed Lost" ? "danger" : "primary",
          });
          pushAudit(draft, {
            entityType: "commercial",
            entityId: id,
            action: "Commercial stage changed",
            before: beforeStage,
            after: patch.stage,
          });
        }
      });
    },
    [commit],
  );

  const createEmployerAgreement = useCallback(
    (input: AgreementInput): EmployerAgreement => {
      const id = `EA-${nextNumber(state.employerAgreements.map((a) => a.id), "EA", 5000)}`;
      const record: EmployerAgreement = { ...input, id, updatedAt: now() };
      commit((draft) => {
        draft.employerAgreements.unshift(record);
        if (input.leadId) {
          const lead = draft.leads.find((l) => l.id === input.leadId);
          if (lead) advanceEnrolment(lead, "Employer Onboarding");
        }
        pushActivity(draft, {
          action: "opened employer agreement for",
          target: input.employerName,
          module: "Employers",
          entityType: "employerAgreement",
          entityId: id,
          icon: "ri-file-paper-2-line",
          tone: "primary",
        });
      });
      return record;
    },
    [commit, state.employerAgreements],
  );

  const updateEmployerAgreement = useCallback(
    (id: string, patch: Partial<EmployerAgreement>) => {
      commit((draft) => {
        const record = draft.employerAgreements.find((a) => a.id === id);
        if (!record) return;
        const before = record.status;
        Object.assign(record, patch, { updatedAt: now() });
        if (patch.status === "Signed" && !record.dateSigned) record.dateSigned = now();
        if (record.leadId) {
          const lead = draft.leads.find((l) => l.id === record.leadId);
          // Sending/introducing the agreement advances the onboarding checklist.
          if (lead && record.status !== "Not Sent") advanceEnrolment(lead, "Employer Onboarding");
        }
        if (patch.status && patch.status !== before) {
          pushActivity(draft, {
            action: `set employer agreement to ${patch.status} for`,
            target: record.employerName,
            module: "Employers",
            entityType: "employerAgreement",
            entityId: id,
            icon: "ri-file-paper-2-line",
            tone: patch.status === "Signed" ? "success" : patch.status === "Rejected" ? "danger" : "secondary",
          });
          pushAudit(draft, {
            entityType: "employerAgreement",
            entityId: id,
            action: "Employer agreement status changed",
            before,
            after: patch.status,
          });
        }
      });
    },
    [commit],
  );

  const createDasRecord = useCallback(
    (input: DasInput): DasRecord => {
      const id = `DAS-${nextNumber(state.dasRecords.map((d) => d.id), "DAS", 6000)}`;
      const record: DasRecord = { ...input, id, lastUpdatedAt: now() };
      commit((draft) => {
        draft.dasRecords.unshift(record);
        if (input.leadId) {
          const lead = draft.leads.find((l) => l.id === input.leadId);
          if (lead) advanceEnrolment(lead, "Employer Onboarding");
        }
        pushActivity(draft, {
          action: "started apprenticeship service tracking for",
          target: input.employerName,
          module: "Employers",
          entityType: "das",
          entityId: id,
          icon: "ri-government-line",
          tone: "primary",
        });
      });
      return record;
    },
    [commit, state.dasRecords],
  );

  const updateDas = useCallback(
    (id: string, patch: Partial<DasRecord>) => {
      commit((draft) => {
        const record = draft.dasRecords.find((d) => d.id === id);
        if (!record) return;
        const before = record.status;
        Object.assign(record, patch, { lastUpdatedAt: now() });
        if (patch.status && patch.status !== before) {
          pushActivity(draft, {
            action: `set Apprenticeship Service status to ${patch.status} for`,
            target: record.employerName,
            module: "Employers",
            entityType: "das",
            entityId: id,
            icon: "ri-government-line",
            tone: patch.status === "Confirmed" ? "success" : patch.status === "Blocked / Needs Help" ? "danger" : "secondary",
          });
          pushAudit(draft, {
            entityType: "das",
            entityId: id,
            action: "Apprenticeship Service status changed",
            before,
            after: patch.status,
          });
        }
      });
    },
    [commit],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      roleId: state.roleId,
      role,
      setRole,
      currentUserId,
      currentUser,
      getUser,
      userName,
      resetDemoData,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      backupStorageKey: BACKUP_STORAGE_KEY,
      migrationNotice,
      dismissMigrationNotice,
      exportDemoData,
      importDemoData,
      storageAvailable: probeStorage(),
      backendLoadedAt,
      backendAuthRequired,
      backendLoading,
      integrationOverview,
      refreshBackendWorkspace,
      signInBackend,
      createLead,
      updateLead,
      deleteLead,
      addLeadNote,
      createTask,
      updateTask,
      completeTask,
      reopenTask,
      rescheduleTask,
      deleteTask,
      markThreadRead,
      replyToThread,
      composeThread,
      logExternalResponse,
      resolveThread,
      assignThread,
      toggleThreadLabel,
      toggleThreadFlag,
      trashThread,
      bulkThreadAction,
      scheduleFollowUp,
      setRegistrationOutcome,
      setRegistrationAttendance,
      updateRegistration,
      scheduleCallback,
      createCampaign,
      importCampaignAudience,
      updateCampaignRecipient,
      setCampaignStage,
      sendCampaign,
      updateCampaign,
      updateApplicationStatus,
      createApplication,
      updateApplication,
      addApplicationNote,
      logIntegrationEvent,
      logCall,
      scheduleCallbackTask,
      recordCallOutcome,
      attachCallFollowUp,
      addTouchpoint,
      updateTouchpoint,
      deleteTouchpoint,
      closeLead,
      reopenLead,
      updateEligibility,
      recordEligibilityDecision,
      moveToFutureIntake,
      updateFutureIntake,
      removeFromFutureIntake,
      referCommercial,
      updateCommercial,
      createEmployerAgreement,
      updateEmployerAgreement,
      createDasRecord,
      updateDas,
    }),
    [
      state,
      role,
      setRole,
      currentUserId,
      currentUser,
      getUser,
      userName,
      resetDemoData,
      migrationNotice,
      dismissMigrationNotice,
      exportDemoData,
      importDemoData,
      backendLoadedAt,
      backendAuthRequired,
      backendLoading,
      integrationOverview,
      refreshBackendWorkspace,
      signInBackend,
      createLead,
      updateLead,
      deleteLead,
      addLeadNote,
      createTask,
      updateTask,
      completeTask,
      reopenTask,
      rescheduleTask,
      deleteTask,
      markThreadRead,
      replyToThread,
      composeThread,
      logExternalResponse,
      resolveThread,
      assignThread,
      toggleThreadLabel,
      toggleThreadFlag,
      trashThread,
      bulkThreadAction,
      scheduleFollowUp,
      setRegistrationOutcome,
      setRegistrationAttendance,
      updateRegistration,
      scheduleCallback,
      createCampaign,
      importCampaignAudience,
      updateCampaignRecipient,
      setCampaignStage,
      sendCampaign,
      updateCampaign,
      updateApplicationStatus,
      createApplication,
      updateApplication,
      addApplicationNote,
      logIntegrationEvent,
      logCall,
      scheduleCallbackTask,
      recordCallOutcome,
      attachCallFollowUp,
      addTouchpoint,
      updateTouchpoint,
      deleteTouchpoint,
      closeLead,
      reopenLead,
      updateEligibility,
      recordEligibilityDecision,
      moveToFutureIntake,
      updateFutureIntake,
      removeFromFutureIntake,
      referCommercial,
      updateCommercial,
      createEmployerAgreement,
      updateEmployerAgreement,
      createDasRecord,
      updateDas,
    ],
  );

  if (issue) {
    return (
      <DataRecoveryScreen
        issue={issue}
        onRetry={retryRecovery}
        onReset={resetFromRecovery}
      />
    );
  }

  if (backendAuthRequired) {
    return <BackendSignInScreen loading={backendLoading} onSignIn={signInBackend} />;
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
