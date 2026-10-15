import type { EmailLabel } from "@/config/crm";
import type { RoleId } from "@/config/permissions";
import type { TouchpointCategory } from "@/config/attribution";
import type {
  EligibilityStatus,
  EnrolmentStage,
  EvidenceStatus,
  IntakePlanningStatus,
  ScreeningAnswer,
} from "@/config/eligibility";
import type { CommercialStage } from "@/config/commercial";
import type { DasStatus, EmployerAgreementStatus } from "@/config/employer";
import type {
  AttendanceOutcome,
  CallOutcome,
  CampaignStage,
  CampaignType,
  ParticipationOutcome,
  RegistrationStatus,
} from "@/config/marketing";

export type { EmailLabel };
export type { RoleId };
export type {
  EligibilityStatus,
  EnrolmentStage,
  EvidenceStatus,
  IntakePlanningStatus,
  ScreeningAnswer,
};
export type { CommercialStage };
export type { DasStatus, EmployerAgreementStatus };
export type { AttendanceOutcome, CallOutcome, CampaignStage, CampaignType, ParticipationOutcome, RegistrationStatus };

export type Priority = "High" | "Medium" | "Low";

export interface User {
  id: string;
  name: string;
  role: string;
  email: string;
  team: string;
}

/* ----------------------------- Leads ----------------------------- */

export type LeadStage =
  | "New"
  | "Contacted"
  | "Qualified"
  | "Proposal sent"
  | "Nurture"
  | "Won"
  | "Lost";

export type TouchpointRefType =
  | "manual"
  | "email"
  | "call"
  | "event"
  | "application"
  | "meeting"
  | "campaign";

export interface Touchpoint {
  id: string;
  leadId: string;
  /** When the interaction actually happened. */
  timestamp: string;
  /** Acquisition source this interaction is attributed to (e.g. Facebook Ads). */
  source: string;
  /** Broad channel (e.g. Paid Social). Kept separate from source/platform. */
  channel: string;
  /** What actually happened (e.g. Web form, Inbound call, Email reply). */
  interactionType: string;
  outcome: string;
  ownerId: string;
  notes: string;
  /** Explicitly marks this interaction as the closing touch. Never auto-changes. */
  isClosing: boolean;
  refType: TouchpointRefType;
  /** Stable reference to the linked call / email message / event / application. */
  refId?: string;
  category?: TouchpointCategory;
  campaignId?: string;
}

export interface ClosingSnapshot {
  closingDate: string;
  closingOwnerId: string;
  outcome: "won" | "lost";
  interactionType: string;
  source: string;
  channel: string;
  campaign?: string;
  notes: string;
  lossReason?: string;
  touchpointId?: string;
  recordedAt: string;
}

export interface LeadNote {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
}

/* ------------------- Apprenticeship eligibility ------------------ */

export interface EligibilityResponse {
  questionId: string;
  answer: ScreeningAnswer;
  evidence: EvidenceStatus;
  notes: string;
  checkedById?: string;
  checkedAt?: string;
  /** Optional number captured for the weekly-hours question. */
  weeklyHours?: number;
}

/**
 * Initial screening AND the verified funding decision are kept as SEPARATE
 * fields on purpose. A screening outcome is never the same as an eligibility
 * decision.
 */
export interface EligibilityAssessment {
  status: EligibilityStatus;
  responses: EligibilityResponse[];
  /** Set only by an authorised role recording a verified decision. */
  decision?: "Verified Eligible" | "Not Eligible for Funding";
  verificationDate?: string;
  decisionMakerId?: string;
  decisionReasons?: string;
  aiRecommendation?: {
    status: EligibilityStatus;
    confidence: number;
    summary: string;
    reasons: string[];
    missing_information: string[];
    evidence: string[];
    screening_checks: {
      question_id: string;
      assessment: "met" | "not_met" | "unknown" | "review";
      evidence: string[];
    }[];
    source: string;
    provider_warning?: string;
    analysed_at: string;
  };
  updatedAt: string;
}

/* ------------------------ Future intake -------------------------- */

export interface FutureIntakeRecord {
  id: string;
  leadId: string;
  currentProgramme: string;
  currentIntake: string;
  preferredIntake: string;
  /** "YYYY-MM" preferred start month. */
  preferredStartMonth: string;
  reason: string;
  learnerReadiness: string;
  employerReadiness: string;
  salesOwnerId: string;
  enrolmentOwnerId: string;
  lastContactAt: string;
  nextFollowUpAt: string;
  notes: string;
  deferredAt: string;
  /** Flags the lead for re-engagement as the intake approaches. */
  reengagementFlag?: boolean;
}

/* ---------------------- Commercial pathway ----------------------- */

export interface CommercialOpportunity {
  id: string;
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
  stage: CommercialStage;
  referredAt: string;
  updatedAt: string;
}

/* --------------------- Employer onboarding ----------------------- */

export interface EmployerAgreement {
  id: string;
  employerName: string;
  employerContact: string;
  status: EmployerAgreementStatus;
  dateSent?: string;
  dateSigned?: string;
  verifiedById?: string;
  followUpDueAt?: string;
  notes: string;
  leadId?: string;
  applicationId?: string;
  updatedAt: string;
}

export interface DasRecord {
  id: string;
  employerName: string;
  status: DasStatus;
  accountExists?: boolean;
  accountSetupHelpNeeded: boolean;
  ukprnShared: boolean;
  providerAdditionRequested: boolean;
  providerAdditionConfirmed: boolean;
  fundingActionsReviewed: boolean;
  responsibleStaffId: string;
  lastUpdatedAt: string;
  followUpAt?: string;
  notes: string;
  leadId?: string;
  applicationId?: string;
}

export interface Lead {
  id: string;
  name: string;
  contactName: string;
  employer?: string;
  journeyStage?: string;
  email: string;
  phone: string;
  programme: string;
  intake: string;
  source: string;
  ownerId: string;
  stage: LeadStage;
  priority: Priority;
  value: number;
  createdAt: string;
  lastContactAt: string;
  nextAction: string;
  nextActionAt: string;
  tags: string[];
  zohoSynced: boolean;
  zohoId?: string;
  notes: LeadNote[];
  applicationIds: string[];
  /* ---- attribution (Phase 4) ---- */
  channel: string;
  platform: string;
  campaign?: string;
  campaignId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  acquisitionDate: string;
  originalOwnerId: string;
  /** Frozen at close time so later interactions never overwrite attribution. */
  closing?: ClosingSnapshot;
  /* ---- apprenticeship progression (Phase 5) ---- */
  /** Initial screening result — separate from the verified funding decision. */
  eligibility?: EligibilityAssessment;
  /** Intake planning dimension — kept apart from sales stage and enrolment. */
  intakePlanning?: IntakePlanningStatus;
  /** Enrolment dimension — separate from sales conversion and apprenticeship start. */
  enrolment?: EnrolmentStage;
}

/* ----------------------------- Inbox ----------------------------- */

export type ReadState = "unread" | "read";
export type ResponseState = "unanswered" | "seen-no-reply" | "replied" | "resolved";
export type ThreadStatusKey =
  | "unanswered"
  | "unread"
  | "seen-no-reply"
  | "overdue"
  | "resolved"
  | "sent"
  | "all"
  | "trash";

export interface EmailMessage {
  id: string;
  subject?: string;
  direction: "inbound" | "outbound";
  fromName: string;
  fromEmail: string;
  toEmail: string;
  body: string;
  sentAt: string;
  authorId?: string;
}

export interface EmailThread {
  id: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  preview: string;
  labelIds: string[];
  ownerId: string | null;
  readState: ReadState;
  responseState: ResponseState;
  receivedAt: string;
  slaHours: number;
  deadlineAt: string;
  resolvedAt?: string;
  externalResponseAt?: string;
  starred: boolean;
  important: boolean;
  trashed: boolean;
  relatedLeadId?: string;
  messages: EmailMessage[];
}

/* ----------------------------- Tasks ----------------------------- */

export type TaskSource =
  | "Call analysis"
  | "Zoho CRM"
  | "Gmail / Inbox"
  | "Events"
  | "Zoom"
  | "Applications"
  | "Manual";

export type TaskStatus = "open" | "completed";

export interface Task {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  priority: Priority;
  dueAt: string;
  source: TaskSource;
  status: TaskStatus;
  completedAt?: string;
  relatedLeadId?: string;
  relatedThreadId?: string;
  relatedEventId?: string;
  relatedCallId?: string;
  sourceEventId?: string;
  evaluationId?: string;
  sourceKey?: string;
  callVerified?: boolean;
  programme?: string;
  notes: string;
  createdAt: string;
}

/* ----------------------------- Events ---------------------------- */

export type RegOutcome = "confirmed" | "declined" | "pending" | "attended" | "no-show";

export interface EventRegistration {
  id: string;
  name: string;
  email: string;
  phone: string;
  programme: string;
  outcome: RegOutcome;
  registeredAt: string;
  callbackAt?: string;
  notes: string;
  /** Explicit attendance — never assumed from registration or a meeting ending. */
  attendance?: AttendanceOutcome;
  /** Sales owner following up this registration, when assigned. */
  salesOwnerId?: string;
  /** True when a follow-up is still required for this registration. */
  followUpRequired?: boolean;
}

export interface CollegeEvent {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  source: "Eventbrite" | "Zoom" | "Manual";
  status: "upcoming" | "live" | "completed";
  location: string;
  meetingLink?: string;
  description: string;
  registrations: EventRegistration[];
  registrationMetrics?: { booked: number; confirmed: number; attended: number; declined: number; pending: number };
  /* ---- Eventbrite / Zoom linkage (Phase 6) ---- */
  /** Public Eventbrite event reference — registration source, not acquisition. */
  eventbriteRef?: string;
  /** When the online information session (if any) is planned to run. */
  informationSessionAt?: string;
  /** Zoom Meetings ID used for the information session (Zoom Meetings, not Phone). */
  zoomMeetingId?: string;
  /** The Eventbrite campaign whose invitation drove this event, if applicable. */
  campaignId?: string;
}

/* ------------------- Eventbrite campaign management ------------------- */

export interface CampaignRecipient {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Matched shared-dataset lead id (never duplicated because two systems share an email). */
  leadId?: string;
  /** True when the normalised email matched an existing lead. */
  matched: boolean;
  /** False when the email address failed format validation. */
  valid: boolean;
  /** True when the same email appeared earlier in the imported audience. */
  duplicate: boolean;
  outcome: ParticipationOutcome;
  invitedAt?: string;
  registeredAt?: string;
  /** Event registration reference once the recipient registers, if known. */
  registrationRef?: string;
  /** Only ever true when explicit fictional sample data represents it. */
  delivered?: boolean;
  opened?: boolean;
  clicked?: boolean;
}

export interface EventCampaign {
  id: string;
  name: string;
  type: CampaignType;
  /** Marketing platform the campaign runs on, e.g. Eventbrite. */
  platform: string;
  /** Communication channel, e.g. Email. */
  channel: string;
  /** CRM system the audience was exported from, e.g. Zoho CRM. */
  crmSystem: string;
  /** Original acquisition provider the audience originated from, e.g. Apollo.io. */
  acquisitionProvider: string;
  eventId?: string;
  stage: CampaignStage;
  ownerId: string;
  subject: string;
  body: string;
  audienceFileName?: string;
  recipients: CampaignRecipient[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

/* -------------------------- Applications ------------------------- */

export type ApplicationStatus =
  | "Submitted"
  | "Under review"
  | "Interview"
  | "Offer"
  | "Enrolled"
  | "Rejected"
  | "Withdrawn";

export interface ApplicationDoc {
  id: string;
  name: string;
  type: string;
  status: "Received" | "Pending" | "Verified";
}

export interface ApplicationStatusChange {
  id: string;
  status: ApplicationStatus;
  at: string;
  byId: string;
  note: string;
}

export interface Application {
  id: string;
  enrolmentSource?: string;
  contractStatus?: string;
  applicantName: string;
  email: string;
  phone: string;
  programme: string;
  intake: string;
  status: ApplicationStatus;
  ownerId: string;
  submittedAt: string;
  updateAt: string;
  leadId?: string;
  documents: ApplicationDoc[];
  notes: string;
  history: ApplicationStatusChange[];
}

/* -------------------------- Zoom: meetings ----------------------- */

export interface Meeting {
  id: string;
  topic: string;
  hostId: string;
  hostName?: string;
  account: string;
  startAt: string;
  durationMins: number;
  joinUrl?: string;
  relatedEventId?: string;
  status: "scheduled" | "completed";
  participants: number;
  /* ---- Zoom Meetings linkage (Phase 6) ---- */
  /** Zoom Meetings ID (information sessions and webinars — not Zoom Phone). */
  zoomMeetingId?: string;
  /** Linked Eventbrite event reference, where the session supports one. */
  eventbriteRef?: string;
  /** Attendance is only recorded when explicitly known — never assumed. */
  attendanceRecorded?: boolean;
}

export type CallStatus = "answered" | "no-answer" | "connected" | "voicemail";

export interface TranscriptSegment {
  id: string;
  startSec: number;
  speaker: string;
  text: string;
}

export interface Call {
  id: string;
  direction: "incoming" | "outgoing";
  status: CallStatus;
  durationSec: number;
  caller: string;
  receiver: string;
  phoneNumber: string;
  leadId?: string;
  occurredAt: string;
  notes: string;
  matchConfidence: "verified" | "uncertain" | "none";
  /* ---- Zoom Phone call review (Phase 6) ---- */
  /** Zoom Phone (Sales calling) — distinct from Zoom Meetings. */
  platform?: "Zoom Phone" | "Zoom Meetings";
  /** Sales owner who handled the call. */
  salesOwnerId?: string;
  employerName?: string;
  programme?: string;
  /** Recorded by the Sales representative after reviewing the conversation. */
  outcome?: CallOutcome;
  /** Independently flagged — never assumed from the call having been answered. */
  recordingAvailable?: boolean;
  recordingDurationSec?: number;
  transcriptAvailable?: boolean;
  transcript?: TranscriptSegment[];
  /** Planner task raised from this call, when a follow-up was explicitly scheduled. */
  followUpTaskId?: string;
  relatedEventId?: string;
}

/* -------------------------- Activity / audit --------------------- */

export type ActivityTone = "primary" | "accent" | "secondary" | "success" | "danger";

export interface ActivityEntry {
  id: string;
  actorId: string;
  action: string;
  target: string;
  module: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  icon: string;
  tone: ActivityTone;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  module: string;
  createdAt: string;
  read: boolean;
  tone: ActivityTone;
  route?: string;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  before: string;
  after: string;
  createdAt: string;
}

/** Recorded when the stored dataset is upgraded to a newer schema. */
export interface MigrationRecord {
  fromVersion: number;
  toVersion: number;
  at: string;
}

export interface IntegrationStatus {
  key: string;
  label: string;
  icon: string;
  status: "connected" | "attention" | "disconnected";
  detail: string;
}

export interface WorkspaceState {
  /** Explicit schema version of the persisted dataset. */
  schemaVersion: number;
  /** Details of the most recent successful automatic migration, if any. */
  lastMigration?: MigrationRecord;
  /** Acting demonstration role. Frontend-only, persisted to localStorage. */
  roleId: RoleId;
  users: User[];
  leads: Lead[];
  touchpoints: Touchpoint[];
  futureIntakes: FutureIntakeRecord[];
  commercialOpportunities: CommercialOpportunity[];
  employerAgreements: EmployerAgreement[];
  dasRecords: DasRecord[];
  threads: EmailThread[];
  labels: EmailLabel[];
  tasks: Task[];
  events: CollegeEvent[];
  campaigns: EventCampaign[];
  applications: Application[];
  meetings: Meeting[];
  calls: Call[];
  activity: ActivityEntry[];
  notifications: Notification[];
  audit: AuditEntry[];
  integrationStatuses: IntegrationStatus[];
}
