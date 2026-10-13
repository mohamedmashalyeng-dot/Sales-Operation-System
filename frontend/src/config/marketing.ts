import type { BadgeTone } from "@/components/base/Badge";

/**
 * Campaign & outreach configuration for the KBC demonstration workspace.
 *
 * The apprenticeship prospecting journey is deliberately modelled as several
 * SEPARATE layers that are often (wrongly) conflated:
 *
 *   Acquisition provider  → where the contact was originally obtained (e.g. Apollo.io)
 *   CRM system            → where the contact is managed            (e.g. Zoho CRM)
 *   Marketing platform    → where the campaign is run               (e.g. Eventbrite)
 *   Communication channel → how the message is delivered            (e.g. Email)
 *   Event platform        → where registration happens              (e.g. Eventbrite)
 *   Session platform      → how the information session runs        (e.g. Zoom Meetings)
 *   Calling platform      → how Sales calls                 (e.g. Zoom Phone)
 *
 * All values are fictional and no external service is contacted.
 */

/* ----------------------------- Campaigns ----------------------------- */

export type CampaignStage =
  | "Draft"
  | "Audience Imported"
  | "Ready to Send"
  | "Sent"
  | "Registration Received"
  | "Cancelled";

export const CAMPAIGN_STAGES: CampaignStage[] = [
  "Draft",
  "Audience Imported",
  "Ready to Send",
  "Sent",
  "Registration Received",
  "Cancelled",
];

export const CAMPAIGN_STAGE_TONES: Record<CampaignStage, BadgeTone> = {
  Draft: "neutral",
  "Audience Imported": "secondary",
  "Ready to Send": "warning",
  Sent: "primary",
  "Registration Received": "success",
  Cancelled: "danger",
};

export type CampaignType =
  | "Email invitation"
  | "Reminder"
  | "Follow-up"
  | "Newsletter";

export const CAMPAIGN_TYPES: CampaignType[] = [
  "Email invitation",
  "Reminder",
  "Follow-up",
  "Newsletter",
];

export const CAMPAIGN_TYPE_ICONS: Record<CampaignType, string> = {
  "Email invitation": "ri-mail-add-line",
  Reminder: "ri-alarm-line",
  "Follow-up": "ri-reply-line",
  Newsletter: "ri-newspaper-line",
};

/* ---------------------- Participation outcomes ------------------------ */

/**
 * How a contact participates in an event campaign. These are tracked
 * separately: being invited is NOT registration, and registration is NOT
 * attendance. "Attendance Unknown" is a legitimate, honest state.
 */
export type ParticipationOutcome =
  | "Invited"
  | "Registered"
  | "Cancelled Registration"
  | "Attended"
  | "Did Not Attend"
  | "Attendance Unknown";

export const PARTICIPATION_OUTCOMES: ParticipationOutcome[] = [
  "Invited",
  "Registered",
  "Cancelled Registration",
  "Attended",
  "Did Not Attend",
  "Attendance Unknown",
];

export const PARTICIPATION_TONES: Record<ParticipationOutcome, BadgeTone> = {
  Invited: "secondary",
  Registered: "primary",
  "Cancelled Registration": "danger",
  Attended: "success",
  "Did Not Attend": "warning",
  "Attendance Unknown": "neutral",
};

/**
 * Registration and attendance are SEPARATE facts. A recipient can be invited
 * but never register; a registrant can be registered but never attend. Nothing
 * is marked attended just because a meeting ended.
 */
export type RegistrationStatus = "Registered" | "Cancelled Registration";

export const REGISTRATION_STATUSES: RegistrationStatus[] = [
  "Registered",
  "Cancelled Registration",
];

export const REGISTRATION_STATUS_TONES: Record<RegistrationStatus, BadgeTone> = {
  Registered: "primary",
  "Cancelled Registration": "danger",
};

export type AttendanceOutcome = "Attendance Unknown" | "Attended" | "Did Not Attend";

export const ATTENDANCE_OUTCOMES: AttendanceOutcome[] = [
  "Attendance Unknown",
  "Attended",
  "Did Not Attend",
];

export const ATTENDANCE_TONES: Record<AttendanceOutcome, BadgeTone> = {
  "Attendance Unknown": "neutral",
  Attended: "success",
  "Did Not Attend": "warning",
};

/** Campaign recipient delivery states — distinct from registration & attendance. */
export type RecipientStatus =
  | "Imported"
  | "Invited"
  | "Delivery Unknown"
  | "Delivered"
  | "Opened"
  | "Clicked";

export const RECIPIENT_STATUSES: RecipientStatus[] = [
  "Imported",
  "Invited",
  "Delivery Unknown",
  "Delivered",
  "Opened",
  "Clicked",
];

/** Event Detail filters — each maps to a precise slice of the audience. */
export type EventAudienceFilter =
  | "all"
  | "invited-only"
  | "registered"
  | "cancelled"
  | "attended"
  | "did-not-attend"
  | "attendance-unknown"
  | "follow-up-required";

export const EVENT_AUDIENCE_FILTERS: { id: EventAudienceFilter; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "ri-list-check" },
  { id: "invited-only", label: "Invited only", icon: "ri-mail-send-line" },
  { id: "registered", label: "Registered", icon: "ri-user-add-line" },
  { id: "cancelled", label: "Registration cancelled", icon: "ri-user-unfollow-line" },
  { id: "attended", label: "Attended", icon: "ri-user-star-line" },
  { id: "did-not-attend", label: "Did not attend", icon: "ri-user-minus-line" },
  { id: "attendance-unknown", label: "Attendance unknown", icon: "ri-question-line" },
  { id: "follow-up-required", label: "Follow-up required", icon: "ri-alarm-warning-line" },
];

/* ------------------------ CRM / platform layers ----------------------- */

export interface NamedLayer {
  id: string;
  label: string;
  icon: string;
  detail: string;
}

export const ACQUISITION_PROVIDERS: NamedLayer[] = [
  { id: "apollo", label: "Apollo.io", icon: "ri-radar-line", detail: "Contact data provider — original acquisition source" },
  { id: "zoho-import", label: "Zoho CRM export", icon: "ri-cloud-line", detail: "Contacts exported from the CRM for outreach" },
  { id: "website", label: "Website enquiry", icon: "ri-global-line", detail: "Direct enquiry through kentbusinesscollege.ac.uk" },
  { id: "direct-email", label: "Direct email enquiry", icon: "ri-mail-line", detail: "Inbound email to the admissions team" },
  { id: "eventbrite-direct", label: "Eventbrite listing", icon: "ri-calendar-event-line", detail: "Registered on a public Eventbrite listing" },
  { id: "referral", label: "Referral", icon: "ri-share-forward-line", detail: "Referred by an existing learner, employer or partner" },
  { id: "telephone", label: "Telephone", icon: "ri-phone-line", detail: "Called the admissions line directly" },
];

export const CRM_SYSTEMS: NamedLayer[] = [
  { id: "zoho", label: "Zoho CRM", icon: "ri-cloud-line", detail: "System of record for contacts and lead qualification" },
  { id: "none", label: "Not in a CRM", icon: "ri-indeterminate-circle-line", detail: "Contact handled without a CRM record" },
];

export const MARKETING_PLATFORMS: NamedLayer[] = [
  { id: "eventbrite", label: "Eventbrite", icon: "ri-calendar-event-line", detail: "Event campaigns, audiences and registration" },
  { id: "mailchimp", label: "Mailchimp", icon: "ri-mail-send-line", detail: "Newsletter and marketing email campaigns" },
  { id: "none", label: "No campaign platform", icon: "ri-indeterminate-circle-line", detail: "No outbound campaign involved" },
];

export const COMMUNICATION_CHANNELS = [
  "Email",
  "Phone call",
  "Zoom meeting",
  "SMS",
  "In person",
  "Web form",
] as const;

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const EVENT_PLATFORMS = [
  { id: "eventbrite", label: "Eventbrite", icon: "ri-calendar-event-line" },
  { id: "internal", label: "Internal booking", icon: "ri-calendar-line" },
] as const;

export const SESSION_PLATFORMS = [
  { id: "zoom-meetings", label: "Zoom Meetings", icon: "ri-vidicon-line" },
  { id: "in-person", label: "In person", icon: "ri-map-pin-line" },
] as const;

export const CALLING_PLATFORMS = [
  { id: "zoom-phone", label: "Zoom Phone", icon: "ri-phone-line" },
] as const;

/* --------------------------- Sales call review ------------------------ */

/**
 * Outcomes a Sales representative records after reviewing a conversation.
 * Recording an outcome never closes a lead by itself — a lead is only ever
 * Closed Won through the explicit closing workflow.
 */
export type CallOutcome =
  | "Interested"
  | "Needs Follow-up"
  | "Wants Future Intake"
  | "Eligibility Review Required"
  | "Not Interested"
  | "Commercial Review"
  | "Employer Discussion Required";

export const CALL_OUTCOMES: CallOutcome[] = [
  "Interested",
  "Needs Follow-up",
  "Wants Future Intake",
  "Eligibility Review Required",
  "Not Interested",
  "Commercial Review",
  "Employer Discussion Required",
];

export const CALL_OUTCOME_ICONS: Record<CallOutcome, string> = {
  Interested: "ri-thumb-up-line",
  "Needs Follow-up": "ri-time-line",
  "Wants Future Intake": "ri-calendar-schedule-line",
  "Eligibility Review Required": "ri-shield-check-line",
  "Not Interested": "ri-thumb-down-line",
  "Commercial Review": "ri-briefcase-4-line",
  "Employer Discussion Required": "ri-building-2-line",
};

export const CALL_OUTCOME_TONES: Record<CallOutcome, BadgeTone> = {
  Interested: "success",
  "Needs Follow-up": "warning",
  "Wants Future Intake": "accent",
  "Eligibility Review Required": "secondary",
  "Not Interested": "danger",
  "Commercial Review": "primary",
  "Employer Discussion Required": "accent",
};

/** Recordings and transcripts are never assumed — each is independently flagged. */
export interface MediaAvailability {
  recordingAvailable: boolean;
  transcriptAvailable: boolean;
}

export function mediaLabel(availability: MediaAvailability): string {
  if (availability.recordingAvailable && availability.transcriptAvailable) {
    return "Recording & transcript available";
  }
  if (availability.recordingAvailable) return "Recording available";
  if (availability.transcriptAvailable) return "Transcript available";
  return "Recording and transcript unavailable";
}

/** Formats a transcript segment timestamp as mm:ss (or h:mm:ss for long calls). */
export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/* ---------------------------- Audience import ------------------------- */

export interface AudienceRow {
  name: string;
  email: string;
  phone?: string;
}

/** A small, clearly fictional Zoho CSV export used to demonstrate the import. */
export const DEMO_ZOHO_AUDIENCE_CSV = `name,email,phone
Priya Raman,priya.raman@mavenprojects.com,+44 7700 900233
Grace Adeyemi,grace.adeyemi@gmail.com,+44 7700 900877
Elaine Foster,e.foster@brightworks.co.uk,+44 7712 445566
Priya Raman,priya.raman@mavenprojects.com,+44 7700 900233
Marcus Delaney,marcus.delaney@northgate.co.uk,+44 7700 900144
Yvonne Traherne,yvonne.traherne@sundial.co.uk,+44 7700 900255
not-an-email,invalid-address,,
Sophie Bennett,sophie.bennett@gmail.com,+44 7700 900122
`;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export interface ParsedAudience {
  rows: AudienceRow[];
  error?: string;
}

/** Parses a simple name,email,phone CSV export (the shape Zoho CRM produces). */
export function parseAudienceCsv(csv: string): ParsedAudience {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { rows: [], error: "The file does not contain any contacts." };
  const header = lines[0].toLowerCase();
  if (!header.includes("email")) {
    return { rows: [], error: "The file must contain an email column." };
  }
  const rows: AudienceRow[] = lines.slice(1).map((line) => {
    const [name = "", email = "", phone = ""] = line.split(",").map((c) => c.trim());
    return { name, email, phone };
  });
  return { rows };
}