import { isValidEmail, normaliseEmail, type AudienceRow, type CampaignStage, type CampaignType } from "@/config/marketing";
import type { CampaignRecipient, EventCampaign, Lead } from "@/store/types";

/**
 * Pure campaign helpers. Kept separate from the workspace provider so the
 * audience-matching rules (validation, duplicate detection, lead matching) live
 * in one tested place. A contact present in both Zoho and Eventbrite is matched
 * to the SAME lead — it is never duplicated as a new contact.
 */

export interface CampaignInput {
  name: string;
  type: CampaignType;
  platform: string;
  channel: string;
  crmSystem: string;
  acquisitionProvider: string;
  eventId?: string;
  subject: string;
  body: string;
  ownerId: string;
}

let recipientSeq = 0;

function recipientId(prefix: string): string {
  recipientSeq += 1;
  return `${prefix}-${Date.now().toString(36)}${recipientSeq.toString(36)}`;
}

export function createCampaignRecord(id: string, input: CampaignInput, stamp: string): EventCampaign {
  return {
    id,
    name: input.name,
    type: input.type,
    platform: input.platform,
    channel: input.channel,
    crmSystem: input.crmSystem,
    acquisitionProvider: input.acquisitionProvider,
    eventId: input.eventId,
    stage: "Draft",
    ownerId: input.ownerId,
    subject: input.subject,
    body: input.body,
    recipients: [],
    notes: "",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * Turns imported audience rows into recipients. Validation is done per row;
 * duplicates are detected against both the rows already in this import and any
 * recipients already on the campaign. Matching uses the normalised email so the
 * same person in Zoho and Eventbrite resolves to one lead.
 */
export function buildAudience(
  rows: AudienceRow[],
  leads: Lead[],
  existing: CampaignRecipient[] = [],
): CampaignRecipient[] {
  const seen = new Set(existing.map((r) => normaliseEmail(r.email)));
  return rows.map((row, index) => {
    const email = normaliseEmail(row.email);
    const valid = isValidEmail(row.email);
    const duplicate = valid && seen.has(email);
    if (valid) seen.add(email);
    const lead = leads.find((l) => normaliseEmail(l.email) === email);
    return {
      id: recipientId(`CR${index}`),
      name: row.name?.trim() || lead?.name || "Unknown contact",
      email: row.email.trim(),
      phone: row.phone?.trim() || lead?.phone || "",
      leadId: lead?.id,
      matched: Boolean(lead),
      valid,
      duplicate,
      outcome: "Invited",
    };
  });
}

export interface CampaignStats {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  matched: number;
  newContacts: number;
  invited: number;
  registered: number;
  cancelled: number;
  attended: number;
  didNotAttend: number;
  attendanceUnknown: number;
  delivered: number;
  opened: number;
  clicked: number;
}

export function campaignStats(campaign: EventCampaign): CampaignStats {
  const r = campaign.recipients;
  const count = (fn: (x: CampaignRecipient) => boolean) => r.filter(fn).length;
  return {
    total: r.length,
    valid: count((x) => x.valid),
    invalid: count((x) => !x.valid),
    duplicates: count((x) => x.duplicate),
    matched: count((x) => x.matched),
    newContacts: count((x) => !x.matched),
    invited: count((x) => x.outcome === "Invited"),
    registered: count((x) => x.outcome === "Registered" || x.outcome === "Attended"),
    cancelled: count((x) => x.outcome === "Cancelled Registration"),
    attended: count((x) => x.outcome === "Attended"),
    didNotAttend: count((x) => x.outcome === "Did Not Attend"),
    attendanceUnknown: count((x) => x.outcome === "Attendance Unknown"),
    delivered: count((x) => Boolean(x.delivered)),
    opened: count((x) => Boolean(x.opened)),
    clicked: count((x) => Boolean(x.clicked)),
  };
}

/** A campaign may only reach "Ready to Send" once it has a clean audience. */
export function canSendCampaign(campaign: EventCampaign): boolean {
  const stats = campaignStats(campaign);
  return stats.valid > 0 && campaign.stage !== "Sent" && campaign.stage !== "Cancelled";
}

export function nextCampaignStage(
  current: CampaignStage,
  hasAudience: boolean,
): CampaignStage {
  if (current === "Draft" && hasAudience) return "Audience Imported";
  return current;
}