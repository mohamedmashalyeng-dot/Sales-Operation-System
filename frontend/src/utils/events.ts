import type { BadgeTone } from "@/components/base/Badge";
import {
  type AttendanceOutcome,
  type EventAudienceFilter,
  type RecipientStatus,
  type RegistrationStatus,
} from "@/config/marketing";
import type {
  CampaignRecipient,
  CollegeEvent,
  EventCampaign,
  EventRegistration,
  Lead,
} from "@/store/types";

/**
 * A single, honest line in the event audience. Invitation, registration and
 * attendance are NEVER conflated: being invited is not registration, and
 * registration is not attendance.
 */
export interface EventAudienceRow {
  key: string;
  name: string;
  email: string;
  acquisitionSource: string;
  campaignId?: string;
  campaignName?: string;
  /** Delivery state of the invitation, or "Not invited" when none was sent. */
  invitationStatus: RecipientStatus | "Not invited";
  registrationId?: string;
  registeredAt?: string;
  registrationStatus: RegistrationStatus | "Not Registered";
  attendance: AttendanceOutcome;
  leadId?: string;
  salesOwnerId?: string;
  followUpRequired: boolean;
  notes: string;
}

const INVITATION_TONES: Record<RecipientStatus | "Not invited", BadgeTone> = {
  Imported: "neutral",
  Invited: "secondary",
  "Delivery Unknown": "neutral",
  Delivered: "accent",
  Opened: "primary",
  Clicked: "success",
  "Not invited": "neutral",
};

export function invitationTone(status: EventAudienceRow["invitationStatus"]): BadgeTone {
  return INVITATION_TONES[status];
}

/** Registration is a separate fact from attendance. */
export function deriveRegistrationStatus(reg: EventRegistration): RegistrationStatus {
  return reg.outcome === "declined" ? "Cancelled Registration" : "Registered";
}

/**
 * Attendance is only known when it has been explicitly recorded (or reconciled
 * from a completed registration outcome). Otherwise it stays Unknown.
 */
export function resolveAttendance(reg: EventRegistration): AttendanceOutcome {
  if (reg.attendance) return reg.attendance;
  if (reg.outcome === "attended") return "Attended";
  if (reg.outcome === "no-show") return "Did Not Attend";
  return "Attendance Unknown";
}

function recipientInvitationStatus(recipient: CampaignRecipient): RecipientStatus {
  if (recipient.clicked) return "Clicked";
  if (recipient.opened) return "Opened";
  if (recipient.delivered) return "Delivered";
  if (recipient.invitedAt) return "Invited";
  const isCancelled = recipient.outcome === "Cancelled Registration";
  if (isCancelled) return "Invited";
  return "Invited";
}

const normalise = (email: string) => email.trim().toLowerCase();

/**
 * Combines the campaign audience (invitations) with the event's registrations
 * (registration + attendance) into one row per person, matched by email so the
 * same person never appears twice.
 */
export function buildEventAudience(
  event: CollegeEvent,
  campaigns: EventCampaign[],
  leads: Lead[],
): EventAudienceRow[] {
  const rows = new Map<string, EventAudienceRow>();
  // Defensive: an older or partially-written record may not carry these arrays.
  const safeLeads = Array.isArray(leads) ? leads : [];
  const safeCampaigns = Array.isArray(campaigns) ? campaigns : [];
  const safeRegistrations = Array.isArray(event.registrations) ? event.registrations : [];
  const leadByEmail = new Map(safeLeads.map((l) => [normalise(l.email), l]));

  const relatedCampaigns = safeCampaigns.filter(
    (c) => c.eventId === event.id || c.id === event.campaignId,
  );

  relatedCampaigns.forEach((campaign) => {
    const recipients = Array.isArray(campaign.recipients) ? campaign.recipients : [];
    recipients.forEach((recipient) => {
      const key = normalise(recipient.email);
      const lead = leadByEmail.get(key);
      rows.set(key, {
        key,
        name: recipient.name,
        email: recipient.email,
        acquisitionSource: lead?.source ?? campaign.acquisitionProvider,
        campaignId: campaign.id,
        campaignName: campaign.name,
        invitationStatus: recipientInvitationStatus(recipient),
        registrationStatus: recipient.outcome === "Cancelled Registration" ? "Cancelled Registration" : "Not Registered",
        attendance: "Attendance Unknown",
        leadId: recipient.leadId ?? lead?.id,
        followUpRequired: false,
        notes: "",
      });
    });
  });

  safeRegistrations.forEach((reg) => {
    const key = normalise(reg.email);
    const lead = leadByEmail.get(key);
    const existing = rows.get(key);
    rows.set(key, {
      key,
      name: reg.name,
      email: reg.email,
      acquisitionSource: existing?.acquisitionSource ?? lead?.source ?? "Not recorded",
      campaignId: existing?.campaignId,
      campaignName: existing?.campaignName,
      invitationStatus: existing?.invitationStatus ?? "Not invited",
      registrationId: reg.id,
      registeredAt: reg.registeredAt,
      registrationStatus: deriveRegistrationStatus(reg),
      attendance: resolveAttendance(reg),
      leadId: existing?.leadId ?? lead?.id,
      salesOwnerId: reg.salesOwnerId ?? lead?.ownerId,
      followUpRequired: Boolean(reg.followUpRequired) || Boolean(reg.callbackAt),
      notes: reg.notes,
    });
  });

  return Array.from(rows.values()).sort((a, b) => {
    if (a.registrationStatus !== b.registrationStatus) {
      return a.registrationStatus === "Not Registered" ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function matchesEventFilter(row: EventAudienceRow, filter: EventAudienceFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "invited-only":
      return row.invitationStatus !== "Not invited" && row.registrationStatus === "Not Registered";
    case "registered":
      return row.registrationStatus === "Registered";
    case "cancelled":
      return row.registrationStatus === "Cancelled Registration";
    case "attended":
      return row.attendance === "Attended";
    case "did-not-attend":
      return row.attendance === "Did Not Attend";
    case "attendance-unknown":
      return row.registrationStatus === "Registered" && row.attendance === "Attendance Unknown";
    case "follow-up-required":
      return row.followUpRequired || row.attendance === "Did Not Attend";
    default:
      return true;
  }
}

export interface EventAudienceSummary {
  invited: number;
  registered: number;
  cancelled: number;
  attended: number;
  didNotAttend: number;
  attendanceUnknown: number;
  notRegistered: number;
  followUpRequired: number;
}

export function summariseAudience(rows: EventAudienceRow[]): EventAudienceSummary {
  const list = Array.isArray(rows) ? rows : [];
  return {
    invited: list.filter((r) => r.invitationStatus !== "Not invited").length,
    registered: list.filter((r) => r.registrationStatus === "Registered").length,
    cancelled: list.filter((r) => r.registrationStatus === "Cancelled Registration").length,
    attended: list.filter((r) => r.attendance === "Attended").length,
    didNotAttend: list.filter((r) => r.attendance === "Did Not Attend").length,
    attendanceUnknown: list.filter(
      (r) => r.registrationStatus === "Registered" && r.attendance === "Attendance Unknown",
    ).length,
    notRegistered: list.filter((r) => r.registrationStatus === "Not Registered").length,
    followUpRequired: list.filter((r) => r.followUpRequired || r.attendance === "Did Not Attend").length,
  };
}